import { describe, expect, it } from 'vitest';

import { emptyLedger } from '../factory';
import { indexLedger } from '../ledger';
import { planSync, type PlaidTransaction, type SyncPayload } from '../plaidSync';
import type { Account, BankConnection, LedgerData, Transaction } from '../types';
import { validateTransaction } from '../validation';

/**
 * The sync writes without anyone watching, so every row it produces has to be
 * something the ledger would have accepted from a person.
 */

const stamp = '2026-09-26T00:00:00.000Z';
let seq = 0;

const acct = (id: string, type: Account['type']): Account => ({
  id, name: id, type, startingBalance: type === 'credit_card' ? 0 : 500_000, startingDate: '2026-01-01', color: '#000', icon: 'box', tags: [], archived: false, createdAt: stamp, updatedAt: stamp,
});

const plaid = (over: Partial<PlaidTransaction> & Pick<PlaidTransaction, 'amount' | 'account_id'>): PlaidTransaction => ({
  transaction_id: over.transaction_id ?? `p${++seq}`,
  date: '2026-09-20',
  name: 'SOMETHING',
  ...over,
});

const payload = (added: PlaidTransaction[]): SyncPayload => ({ added, modified: [], removed: [], next_cursor: 'c', has_more: false });

function ledger(accounts: BankConnection['accounts']): LedgerData {
  const d = emptyLedger();
  d.accounts = [acct('chk', 'checking'), acct('card', 'credit_card')];
  d.connections = [{ id: 'conn1', itemId: 'i1', institutionName: 'Bank', accessToken: 'access-production-1', accounts, createdAt: stamp, updatedAt: stamp }];
  return d;
}

/** Would the store have kept this row? */
const acceptable = (data: LedgerData, draft: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => {
  const tx: Transaction = { ...draft, id: 't1', createdAt: stamp, updatedAt: stamp };
  const errors = validateTransaction({ ...data, transactions: [...data.transactions, tx] }, tx);
  return Object.values(errors).filter(Boolean);
};

describe('every row a sync produces is one the ledger would accept', () => {
  it('a card payment whose other side is not connected', () => {
    // The card is linked, the checking account it was paid from is not — so
    // there is no second half to pair with.
    const data = ledger([{ externalId: 'p_card', name: 'Card', type: 'credit', accountId: 'card' }]);
    const result = planSync(data, 'conn1', payload([plaid({ account_id: 'p_card', amount: -300, name: 'PAYMENT THANK YOU' })]));
    const row = result.rows[0];
    // A payment from nowhere is not something we can honestly write down, so
    // it waits rather than being invented or silently dropped.
    expect(row.kind).toBe('needs_pair');
    expect(row.draft).toBeUndefined();
  });

  it('a refund onto a card', () => {
    const data = ledger([{ externalId: 'p_card', name: 'Card', type: 'credit', accountId: 'card' }]);
    const result = planSync(data, 'conn1', payload([plaid({ account_id: 'p_card', amount: -42.5, name: 'RETURN - TARGET' })]));
    // A refund offsets what you spent; it is not income.
    expect(result.rows[0].draft?.type).toBe('refund');
    expect(acceptable(data, result.rows[0].draft!)).toEqual([]);
  });

  it('money arriving in checking', () => {
    const data = ledger([{ externalId: 'p_chk', name: 'Checking', type: 'depository', accountId: 'chk' }]);
    const result = planSync(data, 'conn1', payload([plaid({ account_id: 'p_chk', amount: -1_800, name: 'PAYROLL' })]));
    expect(result.rows[0].draft?.type).toBe('income');
    expect(acceptable(data, result.rows[0].draft!)).toEqual([]);
  });

  it('a charge on a card and a charge on checking', () => {
    const data = ledger([
      { externalId: 'p_chk', name: 'Checking', type: 'depository', accountId: 'chk' },
      { externalId: 'p_card', name: 'Card', type: 'credit', accountId: 'card' },
    ]);
    const result = planSync(data, 'conn1', payload([
      plaid({ account_id: 'p_chk', amount: 12.5 }),
      plaid({ account_id: 'p_card', amount: 61.1 }),
    ]));
    for (const row of result.rows) expect(acceptable(data, row.draft!)).toEqual([]);
  });

  it('a paired transfer, which is the one case with two accounts', () => {
    const data = ledger([
      { externalId: 'p_chk', name: 'Checking', type: 'depository', accountId: 'chk' },
      { externalId: 'p_card', name: 'Card', type: 'credit', accountId: 'card' },
    ]);
    const result = planSync(data, 'conn1', payload([
      plaid({ transaction_id: 'out', account_id: 'p_chk', amount: 300, name: 'PAYMENT TO CARD' }),
      plaid({ transaction_id: 'in', account_id: 'p_card', amount: -300, date: '2026-09-21', name: 'PAYMENT THANK YOU' }),
    ]));
    const paired = result.rows.find((r) => r.draft)!;
    expect(paired.draft?.type).toBe('debt_payment');
    expect(acceptable(data, paired.draft!)).toEqual([]);
  });

  it('a zero-amount line, which some banks send', () => {
    const data = ledger([{ externalId: 'p_chk', name: 'Checking', type: 'depository', accountId: 'chk' }]);
    const result = planSync(data, 'conn1', payload([plaid({ account_id: 'p_chk', amount: 0, name: 'BALANCE ADJUSTMENT' })]));
    expect(result.rows[0].kind).toBe('ignored');
    expect(result.rows[0].draft).toBeUndefined();
  });

  it('a charge with no description at all', () => {
    const data = ledger([{ externalId: 'p_chk', name: 'Checking', type: 'depository', accountId: 'chk' }]);
    const result = planSync(data, 'conn1', payload([plaid({ account_id: 'p_chk', amount: 9.99, name: '', merchant_name: null })]));
    expect(acceptable(data, result.rows[0].draft!)).toEqual([]);
  });

  it('leaves the ledger index able to post every row', () => {
    const data = ledger([{ externalId: 'p_chk', name: 'Checking', type: 'depository', accountId: 'chk' }]);
    const result = planSync(data, 'conn1', payload([plaid({ account_id: 'p_chk', amount: 20 })]));
    const applied = { ...data, transactions: result.rows.filter((r) => r.draft).map((r, i) => ({ ...r.draft!, id: `x${i}`, createdAt: stamp, updatedAt: stamp })) };
    // A posting that goes nowhere would quietly not move a balance.
    const index = indexLedger(applied);
    expect((index.postings.get('chk') ?? []).length).toBeGreaterThan(0);
  });
});
