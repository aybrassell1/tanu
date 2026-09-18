import { describe, expect, it } from 'vitest';

import { buildDefaultCategories } from '../defaultCategories';
import { emptyLedger } from '../factory';
import { buildSampleLedger } from '../sample';
import { BILL_PRESETS, SETUP_ACCOUNTS, setupStatus, setupSummary, startingBalanceLabel } from '../setup';
import type { Account, LedgerData, RecurringItem } from '../types';

const stamp = '2026-01-01T00:00:00.000Z';
const account = (id: string, type: Account['type'], balance: number, extra: Partial<Account> = {}): Account => ({
  id, name: id, type, startingBalance: balance, startingDate: '2026-01-01', color: '#000', icon: 'box', tags: [], archived: false, createdAt: stamp, updatedAt: stamp, ...extra,
});
const bill = (id: string, amount: number, extra: Partial<RecurringItem> = {}): RecurringItem => ({
  id, name: id, kind: 'bill', amount, variable: false, frequency: { unit: 'month', interval: 1 }, startDate: '2026-01-05', accountId: 'chk', autopay: false, essential: true, active: true, skipped: [], tags: [], createdAt: stamp, updatedAt: stamp, ...extra,
});
function ledger(patch: Partial<LedgerData> = {}): LedgerData {
  return { ...emptyLedger(), ...patch };
}

describe('setup presets', () => {
  it('only offers categories and account types that exist', () => {
    const ids = new Set(buildDefaultCategories().map((c) => c.id));
    for (const preset of BILL_PRESETS) expect(ids.has(preset.categoryId), preset.key).toBe(true);
    expect(new Set(BILL_PRESETS.map((p) => p.key)).size).toBe(BILL_PRESETS.length);
    // Every offered account type is a real one, and spendable money comes first.
    const types = SETUP_ACCOUNTS.flatMap((g) => g.types);
    expect(new Set(types).size).toBe(types.length);
    expect(SETUP_ACCOUNTS[0].types).toContain('checking');
  });

  it('labels a starting balance by what it means', () => {
    expect(startingBalanceLabel('checking')).toBe('Balance today');
    expect(startingBalanceLabel('credit_card')).toBe('Balance owed');
  });
});

describe('setupStatus', () => {
  it('walks an empty ledger through what it still needs', () => {
    const empty = setupStatus(ledger());
    expect(empty.progress).toBe(0.25); // nothing owed yet, so debt detail is satisfied
    expect(empty.missing.map((m) => m.key)).toEqual(['accounts', 'income', 'bills']);

    const withCash = setupStatus(ledger({ accounts: [account('chk', 'checking', 100_000)] }));
    expect(withCash.hasSpendable).toBe(true);
    expect(withCash.missing.map((m) => m.key)).toEqual(['income', 'bills']);
  });

  it('asks for a due day once a card exists', () => {
    const data = ledger({ accounts: [account('chk', 'checking', 100_000), account('card', 'credit_card', 50_000)] });
    expect(setupStatus(data).missing.map((m) => m.key)).toContain('debt');
    const dated = ledger({ accounts: [account('chk', 'checking', 100_000), account('card', 'credit_card', 50_000, { dueDay: 12 })] });
    expect(setupStatus(dated).hasDebtDetail).toBe(true);
  });

  it('counts recorded income even without a saved source', () => {
    const data = ledger({
      accounts: [account('chk', 'checking', 100_000)],
      transactions: [{ id: 't1', type: 'income', amount: 200_000, date: '2026-01-02', description: 'Pay', accountId: 'chk', tags: [], attachments: [], createdAt: stamp, updatedAt: stamp }],
    });
    expect(setupStatus(data).hasIncome).toBe(true);
  });

  it('treats the sample ledger as fully set up', () => {
    const status = setupStatus(buildSampleLedger('2026-09-17'));
    expect(status.missing).toEqual([]);
    expect(status.progress).toBe(1);
  });
});

describe('setupSummary', () => {
  it('splits what is held from what is owed and normalises bills to a month', () => {
    const data = ledger({
      accounts: [account('chk', 'checking', 250_000), account('card', 'credit_card', 80_000)],
      recurring: [bill('rent', 150_000), bill('prime', 12_000, { frequency: { unit: 'year', interval: 1 } })],
    });
    const summary = setupSummary(data);
    expect(summary).toMatchObject({ accounts: 2, held: 250_000, owed: 80_000, bills: 2 });
    expect(summary.monthlyBills).toBe(150_000 + 1_000);
  });
});
