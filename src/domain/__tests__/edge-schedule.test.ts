import { describe, expect, it } from 'vitest';

import { emptyLedger } from '../factory';
import { buildForecast } from '../forecast';
import { allocatedAmounts } from '../goals';
import { spendingPosition } from '../position';
import { nextPayday, openEvents, plannedDebtPayment, scheduledEvents } from '../schedule';
import type { Account, AccountType, IncomeSource, LedgerData, RecurringItem, Transaction } from '../types';

const TODAY = '2026-09-16';
const stamp = '2026-01-01T00:00:00.000Z';
let seq = 0;

function acct(id: string, type: AccountType, startingBalance: number, extra: Partial<Account> = {}): Account {
  return { id, name: id, type, startingBalance, startingDate: '2026-01-01', color: '#000', icon: 'box', tags: [], archived: false, createdAt: stamp, updatedAt: stamp, ...extra };
}
function tx(p: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'accountId'>): Transaction {
  seq++;
  return { id: `t${seq}`, date: '2026-09-01', description: 'test', tags: [], attachments: [], createdAt: stamp, updatedAt: stamp, ...p };
}
function rec(p: Partial<RecurringItem> & Pick<RecurringItem, 'id' | 'amount' | 'accountId'>): RecurringItem {
  return { name: p.id, kind: 'bill', variable: false, frequency: { unit: 'month', interval: 1 }, startDate: '2026-01-01', autopay: true, essential: true, active: true, skipped: [], tags: [], createdAt: stamp, updatedAt: stamp, ...p };
}
function income(p: Partial<IncomeSource> & Pick<IncomeSource, 'id'>): IncomeSource {
  return { name: p.id, type: 'salary', depositAccountId: 'chk', active: true, tags: [], createdAt: stamp, updatedAt: stamp, ...p };
}
function ledger(extra: Partial<LedgerData>, accounts?: Account[]): LedgerData {
  const d = emptyLedger();
  d.accounts = accounts ?? [acct('chk', 'checking', 300_000, { spendable: true }), acct('sav', 'savings', 50_000)];
  Object.assign(d, extra);
  return d;
}

describe('recurring events', () => {
  it('settled by occurrenceDate even when paid on another date; skipped; paused; ended', () => {
    const d = ledger({
      recurring: [
        rec({ id: 'rent', amount: 150_000, accountId: 'chk', skipped: ['2026-08-01'] }),
        rec({ id: 'gym', amount: 4_000, accountId: 'chk', active: false }),
        rec({ id: 'old', amount: 1_000, accountId: 'chk', endDate: '2026-08-15' }),
      ],
      transactions: [tx({ type: 'expense', amount: 150_000, accountId: 'chk', date: '2026-09-04', recurringId: 'rent', occurrenceDate: '2026-09-01' })],
    });
    const ev = scheduledEvents(d, { from: '2026-07-01', to: '2026-10-31', today: TODAY });
    const rent = ev.filter((e) => e.sourceId === 'rent').map((e) => [e.date, e.status]);
    expect(rent).toEqual([
      ['2026-07-01', 'overdue'],
      ['2026-08-01', 'skipped'],
      ['2026-09-01', 'paid'],
      ['2026-10-01', 'upcoming'],
    ]);
    expect(ev.some((e) => e.sourceId === 'gym')).toBe(false);
    expect(ev.filter((e) => e.sourceId === 'old').map((e) => e.date)).toEqual(['2026-07-01', '2026-08-01']);
    const open = openEvents(d, TODAY, '2026-10-31');
    expect(open.filter((e) => e.sourceId === 'rent').map((e) => e.date)).toEqual(['2026-10-01']);
  });

  it('openEvents lookback excludes overdue older than the window', () => {
    const d = ledger({ recurring: [rec({ id: 'r', amount: 100, accountId: 'chk', startDate: '2026-07-31', frequency: { unit: 'year', interval: 1 } })] });
    expect(openEvents(d, TODAY, TODAY, 45)).toHaveLength(0); // 47 days ago
    expect(openEvents(d, TODAY, TODAY, 47)).toHaveLength(1);
  });
});

describe('paychecks', () => {
  const weekly = income({ id: 'job', frequency: { unit: 'week', interval: 1 }, anchorDate: '2026-09-04', expectedNet: 100_000 });

  it('an unlinked deposit never settles two paychecks', () => {
    const d = ledger({
      incomeSources: [weekly],
      transactions: [
        tx({ type: 'income', amount: 100_000, accountId: 'chk', date: '2026-09-04', incomeSourceId: 'job' }),
        tx({ type: 'income', amount: 100_000, accountId: 'chk', date: '2026-09-14', incomeSourceId: 'job' }), // Sep 11 pay, 3 days late
      ],
    });
    const ev = scheduledEvents(d, { from: '2026-09-01', to: '2026-09-30', today: '2026-09-15' }).map((e) => [e.date, e.status]);
    expect(ev).toEqual([
      ['2026-09-04', 'paid'],
      ['2026-09-11', 'paid'],
      ['2026-09-18', 'upcoming'],
      ['2026-09-25', 'upcoming'],
    ]);
  });

  it('matching is independent of the query window (nextPayday)', () => {
    const d = ledger({
      incomeSources: [weekly],
      transactions: [
        tx({ type: 'income', amount: 100_000, accountId: 'chk', date: '2026-09-04', incomeSourceId: 'job' }),
        tx({ type: 'income', amount: 100_000, accountId: 'chk', date: '2026-09-14', incomeSourceId: 'job' }),
      ],
    });
    // BUG: incomeEvents only enumerates occurrences inside [from, to] before matching unlinked
    // deposits. nextPayday queries from tomorrow, so the late Sep 11 deposit (Sep 14) is matched
    // to the Sep 18 paycheck instead and nextPayday skips to Sep 25; spendingPosition then uses a
    // too-long horizon. Fix in schedule.ts incomeEvents: enumerate occurrences from a lookback
    // (e.g. addDays(from, -2 * periodDays - 4)), run the matching over all of them, then drop
    // events with date < from. Preferring the closest occurrence would also help.
    expect(nextPayday(d, '2026-09-15')).toBe('2026-09-18');
  });

  it('linked occurrenceDate wins over proximity', () => {
    const d = ledger({
      incomeSources: [weekly],
      transactions: [tx({ type: 'income', amount: 90_000, accountId: 'chk', date: '2026-09-10', incomeSourceId: 'job', occurrenceDate: '2026-09-04' })],
    });
    const ev = scheduledEvents(d, { from: '2026-09-01', to: '2026-09-12', today: TODAY }).map((e) => [e.date, e.status, e.amount]);
    expect(ev).toEqual([
      ['2026-09-04', 'paid', 90_000],
      ['2026-09-11', 'overdue', 100_000],
    ]);
  });
});

describe('debt due-date events', () => {
  const card = (extra: Partial<Account> = {}) => acct('card', 'credit_card', 40_000, { creditLimit: 500_000, dueDay: 25, statementBalance: 30_000, minimumPayment: 2_500, ...extra });

  it('planned amounts: statement, minimum, fixed, fallback, capped at balance', () => {
    expect(plannedDebtPayment(card(), 40_000)).toBe(30_000);
    expect(plannedDebtPayment(card({ plannedPayment: 'minimum' }), 40_000)).toBe(2_500);
    expect(plannedDebtPayment(card({ plannedPayment: 'fixed', paymentAmount: 10_000 }), 40_000)).toBe(10_000);
    expect(plannedDebtPayment(card({ plannedPayment: 'fixed' }), 40_000)).toBe(2_500);
    expect(plannedDebtPayment(card({ plannedPayment: 'fixed', paymentAmount: 10_000 }), 7_000)).toBe(7_000);
    expect(plannedDebtPayment(card(), 0)).toBe(0);
    expect(plannedDebtPayment(card(), -500)).toBe(0);
    expect(plannedDebtPayment(acct('loan', 'auto_loan', 0), 100_000)).toBe(0);
  });

  it('suppressed by an active recurring payment, not by a paused one', () => {
    const paused = ledger({ recurring: [rec({ id: 'p', kind: 'debt_payment', amount: 5_000, accountId: 'chk', toAccountId: 'card', active: false })] }, [acct('chk', 'checking', 300_000, { spendable: true }), card()]);
    expect(scheduledEvents(paused, { from: TODAY, to: '2026-09-30', today: TODAY }).map((e) => e.source)).toEqual(['debt']);
    const active = ledger({ recurring: [rec({ id: 'p', kind: 'debt_payment', amount: 5_000, accountId: 'chk', toAccountId: 'card', startDate: '2026-01-25' })] }, [acct('chk', 'checking', 300_000, { spendable: true }), card()]);
    expect(scheduledEvents(active, { from: TODAY, to: '2026-09-30', today: TODAY }).map((e) => e.source)).toEqual(['recurring']);
  });

  it('a recurring payment that has ended no longer suppresses due-date events', () => {
    const d = ledger(
      { recurring: [rec({ id: 'p', kind: 'debt_payment', amount: 5_000, accountId: 'chk', toAccountId: 'card', startDate: '2026-01-25', endDate: '2026-06-25' })] },
      [acct('chk', 'checking', 300_000, { spendable: true }), card()],
    );
    // BUG: debtEvents treats any `active` recurring targeting the account as coverage, even when its
    // endDate is in the past, so the card silently disappears from bills/forecast/available-to-spend.
    // Fix in schedule.ts debtEvents:
    //   const covered = index.data.recurring.some((r) => r.active && r.toAccountId === account.id && (!r.endDate || r.endDate >= from));
    // (ideally per-cycle: skip only due dates the recurring item actually has an occurrence for).
    const events = scheduledEvents(d, { from: TODAY, to: '2026-09-30', today: TODAY });
    expect(events.map((e) => e.source)).toEqual(['debt']);
  });

  it('payment made early in the cycle settles it; next cycle is still expected', () => {
    const d = ledger(
      { transactions: [tx({ type: 'debt_payment', amount: 30_000, accountId: 'chk', toAccountId: 'card', date: '2026-09-05' })] },
      [acct('chk', 'checking', 300_000, { spendable: true }), card({ startingBalance: 40_000 })],
    );
    const ev = scheduledEvents(d, { from: '2026-09-01', to: '2026-10-31', today: TODAY }).map((e) => [e.date, e.status, e.amount]);
    expect(ev[0]).toEqual(['2026-09-25', 'paid', 30_000]);
    expect(ev[1][0]).toBe('2026-10-25');
    expect(ev[1][1]).toBe('upcoming');
  });

  it('several payments in one cycle are all reflected in the paid amount', () => {
    const d = ledger(
      {
        transactions: [
          tx({ type: 'debt_payment', amount: 10_000, accountId: 'chk', toAccountId: 'card', date: '2026-09-02' }),
          tx({ type: 'debt_payment', amount: 20_000, accountId: 'chk', toAccountId: 'card', date: '2026-09-10' }),
        ],
      },
      [acct('chk', 'checking', 300_000, { spendable: true }), card()],
    );
    const sep = scheduledEvents(d, { from: '2026-09-01', to: '2026-09-30', today: TODAY })[0];
    expect(sep.status).toBe('paid');
    // BUG (minor): debtEvents uses `transactions.find(...)`, so only the first payment in the cycle
    // is reported (10_000). Fix: sum all matching payments for `amount` and keep the first id.
    expect(sep.amount).toBe(30_000);
  });

  it('a late payment settles the overdue cycle rather than the next one', () => {
    // Due Aug 25, paid Aug 27 (2 days late). Today Sep 16.
    const d = ledger(
      { transactions: [tx({ type: 'debt_payment', amount: 30_000, accountId: 'chk', toAccountId: 'card', date: '2026-08-27' })] },
      [acct('chk', 'checking', 300_000, { spendable: true }), card({ startingBalance: 40_000 })],
    );
    const ev = scheduledEvents(d, { from: '2026-08-01', to: '2026-09-30', today: TODAY }).map((e) => [e.date, e.status]);
    // BUG: cycles are (previous due, due], so the Aug 27 payment is attributed to the Sep 25 cycle.
    // Aug 25 stays "overdue" (critical past-due alert + committed again in available-to-spend) and
    // Sep 25 shows "paid" before the statement is even due. Fix in schedule.ts debtEvents: when a
    // past cycle has no payment, allow a payment within a grace window after its due date (e.g.
    // up to the next statement closing / 10 days) that is not already used by another cycle, and
    // track used payment ids so one payment settles one cycle.
    expect(ev).toEqual([
      ['2026-08-25', 'paid'],
      ['2026-09-25', 'upcoming'],
    ]);
  });

  it('future-dated payment within the cycle is shown once, as the transaction', () => {
    const d = ledger(
      { transactions: [tx({ type: 'debt_payment', amount: 30_000, accountId: 'chk', toAccountId: 'card', date: '2026-09-20' })] },
      // Card opened Sep 1 so no earlier (legitimately overdue) cycle is in the forecast lookback.
      [acct('chk', 'checking', 300_000, { spendable: true }), card({ startingDate: '2026-09-01' })],
    );
    const ev = scheduledEvents(d, { from: TODAY, to: '2026-09-30', today: TODAY });
    expect(ev.map((e) => e.source)).toEqual(['transaction']);
    const f = buildForecast(d, { today: TODAY, to: '2026-09-30' });
    expect(f.totalOut).toBe(30_000);
  });

  it('no events for archived debts, zero balances, or missing dueDay', () => {
    const d = ledger({}, [
      acct('chk', 'checking', 300_000, { spendable: true }),
      card({ archived: true }),
      acct('c2', 'credit_card', 0, { dueDay: 5 }),
      acct('c3', 'credit_card', 10_000),
    ]);
    expect(scheduledEvents(d, { from: TODAY, to: '2026-10-31', today: TODAY })).toEqual([]);
  });
});

describe('spending position', () => {
  const accounts = () => [
    acct('chk', 'checking', 300_000, { spendable: true }),
    acct('wallet', 'cash', 10_000, { spendable: true }),
    acct('sav', 'savings', 50_000),
    acct('card', 'credit_card', 0, { dueDay: 25 }),
  ];

  it('horizon is next payday when within 31 days, else 30 days', () => {
    const withPay = ledger({ incomeSources: [income({ id: 'job', frequency: { unit: 'week', interval: 2 }, anchorDate: '2026-09-11', expectedNet: 200_000 })], transactions: [tx({ type: 'income', amount: 200_000, accountId: 'chk', date: '2026-09-11', incomeSourceId: 'job' })] }, accounts());
    const p = spendingPosition(withPay, TODAY, new Map());
    expect(p.horizon).toBe('2026-09-25');
    expect(p.horizonReason).toBe('payday');
    expect(p.expectedIncome).toBe(200_000);
    const none = ledger({}, accounts());
    expect(spendingPosition(none, TODAY, new Map()).horizon).toBe('2026-10-16');
  });

  it('committed counts only outflows from spendable accounts', () => {
    const d = ledger(
      {
        recurring: [
          rec({ id: 'atm', kind: 'transfer', amount: 5_000, accountId: 'chk', toAccountId: 'wallet', startDate: '2026-09-20' }),
          rec({ id: 'save', kind: 'savings', amount: 40_000, accountId: 'chk', toAccountId: 'sav', startDate: '2026-09-20' }),
          rec({ id: 'netflix', kind: 'subscription', amount: 1_549, accountId: 'card', startDate: '2026-09-20' }),
          rec({ id: 'phone', amount: 5_500, accountId: 'chk', startDate: '2026-09-21' }),
          rec({ id: 'pull', kind: 'transfer', amount: 7_000, accountId: 'sav', toAccountId: 'chk', startDate: '2026-09-22' }),
        ],
        settings: { ...emptyLedger().settings, spendingBuffer: 10_000 },
        goals: [{ id: 'g', name: 'G', kind: 'savings', template: 'general', target: 1, linkedAccountIds: [], startDate: '2026-01-01', icon: 'x', color: '#000', tags: [], archived: false, createdAt: stamp, updatedAt: stamp }],
        goalContributions: [
          { id: 'c1', goalId: 'g', date: '2026-09-01', amount: 20_000, accountId: 'chk', createdAt: stamp },
          { id: 'c2', goalId: 'g', date: '2026-09-01', amount: 30_000, accountId: 'sav', createdAt: stamp },
        ],
      },
      accounts(),
    );
    const p = spendingPosition(d, TODAY, allocatedAmounts(d, TODAY));
    expect(p.spendableCash).toBe(310_000);
    expect(p.committedItems.map((c) => [c.event.sourceId, c.effect]).sort()).toEqual([
      ['phone', 5_500],
      ['save', 40_000],
    ]);
    expect(p.setAside).toBe(20_000);
    expect(p.buffer).toBe(10_000);
    expect(p.available).toBe(310_000 - 45_500 - 20_000 - 10_000);
  });
});

describe('forecast', () => {
  const build = () =>
    ledger(
      {
        recurring: [
          rec({ id: 'rent', amount: 150_000, accountId: 'chk', startDate: '2026-09-10', autopay: false }), // overdue
          rec({ id: 'save', kind: 'savings', amount: 40_000, accountId: 'chk', toAccountId: 'sav', startDate: '2026-09-20' }),
        ],
        incomeSources: [income({ id: 'job', frequency: { unit: 'week', interval: 2 }, anchorDate: '2026-09-11', expectedNet: 200_000 })],
        transactions: [tx({ type: 'income', amount: 200_000, accountId: 'chk', date: '2026-09-11', incomeSourceId: 'job' })],
      },
      [acct('chk', 'checking', 100_000, { spendable: true }), acct('sav', 'savings', 50_000)],
    );

  it('end = start + in − out and overdue items land today', () => {
    const d = build();
    const f = buildForecast(d, { today: TODAY, to: '2026-10-31' });
    expect(f.start).toBe(300_000);
    expect(f.end).toBe(f.start + f.totalIn - f.totalOut);
    expect(f.days[0].outflow).toBe(150_000);
    expect(f.days[f.days.length - 1].balance).toBe(f.end);
    expect(f.lowest.balance).toBe(Math.min(...f.days.map((x) => x.balance), f.start));
    expect(f.events.at(-1)!.running).toBe(f.end);
  });

  it('scope cash ignores transfers into savings', () => {
    const d = build();
    const spend = buildForecast(d, { today: TODAY, to: '2026-09-30' });
    const cash = buildForecast(d, { today: TODAY, to: '2026-09-30', scope: 'cash' });
    expect(spend.totalOut).toBe(150_000 + 40_000);
    expect(cash.totalOut).toBe(150_000);
    expect(cash.start).toBe(350_000);
    expect(cash.end).toBe(cash.start + cash.totalIn - cash.totalOut);
  });

  it('to before today yields a single day without crashing', () => {
    const f = buildForecast(build(), { today: TODAY, to: '2026-09-01' });
    expect(f.days).toHaveLength(1);
    expect(f.end).toBe(f.start + f.totalIn - f.totalOut);
  });
});
