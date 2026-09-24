/**
 * Bills and subscriptions you are already paying, found in what you actually
 * spent.
 *
 * Nothing expected shows up in the forecast, in what's left to spend, or on the
 * bills screen until it is tracked, and typing them all in is the dullest part
 * of setting this up. So the same charge arriving on a steady rhythm is offered
 * back: "Spotify, $9.99, monthly since March — track it?"
 *
 * This only ever suggests. Tracking one is the user's tap, through the normal
 * bill form, with the fields filled in.
 */

import { addDays, diffDays } from './dates';
import { merchantKey } from './merchantText';
import { monthlyEquivalent } from './recurrence';
import type { Cents, Frequency, ID, ISODate, LedgerData, Transaction } from './types';

/** Fewer charges than this is a coincidence, not a rhythm. */
const MIN_CHARGES = 3;
/** This share of the gaps has to match the rhythm. */
const MIN_CONSISTENCY = 0.6;
/** Beyond this spread the amount is treated as variable, like a power bill. */
const VARIANCE = 0.15;

type Shape = { frequency: Frequency; days: number; tolerance: number };

/**
 * The rhythms worth recognising, longest tolerance where real life is loosest:
 * monthly bills land anywhere from 28 to 31 days apart, and a yearly renewal
 * can drift by a fortnight.
 */
const SHAPES: Shape[] = [
  { frequency: { unit: 'week', interval: 1 }, days: 7, tolerance: 2 },
  { frequency: { unit: 'week', interval: 2 }, days: 14, tolerance: 3 },
  { frequency: { unit: 'month', interval: 1 }, days: 30.4, tolerance: 5 },
  { frequency: { unit: 'month', interval: 2 }, days: 60.9, tolerance: 8 },
  { frequency: { unit: 'month', interval: 3 }, days: 91.3, tolerance: 12 },
  { frequency: { unit: 'month', interval: 6 }, days: 182.6, tolerance: 20 },
  { frequency: { unit: 'year', interval: 1 }, days: 365.2, tolerance: 30 },
];

export interface RecurringCandidate {
  /** Merchant fingerprint; stable across the spellings a bank uses. */
  key: string;
  /** The merchant as you last wrote it. */
  name: string;
  /** What this would be tracked as. A guess the user can change. */
  kind: 'bill' | 'subscription';
  frequency: Frequency;
  /** The middle of what you have paid. */
  amount: Cents;
  monthly: Cents;
  /** True when the charge moves around, like a utility bill. */
  variable: boolean;
  accountId: ID;
  categoryId?: ID;
  essential: boolean;
  /** How many charges back this up, and how steady they were (0–1). */
  charges: number;
  consistency: number;
  firstDate: ISODate;
  lastDate: ISODate;
  /** When the next one is due, counting from the last charge. */
  nextDate: ISODate;
  /** `lapsed` means the next one is well overdue — cancelled, or missed. */
  status: 'active' | 'lapsed';
}

export interface DetectOptions {
  /** Ignore merchants already tracked, matched by name. Default true. */
  skipTracked?: boolean;
  /** Merchant fingerprints the user has dismissed. Defaults to the setting. */
  ignore?: string[];
}

/**
 * Steady, repeated charges that aren't tracked yet, strongest rhythm first.
 * Pure: it reads the ledger and writes nothing.
 */
export function detectRecurring(data: LedgerData, today: ISODate, options: DetectOptions = {}): RecurringCandidate[] {
  const { skipTracked = true, ignore = data.settings.ignoredRecurring ?? [] } = options;
  const tracked = skipTracked ? trackedKeys(data) : new Set<string>();
  const dismissed = new Set(ignore);
  const out: RecurringCandidate[] = [];

  for (const [key, charges] of chargesByMerchant(data)) {
    if (tracked.has(key) || dismissed.has(key)) continue;
    if (charges.length < MIN_CHARGES) continue;

    const dates = charges.map((t) => t.date);
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) gaps.push(diffDays(dates[i - 1], dates[i]));
    const shape = matchShape(gaps);
    if (!shape) continue;

    const amounts = charges.map((t) => t.amount);
    const amount = median(amounts);
    if (amount <= 0) continue;
    const spread = (Math.max(...amounts) - Math.min(...amounts)) / amount;

    const lastDate = dates[dates.length - 1];
    const nextDate = addDays(lastDate, Math.round(shape.days));
    const latest = charges[charges.length - 1];
    const category = latest.categoryId ? data.categories.find((c) => c.id === latest.categoryId) : undefined;
    const parent = category?.parentId ?? category?.id;

    out.push({
      key,
      name: label(latest),
      // Only what you filed as a subscription is one. Rent is steady and
      // monthly too, and calling it a subscription reads as a mistake.
      kind: parent === 'subscriptions' ? 'subscription' : 'bill',
      frequency: shape.frequency,
      amount,
      monthly: monthlyEquivalent(amount, shape.frequency),
      variable: spread > VARIANCE,
      accountId: commonest(charges.map((t) => t.accountId)) ?? latest.accountId,
      categoryId: commonest(charges.map((t) => t.categoryId).filter((id): id is ID => !!id)),
      essential: charges.filter((t) => t.essential === true).length * 2 >= charges.length,
      charges: charges.length,
      consistency: shape.consistency,
      firstDate: dates[0],
      // A charge that never came back isn't due again; it lapsed.
      lastDate,
      nextDate,
      status: diffDays(nextDate, today) > shape.days * 0.5 ? 'lapsed' : 'active',
    });
  }

  // Biggest first: an untracked $60 a month matters more than an untracked $4.
  return out.sort((a, b) => b.monthly - a.monthly || b.charges - a.charges);
}

/** What tracking all of these would add to the monthly picture. */
export function candidateTotals(candidates: RecurringCandidate[]): { count: number; monthly: Cents; active: number } {
  const active = candidates.filter((c) => c.status === 'active');
  return { count: candidates.length, monthly: active.reduce((sum, c) => sum + c.monthly, 0), active: active.length };
}

const label = (t: Transaction) => (t.payee || t.description || '').trim();

/**
 * Spending by merchant, oldest first, one charge per day. Anything already
 * linked to a recurring item is left out — it is tracked by definition.
 */
function chargesByMerchant(data: LedgerData): Map<string, Transaction[]> {
  const byKey = new Map<string, Transaction[]>();
  for (const t of data.transactions) {
    if (t.type !== 'expense') continue;
    if (t.recurringId) continue;
    const key = merchantKey(label(t));
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(t);
    byKey.set(key, list);
  }
  for (const [key, list] of byKey) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    // Two charges on one day are a split purchase or a double tap, not a rhythm.
    byKey.set(key, list.filter((t, i) => i === 0 || t.date !== list[i - 1].date));
  }
  return byKey;
}

/** Merchants that already have a recurring item, by the same fingerprint. */
function trackedKeys(data: LedgerData): Set<string> {
  const keys = new Set<string>();
  for (const r of data.recurring) {
    for (const text of [r.payee, r.name]) {
      const key = merchantKey(text ?? '');
      if (key) keys.add(key);
    }
  }
  return keys;
}

/** The rhythm the gaps fit, if they fit one at all. */
function matchShape(gaps: number[]): (Shape & { consistency: number }) | null {
  if (gaps.length === 0) return null;
  const typical = median(gaps);
  let best: (Shape & { consistency: number }) | null = null;
  for (const shape of SHAPES) {
    if (Math.abs(typical - shape.days) > shape.tolerance) continue;
    const matching = gaps.filter((g) => Math.abs(g - shape.days) <= shape.tolerance).length;
    const consistency = matching / gaps.length;
    if (consistency < MIN_CONSISTENCY) continue;
    if (!best || consistency > best.consistency) best = { ...shape, consistency };
  }
  return best;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function commonest<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | undefined;
  let top = 0;
  for (const [v, n] of counts) {
    if (n > top) {
      top = n;
      best = v;
    }
  }
  return best;
}
