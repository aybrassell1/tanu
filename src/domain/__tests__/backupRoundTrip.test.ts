import { describe, expect, it } from 'vitest';

import { parseBackup, serializeBackup } from '../backup';
import { emptyLedger, SCHEMA_VERSION } from '../factory';
import type { BankConnection, CustomTourQuestion, LedgerData, Place } from '../types';

/**
 * A backup is the only way data moves between devices here, and the user was
 * told his phone and his laptop stay in step that way. Anything a backup drops
 * is lost for good.
 */

const stamp = '2026-09-26T00:00:00.000Z';

const connection: BankConnection = {
  id: 'conn1',
  itemId: 'item-abc',
  institutionName: 'Marcus by Goldman Sachs',
  accessToken: 'access-production-secret',
  cursor: 'cursor-42',
  accounts: [{ externalId: 'p1', name: 'Online Savings', mask: '1459', type: 'depository', subtype: 'savings', accountId: 'acc1', lastBalance: 812_345, lastBalanceAt: stamp }],
  lastSyncedAt: stamp,
  createdAt: stamp,
  updatedAt: stamp,
};

const place: Place = {
  id: 'place1',
  name: 'Maple Court 3B',
  status: 'shortlist',
  touredOn: '2026-09-25',
  rent: 165_000,
  fees: [
    { id: 'f1', label: 'Valet trash', amount: 3_500, when: 'monthly' },
    { id: 'f2', label: 'Electric', amount: 9_000, when: 'monthly', utility: true, estimated: true },
    { id: 'f3', label: 'Security deposit', amount: 165_000, when: 'upfront' },
  ],
  included: ['water', 'trash'],
  firstMonthUpfront: true,
  leaseMonths: 12,
  answers: [{ id: 'laundry', answer: 'yes' }, { id: 'rent_increase', note: 'Went up 4%' }],
  ratings: [{ id: 'light', score: 4 }],
  notes: 'Third floor, quiet side',
  photos: [],
  tags: [],
  createdAt: stamp,
  updatedAt: stamp,
};

const question: CustomTourQuestion = { id: 'q1', label: 'Do the windows face the train line?', kind: 'yesno', createdAt: stamp };

function full(): LedgerData {
  const d = emptyLedger();
  d.accounts = [{ id: 'acc1', name: 'Online Savings', type: 'savings', startingBalance: 800_000, startingDate: '2026-09-01', color: '#000', icon: 'shield', tags: [], archived: false, createdAt: stamp, updatedAt: stamp }];
  d.transactions = [
    { id: 't1', type: 'expense', amount: 4_237, date: '2026-09-20', description: "Trader Joe's", payee: "Trader Joe's", accountId: 'acc1', externalId: 'plaid-tx-1', connectionId: 'conn1', tags: [], attachments: [], createdAt: stamp, updatedAt: stamp },
  ];
  d.connections = [connection];
  d.places = [place];
  d.tourQuestions = [question];
  d.settings.bankApi = { url: 'https://example.vercel.app', key: 'the-key', vapidPublicKey: 'BPUBLIC' };
  d.settings.autoSync = { onOpen: true, autoAdd: true };
  d.settings.transactionAlerts = true;
  d.settings.ignoredRecurring = ['some merchant'];
  return d;
}

describe('a backup keeps everything it was given', () => {
  const restored = parseBackup(serializeBackup(full())).data;

  it('brings back a connected bank, including where the sync got to', () => {
    expect(restored.connections).toHaveLength(1);
    const back = restored.connections[0];
    expect(back.accessToken).toBe(connection.accessToken);
    expect(back.cursor).toBe('cursor-42');
    expect(back.accounts[0].accountId).toBe('acc1');
    expect(back.accounts[0].lastBalance).toBe(812_345);
  });

  it('keeps the bank id on a synced transaction, so it is not imported twice', () => {
    const back = restored.transactions.find((t) => t.id === 't1');
    expect(back?.externalId).toBe('plaid-tx-1');
    expect(back?.connectionId).toBe('conn1');
  });

  it('brings back a place with its named costs, answers and ratings', () => {
    const back = restored.places[0];
    expect(back.fees.map((f) => f.label)).toEqual(['Valet trash', 'Electric', 'Security deposit']);
    expect(back.fees.find((f) => f.label === 'Electric')?.utility).toBe(true);
    expect(back.answers).toHaveLength(2);
    expect(back.ratings[0].score).toBe(4);
    expect(back.notes).toBe('Third floor, quiet side');
  });

  it('brings back questions you added yourself', () => {
    expect(restored.tourQuestions).toEqual([question]);
  });

  it('brings back the settings that make syncing work', () => {
    expect(restored.settings.bankApi).toEqual({ url: 'https://example.vercel.app', key: 'the-key', vapidPublicKey: 'BPUBLIC' });
    expect(restored.settings.autoSync).toEqual({ onOpen: true, autoAdd: true });
    expect(restored.settings.transactionAlerts).toBe(true);
    expect(restored.settings.ignoredRecurring).toEqual(['some merchant']);
  });

  it('is stamped with the current schema and reports no errors', () => {
    expect(restored.meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parseBackup(serializeBackup(full())).warnings.some((w) => w.toLowerCase().includes('error'))).toBe(false);
  });
});
