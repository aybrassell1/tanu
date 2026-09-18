import { accountGroup, accountNature, isInvestment } from './catalog';
import { addMonthsToMonth, monthOf } from './dates';
import { effectiveApr, payoffDebtsFrom, type PayoffDebt } from './debt';
import { balanceOn, indexLedger } from './ledger';
import { monthlyInterest, sum } from './money';
import { netWorthOn } from './position';
import { monthlyEquivalent, occurrencesPerMonth } from './recurrence';
import { categoryAverages } from './reports';
import { incomeMonthlyEquivalent, plannedDebtPayment } from './schedule';
import type { Cents, Frequency, ID, ISODate, ISOMonth, LedgerData, ScenarioChange } from './types';

/**
 * What-if projections. Pure functions over a read-only snapshot: nothing is
 * written back to the ledger. The baseline is a monthly model built from
 * current balances, scheduled income, recurring obligations and recent
 * average variable spending. Scenarios apply changes to that same model.
 */

export interface Baseline {
  startMonth: ISOMonth;
  cash: Cents;
  savings: Cents;
  investments: Cents;
  otherAssets: Cents;
  monthlyIncome: Cents;
  paychecksPerMonth: number;
  /** Recurring bills and subscriptions by item id. */
  recurring: { id: ID; name: string; frequency: Frequency; monthly: Cents }[];
  /** Average non-recurring spending per month. */
  variableSpending: Cents;
  savingsContributions: Cents;
  investmentContributions: Cents;
  debts: PayoffDebt[];
  investmentReturn: number;
}

export function buildBaseline(data: LedgerData, today: ISODate): Baseline {
  const index = indexLedger(data);
  let cash = 0;
  let savings = 0;
  let investments = 0;
  let otherAssets = 0;
  for (const a of data.accounts) {
    if (a.archived) continue;
    const bal = balanceOn(index, a.id, today);
    // A card or loan with a credit balance is money owed to the user.
    if (accountNature(a.type) === 'liability') {
      if (bal < 0) otherAssets -= bal;
      continue;
    }
    if (accountGroup(a.type) === 'cash') cash += bal;
    else if (accountGroup(a.type) === 'savings') savings += bal;
    else if (isInvestment(a.type)) investments += bal;
    else otherAssets += bal;
  }
  otherAssets += netWorthOn(data, today).breakdown.physicalAssets;

  const active = data.recurring.filter((r) => r.active);
  const recurring = active
    .filter((r) => r.kind === 'bill' || r.kind === 'subscription')
    .map((r) => ({ id: r.id, name: r.name, frequency: r.frequency, monthly: monthlyEquivalent(r.amount, r.frequency) }));
  const recurringTotal = sum(recurring.map((r) => r.monthly));
  const averages = categoryAverages(data, monthOf(today), 3);
  const paySources = data.incomeSources.filter((s) => s.active && s.frequency);

  return {
    startMonth: addMonthsToMonth(monthOf(today), 1),
    cash,
    savings,
    investments,
    otherAssets,
    monthlyIncome: sum(data.incomeSources.map(incomeMonthlyEquivalent)),
    paychecksPerMonth: sum(paySources.map((s) => occurrencesPerMonth(s.frequency!))) || 2,
    recurring,
    // Interest is modelled on the debts themselves, so it is excluded here.
    variableSpending: Math.max(0, averages.total - averages.interest - recurringTotal),
    savingsContributions: sum(active.filter((r) => r.kind === 'savings').map((r) => monthlyEquivalent(r.amount, r.frequency))),
    investmentContributions: sum(active.filter((r) => r.kind === 'investment').map((r) => monthlyEquivalent(r.amount, r.frequency))),
    // Model debts at what the user actually plans to pay, never below the minimum.
    debts: payoffDebtsFrom(data, today).map((d) => {
      const account = index.accounts.get(d.id)!;
      return { ...d, payment: Math.max(d.payment, plannedDebtPayment(account, d.balance)) };
    }),
    investmentReturn: data.settings.investmentReturn,
  };
}

export interface ProjectionMonth {
  month: ISOMonth;
  income: Cents;
  expenses: Cents;
  debtPayments: Cents;
  investmentContributions: Cents;
  /** Income − expenses − debt payments − investment contributions. */
  surplus: Cents;
  cash: Cents;
  savings: Cents;
  investments: Cents;
  debt: Cents;
  assets: Cents;
  netWorth: Cents;
}

export interface Projection {
  months: ProjectionMonth[];
  debtFreeMonth: ISOMonth | null;
  averageSurplus: Cents;
  end: ProjectionMonth;
  /** First month cash (incl. savings) is projected below zero, if any. */
  negativeCash: { month: ISOMonth; cash: Cents } | null;
  lowestCash: Cents;
}

export function amortizedPayment(principal: Cents, apr: number, termMonths: number) {
  const r = apr / 100 / 12;
  if (r === 0) return Math.round(principal / termMonths);
  return Math.round((principal * r) / (1 - Math.pow(1 + r, -termMonths)));
}

export function project(baseline: Baseline, changes: ScenarioChange[], requestedMonths: number): Projection {
  const horizonMonths = Math.max(1, Math.floor(requestedMonths));
  let cash = baseline.cash + baseline.savings;
  let savings = baseline.savings;
  let investments = baseline.investments;
  let assets = baseline.otherAssets;
  const debts = baseline.debts.map((d) => ({ ...d, remaining: d.balance }));
  const months: ProjectionMonth[] = [];
  let debtFreeMonth: ISOMonth | null = null;
  let hadDebt = debts.some((d) => d.remaining > 0);

  for (let m = 0; m < horizonMonths; m++) {
    const month = addMonthsToMonth(baseline.startMonth, m);
    const active = <T extends ScenarioChange>(c: T) => ('startMonth' in c ? c.startMonth <= m : true);

    // Income
    let income = baseline.monthlyIncome;
    for (const c of changes) {
      if (c.type !== 'income_change' || !active(c)) continue;
      income += c.mode === 'percent' ? Math.round((baseline.monthlyIncome * c.value) / 100) : c.value;
    }

    // Expenses
    let expenses = baseline.variableSpending;
    for (const r of baseline.recurring) {
      const cancelled = changes.some((c) => c.type === 'cancel_recurring' && c.recurringId === r.id && active(c));
      const changed = changes.find((c): c is Extract<ScenarioChange, { type: 'change_recurring' }> => c.type === 'change_recurring' && c.recurringId === r.id && active(c));
      if (cancelled) continue;
      expenses += changed ? monthlyEquivalent(changed.newAmount, r.frequency) : r.monthly;
    }
    for (const c of changes) {
      if (c.type === 'expense_change' && active(c)) expenses += c.monthlyAmount;
      if (c.type === 'one_time' && c.month === m) {
        if (c.amount < 0) expenses += -c.amount;
        else cash += c.amount;
      }
    }

    // New loans (e.g. buying a car)
    for (const c of changes) {
      if (c.type !== 'new_loan') continue;
      if (c.startMonth === m) {
        cash -= c.downPayment;
        assets += c.assetValue;
        if (c.principal > 0) {
          hadDebt = true;
          debtFreeMonth = null;
          debts.push({ id: c.id, name: c.label, balance: c.principal, remaining: c.principal, apr: c.apr, payment: amortizedPayment(c.principal, c.apr, c.termMonths) });
        }
      }
    }

    // Debt: interest, required payments, then any extra.
    let debtPayments = 0;
    const date = `${month}-28`;
    for (const d of debts) {
      if (d.remaining <= 0) continue;
      d.remaining += monthlyInterest(d.remaining, effectiveApr(d, date));
      const pay = Math.min(d.remaining, d.payment);
      d.remaining -= pay;
      debtPayments += pay;
    }
    for (const c of changes) {
      if (c.type !== 'extra_debt_payment' || !active(c)) continue;
      const open = debts.filter((d) => d.remaining > 0 && (!c.accountId || d.id === c.accountId));
      const openTotal = sum(open.map((d) => d.remaining));
      // Without a chosen debt, extra is split in proportion to balances.
      for (const d of open) {
        const share = c.accountId ? c.monthlyAmount : Math.round((c.monthlyAmount * d.remaining) / Math.max(1, openTotal));
        const pay = Math.min(share, d.remaining);
        d.remaining -= pay;
        debtPayments += pay;
      }
    }
    const debt = sum(debts.map((d) => Math.max(0, d.remaining)));
    if (hadDebt && debt <= 0 && debtFreeMonth === null) debtFreeMonth = month;

    // Contributions
    const investContrib = baseline.investmentContributions;
    let savingsContrib = baseline.savingsContributions;
    let extraSaving = 0;
    for (const c of changes) {
      if (c.type === 'savings_contribution' && active(c)) extraSaving += Math.round(c.perPaycheck * baseline.paychecksPerMonth);
    }
    savingsContrib += extraSaving;
    // Saving more per paycheck means spending less day to day; beyond everyday
    // spending it is only a transfer between the user's own accounts.
    expenses -= Math.min(Math.max(0, extraSaving), baseline.variableSpending);

    const surplus = income - expenses - debtPayments - investContrib;
    cash += surplus;
    savings = Math.min(Math.max(0, cash), savings + savingsContrib);
    investments = Math.round(investments * (1 + baseline.investmentReturn / 100 / 12)) + investContrib;

    months.push({
      month,
      income,
      expenses,
      debtPayments,
      investmentContributions: investContrib,
      surplus,
      cash,
      savings,
      investments,
      debt,
      assets,
      netWorth: cash + investments + assets - debt,
    });
  }

  const end = months[months.length - 1];
  const firstNegative = months.find((x) => x.cash < 0);
  return {
    months,
    negativeCash: firstNegative ? { month: firstNegative.month, cash: firstNegative.cash } : null,
    lowestCash: months.length ? Math.min(...months.map((x) => x.cash)) : 0,
    debtFreeMonth,
    averageSurplus: months.length ? Math.round(sum(months.map((x) => x.surplus)) / months.length) : 0,
    end,
  };
}

export function compareScenario(data: LedgerData, changes: ScenarioChange[], horizonMonths: number, today: ISODate) {
  const baselineInput = buildBaseline(data, today);
  const baseline = project(baselineInput, [], horizonMonths);
  const scenario = project(baselineInput, changes, horizonMonths);
  return { input: baselineInput, baseline, scenario };
}

/** Human description of a change for lists. */
export function describeChange(data: LedgerData, c: ScenarioChange, money: (n: Cents) => string): string {
  const name = (id: ID) => data.recurring.find((r) => r.id === id)?.name ?? 'a recurring item';
  const from = (m: number) => (m > 0 ? ` from month ${m + 1}` : '');
  switch (c.type) {
    case 'income_change':
      return c.mode === 'percent' ? `Income ${c.value >= 0 ? '+' : ''}${c.value}%${from(c.startMonth)}` : `Income ${money(c.value)}/mo${from(c.startMonth)}`;
    case 'expense_change':
      return `${c.label}: ${money(c.monthlyAmount)}/mo${from(c.startMonth)}`;
    case 'cancel_recurring':
      return `Cancel ${name(c.recurringId)}${from(c.startMonth)}`;
    case 'change_recurring':
      return `${name(c.recurringId)} becomes ${money(c.newAmount)}${from(c.startMonth)}`;
    case 'extra_debt_payment':
      return `Extra ${money(c.monthlyAmount)}/mo toward ${c.accountId ? data.accounts.find((a) => a.id === c.accountId)?.name ?? 'debt' : 'all debts'}${from(c.startMonth)}`;
    case 'one_time':
      return `${c.label}: ${money(c.amount)} in month ${c.month + 1}`;
    case 'new_loan':
      return `${c.label}: ${money(c.principal)} loan at ${c.apr}% for ${c.termMonths} mo`;
    case 'savings_contribution':
      return `Save ${money(c.perPaycheck)} per paycheck by spending less${from(c.startMonth)}`;
  }
}
