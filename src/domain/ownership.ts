import { addDays, addMonths, diffDays } from './dates';
import { balanceOn, categoryLines, debtActivity, indexLedger } from './ledger';
import type { Asset, Cents, ID, ISODate, LedgerData } from './types';

/**
 * What a thing actually costs to own.
 *
 * Costs are collected two ways: transactions carrying the asset's
 * `expenseTag` (insurance, fuel, servicing, tolls…) and the asset's linked
 * liability (loan interest and principal).
 *
 * Integrity: a debt payment is not spending. Principal is money moving from
 * cash into equity, so it is reported on its own line and excluded from the
 * cost of ownership — only interest, running costs and lost value are costs.
 * Cash out (what actually left your accounts) is reported separately.
 */

export type CostKind =
  | 'loan_interest'
  | 'loan_principal'
  | 'payment'
  | 'insurance'
  | 'fuel'
  | 'maintenance'
  | 'fees'
  | 'tolls_parking'
  | 'other';

export interface CostKindInfo {
  label: string;
  emoji: string;
  /** false for loan principal: cash out, but not a cost of ownership. */
  cost: boolean;
  hint?: string;
}

export const COST_KINDS: Record<CostKind, CostKindInfo> = {
  loan_interest: { label: 'Loan interest', emoji: 'bank', cost: true, hint: 'What borrowing costs you' },
  loan_principal: { label: 'Loan principal', emoji: 'money-bag', cost: false, hint: 'Paid off the loan — becomes equity, not a cost' },
  payment: { label: 'Payments & lease', emoji: 'credit-card', cost: true, hint: 'Lease or payments recorded as an expense' },
  insurance: { label: 'Insurance', emoji: 'shield', cost: true },
  fuel: { label: 'Fuel & charging', emoji: 'fuel-pump', cost: true },
  maintenance: { label: 'Maintenance & repairs', emoji: 'wrench', cost: true },
  fees: { label: 'Registration & fees', emoji: 'page-facing-up', cost: true },
  tolls_parking: { label: 'Tolls & parking', emoji: 'p-button', cost: true },
  other: { label: 'Other costs', emoji: 'receipt', cost: true },
};

/** Fixed display order, biggest structural costs first. */
export const COST_ORDER: CostKind[] = [
  'loan_interest',
  'payment',
  'insurance',
  'fuel',
  'maintenance',
  'fees',
  'tolls_parking',
  'other',
  'loan_principal',
];

/** Category → cost bucket. Ids come from `defaultCategories.ts`. */
const CATEGORY_KIND: Record<string, CostKind> = {
  'transportation.car_payment': 'payment',
  'transportation.car_lease': 'payment',
  'transportation.insurance': 'insurance',
  'housing.home_insurance': 'insurance',
  'housing.renters_insurance': 'insurance',
  'insurance.other': 'insurance',
  'transportation.gas': 'fuel',
  'transportation.ev_charging': 'fuel',
  'housing.utilities': 'fuel',
  'transportation.maintenance': 'maintenance',
  'transportation.repairs': 'maintenance',
  'transportation.tires': 'maintenance',
  'transportation.car_wash': 'maintenance',
  'transportation.roadside': 'maintenance',
  'housing.maintenance': 'maintenance',
  'housing.appliances': 'maintenance',
  'transportation.registration': 'fees',
  'transportation.inspection': 'fees',
  'transportation.tickets': 'fees',
  'housing.property_tax': 'fees',
  'housing.hoa': 'fees',
  'transportation.parking': 'tolls_parking',
  'transportation.tolls': 'tolls_parking',
};

export function costKindOf(categoryId: ID | undefined): CostKind {
  if (!categoryId) return 'other';
  return CATEGORY_KIND[categoryId] ?? 'other';
}

export interface CostLine {
  kind: CostKind;
  label: string;
  emoji: string;
  amount: Cents;
  /** Counts toward the cost of ownership (principal doesn't). */
  cost: boolean;
}

export interface OwnershipWindow {
  from: ISODate;
  to: ISODate;
  /** Length of the window in months; 12 for a full year. */
  months: number;
  /** Non-zero lines in `COST_ORDER`. */
  lines: CostLine[];
  loanInterest: Cents;
  loanPrincipal: Cents;
  /** Running costs and interest — money spent that is gone. */
  running: Cents;
  /** Everything that actually left your accounts, principal included. */
  cashOut: Cents;
  /** Value lost over the window; negative means it gained value. */
  depreciation: Cents;
  /** Running costs + depreciation. The real cost of owning it. */
  total: Cents;
  perMonth: Cents;
  perYear: Cents;
  /** Tagged transactions counted in the window. */
  transactions: number;
}

export interface OwnershipSummary {
  assetId: ID;
  name: string;
  expenseTag?: string;
  /** Latest recorded value at the end of the window. */
  value: Cents;
  purchasePrice?: Cents;
  loan?: { id: ID; name: string; balance: Cents };
  ownedFrom?: ISODate;
  ownedTo: ISODate;
  monthsOwned: number;
  last12: OwnershipWindow;
  sincePurchase: OwnershipWindow;
  /** Cost of ownership since purchase, per month owned. */
  perMonthOwned: Cents;
  /** False when nothing links costs to this asset yet (no tag, no loan). */
  hasData: boolean;
}

const DAYS_PER_MONTH = 30.4375;

/** Value recorded on or before `date`, falling back to the purchase price. */
export function valueOn(asset: Asset, date: ISODate): Cents | undefined {
  let best: { date: ISODate; value: Cents } | undefined;
  for (const v of asset.valuations) {
    if (v.date > date) continue;
    if (!best || v.date > best.date) best = v;
  }
  if (best) return best.value;
  if (asset.purchaseDate && asset.purchaseDate <= date && asset.purchasePrice !== undefined) return asset.purchasePrice;
  return undefined;
}

/** Value lost between two dates. Positive = depreciation, negative = gain. */
function depreciationBetween(asset: Asset, from: ISODate, to: ISODate): Cents {
  const end = valueOn(asset, to);
  if (end === undefined) return 0;
  // Before the window starts the asset may not exist yet; then the purchase price is the start.
  const start =
    valueOn(asset, from) ??
    (asset.purchaseDate && asset.purchaseDate >= from && asset.purchaseDate <= to ? asset.purchasePrice : undefined);
  if (start === undefined) return 0;
  return start - end;
}

function buildWindow(data: LedgerData, asset: Asset, from: ISODate, to: ISODate, months: number): OwnershipWindow {
  const index = indexLedger(data);
  const tag = asset.expenseTag;
  const loanId = asset.linkedLiabilityId;
  const totals = new Map<CostKind, Cents>();
  const add = (kind: CostKind, amount: Cents) => totals.set(kind, (totals.get(kind) ?? 0) + amount);

  let transactions = 0;
  if (tag) {
    for (const tx of data.transactions) {
      if (tx.date < from || tx.date > to) continue;
      if (!tx.tags.includes(tag)) continue;
      // Interest on the linked loan is counted from the loan itself.
      if (loanId && tx.accountId === loanId && tx.type === 'interest') continue;
      const lines = categoryLines(tx);
      if (!lines.length) continue;
      transactions++;
      for (const line of lines) add(costKindOf(line.categoryId), line.amount);
    }
  }

  let loanInterest = 0;
  let loanPrincipal = 0;
  if (loanId && index.accounts.has(loanId)) {
    const activity = debtActivity(index, loanId, from, to);
    loanInterest = activity.interest;
    loanPrincipal = activity.principal;
    if (loanInterest) add('loan_interest', loanInterest);
    if (loanPrincipal) add('loan_principal', loanPrincipal);
  }

  const lines: CostLine[] = COST_ORDER.filter((k) => (totals.get(k) ?? 0) !== 0).map((kind) => ({
    kind,
    label: COST_KINDS[kind].label,
    emoji: COST_KINDS[kind].emoji,
    amount: totals.get(kind)!,
    cost: COST_KINDS[kind].cost,
  }));

  const running = lines.filter((l) => l.cost).reduce((s, l) => s + l.amount, 0);
  const cashOut = running + loanPrincipal;
  const depreciation = depreciationBetween(asset, from, to);
  const total = running + depreciation;
  const perMonth = months > 0 ? Math.round(total / months) : total;

  return {
    from,
    to,
    months,
    lines,
    loanInterest,
    loanPrincipal,
    running,
    cashOut,
    depreciation,
    total,
    perMonth,
    // From the window itself, so a full year reads exactly as the year's total.
    perYear: months > 0 ? Math.round((total * 12) / months) : total,
    transactions,
  };
}

/** Cost of owning an asset over the last 12 months and since it was bought. */
export function ownershipCost(data: LedgerData, assetId: ID, today: ISODate): OwnershipSummary | null {
  const asset = data.assets.find((a) => a.id === assetId);
  if (!asset) return null;
  const index = indexLedger(data);

  const to = asset.soldDate && asset.soldDate < today ? asset.soldDate : today;
  const earliestValuation = asset.valuations.reduce<ISODate | undefined>((min, v) => (!min || v.date < min ? v.date : min), undefined);
  const ownedFrom = asset.purchaseDate ?? earliestValuation;

  // Last 12 months, clipped to the time actually owned.
  const yearStart = addDays(addMonths(to, -12), 1);
  const fullYear = !ownedFrom || ownedFrom <= yearStart;
  const recentFrom = fullYear ? yearStart : ownedFrom;
  const recentMonths = fullYear ? 12 : Math.max(1, (diffDays(recentFrom, to) + 1) / DAYS_PER_MONTH);

  const sinceFrom = ownedFrom ?? yearStart;
  const monthsOwned = Math.max(1, (diffDays(sinceFrom, to) + 1) / DAYS_PER_MONTH);

  const last12 = buildWindow(data, asset, recentFrom, to, recentMonths);
  const sincePurchase = buildWindow(data, asset, sinceFrom, to, monthsOwned);

  const loanAccount = asset.linkedLiabilityId ? index.accounts.get(asset.linkedLiabilityId) : undefined;

  return {
    assetId: asset.id,
    name: asset.name,
    expenseTag: asset.expenseTag,
    value: valueOn(asset, to) ?? 0,
    purchasePrice: asset.purchasePrice,
    loan: loanAccount ? { id: loanAccount.id, name: loanAccount.name, balance: balanceOn(index, loanAccount.id, to) } : undefined,
    ownedFrom,
    ownedTo: to,
    monthsOwned,
    last12,
    sincePurchase,
    perMonthOwned: Math.round(sincePurchase.total / monthsOwned),
    hasData: !!asset.expenseTag || !!loanAccount,
  };
}
