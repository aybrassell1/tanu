import { describe, expect, it } from 'vitest';

import { monthBudgets, categorySpent } from '../budgets';
import { emptyLedger } from '../factory';
import { emptyFilters, expandCategoryIds, filteredTotals, filterTransactions } from '../filters';
import { spendingMap } from '../coverage';
import { categoryIdsOf, categoryLines } from '../ledger';
import { periodStats } from '../reports';
import { taxTaggedTransactions } from '../taxes';
import type { Account, LedgerData, Transaction, TransactionSplit } from '../types';
import { validateTransaction } from '../validation';

const stamp = '2026-01-01T00:00:00.000Z';
let seq = 0;
const acct = (id: string): Account => ({ id, name: id, type: 'checking', startingBalance: 1_000_000, startingDate: '2026-01-01', color: '#000', icon: 'box', tags: [], archived: false, createdAt: stamp, updatedAt: stamp });
const tx = (p: Partial<Transaction> & Pick<Transaction, 'type' | 'amount'>): Transaction => ({
  id: `t${++seq}`, date: '2026-06-10', description: 'Target run', accountId: 'chk', tags: [], attachments: [], createdAt: stamp, updatedAt: stamp, ...p,
});
const split = (categoryId: string, amount: number, extra: Partial<TransactionSplit> = {}): TransactionSplit => ({ id: `s${++seq}`, categoryId, amount, ...extra });
function ledger(transactions: Transaction[]): LedgerData {
  const d = emptyLedger();
  d.accounts = [acct('chk')];
  d.transactions = transactions;
  return d;
}

const TARGET = tx({
  type: 'expense',
  amount: 12_000,
  splits: [split('food.groceries', 7_000), split('housing.cleaning', 3_000, { essential: false }), split('giving.gifts', 2_000)],
});

describe('split transactions', () => {
  it('attributes each line to its own category and leaves the total alone', () => {
    const lines = categoryLines(TARGET);
    expect(lines.map((l) => [l.categoryId, l.amount])).toEqual([
      ['food.groceries', 7_000],
      ['housing.cleaning', 3_000],
      ['giving.gifts', 2_000],
    ]);
    const stats = periodStats(ledger([TARGET]), '2026-06-01', '2026-06-30');
    expect(stats.spending).toBe(12_000);
    expect(stats.byCategory.find((c) => c.key === 'food')!.amount).toBe(7_000);
    expect(stats.byCategory.find((c) => c.key === 'giving')!.amount).toBe(2_000);
    // Groceries are essential by default, cleaning was marked discretionary.
    expect(stats.essential).toBe(7_000);
  });

  it('flips the sign for a split refund', () => {
    const refund = tx({ type: 'refund', amount: 5_000, splits: [split('food.groceries', 3_000), split('giving.gifts', 2_000)] });
    expect(categoryLines(refund).map((l) => l.amount)).toEqual([-3_000, -2_000]);
    const stats = periodStats(ledger([TARGET, refund]), '2026-06-01', '2026-06-30');
    expect(stats.spending).toBe(7_000);
    expect(stats.byCategory.find((c) => c.key === 'food')!.amount).toBe(4_000);
  });

  it('counts only its own line toward a budget', () => {
    const d = ledger([TARGET]);
    expect(categorySpent(d, 'food', '2026-06-01', '2026-06-30')).toBe(7_000);
    d.budgets = [{ id: 'b1', categoryId: 'food', mode: 'limit', amounts: [{ month: '2026-01', amount: 40_000 }], rollover: false }];
    const month = monthBudgets(d, '2026-06', '2026-06-30');
    expect(month.lines[0].spent).toBe(7_000);
    // The other lines are unbudgeted, not invisible.
    expect(month.unbudgeted.find((u) => u.categoryId === 'giving.gifts')?.amount).toBe(2_000);
  });

  it('is found by a filter on any of its categories', () => {
    const d = ledger([TARGET]);
    expect(categoryIdsOf(TARGET)).toEqual(['food.groceries', 'housing.cleaning', 'giving.gifts']);
    const byGifts = filterTransactions(d, { ...emptyFilters(), categoryIds: ['giving.gifts'] }, '2026-09-17');
    expect(byGifts.map((t) => t.id)).toEqual([TARGET.id]);
    const byUnrelated = filterTransactions(d, { ...emptyFilters(), categoryIds: ['pets.vet'] }, '2026-09-17');
    expect(byUnrelated).toHaveLength(0);
  });

  it('gives taxes only the deductible line', () => {
    const d = ledger([tx({ type: 'expense', amount: 20_000, splits: [split('giving.charity', 15_000), split('food.groceries', 5_000)] })]);
    const { groups } = taxTaggedTransactions(d, 2026);
    expect(groups.map((g) => [g.tag, g.total])).toEqual([['charitable', 15_000]]);
  });

  it('rejects splits that do not add up', () => {
    const d = ledger([]);
    const bad = tx({ type: 'expense', amount: 10_000, splits: [split('food.groceries', 6_000), split('giving.gifts', 3_000)] });
    expect(validateTransaction(d, bad).splits).toBeTruthy();
    const negative = tx({ type: 'expense', amount: 10_000, splits: [split('food.groceries', 12_000), split('giving.gifts', -2_000)] });
    expect(validateTransaction(d, negative).splits).toBeTruthy();
    const onTransfer = tx({ type: 'transfer', amount: 10_000, toAccountId: 'chk', splits: [split('food.groceries', 10_000)] });
    expect(validateTransaction(d, onTransfer).splits).toBeTruthy();
    const good = tx({ type: 'expense', amount: 10_000, splits: [split('food.groceries', 6_000), split('giving.gifts', 4_000)] });
    expect(validateTransaction(d, good).splits).toBeUndefined();
  });

  it('counts only the filtered category in the totals bar', () => {
    const d = ledger([TARGET]);
    const ids = expandCategoryIds(d, ['giving']);
    expect(filteredTotals([TARGET], ids).spending).toBe(2_000);
    expect(filteredTotals([TARGET]).spending).toBe(12_000);
  });

  it('spreads a split across areas of the spending map', () => {
    const d = ledger([TARGET]);
    const map = spendingMap(d, '2026-09-17');
    expect(map.areas.find((a) => a.id === 'food')!.total).toBe(7_000);
    expect(map.areas.find((a) => a.id === 'giving')!.total).toBe(2_000);
    expect(map.total).toBe(12_000);
  });
});
