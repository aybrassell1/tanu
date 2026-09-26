import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyLedger } from '../factory';
import type { Account, BankConnection, LedgerData, Transaction } from '../types';

/**
 * The catch-up runs without anyone watching, so what it decides *not* to do
 * matters as much as what it does.
 */

const stamp = '2026-09-26T12:00:00.000Z';
const NOW = Date.parse(stamp);
let seq = 0;

const acct = (id: string): Account => ({
  id, name: id, type: 'checking', startingBalance: 100_000, startingDate: '2026-01-01', color: '#000', icon: 'box', tags: [], archived: false, createdAt: stamp, updatedAt: stamp,
});

const connection = (over: Partial<BankConnection> = {}): BankConnection => ({
  id: `conn${++seq}`,
  itemId: `item${seq}`,
  institutionName: 'Test Bank',
  accessToken: 'access-production-1',
  accounts: [{ externalId: 'p_chk', name: 'Checking', type: 'depository', accountId: 'chk' }],
  createdAt: stamp,
  updatedAt: stamp,
  ...over,
});

function ledgerWith(connections: BankConnection[], transactions: Transaction[] = []): LedgerData {
  const d = emptyLedger();
  d.accounts = [acct('chk')];
  d.connections = connections;
  d.transactions = transactions;
  d.settings.bankApi = { url: 'https://example.test', key: 'k' };
  return d;
}

const hoursAgo = (n: number) => new Date(NOW - n * 3_600_000).toISOString();

const syncAll = vi.fn((_token: string, _cursor?: string) => Promise.resolve<unknown>({}));
const applySync = vi.fn((_id: string, _input: unknown) => ({ ok: true as const, id: 0 }));
const flagConnection = vi.fn((_id: string, _reason?: string) => {});

vi.mock('@/lib/plaid', async () => {
  const actual = await vi.importActual<typeof import('../../lib/plaid')>('../../lib/plaid');
  return { ...actual, syncAll: (token: string, cursor?: string) => syncAll(token, cursor) };
});

vi.mock('@/store/ledger', () => ({
  ledger: {
    applySync: (id: string, input: unknown) => applySync(id, input),
    flagConnection: (id: string, reason?: string) => flagConnection(id, reason),
  },
  useLedgerStore: { getState: () => ({ data: state }) },
}));

let state: LedgerData;

const { runAutoSync } = await import('../../lib/autoSync');

const emptyPayload = { added: [], modified: [], removed: [], next_cursor: 'c2', has_more: false };

beforeEach(() => {
  syncAll.mockReset().mockResolvedValue(emptyPayload);
  applySync.mockReset().mockReturnValue({ ok: true, id: 0 });
  flagConnection.mockReset();
});

describe('catching up on open', () => {
  it('does nothing without a server configured', async () => {
    const data = ledgerWith([connection()]);
    data.settings.bankApi = undefined;
    state = data;
    expect(await runAutoSync(data, NOW)).toEqual([]);
    expect(syncAll).not.toHaveBeenCalled();
  });

  it('leaves a bank alone that was synced an hour ago', async () => {
    const data = ledgerWith([connection({ lastSyncedAt: hoursAgo(1) })]);
    state = data;
    expect(await runAutoSync(data, NOW)).toEqual([]);
    expect(syncAll).not.toHaveBeenCalled();
  });

  it('asks a bank that has not been seen since yesterday', async () => {
    const data = ledgerWith([connection({ lastSyncedAt: hoursAgo(20) })]);
    state = data;
    const outcomes = await runAutoSync(data, NOW);
    expect(syncAll).toHaveBeenCalledOnce();
    expect(outcomes).toHaveLength(1);
  });

  it('asks a bank that has never been synced', async () => {
    state = ledgerWith([connection()]);
    await runAutoSync(state, NOW);
    expect(syncAll).toHaveBeenCalledOnce();
  });

  it('skips a bank that is asking you to sign in again', async () => {
    const data = ledgerWith([connection({ needsAttention: 'Reconnect me' })]);
    state = data;
    expect(await runAutoSync(data, NOW)).toEqual([]);
    expect(syncAll).not.toHaveBeenCalled();
  });

  it('skips a bank whose accounts point nowhere', async () => {
    const data = ledgerWith([connection({ accounts: [{ externalId: 'p_chk', name: 'Checking', type: 'depository' }] })]);
    state = data;
    expect(await runAutoSync(data, NOW)).toEqual([]);
    expect(syncAll).not.toHaveBeenCalled();
  });

  it('adds what it finds, and moves the cursor on', async () => {
    const data = ledgerWith([connection({ id: 'conn_a' })]);
    state = data;
    syncAll.mockResolvedValue({
      ...emptyPayload,
      added: [{ transaction_id: 'p1', account_id: 'p_chk', amount: 12.5, date: '2026-09-25', name: 'CORNER CAFE' }],
      next_cursor: 'cursor_next',
    });
    applySync.mockReturnValue({ ok: true, id: 1 });

    const outcomes = await runAutoSync(data, NOW);
    expect(applySync).toHaveBeenCalledOnce();
    const [id, input] = applySync.mock.calls[0] as unknown as [string, { add: unknown[]; cursor: string }];
    expect(id).toBe('conn_a');
    expect(input.add).toHaveLength(1);
    expect(input.cursor).toBe('cursor_next');
    expect(outcomes[0].added).toBe(1);
  });

  it('writes nothing when you have asked to see things first', async () => {
    const data = ledgerWith([connection()]);
    data.settings.autoSync = { onOpen: true, autoAdd: false };
    state = data;
    syncAll.mockResolvedValue({
      ...emptyPayload,
      added: [{ transaction_id: 'p1', account_id: 'p_chk', amount: 12.5, date: '2026-09-25', name: 'CORNER CAFE' }],
    });

    const outcomes = await runAutoSync(data, NOW);
    expect(applySync).not.toHaveBeenCalled();
    expect(outcomes[0].waiting).toBe(1);
  });

  it('flags a broken login, and stays quiet about a bad network', async () => {
    const { PlaidError } = await import('../../lib/plaid');
    state = ledgerWith([connection({ id: 'conn_b' })]);
    syncAll.mockRejectedValueOnce(new PlaidError('Sign in again', 'ITEM_LOGIN_REQUIRED'));
    await runAutoSync(state, NOW);
    expect(flagConnection).toHaveBeenCalledWith('conn_b', expect.stringContaining('Reconnect'));

    flagConnection.mockReset();
    syncAll.mockRejectedValueOnce(new PlaidError('Network is having a day'));
    const outcomes = await runAutoSync(state, NOW);
    expect(flagConnection).not.toHaveBeenCalled();
    expect(outcomes[0].error).toBe('Network is having a day');
  });

  it('keeps going when one bank of two is down', async () => {
    const { PlaidError } = await import('../../lib/plaid');
    state = ledgerWith([connection({ id: 'conn_c' }), connection({ id: 'conn_d' })]);
    syncAll.mockRejectedValueOnce(new PlaidError('Down')).mockResolvedValueOnce(emptyPayload);
    const outcomes = await runAutoSync(state, NOW);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0].error).toBe('Down');
    expect(outcomes[1].error).toBeUndefined();
  });
});
