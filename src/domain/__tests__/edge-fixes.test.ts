import { describe, expect, it } from 'vitest';

import { emptyLedger } from '../factory';
import { lastMonths } from '../dates';
import { goalProgress } from '../goals';
import { compareScenario } from '../scenarios';
import { moneyCheckup } from '../health';
import { monthEndDates, netWorthTrend, periodHasData, spendingPosition } from '../position';
import { monthlyReview, yearOverYear } from '../reports';
import { nextDebtDue, openEvents, scheduledEvents } from '../schedule';
import type { Account, AccountType, Goal, LedgerData, RecurringItem, Transaction } from '../types';

const TODAY = '2026-09-17';
const stamp = '2026-01-01T00:00:00.000Z';
let seq = 0;

function acct(id: string, type: AccountType, startingBalance: number, extra: Partial<Account> = {}): Account {
  return { id, name: id, type, startingBalance, startingDate: '2026-01-01', color: '#000', icon: 'box', tags: [], archived: false, createdAt: stamp, updatedAt: stamp, ...extra };
}
function tx(p: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'accountId'>): Transaction {
  seq++;
  return { id: `t${seq}`, date: TODAY, description: 'test', tags: [], attachments: [], createdAt: stamp, updatedAt: stamp, ...p };
}
function rec(p: Partial<RecurringItem> & Pick<RecurringItem, 'id' | 'amount' | 'accountId'>): RecurringItem {
  return { name: p.id, kind: 'bill', variable: false, frequency: { unit: 'month', interval: 1 }, startDate: '2026-01-01', autopay: true, essential: true, active: true, skipped: [], tags: [], createdAt: stamp, updatedAt: stamp, ...p };
}
function ledger(extra: Partial<LedgerData>, accounts: Account[]): LedgerData {
  const d = emptyLedger();
  d.accounts = accounts;
  Object.assign(d, extra);
  return d;
}

describe('#1 partial card payment', () => {
  const accounts = () => [
    acct('chk', 'checking', 500_000, { spendable: true, startingDate: TODAY }),
    acct('card', 'credit_card', 80_000, { startingDate: TODAY, dueDay: 22, plannedPayment: 'statement', creditLimit: 500_000 }),
  ];

  it('a $200 payment on an $817 statement leaves $617 due', () => {
    const d = ledger(
      {
        transactions: [
          tx({ type: 'expense', amount: 1_700, accountId: 'card' }),
          tx({ type: 'debt_payment', amount: 20_000, accountId: 'chk', toAccountId: 'card' }),
        ],
      },
      accounts(),
    );
    const due = scheduledEvents(d, { from: TODAY, to: '2026-09-30', today: TODAY }).find((e) => e.source === 'debt')!;
    expect(due.status).toBe('upcoming');
    expect(due.amount).toBe(61_700);
    expect(due.paidAmount).toBe(20_000);
    expect(spendingPosition(d, TODAY, new Map()).committed).toBe(61_700);
    expect(nextDebtDue(d, 'card', TODAY)?.date).toBe('2026-09-22');
  });

  it('paying the full amount settles the due and the next due moves on', () => {
    const d = ledger({ transactions: [tx({ type: 'debt_payment', amount: 80_000, accountId: 'chk', toAccountId: 'card' })] }, accounts());
    const due = scheduledEvents(d, { from: TODAY, to: '2026-09-30', today: TODAY }).find((e) => e.source === 'debt')!;
    expect(due.status).toBe('paid');
    expect(openEvents(d, TODAY, '2026-09-30').some((e) => e.source === 'debt')).toBe(false);
  });
});

describe('#4 next due after a loan payment', () => {
  it('skips a due that has been paid', () => {
    const d = ledger(
      { transactions: [tx({ type: 'debt_payment', amount: 42_500, accountId: 'chk', toAccountId: 'auto' })] },
      [acct('chk', 'checking', 500_000, { spendable: true }), acct('auto', 'auto_loan', 1_680_000, { dueDay: 25, paymentAmount: 42_500, startingDate: '2026-09-01' })],
    );
    expect(nextDebtDue(d, 'auto', TODAY)?.date).toBe('2026-10-25');
  });
});

describe('#3 paid occurrences show the actual amount', () => {
  it('uses the linked transaction amount', () => {
    const d = ledger(
      {
        recurring: [rec({ id: 'power', amount: 12_000, accountId: 'chk', variable: true, startDate: '2026-09-10' })],
        transactions: [tx({ type: 'expense', amount: 13_450, accountId: 'chk', date: '2026-09-11', recurringId: 'power', occurrenceDate: '2026-09-10' })],
      },
      [acct('chk', 'checking', 500_000, { spendable: true })],
    );
    const ev = scheduledEvents(d, { from: '2026-09-01', to: '2026-10-31', today: TODAY }).filter((e) => e.sourceId === 'power');
    expect(ev.map((e) => [e.status, e.amount])).toEqual([
      ['paid', 13_450],
      ['upcoming', 12_000],
    ]);
  });
});

describe('#2 opening balances are a baseline, not change', () => {
  const d = () =>
    ledger(
      {
        transactions: [
          tx({ type: 'expense', amount: 1_700, accountId: 'card', date: '2026-09-10' }),
          tx({ type: 'income', amount: 200_000, accountId: 'chk', date: '2026-09-12' }),
        ],
      },
      [
        acct('chk', 'checking', 500_000, { spendable: true, startingDate: '2026-09-05' }),
        acct('card', 'credit_card', 80_000, { startingDate: '2026-09-05' }),
        acct('loan', 'auto_loan', 1_180_000, { startingDate: '2026-09-05' }),
        acct('brk', 'brokerage', 320_000, { startingDate: '2026-09-05' }),
      ],
    );

  it('monthly review starts from opening balances', () => {
    const r = monthlyReview(d(), '2026-09', TODAY);
    expect(r.debt.start).toBe(1_260_000);
    expect(r.debt.end).toBe(1_261_700);
    expect(r.investments.start).toBe(320_000);
    expect(r.investments.end - r.investments.start).toBe(0);
    expect(r.netWorth.start).toBe(500_000 + 320_000 - 1_260_000);
    expect(r.netWorth.change).toBe(200_000 - 1_700);
    expect(r.previousHasData).toBe(false);
  });

  it('net worth trend excludes months before tracking', () => {
    const t = netWorthTrend(d(), monthEndDates(lastMonths('2026-09', 13), TODAY));
    expect(t.points.map((p) => p.date)).toEqual([TODAY]);
    expect(t.since).toBe('2026-09-05');
    expect(t.change.change).toBe(198_300);
  });

  it('comparisons need data in the prior period', () => {
    expect(periodHasData(d(), '2026-08-01', '2026-08-17')).toBe(false);
    expect(periodHasData(d(), '2026-09-01', '2026-09-17')).toBe(true);
    expect(yearOverYear(d(), TODAY).lastYearHasData).toBe(false);
    const nw = moneyCheckup(d(), TODAY).metrics.find((m) => m.key === 'net_worth')!;
    expect(nw.status).toBe('na');
  });
});

describe('#5 goal pace includes this month', () => {
  it('a contribution made today counts; the starting amount does not', () => {
    const d = ledger({}, [acct('sav', 'savings', 900_000)]);
    const goal: Goal = { id: 'g', name: 'Trip', kind: 'savings', template: 'custom', target: 1_000_000, linkedAccountIds: [], startDate: '2026-09-10', icon: 'box', color: '#000', tags: [], archived: false, createdAt: '2026-09-10T10:00:00.000Z', updatedAt: stamp };
    d.goals = [goal];
    d.goalContributions = [
      { id: 'c0', goalId: 'g', date: '2026-09-10', amount: 500_000, accountId: 'sav', note: 'Already saved', createdAt: '2026-09-10T10:00:01.000Z' },
      { id: 'c1', goalId: 'g', date: TODAY, amount: 100_000, accountId: 'sav', createdAt: '2026-09-17T09:00:00.000Z' },
    ];
    const p = goalProgress(d, goal, TODAY);
    expect(p.monthlyRate).toBeGreaterThan(0);
    expect(p.status).not.toBe('stalled');
  });

  it('a debt payment made today counts toward a new payoff goal', () => {
    const d = ledger(
      { transactions: [tx({ type: 'debt_payment', amount: 40_000, accountId: 'chk', toAccountId: 'card' })] },
      [acct('chk', 'checking', 500_000), acct('card', 'credit_card', 300_000, { startingDate: '2026-09-01' })],
    );
    const goal: Goal = { id: 'g', name: 'Card', kind: 'debt_payoff', template: 'custom', target: 300_000, startValue: 300_000, linkedAccountIds: ['card'], startDate: TODAY, icon: 'box', color: '#000', tags: [], archived: false, createdAt: stamp, updatedAt: stamp };
    d.goals = [goal];
    const p = goalProgress(d, goal, TODAY);
    expect(p.monthlyRate).toBeGreaterThan(0);
  });
});

describe('#10 scenarios', () => {
  it('saving more per paycheck raises net worth and cash', () => {
    const d = ledger(
      { incomeSources: [{ id: 'job', name: 'Job', type: 'salary', depositAccountId: 'chk', active: true, frequency: { unit: 'week', interval: 2 }, anchorDate: '2026-09-04', expectedNet: 200_000, tags: [], createdAt: stamp, updatedAt: stamp }],
        transactions: [tx({ type: 'expense', amount: 150_000, accountId: 'chk', date: '2026-08-10' }), tx({ type: 'expense', amount: 150_000, accountId: 'chk', date: '2026-07-10' }), tx({ type: 'expense', amount: 150_000, accountId: 'chk', date: '2026-06-10' })] },
      [acct('chk', 'checking', 100_000, { spendable: true })],
    );
    const c = compareScenario(d, [{ id: 's', type: 'savings_contribution', perPaycheck: 10_000, startMonth: 0 }], 12, TODAY);
    expect(c.scenario.end.netWorth).toBeGreaterThan(c.baseline.end.netWorth);
    expect(c.scenario.end.savings).toBeGreaterThan(c.baseline.end.savings);
  });

  it('flags projected negative cash', () => {
    const d = ledger({}, [acct('chk', 'checking', 100_000, { spendable: true })]);
    const c = compareScenario(d, [{ id: 'x', type: 'expense_change', label: 'Rent', monthlyAmount: 50_000, startMonth: 0 }], 6, TODAY);
    expect(c.baseline.negativeCash).toBeNull();
    expect(c.scenario.negativeCash?.month).toBe('2026-12');
  });
});
