import { accountNature, isInvestment } from './catalog';
import { addDays, dayOfWeek, diffDays, formatDate, formatMonth, minDate, monthEnd, monthOf } from './dates';
import { balanceOn, categoryLines, indexLedger, spendingAmount } from './ledger';
import { formatMoney, sum } from './money';
import { baselineBalance, netWorthChange, periodHasData, trackedDays as trackedDaysIn } from './position';
import { normalizePayee } from './priceChanges';
import { periodStats, type Amounts, type PeriodStats } from './reports';
import type { Cents, Goal, ID, ISODate, ISOMonth, LedgerData, Transaction } from './types';

/**
 * The year in one page: totals, extremes and a few true-but-fun facts, all
 * derived from the same rules the rest of the app uses (`periodStats` for
 * income and spending, `netWorthChange` for the balance sheet, `savingsRate`
 * for what was kept — here measured over the calendar year).
 *
 * Two things keep the page honest about time:
 *   · Per-day figures (no-spend days, the daily average) count only the days
 *     that were actually tracked, so a ledger started in September never
 *     reports 365 days of behaviour.
 *   · The previous year is compared over a span of the same length, and only
 *     when that span was tracked for a comparable stretch.
 */

export interface YearMonth {
  month: ISOMonth;
  label: string;
  income: Cents;
  spending: Cents;
  saved: Cents;
}

export interface MerchantSpend {
  key: string;
  label: string;
  amount: Cents;
  count: number;
}

export interface YearFact {
  key: string;
  icon: string;
  label: string;
  value: string;
  detail?: string;
}

export interface YearReview {
  year: number;
  from: ISODate;
  to: ISODate;
  /** The year isn't over yet (or ends today). */
  isPartial: boolean;
  /** First day of the year that was actually tracked (`from` when it all was). */
  trackedFrom: ISODate;
  /** Days between `trackedFrom` and `to`; the denominator for anything per-day. */
  trackedDays: number;
  /** True when every day of `from`…`to` was tracked. */
  fullyTracked: boolean;
  stats: PeriodStats;
  /** The previous year over a span of the same length; null when nothing was tracked then. */
  previous: PeriodStats | null;
  previousYear: number;
  /** The span of the previous year `previous` covers; null when there is none. */
  previousSpan: { from: ISODate; to: ISODate } | null;
  /** Days of that span that were tracked. */
  previousTrackedDays: number;
  /** True when both spans were tracked for long enough that comparing them means something. */
  comparable: boolean;
  months: YearMonth[];
  netWorth: { start: Cents; end: Cents; change: Cents };
  /** Root spending categories, biggest first. */
  topCategories: Amounts[];
  /** The eight biggest; `merchantCount` is how many there were in total. */
  topMerchants: MerchantSpend[];
  merchantCount: number;
  /** Month that kept the most (and the least) of what came in. */
  bestMonth: YearMonth | null;
  worstMonth: YearMonth | null;
  biggestPurchase: Transaction | null;
  transactionCount: number;
  subscriptions: { count: number; total: Cents; items: MerchantSpend[] };
  debt: { start: Cents; end: Cents; paidDown: Cents; interest: Cents };
  investments: { start: Cents; end: Cents; contributions: Cents };
  goalsCompleted: Goal[];
  facts: YearFact[];
  /** False when the year has nothing in it. */
  hasData: boolean;
}

// ─── Years ───────────────────────────────────────────────────────────────────

/**
 * Years that have transactions in them, newest first. Opening balances and
 * asset valuations are deliberately ignored: a year with nothing recorded in
 * it has no review to show.
 */
export function yearsWithData(data: LedgerData): number[] {
  const years = new Set<number>();
  for (const tx of data.transactions) years.add(Number(tx.date.slice(0, 4)));
  return [...years].filter((y) => Number.isFinite(y)).sort((a, b) => b - a);
}

// ─── Review ──────────────────────────────────────────────────────────────────

const yearStart = (year: number): ISODate => `${year}-01-01`;
const yearEnd = (year: number): ISODate => `${year}-12-31`;

/**
 * Comparing a part-year against a whole one is meaningless, so the earlier
 * year is cut to the same number of days — and only used at all when it was
 * tracked for at least this share of them.
 */
const COMPARABLE_SHARE = 0.9;

export function yearReview(data: LedgerData, year: number, today: ISODate): YearReview {
  const index = indexLedger(data);
  const from = yearStart(year);
  const to = minDate(yearEnd(year), today);
  const before = addDays(from, -1);
  const stats = periodStats(data, from, to);

  // Only the tracked part of the year can be reasoned about per day.
  const spanDays = diffDays(from, to) + 1;
  const trackedDays = trackedDaysIn(data, from, to);
  const trackedFrom = trackedDays > 0 && trackedDays < spanDays ? addDays(to, -(trackedDays - 1)) : from;
  const fullyTracked = trackedDays >= spanDays;

  // Like for like: the same number of days of the previous year.
  const previousYear = year - 1;
  const previousFrom = yearStart(previousYear);
  const previousTo = minDate(addDays(previousFrom, spanDays - 1), yearEnd(previousYear));
  const hasPrevious = periodHasData(data, previousFrom, previousTo);
  const previous = hasPrevious ? periodStats(data, previousFrom, previousTo) : null;
  const previousTrackedDays = trackedDaysIn(data, previousFrom, previousTo);
  const comparable = !!previous && previousTrackedDays >= Math.round(trackedDays * COMPARABLE_SHARE);

  const months: YearMonth[] = [];
  for (let m = 1; m <= 12; m++) {
    const month = `${year}-${String(m).padStart(2, '0')}`;
    if (month > monthOf(to)) break;
    const s = periodStats(data, `${month}-01`, minDate(monthEnd(month), to));
    months.push({ month, label: formatMonth(month, 'short'), income: s.income, spending: s.spending, saved: s.saved });
  }

  // Merchants: a payee's real spending, refunds netted off.
  const merchants = new Map<string, MerchantSpend>();
  const subscriptionItems = new Map<string, MerchantSpend>();
  const subscriptionIds = new Set(data.recurring.filter((r) => r.kind === 'subscription').map((r) => r.id));
  const recurringName = new Map(data.recurring.map((r) => [r.id, r.name]));
  let biggestPurchase: Transaction | null = null;
  const spendingDays = new Map<ISODate, Cents>();
  const weekdayTotals = new Array(7).fill(0) as Cents[];
  const weekdayCounts = new Array(7).fill(0) as number[];

  for (const tx of data.transactions) {
    if (tx.date < from || tx.date > to) continue;
    const spend = spendingAmount(tx);
    if (spend === 0) continue;

    // Interest is charged by a balance, not bought from a merchant.
    const payee = tx.type === 'interest' ? '' : tx.payee?.trim() || tx.description.trim();
    if (payee) {
      const key = normalizePayee(payee);
      const entry = merchants.get(key) ?? { key, label: payee, amount: 0, count: 0 };
      entry.amount += spend;
      if (spend > 0) entry.count += 1;
      merchants.set(key, entry);
    }

    if (tx.recurringId && subscriptionIds.has(tx.recurringId)) {
      const key = tx.recurringId;
      const entry = subscriptionItems.get(key) ?? { key, label: recurringName.get(key) ?? payee, amount: 0, count: 0 };
      entry.amount += spend;
      entry.count += 1;
      subscriptionItems.set(key, entry);
    }

    if (tx.type === 'expense' && (!biggestPurchase || tx.amount > biggestPurchase.amount)) biggestPurchase = tx;

    if (spend > 0) {
      spendingDays.set(tx.date, (spendingDays.get(tx.date) ?? 0) + spend);
      const dow = dayOfWeek(tx.date);
      weekdayTotals[dow] += spend;
      weekdayCounts[dow] += 1;
    }
  }

  // Debt and investments, with accounts opened mid-year starting from their
  // opening balance so the opening balance never reads as change.
  let debtStart = 0;
  let debtEnd = 0;
  let investStart = 0;
  let investEnd = 0;
  for (const account of data.accounts) {
    const start = baselineBalance(index, account, before, to);
    const end = balanceOn(index, account.id, to);
    if (accountNature(account.type) === 'liability') {
      debtStart += start;
      debtEnd += end;
    } else if (isInvestment(account.type)) {
      investStart += start;
      investEnd += end;
    }
  }

  const nw = netWorthChange(data, before, to);
  const goalsCompleted = data.goals.filter((g) => g.completedAt && g.completedAt >= from && g.completedAt <= to);
  const topMerchants = [...merchants.values()].filter((m) => m.amount > 0).sort((a, b) => b.amount - a.amount);
  const withSpending = months.filter((m) => m.income > 0 || m.spending > 0);

  const review: YearReview = {
    year,
    from,
    to,
    isPartial: to < yearEnd(year),
    trackedFrom,
    trackedDays,
    fullyTracked,
    stats,
    previous,
    previousYear,
    previousSpan: previous ? { from: previousFrom, to: previousTo } : null,
    previousTrackedDays,
    comparable,
    months,
    netWorth: { start: nw.start, end: nw.end, change: nw.change },
    topCategories: stats.byCategory.map((c) => ({ key: c.key, label: c.label, amount: c.amount, color: c.color })),
    topMerchants: topMerchants.slice(0, 8),
    merchantCount: topMerchants.length,
    // A single active month is both the best and the worst; showing it twice says nothing.
    bestMonth: withSpending.length > 1 ? withSpending.reduce((a, b) => (b.saved > a.saved ? b : a)) : null,
    worstMonth: withSpending.length > 1 ? withSpending.reduce((a, b) => (b.saved < a.saved ? b : a)) : null,
    biggestPurchase,
    transactionCount: stats.transactionCount,
    subscriptions: {
      count: subscriptionItems.size,
      total: sum([...subscriptionItems.values()].map((s) => s.amount)),
      items: [...subscriptionItems.values()].sort((a, b) => b.amount - a.amount),
    },
    debt: { start: debtStart, end: debtEnd, paidDown: debtStart - debtEnd, interest: stats.interestCharged },
    investments: { start: investStart, end: investEnd, contributions: stats.investmentContributions },
    goalsCompleted,
    facts: [],
    hasData: stats.transactionCount > 0,
  };

  review.facts = buildFacts(review, {
    merchants: topMerchants,
    weekdayTotals,
    weekdayCounts,
    spendingDays,
    categories: stats.byCategory.length,
    currency: data.settings.currency,
  });
  return review;
}

// ─── Fun but true ────────────────────────────────────────────────────────────

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface FactInput {
  merchants: MerchantSpend[];
  weekdayTotals: Cents[];
  weekdayCounts: number[];
  spendingDays: Map<ISODate, Cents>;
  categories: number;
  currency: string;
}

function buildFacts(review: YearReview, input: FactInput): YearFact[] {
  const money = (cents: Cents) => formatMoney(cents, { currency: input.currency, whole: true });
  const facts: YearFact[] = [];

  const frequent = [...input.merchants].sort((a, b) => b.count - a.count || b.amount - a.amount)[0];
  if (frequent && frequent.count > 1) {
    facts.push({
      key: 'frequent-merchant',
      icon: 'repeat',
      label: 'Most visited',
      value: frequent.label,
      detail: `${frequent.count} purchases · ${money(frequent.amount)}`,
    });
  }

  const busiest = input.weekdayTotals.reduce((best, total, i) => (total > input.weekdayTotals[best] ? i : best), 0);
  if (input.weekdayTotals[busiest] > 0) {
    facts.push({
      key: 'busiest-day',
      icon: 'calendar',
      label: 'Busiest spending day',
      value: WEEKDAY_NAMES[busiest],
      detail: `${money(input.weekdayTotals[busiest])} across ${input.weekdayCounts[busiest]} purchases`,
    });
  }

  let priciestDay: { date: ISODate; amount: Cents } | null = null;
  for (const [date, amount] of input.spendingDays) if (!priciestDay || amount > priciestDay.amount) priciestDay = { date, amount };
  if (priciestDay) {
    facts.push({
      key: 'priciest-day',
      icon: 'trending-up',
      label: 'Priciest single day',
      value: money(priciestDay.amount),
      detail: formatDate(priciestDay.date, 'medium'),
    });
  }

  // Per-day facts count tracked days only: a ledger started in September has
  // no idea whether January was a no-spend day.
  const days = review.months.length ? review.trackedDays : 0;
  if (days > 0) {
    const noSpend = days - input.spendingDays.size;
    facts.push({
      key: 'no-spend',
      icon: 'moon',
      label: 'No-spend days',
      value: String(Math.max(0, noSpend)),
      detail: `out of ${days} days${review.fullyTracked ? '' : ' tracked'}`,
    });
    facts.push({
      key: 'daily-average',
      icon: 'activity',
      label: 'Average day',
      value: money(Math.round(review.stats.spending / days)),
      detail: `spent per ${review.fullyTracked ? 'day' : 'tracked day'}`,
    });
  }

  if (input.merchants.length) {
    facts.push({
      key: 'merchant-count',
      icon: 'shopping-bag',
      label: 'Places you paid',
      value: String(input.merchants.length),
      detail: `across ${input.categories} categor${input.categories === 1 ? 'y' : 'ies'}`,
    });
  }

  return facts;
}

/**
 * A month that still kept money is not "tough", it is just the leanest one, so
 * the label follows the sign instead of the ranking.
 */
export function leanMonthLabel(month: YearMonth): { label: string; caption: string } {
  return month.saved < 0 ? { label: 'Toughest month', caption: 'spent more than came in' } : { label: 'Leanest month', caption: 'kept the least' };
}

// ─── Share / export ──────────────────────────────────────────────────────────

/** Plain-text summary for the share sheet. Numbers only; no judgements. */
export function yearReviewText(review: YearReview, currency = 'USD'): string {
  const money = (cents: Cents) => formatMoney(cents, { currency, whole: true });
  const pct = (ratio: number) => (Number.isFinite(ratio) ? `${Math.round(ratio * 100)}%` : '—');
  const lines: string[] = [];
  lines.push(`${review.year} in review${review.isPartial ? ' (year to date)' : ''}`);
  lines.push('='.repeat(24));
  if (!review.fullyTracked) lines.push(`Tracked from ${review.trackedFrom} (${review.trackedDays} days)`);
  lines.push('');
  lines.push(`Income            ${money(review.stats.income)}`);
  lines.push(`Spending          ${money(review.stats.spending)}`);
  lines.push(`Saved             ${money(review.stats.saved)} (${pct(review.stats.savingsRate)} of income)`);
  lines.push(`Net worth change  ${money(review.netWorth.change)}`);
  lines.push(`Transactions      ${review.transactionCount}`);
  lines.push('');

  if (review.topCategories.length) {
    lines.push('Biggest categories');
    for (const c of review.topCategories.slice(0, 5)) lines.push(`  ${c.label}: ${money(c.amount)}`);
    lines.push('');
  }
  if (review.topMerchants.length) {
    lines.push('Biggest merchants');
    for (const m of review.topMerchants.slice(0, 5)) lines.push(`  ${m.label}: ${money(m.amount)} (${m.count})`);
    lines.push('');
  }
  if (review.bestMonth && review.worstMonth) {
    lines.push(`Best month        ${review.bestMonth.label} (${money(review.bestMonth.saved)} kept)`);
    lines.push(`${leanMonthLabel(review.worstMonth).label.padEnd(18)}${review.worstMonth.label} (${money(review.worstMonth.saved)} kept)`);
  }
  if (review.biggestPurchase) {
    lines.push(`Biggest purchase  ${money(review.biggestPurchase.amount)} · ${review.biggestPurchase.payee || review.biggestPurchase.description}`);
  }
  if (review.subscriptions.count) {
    lines.push(`Subscriptions     ${review.subscriptions.count} paid, ${money(review.subscriptions.total)} total`);
  }
  lines.push(`Debt paid down    ${money(review.debt.paidDown)}`);
  lines.push(`Interest charged  ${money(review.debt.interest)}`);
  lines.push(`Invested          ${money(review.investments.contributions)}`);
  if (review.goalsCompleted.length) lines.push(`Goals completed   ${review.goalsCompleted.map((g) => g.name).join(', ')}`);
  lines.push('');

  if (review.facts.length) {
    lines.push('Fun but true');
    for (const f of review.facts) lines.push(`  ${f.label}: ${f.value}${f.detail ? ` — ${f.detail}` : ''}`);
    lines.push('');
  }
  if (review.previous) {
    lines.push(`Versus ${review.previousYear}${review.isPartial ? ' (same span)' : ''}`);
    if (!review.comparable) lines.push(`  Only ${review.previousTrackedDays} of those days were tracked, so this is not like for like.`);
    lines.push(`  Income:   ${money(review.previous.income)} → ${money(review.stats.income)}`);
    lines.push(`  Spending: ${money(review.previous.spending)} → ${money(review.stats.spending)}`);
    lines.push(`  Saved:    ${money(review.previous.saved)} → ${money(review.stats.saved)}`);
  }
  return lines.join('\n');
}

/** Category lines for a year, used by the share text and the category bars. */
export function yearCategoryTotals(data: LedgerData, year: number, today: ISODate): Amounts[] {
  const to = minDate(yearEnd(year), today);
  const totals = new Map<ID, Cents>();
  for (const tx of data.transactions) {
    if (tx.date < yearStart(year) || tx.date > to) continue;
    for (const line of categoryLines(tx)) {
      const key = line.categoryId ?? 'uncategorized';
      totals.set(key, (totals.get(key) ?? 0) + line.amount);
    }
  }
  const index = indexLedger(data);
  return [...totals.entries()]
    .map(([key, amount]) => ({ key, label: index.categories.get(key)?.name ?? 'Uncategorized', amount, color: index.categories.get(key)?.color }))
    .sort((a, b) => b.amount - a.amount);
}
