import { accountNature, isCreditCard, isDebt, RECURRING_KINDS } from './catalog';
import { addDays, addMonths, diffDays, nextDayOfMonth } from './dates';
import { balanceOn, debtActivity, indexLedger, TRANSFER_TYPES, type LedgerIndex } from './ledger';
import { monthlyInterest } from './money';
import { monthlyEquivalent, occurrencesBetween } from './recurrence';
import type {
  Account,
  Cents,
  ID,
  IncomeSource,
  ISODate,
  LedgerData,
  RecurringItem,
  RecurringKind,
  TransactionType,
} from './types';

/**
 * Scheduled events are the single source for everything that is expected to
 * happen: recurring bills, paychecks, debt due dates and future-dated
 * transactions. Calendar, bills, forecasting and "committed money" all read
 * from here so an obligation can never be counted twice.
 *
 * De-duplication rules:
 * - A recurring occurrence is settled by a transaction with the same
 *   `recurringId` + `occurrenceDate`, or skipped explicitly.
 * - A debt's due-date payment is generated only when no active recurring
 *   debt payment targets that account; it is settled by any payment into the
 *   account during that billing cycle.
 * - A paycheck is settled by an income transaction linked to the source with
 *   the same occurrence date, or within 4 days of it when unlinked.
 * - Future-dated transactions are already real records; they appear as
 *   upcoming events and are never also generated from a schedule.
 */

export type EventKind = RecurringKind | 'income';
export type EventStatus = 'upcoming' | 'overdue' | 'paid' | 'skipped';

export interface ScheduledEvent {
  key: string;
  date: ISODate;
  kind: EventKind;
  source: 'recurring' | 'income' | 'debt' | 'transaction';
  sourceId: ID;
  name: string;
  amount: Cents;
  txType: TransactionType;
  accountId: ID;
  toAccountId?: ID;
  categoryId?: ID;
  autopay: boolean;
  estimate: boolean;
  status: EventStatus;
  transactionId?: ID;
  /** Already paid toward an open (partially paid) occurrence; `amount` is what remains. */
  paidAmount?: Cents;
}

// ─── Income helpers ──────────────────────────────────────────────────────────

export function expectedGross(source: IncomeSource): Cents | undefined {
  if (source.expectedGross !== undefined) return source.expectedGross;
  if (source.hourlyRate !== undefined && source.expectedHours !== undefined) {
    return Math.round(source.hourlyRate * source.expectedHours);
  }
  return undefined;
}

/** Expected take-home per paycheck; falls back to gross when net is unknown. */
export function expectedNet(source: IncomeSource): Cents {
  return source.expectedNet ?? expectedGross(source) ?? 0;
}

export function incomeMonthlyEquivalent(source: IncomeSource): Cents {
  if (!source.frequency || !source.active) return 0;
  return monthlyEquivalent(expectedNet(source), source.frequency);
}

// ─── Debt helpers ────────────────────────────────────────────────────────────

export function defaultPlannedPayment(account: Account) {
  return account.plannedPayment ?? (isCreditCard(account.type) ? 'statement' : 'fixed');
}

/** The amount a debt's due-date payment is expected to be, capped at the balance. */
export function plannedDebtPayment(account: Account, balance: Cents): Cents {
  if (balance <= 0) return 0;
  let amount: Cents | undefined;
  switch (defaultPlannedPayment(account)) {
    case 'statement':
      amount = account.statementBalance ?? balance;
      break;
    case 'minimum':
      amount = account.minimumPayment;
      break;
    case 'fixed':
      amount = account.paymentAmount ?? account.minimumPayment;
      break;
  }
  return Math.min(amount ?? account.minimumPayment ?? 0, balance);
}

/** First spendable asset account, used as the default payer. */
export function primaryCashAccount(data: LedgerData): Account | undefined {
  const cash = data.accounts.filter((a) => !a.archived && accountNature(a.type) === 'asset');
  return cash.find((a) => a.spendable && a.type === 'checking') ?? cash.find((a) => a.spendable) ?? cash.find((a) => a.type === 'checking');
}

// ─── Event generation ────────────────────────────────────────────────────────

/** A payment this many days after a due date still settles that due date. */
const LATE_GRACE_DAYS = 5;
/** Paychecks are matched starting this far back so results don't depend on the query window. */
const MATCH_LOOKBACK_DAYS = 60;

/**
 * A schedule occurrence settled by a future-dated transaction is represented
 * by that transaction's own event, so the schedule copy is dropped.
 */
function settledInFuture(index: LedgerIndex, txId: ID | undefined, today: ISODate) {
  if (!txId) return false;
  const tx = index.transactions.get(txId);
  return !!tx && tx.date > today;
}

function recurringEvents(index: LedgerIndex, item: RecurringItem, from: ISODate, to: ISODate, today: ISODate): ScheduledEvent[] {
  if (!item.active) return [];
  const settled = new Map<ISODate, ID>();
  for (const tx of index.data.transactions) {
    if (tx.recurringId === item.id && tx.occurrenceDate) settled.set(tx.occurrenceDate, tx.id);
  }
  const events: ScheduledEvent[] = [];
  for (const date of occurrencesBetween(item.startDate, item.frequency, from, to, item.endDate)) {
    const transactionId = settled.get(date);
    if (settledInFuture(index, transactionId, today)) continue;
    // A paid occurrence shows what was actually paid, not the expected amount.
    const paidTx = transactionId ? index.transactions.get(transactionId) : undefined;
    const status: EventStatus = transactionId ? 'paid' : item.skipped.includes(date) ? 'skipped' : date < today ? 'overdue' : 'upcoming';
    events.push({
      key: `recurring:${item.id}:${date}`,
      date,
      kind: item.kind,
      source: 'recurring',
      sourceId: item.id,
      name: item.name,
      amount: paidTx?.amount ?? item.amount,
      txType: RECURRING_KINDS[item.kind].txType,
      accountId: item.accountId,
      toAccountId: item.toAccountId,
      categoryId: item.categoryId,
      autopay: item.autopay,
      estimate: paidTx ? false : item.variable,
      status,
      transactionId,
    });
  }
  return events;
}

function incomeEvents(index: LedgerIndex, source: IncomeSource, from: ISODate, to: ISODate, today: ISODate): ScheduledEvent[] {
  if (!source.active || !source.frequency || !source.anchorDate) return [];
  const linked = index.data.transactions.filter((t) => t.type === 'income' && t.incomeSourceId === source.id);
  const used = new Set<ID>();
  const events: ScheduledEvent[] = [];
  const dates = occurrencesBetween(source.anchorDate, source.frequency, addDays(from, -MATCH_LOOKBACK_DAYS), to, source.endDate);
  // Explicit links first, then nearby unlinked deposits, in date order.
  const matches = new Map<ISODate, (typeof linked)[number]>();
  for (const date of dates) {
    const m = linked.find((t) => !used.has(t.id) && t.occurrenceDate === date);
    if (m) {
      used.add(m.id);
      matches.set(date, m);
    }
  }
  for (const date of dates) {
    if (matches.has(date)) continue;
    const m = linked.find((t) => !used.has(t.id) && !t.occurrenceDate && Math.abs(diffDays(date, t.date)) <= 4);
    if (m) {
      used.add(m.id);
      matches.set(date, m);
    }
  }
  for (const date of dates) {
    if (date < from) continue;
    const match = matches.get(date);
    if (settledInFuture(index, match?.id, today)) continue;
    events.push({
      key: `income:${source.id}:${date}`,
      date,
      kind: 'income',
      source: 'income',
      sourceId: source.id,
      name: source.name,
      amount: match?.amount ?? expectedNet(source),
      txType: 'income',
      accountId: source.depositAccountId,
      categoryId: source.categoryId,
      autopay: true,
      estimate: !match,
      status: match ? 'paid' : date < today ? 'overdue' : 'upcoming',
      transactionId: match?.id,
    });
  }
  return events;
}

function debtEvents(index: LedgerIndex, account: Account, payerId: ID | undefined, from: ISODate, to: ISODate, today: ISODate): ScheduledEvent[] {
  if (account.archived || !isDebt(account.type) || !account.dueDay || !payerId) return [];
  // A recurring payment to this account replaces due-date events while it runs.
  const covering = index.data.recurring.filter((r) => r.active && r.toAccountId === account.id);
  const isCovered = (due: ISODate) => covering.some((r) => r.startDate <= due && (!r.endDate || due <= r.endDate));

  const payments = index.data.transactions
    .filter((t) => t.toAccountId === account.id && TRANSFER_TYPES.includes(t.type))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const inRange = (from: ISODate, to: ISODate) => payments.filter((t) => t.date > from && t.date <= to);
  /**
   * Payments settling the cycle that ends on `due`: everything paid after the
   * previous due date, except a late payment that belongs to an unpaid previous
   * cycle; if nothing was paid on time, a payment within the grace period counts.
   */
  const settlement = (due: ISODate) => {
    const prevDue = addMonths(due, -1, account.dueDay);
    const prevPrevDue = addMonths(due, -2, account.dueDay);
    const prevLate = inRange(prevPrevDue, prevDue).length === 0 ? new Set(inRange(prevDue, addDays(prevDue, LATE_GRACE_DAYS)).map((t) => t.id)) : new Set<ID>();
    const onTime = inRange(prevDue, due).filter((t) => !prevLate.has(t.id));
    if (onTime.length) return onTime;
    return due < today ? inRange(due, addDays(due, LATE_GRACE_DAYS)) : [];
  };

  const out: ScheduledEvent[] = [];
  const start = from > account.startingDate ? from : account.startingDate;
  const plan = defaultPlannedPayment(account);
  // Future cycles run off a projected balance so a loan's payments shrink it
  // instead of repeating today's balance. Statement-paid cards assume new
  // charges continue at the recent monthly average.
  let projected = balanceOn(index, account.id, today);
  let firstFuture = true;
  const recentCharges = Math.max(0, Math.round(debtActivity(index, account.id, addDays(today, -90), today).charges / 3));

  for (let due = nextDayOfMonth(account.dueDay, start); due <= to; due = addMonths(due, 1, account.dueDay)) {
    if (isCovered(due)) continue;
    let settled = settlement(due);
    let paidSoFar = 0;
    let amount: Cents = 0;
    // An upcoming due is only settled once the planned amount is covered; a
    // smaller payment leaves the remainder due.
    if (settled.length && due >= today) {
      const paid = settled.reduce((s, t) => s + t.amount, 0);
      const last = settled[settled.length - 1];
      const target = plannedDebtPayment(account, balanceOn(index, account.id, last.date) + paid);
      if (paid < target) {
        paidSoFar = paid;
        settled = [];
        amount = target - paid;
        projected = Math.max(0, projected + monthlyInterest(projected, account.apr ?? 0) - amount);
        firstFuture = false;
      }
    }
    const payment = settled[settled.length - 1];
    if (paidSoFar > 0) {
      // Remaining amount computed above.
    } else if (payment) {
      amount = settled.reduce((s, t) => s + t.amount, 0);
    } else if (due < today) {
      amount = plannedDebtPayment(account, balanceOn(index, account.id, due));
    } else if (plan === 'statement' && !firstFuture) {
      amount = Math.min(recentCharges, projected + recentCharges);
      projected = Math.max(0, projected + recentCharges - amount);
    } else {
      amount = plannedDebtPayment(account, projected);
      projected = Math.max(0, projected + monthlyInterest(projected, account.apr ?? 0) - amount);
      firstFuture = false;
    }
    if (!payment && amount <= 0) continue;
    if (settledInFuture(index, payment?.id, today)) continue;
    out.push({
      key: `debt:${account.id}:${due}`,
      date: due,
      kind: 'debt_payment',
      source: 'debt',
      sourceId: account.id,
      name: `${account.name} payment`,
      amount,
      txType: 'debt_payment',
      accountId: payerId,
      toAccountId: account.id,
      autopay: false,
      estimate: !payment,
      status: payment ? 'paid' : due < today ? 'overdue' : 'upcoming',
      transactionId: payment?.id,
      ...(paidSoFar > 0 ? { paidAmount: paidSoFar } : {}),
    });
  }
  return out;
}

const TX_KIND: Partial<Record<TransactionType, EventKind>> = {
  income: 'income',
  refund: 'income',
  reimbursement: 'income',
  debt_payment: 'debt_payment',
  transfer: 'transfer',
  investment_contribution: 'investment',
  investment_withdrawal: 'transfer',
};

function futureTransactionEvents(index: LedgerIndex, from: ISODate, to: ISODate, today: ISODate): ScheduledEvent[] {
  return index.data.transactions
    .filter((t) => t.date > today && t.date >= from && t.date <= to)
    .map((t) => ({
      key: `transaction:${t.id}`,
      date: t.date,
      kind: TX_KIND[t.type] ?? (t.type === 'adjustment' ? (t.amount > 0 ? 'income' : 'bill') : 'bill'),
      source: 'transaction' as const,
      sourceId: t.id,
      name: t.payee || t.description,
      amount: t.amount,
      txType: t.type,
      accountId: t.accountId,
      toAccountId: t.toAccountId,
      categoryId: t.categoryId,
      autopay: true,
      estimate: false,
      status: 'upcoming' as const,
      transactionId: t.id,
    }));
}

export interface EventQuery {
  from: ISODate;
  to: ISODate;
  today: ISODate;
}

export function scheduledEvents(data: LedgerData, { from, to, today }: EventQuery): ScheduledEvent[] {
  const index = indexLedger(data);
  const payer = primaryCashAccount(data)?.id;
  const events = [
    ...data.recurring.flatMap((r) => recurringEvents(index, r, from, to, today)),
    ...data.incomeSources.flatMap((s) => incomeEvents(index, s, from, to, today)),
    ...data.accounts.flatMap((a) => debtEvents(index, a, payer, from, to, today)),
    ...futureTransactionEvents(index, from, to, today),
  ];
  return events.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1));
}

/** Unsettled events from `lookbackDays` ago through `to`. Overdue items come first. */
export function openEvents(data: LedgerData, today: ISODate, to: ISODate, lookbackDays = 45) {
  return scheduledEvents(data, { from: addDays(today, -lookbackDays), to, today }).filter(
    (e) => e.status === 'upcoming' || e.status === 'overdue',
  );
}

/**
 * The next unsettled payment expected for a debt account (due-date event,
 * recurring payment or scheduled transfer). Overdue items come first.
 */
export function nextDebtDue(data: LedgerData, accountId: ID, today: ISODate): ScheduledEvent | undefined {
  return openEvents(data, today, addDays(today, 70), 30).find((e) => e.kind === 'debt_payment' && e.toAccountId === accountId);
}

/**
 * Monthly obligations: active recurring bills, subscriptions and debt
 * payments, plus planned due-date payments for debts that have no recurring
 * payment set up.
 */
export function monthlyObligations(data: LedgerData, today: ISODate): Cents {
  const index = indexLedger(data);
  const active = data.recurring.filter((r) => r.active && (r.kind === 'bill' || r.kind === 'subscription' || r.kind === 'debt_payment'));
  let total = active.reduce((s, r) => s + monthlyEquivalent(r.amount, r.frequency), 0);
  for (const a of data.accounts) {
    if (a.archived || !isDebt(a.type) || !a.dueDay) continue;
    if (active.some((r) => r.toAccountId === a.id && (!r.endDate || r.endDate >= today))) continue;
    total += plannedDebtPayment(a, balanceOn(index, a.id, today));
  }
  return total;
}

/** Next paycheck date across active scheduled income sources. */
export function nextPayday(data: LedgerData, today: ISODate): ISODate | null {
  const upcoming = scheduledEvents(data, { from: addDays(today, 1), to: addDays(today, 45), today }).find(
    (e) => e.kind === 'income' && e.status === 'upcoming',
  );
  return upcoming?.date ?? null;
}

export function eventDaysAway(event: ScheduledEvent, today: ISODate) {
  return diffDays(today, event.date);
}

