import { describe, expect, it } from 'vitest';

import { buildAlerts } from '../alerts';
import { parseBackup, serializeBackup } from '../backup';
import { monthBudgets } from '../budgets';
import { addDays, addMonths, monthOf } from '../dates';
import { simulatePayoff } from '../debt';
import { createId, emptyLedger } from '../factory';
import { buildForecast } from '../forecast';
import { allocatedAmounts, goalProgress } from '../goals';
import { balanceOn, balanceSeries, indexLedger } from '../ledger';
import { parseMoney, formatMoney } from '../money';
import { netWorthOn, spendingPosition } from '../position';
import { monthlyEquivalent, occurrencesBetween } from '../recurrence';
import { periodStats } from '../reports';
import { buildSampleLedger } from '../sample';
import { compareScenario } from '../scenarios';
import { scheduledEvents } from '../schedule';
import { searchLedger } from '../search';
import type { Account, AccountType, LedgerData, RecurringItem, Transaction } from '../types';
import { validateContribution, validateTransaction } from '../validation';

const TODAY = '2026-09-16';
const stamp = '2026-01-01T00:00:00.000Z';

function acct(id: string, type: AccountType, startingBalance: number, extra: Partial<Account> = {}): Account {
  return { id, name: id, type, startingBalance, startingDate: '2026-01-01', color: '#000', icon: 'box', tags: [], archived: false, createdAt: stamp, updatedAt: stamp, ...extra };
}

function tx(partial: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'accountId'>): Transaction {
  return { id: createId('tx'), date: '2026-09-01', description: 'test', tags: [], attachments: [], createdAt: stamp, updatedAt: stamp, ...partial };
}

function ledger(build: (d: LedgerData) => void): LedgerData {
  const d = emptyLedger();
  d.accounts = [acct('chk', 'checking', 100_000, { spendable: true }), acct('sav', 'savings', 50_000), acct('card', 'credit_card', 20_000, { creditLimit: 500_000, dueDay: 25, startingDate: '2026-09-01' })];
  build(d);
  return d;
}

describe('money', () => {
  it('parses input into integer cents', () => {
    expect(parseMoney('17')).toBe(1700);
    expect(parseMoney('$1,234.5')).toBe(123450);
    expect(parseMoney('0.07')).toBe(7);
    expect(parseMoney('-20')).toBe(-2000);
    expect(parseMoney('12.345')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
  });
  it('formats with a true minus sign', () => {
    expect(formatMoney(-150)).toBe('−$1.50');
    expect(formatMoney(1_250_000, { compact: true })).toBe('$12.5K');
  });
});

describe('ledger integrity', () => {
  it('transfers move money without creating income or spending', () => {
    const d = ledger((d) => {
      d.transactions = [tx({ type: 'transfer', amount: 50_000, accountId: 'chk', toAccountId: 'sav' })];
    });
    const i = indexLedger(d);
    expect(balanceOn(i, 'chk', TODAY)).toBe(50_000);
    expect(balanceOn(i, 'sav', TODAY)).toBe(100_000);
    const stats = periodStats(d, '2026-09-01', '2026-09-30');
    expect(stats.income).toBe(0);
    expect(stats.spending).toBe(0);
    expect(stats.toSavings).toBe(50_000);
    expect(netWorthOn(d, TODAY).netWorth).toBe(100_000 + 50_000 - 20_000);
  });

  it('counts a card purchase once and the card payment never', () => {
    const d = ledger((d) => {
      d.transactions = [
        tx({ type: 'expense', amount: 8_000, accountId: 'card', categoryId: 'food.groceries', date: '2026-09-02' }),
        tx({ type: 'debt_payment', amount: 28_000, accountId: 'chk', toAccountId: 'card', date: '2026-09-10' }),
      ];
    });
    const i = indexLedger(d);
    expect(balanceOn(i, 'card', '2026-09-05')).toBe(28_000);
    expect(balanceOn(i, 'card', TODAY)).toBe(0);
    expect(balanceOn(i, 'chk', TODAY)).toBe(72_000);
    const stats = periodStats(d, '2026-09-01', '2026-09-30');
    expect(stats.spending).toBe(8_000);
    expect(stats.debtPayments).toBe(28_000);
    // Net worth only fell by the purchase.
    expect(netWorthOn(d, TODAY).netWorth).toBe(150_000 - 20_000 - 8_000);
  });

  it('refunds offset spending and interest raises what is owed', () => {
    const d = ledger((d) => {
      d.transactions = [
        tx({ type: 'expense', amount: 5_000, accountId: 'card', categoryId: 'clothing.clothes' }),
        tx({ type: 'refund', amount: 2_000, accountId: 'card', categoryId: 'clothing.clothes' }),
        tx({ type: 'interest', amount: 300, accountId: 'card', categoryId: 'financial.interest' }),
      ];
    });
    expect(balanceOn(indexLedger(d), 'card', TODAY)).toBe(20_000 + 5_000 - 2_000 + 300);
    expect(periodStats(d, '2026-09-01', '2026-09-30').spending).toBe(3_300);
  });

  it('balance adjustments change balances but not income or spending', () => {
    const d = ledger((d) => {
      d.transactions = [tx({ type: 'adjustment', amount: -1_234, accountId: 'chk', adjustmentKind: 'reconcile' })];
    });
    expect(balanceOn(indexLedger(d), 'chk', TODAY)).toBe(98_766);
    const s = periodStats(d, '2026-09-01', '2026-09-30');
    expect(s.income + s.spending).toBe(0);
  });

  it('computes balance series consistently with point balances', () => {
    const d = buildSampleLedger(TODAY);
    const i = indexLedger(d);
    const dates = ['2026-01-31', '2026-05-31', TODAY];
    for (const a of d.accounts) {
      expect(balanceSeries(i, a.id, dates)).toEqual(dates.map((x) => balanceOn(i, a.id, x)));
    }
  });

  it('rejects invalid transactions', () => {
    const d = ledger(() => {});
    expect(validateTransaction(d, tx({ type: 'transfer', amount: 100, accountId: 'chk', toAccountId: 'chk' })).toAccountId).toBeTruthy();
    expect(validateTransaction(d, tx({ type: 'debt_payment', amount: 100, accountId: 'chk', toAccountId: 'sav' })).toAccountId).toBeTruthy();
    expect(validateTransaction(d, tx({ type: 'income', amount: 100, accountId: 'chk', categoryId: 'food.coffee' })).categoryId).toBeTruthy();
    expect(Object.keys(validateTransaction(d, tx({ type: 'expense', amount: 100, accountId: 'card', categoryId: 'food.coffee' })))).toHaveLength(0);
  });
});

describe('recurrence', () => {
  it('clamps month-end due dates without drifting', () => {
    expect(occurrencesBetween('2026-01-31', { unit: 'month', interval: 1 }, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('handles biweekly schedules that started long ago', () => {
    expect(occurrencesBetween('2025-01-03', { unit: 'week', interval: 2 }, '2026-09-01', '2026-09-30')).toEqual(['2026-09-11', '2026-09-25']);
  });
  it('converts to monthly equivalents', () => {
    expect(monthlyEquivalent(12_000, { unit: 'year', interval: 1 })).toBe(1_000);
    expect(monthlyEquivalent(100_000, { unit: 'week', interval: 2 })).toBe(216_667);
  });
});

describe('schedule de-duplication', () => {
  const rent: RecurringItem = {
    id: 'rent', name: 'Rent', kind: 'bill', amount: 150_000, variable: false, frequency: { unit: 'month', interval: 1 }, startDate: '2026-01-01',
    accountId: 'chk', autopay: false, essential: true, active: true, skipped: [], tags: [], createdAt: stamp, updatedAt: stamp,
  };

  it('settles an occurrence with its linked transaction', () => {
    const d = ledger((d) => {
      d.recurring = [rent];
      d.transactions = [tx({ type: 'expense', amount: 150_000, accountId: 'chk', recurringId: 'rent', occurrenceDate: '2026-09-01' })];
    });
    const events = scheduledEvents(d, { from: '2026-09-01', to: '2026-10-31', today: TODAY }).filter((e) => e.source === 'recurring');
    expect(events.map((e) => [e.date, e.status])).toEqual([
      ['2026-09-01', 'paid'],
      ['2026-10-01', 'upcoming'],
    ]);
  });

  it('generates a debt due-date payment only when no recurring payment covers it', () => {
    const d = ledger((d) => {
      d.transactions = [tx({ type: 'expense', amount: 10_000, accountId: 'card' })];
    });
    const debtEvents = (x: LedgerData) => scheduledEvents(x, { from: TODAY, to: '2026-09-30', today: TODAY }).filter((e) => e.kind === 'debt_payment');
    expect(debtEvents(d)).toHaveLength(1);
    expect(debtEvents(d)[0].amount).toBe(30_000);
    d.recurring = [{ ...rent, id: 'cardpay', kind: 'debt_payment', toAccountId: 'card', amount: 5_000, startDate: '2026-01-20' }];
    const after = debtEvents({ ...d });
    expect(after.map((e) => e.source)).toEqual(['recurring']);
  });

  it('shows a future-dated settlement once', () => {
    const d = ledger((d) => {
      d.recurring = [rent];
      d.transactions = [tx({ type: 'expense', amount: 150_000, accountId: 'chk', date: '2026-09-30', description: 'Rent', recurringId: 'rent', occurrenceDate: '2026-10-01' })];
    });
    const october = scheduledEvents(d, { from: '2026-09-17', to: '2026-10-05', today: TODAY }).filter((e) => e.name === 'Rent' || e.sourceId === 'rent');
    expect(october).toHaveLength(1);
    expect(october[0].source).toBe('transaction');
    const f = buildForecast(d, { today: TODAY, to: '2026-10-05' });
    // October rent once (via its transaction), September rent still overdue,
    // and the card's statement payment on Sep 25.
    expect(f.totalOut).toBe(150_000 + 150_000 + 20_000);
  });
});

describe('available to spend', () => {
  it('subtracts committed bills and money set aside in spendable accounts', () => {
    const d = ledger((d) => {
      d.recurring = [{
        id: 'phone', name: 'Phone', kind: 'bill', amount: 5_000, variable: false, frequency: { unit: 'month', interval: 1 }, startDate: '2026-09-20',
        accountId: 'chk', autopay: true, essential: true, active: true, skipped: [], tags: [], createdAt: stamp, updatedAt: stamp,
      }];
      d.goals = [{ id: 'g', name: 'Trip', kind: 'savings', template: 'vacation', target: 100_000, linkedAccountIds: [], startDate: '2026-01-01', icon: 'map', color: '#000', tags: [], archived: false, createdAt: stamp, updatedAt: stamp }];
      d.goalContributions = [{ id: 'c', goalId: 'g', date: '2026-09-01', amount: 10_000, accountId: 'chk', createdAt: stamp }];
    });
    const pos = spendingPosition(d, TODAY, allocatedAmounts(d, TODAY));
    // $1,000 checking − $50 phone (Sep 20) − $200 card statement due Sep 25 − $100 set aside
    expect(pos.spendableCash).toBe(100_000);
    expect(pos.committed).toBe(5_000 + 20_000);
    expect(pos.setAside).toBe(10_000);
    expect(pos.available).toBe(100_000 - 25_000 - 10_000);
  });

  it('prevents assigning more to goals than an account holds', () => {
    const d = ledger((d) => {
      d.goals = [{ id: 'g', name: 'EF', kind: 'savings', template: 'emergency', target: 100_000, linkedAccountIds: [], startDate: '2026-01-01', icon: 'x', color: '#000', tags: [], archived: false, createdAt: stamp, updatedAt: stamp }];
      d.goalContributions = [{ id: 'c1', goalId: 'g', date: '2026-02-01', amount: 40_000, accountId: 'sav', createdAt: stamp }];
    });
    const over = validateContribution(d, { id: 'c2', goalId: 'g', date: TODAY, amount: 20_000, accountId: 'sav', createdAt: stamp }, TODAY);
    expect(over.amount).toBeTruthy();
    const ok = validateContribution(d, { id: 'c2', goalId: 'g', date: TODAY, amount: 10_000, accountId: 'sav', createdAt: stamp }, TODAY);
    expect(ok.amount).toBeUndefined();
    expect(goalProgress(d, d.goals[0], TODAY).current).toBe(40_000);
  });
});

describe('debt payoff', () => {
  const base = { startMonth: '2026-10', extraMonthly: 0, order: 'listed' as const, rollover: true };
  it('pays a 0% loan in balance / payment months', () => {
    const r = simulatePayoff([{ id: 'a', name: 'A', balance: 100_000, apr: 0, payment: 10_000 }], base);
    expect(r.months).toBe(10);
    expect(r.debtFreeMonth).toBe('2027-07');
    expect(r.totalInterest).toBe(0);
  });
  it('extra payments shorten payoff and reduce interest', () => {
    const debts = [{ id: 'a', name: 'A', balance: 500_000, apr: 20, payment: 15_000 }];
    const min = simulatePayoff(debts, base);
    const extra = simulatePayoff(debts, { ...base, extraMonthly: 10_000 });
    expect(extra.months!).toBeLessThan(min.months!);
    expect(extra.totalInterest).toBeLessThan(min.totalInterest);
  });
  it('flags payments that never cover interest', () => {
    const r = simulatePayoff([{ id: 'a', name: 'A', balance: 1_000_000, apr: 30, payment: 10_000 }], base);
    expect(r.months).toBeNull();
    expect(r.stuck).toBe(true);
  });
});

describe('sample ledger', () => {
  const d = buildSampleLedger(TODAY);
  const i = indexLedger(d);

  it('keeps checking positive across the whole history', () => {
    let lowest = Infinity;
    for (let date = '2025-09-01'; date <= TODAY; date = addDays(date, 1)) lowest = Math.min(lowest, balanceOn(i, 'acc_checking', date));
    expect(lowest).toBeGreaterThan(0);
  });

  it('never over-allocates savings goals', () => {
    const alloc = allocatedAmounts(d, TODAY).get('acc_savings')!;
    expect(alloc).toBeLessThanOrEqual(balanceOn(i, 'acc_savings', TODAY));
  });

  it('net worth equals assets minus liabilities', () => {
    const nw = netWorthOn(d, TODAY);
    expect(nw.netWorth).toBe(nw.assets - nw.liabilities);
    expect(nw.liabilities).toBeGreaterThan(0);
  });

  it('produces coherent derived views', () => {
    expect(buildAlerts(d, TODAY).length).toBeGreaterThan(0);
    expect(monthBudgets(d, monthOf(TODAY), TODAY).lines.length).toBe(6);
    const f = buildForecast(d, { today: TODAY, to: addDays(TODAY, 30) });
    expect(f.days).toHaveLength(31);
    expect(f.end).toBe(f.start + f.totalIn - f.totalOut);
    expect(searchLedger(d, '#car').length).toBeGreaterThan(3);
  });

  it('scenarios never mutate data and reflect changes', () => {
    const before = JSON.stringify(d);
    const cancel = compareScenario(d, [{ id: 'x', type: 'cancel_recurring', recurringId: 'rec_gamepass', startMonth: 0 }], 12, TODAY);
    expect(JSON.stringify(d)).toBe(before);
    expect(cancel.scenario.averageSurplus - cancel.baseline.averageSurplus).toBe(1_699);
    const extra = compareScenario(d, d.scenarios[1].changes, 60, TODAY);
    const studentFree = (p: typeof extra.baseline) => p.months.find((m) => m.debt === 0)?.month ?? 'never';
    expect(studentFree(extra.scenario) <= studentFree(extra.baseline)).toBe(true);
  });

  it('round-trips through a backup file', () => {
    const restored = parseBackup(serializeBackup(d));
    expect(restored.warnings).toEqual([]);
    expect(restored.data.transactions).toEqual(d.transactions);
    expect(netWorthOn(restored.data, TODAY)).toEqual(netWorthOn(d, TODAY));
  });

  it('pays the statement-plan card in full each month', () => {
    const sapphire = d.accounts.find((a) => a.id === 'acc_sapphire')!;
    expect(balanceOn(i, sapphire.id, addMonths(TODAY, -1))).toBeLessThan(sapphire.creditLimit!);
  });
});

describe('budgets', () => {
  it('does not double-count a subcategory budget inside a budgeted parent', () => {
    const d = buildSampleLedger(TODAY);
    const m = monthBudgets(d, monthOf(TODAY), TODAY);
    const food = m.lines.find((l) => l.category.id === 'food')!;
    const restaurants = m.lines.find((l) => l.category.id === 'food.restaurants')!;
    const others = m.lines.filter((l) => l !== food && l !== restaurants);
    expect(m.totalBudgeted).toBe(food.amount + others.reduce((s, l) => s + l.amount, 0));
    expect(restaurants.spent).toBeLessThanOrEqual(food.spent);
  });
});
