import { describe, expect, it } from 'vitest';

import { emptyLedger } from '../factory';
import { categoryFor, groupNeedsCategory, kindForType, merchantProfiles, needsCategory, suggestFor, tidySummary } from '../merchants';
import type { Account, LedgerData, Transaction } from '../types';

const stamp = '2026-01-01T00:00:00.000Z';
let seq = 0;
const acct = (id: string, archived = false): Account => ({ id, name: id, type: 'checking', startingBalance: 500_000, startingDate: '2026-01-01', color: '#000', icon: 'box', tags: [], archived, createdAt: stamp, updatedAt: stamp });
const tx = (p: Partial<Transaction> & Pick<Transaction, 'type' | 'amount'>): Transaction => ({
  id: `t${++seq}`, date: '2026-06-10', description: 'Something', accountId: 'chk', tags: [], attachments: [], createdAt: stamp, updatedAt: stamp, ...p,
});

function ledger(transactions: Transaction[], mutate?: (d: LedgerData) => void): LedgerData {
  const d = emptyLedger();
  d.accounts = [acct('chk'), acct('card')];
  d.transactions = transactions;
  mutate?.(d);
  return d;
}

const grocery = (payee: string, date: string, amount: number, categoryId?: string, accountId = 'chk') =>
  tx({ type: 'expense', amount, date, payee, description: payee, categoryId, accountId });

describe('merchant habits', () => {
  it('reduces a bank statement\'s spellings of one shop to a single habit', () => {
    const data = ledger([
      grocery('SQ *TRADER JOE\'S #482 SAN FRA 01/14', '2026-04-02', 6_210, 'food.groceries'),
      grocery('TRADER JOES #117', '2026-05-02', 4_880, 'food.groceries'),
      grocery('Trader Joe\'s', '2026-06-02', 5_500, 'food.groceries'),
    ]);
    const profiles = merchantProfiles(data);
    expect([...profiles.keys()]).toEqual(['trader joes']);
    const profile = profiles.get('trader joes')!;
    expect(profile.seen).toBe(3);
    // The name follows the most recent spelling, not the messiest one.
    expect(profile.name).toBe('Trader Joe\'s');
    expect(profile.lastAmount).toBe(5_500);
    expect(profile.typicalAmount).toBe(5_500);
    expect(categoryFor(profile, 'expense')).toBe('food.groceries');
  });

  it('waits for a habit before offering a default', () => {
    const once = ledger([grocery('Blue Bottle', '2026-06-01', 700, 'food.coffee')]);
    expect(suggestFor(once, 'Blue Bottle')).toBeNull();

    const twice = ledger([
      grocery('Blue Bottle', '2026-06-01', 700, 'food.coffee'),
      grocery('Blue Bottle', '2026-06-08', 650, 'food.coffee'),
    ]);
    expect(suggestFor(twice, 'Blue Bottle')?.categoryId).toBe('food.coffee');
  });

  it('holds back when your own history disagrees', () => {
    const data = ledger([
      grocery('Target', '2026-06-01', 4_000, 'shopping.household'),
      grocery('Target', '2026-06-08', 3_000, 'food.groceries'),
      grocery('Target', '2026-06-15', 2_000, 'clothing.clothes'),
    ]);
    const profile = merchantProfiles(data).get('target')!;
    // Three visits, three answers: no single one is a habit.
    expect(profile.seen).toBe(3);
    expect(categoryFor(profile, 'expense')).toBeUndefined();
    expect(suggestFor(data, 'Target')?.categoryId).toBeUndefined();
  });

  it('keeps money in and money out apart', () => {
    const data = ledger([
      grocery('Acme Corp', '2026-05-01', 4_000, 'shopping.household'),
      grocery('Acme Corp', '2026-05-15', 4_000, 'shopping.household'),
      tx({ type: 'income', amount: 300_000, date: '2026-06-01', payee: 'Acme Corp', description: 'Acme Corp', categoryId: 'income.paycheck' }),
      tx({ type: 'income', amount: 300_000, date: '2026-06-15', payee: 'Acme Corp', description: 'Acme Corp', categoryId: 'income.paycheck' }),
    ]);
    expect(suggestFor(data, 'Acme Corp', 'expense')?.categoryId).toBe('shopping.household');
    expect(suggestFor(data, 'Acme Corp', 'income')?.categoryId).toBe('income.paycheck');
    expect(kindForType('refund')).toBe('income');
    expect(kindForType('expense')).toBe('expense');
  });

  it('matches a half-typed payee', () => {
    const data = ledger([
      grocery('Trader Joes', '2026-06-01', 5_000, 'food.groceries'),
      grocery('Trader Joes', '2026-06-08', 5_000, 'food.groceries'),
    ]);
    expect(suggestFor(data, 'trader')?.categoryId).toBe('food.groceries');
    expect(suggestFor(data, 'Costco')).toBeNull();
    expect(suggestFor(data, '')).toBeNull();
  });

  it('suggests the account and essential flag you normally use', () => {
    const data = ledger([
      tx({ type: 'expense', amount: 1_200, date: '2026-06-01', payee: 'Shell', description: 'Shell', categoryId: 'transport.fuel', accountId: 'card', essential: true }),
      tx({ type: 'expense', amount: 4_800, date: '2026-06-09', payee: 'Shell', description: 'Shell', categoryId: 'transport.fuel', accountId: 'card', essential: true }),
      tx({ type: 'expense', amount: 3_000, date: '2026-06-20', payee: 'Shell', description: 'Shell', categoryId: 'transport.fuel', accountId: 'chk', essential: true }),
    ]);
    const suggestion = suggestFor(data, 'Shell')!;
    expect(suggestion.accountId).toBe('card');
    expect(suggestion.essential).toBe(true);
    expect(suggestion.typicalAmount).toBe(3_000);
  });

  it('ignores archived categories and split purchases', () => {
    const data = ledger(
      [
        grocery('Costco', '2026-06-01', 9_000, 'shopping.household'),
        grocery('Costco', '2026-06-08', 9_000, 'shopping.household'),
        tx({
          type: 'expense',
          amount: 10_000,
          date: '2026-06-15',
          payee: 'Costco',
          description: 'Costco',
          splits: [{ id: 's1', categoryId: 'food.groceries', amount: 6_000 }, { id: 's2', categoryId: 'shopping.household', amount: 4_000 }],
        }),
      ],
      (d) => {
        const household = d.categories.find((c) => c.id === 'shopping.household');
        if (household) household.archived = true;
      },
    );
    const profile = merchantProfiles(data).get('costco')!;
    // The split purchase is not counted, and the archived category is not offered.
    expect(profile.seen).toBe(2);
    expect(categoryFor(profile, 'expense')).toBeUndefined();
  });

  it('queues what still needs a category, newest first', () => {
    const data = ledger([
      grocery('Trader Joes', '2026-06-01', 5_000, 'food.groceries'),
      grocery('Trader Joes', '2026-06-08', 5_200, 'food.groceries'),
      grocery('Trader Joes', '2026-06-15', 4_900),
      grocery('Mystery Shop', '2026-06-20', 1_500),
      tx({ type: 'transfer', amount: 20_000, date: '2026-06-21', description: 'To savings', toAccountId: 'card' }),
    ]);
    const items = needsCategory(data);
    expect(items.map((i) => i.transaction.date)).toEqual(['2026-06-20', '2026-06-15']);
    expect(items[1].suggestion?.categoryId).toBe('food.groceries');
    expect(items[0].suggestion).toBeNull();
    expect(tidySummary(items)).toEqual({ total: 2, suggested: 1, unknown: 1 });
  });

  it('groups the queue by merchant, biggest first', () => {
    const data = ledger([
      grocery('Adobe', '2026-03-06', 5_999),
      grocery('Adobe', '2026-04-06', 5_999),
      grocery('Adobe', '2026-05-06', 5_999),
      grocery('Corner Shop', '2026-06-20', 1_500),
      tx({ type: 'expense', amount: 900, date: '2026-06-21', description: '', payee: '' }),
    ]);
    const groups = groupNeedsCategory(needsCategory(data));
    expect(groups.map((g) => [g.name, g.items.length])).toEqual([
      ['Adobe', 3],
      ['', 1],
      ['Corner Shop', 1],
    ]);
    const adobe = groups[0];
    expect(adobe.total).toBe(17_997);
    expect(adobe.earliest).toBe('2026-03-06');
    expect(adobe.latest).toBe('2026-05-06');
    expect(adobe.kind).toBe('expense');
  });

  it('has nothing to say about an empty ledger', () => {
    const data = emptyLedger();
    expect(merchantProfiles(data).size).toBe(0);
    expect(needsCategory(data)).toEqual([]);
    expect(tidySummary([])).toEqual({ total: 0, suggested: 0, unknown: 0 });
  });
});
