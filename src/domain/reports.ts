import { accountGroup, accountNature, INCOME_TYPES, isInvestment } from './catalog';
import { categoryPath, rootCategoryId } from './categories';
import { addDays, addMonths, addMonthsToMonth, lastMonths, monthEnd, monthOf, monthStart, minDate } from './dates';
import { SYSTEM_CATEGORY } from './defaultCategories';
import { balanceSeries, categoryLines, incomeAmount, indexLedger, spendingAmount, TRANSFER_TYPES, type CategoryLine } from './ledger';
import { baselineBalance, netWorthChange, periodHasData } from './position';
import type { AccountType, Category, Cents, ID, IncomeTaxKind, ISODate, ISOMonth, LedgerData, Transaction } from './types';

/**
 * Period statistics. Income and spending come only from `classify` rules in
 * ledger.ts; transfers, debt payments and contributions are reported
 * separately as "where the money went", never as spending.
 */

export interface Amounts {
  key: string;
  label: string;
  amount: Cents;
  color?: string;
}

export interface CategorySpend extends Amounts {
  subs: Amounts[];
}

export interface PeriodStats {
  from: ISODate;
  to: ISODate;
  income: Cents;
  incomeBySource: Amounts[];
  spending: Cents;
  essential: Cents;
  discretionary: Cents;
  byCategory: CategorySpend[];
  byAccount: Amounts[];
  /** Income minus spending. */
  saved: Cents;
  savingsRate: number;
  /** Net money moved into savings accounts. */
  toSavings: Cents;
  investmentContributions: Cents;
  investmentWithdrawals: Cents;
  debtPayments: Cents;
  interestCharged: Cents;
  transactionCount: number;
}

const byAmount = (a: Amounts, b: Amounts) => b.amount - a.amount;

export function transactionsBetween(data: LedgerData, from: ISODate, to: ISODate): Transaction[] {
  return data.transactions.filter((t) => t.date >= from && t.date <= to);
}

export function isEssential(data: LedgerData, tx: Transaction) {
  if (tx.essential !== undefined) return tx.essential;
  const index = indexLedger(data);
  return index.categories.get(tx.categoryId ?? '')?.essential ?? false;
}

/** Essential flag for one line of a split, falling back to its category. */
export function isEssentialLine(data: LedgerData, line: CategoryLine) {
  if (line.essential !== undefined) return line.essential;
  return indexLedger(data).categories.get(line.categoryId ?? '')?.essential ?? false;
}

export function periodStats(data: LedgerData, from: ISODate, to: ISODate): PeriodStats {
  const index = indexLedger(data);
  const txs = transactionsBetween(data, from, to);

  let income = 0;
  let spending = 0;
  let essential = 0;
  let toSavings = 0;
  let investmentContributions = 0;
  let investmentWithdrawals = 0;
  let debtPayments = 0;
  let interestCharged = 0;
  const sources = new Map<string, Amounts>();
  const roots = new Map<string, CategorySpend>();
  const accounts = new Map<string, Amounts>();

  for (const tx of txs) {
    const inc = incomeAmount(tx);
    if (inc) {
      income += inc;
      const source = tx.incomeSourceId ? data.incomeSources.find((s) => s.id === tx.incomeSourceId) : undefined;
      const key = source?.id ?? tx.categoryId ?? 'other';
      const label = source?.name ?? (tx.categoryId ? categoryPath(index.categories, tx.categoryId) : 'Other income');
      const entry = sources.get(key) ?? { key, label, amount: 0 };
      entry.amount += inc;
      sources.set(key, entry);
    }

    const spend = spendingAmount(tx);
    if (spend) {
      spending += spend;
      if (tx.type === 'interest') interestCharged += tx.amount;

      // Split purchases land in each of their categories.
      for (const line of categoryLines(tx)) {
        if (isEssentialLine(data, line)) essential += line.amount;
        const rootId = rootCategoryId(index.categories, line.categoryId) ?? 'uncategorized';
        const root = index.categories.get(rootId);
        const r = roots.get(rootId) ?? { key: rootId, label: root?.name ?? 'Uncategorized', color: root?.color, amount: 0, subs: [] };
        r.amount += line.amount;
        const subId = line.categoryId ?? 'uncategorized';
        const sub = r.subs.find((s) => s.key === subId);
        if (sub) sub.amount += line.amount;
        else r.subs.push({ key: subId, label: index.categories.get(subId)?.name ?? 'Uncategorized', amount: line.amount });
        roots.set(rootId, r);
      }

      const account = index.accounts.get(tx.accountId);
      const a = accounts.get(tx.accountId) ?? { key: tx.accountId, label: account?.name ?? 'Unknown account', color: account?.color, amount: 0 };
      a.amount += spend;
      accounts.set(tx.accountId, a);
    }

    if (TRANSFER_TYPES.includes(tx.type) && tx.toAccountId) {
      const fromAcc = index.accounts.get(tx.accountId);
      const toAcc = index.accounts.get(tx.toAccountId);
      if (toAcc && accountNature(toAcc.type) === 'liability') debtPayments += tx.amount;
      if (toAcc && accountGroup(toAcc.type) === 'savings') toSavings += tx.amount;
      if (fromAcc && accountGroup(fromAcc.type) === 'savings') toSavings -= tx.amount;
      if (toAcc && isInvestment(toAcc.type) && !(fromAcc && isInvestment(fromAcc.type))) investmentContributions += tx.amount;
      if (fromAcc && isInvestment(fromAcc.type) && !(toAcc && isInvestment(toAcc.type))) investmentWithdrawals += tx.amount;
    }
  }

  const byCategory = [...roots.values()].map((r) => ({ ...r, subs: r.subs.sort(byAmount) })).sort(byAmount);
  const saved = income - spending;
  return {
    from,
    to,
    income,
    incomeBySource: [...sources.values()].sort(byAmount),
    spending,
    essential,
    discretionary: spending - essential,
    byCategory,
    byAccount: [...accounts.values()].sort(byAmount),
    saved,
    savingsRate: income > 0 ? saved / income : 0,
    toSavings,
    investmentContributions,
    investmentWithdrawals,
    debtPayments,
    interestCharged,
    transactionCount: txs.length,
  };
}

// ─── The savings rate ────────────────────────────────────────────────────────

/**
 * There is exactly one savings rate in this app:
 *
 *     savings rate = (income − spending) ÷ income
 *
 * `income` and `spending` are whatever `periodStats` counts, which is decided
 * purely by transaction type (`incomeAmount` / `spendingAmount`). Transfers,
 * debt payments and investment contributions only move money between the
 * user's own accounts, so they are neither income nor spending: money moved
 * into savings, a 401(k) or a loan principal is simply money that was kept.
 *
 * Only the *window* may differ between screens, and every screen has to say
 * which window it used:
 *   · Money checkup and Retirement — the trailing 12 months (`trailingYear`).
 *   · Year in review — the calendar year being reviewed (year to date while it
 *     is still running).
 * Anything else showing a savings rate must go through this function so the
 * numbers can never drift apart again.
 */
export function savingsRate(data: LedgerData, from: ISODate, to: ISODate) {
  const stats = periodStats(data, from, to);
  return { from, to, rate: stats.savingsRate, income: stats.income, spending: stats.spending, saved: stats.saved, hasIncome: stats.income > 0 };
}

/** The 12 months ending today: the standard window for the savings rate. */
export function trailingYear(today: ISODate): { from: ISODate; to: ISODate } {
  return { from: addDays(addMonths(today, -12), 1), to: today };
}

// ─── Investment activity ─────────────────────────────────────────────────────

/**
 * Accounts that shelter money from tax. A deposit into one is a contribution,
 * never income — the same rule `taxes.ts` applies to taxable wages, and the
 * reason a payroll 401(k) line must not be read as a dividend.
 */
const TAX_ADVANTAGED: AccountType[] = ['401k', 'roth_ira', 'traditional_ira', 'hsa'];

/** Income an investment itself produced. */
const INVESTMENT_INCOME_KINDS: IncomeTaxKind[] = ['interest', 'dividends', 'capital_gains'];
const INVESTMENT_INCOME_CATEGORIES: string[] = [SYSTEM_CATEGORY.interestIncome, SYSTEM_CATEGORY.dividends, 'income.capital_gains', 'income.investment'];

const isInvestmentIncome = (categoryId: ID | undefined, category: Category | undefined) =>
  (!!category?.incomeTax && INVESTMENT_INCOME_KINDS.includes(category.incomeTax)) || (!!categoryId && INVESTMENT_INCOME_CATEGORIES.includes(categoryId));

export interface InvestmentActivity {
  /** Moved in from another account (transfers and contributions). */
  transferred: Cents;
  /** Deposited straight into a 401(k), IRA or HSA and recorded as income — payroll contributions. */
  payroll: Cents;
  /** Everything put in: `transferred` + `payroll`. Never overlaps `income`. */
  contributions: Cents;
  withdrawals: Cents;
  /** Interest, dividends and realised gains the investments paid out. */
  income: Cents;
}

/**
 * Income landing in investment accounts, split into what the investments
 * earned and what was simply paid into them. A payroll 401(k) or HSA line is
 * typed `income` (it arrives from outside), but it is a contribution: counting
 * it as a dividend inflates investment income enormously.
 */
function investmentIncomeSplit(data: LedgerData, from: ISODate, to: ISODate) {
  const index = indexLedger(data);
  let income = 0;
  let payroll = 0;
  for (const tx of transactionsBetween(data, from, to)) {
    const amount = incomeAmount(tx);
    if (!amount) continue;
    const account = index.accounts.get(tx.accountId);
    if (!account || !isInvestment(account.type)) continue;
    if (isInvestmentIncome(tx.categoryId, index.categories.get(tx.categoryId ?? ''))) income += amount;
    else if (TAX_ADVANTAGED.includes(account.type)) payroll += amount;
  }
  return { income, payroll };
}

/** What went into and came out of investment accounts, and what they paid. */
export function investmentActivity(data: LedgerData, from: ISODate, to: ISODate): InvestmentActivity {
  const stats = periodStats(data, from, to);
  const { income, payroll } = investmentIncomeSplit(data, from, to);
  return {
    transferred: stats.investmentContributions,
    payroll,
    contributions: stats.investmentContributions + payroll,
    withdrawals: stats.investmentWithdrawals,
    income,
  };
}

/**
 * Income that actually arrives as spendable cash: everything `periodStats`
 * counts as income, minus payroll deposits made straight into a 401(k), IRA or
 * HSA. That money is saved before it is ever paid out, so it can't be part of
 * "what is left over each month".
 */
export function spendableIncome(data: LedgerData, from: ISODate, to: ISODate): Cents {
  return periodStats(data, from, to).income - investmentIncomeSplit(data, from, to).payroll;
}

export function monthStats(data: LedgerData, month: ISOMonth, today?: ISODate) {
  const end = today ? minDate(monthEnd(month), today) : monthEnd(month);
  return periodStats(data, monthStart(month), end);
}

/** Stats for each month, oldest first. */
export function monthlySeries(data: LedgerData, endMonth: ISOMonth, count: number, today: ISODate) {
  return lastMonths(endMonth, count).map((month) => ({ month, ...monthStats(data, month, today) }));
}

// ─── Monthly review ──────────────────────────────────────────────────────────

export interface MonthlyReview {
  month: ISOMonth;
  stats: PeriodStats;
  previous: PeriodStats;
  debt: { start: Cents; payments: Cents; interest: Cents; newCharges: Cents; end: Cents };
  investments: { contributions: Cents; withdrawals: Cents; start: Cents; end: Cents };
  netWorth: { start: Cents; end: Cents; change: Cents };
  isPartial: boolean;
  /** False when nothing was tracked during the previous month, so comparisons are meaningless. */
  previousHasData: boolean;
}

export function monthlyReview(data: LedgerData, month: ISOMonth, today: ISODate): MonthlyReview {
  const index = indexLedger(data);
  const start = monthStart(month);
  const end = minDate(monthEnd(month), today);
  const before = addDays(start, -1);
  const stats = periodStats(data, start, end);
  const previousMonth = addMonthsToMonth(month, -1);
  const previous = periodStats(data, monthStart(previousMonth), monthEnd(previousMonth));

  let debtStart = 0;
  let debtEnd = 0;
  let invStart = 0;
  let invEnd = 0;
  let newCharges = 0;
  for (const account of data.accounts) {
    // Accounts opened this month start from their opening balance.
    const s = baselineBalance(index, account, before, end);
    const [e] = balanceSeries(index, account.id, [end]);
    if (accountNature(account.type) === 'liability') {
      debtStart += s;
      debtEnd += e;
    } else if (isInvestment(account.type)) {
      invStart += s;
      invEnd += e;
    }
  }
  for (const tx of transactionsBetween(data, start, end)) {
    const acc = index.accounts.get(tx.accountId);
    if (acc && accountNature(acc.type) === 'liability') {
      if (tx.type === 'expense') newCharges += tx.amount;
      if (tx.type === 'refund' || tx.type === 'reimbursement') newCharges -= tx.amount;
    }
  }
  const nw = netWorthChange(data, before, end);

  return {
    month,
    stats,
    previous,
    debt: { start: debtStart, payments: stats.debtPayments, interest: stats.interestCharged, newCharges, end: debtEnd },
    investments: { contributions: stats.investmentContributions, withdrawals: stats.investmentWithdrawals, start: invStart, end: invEnd },
    netWorth: { start: nw.start, end: nw.end, change: nw.change },
    isPartial: end < monthEnd(month),
    previousHasData: periodHasData(data, monthStart(previousMonth), monthEnd(previousMonth)),
  };
}

// ─── Averages & comparisons ──────────────────────────────────────────────────

/** Average monthly spending per root category over complete months before `month`. */
export function categoryAverages(data: LedgerData, currentMonth: ISOMonth, months: number) {
  const range = lastMonths(addMonthsToMonth(currentMonth, -1), months);
  const stats = periodStats(data, monthStart(range[0]), monthEnd(range[range.length - 1]));
  return {
    months: range,
    total: Math.round(stats.spending / months),
    essential: Math.round(stats.essential / months),
    discretionary: Math.round(stats.discretionary / months),
    income: Math.round(stats.income / months),
    interest: Math.round(stats.interestCharged / months),
    byCategory: stats.byCategory.map((c) => ({ ...c, amount: Math.round(c.amount / months), subs: c.subs.map((s) => ({ ...s, amount: Math.round(s.amount / months) })) })),
  };
}

/** Year-to-date stats for this year and the same span last year. */
export function yearOverYear(data: LedgerData, today: ISODate) {
  const year = Number(today.slice(0, 4));
  const thisYear = periodStats(data, `${year}-01-01`, today);
  const sameDayLastYear = today.slice(5) === '02-29' ? `${year - 1}-02-28` : `${year - 1}${today.slice(4)}`;
  const lastYearToDate = periodStats(data, `${year - 1}-01-01`, sameDayLastYear);
  const lastYearFull = periodStats(data, `${year - 1}-01-01`, `${year - 1}-12-31`);
  /** False when nothing was tracked last year to date, so there is nothing to compare with. */
  const lastYearHasData = periodHasData(data, `${year - 1}-01-01`, sameDayLastYear);
  return { year, thisYear, lastYearToDate, lastYearFull, lastYearHasData };
}

export function largestExpenses(data: LedgerData, from: ISODate, to: ISODate, limit = 10) {
  return transactionsBetween(data, from, to)
    .filter((t) => t.type === 'expense')
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

export function incomeTypeLabel(data: LedgerData, sourceId: ID | undefined) {
  const s = data.incomeSources.find((x) => x.id === sourceId);
  return s ? INCOME_TYPES[s.type].label : 'Other';
}

export const currentMonth = (today: ISODate) => monthOf(today);

