import { describe, expect, it } from 'vitest';

import { emptyLedger } from '../factory';
import { eligibleIds, medicalAmount, reimbursementLedger } from '../reimbursements';
import type { Account, AccountType, LedgerData, Transaction } from '../types';

const stamp = '2026-01-01T00:00:00.000Z';
const TODAY = '2026-06-01';
let seq = 0;

function acct(id: string, type: AccountType, startingBalance = 0): Account {
  return { id, name: id, type, startingBalance, startingDate: '2026-01-01', color: '#000', icon: 'box', tags: [], archived: false, createdAt: stamp, updatedAt: stamp };
}

function tx(p: Partial<Transaction> & Pick<Transaction, 'amount'>): Transaction {
  seq++;
  return {
    id: `t${seq}`,
    type: 'expense',
    date: '2026-03-01',
    description: 'Visit',
    accountId: 'chk',
    tags: [],
    attachments: [],
    createdAt: stamp,
    updatedAt: stamp,
    ...p,
  };
}

function ledger(transactions: Transaction[]): LedgerData {
  const d = emptyLedger();
  d.accounts = [acct('chk', 'checking', 400_000), acct('card', 'credit_card'), acct('hsa', 'hsa', 300_000)];
  d.transactions = transactions;
  return d;
}

const receipt = [{ id: 'a1', uri: 'file://r.jpg', name: 'receipt.jpg' }];

describe('reimbursementLedger', () => {
  const data = ledger([
    tx({ id: 'open1', amount: 12_000, categoryId: 'health.medical' }),
    tx({ id: 'open2', amount: 5_000, categoryId: 'health.otc', accountId: 'card', attachments: receipt }),
    tx({ id: 'flagged', amount: 20_000, categoryId: 'health.dental', reimbursableFrom: 'hsa' }),
    tx({ id: 'done', amount: 8_000, categoryId: 'health.vision', reimbursableFrom: 'fsa', reimbursedOn: '2026-04-01', attachments: receipt }),
    // Paid straight from the HSA: there is nothing to claim back.
    tx({ id: 'fromHsa', amount: 50_000, categoryId: 'health.hospital', accountId: 'hsa' }),
    tx({ id: 'groceries', amount: 9_000, categoryId: 'food.groceries' }),
    tx({ id: 'future', amount: 7_000, categoryId: 'health.medical', date: '2026-09-01' }),
    tx({ id: 'notTax', amount: 6_000, categoryId: 'health.medical', taxRelated: false }),
    // Split purchase: only the medical line counts.
    tx({
      id: 'split',
      amount: 30_000,
      categoryId: 'shopping.household',
      splits: [
        { id: 's1', categoryId: 'health.medication', amount: 10_000 },
        { id: 's2', categoryId: 'shopping.household', amount: 20_000 },
      ],
    }),
  ]);
  const r = reimbursementLedger(data, TODAY);

  it('lists out-of-pocket medical spending and leaves out HSA-paid costs', () => {
    expect(r.items.map((i) => i.id).sort()).toEqual(['flagged', 'done', 'open1', 'open2', 'split'].sort());
    expect(r.items.find((i) => i.id === 'fromHsa')).toBeUndefined();
    expect(r.items.find((i) => i.id === 'groceries')).toBeUndefined();
    expect(r.items.find((i) => i.id === 'future')).toBeUndefined();
    expect(r.items.find((i) => i.id === 'notTax')).toBeUndefined();
    // Newest first.
    expect(r.items[0].date >= r.items[r.items.length - 1].date).toBe(true);
  });

  it('splits the three states and totals what can still be claimed', () => {
    expect(r.totals.open).toBe(27_000);
    expect(r.totals.flagged).toBe(20_000);
    expect(r.totals.reimbursed).toBe(8_000);
    expect(r.totals.outstanding).toBe(47_000);
    expect(r.totals.all).toBe(55_000);
    expect(r.totals.hsaFlagged).toBe(20_000);
    expect(r.totals.fsaFlagged).toBe(0);
    expect(r.counts).toEqual({ open: 3, flagged: 1, reimbursed: 1, all: 5 });
  });

  it('counts only the medical part of a split', () => {
    expect(r.items.find((i) => i.id === 'split')!.amount).toBe(10_000);
    expect(medicalAmount(data, data.transactions.find((t) => t.id === 'split')!)).toEqual({ amount: 10_000, tags: ['medical'] });
  });

  it('keeps both medical tags and tracks receipts', () => {
    expect(r.items.find((i) => i.id === 'open2')!.tags).toEqual(['hsa_eligible']);
    expect(r.items.find((i) => i.id === 'open2')!.hasReceipt).toBe(true);
    expect(r.items.find((i) => i.id === 'open1')!.hasReceipt).toBe(false);
    // Only unreimbursed items without a receipt matter.
    expect(r.missingReceipts).toBe(3);
    expect(r.missingReceiptTotal).toBe(42_000);
  });

  it('reports the HSA balance after its own spending, and coverage', () => {
    expect(r.hsaAccounts).toEqual([{ id: 'hsa', name: 'hsa', balance: 250_000 }]);
    expect(r.hsaBalance).toBe(250_000);
    expect(r.coverage).toBe(1);
  });

  it('shows partial coverage when the HSA cannot cover every claim', () => {
    const thin = ledger([tx({ amount: 100_000, categoryId: 'health.medical' })]);
    thin.accounts = [acct('chk', 'checking', 400_000), acct('hsa', 'hsa', 40_000)];
    const result = reimbursementLedger(thin, TODAY);
    expect(result.hsaBalance).toBe(40_000);
    expect(result.coverage).toBeCloseTo(0.4, 5);
  });

  it('offers every open item for a bulk flag', () => {
    expect(eligibleIds(r).sort()).toEqual(['open1', 'open2', 'split'].sort());
  });

  it('honors a date range', () => {
    const q1 = reimbursementLedger(data, TODAY, { from: '2026-01-01', to: '2026-02-01' });
    expect(q1.items).toHaveLength(0);
    expect(q1.totals.outstanding).toBe(0);
    expect(q1.coverage).toBe(1);
  });

  it('is empty and safe on a fresh ledger', () => {
    const r0 = reimbursementLedger(emptyLedger(), TODAY);
    expect(r0.items).toHaveLength(0);
    expect(r0.hsaAccounts).toHaveLength(0);
    expect(r0.hsaBalance).toBe(0);
    expect(r0.totals.outstanding).toBe(0);
  });

  it('nets a refund against the cost it refunds', () => {
    const refunded = ledger([
      tx({ amount: 20_000, categoryId: 'health.medical' }),
      tx({ type: 'refund', amount: 20_000, categoryId: 'health.medical' }),
    ]);
    const result = reimbursementLedger(refunded, TODAY);
    // The refund line is negative, so it drops out instead of inflating the claim.
    expect(result.counts.all).toBe(1);
    expect(result.totals.outstanding).toBe(20_000);
  });
});
