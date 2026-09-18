import { describe, expect, it } from 'vitest';

import { financialSnapshot } from '../affordability';
import { createId, emptyLedger } from '../factory';
import { moneyCheckup } from '../health';
import { periodHasData, trackedDays, trackingStartDate } from '../position';
import { investmentActivity, periodStats, savingsRate, spendableIncome, trailingYear } from '../reports';
import { savingsRateOf } from '../retirement';
import { buildSampleLedger } from '../sample';
import type { Account, Asset, LedgerData, Transaction } from '../types';

/**
 * Cross-screen consistency: one savings rate, one meaning for "was anything
 * tracked", and payroll retirement deposits counted once.
 */

const TODAY = '2026-09-17';
const stamp = '2024-01-01T00:00:00.000Z';

const account = (id: string, type: Account['type'], startingDate = '2026-01-01'): Account => ({
  id,
  name: id,
  type,
  startingBalance: 0,
  startingDate,
  spendable: type === 'checking',
  color: '#000',
  icon: 'box',
  tags: [],
  archived: false,
  createdAt: stamp,
  updatedAt: stamp,
});

const tx = (partial: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'date' | 'accountId'>): Transaction => ({
  id: createId('tx'),
  description: 'test',
  tags: [],
  attachments: [],
  createdAt: stamp,
  updatedAt: stamp,
  ...partial,
});

/** A checking account, a 401(k) and a brokerage, all opened 1 Jan 2026. */
function ledger(): LedgerData {
  const d = emptyLedger();
  d.accounts = [account('chk', 'checking'), account('k401', '401k'), account('brk', 'brokerage')];
  return d;
}

describe('trackingStartDate', () => {
  it('ignores asset valuations: an old car is not an old ledger', () => {
    const d = ledger();
    const car: Asset = {
      id: 'asset_car',
      name: 'Car',
      type: 'vehicle',
      purchaseDate: '2021-06-12',
      valuations: [{ id: createId('val'), date: '2021-06-12', value: 2_000_000 }],
      tags: [],
      archived: false,
      createdAt: stamp,
      updatedAt: stamp,
    };
    d.assets = [car];
    d.transactions = [tx({ type: 'expense', amount: 1000, date: '2026-02-01', accountId: 'chk' })];
    expect(trackingStartDate(d)).toBe('2026-01-01');
    // The car's 2021 purchase must not make 2025 look like a year with data.
    expect(periodHasData(d, '2025-01-01', '2025-12-31')).toBe(false);
    expect(periodHasData(d, '2026-01-01', '2026-12-31')).toBe(true);
  });

  it('counts a transaction recorded before any account was opened', () => {
    const d = ledger();
    d.transactions = [tx({ type: 'expense', amount: 1000, date: '2025-11-05', accountId: 'chk' })];
    expect(trackingStartDate(d)).toBe('2025-11-05');
    expect(periodHasData(d, '2025-01-01', '2025-12-31')).toBe(true);
  });

  it('counts only the tracked part of a period', () => {
    const d = ledger();
    d.transactions = [tx({ type: 'expense', amount: 1000, date: '2026-02-01', accountId: 'chk' })];
    // 2026 opened on 1 Jan, so every day of January is tracked.
    expect(trackedDays(d, '2026-01-01', '2026-01-31')).toBe(31);
    // Nothing was tracked in 2025.
    expect(trackedDays(d, '2025-01-01', '2025-12-31')).toBe(0);
    // Half in, half out.
    expect(trackedDays(d, '2025-12-25', '2026-01-05')).toBe(5);
  });

  it('is empty for an empty ledger', () => {
    expect(trackingStartDate(emptyLedger())).toBeNull();
    expect(periodHasData(emptyLedger(), '2026-01-01', '2026-12-31')).toBe(false);
  });
});

describe('investment activity', () => {
  /** $500 of payroll 401(k), $2,000 transferred in, $90.81 of real dividends. */
  function invested(): LedgerData {
    const d = ledger();
    d.transactions = [
      tx({ type: 'income', amount: 50_000, date: '2026-03-15', accountId: 'k401', categoryId: 'income.paycheck', description: '401(k) payroll contribution' }),
      tx({ type: 'investment_contribution', amount: 200_000, date: '2026-03-20', accountId: 'chk', toAccountId: 'brk' }),
      tx({ type: 'income', amount: 9_081, date: '2026-04-01', accountId: 'brk', categoryId: 'income.dividends', description: 'Dividend' }),
      // Ordinary pay into checking is neither.
      tx({ type: 'income', amount: 500_000, date: '2026-04-15', accountId: 'chk', categoryId: 'income.paycheck' }),
    ];
    return d;
  }

  it('counts a payroll 401(k) deposit as a contribution, never as dividends', () => {
    const a = investmentActivity(invested(), '2026-01-01', TODAY);
    expect(a.income).toBe(9_081);
    expect(a.payroll).toBe(50_000);
    expect(a.transferred).toBe(200_000);
    expect(a.contributions).toBe(250_000);
    // The same transaction can never be in both buckets.
    expect(a.contributions + a.income).toBe(50_000 + 200_000 + 9_081);
  });

  it('counts interest and realised gains as investment income', () => {
    const d = invested();
    d.transactions.push(
      tx({ type: 'income', amount: 1_200, date: '2026-05-01', accountId: 'brk', categoryId: 'income.interest' }),
      tx({ type: 'income', amount: 40_000, date: '2026-05-02', accountId: 'brk', categoryId: 'income.capital_gains' }),
    );
    expect(investmentActivity(d, '2026-01-01', TODAY).income).toBe(9_081 + 1_200 + 40_000);
  });

  it('leaves spendable income without the money that never arrives', () => {
    const d = invested();
    const stats = periodStats(d, '2026-01-01', TODAY);
    // All four income lines count as income…
    expect(stats.income).toBe(50_000 + 9_081 + 500_000);
    // …but the payroll 401(k) deposit is not cash that can be spent.
    expect(spendableIncome(d, '2026-01-01', TODAY)).toBe(stats.income - 50_000);
  });

  it('finds only real dividends in the sample ledger', () => {
    const data = buildSampleLedger(TODAY);
    const a = investmentActivity(data, '2026-01-01', TODAY);
    const allIncomeIntoInvestments = data.transactions
      .filter((t) => t.type === 'income' && ['acc_401k', 'acc_hsa', 'acc_roth', 'acc_brokerage'].includes(t.accountId) && t.date >= '2026-01-01' && t.date <= TODAY)
      .reduce((total, t) => total + t.amount, 0);
    expect(a.payroll).toBeGreaterThan(0);
    // The old screen showed everything above; dividends are a tiny slice of it.
    expect(a.income).toBeLessThan(allIncomeIntoInvestments / 10);
    expect(a.income + a.payroll).toBe(allIncomeIntoInvestments);
  });
});

describe('one savings rate', () => {
  it('is income minus spending over income, and transfers never move it', () => {
    const d = ledger();
    d.transactions = [
      tx({ type: 'income', amount: 400_000, date: '2026-02-01', accountId: 'chk', categoryId: 'income.paycheck' }),
      tx({ type: 'expense', amount: 300_000, date: '2026-02-02', accountId: 'chk', categoryId: 'food.groceries' }),
    ];
    const before = savingsRate(d, '2026-01-01', TODAY);
    expect(before.rate).toBeCloseTo(0.25, 6);
    d.transactions.push(tx({ type: 'investment_contribution', amount: 100_000, date: '2026-02-03', accountId: 'chk', toAccountId: 'brk' }));
    expect(savingsRate(d, '2026-01-01', TODAY).rate).toBeCloseTo(0.25, 6);
  });

  it('gives the Money checkup and Retirement the same number', () => {
    const data = buildSampleLedger(TODAY);
    const window = trailingYear(TODAY);
    const shared = savingsRate(data, window.from, window.to);
    expect(savingsRateOf(data, TODAY).rate).toBeCloseTo(shared.rate, 10);
    const shown = moneyCheckup(data, TODAY).metrics.find((m) => m.key === 'savings_rate');
    expect(shown?.display).toBe(`${Math.round(shared.rate * 100)}%`);
    // The label has to say which window it measured.
    expect(shown?.label).toContain('12 months');
  });

  it('reports no rate when nothing came in', () => {
    expect(savingsRate(emptyLedger(), '2026-01-01', TODAY).hasIncome).toBe(false);
    expect(moneyCheckup(emptyLedger(), TODAY).metrics.find((m) => m.key === 'savings_rate')?.status).toBe('na');
  });
});

describe('afford and the checkup agree', () => {
  const data = buildSampleLedger(TODAY);

  it('does not report a deficit while every month is in the green', () => {
    const snapshot = financialSnapshot(data, TODAY);
    const checkup = moneyCheckup(data, TODAY);
    const cashFlow = checkup.metrics.find((m) => m.key === 'cash_flow')!;
    expect(cashFlow.status).toBe('strong');
    expect(snapshot.surplus).toBeGreaterThan(0);
  });

  it('measures take-home over the same months as spending', () => {
    const snapshot = financialSnapshot(data, TODAY);
    expect(snapshot.takeHomeBasis).toBe('measured');
    // June–August 2026 are the last three complete months.
    const measured = Math.round(spendableIncome(data, '2026-06-01', '2026-08-31') / 3);
    expect(snapshot.takeHome).toBe(measured);
    expect(snapshot.surplus).toBe(snapshot.takeHome - snapshot.spending - snapshot.debtPayments);
  });

  it('falls back to scheduled pay before three complete months exist', () => {
    const d = ledger();
    d.accounts = d.accounts.map((a) => ({ ...a, startingDate: '2026-08-01' }));
    d.incomeSources = [
      {
        id: 'inc_1',
        name: 'Job',
        type: 'salary',
        active: true,
        frequency: { unit: 'month', interval: 1 },
        expectedNet: 400_000,
        depositAccountId: 'chk',
        tags: [],
        createdAt: stamp,
        updatedAt: stamp,
      },
    ];
    const snapshot = financialSnapshot(d, TODAY);
    expect(snapshot.takeHomeBasis).toBe('scheduled');
    expect(snapshot.takeHome).toBe(400_000);
  });
});
