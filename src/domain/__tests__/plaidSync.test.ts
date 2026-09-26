import { describe, expect, it } from 'vitest';

import { emptyLedger } from '../factory';
import { planSync, toCents, type PlaidTransaction, type SyncPayload } from '../plaidSync';
import type { Account, BankConnection, LedgerData, Transaction } from '../types';

const stamp = '2026-09-01T00:00:00.000Z';
let seq = 0;

const acct = (id: string, type: Account['type'] = 'checking'): Account => ({
  id, name: id, type, startingBalance: 500_000, startingDate: '2026-01-01', color: '#000', icon: 'box', tags: [], archived: false, createdAt: stamp, updatedAt: stamp,
});

const connection = (over: Partial<BankConnection> = {}): BankConnection => ({
  id: 'conn1',
  itemId: 'item_1',
  institutionName: 'Test Bank',
  accessToken: 'access-sandbox-1',
  accounts: [
    { externalId: 'plaid_chk', name: 'Everyday Checking', type: 'depository', subtype: 'checking', accountId: 'chk' },
    { externalId: 'plaid_card', name: 'Rewards Card', type: 'credit', subtype: 'credit card', accountId: 'card' },
  ],
  createdAt: stamp,
  updatedAt: stamp,
  ...over,
});

const plaid = (over: Partial<PlaidTransaction> & Pick<PlaidTransaction, 'amount'>): PlaidTransaction => ({
  transaction_id: over.transaction_id ?? `ptx${++seq}`,
  account_id: 'plaid_chk',
  date: '2026-09-10',
  name: 'TRADER JOES #117',
  merchant_name: 'Trader Joe\'s',
  ...over,
});

const payload = (added: PlaidTransaction[], over: Partial<SyncPayload> = {}): SyncPayload => ({
  added,
  modified: [],
  removed: [],
  next_cursor: 'cursor_2',
  has_more: false,
  ...over,
});

function ledger(transactions: Transaction[] = [], conn = connection()): LedgerData {
  const d = emptyLedger();
  d.accounts = [acct('chk'), acct('card', 'credit_card')];
  d.transactions = transactions;
  d.connections = [conn];
  return d;
}

const tx = (p: Partial<Transaction> & Pick<Transaction, 'type' | 'amount'>): Transaction => ({
  id: `t${++seq}`, date: '2026-09-10', description: 'Something', accountId: 'chk', tags: [], attachments: [], createdAt: stamp, updatedAt: stamp, ...p,
});

describe('what a bank sync would do', () => {
  it('turns a charge into spending, in cents', () => {
    const result = planSync(ledger(), 'conn1', payload([plaid({ amount: 42.37 })]));
    expect(result.counts.new).toBe(1);
    const row = result.rows[0];
    expect(row.kind).toBe('new');
    expect(row.draft?.type).toBe('expense');
    expect(row.draft?.amount).toBe(4_237);
    expect(row.draft?.payee).toBe("Trader Joe's");
    expect(row.draft?.externalId).toBe(row.externalId);
    expect(row.draft?.connectionId).toBe('conn1');
  });

  it('reads Plaid signs the way Plaid means them', () => {
    // Positive is money leaving, negative is money arriving.
    const result = planSync(ledger(), 'conn1', payload([
      plaid({ transaction_id: 'a', amount: 25 }),
      plaid({ transaction_id: 'b', amount: -1_800, name: 'ACME PAYROLL' }),
    ]));
    expect(result.rows.map((r) => r.draft?.type)).toEqual(['expense', 'income']);
    expect(toCents(-18)).toBe(-1_800);
    // Floats that can't be represented exactly still land on whole cents.
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  it('pairs both halves of a card payment into one transfer', () => {
    const result = planSync(ledger(), 'conn1', payload([
      plaid({ transaction_id: 'out', amount: 300, account_id: 'plaid_chk', name: 'PAYMENT TO CARD' }),
      plaid({ transaction_id: 'in', amount: -300, account_id: 'plaid_card', date: '2026-09-11', name: 'PAYMENT THANK YOU' }),
    ]));
    const leaving = result.rows.find((r) => r.externalId === 'out')!;
    const arriving = result.rows.find((r) => r.externalId === 'in')!;
    // One debt payment, not $300 of spending plus $300 of income.
    expect(leaving.kind).toBe('transfer');
    expect(leaving.draft?.type).toBe('debt_payment');
    expect(leaving.draft?.accountId).toBe('chk');
    expect(leaving.draft?.toAccountId).toBe('card');
    expect(leaving.draft?.categoryId).toBeUndefined();
    // The other half is recognised, not silently dropped.
    expect(arriving.kind).toBe('duplicate');
    expect(arriving.draft).toBeUndefined();
    expect(arriving.pairedWith).toBe('out');
    expect(result.counts.transfer).toBe(1);
  });

  it('does not pair two unrelated amounts that happen to match', () => {
    const result = planSync(ledger(), 'conn1', payload([
      plaid({ transaction_id: 'out', amount: 50, account_id: 'plaid_chk' }),
      // Same amount, three weeks later: a coincidence, not a transfer.
      plaid({ transaction_id: 'in', amount: -50, account_id: 'plaid_card', date: '2026-10-02' }),
    ]));
    expect(result.rows.every((r) => r.kind === 'new')).toBe(true);
    expect(result.counts.transfer).toBe(0);
  });

  it('never offers the same charge twice', () => {
    const already = tx({ type: 'expense', amount: 4_237, externalId: 'ptx_known', accountId: 'chk' });
    const result = planSync(ledger([already]), 'conn1', payload([plaid({ transaction_id: 'ptx_known', amount: 42.37 })]));
    expect(result.rows[0].kind).toBe('duplicate');
    expect(result.rows[0].draft).toBeUndefined();
  });

  it('recognises what you already typed in yourself', () => {
    const byHand = tx({ type: 'expense', amount: 4_237, date: '2026-09-09', payee: 'Trader Joes', description: 'Trader Joes', accountId: 'chk' });
    const result = planSync(ledger([byHand]), 'conn1', payload([plaid({ amount: 42.37 })]));
    expect(result.rows[0].kind).toBe('duplicate');
  });

  it('offers a correction when the bank changes a charge it already sent', () => {
    const settled = tx({ type: 'expense', amount: 4_000, externalId: 'ptx_known', accountId: 'chk', description: "Trader Joe's" });
    const result = planSync(ledger([settled]), 'conn1', payload([], { modified: [plaid({ transaction_id: 'ptx_known', amount: 42.37 })] }));
    expect(result.rows[0].kind).toBe('new');
    expect(result.rows[0].replaces).toBe(settled.id);
    expect(result.rows[0].draft?.amount).toBe(4_237);
  });

  it('holds pending charges back until they settle', () => {
    const result = planSync(ledger(), 'conn1', payload([plaid({ amount: 42.37, pending: true })]));
    expect(result.rows[0].kind).toBe('pending');
    expect(result.rows[0].draft).toBeUndefined();
    // Unless you ask for them.
    const eager = planSync(ledger(), 'conn1', payload([plaid({ amount: 42.37, pending: true })]), { includePending: true });
    expect(eager.rows[0].kind).toBe('new');
  });

  it('leaves an account you have not mapped alone', () => {
    const result = planSync(ledger(), 'conn1', payload([plaid({ amount: 20, account_id: 'plaid_savings' })]));
    expect(result.rows[0].kind).toBe('unmapped');
    expect(result.rows[0].draft).toBeUndefined();
  });

  it('applies the category you usually give that merchant', () => {
    const history = [
      tx({ type: 'expense', amount: 5_000, date: '2026-08-01', payee: 'Trader Joes', description: 'Trader Joes', categoryId: 'food.groceries' }),
      tx({ type: 'expense', amount: 5_200, date: '2026-08-15', payee: 'Trader Joes', description: 'Trader Joes', categoryId: 'food.groceries' }),
    ];
    const result = planSync(ledger(history), 'conn1', payload([plaid({ amount: 61.10 })]));
    expect(result.rows[0].draft?.categoryId).toBe('food.groceries');
  });

  it('reports what the bank says it removed, and only what we hold', () => {
    const mine = tx({ type: 'expense', amount: 1_000, externalId: 'gone' });
    const result = planSync(ledger([mine]), 'conn1', payload([], { removed: [{ transaction_id: 'gone' }, { transaction_id: 'never_seen' }] }));
    expect(result.removed).toEqual([mine.id]);
  });

  it('does nothing for a connection that is not there', () => {
    const result = planSync(ledger(), 'missing', payload([plaid({ amount: 10 })]));
    expect(result.rows).toEqual([]);
    expect(result.counts).toEqual({ new: 0, transfer: 0, duplicate: 0, unmapped: 0, pending: 0, needs_pair: 0, ignored: 0 });
  });
});
