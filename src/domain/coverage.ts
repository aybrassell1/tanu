import { addDays } from './dates';
import { categoryLines, indexLedger } from './ledger';
import { sum } from './money';
import { TRANSFER_LABEL_CATEGORIES } from './defaultCategories';
import type { Cents, Frequency, ID, ISODate, LedgerData } from './types';

/**
 * A map of everything people commonly spend on, showing what's tracked and
 * the irregular costs that are easy to forget until they arrive.
 */

export type Cadence = 'yearly' | 'twice a year' | 'every few years' | 'now and then' | 'seasonal';

export interface IrregularCost {
  categoryId: ID;
  label: string;
  cadence: Cadence;
  /** Only suggest when the user has something this applies to. */
  when?: 'car' | 'home_owner' | 'renter' | 'pet' | 'kids';
}

/** Costs that don't arrive monthly, so they don't show up in a normal budget. */
export const IRREGULAR_COSTS: IrregularCost[] = [
  { categoryId: 'transportation.registration', label: 'Car registration', cadence: 'yearly', when: 'car' },
  { categoryId: 'transportation.inspection', label: 'Car inspection', cadence: 'yearly', when: 'car' },
  { categoryId: 'transportation.maintenance', label: 'Oil changes & service', cadence: 'twice a year', when: 'car' },
  { categoryId: 'transportation.tires', label: 'New tires', cadence: 'every few years', when: 'car' },
  { categoryId: 'transportation.repairs', label: 'Car repairs', cadence: 'now and then', when: 'car' },
  { categoryId: 'housing.property_tax', label: 'Property tax', cadence: 'yearly', when: 'home_owner' },
  { categoryId: 'housing.home_insurance', label: 'Home insurance', cadence: 'yearly', when: 'home_owner' },
  { categoryId: 'housing.maintenance', label: 'Home repairs', cadence: 'now and then', when: 'home_owner' },
  { categoryId: 'housing.renters_insurance', label: 'Renters insurance', cadence: 'yearly', when: 'renter' },
  { categoryId: 'housing.appliances', label: 'Appliance replacement', cadence: 'every few years' },
  { categoryId: 'health.dental', label: 'Dental cleanings', cadence: 'twice a year' },
  { categoryId: 'health.vision', label: 'Eye exam & glasses', cadence: 'yearly' },
  { categoryId: 'pets.vet', label: 'Vet checkups', cadence: 'yearly', when: 'pet' },
  { categoryId: 'kids.school_supplies', label: 'Back-to-school', cadence: 'seasonal', when: 'kids' },
  { categoryId: 'giving.holidays', label: 'Holiday gifts', cadence: 'seasonal' },
  { categoryId: 'giving.gifts', label: 'Birthdays & gifts', cadence: 'now and then' },
  { categoryId: 'travel.general', label: 'Vacation', cadence: 'yearly' },
  { categoryId: 'travel.passport', label: 'Passport renewal', cadence: 'every few years' },
  { categoryId: 'subscriptions.memberships', label: 'Annual memberships', cadence: 'yearly' },
  { categoryId: 'financial.annual_fees', label: 'Card annual fees', cadence: 'yearly' },
  { categoryId: 'shopping.electronics', label: 'Phone & laptop upgrades', cadence: 'every few years' },
  { categoryId: 'clothing.shoes', label: 'Shoes & seasonal clothes', cadence: 'seasonal' },
  { categoryId: 'taxes.tax_prep', label: 'Tax preparation', cadence: 'yearly' },
];

export interface MapSub {
  id: ID;
  name: string;
  total: Cents;
  count: number;
  recurring: boolean;
}

export interface MapArea {
  id: ID;
  name: string;
  color: string;
  total: Cents;
  monthly: Cents;
  subs: MapSub[];
  trackedSubs: number;
}

export interface IrregularLine extends IrregularCost {
  yearly: Cents;
  monthlySetAside: Cents;
  lastDate?: ISODate;
  hasRecurring: boolean;
}

export interface SpendingMap {
  from: ISODate;
  to: ISODate;
  months: number;
  total: Cents;
  areas: MapArea[];
  trackedAreas: number;
  irregular: IrregularLine[];
  setAsideMonthly: Cents;
  missing: IrregularCost[];
}

const yearlyFactor = (f: Frequency) => {
  const per = { day: 365, week: 52, month: 12, year: 1 }[f.unit];
  return per / Math.max(1, f.interval);
};

export function spendingMap(data: LedgerData, today: ISODate): SpendingMap {
  const index = indexLedger(data);
  // The past year, so area totals and yearly irregular costs agree.
  const from = addDays(today, -364);
  const firstTx = data.transactions.reduce<ISODate>((min, t) => (t.date >= from && t.date < min ? t.date : min), today);
  const start = firstTx > from ? firstTx : from;
  const months = Math.min(12, Math.max(1, ((Date.parse(today) - Date.parse(start) + 864e5) / (365 * 864e5)) * 12));

  const bySub = new Map<ID, { total: Cents; count: number; last?: ISODate }>();
  for (const t of index.sorted) {
    if (t.date < from || t.date > today) continue;
    // A split purchase lands in each of its categories.
    for (const line of categoryLines(t)) {
      if (!line.categoryId || line.amount === 0) continue;
      const entry = bySub.get(line.categoryId) ?? { total: 0, count: 0 };
      entry.total += line.amount;
      entry.count += 1;
      if (!entry.last || t.date > entry.last) entry.last = t.date;
      bySub.set(line.categoryId, entry);
    }
  }
  const recurringByCategory = new Map<ID, Cents>();
  const regularCategories = new Set<ID>();
  for (const r of data.recurring) {
    if (!r.active || !r.categoryId || (r.kind !== 'bill' && r.kind !== 'subscription')) continue;
    // Monthly or more often is already part of a normal budget.
    if (yearlyFactor(r.frequency) > 4) { regularCategories.add(r.categoryId); continue; }
    recurringByCategory.set(r.categoryId, (recurringByCategory.get(r.categoryId) ?? 0) + Math.round(r.amount * yearlyFactor(r.frequency)));
  }

  const skip = new Set<ID>(TRANSFER_LABEL_CATEGORIES);
  const roots = data.categories.filter((c) => c.kind === 'expense' && !c.parentId && !c.archived && c.id !== 'other').sort((a, b) => a.order - b.order);
  const areas: MapArea[] = roots.map((root) => {
    const subs = data.categories
      .filter((c) => c.parentId === root.id && !c.archived && !skip.has(c.id))
      .sort((a, b) => a.order - b.order)
      .map((c) => {
        const s = bySub.get(c.id);
        return { id: c.id, name: c.name, total: s?.total ?? 0, count: s?.count ?? 0, recurring: recurringByCategory.has(c.id) || regularCategories.has(c.id) };
      });
    const rootOnly = bySub.get(root.id)?.total ?? 0;
    const total = rootOnly + sum(subs.map((s) => s.total));
    return { id: root.id, name: root.name, color: root.color, total, monthly: Math.round(total / months), subs, trackedSubs: subs.filter((s) => s.count > 0 || s.recurring).length };
  });

  const hasAccount = (types: string[]) => data.accounts.some((a) => !a.archived && types.includes(a.type));
  const hasAsset = (types: string[]) => data.assets.some((a) => !a.archived && types.includes(a.type));
  const spent = (prefix: string) => [...bySub.keys()].some((id) => id.startsWith(prefix));
  const applies = (item: IrregularCost) => {
    switch (item.when) {
      case 'car':
        return hasAccount(['auto_loan']) || hasAsset(['vehicle']) || spent('transportation.gas') || spent('transportation.insurance');
      case 'home_owner':
        return hasAccount(['mortgage']) || hasAsset(['property']) || spent('housing.mortgage');
      case 'renter':
        return spent('housing.rent') && !hasAccount(['mortgage']);
      case 'pet':
        return spent('pets.');
      case 'kids':
        return spent('kids.');
      default:
        return true;
    }
  };

  const irregular: IrregularLine[] = [];
  const missing: IrregularCost[] = [];
  const cutoff = addDays(today, -400);
  for (const item of IRREGULAR_COSTS) {
    if (!index.categories.has(item.categoryId) || !applies(item)) continue;
    const s = bySub.get(item.categoryId);
    const recurringYearly = recurringByCategory.get(item.categoryId);
    // Paid most months (e.g. monthly renters insurance): a regular cost, not an irregular one.
    if ((s && s.count >= 6) || regularCategories.has(item.categoryId)) continue;
    if (s && s.last && s.last >= cutoff) {
      const yearly = Math.round((s.total / months) * 12);
      irregular.push({ ...item, yearly, monthlySetAside: Math.round(yearly / 12), lastDate: s.last, hasRecurring: recurringYearly !== undefined });
    } else if (recurringYearly !== undefined) {
      irregular.push({ ...item, yearly: recurringYearly, monthlySetAside: Math.round(recurringYearly / 12), hasRecurring: true });
    } else {
      missing.push(item);
    }
  }
  irregular.sort((a, b) => b.yearly - a.yearly);

  return {
    from: start,
    to: today,
    months,
    total: sum(areas.map((a) => a.total)),
    areas,
    trackedAreas: areas.filter((a) => a.total > 0 || a.trackedSubs > 0).length,
    irregular,
    setAsideMonthly: sum(irregular.map((i) => i.monthlySetAside)),
    missing,
  };
}
