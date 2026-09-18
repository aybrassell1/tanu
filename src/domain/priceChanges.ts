import { addMonths, diffDays } from './dates';
import { spendingAmount } from './ledger';
import { annualEquivalent } from './recurrence';
import type { Cents, ID, ISODate, LedgerData, RecurringKind, SubscriptionUsage, Transaction } from './types';

/**
 * Price creep: what you pay now for something you already paid for before.
 *
 * Two kinds of subject are watched — recurring items (through the
 * transactions linked to them) and payees that charge you on a regular
 * rhythm. Both are measured from **real transactions only**; nothing here
 * reads the planned `RecurringItem.amount`, so an amount the user forgot to
 * update can never look like a price change.
 *
 * Two traps are handled explicitly:
 * - **Seasonality.** A utility bill is high in summer and low in winter.
 *   Comparing it with six months ago would report every August as a price
 *   rise. Variable items are therefore compared on rolling six-month medians
 *   against *the same six months a year earlier*, so the season cancels out.
 * - **One-off spikes.** A single odd charge (a setup fee, a double bill)
 *   never sets the current price: the current price is the median of the
 *   most recent run of similar charges, and a run of one is only trusted
 *   when the item is billed less often than quarterly.
 */

// ─── Tuning ──────────────────────────────────────────────────────────────────

export interface PriceChangeOptions {
  /** Smallest relative change worth reporting (fraction, default 2%). */
  minPercent?: number;
  /** Smallest absolute change worth reporting (default $1.00). */
  minCents?: number;
  /** Charges a payee needs before it counts as repeating (default 4). */
  minObservations?: number;
}

const DEFAULTS = { minPercent: 0.02, minCents: 100, minObservations: 4 };

/** Two charges count as "the same price" within this tolerance. */
const tolerance = (amount: Cents) => Math.max(50, Math.round(Math.abs(amount) * 0.02));

/** Nothing older than this counts as a live price. */
const STALE_MONTHS = 14;

// ─── Shapes ──────────────────────────────────────────────────────────────────

export interface PriceObservation {
  date: ISODate;
  amount: Cents;
  txId: ID;
}

/** How a comparison was measured, so the UI can say what it means. */
export type PriceBasis =
  /** Median of the latest run of similar charges vs the run at the cutoff. */
  | 'recent'
  /** Rolling 6-month medians, this year vs the same months last year. */
  | 'rolling';

export interface PriceComparison {
  /** How far back the baseline sits. */
  months: 6 | 12;
  basis: PriceBasis;
  from: Cents;
  to: Cents;
  change: Cents;
  /** Fraction, e.g. 0.18 for +18%. */
  percent: number;
  /** Extra (or saved) money per year at the new price. */
  yearly: Cents;
}

export interface PriceChange {
  /** Stable key: `recurring:<id>` or `payee:<normalized name>`. */
  key: string;
  subject: 'recurring' | 'payee';
  /** Recurring item id, when the subject is a recurring item. */
  sourceId?: ID;
  name: string;
  categoryId?: ID;
  kind?: RecurringKind;
  /** What it costs per charge today. */
  current: Cents;
  vs6Months: PriceComparison | null;
  vs12Months: PriceComparison | null;
  /** The comparison with the biggest yearly effect; drives sorting and copy. */
  headline: PriceComparison;
  direction: 'up' | 'down';
  /** Extra cost per year at the new price (negative when the price fell). */
  yearlyImpact: Cents;
  /** When the current price first appeared; null for variable bills. */
  changedOn: ISODate | null;
  /** Charges per year, used for the yearly figure. */
  perYear: number;
  /** The bill varies by nature (utilities), so medians are rolled. */
  variable: boolean;
  usage?: SubscriptionUsage;
  /** A subscription whose price rose while you marked it rarely/never used. */
  lowUsage: boolean;
  observations: number;
  latest: ISODate;
  history: PriceObservation[];
}

export interface PriceChangeReport {
  /** Price rises, biggest yearly effect first. */
  increases: PriceChange[];
  /** Price drops, biggest yearly saving first. */
  decreases: PriceChange[];
  /** Extra money per year across every rise. */
  yearlyIncrease: Cents;
  /** Money per year given back by the drops (positive number). */
  yearlyDecrease: Cents;
  /** Rises on subscriptions marked rarely or never used. */
  lowUsage: PriceChange[];
  /** Subjects that were looked at, whether or not anything changed. */
  watched: number;
}

/** Same shape as `FinanceAlert` in alerts.ts, so Home can show these later. */
export interface PriceChangeAlert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  icon: string;
  title: string;
  detail: string;
  href?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function normalizePayee(payee: string) {
  return payee.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The most recent stretch of charges that are all the same price, newest
 * first in `run[run.length - 1]`. A one-off spike ends up as a run of one.
 */
function latestRun(obs: PriceObservation[]): PriceObservation[] {
  if (!obs.length) return [];
  const last = obs[obs.length - 1];
  const tol = tolerance(last.amount);
  const run: PriceObservation[] = [];
  for (let i = obs.length - 1; i >= 0; i--) {
    if (Math.abs(obs[i].amount - last.amount) > tol) break;
    run.unshift(obs[i]);
  }
  return run;
}

const between = (obs: PriceObservation[], after: ISODate, to: ISODate) => obs.filter((o) => o.date > after && o.date <= to);

function gapsOf(obs: PriceObservation[]) {
  const gaps: number[] = [];
  for (let i = 1; i < obs.length; i++) gaps.push(diffDays(obs[i - 1].date, obs[i].date));
  return gaps;
}

// ─── Subjects ────────────────────────────────────────────────────────────────

interface Subject {
  key: string;
  subject: 'recurring' | 'payee';
  sourceId?: ID;
  name: string;
  categoryId?: ID;
  kind?: RecurringKind;
  variable: boolean;
  usage?: SubscriptionUsage;
  /** Known from the schedule; estimated from the gaps for payees. */
  perYear: number;
  obs: PriceObservation[];
}

const observationOf = (tx: Transaction): PriceObservation => ({ date: tx.date, amount: Math.abs(tx.amount), txId: tx.id });

/** Payments per year implied by a run of charges. */
function estimatePerYear(obs: PriceObservation[]) {
  const gaps = gapsOf(obs);
  if (!gaps.length) return 12;
  const gap = median(gaps);
  if (gap <= 0) return 12;
  return Math.min(52, Math.max(1, 365.2425 / gap));
}

/**
 * A payee only counts when it charges on a rhythm and at a steady price;
 * that keeps everyday shops (groceries, Amazon) out of the report.
 */
function isRepeatingPayee(obs: PriceObservation[], minObservations: number) {
  if (obs.length < minObservations) return false;
  if (diffDays(obs[0].date, obs[obs.length - 1].date) < 150) return false;
  if (new Set(obs.map((o) => o.date.slice(0, 7))).size < 4) return false;

  const gaps = gapsOf(obs);
  const gap = median(gaps);
  // Weekly-or-tighter payees are shopping habits, not subscriptions.
  if (gap < 21) return false;
  const regular = gaps.filter((g) => Math.abs(g - gap) <= gap * 0.4).length;
  if (regular / gaps.length < 0.7) return false;

  const amount = median(obs.map((o) => o.amount));
  if (amount <= 0) return false;
  const steady = obs.filter((o) => Math.abs(o.amount - amount) <= amount * 0.15).length;
  return steady / obs.length >= 0.6;
}

function collectSubjects(data: LedgerData, today: ISODate, minObservations: number): Subject[] {
  const byDate = (a: PriceObservation, b: PriceObservation) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const subjects: Subject[] = [];
  const claimed = new Set<string>();

  const linked = new Map<ID, PriceObservation[]>();
  const payees = new Map<string, { label: string; obs: PriceObservation[] }>();
  for (const tx of data.transactions) {
    if (tx.date > today || tx.amount <= 0) continue;
    if (tx.recurringId) {
      const list = linked.get(tx.recurringId);
      if (list) list.push(observationOf(tx));
      else linked.set(tx.recurringId, [observationOf(tx)]);
      continue;
    }
    // Only purchases set a price. Interest is derived from a balance and an
    // APR, so a falling loan-interest charge is not a price cut.
    if (tx.type !== 'expense' || spendingAmount(tx) <= 0) continue;
    const payee = tx.payee?.trim();
    if (!payee) continue;
    const key = normalizePayee(payee);
    const group = payees.get(key);
    if (group) group.obs.push(observationOf(tx));
    else payees.set(key, { label: payee, obs: [observationOf(tx)] });
  }

  for (const item of data.recurring) {
    // Claimed even when cancelled, so a stopped item never reappears as a payee.
    claimed.add(normalizePayee(item.name));
    if (item.payee) claimed.add(normalizePayee(item.payee));
    if (!item.active) continue;
    const obs = (linked.get(item.id) ?? []).sort(byDate);
    if (obs.length < 2) continue;
    subjects.push({
      key: `recurring:${item.id}`,
      subject: 'recurring',
      sourceId: item.id,
      name: item.name,
      categoryId: item.categoryId,
      kind: item.kind,
      variable: item.variable,
      usage: item.usage,
      perYear: annualEquivalent(10_000, item.frequency) / 10_000,
      obs,
    });
  }

  for (const [key, group] of payees) {
    if (claimed.has(key)) continue;
    const obs = group.obs.sort(byDate);
    if (!isRepeatingPayee(obs, minObservations)) continue;
    subjects.push({
      key: `payee:${key}`,
      subject: 'payee',
      name: group.label,
      variable: false,
      perYear: estimatePerYear(obs),
      obs,
    });
  }

  return subjects;
}

// ─── Comparison ──────────────────────────────────────────────────────────────

function compare(months: 6 | 12, basis: PriceBasis, from: Cents, to: Cents, perYear: number): PriceComparison {
  const change = to - from;
  return { months, basis, from, to, change, percent: from > 0 ? change / from : 0, yearly: Math.round(change * perYear) };
}

const significant = (c: PriceComparison, minPercent: number, minCents: number) =>
  Math.abs(c.change) >= minCents && Math.abs(c.percent) >= minPercent;

/** Fixed-price subject: the latest run of equal charges vs the run as of a cutoff. */
function fixedChange(s: Subject, today: ISODate) {
  const run = latestRun(s.obs);
  if (!run.length) return null;
  const current = median(run.map((o) => o.amount));
  const gap = median(gapsOf(s.obs));
  // A run of one is a spike unless the thing is billed less often than quarterly.
  const sustained = run.length >= 2 || (gap > 100 && s.obs.length >= 2) || s.perYear <= 4;
  if (!sustained) return null;

  const baseline = (months: 6 | 12): PriceComparison | null => {
    const cutoff = addMonths(today, -months);
    const before = s.obs.filter((o) => o.date <= cutoff);
    if (!before.length) return null;
    const from = median(latestRun(before).map((o) => o.amount));
    if (from <= 0) return null;
    return compare(months, 'recent', from, current, s.perYear);
  };

  return { current, vs6: baseline(6), vs12: baseline(12), changedOn: run[0].date };
}

/**
 * Variable subject: rolling six-month medians, this half-year against the
 * same half-year a year ago, so seasonality lands on both sides equally.
 */
function rollingChange(s: Subject, today: ISODate) {
  const recent = between(s.obs, addMonths(today, -6), today);
  if (recent.length < 2) return null;
  const current = median(recent.map((o) => o.amount));

  const priorYear = between(s.obs, addMonths(today, -18), addMonths(today, -12));
  if (priorYear.length < 2) return { current, vs6: null, vs12: null, changedOn: null };
  const from = median(priorYear.map((o) => o.amount));
  if (from <= 0) return { current, vs6: null, vs12: null, changedOn: null };
  return { current, vs6: null, vs12: compare(12, 'rolling', from, current, s.perYear), changedOn: null };
}

// ─── Report ──────────────────────────────────────────────────────────────────

export function detectPriceChanges(data: LedgerData, today: ISODate, options: PriceChangeOptions = {}): PriceChangeReport {
  const opts = { ...DEFAULTS, ...options };
  const subjects = collectSubjects(data, today, opts.minObservations);
  const stale = addMonths(today, -STALE_MONTHS);
  const changes: PriceChange[] = [];

  for (const s of subjects) {
    const latest = s.obs[s.obs.length - 1];
    if (!latest || latest.date < stale) continue;
    const measured = s.variable ? rollingChange(s, today) : fixedChange(s, today);
    if (!measured) continue;

    const vs6 = measured.vs6 && significant(measured.vs6, opts.minPercent, opts.minCents) ? measured.vs6 : null;
    const vs12 = measured.vs12 && significant(measured.vs12, opts.minPercent, opts.minCents) ? measured.vs12 : null;
    // Prefer whichever window shows the larger yearly effect; ties go to 12 months.
    const headline = !vs6 ? vs12 : !vs12 ? vs6 : Math.abs(vs12.yearly) >= Math.abs(vs6.yearly) ? vs12 : vs6;
    if (!headline) continue;

    const direction = headline.change > 0 ? 'up' : 'down';
    changes.push({
      key: s.key,
      subject: s.subject,
      sourceId: s.sourceId,
      name: s.name,
      categoryId: s.categoryId,
      kind: s.kind,
      current: measured.current,
      vs6Months: vs6,
      vs12Months: vs12,
      headline,
      direction,
      yearlyImpact: headline.yearly,
      changedOn: measured.changedOn,
      perYear: s.perYear,
      variable: s.variable,
      usage: s.usage,
      lowUsage: direction === 'up' && s.kind === 'subscription' && (s.usage === 'rarely' || s.usage === 'never'),
      observations: s.obs.length,
      latest: latest.date,
      history: s.obs,
    });
  }

  const increases = changes.filter((c) => c.direction === 'up').sort((a, b) => b.yearlyImpact - a.yearlyImpact);
  const decreases = changes.filter((c) => c.direction === 'down').sort((a, b) => a.yearlyImpact - b.yearlyImpact);
  return {
    increases,
    decreases,
    yearlyIncrease: increases.reduce((t, c) => t + c.yearlyImpact, 0),
    yearlyDecrease: decreases.reduce((t, c) => t - c.yearlyImpact, 0),
    lowUsage: increases.filter((c) => c.lowUsage),
    watched: subjects.length,
  };
}

/** Plain-language summary of one change, e.g. "$9.99 → $12.99 (+30%) since Mar 4". */
export function priceChangePhrase(change: PriceChange, money: (cents: Cents) => string) {
  const c = change.headline;
  const pct = `${c.change > 0 ? '+' : '−'}${Math.abs(Math.round(c.percent * 100))}%`;
  const window = c.months === 12 ? 'a year ago' : '6 months ago';
  const basis = c.basis === 'rolling' ? ' (typical bill, season for season)' : '';
  return `${money(c.from)} → ${money(c.to)} (${pct}) vs ${window}${basis}`;
}

/** Ready-made alerts so Home can surface price creep without new maths. */
export function priceChangeAlerts(report: PriceChangeReport, money: (cents: Cents) => string): PriceChangeAlert[] {
  const alerts: PriceChangeAlert[] = [];
  for (const c of report.lowUsage) {
    alerts.push({
      id: `price:usage:${c.key}`,
      severity: 'warning',
      icon: 'trending-up',
      title: `${c.name} costs more and you rarely use it`,
      detail: `${priceChangePhrase(c, money)} · ${money(c.yearlyImpact)} more a year.`,
      href: '/subscriptions',
    });
  }
  const rest = report.increases.filter((c) => !c.lowUsage);
  if (rest.length) {
    const top = rest[0];
    alerts.push({
      id: 'price:increases',
      severity: 'info',
      icon: 'trending-up',
      title: rest.length === 1 ? `${top.name} went up` : `${rest.length} prices went up`,
      detail:
        rest.length === 1
          ? `${priceChangePhrase(top, money)} · ${money(report.yearlyIncrease)} more a year.`
          : `Led by ${top.name} · ${money(report.yearlyIncrease)} more a year in total.`,
      href: '/subscriptions',
    });
  }
  return alerts;
}
