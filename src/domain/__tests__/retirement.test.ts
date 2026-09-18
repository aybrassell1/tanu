import { describe, expect, it } from 'vitest';

import { addMonths } from '../dates';
import { createId, emptyLedger } from '../factory';
import {
  annualSpending,
  contributionRate,
  defaultAssumptions,
  fiNumbers,
  projectRetirement,
  realRate,
  retirementBalance,
  retirementOutlook,
  targetMultiple,
  yearsToTarget,
  type RetirementAssumptions,
} from '../retirement';
import { buildSampleLedger } from '../sample';
import type { Account, LedgerData, Transaction } from '../types';

const TODAY = '2026-09-16';
const stamp = '2025-01-01T00:00:00.000Z';

const account = (id: string, type: Account['type'], startingBalance: number): Account => ({
  id,
  name: id,
  type,
  startingBalance,
  startingDate: '2024-01-01',
  spendable: type === 'checking',
  color: '#000',
  icon: 'box',
  tags: [],
  archived: false,
  createdAt: stamp,
  updatedAt: stamp,
});

function tx(partial: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'date' | 'accountId'>): Transaction {
  return { id: createId('tx'), description: 'test', tags: [], attachments: [], createdAt: stamp, updatedAt: stamp, ...partial };
}

function ledger(build: (d: LedgerData) => void = () => {}): LedgerData {
  const d = emptyLedger();
  d.accounts = [account('chk', 'checking', 500_000), account('roth', 'roth_ira', 1_000_000), account('k401', '401k', 2_000_000)];
  build(d);
  return d;
}

const assume = (over: Partial<RetirementAssumptions> = {}): RetirementAssumptions => ({
  currentAge: 30,
  retirementAge: 65,
  returnRate: 6,
  inflation: 2.5,
  withdrawalRate: 4,
  monthlyContribution: 0,
  annualSpending: 0,
  ...over,
});

describe('assumption maths', () => {
  it('turns a withdrawal rate into a multiple', () => {
    expect(targetMultiple(4)).toBe(25);
    expect(targetMultiple(5)).toBe(20);
    expect(targetMultiple(0)).toBe(0);
  });

  it('computes the real return after inflation', () => {
    expect(realRate(6, 2.5)).toBeCloseTo(0.034146, 5);
    expect(realRate(3, 3)).toBeCloseTo(0, 10);
  });
});

describe('projectRetirement', () => {
  it('compounds a balance with no contributions', () => {
    const p = projectRetirement(100_000, assume({ currentAge: 30, retirementAge: 33, returnRate: 10, inflation: 0 }), TODAY);
    expect(p.points).toHaveLength(4);
    expect(p.points.map((x) => x.nominal)).toEqual([100_000, 110_000, 121_000, 133_100]);
    expect(p.totalContributions).toBe(0);
    expect(p.growth).toBe(33_100);
    // No inflation, so nominal and real agree.
    expect(p.points.map((x) => x.real)).toEqual(p.points.map((x) => x.nominal));
    expect(p.atRetirement.age).toBe(33);
    expect(p.atRetirement.year).toBe(2029);
  });

  it('adds contributions with a mid-year convention', () => {
    const p = projectRetirement(0, assume({ currentAge: 40, retirementAge: 41, returnRate: 10, inflation: 0, monthlyContribution: 100 }), TODAY);
    // 1,200c paid in across the year earns half a year of growth.
    expect(p.points[1].nominal).toBe(1260);
    expect(p.totalContributions).toBe(1200);
    expect(p.growth).toBe(60);
  });

  it('discounts future dollars back to today', () => {
    const p = projectRetirement(1_000_000, assume({ currentAge: 30, retirementAge: 40, returnRate: 5, inflation: 5 }), TODAY);
    // Growth exactly matches inflation, so purchasing power is flat.
    expect(p.atRetirement.real).toBeCloseTo(1_000_000, -1);
    expect(p.atRetirement.nominal).toBeGreaterThan(1_500_000);
  });

  it('brackets the projection with a 4% / 8% band', () => {
    const p = projectRetirement(1_000_000, assume({ returnRate: 6, monthlyContribution: 50_000 }), TODAY);
    expect(p.band.low).toBeLessThan(p.band.mid);
    expect(p.band.mid).toBeLessThan(p.band.high);
    expect(p.band.lowRate).toBe(4);
    expect(p.band.highRate).toBe(8);
    expect(p.income.nominal).toBe(Math.round((p.atRetirement.nominal * 4) / 100));
  });

  it('yields a single point when retirement age is not ahead', () => {
    const p = projectRetirement(500_000, assume({ currentAge: 70, retirementAge: 65 }), TODAY);
    expect(p.points).toHaveLength(1);
    expect(p.years).toBe(0);
    expect(p.atRetirement.nominal).toBe(500_000);
  });

  it('handles a zero balance and zero contributions without NaN', () => {
    const p = projectRetirement(0, assume(), TODAY);
    expect(p.atRetirement.nominal).toBe(0);
    expect(p.atRetirement.real).toBe(0);
    expect(Number.isFinite(p.income.real)).toBe(true);
  });
});

describe('yearsToTarget', () => {
  it('returns zero when already there', () => {
    expect(yearsToTarget(100, 100, 0, 0.05)).toBe(0);
  });

  it('counts the years of compounding plus saving', () => {
    // 0 + 100/yr at 0% return reaches 500 in five years.
    expect(yearsToTarget(0, 500, 100, 0)).toBe(5);
  });

  it('never arrives when nothing is saved and nothing grows', () => {
    expect(yearsToTarget(0, 100_000, 0, 0.05)).toBeNull();
    expect(yearsToTarget(1000, 100_000, 0, 0)).toBeNull();
  });

  it('never arrives on a negative savings rate that outruns growth', () => {
    expect(yearsToTarget(100_000, 10_000_000, -50_000, 0.05)).toBeNull();
  });

  it('still arrives when growth beats the drawdown', () => {
    expect(yearsToTarget(10_000_000, 12_000_000, -100_000, 0.08)).not.toBeNull();
  });
});

describe('measured inputs', () => {
  it('adds up investment and retirement balances only', () => {
    const balance = retirementBalance(ledger(), TODAY);
    expect(balance.total).toBe(3_000_000);
    expect(balance.accounts.map((a) => a.account.id)).toEqual(['k401', 'roth']);
    expect(balance.hasAccounts).toBe(true);
  });

  it('counts transfers into investments and paycheck retirement withholding', () => {
    const data = ledger((d) => {
      d.transactions = [
        tx({ type: 'investment_contribution', amount: 50_000, date: addMonths(TODAY, -2), accountId: 'chk', toAccountId: 'roth' }),
        tx({ type: 'investment_withdrawal', amount: 20_000, date: addMonths(TODAY, -1), accountId: 'roth', toAccountId: 'chk' }),
        tx({ type: 'income', amount: 300_000, grossAmount: 400_000, date: addMonths(TODAY, -1), accountId: 'chk', withholding: { retirement: 40_000 } }),
        // Too old for the 12-month window.
        tx({ type: 'investment_contribution', amount: 900_000, date: addMonths(TODAY, -20), accountId: 'chk', toAccountId: 'roth' }),
      ];
    });
    const rate = contributionRate(data, TODAY);
    expect(rate.fromTransfers).toBe(30_000);
    expect(rate.fromPaycheck).toBe(40_000);
    expect(rate.monthly).toBe(Math.round(70_000 / 12));
  });

  it('counts pre-tax HSA payroll money, because the HSA balance is counted too', () => {
    const data = ledger((d) => {
      d.accounts = [...d.accounts, account('hsa', 'hsa', 300_000)];
      d.transactions = [
        tx({ type: 'income', amount: 300_000, grossAmount: 400_000, date: addMonths(TODAY, -1), accountId: 'chk', withholding: { retirement: 40_000, hsa: 10_000 } }),
      ];
    });
    const rate = contributionRate(data, TODAY);
    expect(rate.fromHsa).toBe(10_000);
    expect(rate.monthly).toBe(Math.round(50_000 / 12));
    // Every account behind the starting balance is named, so the screen can say so.
    expect(rate.accountNames).toContain('hsa');
    expect(retirementBalance(data, TODAY).accounts.map((a) => a.account.id)).toContain('hsa');
  });

  it('ignores HSA withholding when there is no HSA account to put it in', () => {
    const data = ledger((d) => {
      d.transactions = [
        tx({ type: 'income', amount: 300_000, grossAmount: 400_000, date: addMonths(TODAY, -1), accountId: 'chk', withholding: { retirement: 40_000, hsa: 10_000 } }),
      ];
    });
    const rate = contributionRate(data, TODAY);
    expect(rate.fromHsa).toBe(0);
    expect(rate.monthly).toBe(Math.round(40_000 / 12));
  });

  it('reports the employer match without folding it into contributions', () => {
    const data = ledger((d) => {
      d.incomeSources = [
        {
          id: 'src',
          name: 'Job',
          type: 'salary',
          depositAccountId: 'chk',
          match: { percent: 100, upToPercent: 5 },
          active: true,
          tags: [],
          createdAt: stamp,
          updatedAt: stamp,
        },
      ];
      d.transactions = [
        tx({ type: 'income', amount: 300_000, grossAmount: 400_000, date: addMonths(TODAY, -1), accountId: 'chk', incomeSourceId: 'src', withholding: { retirement: 40_000 } }),
      ];
    });
    const rate = contributionRate(data, TODAY);
    // 10% contributed, matched up to 5% of $4,000 gross = $200.
    expect(rate.employerMatch).toBe(20_000);
    expect(rate.monthly).toBe(Math.round(40_000 / 12));
  });

  it('annualizes spending when history is shorter than a year', () => {
    const data = ledger((d) => {
      d.accounts = d.accounts.map((a) => ({ ...a, startingDate: addMonths(TODAY, -3) }));
      d.transactions = [tx({ type: 'expense', amount: 100_000, date: addMonths(TODAY, -1), accountId: 'chk', categoryId: 'food.groceries' })];
    });
    const spending = annualSpending(data, TODAY);
    expect(spending.annualized).toBe(true);
    expect(spending.annual).toBeGreaterThan(300_000);
    expect(spending.monthly).toBe(Math.round(spending.annual / 12));
  });
});

describe('financial independence numbers', () => {
  const withIncome = (income: number, spending: number) =>
    ledger((d) => {
      d.transactions = [];
      for (let m = 0; m < 12; m++) {
        d.transactions.push(tx({ type: 'income', amount: Math.round(income / 12), date: addMonths(TODAY, -m), accountId: 'chk', categoryId: 'income.salary' }));
        d.transactions.push(tx({ type: 'expense', amount: Math.round(spending / 12), date: addMonths(TODAY, -m), accountId: 'chk', categoryId: 'food.groceries' }));
      }
    });

  it('builds a 25x target from real spending', () => {
    const data = withIncome(10_000_000, 6_000_000);
    const assumptions = defaultAssumptions(data, TODAY, { currentAge: 30, monthlyContribution: 333_333 });
    const fi = fiNumbers(data, TODAY, assumptions, 5_000_000);
    expect(fi.multiple).toBe(25);
    expect(fi.target).toBe(assumptions.annualSpending * 25);
    // $3,333.33 a month out of $100,000 of income is a 40% rate.
    expect(fi.savingsRate).toBeCloseTo(0.4, 2);
    expect(fi.annualSavings).toBe(333_333 * 12);
    expect(fi.progress).toBeCloseTo(5_000_000 / fi.target, 5);
    expect(fi.years).toBeGreaterThan(0);
    expect(fi.year).toBe(2026 + fi.years!);
    expect(fi.age).toBe(30 + fi.years!);
  });

  it('gets there sooner when the savings rate is 5 points higher', () => {
    const data = withIncome(10_000_000, 6_000_000);
    const fi = fiNumbers(data, TODAY, defaultAssumptions(data, TODAY, { monthlyContribution: 333_333 }), 5_000_000);
    const [less, base, more] = fi.scenarios;
    expect(fi.scenarios).toHaveLength(3);
    expect(base.years).toBe(fi.years);
    expect(more.savingsRate).toBeCloseTo(fi.savingsRate + 0.05, 5);
    expect(more.years!).toBeLessThanOrEqual(base.years!);
    expect(less.years!).toBeGreaterThanOrEqual(base.years!);
  });

  it('runs the countdown on the contribution assumption, not on income minus spending', () => {
    // The ledger shows a $40,000 surplus, but nothing of it is invested.
    const data = withIncome(10_000_000, 6_000_000);
    const nothing = fiNumbers(data, TODAY, defaultAssumptions(data, TODAY, { monthlyContribution: 0 }), 5_000_000);
    expect(nothing.recordedSurplus).toBeGreaterThan(3_900_000);
    expect(nothing.annualSavings).toBe(0);
    expect(nothing.savingsRate).toBe(0);
    expect(nothing.years).toBeNull();

    // Putting money in moves the countdown — the same figure the hero uses.
    const investing = fiNumbers(data, TODAY, defaultAssumptions(data, TODAY, { monthlyContribution: 333_333 }), 5_000_000);
    expect(investing.years).not.toBeNull();
    expect(investing.monthlyContribution).toBe(333_333);
  });

  it('says never when nothing is invested and there is nothing to grow', () => {
    const data = withIncome(3_000_000, 5_000_000);
    const fi = fiNumbers(data, TODAY, defaultAssumptions(data, TODAY), 0);
    expect(fi.recordedSurplus).toBeLessThan(0);
    expect(fi.annualSavings).toBe(0);
    expect(fi.years).toBeNull();
    expect(fi.year).toBeNull();
    expect(fi.age).toBeNull();
  });

  it('reports no income rather than a made-up rate on an empty ledger', () => {
    const data = emptyLedger();
    const fi = fiNumbers(data, TODAY, defaultAssumptions(data, TODAY), 0);
    expect(fi.hasIncome).toBe(false);
    expect(fi.target).toBe(0);
    expect(fi.scenarios).toHaveLength(1);
    expect(Number.isFinite(fi.progress)).toBe(true);
  });
});

describe('outlook', () => {
  it('is empty for an empty ledger and never produces NaN', () => {
    const outlook = retirementOutlook(emptyLedger(), TODAY);
    expect(outlook.isEmpty).toBe(true);
    expect(outlook.balance.total).toBe(0);
    expect(outlook.projection.points.every((p) => Number.isFinite(p.nominal) && Number.isFinite(p.real))).toBe(true);
  });

  it('reads the sample ledger end to end', () => {
    const today = '2026-09-16';
    const data = buildSampleLedger(today);
    const outlook = retirementOutlook(data, today, { currentAge: 28, retirementAge: 65 });
    expect(outlook.isEmpty).toBe(false);
    expect(outlook.balance.total).toBeGreaterThan(0);
    expect(outlook.contributions.fromPaycheck).toBeGreaterThan(0);
    // The sample's HSA balance is counted, so its payroll money is counted too.
    expect(outlook.contributions.fromHsa).toBeGreaterThan(0);
    expect(outlook.contributions.accountNames).toContain('HSA');
    expect(outlook.contributions.monthly).toBeGreaterThan(0);
    // One savings story: the FI countdown puts in what the projection puts in.
    expect(outlook.fi.annualSavings).toBe(outlook.assumptions.monthlyContribution * 12);
    expect(outlook.projection.points).toHaveLength(38);
    expect(outlook.projection.atRetirement.nominal).toBeGreaterThan(outlook.balance.total);
    expect(outlook.projection.atRetirement.real).toBeLessThan(outlook.projection.atRetirement.nominal);
    expect(outlook.fi.target).toBeGreaterThan(0);
    expect(outlook.assumptions.returnRate).toBe(data.settings.investmentReturn);
  });

  it('honours overridden assumptions', () => {
    const data = ledger();
    const outlook = retirementOutlook(data, TODAY, { currentAge: 25, retirementAge: 45, returnRate: 7, monthlyContribution: 100_000, annualSpending: 4_000_000 });
    expect(outlook.assumptions.returnRate).toBe(7);
    expect(outlook.projection.years).toBe(20);
    expect(outlook.fi.target).toBe(100_000_000);
  });
});
