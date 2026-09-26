import { describe, expect, it } from 'vitest';

import { parseBackup, serializeBackup } from '../backup';
import { emptyLedger, SCHEMA_VERSION } from '../factory';
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
    // An old backup comes forward through every migration, not just the next one.
    expect(data.meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(data.places).toEqual([]);
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

  it('turns a v4 place\'s fixed cost fields into named lines', () => {
    const raw = JSON.parse(JSON.stringify(emptyLedger()));
    raw.meta.schemaVersion = 4;
    raw.places = [
      {
        id: 'p1', name: 'Maple Court', status: 'touring', rent: 150_000,
        parking: 7_500, petRent: 0, otherMonthly: 4_500, utilitiesEstimate: 12_000, insurance: 1_500,
        deposit: 150_000, applicationFee: 7_500, adminFee: 25_000, petDeposit: 0,
        included: ['water'], firstMonthUpfront: true, answers: [], ratings: [], photos: [], tags: [],
        createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z',
      },
    ];
    const { data } = parseBackup(JSON.stringify({ format: 'masterfinance-backup', version: 4, exportedAt: '2026-09-25T00:00:00.000Z', data: raw }));
    const fees = data.places[0].fees;
    // A zero stays out; everything else keeps the label it used to have.
    expect(fees.map((f) => [f.label, f.amount, f.when])).toEqual([
      ['Utilities', 12_000, 'monthly'],
      ['Parking', 7_500, 'monthly'],
      ['Monthly fees', 4_500, 'monthly'],
      ["Renter's insurance", 1_500, 'monthly'],
      ['Security deposit', 150_000, 'upfront'],
      ['Admin fee', 25_000, 'upfront'],
      ['Application fee', 7_500, 'upfront'],
    ]);
    expect(fees.find((f) => f.label === 'Utilities')?.utility).toBe(true);
    expect(data.tourQuestions).toEqual([]);
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
