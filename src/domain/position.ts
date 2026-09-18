import { accountGroup, accountNature, isCreditCard } from './catalog';
import { addDays, diffDays, monthEnd, minDate } from './dates';
import { balanceOn, balanceSeries, indexLedger, postingsFor, signedBalance, type LedgerIndex } from './ledger';
import { sum } from './money';
import { nextPayday, openEvents, type ScheduledEvent } from './schedule';
import { reservedIn } from './sinking';
import type { Account, Asset, Cents, ID, ISODate, ISOMonth, LedgerData, Transaction } from './types';

/**
 * "Where is my money?" — balances, net worth and the own / owe / committed /
 * available split shown on the dashboard.
 */

export interface AccountBalance {
  account: Account;
  /** Natural terms: assets owned, liabilities owed. */
  balance: Cents;
}

export function accountBalances(data: LedgerData, date: ISODate, includeArchived = false): AccountBalance[] {
  const index = indexLedger(data);
  return data.accounts
    .filter((a) => includeArchived || !a.archived)
    .map((account) => ({ account, balance: balanceOn(index, account.id, date) }));
}

export function assetValueOn(asset: Asset, date: ISODate): Cents {
  if (asset.soldDate && asset.soldDate <= date) return 0;
  if (asset.purchaseDate && asset.purchaseDate > date) return 0;
  let value: Cents | null = null;
  let latest = '';
  for (const v of asset.valuations) {
    if (v.date <= date && v.date >= latest) {
      latest = v.date;
      value = v.value;
    }
  }
  return value ?? 0;
}

export interface NetWorthBreakdown {
  cash: Cents;
  savings: Cents;
  investments: Cents;
  otherAccountAssets: Cents;
  physicalAssets: Cents;
  creditCards: Cents;
  loans: Cents;
  otherLiabilities: Cents;
}

export interface NetWorth {
  assets: Cents;
  liabilities: Cents;
  netWorth: Cents;
  breakdown: NetWorthBreakdown;
}

function emptyBreakdown(): NetWorthBreakdown {
  return { cash: 0, savings: 0, investments: 0, otherAccountAssets: 0, physicalAssets: 0, creditCards: 0, loans: 0, otherLiabilities: 0 };
}

function addToBreakdown(b: NetWorthBreakdown, account: Account, balance: Cents) {
  switch (accountGroup(account.type)) {
    case 'cash':
      b.cash += balance;
      break;
    case 'savings':
      b.savings += balance;
      break;
    case 'investment':
      b.investments += balance;
      break;
    case 'other_asset':
      b.otherAccountAssets += balance;
      break;
    case 'credit':
      b.creditCards += balance;
      break;
    case 'loan':
      b.loans += balance;
      break;
    case 'other_liability':
      b.otherLiabilities += balance;
      break;
  }
}

function finish(b: NetWorthBreakdown): NetWorth {
  const assets = b.cash + b.savings + b.investments + b.otherAccountAssets + b.physicalAssets;
  const liabilities = b.creditCards + b.loans + b.otherLiabilities;
  return { assets, liabilities, netWorth: assets - liabilities, breakdown: b };
}

/** Net worth includes archived accounts so history stays correct after archiving. */
export function netWorthOn(data: LedgerData, date: ISODate): NetWorth {
  const index = indexLedger(data);
  const b = emptyBreakdown();
  for (const account of data.accounts) addToBreakdown(b, account, balanceOn(index, account.id, date));
  b.physicalAssets = sum(data.assets.map((a) => assetValueOn(a, date)));
  return finish(b);
}

export function netWorthSeries(data: LedgerData, dates: ISODate[]): (NetWorth & { date: ISODate })[] {
  const index = indexLedger(data);
  const breakdowns = dates.map(() => emptyBreakdown());
  for (const account of data.accounts) {
    balanceSeries(index, account.id, dates).forEach((balance, i) => addToBreakdown(breakdowns[i], account, balance));
  }
  return dates.map((date, i) => {
    breakdowns[i].physicalAssets = sum(data.assets.map((a) => assetValueOn(a, date)));
    return { date, ...finish(breakdowns[i]) };
  });
}

/** Month-end dates for the given months, with the current month ending today. */
export function monthEndDates(months: ISOMonth[], today: ISODate): ISODate[] {
  return months.map((m) => minDate(monthEnd(m), today));
}

/** Earliest date anything was recorded, for bounding history charts. */
export function ledgerStartDate(data: LedgerData): ISODate | null {
  const dates = [
    ...data.accounts.map((a) => a.startingDate),
    ...data.assets.flatMap((a) => a.valuations.map((v) => v.date)),
  ];
  return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
}

/**
 * Earliest date the user was actually keeping books: the first transaction, or
 * the day an account was opened with a starting balance.
 *
 * Deliberately different from `ledgerStartDate`, which also looks at asset
 * valuations so history charts can start at the oldest known value. A car
 * bought in 2021 says nothing about 2021's money, so it must never make an
 * untracked year look like a year worth comparing against.
 */
export function trackingStartDate(data: LedgerData): ISODate | null {
  let earliest: ISODate | null = null;
  const consider = (date: ISODate | undefined) => {
    if (date && (earliest === null || date < earliest)) earliest = date;
  };
  for (const account of data.accounts) consider(account.startingDate);
  for (const tx of data.transactions) consider(tx.date);
  return earliest;
}

/** Days of [from, to] that fall on or after tracking began. */
export function trackedDays(data: LedgerData, from: ISODate, to: ISODate): number {
  if (to < from) return 0;
  const start = trackingStartDate(data);
  if (!start || start > to) return 0;
  return diffDays(start > from ? start : from, to) + 1;
}

/**
 * True when money was being tracked during [from, to]: bookkeeping had already
 * started by `from`, or something was recorded inside the period. Used to avoid
 * comparing against periods from before the ledger started.
 */
export function periodHasData(data: LedgerData, from: ISODate, to: ISODate): boolean {
  const start = trackingStartDate(data);
  if (!start || start > to) return false;
  return start <= from || data.transactions.some((t) => t.date >= from && t.date <= to);
}

/**
 * Baseline balance of an account for change measured from the end of `before`
 * to the end of `end`. An account opened in between starts from its opening
 * balance, so that balance never counts as change.
 */
export function baselineBalance(index: LedgerIndex, account: Account, before: ISODate, end: ISODate): Cents {
  if (account.startingDate > end) return 0;
  if (account.startingDate > before) return account.startingBalance;
  return balanceOn(index, account.id, before);
}

function assetFirstValue(asset: Asset): { date: ISODate; value: Cents } | null {
  let first: { date: ISODate; value: Cents } | null = null;
  for (const v of asset.valuations) if (!first || v.date < first.date) first = { date: v.date, value: v.value };
  return first;
}

/** Baseline value of a physical asset, counting its first known value as the starting point. */
export function baselineAssetValue(asset: Asset, before: ISODate, end: ISODate): Cents {
  const first = assetFirstValue(asset);
  if (!first || first.date > end) return 0;
  const startedBy = first.date <= before && (!asset.purchaseDate || asset.purchaseDate <= before);
  return startedBy ? assetValueOn(asset, before) : first.value;
}

export interface NetWorthChange {
  start: Cents;
  end: Cents;
  change: Cents;
  /** False when nothing was tracked by `end`. */
  hasData: boolean;
}

/**
 * Net worth change from the end of `before` to the end of `end`. Opening
 * balances of accounts (and first values of assets) added in between are
 * part of the baseline, not change.
 */
export function netWorthChange(data: LedgerData, before: ISODate, end: ISODate): NetWorthChange {
  const index = indexLedger(data);
  const start = ledgerStartDate(data);
  let startValue = 0;
  for (const account of data.accounts) startValue += signedBalance(account, baselineBalance(index, account, before, end));
  startValue += sum(data.assets.map((a) => baselineAssetValue(a, before, end)));
  const endValue = netWorthOn(data, end).netWorth;
  return { start: startValue, end: endValue, change: endValue - startValue, hasData: !!start && start <= end };
}

export interface NetWorthTrend {
  /** Points on or after the ledger start only. */
  points: (NetWorth & { date: ISODate })[];
  change: NetWorthChange;
  /** Set when the requested window began before anything was tracked. */
  since: ISODate | null;
}

/** Net worth over `dates` (ascending), trimmed to when tracking began. */
export function netWorthTrend(data: LedgerData, dates: ISODate[]): NetWorthTrend {
  const start = ledgerStartDate(data);
  const last = dates[dates.length - 1];
  if (!start || !last || start > last) {
    return { points: [], change: { start: 0, end: 0, change: 0, hasData: false }, since: null };
  }
  const kept = dates.filter((d) => d >= start);
  const truncated = dates[0] <= start;
  const baseline = truncated ? addDays(start, -1) : dates[0];
  return { points: netWorthSeries(data, kept), change: netWorthChange(data, baseline, last), since: truncated ? start : null };
}

// ─── Available to spend ──────────────────────────────────────────────────────

export interface CommittedItem {
  event: ScheduledEvent;
  /** Reduction of spendable cash. */
  effect: Cents;
}

export interface SpendingPosition {
  horizon: ISODate;
  horizonLabel: string;
  horizonReason: 'payday' | 'days';
  spendableCash: Cents;
  committed: Cents;
  committedItems: CommittedItem[];
  /** Expected before the horizon; shown for context, not counted as available. */
  expectedIncome: Cents;
  setAside: Cents;
  /** Reserved in sinking funds for costs that don't arrive monthly. */
  reserved: Cents;
  buffer: Cents;
  available: Cents;
}

export const spendableAccounts = (data: LedgerData) =>
  data.accounts.filter((a) => !a.archived && a.spendable && accountNature(a.type) === 'asset');

/** Change an event would cause to the combined balance of `pool` accounts. */
export function poolEffect(data: LedgerData, event: ScheduledEvent, pool: Set<ID>): Cents {
  const index = indexLedger(data);
  const pseudo: Transaction = {
    id: event.key,
    type: event.txType,
    amount: event.amount,
    date: event.date,
    description: event.name,
    accountId: event.accountId,
    toAccountId: event.toAccountId,
    tags: [],
    attachments: [],
    createdAt: '',
    updatedAt: '',
  };
  return sum(postingsFor(pseudo, index.accounts).filter((p) => pool.has(p.accountId)).map((p) => p.delta));
}

/**
 * Available to spend = spendable cash − committed obligations until the next
 * payday (or 30 days) − money set aside for goals inside spendable accounts −
 * money reserved in sinking funds − the user's buffer. Expected income is
 * deliberately not added: money that hasn't arrived isn't safe to spend.
 */
export function spendingPosition(data: LedgerData, today: ISODate, allocatedByAccount: Map<ID, Cents>): SpendingPosition {
  const index = indexLedger(data);
  const accounts = spendableAccounts(data);
  const pool = new Set(accounts.map((a) => a.id));
  const spendableCash = sum(accounts.map((a) => balanceOn(index, a.id, today)));

  const payday = nextPayday(data, today);
  const byPayday = payday && diffDays(today, payday) <= 31;
  const horizon = byPayday ? payday : addDays(today, 30);

  const committedItems: CommittedItem[] = [];
  let expectedIncome = 0;
  for (const event of openEvents(data, today, horizon)) {
    const effect = poolEffect(data, event, pool);
    if (effect < 0) committedItems.push({ event, effect: -effect });
    else if (event.kind === 'income' && effect > 0 && event.date <= horizon) expectedIncome += effect;
  }
  const committed = sum(committedItems.map((c) => c.effect));
  const setAside = sum(accounts.map((a) => Math.max(0, allocatedByAccount.get(a.id) ?? 0)));
  // Reserves claim money sitting in real balances, exactly like goal
  // allocations. A fund naming no account is assumed to sit in spendable cash.
  const reserved = reservedIn(data, pool);
  const buffer = data.settings.spendingBuffer;

  return {
    horizon,
    horizonLabel: byPayday ? 'until next payday' : 'over the next 30 days',
    horizonReason: byPayday ? 'payday' : 'days',
    spendableCash,
    committed,
    committedItems,
    expectedIncome,
    setAside,
    reserved,
    buffer,
    available: spendableCash - committed - setAside - reserved - buffer,
  };
}

export interface MoneyMap {
  own: Cents;
  owe: Cents;
  netWorth: Cents;
  position: SpendingPosition;
}

export function moneyMap(data: LedgerData, today: ISODate, allocatedByAccount: Map<ID, Cents>): MoneyMap {
  const nw = netWorthOn(data, today);
  return { own: nw.assets, owe: nw.liabilities, netWorth: nw.netWorth, position: spendingPosition(data, today, allocatedByAccount) };
}

/** Credit utilization across all open cards with limits. */
export function overallUtilization(data: LedgerData, date: ISODate) {
  const index = indexLedger(data);
  let balance = 0;
  let limit = 0;
  for (const a of data.accounts) {
    if (a.archived || !isCreditCard(a.type) || !a.creditLimit) continue;
    balance += Math.max(0, balanceOn(index, a.id, date));
    limit += a.creditLimit;
  }
  return { balance, limit, utilization: limit > 0 ? balance / limit : 0 };
}

