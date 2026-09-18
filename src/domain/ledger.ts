import { accountNature, isCreditCard, isDebt, isInvestment } from './catalog';
import type { Account, Cents, Category, ID, ISODate, LedgerData, Transaction, TransactionType } from './types';

/**
 * The ledger turns transactions into per-account postings. Every balance in
 * the app comes from here, so a transfer always moves the same amount out of
 * one account and into another and can never create or destroy money.
 */

export interface Posting {
  accountId: ID;
  /** Change in natural terms: assets +owned, liabilities +owed. */
  delta: Cents;
  date: ISODate;
  txId: ID;
}

/** Money leaving an account: lowers an asset, raises what a liability owes. */
const outflow = (account: Account | undefined, amount: Cents) =>
  account && accountNature(account.type) === 'liability' ? amount : -amount;
/** Money arriving: raises an asset, pays down a liability. */
const inflow = (account: Account | undefined, amount: Cents) => -outflow(account, amount);

export function postingsFor(tx: Transaction, accounts: Map<ID, Account>): Posting[] {
  const from = accounts.get(tx.accountId);
  const base = { date: tx.date, txId: tx.id };
  switch (tx.type) {
    case 'expense':
      return [{ ...base, accountId: tx.accountId, delta: outflow(from, tx.amount) }];
    case 'income':
    case 'refund':
    case 'reimbursement':
      return [{ ...base, accountId: tx.accountId, delta: inflow(from, tx.amount) }];
    case 'interest':
      // Interest raises what is owed on a liability.
      return [{ ...base, accountId: tx.accountId, delta: outflow(from, tx.amount) }];
    case 'adjustment':
      return [{ ...base, accountId: tx.accountId, delta: tx.amount }];
    case 'transfer':
    case 'debt_payment':
    case 'investment_contribution':
    case 'investment_withdrawal': {
      if (!tx.toAccountId) return [{ ...base, accountId: tx.accountId, delta: outflow(from, tx.amount) }];
      const to = accounts.get(tx.toAccountId);
      return [
        { ...base, accountId: tx.accountId, delta: outflow(from, tx.amount) },
        { ...base, accountId: tx.toAccountId, delta: inflow(to, tx.amount) },
      ];
    }
    default:
      // Unknown types (e.g. from a damaged import) never move money.
      return [];
  }
}

// ─── Classification ──────────────────────────────────────────────────────────

/** Types that only move money between the user's own accounts. */
export const TRANSFER_TYPES: TransactionType[] = ['transfer', 'debt_payment', 'investment_contribution', 'investment_withdrawal'];

/** Contribution to spending: purchases and interest count, refunds offset. */
export function spendingAmount(tx: Transaction): Cents {
  switch (tx.type) {
    case 'expense':
    case 'interest':
      return tx.amount;
    case 'refund':
    case 'reimbursement':
      return -tx.amount;
    default:
      return 0;
  }
}

export function incomeAmount(tx: Transaction): Cents {
  return tx.type === 'income' ? tx.amount : 0;
}

/** One category's share of a transaction. Refund lines are negative, like spendingAmount. */
export interface CategoryLine {
  categoryId?: ID;
  amount: Cents;
  essential?: boolean;
  taxCategory?: string;
  note?: string;
}

/**
 * Spending attributed to categories. A split purchase contributes one line per
 * split; everything else contributes a single line, so callers never need to
 * know whether a transaction was split.
 */
export function categoryLines(tx: Transaction): CategoryLine[] {
  const total = spendingAmount(tx);
  if (total === 0) return [];
  if (!tx.splits?.length) return [{ categoryId: tx.categoryId, amount: total, essential: tx.essential, taxCategory: tx.taxCategory }];
  const sign = total < 0 ? -1 : 1;
  return tx.splits.map((s) => ({
    categoryId: s.categoryId ?? tx.categoryId,
    amount: sign * s.amount,
    essential: s.essential ?? tx.essential,
    taxCategory: s.taxCategory ?? tx.taxCategory,
    note: s.note,
  }));
}

/** Every category a transaction touches, for filters and search. */
export function categoryIdsOf(tx: Transaction): ID[] {
  const ids = tx.splits?.length ? tx.splits.map((s) => s.categoryId ?? tx.categoryId) : [tx.categoryId];
  return [...new Set(ids.filter((id): id is ID => !!id))];
}

export const isSplit = (tx: Transaction) => !!tx.splits && tx.splits.length > 1;

export const isSpendingType = (type: TransactionType) =>
  type === 'expense' || type === 'interest' || type === 'refund' || type === 'reimbursement';

// ─── Index ───────────────────────────────────────────────────────────────────

export interface LedgerIndex {
  data: LedgerData;
  accounts: Map<ID, Account>;
  categories: Map<ID, Category>;
  transactions: Map<ID, Transaction>;
  /** Postings per account, sorted by date ascending. */
  postings: Map<ID, Posting[]>;
  /** Transactions sorted by date descending (then newest created). */
  sorted: Transaction[];
}

const cache = new WeakMap<LedgerData, LedgerIndex>();

export function indexLedger(data: LedgerData): LedgerIndex {
  const hit = cache.get(data);
  if (hit) return hit;

  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const categories = new Map(data.categories.map((c) => [c.id, c]));
  const transactions = new Map(data.transactions.map((t) => [t.id, t]));
  const postings = new Map<ID, Posting[]>();
  for (const tx of data.transactions) {
    for (const p of postingsFor(tx, accounts)) {
      const list = postings.get(p.accountId);
      if (list) list.push(p);
      else postings.set(p.accountId, [p]);
    }
  }
  for (const list of postings.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const sorted = [...data.transactions].sort((a, b) =>
    a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1,
  );

  const index = { data, accounts, categories, transactions, postings, sorted };
  cache.set(data, index);
  return index;
}

// ─── Balances ────────────────────────────────────────────────────────────────

/**
 * Balance of an account at the end of `date` in natural terms. Postings dated
 * before the account's starting date are already reflected in its starting
 * balance and are ignored.
 */
export function balanceOn(index: LedgerIndex, accountId: ID, date: ISODate): Cents {
  const account = index.accounts.get(accountId);
  if (!account) return 0;
  if (date < account.startingDate) return 0;
  let balance = account.startingBalance;
  for (const p of index.postings.get(accountId) ?? []) {
    if (p.date > date) break;
    if (p.date >= account.startingDate) balance += p.delta;
  }
  return balance;
}

/** Balances on each of the given dates (ascending) in one pass. */
export function balanceSeries(index: LedgerIndex, accountId: ID, dates: ISODate[]): Cents[] {
  const account = index.accounts.get(accountId);
  if (!account) return dates.map(() => 0);
  if (dates.some((d, i) => i > 0 && d < dates[i - 1])) {
    const sorted = [...dates].sort();
    const values = balanceSeries(index, accountId, sorted);
    const byDate = new Map(sorted.map((d, i) => [d, values[i]]));
    return dates.map((d) => byDate.get(d)!);
  }
  const postings = index.postings.get(accountId) ?? [];
  const out: Cents[] = [];
  let i = 0;
  let balance = account.startingBalance;
  for (const date of dates) {
    while (i < postings.length && postings[i].date <= date) {
      if (postings[i].date >= account.startingDate) balance += postings[i].delta;
      i++;
    }
    out.push(date < account.startingDate ? 0 : balance);
  }
  return out;
}

/** Signed contribution to net worth: assets positive, liabilities negative. */
export function signedBalance(account: Account, natural: Cents) {
  return accountNature(account.type) === 'liability' ? -natural : natural;
}

export function activeAccounts(data: LedgerData) {
  return data.accounts.filter((a) => !a.archived);
}

// ─── Credit & investments ────────────────────────────────────────────────────

export function creditInfo(account: Account, balance: Cents) {
  if (!isCreditCard(account.type) || !account.creditLimit) return null;
  const available = account.creditLimit - balance;
  return { limit: account.creditLimit, available, utilization: Math.max(0, balance) / account.creditLimit };
}

/**
 * Payments, interest and new charges for a debt in a date range. `principal`
 * is the real reduction of what was owed: payments that only cover new card
 * charges or interest don't count as paying down debt.
 */
export function debtActivity(index: LedgerIndex, accountId: ID, from: ISODate, to: ISODate) {
  let payments = 0;
  let interest = 0;
  let charges = 0;
  for (const tx of index.data.transactions) {
    if (tx.date < from || tx.date > to) continue;
    if (tx.toAccountId === accountId && TRANSFER_TYPES.includes(tx.type)) payments += tx.amount;
    else if (tx.accountId === accountId) {
      if (tx.type === 'interest') interest += tx.amount;
      // Purchases and cash advances both add new debt.
      else if (tx.type === 'expense' || TRANSFER_TYPES.includes(tx.type)) charges += tx.amount;
      else if (tx.type === 'refund' || tx.type === 'reimbursement') charges -= tx.amount;
    }
  }
  return { payments, interest, charges, principal: Math.max(0, payments - interest - Math.max(0, charges)) };
}

/**
 * Investment performance. Contributions add to cost basis, withdrawals remove
 * from it, and income deposited into the account (dividends reinvested) also
 * adds to basis. Market moves arrive as `valuation` adjustments and therefore
 * show up only as gains.
 */
/** Income categories that mean the investment paid out, rather than money being paid in. */
const PAYOUT_INCOME = new Set(['interest', 'dividends', 'capital_gains']);

export function investmentInfo(index: LedgerIndex, account: Account, asOf: ISODate) {
  if (!isInvestment(account.type)) return null;
  if (asOf < account.startingDate) return { value: 0, costBasis: 0, gain: 0, gainPct: 0, contributions: 0, withdrawals: 0, dividends: 0, paidIn: 0 };
  let contributions = 0;
  let withdrawals = 0;
  let dividends = 0;
  // Payroll money arriving as income (a 401(k) or HSA deduction) is a contribution, not a payout.
  let paidIn = 0;
  for (const tx of index.data.transactions) {
    if (tx.date > asOf || tx.date < account.startingDate) continue;
    if (tx.toAccountId === account.id && TRANSFER_TYPES.includes(tx.type)) contributions += tx.amount;
    if (tx.accountId === account.id && TRANSFER_TYPES.includes(tx.type) && tx.toAccountId) withdrawals += tx.amount;
    if (tx.accountId === account.id && tx.type === 'income') {
      const kind = tx.categoryId ? index.categories.get(tx.categoryId)?.incomeTax : undefined;
      if (kind && PAYOUT_INCOME.has(kind)) dividends += tx.amount;
      else paidIn += tx.amount;
    }
  }
  const value = balanceOn(index, account.id, asOf);
  // Everything paid in raises the basis: transfers, payroll deposits and reinvested payouts.
  const costBasis = (account.startingCostBasis ?? account.startingBalance) + contributions + paidIn + dividends - withdrawals;
  return { value, costBasis, gain: value - costBasis, gainPct: costBasis > 0 ? (value - costBasis) / costBasis : 0, contributions: contributions + paidIn, withdrawals, dividends, paidIn };
}

export { isDebt };
