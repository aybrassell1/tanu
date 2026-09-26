import { describe, expect, it } from 'vitest';

import { balanceChecks, balanceDisagreements, bankBalanceOf } from '../balanceCheck';
import { emptyLedger } from '../factory';
import type { Account, BankConnection, LedgerData, Transaction } from '../types';

const stamp = '2026-09-26T12:00:00.000Z';
const TODAY = '2026-09-26';
let seq = 0;

const acct = (id: string, name: string, startingBalance: number, type: Account['type'] = 'checking'): Account => ({
  id, name, type, startingBalance, startingDate: '2026-01-01', color: '#000', icon: 'box', tags: [], archived: false, createdAt: stamp, updatedAt: stamp,
});

const tx = (p: Partial<Transaction> & Pick<Transaction, 'type' | 'amount'>): Transaction => ({
  id: `t${++seq}`, date: '2026-09-10', description: 'Something', accountId: 'chk', tags: [], attachments: [], createdAt: stamp, updatedAt: stamp, ...p,
});

function ledger(accounts: Account[], connections: BankConnection[], transactions: Transaction[] = []): LedgerData {
  const d = emptyLedger();
  d.accounts = accounts;
  d.connections = connections;
  d.transactions = transactions;
  return d;
}

const connection = (accounts: BankConnection['accounts']): BankConnection => ({
  id: 'conn1', itemId: 'item1', institutionName: 'Bank', accessToken: 'access-production-1', accounts, createdAt: stamp, updatedAt: stamp,
});

describe('the bank as a second opinion', () => {
  it('says so when the two agree', () => {
    const data = ledger(
      [acct('chk', 'Everyday Checking', 120_000)],
      [connection([{ externalId: 'p1', name: 'Checking', type: 'depository', accountId: 'chk', lastBalance: 120_000, lastBalanceAt: stamp }])],
    );
    const [check] = balanceChecks(data, TODAY);
    expect(check.agrees).toBe(true);
    expect(check.difference).toBe(0);
    expect(balanceDisagreements(balanceChecks(data, TODAY)).checks).toEqual([]);
  });

  it('measures the gap when something never came across', () => {
    // The app has one $40 charge; the bank has taken another $25 nobody recorded.
    const data = ledger(
      [acct('chk', 'Everyday Checking', 120_000)],
      [connection([{ externalId: 'p1', name: 'Checking', type: 'depository', accountId: 'chk', lastBalance: 113_500, lastBalanceAt: stamp }])],
      [tx({ type: 'expense', amount: 4_000 })],
    );
    const [check] = balanceChecks(data, TODAY);
    expect(check.derived).toBe(116_000);
    expect(check.bank).toBe(113_500);
    // Negative: the bank thinks you have less than the app does.
    expect(check.difference).toBe(-2_500);
    expect(check.agrees).toBe(false);
  });

  it('compares a card the same way, since both count what is owed', () => {
    const data = ledger(
      [acct('card', 'Rewards Card', 50_000, 'credit_card')],
      [connection([{ externalId: 'p2', name: 'Card', type: 'credit', accountId: 'card', lastBalance: 62_000, lastBalanceAt: stamp }])],
    );
    const [check] = balanceChecks(data, TODAY);
    expect(check.difference).toBe(12_000);
    expect(check.agrees).toBe(false);
  });

  it('treats a cent of drift as agreement', () => {
    const data = ledger(
      [acct('chk', 'Checking', 100_001)],
      [connection([{ externalId: 'p1', name: 'Checking', type: 'depository', accountId: 'chk', lastBalance: 100_000, lastBalanceAt: stamp }])],
    );
    expect(balanceChecks(data, TODAY)[0].agrees).toBe(true);
  });

  it('ignores accounts that are unlinked, unseen or archived', () => {
    const archived = acct('old', 'Closed', 10_000);
    archived.archived = true;
    const data = ledger(
      [acct('chk', 'Checking', 100_000), archived],
      [
        connection([
          // Never pointed at anything here.
          { externalId: 'p1', name: 'Checking', type: 'depository', lastBalance: 99_000 },
          // Linked, but the bank has never told us a balance.
          { externalId: 'p2', name: 'Savings', type: 'depository', accountId: 'chk' },
          { externalId: 'p3', name: 'Old', type: 'depository', accountId: 'old', lastBalance: 1 },
        ]),
      ],
    );
    expect(balanceChecks(data, TODAY)).toEqual([]);
  });

  it('puts the biggest disagreement first and totals them', () => {
    const data = ledger(
      [acct('a', 'A', 100_000), acct('b', 'B', 100_000)],
      [
        connection([
          { externalId: 'pa', name: 'A', type: 'depository', accountId: 'a', lastBalance: 101_000 },
          { externalId: 'pb', name: 'B', type: 'depository', accountId: 'b', lastBalance: 90_000 },
        ]),
      ],
    );
    const checks = balanceChecks(data, TODAY);
    expect(checks.map((c) => c.accountName)).toEqual(['B', 'A']);
    expect(balanceDisagreements(checks).total).toBe(-9_000);
  });

  it('converts a bank figure to cents, and knows when there is not one', () => {
    expect(bankBalanceOf({ current: 1_138.45 })).toBe(113_845);
    expect(bankBalanceOf({ current: null })).toBeUndefined();
    expect(bankBalanceOf(undefined)).toBeUndefined();
  });
});
