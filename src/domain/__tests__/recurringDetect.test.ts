import { describe, expect, it } from 'vitest';

import { addDays } from '../dates';
import { emptyLedger } from '../factory';
import { candidateTotals, detectRecurring } from '../recurringDetect';
import type { Account, LedgerData, RecurringItem, Transaction } from '../types';

const stamp = '2026-01-01T00:00:00.000Z';
const TODAY = '2026-09-20';
let seq = 0;

const acct = (id: string): Account => ({ id, name: id, type: 'checking', startingBalance: 500_000, startingDate: '2025-01-01', color: '#000', icon: 'box', tags: [], archived: false, createdAt: stamp, updatedAt: stamp });

const charge = (payee: string, date: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++seq}`,
  type: 'expense',
  amount,
  date,
  description: payee,
  payee,
  accountId: 'chk',
  tags: [],
  attachments: [],
  createdAt: stamp,
  updatedAt: stamp,
  ...extra,
});

/** `count` charges walking back from `last`, one every `every` days. */
function series(payee: string, last: string, every: number, count: number, amount: number | number[], extra: Partial<Transaction> = {}): Transaction[] {
  const out: Transaction[] = [];
  for (let i = 0; i < count; i++) {
    const cents = Array.isArray(amount) ? amount[i % amount.length] : amount;
    out.push(charge(payee, addDays(last, -every * i), cents, extra));
  }
  return out;
}

function ledger(transactions: Transaction[], recurring: RecurringItem[] = []): LedgerData {
  const d = emptyLedger();
  d.accounts = [acct('chk'), acct('card')];
  d.transactions = transactions;
  d.recurring = recurring;
  return d;
}

const recurringItem = (name: string, payee?: string): RecurringItem => ({
  id: `r${++seq}`,
  name,
  kind: 'subscription',
  amount: 999,
  variable: false,
  frequency: { unit: 'month', interval: 1 },
  startDate: '2026-01-06',
  accountId: 'chk',
  payee,
  autopay: true,
  essential: false,
  active: true,
  skipped: [],
  tags: [],
  createdAt: stamp,
  updatedAt: stamp,
});

describe('finding bills in what you already spent', () => {
  it('recognises a steady monthly charge', () => {
    const data = ledger(series('Spotify', '2026-09-06', 30, 6, 999, { categoryId: 'subscriptions.music' }));
    const [found] = detectRecurring(data, TODAY);
    expect(found.name).toBe('Spotify');
    expect(found.frequency).toEqual({ unit: 'month', interval: 1 });
    expect(found.amount).toBe(999);
    expect(found.monthly).toBe(999);
    expect(found.charges).toBe(6);
    expect(found.consistency).toBe(1);
    expect(found.variable).toBe(false);
    expect(found.kind).toBe('subscription');
    expect(found.status).toBe('active');
    expect(found.nextDate).toBe('2026-10-06');
  });

  it('needs a rhythm, not just repetition', () => {
    // Same shop, three visits, no pattern at all.
    const data = ledger([charge('Corner Store', '2026-03-02', 1_200), charge('Corner Store', '2026-06-19', 900), charge('Corner Store', '2026-09-01', 2_400)]);
    expect(detectRecurring(data, TODAY)).toEqual([]);
  });

  it('needs at least three charges', () => {
    const data = ledger(series('Netflix', '2026-09-08', 30, 2, 1_599));
    expect(detectRecurring(data, TODAY)).toEqual([]);
  });

  it('calls a moving amount variable, and still finds the rhythm', () => {
    const data = ledger(series('City Power', '2026-09-12', 30, 5, [8_400, 11_200, 6_900, 13_500, 9_100], { categoryId: 'housing.utilities', essential: true }));
    const [found] = detectRecurring(data, TODAY);
    expect(found.variable).toBe(true);
    expect(found.essential).toBe(true);
    // A bill that moves around is a bill, not a subscription.
    expect(found.kind).toBe('bill');
    expect(found.frequency).toEqual({ unit: 'month', interval: 1 });
  });

  it('calls steady rent a bill, not a subscription', () => {
    const data = ledger(series('Maple Court', '2026-09-01', 30, 6, 145_000, { categoryId: 'housing.rent' }));
    expect(detectRecurring(data, TODAY)[0].kind).toBe('bill');
  });

  it('reads weekly, fortnightly and yearly rhythms', () => {
    const weekly = detectRecurring(ledger(series('Dog Walker', '2026-09-18', 7, 8, 4_000)), TODAY)[0];
    expect(weekly.frequency).toEqual({ unit: 'week', interval: 1 });

    const fortnightly = detectRecurring(ledger(series('Cleaner', '2026-09-11', 14, 6, 12_000)), TODAY)[0];
    expect(fortnightly.frequency).toEqual({ unit: 'week', interval: 2 });

    const yearly = detectRecurring(ledger(series('Domain Renewal', '2026-04-02', 365, 4, 1_800)), TODAY)[0];
    expect(yearly.frequency).toEqual({ unit: 'year', interval: 1 });
    expect(yearly.monthly).toBe(150);
  });

  it('survives the wobble of real due dates', () => {
    // 28th of the month, give or take a weekend.
    const dates = ['2026-04-28', '2026-05-30', '2026-06-28', '2026-07-27', '2026-08-29', '2026-09-28'];
    const data = ledger(dates.map((d) => charge('Gym', d, 4_999)));
    const [found] = detectRecurring(data, '2026-09-30');
    expect(found.frequency).toEqual({ unit: 'month', interval: 1 });
    expect(found.consistency).toBe(1);
  });

  it('marks a charge that stopped coming as lapsed', () => {
    const data = ledger(series('Old Gym', '2026-03-05', 30, 5, 3_500));
    const [found] = detectRecurring(data, TODAY);
    expect(found.status).toBe('lapsed');
    expect(found.lastDate).toBe('2026-03-05');
  });

  it('leaves alone what is already tracked', () => {
    const charges = series('Spotify', '2026-09-06', 30, 6, 999);
    expect(detectRecurring(ledger(charges, [recurringItem('Spotify')]), TODAY)).toEqual([]);
    // Matched on the payee too, however the item itself is named.
    expect(detectRecurring(ledger(charges, [recurringItem('Music streaming', 'SPOTIFY USA')]), TODAY)).toEqual([]);
    // And anything already linked to an occurrence is tracked by definition.
    const linked = charges.map((t) => ({ ...t, recurringId: 'r1' }));
    expect(detectRecurring(ledger(linked), TODAY)).toEqual([]);
  });

  it('ignores anything that is not spending', () => {
    const transfers = series('Savings', '2026-09-06', 30, 6, 50_000).map((t) => ({ ...t, type: 'transfer' as const, toAccountId: 'card' }));
    expect(detectRecurring(ledger(transfers), TODAY)).toEqual([]);
  });

  it('counts two charges on one day once', () => {
    const charges = [...series('Spotify', '2026-09-06', 30, 4, 999), charge('Spotify', '2026-09-06', 999)];
    const [found] = detectRecurring(ledger(charges), TODAY);
    expect(found.charges).toBe(4);
  });

  it('puts the costliest first and totals what tracking them adds', () => {
    const data = ledger([
      ...series('Spotify', '2026-09-06', 30, 5, 999),
      ...series('Rent', '2026-09-01', 30, 5, 180_000),
      ...series('Old Gym', '2026-02-05', 30, 4, 3_500),
    ]);
    const found = detectRecurring(data, TODAY);
    expect(found.map((c) => c.name)).toEqual(['Rent', 'Old Gym', 'Spotify']);
    const totals = candidateTotals(found);
    expect(totals.count).toBe(3);
    expect(totals.active).toBe(2);
    // The lapsed gym is not counted into what you are paying now.
    expect(totals.monthly).toBe(180_999);
  });

  it('has nothing to say about an empty ledger', () => {
    expect(detectRecurring(emptyLedger(), TODAY)).toEqual([]);
    expect(candidateTotals([])).toEqual({ count: 0, monthly: 0, active: 0 });
  });
});
