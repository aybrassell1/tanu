import { describe, expect, it } from 'vitest';

import { emptyLedger } from '../factory';
import { buildSampleLedger } from '../sample';
import { taxReminders, contributionLimits, documentChecklist, estimatedPaymentPlan, estimatedPaymentsFor, estimateTaxes, suggestedDocuments, taxCalendar, taxTaggedTransactions } from '../taxes';
import { estimatedPaymentDueDates, mileageRateOn, taxTableFor } from '../taxTables';
import type { Account, AccountType, LedgerData, TaxProfile, Transaction } from '../types';

const stamp = '2026-01-01T00:00:00.000Z';
const YEAR_END = '2026-12-31';
let seq = 0;

function acct(id: string, type: AccountType, startingBalance = 0, extra: Partial<Account> = {}): Account {
  return { id, name: id, type, startingBalance, startingDate: '2026-01-01', color: '#000', icon: 'box', tags: [], archived: false, createdAt: stamp, updatedAt: stamp, ...extra };
}
function tx(p: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'accountId'>): Transaction {
  seq++;
  return { id: `t${seq}`, date: '2026-06-01', description: 'test', tags: [], attachments: [], createdAt: stamp, updatedAt: stamp, ...p };
}
function ledger(transactions: Transaction[], profile: Partial<TaxProfile> = {}, accounts: Account[] = []): LedgerData {
  const d = emptyLedger();
  d.accounts = [acct('chk', 'checking', 10_000_000, { spendable: true }), ...accounts];
  d.transactions = transactions;
  d.taxProfile = { ...d.taxProfile, ...profile };
  return d;
}
const wages = (gross: number, extra: Partial<Transaction> = {}) => tx({ type: 'income', amount: gross, grossAmount: gross, accountId: 'chk', categoryId: 'income.paycheck', ...extra });

describe('tax tables', () => {
  it('uses published tables and falls back for unknown years', () => {
    expect(taxTableFor(2026)).toMatchObject({ exact: true });
    expect(taxTableFor(2031).table.year).toBe(2026);
    expect(taxTableFor(2031).exact).toBe(false);
  });

  it('rolls weekend due dates and switches the 2026 mileage rate mid-year', () => {
    // Jan 15 2028 is a Saturday and Monday the 17th is MLK Day.
    expect(estimatedPaymentDueDates(2027)[3].due).toBe('2028-01-18');
    const { table } = taxTableFor(2026);
    expect(mileageRateOn(table, '2026-06-30', 'business')).toBe(72.5);
    expect(mileageRateOn(table, '2026-07-01', 'business')).toBe(76);
  });
});

describe('estimateTaxes', () => {
  it('taxes W-2 wages after pre-tax deductions and compares with withholding', () => {
    const d = ledger([wages(8_000_000, { amount: 5_000_000, withholding: { federal: 800_000, retirement: 500_000 } })]);
    const e = estimateTaxes(d, 2026, YEAR_END, 'ytd');
    expect(e.agi).toBe(7_500_000);
    expect(e.usedItemized).toBe(false);
    expect(e.taxableIncome).toBe(5_890_000);
    // 10% of 12,400 + 12% of 38,000 + 22% of 8,500.
    expect(e.incomeTax).toBe(767_000);
    expect(e.totalTax).toBe(767_000);
    expect(e.refund).toBe(33_000);
    expect(e.marginalRate).toBe(0.22);
    expect(e.preTaxSavings).toBe(500_000);
  });

  it('computes self-employment tax, its half deduction and QBI', () => {
    const d = ledger([
      tx({ type: 'income', amount: 5_000_000, accountId: 'chk', categoryId: 'income.freelance', payee: 'Client A' }),
      tx({ type: 'expense', amount: 1_000_000, accountId: 'chk', categoryId: 'business.software' }),
    ]);
    const e = estimateTaxes(d, 2026, YEAR_END, 'ytd');
    expect(e.selfEmploymentProfit).toBe(4_000_000);
    expect(e.selfEmploymentTax).toBe(565_182);
    expect(e.agi).toBe(4_000_000 - 282_591);
    expect(e.otherDeductions.find((l) => l.key === 'qbi')!.amount).toBe(421_482);
    expect(e.taxableIncome).toBe(1_685_927);
    expect(e.totalTax).toBe(177_511 + 565_182);
    expect(e.refund).toBe(-(177_511 + 565_182));
  });

  it('stacks long-term gains on top of ordinary income', () => {
    const d = ledger([wages(4_000_000)]);
    d.taxYears = [{ year: 2026, documents: [], mileage: [], adjustments: [{ id: 'g', kind: 'capital_gain_long', label: 'Index fund sale', amount: 2_000_000 }] }];
    const e = estimateTaxes(d, 2026, YEAR_END, 'ytd');
    expect(e.taxableIncome).toBe(4_390_000);
    // The whole gain fits inside the 0% band; ordinary tax is on $23,900.
    expect(e.incomeTax).toBe(262_000);
  });

  it('limits net capital losses to $3,000', () => {
    const d = ledger([wages(6_000_000)]);
    d.taxYears = [{ year: 2026, documents: [], mileage: [], adjustments: [{ id: 'l', kind: 'capital_gain_long', label: 'Loss', amount: -500_000 }] }];
    const e = estimateTaxes(d, 2026, YEAR_END, 'ytd');
    expect(e.totalIncome).toBe(6_000_000 - 300_000);
  });

  it('applies the child tax credit with its refundable portion', () => {
    const d = ledger([wages(6_000_000)], { filingStatus: 'married_joint', dependentsUnder17: 2 });
    const e = estimateTaxes(d, 2026, YEAR_END, 'ytd');
    expect(e.incomeTax).toBe(284_000);
    expect(e.totalTax).toBe(0);
    expect(e.payments.find((p) => p.key === 'refundable_ctc')!.amount).toBe(156_000);
    expect(e.refund).toBe(156_000);
  });

  it('itemizes when mortgage interest, SALT and giving beat the standard deduction', () => {
    const d = ledger(
      [
        wages(20_000_000, { withholding: { federal: 3_000_000, state: 1_200_000 } }),
        tx({ type: 'interest', amount: 1_500_000, accountId: 'mort' }),
        tx({ type: 'expense', amount: 800_000, accountId: 'chk', categoryId: 'housing.property_tax' }),
        tx({ type: 'expense', amount: 200_000, accountId: 'chk', categoryId: 'giving.charity' }),
        // Reviewed as not tax related: ignored.
        tx({ type: 'expense', amount: 999_900, accountId: 'chk', categoryId: 'giving.charity', taxRelated: false }),
      ],
      {},
      [acct('mort', 'mortgage', 30_000_000)],
    );
    const e = estimateTaxes(d, 2026, YEAR_END, 'ytd');
    expect(e.itemizedTotal).toBe(1_500_000 + 2_000_000 + 200_000);
    expect(e.usedItemized).toBe(true);
    expect(e.taxableIncome).toBe(20_000_000 - 3_700_000);
    expect(e.state).toEqual({ tax: 0, paid: 1_200_000, refund: 1_200_000 });
  });

  it('caps SALT and respects a forced standard deduction', () => {
    const d = ledger([wages(20_000_000), tx({ type: 'expense', amount: 6_000_000, accountId: 'chk', categoryId: 'housing.property_tax' })]);
    expect(estimateTaxes(d, 2026, YEAR_END, 'ytd').itemized.find((l) => l.key === 'salt')!.amount).toBe(4_040_000);
    d.taxProfile.deduction = 'standard';
    expect(estimateTaxes(d, 2026, YEAR_END, 'ytd').usedItemized).toBe(false);
  });

  it('ignores deposits into retirement accounts and nontaxable income', () => {
    const d = ledger(
      [wages(5_000_000), tx({ type: 'income', amount: 900_000, accountId: 'k401', categoryId: 'income.paycheck' }), tx({ type: 'income', amount: 50_000, accountId: 'chk', categoryId: 'income.gifts' })],
      {},
      [acct('k401', '401k')],
    );
    expect(estimateTaxes(d, 2026, YEAR_END, 'ytd').totalIncome).toBe(5_000_000);
  });

  it('projects the rest of the year from scheduled paychecks', () => {
    const d = ledger([wages(300_000, { date: '2026-01-02', incomeSourceId: 'job', withholding: { federal: 30_000 } })]);
    d.incomeSources = [
      { id: 'job', name: 'Job', type: 'salary', frequency: { unit: 'month', interval: 1 }, anchorDate: '2026-01-02', expectedGross: 300_000, expectedNet: 250_000, withholding: { federal: 30_000 }, depositAccountId: 'chk', categoryId: 'income.paycheck', active: true, tags: [], createdAt: stamp, updatedAt: stamp },
    ];
    const ytd = estimateTaxes(d, 2026, '2026-01-15', 'ytd');
    const projected = estimateTaxes(d, 2026, '2026-01-15', 'projected');
    expect(ytd.totalIncome).toBe(300_000);
    expect(projected.totalIncome).toBe(3_600_000);
    expect(projected.totalPayments).toBe(360_000);
  });
});

describe('estimated payments', () => {
  it('counts a January payment toward the previous tax year', () => {
    const pay = (date: string) => tx({ type: 'expense', amount: 100_000, date, accountId: 'chk', categoryId: 'taxes.federal_estimated' });
    const d = ledger([pay('2026-01-10'), pay('2026-04-15'), pay('2027-01-14')]);
    expect(estimatedPaymentsFor(d, 2026).map((t) => t.date)).toEqual(['2026-04-15', '2027-01-14']);
    expect(estimatedPaymentsFor(d, 2025).map((t) => t.date)).toEqual(['2026-01-10']);
  });

  it('suggests quarterly amounts using the prior-year safe harbor', () => {
    const d = ledger([tx({ type: 'income', amount: 6_000_000, accountId: 'chk', categoryId: 'income.freelance' })], { priorYearTax: 400_000, priorYearAgi: 5_000_000 });
    const e = estimateTaxes(d, 2026, YEAR_END, 'ytd');
    const plan = estimatedPaymentPlan(d, e, '2026-03-01');
    expect(plan.needsPayments).toBe(true);
    expect(plan.required).toBe(400_000);
    expect(plan.quarters.map((q) => q.suggested)).toEqual([100_000, 100_000, 100_000, 100_000]);
    // After a missed Q1, the remaining three quarters absorb it.
    const late = estimatedPaymentPlan(d, e, '2026-05-01');
    expect(late.quarters.map((q) => [q.status, q.suggested])).toEqual([['missed', 100_000], ['upcoming', 133_333], ['upcoming', 133_333], ['upcoming', 133_333]]);
    expect(plan.quarters[0].status).toBe('upcoming');
  });

  it('says payments are not needed when withholding covers the tax', () => {
    const d = ledger([wages(5_000_000, { withholding: { federal: 600_000 } })]);
    const plan = estimatedPaymentPlan(d, estimateTaxes(d, 2026, YEAR_END, 'ytd'), '2026-03-01');
    expect(plan.needsPayments).toBe(false);
    expect(plan.quarters.every((q) => q.status === 'not_needed')).toBe(true);
  });
});

describe('reminders', () => {
  it('reminds about an upcoming estimated payment and filing season', () => {
    const d = ledger([tx({ type: 'income', amount: 6_000_000, date: '2026-02-01', accountId: 'chk', categoryId: 'income.freelance' })]);
    const fmt = (c: number) => String(c);
    expect(taxReminders(d, '2026-06-05', fmt).map((r) => r.id)).toEqual(['tax:est:2026:2']);
    expect(taxReminders(d, '2026-05-01', fmt)).toEqual([]);
    const season = taxReminders(d, '2026-03-01', fmt);
    expect(season.map((r) => r.id)).toContain('tax:file:2025');
    d.taxYears = [{ year: 2025, documents: [], adjustments: [], mileage: [], filedOn: '2026-02-20' }];
    expect(taxReminders(d, '2026-03-01', fmt).map((r) => r.id)).not.toContain('tax:file:2025');
  });
});

describe('records', () => {
  it('suggests documents from income sources and accounts', () => {
    const d = ledger(
      [
        wages(500_000, { incomeSourceId: 'job' }),
        tx({ type: 'income', amount: 100_000, accountId: 'chk', categoryId: 'income.freelance', incomeSourceId: 'gig', payee: 'Northwind' }),
        tx({ type: 'interest', amount: 50_000, accountId: 'mort' }),
      ],
      {},
      [acct('mort', 'mortgage', 1_000_000, { institution: 'Rocket' })],
    );
    d.incomeSources = [
      { id: 'job', name: 'Job', employer: 'Acme', type: 'salary', depositAccountId: 'chk', categoryId: 'income.paycheck', active: true, tags: [], createdAt: stamp, updatedAt: stamp },
      { id: 'gig', name: 'Design', type: 'freelance', depositAccountId: 'chk', categoryId: 'income.freelance', active: true, tags: [], createdAt: stamp, updatedAt: stamp },
    ];
    const docs = suggestedDocuments(d, 2026);
    expect(docs.map((x) => `${x.form}:${x.issuer}`)).toEqual(['W-2:Acme', '1099-NEC:Northwind', '1098:Rocket']);
    d.taxYears = [{ year: 2026, adjustments: [], mileage: [], documents: [{ key: 'w2:job', form: 'W-2', issuer: 'Acme', status: 'received', attachments: [], custom: false }, { key: 'k1', form: 'K-1', issuer: 'Fund', status: 'expected', attachments: [], custom: true }] }];
    const list = documentChecklist(d, 2026);
    expect(list.find((x) => x.key === 'w2:job')!.status).toBe('received');
    expect(list.map((x) => x.form)).toContain('K-1');
  });

  it('tracks retirement and HSA contributions against limits', () => {
    const d = ledger([wages(500_000, { withholding: { retirement: 1_000_000, hsa: 100_000 } }), tx({ type: 'transfer', amount: 300_000, accountId: 'chk', toAccountId: 'roth' })], { hsaCoverage: 'family', age50Plus: true }, [acct('roth', 'roth_ira')]);
    const limits = contributionLimits(d, 2026);
    expect(limits.find((l) => l.key === '401k')).toMatchObject({ contributed: 1_000_000, limit: 3_250_000 });
    expect(limits.find((l) => l.key === 'ira')).toMatchObject({ contributed: 300_000, limit: 860_000, applicable: true });
    expect(limits.find((l) => l.key === 'hsa')).toMatchObject({ contributed: 100_000, limit: 875_000 });
  });

  it('groups tax-tagged spending and flags unreviewed suggestions', () => {
    const d = ledger([
      tx({ type: 'expense', amount: 10_000, accountId: 'chk', categoryId: 'health.dental' }),
      tx({ type: 'expense', amount: 5_000, accountId: 'chk', categoryId: 'giving.charity', taxRelated: true, taxCategory: 'charitable' }),
      tx({ type: 'expense', amount: 7_000, accountId: 'chk', categoryId: 'food.groceries' }),
    ]);
    const { groups, possible } = taxTaggedTransactions(d, 2026);
    expect(groups.map((g) => [g.tag, g.total])).toEqual([['medical', 10_000], ['charitable', 5_000]]);
    expect(possible).toHaveLength(1);
  });

  it('lists key dates in order', () => {
    const dates = taxCalendar(2026).map((x) => x.date);
    expect(dates).toEqual([...dates].sort());
    expect(dates).toContain('2027-04-15');
  });
});

describe('sample ledger', () => {
  it('produces a finite, sensible estimate', () => {
    const today = '2026-09-17';
    const d = buildSampleLedger(today);
    const e = estimateTaxes(d, 2026, today);
    for (const v of [e.agi, e.taxableIncome, e.totalTax, e.refund, e.totalPayments]) expect(Number.isFinite(v)).toBe(true);
    expect(e.missingPaycheckDetail).toBe(0);
    expect(e.agi).toBeGreaterThan(6_000_000);
    expect(e.selfEmploymentProfit).toBeGreaterThan(0);
    expect(suggestedDocuments(d, 2026).some((x) => x.form === 'W-2')).toBe(true);
  });
});
