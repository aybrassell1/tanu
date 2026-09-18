import { isInvestment } from './catalog';
import { addDays, addMonths, diffDays } from './dates';
import { balanceOn, indexLedger } from './ledger';
import { sum } from './money';
import { ledgerStartDate } from './position';
import { periodStats } from './reports';
import type { Account, Cents, ID, ISODate, LedgerData } from './types';

/**
 * Retirement / financial-independence projection.
 *
 * Everything here is a **projection from stated assumptions**, never advice
 * and never a prediction. The inputs are all visible and adjustable:
 * current age, retirement age, return, inflation and withdrawal rate. The
 * starting balance and the contribution rate come from recorded data
 * (investment account balances, transfers into them and the pre-tax
 * `withholding.retirement` on paychecks), so nothing is invented.
 *
 * Compounding is annual with a mid-year contribution convention
 * (`balance × (1 + r) + contributions × (1 + r/2)`), which is the usual
 * approximation for money paid in monthly across the year.
 */

// ─── Assumptions ─────────────────────────────────────────────────────────────

export interface RetirementAssumptions {
  currentAge: number;
  retirementAge: number;
  /** Nominal annual return, percent. */
  returnRate: number;
  /** Annual inflation, percent. */
  inflation: number;
  /** Safe withdrawal rate at retirement, percent. */
  withdrawalRate: number;
  /** Money going in per month, in cents. */
  monthlyContribution: Cents;
  /** Spending the FI target is built from, per year. */
  annualSpending: Cents;
}

export const DEFAULT_ASSUMPTIONS = {
  currentAge: 30,
  retirementAge: 65,
  inflation: 2.5,
  withdrawalRate: 4,
} as const;

/** The return band shown around the central projection. */
export const RETURN_BAND = { low: 4, high: 8 } as const;

export const MIN_AGE = 16;
export const MAX_AGE = 100;

/** The multiple of annual spending implied by a withdrawal rate (4% → 25×). */
export const targetMultiple = (withdrawalRate: number) => (withdrawalRate > 0 ? 100 / withdrawalRate : 0);

/** Real return after inflation, as a fraction. */
export const realRate = (returnRate: number, inflation: number) => (1 + returnRate / 100) / (1 + inflation / 100) - 1;

// ─── Measured inputs ─────────────────────────────────────────────────────────

export interface RetirementBalance {
  total: Cents;
  accounts: { account: Account; balance: Cents }[];
  hasAccounts: boolean;
}

/** Today's value of every open investment / retirement account. */
export function retirementBalance(data: LedgerData, today: ISODate): RetirementBalance {
  const index = indexLedger(data);
  const accounts = data.accounts
    .filter((a) => !a.archived && isInvestment(a.type))
    .map((account) => ({ account, balance: balanceOn(index, account.id, today) }))
    .sort((a, b) => b.balance - a.balance);
  return { total: sum(accounts.map((a) => a.balance)), accounts, hasAccounts: accounts.length > 0 };
}

export interface ContributionRate {
  /** Average per month over the measured window. */
  monthly: Cents;
  /** Transfers and investment contributions into investment accounts. */
  fromTransfers: Cents;
  /** Pre-tax `withholding.retirement` on recorded paychecks. */
  fromPaycheck: Cents;
  /** Pre-tax `withholding.hsa`, counted only while an HSA account is open. */
  fromHsa: Cents;
  /** Employer match implied by income sources; shown, never assumed. */
  employerMatch: Cents;
  /** Whole months the average is spread over. */
  months: number;
  /** Names of the accounts whose balances and inflows are counted. */
  accountNames: string[];
  /** False when nothing was recorded in the window. */
  hasData: boolean;
}

/**
 * Contributions actually recorded over the last `months` months. Paycheck
 * retirement withholding never appears as a transfer (it is deducted before
 * the deposit), so it is added separately and can't double-count. Pre-tax
 * HSA withholding is added the same way, because an open HSA is counted in
 * the starting balance: leaving the money in would understate the rate.
 */
export function contributionRate(data: LedgerData, today: ISODate, months = 12): ContributionRate {
  const from = addDays(addMonths(today, -months), 1);
  const stats = periodStats(data, from, today);
  const investmentAccounts = data.accounts.filter((a) => !a.archived && isInvestment(a.type));
  // Only count HSA payroll money when there is an HSA whose balance we count.
  const hasHsa = investmentAccounts.some((a) => a.type === 'hsa');

  let fromPaycheck = 0;
  let fromHsa = 0;
  let employerMatch = 0;
  for (const tx of data.transactions) {
    if (tx.date < from || tx.date > today || tx.type !== 'income') continue;
    const retirement = tx.withholding?.retirement ?? 0;
    fromPaycheck += retirement;
    if (hasHsa) fromHsa += tx.withholding?.hsa ?? 0;
    const source = tx.incomeSourceId ? data.incomeSources.find((s) => s.id === tx.incomeSourceId) : undefined;
    if (source?.match && retirement > 0) {
      const gross = tx.grossAmount ?? tx.amount;
      const contributed = gross > 0 ? (retirement / gross) * 100 : 0;
      const matched = Math.min(contributed, source.match.upToPercent);
      employerMatch += Math.round((gross * matched * (source.match.percent / 100)) / 100);
    }
  }

  // Money moved into investment accounts, less anything taken back out.
  const fromTransfers = stats.investmentContributions - stats.investmentWithdrawals;
  const total = fromTransfers + fromPaycheck + fromHsa;
  return {
    monthly: Math.round(total / months),
    fromTransfers,
    fromPaycheck,
    fromHsa,
    employerMatch,
    months,
    accountNames: investmentAccounts.map((a) => a.name),
    hasData: investmentAccounts.length > 0 || total !== 0,
  };
}

export interface SpendingRate {
  annual: Cents;
  monthly: Cents;
  /** True when fewer than 12 months of data were available and it was scaled up. */
  annualized: boolean;
  daysCovered: number;
}

/** Yearly spending from real transactions; scaled up when history is short. */
export function annualSpending(data: LedgerData, today: ISODate): SpendingRate {
  const start = ledgerStartDate(data);
  const wanted = addDays(addMonths(today, -12), 1);
  const from = start && start > wanted ? start : wanted;
  const days = Math.max(1, diffDays(from, today) + 1);
  const spending = periodStats(data, from, today).spending;
  const annual = days >= 365 ? spending : Math.round((spending * 365.2425) / days);
  return { annual: Math.max(0, annual), monthly: Math.round(Math.max(0, annual) / 12), annualized: days < 365, daysCovered: days };
}

/** Savings rate over the last 12 months (income − spending, as a share of income). */
export function savingsRateOf(data: LedgerData, today: ISODate) {
  const stats = periodStats(data, addDays(addMonths(today, -12), 1), today);
  return { rate: stats.savingsRate, income: stats.income, saved: stats.saved, hasIncome: stats.income > 0 };
}

/** Assumptions seeded from the ledger; every field can be overridden. */
export function defaultAssumptions(data: LedgerData, today: ISODate, override: Partial<RetirementAssumptions> = {}): RetirementAssumptions {
  return {
    currentAge: DEFAULT_ASSUMPTIONS.currentAge,
    retirementAge: DEFAULT_ASSUMPTIONS.retirementAge,
    returnRate: data.settings.investmentReturn,
    inflation: DEFAULT_ASSUMPTIONS.inflation,
    withdrawalRate: DEFAULT_ASSUMPTIONS.withdrawalRate,
    monthlyContribution: contributionRate(data, today).monthly,
    annualSpending: annualSpending(data, today).annual,
    ...override,
  };
}

// ─── Projection ──────────────────────────────────────────────────────────────

export interface ProjectionPoint {
  year: number;
  age: number;
  /** Years from now (0 = today). */
  offset: number;
  /** Projected balance in future dollars at the central return. */
  nominal: Cents;
  /** The same balance in today's dollars. */
  real: Cents;
  /** Same contributions at the low / high return of the band. */
  low: Cents;
  high: Cents;
  /** Money paid in so far, cumulative. */
  contributed: Cents;
}

export interface RetirementProjection {
  assumptions: RetirementAssumptions;
  startYear: number;
  startBalance: Cents;
  /** Today through the retirement year, one point per year. */
  points: ProjectionPoint[];
  /** The point at the retirement age (the last point). */
  atRetirement: ProjectionPoint;
  years: number;
  totalContributions: Cents;
  /** Growth = balance − starting balance − contributions. */
  growth: Cents;
  /** Balance at retirement across the return band. */
  band: { low: Cents; mid: Cents; high: Cents; lowRate: number; midRate: number; highRate: number };
  /** Yearly income the balance supports at the withdrawal rate. */
  income: { nominal: Cents; real: Cents };
}

function grow(balance: Cents, contribution: Cents, rate: number): Cents {
  return Math.round(balance * (1 + rate) + contribution * (1 + rate / 2));
}

/**
 * Projects the balance forward one year at a time. `retirementAge` at or
 * below `currentAge` yields a single point: today.
 */
export function projectRetirement(startBalance: Cents, assumptions: RetirementAssumptions, today: ISODate): RetirementProjection {
  const { currentAge, retirementAge, returnRate, inflation, withdrawalRate, monthlyContribution } = assumptions;
  const startYear = Number(today.slice(0, 4));
  const years = Math.max(0, Math.min(MAX_AGE, retirementAge) - currentAge);
  const yearly = monthlyContribution * 12;
  const mid = returnRate / 100;
  const low = RETURN_BAND.low / 100;
  const high = RETURN_BAND.high / 100;

  const points: ProjectionPoint[] = [];
  let nominal = startBalance;
  let lowBalance = startBalance;
  let highBalance = startBalance;
  let contributed = 0;
  for (let offset = 0; offset <= years; offset++) {
    if (offset > 0) {
      nominal = grow(nominal, yearly, mid);
      lowBalance = grow(lowBalance, yearly, low);
      highBalance = grow(highBalance, yearly, high);
      contributed += yearly;
    }
    points.push({
      year: startYear + offset,
      age: currentAge + offset,
      offset,
      nominal,
      real: Math.round(nominal / Math.pow(1 + inflation / 100, offset)),
      low: lowBalance,
      high: highBalance,
      contributed,
    });
  }

  const atRetirement = points[points.length - 1];
  return {
    assumptions,
    startYear,
    startBalance,
    points,
    atRetirement,
    years,
    totalContributions: atRetirement.contributed,
    growth: atRetirement.nominal - startBalance - atRetirement.contributed,
    band: {
      low: atRetirement.low,
      mid: atRetirement.nominal,
      high: atRetirement.high,
      lowRate: RETURN_BAND.low,
      midRate: returnRate,
      highRate: RETURN_BAND.high,
    },
    income: {
      nominal: Math.round((atRetirement.nominal * withdrawalRate) / 100),
      real: Math.round((atRetirement.real * withdrawalRate) / 100),
    },
  };
}

// ─── Financial independence ──────────────────────────────────────────────────

/** Years until `balance` reaches `target`, growing at `rate` with `yearly` added. */
export function yearsToTarget(balance: Cents, target: Cents, yearly: Cents, rate: number, cap = 80): number | null {
  if (balance >= target) return 0;
  let value = balance;
  for (let year = 1; year <= cap; year++) {
    const next = grow(value, yearly, rate);
    // Going nowhere (or backwards) can never arrive.
    if (next <= value && next < target) return null;
    value = next;
    if (value >= target) return year;
  }
  return null;
}

export interface FiScenario {
  label: string;
  /** Savings rate as a fraction of income. */
  savingsRate: number;
  annualSavings: Cents;
  years: number | null;
  year: number | null;
  age: number | null;
}

export interface FiNumbers {
  /** Spending the target is built from, per year and per month. */
  annualSpending: Cents;
  monthlySpending: Cents;
  /** 25× at a 4% withdrawal rate. */
  multiple: number;
  withdrawalRate: number;
  target: Cents;
  current: Cents;
  progress: number;
  /** `annualSavings` as a share of the income on record; 0 without income. */
  savingsRate: number;
  annualIncome: Cents;
  /** What the countdown puts in per year: the contribution assumption × 12. */
  annualSavings: Cents;
  /** The same figure per month — the "Invested each month" assumption. */
  monthlyContribution: Cents;
  /** Income − spending over the same 12 months, for context only. */
  recordedSurplus: Cents;
  /** Real (after-inflation) return used for the countdown. */
  realReturn: number;
  years: number | null;
  year: number | null;
  age: number | null;
  /** The same countdown with the savings rate 5 points lower / higher. */
  scenarios: FiScenario[];
  /** False when there is no income on record, so the rate is unknown. */
  hasIncome: boolean;
}

/**
 * The classic FI figures. Everything is in **today's dollars**: the target
 * doesn't move, and the balance grows at the real (after-inflation) return,
 * so "years to FI" means years of purchasing power, not of nominal dollars.
 *
 * There is one savings story on this screen. The countdown puts in exactly
 * what the projection puts in — `assumptions.monthlyContribution` × 12 — so
 * setting "Invested each month" to nothing moves the hero and this together.
 * The measured income is still used, but only to express that figure as a
 * rate and to shift it by five points in the what-if scenarios.
 */
export function fiNumbers(data: LedgerData, today: ISODate, assumptions: RetirementAssumptions, current: Cents): FiNumbers {
  const { income, saved, hasIncome } = savingsRateOf(data, today);
  const multiple = targetMultiple(assumptions.withdrawalRate);
  const target = Math.round(assumptions.annualSpending * multiple);
  const real = realRate(assumptions.returnRate, assumptions.inflation);
  const startYear = Number(today.slice(0, 4));
  const annualSavings = assumptions.monthlyContribution * 12;
  const rate = income > 0 ? annualSavings / income : 0;

  const run = (label: string, savingsRate: number, annualSavings: Cents): FiScenario => {
    const years = target > 0 ? yearsToTarget(current, target, annualSavings, real) : 0;
    return {
      label,
      savingsRate,
      annualSavings,
      years,
      year: years === null ? null : startYear + years,
      age: years === null ? null : assumptions.currentAge + years,
    };
  };

  const base = run('Current pace', rate, annualSavings);
  const scenarios = hasIncome
    ? [
        run('Save 5 points less', rate - 0.05, Math.round(income * (rate - 0.05))),
        base,
        run('Save 5 points more', rate + 0.05, Math.round(income * (rate + 0.05))),
      ]
    : [base];

  return {
    annualSpending: assumptions.annualSpending,
    monthlySpending: Math.round(assumptions.annualSpending / 12),
    multiple,
    withdrawalRate: assumptions.withdrawalRate,
    target,
    current,
    progress: target > 0 ? Math.max(0, current / target) : 0,
    savingsRate: rate,
    annualIncome: income,
    annualSavings,
    monthlyContribution: assumptions.monthlyContribution,
    recordedSurplus: saved,
    realReturn: real,
    years: base.years,
    year: base.year,
    age: base.age,
    scenarios,
    hasIncome,
  };
}

// ─── Everything at once ──────────────────────────────────────────────────────

export interface RetirementOutlook {
  assumptions: RetirementAssumptions;
  balance: RetirementBalance;
  contributions: ContributionRate;
  spending: SpendingRate;
  projection: RetirementProjection;
  fi: FiNumbers;
  /** No investment accounts and nothing contributed: the screen shows an empty state. */
  isEmpty: boolean;
}

export function retirementOutlook(data: LedgerData, today: ISODate, override: Partial<RetirementAssumptions> = {}): RetirementOutlook {
  const assumptions = defaultAssumptions(data, today, override);
  const balance = retirementBalance(data, today);
  const contributions = contributionRate(data, today);
  const spending = annualSpending(data, today);
  const projection = projectRetirement(balance.total, assumptions, today);
  return {
    assumptions,
    balance,
    contributions,
    spending,
    projection,
    fi: fiNumbers(data, today, assumptions, balance.total),
    isEmpty: !balance.hasAccounts && contributions.monthly === 0,
  };
}

/** Investment accounts, for listing what the starting balance is made of. */
export const investmentAccountIds = (data: LedgerData): ID[] =>
  data.accounts.filter((a) => !a.archived && isInvestment(a.type)).map((a) => a.id);
