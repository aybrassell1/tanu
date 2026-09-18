import { describe, expect, it } from 'vitest';

import { parseBackup, serializeBackup } from '../backup';
import { emptyLedger } from '../factory';
import { buildSampleLedger } from '../sample';

/** A v2 snapshot knows nothing about funds, policies, IOUs, the lock or reminders. */
function v2Snapshot() {
  const raw = JSON.parse(JSON.stringify(buildSampleLedger('2026-09-17')));
  raw.meta.schemaVersion = 2;
  delete raw.sinkingFunds;
  delete raw.policies;
  delete raw.ious;
  delete raw.settings.security;
  delete raw.settings.notifications;
  return JSON.stringify({ format: 'masterfinance-backup', version: 2, exportedAt: '2026-09-17T00:00:00.000Z', data: raw });
}

describe('schema v3 migration', () => {
  it('fills in the new collections and settings', () => {
    const { data, warnings } = parseBackup(v2Snapshot());
    expect(data.meta.schemaVersion).toBe(3);
    expect(data.sinkingFunds).toEqual([]);
    expect(data.policies).toEqual([]);
    expect(data.ious).toEqual([]);
    expect(data.settings.security).toEqual({ lock: false, lockAfterMinutes: 5 });
    expect(data.settings.notifications.enabled).toBe(false);
    expect(data.settings.notifications.billsDaysBefore).toBe(2);
    // Nothing else is lost.
    expect(data.transactions.length).toBeGreaterThan(100);
    expect(warnings.some((w) => w.toLowerCase().includes('error'))).toBe(false);
  });

  it('round-trips a v3 backup with the new records intact', () => {
    const sample = buildSampleLedger('2026-09-17');
    const restored = parseBackup(serializeBackup(sample)).data;
    expect(restored.sinkingFunds.map((f) => f.id)).toEqual(sample.sinkingFunds.map((f) => f.id));
    expect(restored.policies.map((p) => p.id)).toEqual(sample.policies.map((p) => p.id));
    expect(restored.ious.map((i) => i.id)).toEqual(sample.ious.map((i) => i.id));
    const split = restored.transactions.find((t) => t.splits?.length);
    expect(split?.splits).toHaveLength(3);
    expect(split!.splits!.reduce((sum, s) => sum + s.amount, 0)).toBe(split!.amount);
  });

  it('keeps an empty ledger valid', () => {
    const restored = parseBackup(serializeBackup(emptyLedger())).data;
    expect(restored.sinkingFunds).toEqual([]);
    expect(restored.ious).toEqual([]);
  });
});
