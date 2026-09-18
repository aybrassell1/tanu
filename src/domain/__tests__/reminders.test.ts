import { describe, expect, it } from 'vitest';

import { addDays } from '../dates';
import { emptyLedger } from '../factory';
import { MAX_REMINDERS, clampHour, formatHour, plannedReminders } from '../reminders';
import type { Account, AccountType, IncomeSource, LedgerData, RecurringItem, Transaction } from '../types';

const TODAY = '2026-09-17'; // a Thursday
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
  return { name: p.id, kind: 'bill', variable: false, frequency: { unit: 'month', interval: 1 }, startDate: '2026-01-01', autopay: false, essential: true, active: true, skipped: [], tags: [], createdAt: stamp, updatedAt: stamp, ...p };
}
function income(p: Partial<IncomeSource> & Pick<IncomeSource, 'id'>): IncomeSource {
  return { name: p.id, type: 'salary', depositAccountId: 'chk', active: true, tags: [], createdAt: stamp, updatedAt: stamp, ...p };
}

type Prefs = Partial<LedgerData['settings']['notifications']>;

function ledger(extra: Partial<LedgerData>, prefs: Prefs = {}, accounts?: Account[]): LedgerData {
  const d = emptyLedger();
  d.accounts = accounts ?? [acct('chk', 'checking', 300_000, { spendable: true })];
  Object.assign(d, extra);
  d.settings.notifications = { enabled: true, billsDaysBefore: 2, hour: 9, paydays: false, weeklyReview: false, ...prefs };
  return d;
}

describe('plannedReminders — flags', () => {
  it('returns nothing while reminders are off', () => {
    const d = ledger({ recurring: [rec({ id: 'rent', amount: 150_000, accountId: 'chk' })] }, { enabled: false });
    expect(plannedReminders(d, TODAY)).toEqual([]);
  });

  it('skips paydays, the weekly review and low balance unless their flag is on', () => {
    const d = ledger(
      {
        incomeSources: [income({ id: 'job', frequency: { unit: 'week', interval: 2 }, anchorDate: '2026-09-18', expectedNet: 200_000 })],
      },
      { paydays: false, weeklyReview: false },
    );
    expect(plannedReminders(d, TODAY)).toEqual([]);

    d.settings.notifications = { ...d.settings.notifications, paydays: true };
    const paydays = plannedReminders(d, TODAY);
    expect(paydays.length).toBeGreaterThan(0);
    expect(paydays.every((r) => r.kind === 'payday')).toBe(true);
    expect(paydays[0].date).toBe('2026-09-18');

    d.settings.notifications = { ...d.settings.notifications, paydays: false, weeklyReview: true };
    const weekly = plannedReminders(d, TODAY);
    expect(weekly.every((r) => r.kind === 'weekly_review')).toBe(true);
    // Weeks start on Sunday by default; the first one is the coming Sunday.
    expect(weekly[0].date).toBe('2026-09-20');
    expect(weekly.map((r) => r.date)).toEqual([...new Set(weekly.map((r) => r.date))]);
  });
});

describe('plannedReminders — bills', () => {
  it('reminds the configured number of days before a due date, inside the window only', () => {
    const d = ledger({
      recurring: [
        rec({ id: 'rent', name: 'Rent', amount: 150_000, accountId: 'chk', startDate: '2026-01-01' }),
        rec({ id: 'far', name: 'Far away', amount: 1_000, accountId: 'chk', startDate: '2026-01-05', frequency: { unit: 'year', interval: 1 } }),
      ],
    });
    const out = plannedReminders(d, TODAY);
    const rent = out.filter((r) => r.id.startsWith('bill:') && r.title.startsWith('Rent'));
    // Oct 1 and Nov 1 fall in the 60-day window; reminders fire 2 days earlier.
    expect(rent.map((r) => r.date)).toEqual(['2026-09-29', '2026-10-30']);
    expect(rent[0].hour).toBe(9);
    expect(rent[0].title).toBe('Rent · $1,500.00');
    expect(rent[0].body).toContain('Due');
    // The yearly bill next occurs in Jan, well past the horizon.
    expect(out.some((r) => r.title.startsWith('Far away'))).toBe(false);
  });

  it('skips occurrences that are already paid or skipped', () => {
    const d = ledger({
      recurring: [rec({ id: 'rent', name: 'Rent', amount: 150_000, accountId: 'chk', skipped: ['2026-11-01'] })],
      transactions: [tx({ type: 'expense', amount: 150_000, accountId: 'chk', date: TODAY, recurringId: 'rent', occurrenceDate: '2026-10-01' })],
    });
    expect(plannedReminders(d, TODAY).filter((r) => r.kind === 'bill')).toEqual([]);
  });

  it('never schedules in the past: an overdue bill slides to today', () => {
    const d = ledger({ recurring: [rec({ id: 'gas', name: 'Gas', amount: 8_000, accountId: 'chk', startDate: '2026-09-10', frequency: { unit: 'month', interval: 1 } })] });
    const out = plannedReminders(d, TODAY);
    const overdue = out.find((r) => r.body.includes("isn't marked paid"));
    expect(overdue?.date).toBe(TODAY);
    expect(out.every((r) => r.date >= TODAY)).toBe(true);
  });

  it('labels autopay charges differently', () => {
    const d = ledger({ recurring: [rec({ id: 'net', name: 'Internet', amount: 7_000, accountId: 'chk', autopay: true })] });
    const next = plannedReminders(d, TODAY).find((r) => r.kind === 'bill');
    expect(next?.body).toContain('Autopay runs');
  });
});

describe('plannedReminders — low balance', () => {
  it('warns ahead of the first projected dip below the threshold', () => {
    const d = ledger(
      { recurring: [rec({ id: 'rent', name: 'Rent', amount: 250_000, accountId: 'chk', startDate: '2026-10-01' })] },
      { lowBalance: 100_000 },
      [acct('chk', 'checking', 300_000, { spendable: true })],
    );
    const dip = plannedReminders(d, TODAY).filter((r) => r.kind === 'low_balance');
    // Rent leaves $500 on Oct 1; the warning fires 2 days earlier, once.
    expect(dip).toHaveLength(1);
    expect(dip[0].date).toBe('2026-09-29');
    expect(dip[0].title).toContain('$1,000.00');
    expect(dip[0].body).toContain('Oct 1');
    expect(dip[0].body).toContain('Projected, not an actual balance');
  });

  it('warns today when the plan is already under the floor', () => {
    const d = ledger({ recurring: [rec({ id: 'rent', name: 'Rent', amount: 250_000, accountId: 'chk' })] }, { lowBalance: 100_000 });
    const dip = plannedReminders(d, TODAY).filter((r) => r.kind === 'low_balance');
    expect(dip).toHaveLength(1);
    expect(dip[0].date).toBe(TODAY);
  });

  it('stays quiet when the forecast never dips and when no threshold is set', () => {
    const d = ledger({ recurring: [rec({ id: 'rent', name: 'Rent', amount: 10_000, accountId: 'chk' })] }, { lowBalance: 100_000 });
    expect(plannedReminders(d, TODAY).some((r) => r.kind === 'low_balance')).toBe(false);

    const noFloor = ledger({ recurring: [rec({ id: 'rent', name: 'Rent', amount: 250_000, accountId: 'chk' })] });
    expect(plannedReminders(noFloor, TODAY).some((r) => r.kind === 'low_balance')).toBe(false);
  });
});

describe('plannedReminders — output shape', () => {
  it('caps the list, sorts by date and keeps ids unique', () => {
    const recurring = Array.from({ length: 40 }, (_, i) =>
      rec({ id: `b${i}`, name: `Bill ${i}`, amount: 1_000 + i, accountId: 'chk', startDate: '2026-09-01', frequency: { unit: 'week', interval: 1 } }),
    );
    const d = ledger({ recurring }, { weeklyReview: true, billsDaysBefore: 0 });
    const out = plannedReminders(d, TODAY);
    expect(out).toHaveLength(MAX_REMINDERS);
    expect(new Set(out.map((r) => r.id)).size).toBe(out.length);
    for (let i = 1; i < out.length; i++) expect(out[i].date >= out[i - 1].date).toBe(true);
    expect(out.every((r) => r.date >= TODAY && r.date <= addDays(TODAY, 60))).toBe(true);
    expect(out.every((r) => !!r.title && !!r.body)).toBe(true);
  });

  it('uses the configured hour for every reminder', () => {
    const d = ledger({ recurring: [rec({ id: 'rent', amount: 150_000, accountId: 'chk' })] }, { hour: 19, weeklyReview: true });
    expect(plannedReminders(d, TODAY).every((r) => r.hour === 19)).toBe(true);
  });

  it('is empty for an empty ledger', () => {
    expect(plannedReminders(ledger({}, { paydays: true }), TODAY)).toEqual([]);
  });
});

describe('hour helpers', () => {
  it('clamps out-of-range hours and formats them', () => {
    expect(clampHour(-3)).toBe(0);
    expect(clampHour(99)).toBe(23);
    expect(clampHour(Number.NaN)).toBe(9);
    expect(formatHour(0)).toBe('12:00 AM');
    expect(formatHour(9)).toBe('9:00 AM');
    expect(formatHour(12)).toBe('12:00 PM');
    expect(formatHour(19)).toBe('7:00 PM');
  });
});

describe('plannedReminders — ordering within a day', () => {
  it('orders reminders that fire on the same day by what is due soonest', () => {
    // Three bills due Sep 19, 20 and 21. A five-day lead time puts every
    // reminder on today, so only the due date can order them.
    const d = ledger(
      {
        recurring: [
          rec({ id: 'c', name: 'Latest', amount: 3_000, accountId: 'chk', startDate: '2026-09-21', frequency: { unit: 'year', interval: 1 } }),
          rec({ id: 'a', name: 'Soonest', amount: 1_000, accountId: 'chk', startDate: '2026-09-19', frequency: { unit: 'year', interval: 1 } }),
          rec({ id: 'b', name: 'Middle', amount: 2_000, accountId: 'chk', startDate: '2026-09-20', frequency: { unit: 'year', interval: 1 } }),
        ],
      },
      { billsDaysBefore: 5 },
    );
    const today = plannedReminders(d, TODAY).filter((r) => r.date === TODAY);
    expect(today.map((r) => r.dueDate)).toEqual(['2026-09-19', '2026-09-20', '2026-09-21']);
    expect(today.map((r) => r.title.split(' ·')[0])).toEqual(['Soonest', 'Middle', 'Latest']);
  });

  it('reports the underlying due date, not only the day it fires', () => {
    const d = ledger({ recurring: [rec({ id: 'rent', name: 'Rent', amount: 150_000, accountId: 'chk', startDate: '2026-01-01' })] });
    const rent = plannedReminders(d, TODAY).find((r) => r.kind === 'bill')!;
    expect(rent.date).toBe('2026-09-29');
    expect(rent.dueDate).toBe('2026-10-01');
  });
});
