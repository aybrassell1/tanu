import { isCreditCard, isDebt } from './catalog';
import { addDays, addMonthsToMonth, monthEnd, monthOf, monthStart } from './dates';
import { balanceOn, debtActivity, indexLedger } from './ledger';
import { monthlyInterest, sum } from './money';
import { defaultPlannedPayment, plannedDebtPayment } from './schedule';
import type { Account, Cents, ID, ISODate, ISOMonth, LedgerData } from './types';

// ─── Summary ─────────────────────────────────────────────────────────────────

/** APR in effect on a date, honouring an unexpired promotional rate. */
export function effectiveApr(account: Pick<Account, 'apr' | 'promoApr' | 'promoExpires'>, date: ISODate) {
  if (account.promoApr !== undefined && account.promoExpires && date <= account.promoExpires) return account.promoApr;
  return account.apr ?? 0;
}

export interface DebtLine {
  account: Account;
  balance: Cents;
  apr: number;
  monthlyInterest: Cents;
  plannedPayment: Cents;
  paidOffRatio: number | null;
  monthChange: Cents;
}

export function debtLines(data: LedgerData, today: ISODate): DebtLine[] {
  const index = indexLedger(data);
  const monthStartDay = monthStart(monthOf(today));
  return data.accounts
    .filter((a) => !a.archived && isDebt(a.type))
    .map((account) => {
      const balance = balanceOn(index, account.id, today);
      const apr = effectiveApr(account, today);
      // Balance at the end of the previous month, so activity on the 1st counts.
      const startBal = account.startingDate < monthStartDay ? balanceOn(index, account.id, addDays(monthStartDay, -1)) : account.startingBalance;
      return {
        account,
        balance,
        apr,
        monthlyInterest: monthlyInterest(Math.max(0, balance), apr),
        plannedPayment: plannedDebtPayment(account, balance),
        paidOffRatio: account.originalBalance ? Math.min(1, Math.max(0, 1 - balance / account.originalBalance)) : null,
        monthChange: balance - startBal,
      };
    })
    .sort((a, b) => b.balance - a.balance);
}

export function debtSummary(data: LedgerData, today: ISODate) {
  const index = indexLedger(data);
  const lines = debtLines(data, today);
  const year = today.slice(0, 4);
  const activity = lines.map((l) => debtActivity(index, l.account.id, `${year}-01-01`, today));
  const month = monthOf(today);
  const monthActivity = lines.map((l) => debtActivity(index, l.account.id, monthStart(month), today));
  const original = sum(lines.map((l) => l.account.originalBalance ?? 0));
  return {
    lines,
    total: sum(lines.map((l) => Math.max(0, l.balance))),
    creditCards: sum(lines.filter((l) => isCreditCard(l.account.type)).map((l) => Math.max(0, l.balance))),
    loans: sum(lines.filter((l) => !isCreditCard(l.account.type)).map((l) => Math.max(0, l.balance))),
    monthChange: sum(lines.map((l) => l.monthChange)),
    monthlyInterest: sum(lines.map((l) => l.monthlyInterest)),
    principalPaidYtd: sum(activity.map((a) => a.principal)),
    interestYtd: sum(activity.map((a) => a.interest)),
    paymentsThisMonth: sum(monthActivity.map((a) => a.payments)),
    originalLoans: original,
  };
}

// ─── Payoff simulation ───────────────────────────────────────────────────────

export interface PayoffDebt {
  id: ID;
  name: string;
  balance: Cents;
  apr: number;
  promoApr?: number;
  promoExpires?: ISODate;
  /** Required monthly payment. */
  payment: Cents;
}

export type PayoffOrder = 'listed' | 'highest_apr' | 'lowest_balance';

export interface PayoffOptions {
  startMonth: ISOMonth;
  /** Extra paid every month on top of required payments. */
  extraMonthly: Cents;
  /** How extra money is directed. The user chooses; nothing is recommended. */
  order: PayoffOrder;
  /** Ids in the user's preferred order when `order === 'listed'`. */
  listedOrder?: ID[];
  /** Extra monthly amounts for specific debts. */
  perDebtExtra?: Record<ID, Cents>;
  lumpSum?: { amount: Cents; month: number };
  /** Redirect payments of paid-off debts to the remaining ones. */
  rollover: boolean;
  maxMonths?: number;
}

export interface PayoffResult {
  months: number | null;
  debtFreeMonth: ISOMonth | null;
  totalInterest: Cents;
  totalPaid: Cents;
  series: { month: ISOMonth; total: Cents }[];
  perDebt: { id: ID; name: string; payoffMonth: ISOMonth | null; interest: Cents; paid: Cents }[];
  /** A debt whose payment never covers its interest. */
  stuck: boolean;
}

export function payoffDebtsFrom(data: LedgerData, today: ISODate): PayoffDebt[] {
  return debtLines(data, today)
    .filter((l) => l.balance > 0)
    .map((l) => ({
      id: l.account.id,
      name: l.account.name,
      balance: l.balance,
      apr: l.account.apr ?? 0,
      promoApr: l.account.promoApr,
      promoExpires: l.account.promoExpires,
      payment: requiredPayment(l.account, l.balance),
    }));
}

/** The contractual minimum used for "minimum payments only" modelling. */
export function requiredPayment(account: Account, balance: Cents): Cents {
  if (account.minimumPayment) return Math.min(account.minimumPayment, balance);
  if (defaultPlannedPayment(account) === 'fixed' && account.paymentAmount) return Math.min(account.paymentAmount, balance);
  if (isCreditCard(account.type)) {
    // Common issuer formula: 1% of balance plus interest, at least $25.
    const est = Math.round(balance * 0.01) + monthlyInterest(balance, account.apr ?? 0);
    return Math.min(balance, Math.max(2500, est));
  }
  return Math.min(balance, plannedDebtPayment(account, balance));
}

export function simulatePayoff(debts: PayoffDebt[], options: PayoffOptions): PayoffResult {
  const maxMonths = options.maxMonths ?? 600;
  const state = debts.map((d) => ({ ...d, remaining: d.balance, interest: 0, paid: 0, payoffMonth: null as ISOMonth | null }));
  const series: PayoffResult['series'] = [{ month: addMonthsToMonth(options.startMonth, -1), total: sum(state.map((d) => d.remaining)) }];

  const ordered = () => {
    const open = state.filter((d) => d.remaining > 0);
    switch (options.order) {
      case 'highest_apr':
        return open.sort((a, b) => b.apr - a.apr || a.remaining - b.remaining);
      case 'lowest_balance':
        return open.sort((a, b) => a.remaining - b.remaining || b.apr - a.apr);
      case 'listed': {
        const order = options.listedOrder ?? debts.map((d) => d.id);
        const rank = (id: ID) => (order.includes(id) ? order.indexOf(id) : Number.MAX_SAFE_INTEGER);
        return open.sort((a, b) => rank(a.id) - rank(b.id));
      }
    }
  };

  let month = options.startMonth;
  let m = 0;
  let stuck = false;
  for (; m < maxMonths && state.some((d) => d.remaining > 0); m++, month = addMonthsToMonth(month, 1)) {
    const date = monthEnd(month);
    let freed = 0;

    for (const d of state) {
      if (d.remaining <= 0) {
        if (options.rollover) freed += d.payment + (options.perDebtExtra?.[d.id] ?? 0);
        continue;
      }
      const interest = monthlyInterest(d.remaining, effectiveApr(d, date));
      d.remaining += interest;
      d.interest += interest;
      const pay = Math.min(d.remaining, d.payment + (options.perDebtExtra?.[d.id] ?? 0));
      d.remaining -= pay;
      d.paid += pay;
      if (options.rollover) freed += d.payment + (options.perDebtExtra?.[d.id] ?? 0) - pay;
      if (d.remaining <= 0) d.payoffMonth = month;
    }

    let pool = options.extraMonthly + freed + (options.lumpSum && options.lumpSum.month === m ? options.lumpSum.amount : 0);
    for (const d of ordered()) {
      if (pool <= 0) break;
      const pay = Math.min(pool, d.remaining);
      d.remaining -= pay;
      d.paid += pay;
      pool -= pay;
      if (d.remaining <= 0) d.payoffMonth = month;
    }

    const total = sum(state.map((d) => Math.max(0, d.remaining)));
    series.push({ month, total });
    // No progress for a year and still owing: payments don't cover interest.
    if (m >= 12 && total >= series[series.length - 13].total) {
      stuck = true;
      break;
    }
  }

  const done = state.every((d) => d.remaining <= 0);
  return {
    months: done ? m : null,
    debtFreeMonth: done ? (m === 0 ? options.startMonth : addMonthsToMonth(options.startMonth, m - 1)) : null,
    totalInterest: sum(state.map((d) => d.interest)),
    totalPaid: sum(state.map((d) => d.paid)),
    series,
    perDebt: state.map((d) => ({ id: d.id, name: d.name, payoffMonth: d.payoffMonth, interest: d.interest, paid: d.paid })),
    stuck,
  };
}

/** Month-end total debt for history charts. */
export function debtHistory(data: LedgerData, dates: ISODate[]) {
  const index = indexLedger(data);
  return dates.map((date) => ({
    date,
    total: sum(data.accounts.filter((a) => isDebt(a.type)).map((a) => Math.max(0, balanceOn(index, a.id, date)))),
  }));
}
