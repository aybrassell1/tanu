import { describe, expect, it } from 'vitest';

import { spendingMap } from '../coverage';
import { emptyLedger } from '../factory';
import { allocatedAmounts } from '../goals';
import { spendingPosition } from '../position';
import {
  accountReserves,
  checkSetAside,
  fundBalance,
  fundFor,
  fundKey,
  fundStatus,
  fundsDueSoon,
  fundsMissingThisMonth,
  monthlySetAsideTotal,
  overReservedAccounts,
  setAsideThisMonth,
  suggestFundsFrom,
  suggestedMonthly,
  totalReserved,
  unreservedIn,
} from '../sinking';
import type { Account, AccountType, Goal, GoalContribution, LedgerData, SinkingEntry, SinkingFund, Transaction } from '../types';

const TODAY = '2026-09-17';
const stamp = '2026-01-01T00:00:00.000Z';
let seq = 0;

function acct(id: string, type: AccountType, startingBalance: number, extra: Partial<Account> = {}): Account {
  return { id, name: id, type, startingBalance, startingDate: '2025-01-01', color: '#000', icon: 'box', tags: [], archived: false, createdAt: stamp, updatedAt: stamp, ...extra };
}

function entry(date: string, amount: number): SinkingEntry {
  return { id: `se${++seq}`, date, amount };
}

function fund(p: Partial<SinkingFund> & Pick<SinkingFund, 'id'>): SinkingFund {
  return {
    name: p.id,
    yearlyTarget: 120_000,
    monthly: 10_000,
    entries: [],
    archived: false,
    createdAt: stamp,
    updatedAt: stamp,
    ...p,
  };
}

function tx(p: Partial<Transaction> & Pick<Transaction, 'type' | 'amount'>): Transaction {
  return { id: `t${++seq}`, date: '2026-06-01', description: 'x', accountId: 'chk', tags: [], attachments: [], createdAt: stamp, updatedAt: stamp, ...p };
}

function ledger(extra: Partial<LedgerData> = {}, accounts?: Account[]): LedgerData {
  const d = emptyLedger();
  d.accounts = accounts ?? [acct('chk', 'checking', 300_000, { spendable: true }), acct('sav', 'savings', 100_000, { spendable: true })];
  Object.assign(d, extra);
  return d;
}

// ─── Balances ────────────────────────────────────────────────────────────────

describe('fund balances', () => {
  it('nets money set aside against money spent', () => {
    const f = fund({ id: 'f', entries: [entry('2026-07-01', 10_000), entry('2026-08-01', 10_000), entry('2026-08-20', -6_000)] });
    expect(fundBalance(f)).toBe(14_000);
    expect(fundBalance(fund({ id: 'empty' }))).toBe(0);
  });

  it('counts this month separately from the balance', () => {
    const f = fund({ id: 'f', entries: [entry('2026-08-01', 10_000), entry('2026-09-02', 10_000), entry('2026-09-10', -4_000)] });
    const s = fundStatus(f, TODAY);
    expect(s.balance).toBe(16_000);
    expect(s.savedThisMonth).toBe(10_000);
    expect(s.usedThisMonth).toBe(4_000);
    expect(s.fundedThisMonth).toBe(true);
    expect(fundStatus(fund({ id: 'g', entries: [entry('2026-08-01', 5_000)] }), TODAY).fundedThisMonth).toBe(false);
  });

  it('totals reserves and the monthly plan across active funds only', () => {
    const d = ledger({
      sinkingFunds: [
        fund({ id: 'a', monthly: 5_000, entries: [entry('2026-09-01', 20_000)] }),
        fund({ id: 'b', monthly: 2_500, entries: [entry('2026-08-01', 5_000)] }),
        fund({ id: 'old', monthly: 9_900, archived: true, entries: [entry('2026-01-01', 50_000)] }),
      ],
    });
    expect(totalReserved(d)).toBe(25_000);
    expect(monthlySetAsideTotal(d)).toBe(7_500);
    expect(setAsideThisMonth(d, TODAY)).toBe(20_000);
    expect(fundsMissingThisMonth(d, TODAY).map((f) => f.id)).toEqual(['b']);
  });

  it('suggests a monthly amount of a twelfth of the yearly cost', () => {
    expect(suggestedMonthly(120_000)).toBe(10_000);
    expect(suggestedMonthly(10_000)).toBe(833);
  });
});

// ─── Shortfall and catch-up ──────────────────────────────────────────────────

describe('shortfall and catch-up', () => {
  it('spreads the shortfall over the months left before the due date', () => {
    // $1,200 a year, $300 saved, due in about 3 months.
    const f = fund({ id: 'reg', yearlyTarget: 120_000, monthly: 10_000, dueDate: '2026-12-15', entries: [entry('2026-08-01', 30_000)] });
    const s = fundStatus(f, TODAY);
    expect(s.shortfall).toBe(90_000);
    expect(s.monthsUntilDue).toBe(3);
    expect(s.requiredMonthly).toBe(30_000);
    // The plan only puts $100 a month aside, so $200 more is needed each month.
    expect(s.suggestedCatchUp).toBe(20_000);
    expect(s.ratio).toBeCloseTo(0.25, 5);
    // By now the plan expects everything except the 3 remaining $100 payments.
    expect(s.onTrack).toBeCloseTo(30_000 / 90_000, 5);
  });

  it('asks for the whole shortfall when the due date is here or past', () => {
    const due = fund({ id: 'due', yearlyTarget: 50_000, monthly: 4_000, dueDate: TODAY, entries: [entry('2026-09-01', 20_000)] });
    const dueStatus = fundStatus(due, TODAY);
    expect(dueStatus.monthsUntilDue).toBe(0);
    expect(dueStatus.requiredMonthly).toBe(30_000);
    expect(dueStatus.suggestedCatchUp).toBe(26_000);
    expect(dueStatus.overdue).toBe(false);

    const late = fundStatus(fund({ ...due, dueDate: '2026-09-01' }), TODAY);
    expect(late.daysUntilDue).toBe(-16);
    expect(late.monthsUntilDue).toBe(0);
    expect(late.overdue).toBe(true);
  });

  it('is fully funded when the balance covers the target', () => {
    const s = fundStatus(fund({ id: 'full', yearlyTarget: 60_000, monthly: 5_000, dueDate: '2026-11-01', entries: [entry('2026-09-01', 60_000)] }), TODAY);
    expect(s.shortfall).toBe(0);
    expect(s.requiredMonthly).toBe(0);
    expect(s.suggestedCatchUp).toBe(0);
    expect(s.ratio).toBe(1);
    expect(s.overdue).toBe(false);
  });

  it('treats a fund with no due date as on schedule against its target', () => {
    const s = fundStatus(fund({ id: 'open', yearlyTarget: 100_000, monthly: 8_000, entries: [entry('2026-09-01', 25_000)] }), TODAY);
    expect(s.monthsUntilDue).toBeNull();
    expect(s.daysUntilDue).toBeNull();
    expect(s.requiredMonthly).toBeNull();
    expect(s.suggestedCatchUp).toBe(0);
    expect(s.shortfall).toBe(75_000);
    expect(s.onTrack).toBeCloseTo(0.25, 5);
  });

  it('never divides by a zero target', () => {
    const s = fundStatus(fund({ id: 'zero', yearlyTarget: 0, monthly: 0 }), TODAY);
    expect(s.ratio).toBe(0);
    expect(s.onTrack).toBe(1);
    expect(s.shortfall).toBe(0);
  });

  it('lists funds due soon, overdue ones first', () => {
    const d = ledger({
      sinkingFunds: [
        fund({ id: 'far', dueDate: '2027-06-01' }),
        fund({ id: 'soon', dueDate: '2026-10-01' }),
        fund({ id: 'late', dueDate: '2026-09-01' }),
        fund({ id: 'undated' }),
      ],
    });
    expect(fundsDueSoon(d, TODAY).map((s) => s.fund.id)).toEqual(['late', 'soon']);
    expect(fundsDueSoon(d, TODAY, 400).map((s) => s.fund.id)).toEqual(['late', 'soon', 'far']);
  });
});

// ─── Over-reservation ────────────────────────────────────────────────────────

describe('over-reservation', () => {
  it('splits an account balance across funds and flags claiming too much', () => {
    const d = ledger({
      sinkingFunds: [
        fund({ id: 'a', accountId: 'sav', entries: [entry('2026-08-01', 60_000)] }),
        fund({ id: 'b', accountId: 'sav', entries: [entry('2026-08-02', 30_000)] }),
      ],
    });
    const sav = accountReserves(d, TODAY).get('sav')!;
    expect(sav.balance).toBe(100_000);
    expect(sav.reserved).toBe(90_000);
    expect(sav.free).toBe(10_000);
    expect(sav.overReserved).toBe(false);
    expect(sav.byFund).toEqual([{ fundId: 'a', amount: 60_000 }, { fundId: 'b', amount: 30_000 }]);

    const over = ledger({ sinkingFunds: [...d.sinkingFunds, fund({ id: 'c', accountId: 'sav', entries: [entry('2026-08-03', 40_000)] })] });
    const flagged = overReservedAccounts(over, TODAY);
    expect(flagged.map((a) => a.accountId)).toEqual(['sav']);
    expect(flagged[0].free).toBe(-30_000);
  });

  it('counts goal allocations against the same balance', () => {
    const goal: Goal = { id: 'g', name: 'Trip', kind: 'savings', template: 'vacation', target: 100_000, linkedAccountIds: [], startDate: '2026-01-01', icon: 'x', color: '#000', tags: [], archived: false, createdAt: stamp, updatedAt: stamp };
    const contribution: GoalContribution = { id: 'c', goalId: 'g', date: '2026-02-01', amount: 80_000, accountId: 'sav', createdAt: stamp };
    const d = ledger({ goals: [goal], goalContributions: [contribution], sinkingFunds: [fund({ id: 'a', accountId: 'sav', entries: [entry('2026-08-01', 30_000)] })] });

    // Without the goals, the reserve looks fine.
    expect(accountReserves(d, TODAY).get('sav')!.overReserved).toBe(false);

    const allocated = allocatedAmounts(d, TODAY);
    const withGoals = accountReserves(d, TODAY, allocated).get('sav')!;
    expect(withGoals.allocated).toBe(80_000);
    expect(withGoals.free).toBe(-10_000);
    expect(withGoals.overReserved).toBe(true);
    expect(unreservedIn(d, 'sav', TODAY, allocated)).toBe(-10_000);
    // An account no fund touches still nets out goal allocations.
    expect(unreservedIn(d, 'chk', TODAY, allocated)).toBe(300_000);
  });

  it('checks a set-aside against what the account really holds', () => {
    const d = ledger({ sinkingFunds: [fund({ id: 'a', accountId: 'sav', entries: [entry('2026-08-01', 90_000)] })] });
    const f = d.sinkingFunds[0];
    expect(checkSetAside(d, f, 5_000, TODAY)).toEqual({ ok: true, free: 10_000 });
    expect(checkSetAside(d, f, 25_000, TODAY)).toEqual({ ok: false, free: 10_000 });
    // No account named, nothing to check against.
    expect(checkSetAside(d, fund({ id: 'loose' }), 999_999, TODAY)).toBeNull();
  });
});

// ─── Available to spend ──────────────────────────────────────────────────────

describe('available to spend', () => {
  it('subtracts reserves from available money', () => {
    const base = ledger();
    const before = spendingPosition(base, TODAY, new Map());
    expect(before.reserved).toBe(0);
    expect(before.available).toBe(400_000);

    const withFund = ledger({ sinkingFunds: [fund({ id: 'a', accountId: 'chk', entries: [entry('2026-09-01', 40_000)] })] });
    const after = spendingPosition(withFund, TODAY, new Map());
    expect(after.spendableCash).toBe(400_000);
    expect(after.reserved).toBe(40_000);
    expect(after.available).toBe(360_000);
  });

  it('ignores reserves held outside spendable accounts and counts unassigned ones', () => {
    const accounts = [acct('chk', 'checking', 300_000, { spendable: true }), acct('vault', 'savings', 500_000, { spendable: false })];
    const d = ledger(
      {
        sinkingFunds: [
          fund({ id: 'vaulted', accountId: 'vault', entries: [entry('2026-09-01', 100_000)] }),
          fund({ id: 'loose', entries: [entry('2026-09-01', 25_000)] }),
        ],
      },
      accounts,
    );
    const p = spendingPosition(d, TODAY, new Map());
    expect(p.spendableCash).toBe(300_000);
    expect(p.reserved).toBe(25_000);
    expect(p.available).toBe(275_000);
  });

  it('stacks with goal set-aside and the buffer without double counting', () => {
    const goal: Goal = { id: 'g', name: 'Trip', kind: 'savings', template: 'vacation', target: 100_000, linkedAccountIds: [], startDate: '2026-01-01', icon: 'x', color: '#000', tags: [], archived: false, createdAt: stamp, updatedAt: stamp };
    const contribution: GoalContribution = { id: 'c', goalId: 'g', date: '2026-02-01', amount: 50_000, accountId: 'sav', createdAt: stamp };
    const d = ledger({ goals: [goal], goalContributions: [contribution], sinkingFunds: [fund({ id: 'a', accountId: 'sav', entries: [entry('2026-09-01', 20_000)] })] });
    d.settings.spendingBuffer = 10_000;
    const p = spendingPosition(d, TODAY, allocatedAmounts(d, TODAY));
    expect(p.setAside).toBe(50_000);
    expect(p.reserved).toBe(20_000);
    expect(p.available).toBe(400_000 - 50_000 - 20_000 - 10_000);
    // Every deduction the dashboard explainer lists has to add back up to `available`.
    expect(p.spendableCash - p.committed - p.setAside - p.reserved - p.buffer).toBe(p.available);
  });

  it('spending from a fund puts the money back within reach', () => {
    const spent = ledger({ sinkingFunds: [fund({ id: 'a', accountId: 'chk', entries: [entry('2026-08-01', 40_000), entry('2026-09-10', -40_000)] })] });
    expect(spendingPosition(spent, TODAY, new Map()).reserved).toBe(0);
  });
});

// ─── Suggestions ─────────────────────────────────────────────────────────────

describe('suggestFundsFrom', () => {
  const mapData = () =>
    ledger(
      {
        transactions: [
          tx({ type: 'expense', amount: 12_000, date: '2025-10-01', categoryId: 'transportation.gas' }),
          tx({ type: 'expense', amount: 18_000, date: '2026-03-10', categoryId: 'transportation.registration' }),
          tx({ type: 'expense', amount: 40_000, date: '2026-02-01', categoryId: 'travel.general' }),
        ],
      },
      [acct('chk', 'checking', 1_000_000, { spendable: true })],
    );

  it('turns irregular costs into fundable suggestions', () => {
    const d = mapData();
    const suggestions = suggestFundsFrom(d, TODAY);
    const line = spendingMap(d, TODAY).irregular.find((i) => i.categoryId === 'travel.general')!;
    const vacation = suggestions.find((s) => s.categoryId === 'travel.general')!;
    expect(vacation.name).toBe('Vacation');
    expect(vacation.yearlyTarget).toBe(line.yearly);
    expect(vacation.monthly).toBe(suggestedMonthly(line.yearly));
    expect(vacation.cadence).toBe('yearly');
    // Biggest cost first.
    expect(suggestions[0].categoryId).toBe('travel.general');
    expect(suggestions.map((s) => s.categoryId)).toContain('transportation.registration');
  });

  it('skips costs that already have a fund, by category or by name', () => {
    const d = mapData();
    d.sinkingFunds = [
      fund({ id: 'a', categoryId: 'travel.general' }),
      fund({ id: 'b', name: 'Car registration' }),
      fund({ id: 'gone', categoryId: 'health.vision', archived: true }),
    ];
    const ids = suggestFundsFrom(d, TODAY).map((s) => s.categoryId);
    expect(ids).not.toContain('travel.general');
    expect(ids).not.toContain('transportation.registration');
  });

  it('matches a fund name loosely, ignoring case, spacing and punctuation', () => {
    const d = mapData();
    d.sinkingFunds = [fund({ id: 'b', name: '  Car  Registration ' })];
    expect(suggestFundsFrom(d, TODAY).map((s) => s.categoryId)).not.toContain('transportation.registration');
  });

  it('suggests nothing from an empty ledger', () => {
    expect(suggestFundsFrom(emptyLedger(), TODAY)).toEqual([]);
  });
});

// ─── Matching a fund to a cost ───────────────────────────────────────────────

describe('fundFor', () => {
  it('normalises names to a comparable key', () => {
    expect(fundKey('Holiday gifts')).toBe('holiday gifts');
    expect(fundKey('  Holiday  Gifts ')).toBe('holiday gifts');
    expect(fundKey('Holiday-gifts!')).toBe('holiday gifts');
    expect(fundKey('Birthdays & gifts')).toBe('birthdays and gifts');
    expect(fundKey('   ')).toBe('');
  });

  it('matches by category id first, then by name', () => {
    const d = ledger({
      sinkingFunds: [
        fund({ id: 'cat', name: 'Presents', categoryId: 'giving.holidays' }),
        fund({ id: 'named', name: 'Holiday Gifts' }),
        fund({ id: 'old', name: 'Vacation', archived: true }),
      ],
    });
    expect(fundFor(d, { categoryId: 'giving.holidays', label: 'Holiday gifts' })?.id).toBe('cat');
    // Nothing carries that category, so the name decides.
    expect(fundFor(d, { categoryId: 'shopping.electronics', label: 'holiday gifts' })?.id).toBe('named');
    // Archived funds and unknown costs match nothing.
    expect(fundFor(d, { categoryId: 'travel.general', label: 'Vacation' })).toBeNull();
    expect(fundFor(d, { label: 'Car registration' })).toBeNull();
    expect(fundFor(d, { label: '' })).toBeNull();
  });
});
