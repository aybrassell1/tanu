import { spendingMap, type Cadence } from './coverage';
import { diffDays, monthOf } from './dates';
import { balanceOn, indexLedger } from './ledger';
import { sum } from './money';
import type { Cents, ID, ISODate, ISOMonth, LedgerData, SinkingFund } from './types';

/**
 * Sinking funds: money reserved each month for costs that don't arrive
 * monthly (car registration, holidays, insurance premiums, vet bills).
 *
 * A fund reserves money that already sits in an account — exactly like a
 * savings goal allocation. Nothing here creates transactions, so a reserve
 * never moves a balance; it only claims part of one. Entries are positive when
 * money is set aside and negative when the fund is spent.
 */

const MONTH_DAYS = 365.2425 / 12;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export const activeFunds = (data: LedgerData): SinkingFund[] => data.sinkingFunds.filter((f) => !f.archived);

/** What a fund currently holds: set aside minus spent. */
export function fundBalance(fund: SinkingFund): Cents {
  return sum(fund.entries.map((e) => e.amount));
}

/** Money set aside (positive entries only) during `month`. */
export function savedInMonth(fund: SinkingFund, month: ISOMonth): Cents {
  return sum(fund.entries.filter((e) => e.amount > 0 && monthOf(e.date) === month).map((e) => e.amount));
}

/** Money spent out of the fund (negative entries, as a positive number) during `month`. */
export function usedInMonth(fund: SinkingFund, month: ISOMonth): Cents {
  return -sum(fund.entries.filter((e) => e.amount < 0 && monthOf(e.date) === month).map((e) => e.amount));
}

/** The default monthly set-aside for a yearly cost. */
export const suggestedMonthly = (yearlyTarget: Cents): Cents => Math.round(yearlyTarget / 12);

export interface FundStatus {
  fund: SinkingFund;
  /** Set aside minus spent. */
  balance: Cents;
  /** The fund's yearly target. */
  target: Cents;
  /** Planned monthly set-aside. */
  monthly: Cents;
  /** Set aside so far in the month containing `today`. */
  savedThisMonth: Cents;
  /** Spent out of the fund this month, as a positive number. */
  usedThisMonth: Cents;
  /** True once anything was set aside this month. */
  fundedThisMonth: boolean;
  /** Balance as a share of the target (0–1), for progress bars. */
  ratio: number;
  /**
   * Balance against what the plan says should be saved by now
   * (target − monthly × months left). 1 = on schedule, below 1 = behind.
   */
  onTrack: number;
  /** Whole months left before the due date, 0 when due or overdue, null without one. */
  monthsUntilDue: number | null;
  daysUntilDue: number | null;
  overdue: boolean;
  /** Still needed to reach the target. */
  shortfall: Cents;
  /** Needed each month to cover the shortfall before the due date; null without one. */
  requiredMonthly: Cents | null;
  /** Extra on top of the planned monthly amount needed to make the due date. */
  suggestedCatchUp: Cents;
}

export function fundStatus(fund: SinkingFund, today: ISODate): FundStatus {
  const balance = fundBalance(fund);
  const target = fund.yearlyTarget;
  const month = monthOf(today);
  const savedThisMonth = savedInMonth(fund, month);

  const daysUntilDue = fund.dueDate ? diffDays(today, fund.dueDate) : null;
  const monthsUntilDue = daysUntilDue === null ? null : Math.max(0, Math.ceil(daysUntilDue / MONTH_DAYS));
  const shortfall = Math.max(0, target - balance);

  // What the plan expects to be in the fund by now: everything except the
  // contributions still to come before the due date.
  const expected = monthsUntilDue === null ? target : Math.min(target, Math.max(0, target - fund.monthly * monthsUntilDue));
  const onTrack = expected <= 0 ? 1 : balance / expected;

  const requiredMonthly = monthsUntilDue === null ? null : monthsUntilDue > 0 ? Math.ceil(shortfall / monthsUntilDue) : shortfall;

  return {
    fund,
    balance,
    target,
    monthly: fund.monthly,
    savedThisMonth,
    usedThisMonth: usedInMonth(fund, month),
    fundedThisMonth: savedThisMonth > 0,
    ratio: target > 0 ? clamp01(balance / target) : 0,
    onTrack,
    monthsUntilDue,
    daysUntilDue,
    overdue: daysUntilDue !== null && daysUntilDue < 0 && shortfall > 0,
    shortfall,
    requiredMonthly,
    suggestedCatchUp: requiredMonthly === null ? 0 : Math.max(0, requiredMonthly - fund.monthly),
  };
}

export function fundStatuses(data: LedgerData, today: ISODate): FundStatus[] {
  return activeFunds(data).map((f) => fundStatus(f, today));
}

/** Everything currently reserved across active funds. */
export function totalReserved(data: LedgerData): Cents {
  return sum(activeFunds(data).map(fundBalance));
}

/** The planned monthly set-aside across active funds. */
export function monthlySetAsideTotal(data: LedgerData): Cents {
  return sum(activeFunds(data).map((f) => f.monthly));
}

/** Set aside across all funds during the month containing `today`. */
export function setAsideThisMonth(data: LedgerData, today: ISODate): Cents {
  const month = monthOf(today);
  return sum(activeFunds(data).map((f) => savedInMonth(f, month)));
}

/** Funds with a monthly plan that haven't been funded yet this month. */
export function fundsMissingThisMonth(data: LedgerData, today: ISODate): SinkingFund[] {
  const month = monthOf(today);
  return activeFunds(data).filter((f) => f.monthly > 0 && savedInMonth(f, month) === 0);
}

/** Funds due within `withinDays` (overdue ones first), soonest first. */
export function fundsDueSoon(data: LedgerData, today: ISODate, withinDays = 60): FundStatus[] {
  return fundStatuses(data, today)
    .filter((s) => s.daysUntilDue !== null && s.daysUntilDue <= withinDays)
    .sort((a, b) => (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0));
}

/** Reserved money per account, for funds that name the account holding it. */
export function reservedByAccount(data: LedgerData): Map<ID, Cents> {
  const out = new Map<ID, Cents>();
  for (const fund of activeFunds(data)) {
    if (!fund.accountId) continue;
    out.set(fund.accountId, (out.get(fund.accountId) ?? 0) + fundBalance(fund));
  }
  return out;
}

/**
 * Reserved money held in `accountIds`. A fund with no account named is
 * assumed to sit in spendable cash, so it is included unless
 * `includeUnassigned` is false.
 */
export function reservedIn(data: LedgerData, accountIds: Set<ID>, includeUnassigned = true): Cents {
  return sum(
    activeFunds(data)
      .filter((f) => (f.accountId ? accountIds.has(f.accountId) : includeUnassigned))
      .map((f) => Math.max(0, fundBalance(f))),
  );
}

export interface AccountReserve {
  accountId: ID;
  balance: Cents;
  /** Reserved by sinking funds. */
  reserved: Cents;
  /** Assigned to savings goals, when the caller passes goal allocations. */
  allocated: Cents;
  /** Balance minus reserves and goal allocations. */
  free: Cents;
  /** More is claimed here than the account holds. */
  overReserved: boolean;
  byFund: { fundId: ID; amount: Cents }[];
}

/**
 * How each account's balance is claimed by funds. Pass `allocatedByAccount`
 * (from `allocatedAmounts`) so goal allocations count against the same
 * balance; a fund can never reserve money a goal already holds.
 */
export function accountReserves(data: LedgerData, today: ISODate, allocatedByAccount?: Map<ID, Cents>): Map<ID, AccountReserve> {
  const index = indexLedger(data);
  const out = new Map<ID, AccountReserve>();
  const ensure = (accountId: ID): AccountReserve => {
    let entry = out.get(accountId);
    if (!entry) {
      entry = {
        accountId,
        balance: balanceOn(index, accountId, today),
        reserved: 0,
        allocated: Math.max(0, allocatedByAccount?.get(accountId) ?? 0),
        free: 0,
        overReserved: false,
        byFund: [],
      };
      out.set(accountId, entry);
    }
    return entry;
  };

  for (const fund of activeFunds(data)) {
    if (!fund.accountId || !index.accounts.has(fund.accountId)) continue;
    const entry = ensure(fund.accountId);
    const amount = fundBalance(fund);
    entry.reserved += amount;
    entry.byFund.push({ fundId: fund.id, amount });
  }
  for (const entry of out.values()) {
    entry.free = entry.balance - entry.reserved - entry.allocated;
    entry.overReserved = entry.free < 0;
  }
  return out;
}

/** Accounts where funds and goals claim more than the balance. */
export function overReservedAccounts(data: LedgerData, today: ISODate, allocatedByAccount?: Map<ID, Cents>): AccountReserve[] {
  return [...accountReserves(data, today, allocatedByAccount).values()].filter((a) => a.overReserved);
}

/** Money in `accountId` that no fund or goal has claimed yet. */
export function unreservedIn(data: LedgerData, accountId: ID, today: ISODate, allocatedByAccount?: Map<ID, Cents>): Cents {
  const entry = accountReserves(data, today, allocatedByAccount).get(accountId);
  if (entry) return entry.free;
  const balance = balanceOn(indexLedger(data), accountId, today);
  return balance - Math.max(0, allocatedByAccount?.get(accountId) ?? 0);
}

/**
 * Setting aside `amount` in `fund` would claim money the account doesn't
 * hold. Returns the amount that is actually free, or null when the fund names
 * no account (nothing to check against).
 */
export function checkSetAside(
  data: LedgerData,
  fund: SinkingFund,
  amount: Cents,
  today: ISODate,
  allocatedByAccount?: Map<ID, Cents>,
): { ok: boolean; free: Cents } | null {
  if (!fund.accountId) return null;
  const free = unreservedIn(data, fund.accountId, today, allocatedByAccount);
  return { ok: amount <= free, free };
}

/**
 * Loose key for matching a fund to a cost by name: case, punctuation and
 * spacing are ignored, so "Holiday gifts", "holiday-gifts" and "Holiday
 * Gifts " are all the same fund.
 */
export function fundKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The active fund covering a cost, matched by category id first, then by name. */
export function fundFor(data: LedgerData, cost: { categoryId?: ID; label: string }): SinkingFund | null {
  const funds = activeFunds(data);
  if (cost.categoryId) {
    const byCategory = funds.find((f) => f.categoryId === cost.categoryId);
    if (byCategory) return byCategory;
  }
  const key = fundKey(cost.label);
  return key ? funds.find((f) => fundKey(f.name) === key) ?? null : null;
}

export interface FundSuggestion {
  categoryId: ID;
  name: string;
  yearlyTarget: Cents;
  monthly: Cents;
  cadence: Cadence;
  lastDate?: ISODate;
}

/**
 * Irregular costs from the spending map turned into funds worth starting.
 * Costs that already have a fund (by category, or by the same name) drop out.
 */
export function suggestFundsFrom(data: LedgerData, today: ISODate): FundSuggestion[] {
  const covered = new Set<string>();
  for (const fund of activeFunds(data)) {
    if (fund.categoryId) covered.add(fund.categoryId);
    covered.add(fundKey(fund.name));
  }
  return spendingMap(data, today)
    .irregular.filter((i) => i.yearly > 0 && !covered.has(i.categoryId) && !covered.has(fundKey(i.label)))
    .map((i) => ({ categoryId: i.categoryId, name: i.label, yearlyTarget: i.yearly, monthly: i.monthlySetAside, cadence: i.cadence, lastDate: i.lastDate }));
}
