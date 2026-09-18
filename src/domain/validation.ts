import { accountNature, isInvestment, TRANSACTION_TYPES } from './catalog';
import { isValidISODate } from './dates';
import { allocationsByAccount } from './goals';
import { balanceOn, indexLedger, isSpendingType } from './ledger';
import { formatMoney } from './money';
import type { Account, GoalContribution, ISODate, LedgerData, RecurringItem, Transaction } from './types';

export type Errors<T> = Partial<Record<keyof T | 'form', string>>;

const hasErrors = (e: object) => Object.keys(e).length > 0;

export function validateTransaction(data: LedgerData, tx: Transaction): Errors<Transaction> {
  const e: Errors<Transaction> = {};
  const index = indexLedger(data);
  const info = TRANSACTION_TYPES[tx.type];
  const from = index.accounts.get(tx.accountId);
  const to = tx.toAccountId ? index.accounts.get(tx.toAccountId) : undefined;

  if (!Number.isInteger(tx.amount)) e.amount = 'Enter a valid amount.';
  else if (tx.type === 'adjustment' ? tx.amount === 0 : tx.amount <= 0) e.amount = 'Amount must be greater than zero.';
  if (!isValidISODate(tx.date)) e.date = 'Pick a valid date.';
  if (!from) e.accountId = 'Choose an account.';

  if (info.twoAccounts) {
    if (!to) e.toAccountId = 'Choose the destination account.';
    else if (to.id === tx.accountId) e.toAccountId = 'Pick two different accounts.';
    else if (from) {
      if (tx.type === 'debt_payment' && accountNature(to.type) !== 'liability') e.toAccountId = 'Debt payments go to a card or loan.';
      if (tx.type === 'investment_contribution' && !isInvestment(to.type)) e.toAccountId = 'Contributions go to an investment account.';
      if (tx.type === 'investment_withdrawal' && !isInvestment(from.type)) e.accountId = 'Withdrawals come from an investment account.';
    }
  }
  if (tx.type === 'income' && from && accountNature(from.type) === 'liability') e.accountId = 'Income is deposited into an asset account.';
  if (tx.type === 'interest' && from && accountNature(from.type) !== 'liability') e.accountId = 'Interest charges apply to a card or loan. Record interest earned as income.';
  if (tx.splits?.length) {
    if (!isSpendingType(tx.type)) e.splits = 'Only purchases and refunds can be split.';
    else if (tx.splits.some((s) => !Number.isInteger(s.amount) || s.amount <= 0)) e.splits = 'Every split needs an amount above zero.';
    else if (tx.splits.reduce((sum, s) => sum + s.amount, 0) !== tx.amount) e.splits = 'The splits need to add up to the total.';
    else {
      for (const s of tx.splits) {
        if (!s.categoryId) continue;
        const cat = index.categories.get(s.categoryId);
        if (!cat) e.splits = 'A split uses a category that no longer exists.';
        else if (cat.kind !== 'expense') e.splits = 'Splits use spending categories.';
      }
    }
  }

  if (tx.categoryId) {
    const cat = index.categories.get(tx.categoryId);
    if (!cat) e.categoryId = 'That category no longer exists.';
    else if (info.category && cat.kind !== info.category) e.categoryId = `Choose ${info.category === 'income' ? 'an income' : 'a spending'} category.`;
  }
  if (!tx.description.trim() && !tx.payee?.trim()) e.description = 'Add a description or payee.';
  // Balances start from each account's starting balance, which already includes earlier activity.
  const before = [from, to].find((a) => a && tx.date < a.startingDate);
  if (before && !e.date) e.date = `${before.name} is tracked from ${before.startingDate}. Its starting balance already includes earlier activity — or move its start date back.`;
  return e;
}

export function validateAccount(account: Account): Errors<Account> {
  const e: Errors<Account> = {};
  if (!account.name.trim()) e.name = 'Name the account.';
  if (!Number.isInteger(account.startingBalance)) e.startingBalance = 'Enter a valid balance.';
  if (!isValidISODate(account.startingDate)) e.startingDate = 'Pick a valid date.';
  const cents = (v: number | undefined) => v === undefined || Number.isInteger(v);
  const pct = (v: number | undefined) => v === undefined || (Number.isFinite(v) && v >= 0 && v <= 100);
  const day = (v: number | undefined) => v === undefined || (Number.isInteger(v) && v >= 1 && v <= 31);
  if (!cents(account.creditLimit) || (account.creditLimit !== undefined && account.creditLimit <= 0)) e.creditLimit = 'Credit limit must be positive.';
  if (!cents(account.minimumPayment) || (account.minimumPayment ?? 0) < 0) e.minimumPayment = 'Enter a valid amount.';
  if (!cents(account.paymentAmount) || (account.paymentAmount ?? 0) < 0) e.paymentAmount = 'Enter a valid amount.';
  if (!cents(account.statementBalance)) e.statementBalance = 'Enter a valid amount.';
  if (!cents(account.originalBalance) || !cents(account.startingCostBasis)) e.form = 'Enter valid amounts.';
  if (!pct(account.apr)) e.apr = 'APR should be between 0 and 100.';
  if (!pct(account.promoApr)) e.promoApr = 'Promo APR should be between 0 and 100.';
  if (account.promoApr !== undefined && (!account.promoExpires || !isValidISODate(account.promoExpires))) e.promoExpires = 'Add when the promo rate ends.';
  if (!day(account.dueDay)) e.dueDay = 'Use a whole day between 1 and 31.';
  if (!day(account.statementClosingDay)) e.statementClosingDay = 'Use a whole day between 1 and 31.';
  return e;
}

export function validateRecurring(data: LedgerData, item: RecurringItem): Errors<RecurringItem> {
  const e: Errors<RecurringItem> = {};
  const index = indexLedger(data);
  if (!item.name.trim()) e.name = 'Name this payment.';
  if (!Number.isInteger(item.amount) || item.amount <= 0) e.amount = 'Amount must be greater than zero.';
  if (!Number.isInteger(item.frequency.interval) || item.frequency.interval < 1) e.frequency = 'Repeat interval must be at least 1.';
  if (!isValidISODate(item.startDate)) e.startDate = 'Pick the first due date.';
  if (item.endDate && (!isValidISODate(item.endDate) || item.endDate < item.startDate)) e.endDate = 'End date must be after the start.';
  if (!index.accounts.get(item.accountId)) e.accountId = 'Choose the account it is paid from.';
  const needsTo = item.kind !== 'bill' && item.kind !== 'subscription';
  if (needsTo) {
    const to = item.toAccountId ? index.accounts.get(item.toAccountId) : undefined;
    if (!to) e.toAccountId = 'Choose where the money goes.';
    else if (to.id === item.accountId) e.toAccountId = 'Pick two different accounts.';
    else if (item.kind === 'debt_payment' && accountNature(to.type) !== 'liability') e.toAccountId = 'Choose a card or loan.';
    else if (item.kind === 'investment' && !isInvestment(to.type)) e.toAccountId = 'Choose an investment account.';
  }
  return e;
}

/**
 * A savings allocation can't claim more than the account's unallocated
 * balance, and a release can't exceed what the goal holds in that account.
 */
export function validateContribution(data: LedgerData, c: GoalContribution, today: ISODate): Errors<GoalContribution> {
  const e: Errors<GoalContribution> = {};
  const goal = data.goals.find((g) => g.id === c.goalId);
  if (!goal) return { form: 'Goal not found.' };
  if (!Number.isInteger(c.amount) || c.amount === 0) e.amount = 'Enter an amount.';
  if (!isValidISODate(c.date)) e.date = 'Pick a valid date.';
  if (goal.kind === 'savings') {
    if (!c.accountId) e.accountId = 'Choose the account holding this money.';
    else {
      const index = indexLedger(data);
      // Future-dated allocations still claim the money.
      const alloc = allocationsByAccount(data, today, true).get(c.accountId);
      const balance = balanceOn(index, c.accountId, today);
      const unallocated = alloc ? alloc.unallocated : balance;
      const inGoal = alloc?.byGoal.find((g) => g.goalId === goal.id)?.amount ?? 0;
      if (c.amount > 0 && c.amount > unallocated) e.amount = `Only ${formatMoney(Math.max(0, unallocated), { currency: data.settings.currency })} in that account isn't already assigned.`;
      if (c.amount < 0 && -c.amount > inGoal) e.amount = `This goal holds ${formatMoney(inGoal, { currency: data.settings.currency })} in that account.`;
    }
  }
  return e;
}

export { hasErrors };
