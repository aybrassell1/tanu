import { accountNature } from './catalog';
import { addDays, addMonths, diffDays } from './dates';
import { balanceOn, indexLedger } from './ledger';
import { sum } from './money';
import { baselineBalance, netWorthOn } from './position';
import type { Cents, Goal, ID, ISODate, LedgerData } from './types';

/**
 * Savings and custom goals are funded by contributions. For savings goals a
 * contribution names the account holding the money, so allocations can be
 * checked against real balances: a $5,000 savings account can back an
 * emergency fund and a vacation fund only up to $5,000 in total.
 */

export interface AccountAllocation {
  accountId: ID;
  balance: Cents;
  allocated: Cents;
  unallocated: Cents;
  overAllocated: boolean;
  byGoal: { goalId: ID; amount: Cents }[];
}

export function allocationsByAccount(data: LedgerData, today: ISODate, includeFuture = false): Map<ID, AccountAllocation> {
  const index = indexLedger(data);
  const activeGoals = new Set(data.goals.filter((g) => g.kind === 'savings' && !g.archived).map((g) => g.id));
  const out = new Map<ID, AccountAllocation>();
  for (const c of data.goalContributions) {
    if (!c.accountId || !activeGoals.has(c.goalId) || (!includeFuture && c.date > today)) continue;
    let entry = out.get(c.accountId);
    if (!entry) {
      const balance = balanceOn(index, c.accountId, today);
      entry = { accountId: c.accountId, balance, allocated: 0, unallocated: balance, overAllocated: false, byGoal: [] };
      out.set(c.accountId, entry);
    }
    entry.allocated += c.amount;
    const g = entry.byGoal.find((x) => x.goalId === c.goalId);
    if (g) g.amount += c.amount;
    else entry.byGoal.push({ goalId: c.goalId, amount: c.amount });
  }
  for (const entry of out.values()) {
    entry.unallocated = entry.balance - entry.allocated;
    entry.overAllocated = entry.allocated > entry.balance;
  }
  return out;
}

export function allocatedAmounts(data: LedgerData, today: ISODate): Map<ID, Cents> {
  return new Map([...allocationsByAccount(data, today).values()].map((a) => [a.accountId, a.allocated]));
}

/** Amount a goal is currently credited with, by kind. */
export function goalValueOn(data: LedgerData, goal: Goal, date: ISODate): Cents {
  const index = indexLedger(data);
  switch (goal.kind) {
    case 'savings':
    case 'custom':
      return sum(data.goalContributions.filter((c) => c.goalId === goal.id && c.date <= date).map((c) => c.amount));
    case 'debt_payoff': {
      const owed = sum(goal.linkedAccountIds.map((id) => Math.max(0, balanceOn(index, id, date))));
      return Math.max(0, (goal.startValue ?? goal.target) - owed);
    }
    case 'investment':
      return sum(goal.linkedAccountIds.map((id) => balanceOn(index, id, date)));
    case 'net_worth':
      return netWorthOn(data, date).netWorth;
  }
}

export interface GoalProgress {
  goal: Goal;
  current: Cents;
  target: Cents;
  remaining: Cents;
  ratio: number;
  /** Average monthly progress over the last 3 months. */
  monthlyRate: Cents;
  projectedDate: ISODate | null;
  /** Needed per month to reach the target by its date. */
  requiredMonthly: Cents | null;
  status: 'complete' | 'on_track' | 'behind' | 'no_date' | 'stalled';
  /** Remaining debt for payoff goals. */
  owed?: Cents;
}

const RATE_WINDOW_DAYS = 90;

export function goalProgress(data: LedgerData, goal: Goal, today: ISODate): GoalProgress {
  const index = indexLedger(data);
  const current = goalValueOn(data, goal, today);
  const target = goal.kind === 'debt_payoff' ? goal.startValue ?? goal.target : goal.target;
  const remaining = Math.max(0, target - current);
  const ratio = target > 0 ? Math.min(1, Math.max(0, current / target)) : 0;

  // The window runs through today, so progress made this month counts.
  const windowStart = addDays(today, -RATE_WINDOW_DAYS);
  const since = goal.startDate > windowStart ? goal.startDate : windowStart;
  // At least a month of span, so one deposit doesn't look like a huge monthly pace.
  const spanDays = Math.max(30, diffDays(since, today) + 1);
  const monthlyRate = Math.round((progressSince(data, goal, since, today) / spanDays) * (365.2425 / 12));

  let projectedDate: ISODate | null = null;
  if (remaining === 0) projectedDate = today;
  else if (monthlyRate > 0) {
    const months = remaining / monthlyRate;
    if (months < 600) projectedDate = addDays(today, Math.ceil(months * (365.2425 / 12)));
  }

  let requiredMonthly: Cents | null = null;
  if (goal.targetDate && remaining > 0) {
    const monthsLeft = Math.max(1, diffDays(today, goal.targetDate) / (365.2425 / 12));
    requiredMonthly = Math.ceil(remaining / monthsLeft);
  }

  let status: GoalProgress['status'];
  if (remaining === 0) status = 'complete';
  else if (monthlyRate <= 0) status = 'stalled';
  else if (!goal.targetDate) status = 'no_date';
  else status = projectedDate && projectedDate <= goal.targetDate ? 'on_track' : 'behind';

  const owed =
    goal.kind === 'debt_payoff'
      ? sum(goal.linkedAccountIds.map((id) => Math.max(0, balanceOn(index, id, today))))
      : undefined;

  return { goal, current, target, remaining, ratio, monthlyRate, projectedDate, requiredMonthly, status, owed };
}

/** "Already saved" money recorded when the goal was created is its starting amount, not progress. */
function isStartingAmount(goal: Goal, c: { date: ISODate; note?: string; createdAt: string }) {
  if (c.date !== goal.startDate) return false;
  if (c.note === 'Already saved') return true;
  const gap = Math.abs(Date.parse(c.createdAt) - Date.parse(goal.createdAt));
  return Number.isFinite(gap) && gap < 60_000;
}

/** Progress made from the start of `since` through the end of `today`. */
export function progressSince(data: LedgerData, goal: Goal, since: ISODate, today: ISODate): Cents {
  const index = indexLedger(data);
  const before = addDays(since, -1);
  switch (goal.kind) {
    case 'savings':
    case 'custom':
      return sum(data.goalContributions.filter((c) => c.goalId === goal.id && c.date >= since && c.date <= today && !isStartingAmount(goal, c)).map((c) => c.amount));
    case 'debt_payoff': {
      // Balance owed just before the window (opening balance for debts added since).
      const owedBefore = sum(goal.linkedAccountIds.map((id) => index.accounts.get(id)).filter((a) => !!a).map((a) => Math.max(0, baselineBalance(index, a!, before, today))));
      const owedNow = sum(goal.linkedAccountIds.map((id) => Math.max(0, balanceOn(index, id, today))));
      return owedBefore - owedNow;
    }
    case 'investment':
    case 'net_worth':
      return goalValueOn(data, goal, today) - goalValueOn(data, goal, since === goal.startDate ? since : before);
  }
}

/** Month-end values for a goal's progress chart. */
export function goalHistory(data: LedgerData, goal: Goal, today: ISODate, months = 12) {
  const points: { date: ISODate; value: Cents }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const date = i === 0 ? today : addDays(addMonths(today, -i + 1, 1), -1);
    if (date < goal.startDate && goal.kind !== 'net_worth' && goal.kind !== 'investment') continue;
    points.push({ date, value: goalValueOn(data, goal, date) });
  }
  return points;
}

/** Suggested start value when creating a debt payoff goal. */
export function debtGoalStart(data: LedgerData, accountIds: ID[], today: ISODate) {
  const index = indexLedger(data);
  return sum(
    accountIds
      .map((id) => index.accounts.get(id))
      .filter((a) => a && accountNature(a.type) === 'liability')
      .map((a) => Math.max(a!.originalBalance ?? 0, balanceOn(index, a!.id, today))),
  );
}

export function emergencyFund(data: LedgerData, today: ISODate) {
  const goals = data.goals.filter((g) => !g.archived && g.template === 'emergency');
  const current = sum(goals.map((g) => goalValueOn(data, g, today)));
  const target = sum(goals.map((g) => g.target));
  return { goals, current, target };
}
