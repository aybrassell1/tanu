import { describe, expect, it } from 'vitest';

import { matchOverview, matchStatus } from '../benefits';
import { emptyLedger } from '../factory';
import type { Account, IncomeSource, LedgerData, PaycheckWithholding, Transaction } from '../types';

const stamp = '2026-01-01T00:00:00.000Z';
const TODAY = '2026-06-01';
let seq = 0;

function checking(): Account {
  return { id: 'chk', name: 'Checking', type: 'checking', startingBalance: 500_000, startingDate: '2026-01-01', spendable: true, color: '#000', icon: 'box', tags: [], archived: false, createdAt: stamp, updatedAt: stamp };
}

function source(extra: Partial<IncomeSource> = {}): IncomeSource {
  return {
    id: 'inc',
    name: 'Day job',
    employer: 'Initech',
    type: 'salary',
    frequency: { unit: 'month', interval: 1 },
    anchorDate: '2026-01-15',
    expectedGross: 500_000,
    expectedNet: 380_000,
    depositAccountId: 'chk',
    categoryId: 'income.paycheck',
    active: true,
    tags: [],
    createdAt: stamp,
    updatedAt: stamp,
    ...extra,
  };
}

function paycheck(date: string, gross: number | undefined, withholding: PaycheckWithholding, sourceId = 'inc'): Transaction {
  seq++;
  return {
    id: `p${seq}`,
    type: 'income',
    amount: 380_000,
    date,
    description: 'Paycheck',
    categoryId: 'income.paycheck',
    accountId: 'chk',
    incomeSourceId: sourceId,
    grossAmount: gross,
    withholding,
    tags: [],
    attachments: [],
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/** Five monthly paychecks, Jan–May 2026, deferring `rate` percent of a $5,000 gross. */
function ytdPaychecks(rate: number, sourceId = 'inc') {
  return ['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15', '2026-05-15'].map((d) =>
    paycheck(d, 500_000, { retirement: Math.round(500_000 * (rate / 100)) }, sourceId),
  );
}

function ledger(sources: IncomeSource[], transactions: Transaction[]): LedgerData {
  const d = emptyLedger();
  d.accounts = [checking()];
  d.incomeSources = sources;
  d.transactions = transactions;
  return d;
}

describe('matchStatus', () => {
  it('measures a half-year of under-contributing and projects the shortfall', () => {
    const d = ledger([source({ match: { percent: 50, upToPercent: 6 } })], ytdPaychecks(3));
    const s = matchStatus(d, 'inc', 2026, TODAY)!;

    // Year to date: 5 × $5,000 gross, 3% deferred, matched at 50c on the dollar.
    expect(s.grossYtd).toBe(2_500_000);
    expect(s.contributedYtd).toBe(75_000);
    expect(s.rateYtd).toBe(3);
    expect(s.matchEarnedYtd).toBe(37_500);
    expect(s.matchAvailableYtd).toBe(75_000);
    expect(s.missedYtd).toBe(37_500);
    expect(s.missingGross).toBe(0);

    // Seven paychecks left in the year (Jun–Dec 15th).
    expect(s.upcomingPaychecks).toBe(7);
    expect(s.upcomingGross).toBe(3_500_000);
    expect(s.currentRate).toBe(3);
    expect(s.projectedGross).toBe(6_000_000);
    expect(s.projectedContribution).toBe(180_000);
    expect(s.projectedMatch).toBe(90_000);
    expect(s.projectedAvailable).toBe(180_000);
    expect(s.projectedMissed).toBe(90_000);
    expect(s.onTrack).toBe(false);

    // 6% captures every future dollar; 8.14% on what's left would true up the whole year.
    expect(s.fullRate).toBe(6);
    expect(s.catchUpRate).toBeCloseTo(8.142857, 4);
  });

  it('is on track at exactly the match cap and never pays extra above it', () => {
    const at = matchStatus(ledger([source({ match: { percent: 50, upToPercent: 6 } })], ytdPaychecks(6)), 'inc', 2026, TODAY)!;
    expect(at.matchEarnedYtd).toBe(75_000);
    expect(at.missedYtd).toBe(0);
    expect(at.projectedMissed).toBe(0);
    expect(at.onTrack).toBe(true);

    const over = matchStatus(ledger([source({ match: { percent: 50, upToPercent: 6 } })], ytdPaychecks(10)), 'inc', 2026, TODAY)!;
    expect(over.rateYtd).toBe(10);
    expect(over.contributedYtd).toBe(250_000);
    // Only the first 6% is matched.
    expect(over.matchEarnedYtd).toBe(75_000);
    expect(over.missedYtd).toBe(0);
    expect(over.onTrack).toBe(true);
    expect(over.catchUpRate).toBeCloseTo(3.142857, 4);
  });

  it('handles a dollar-for-dollar plan and a partial year with no paychecks yet', () => {
    const full = matchStatus(ledger([source({ match: { percent: 100, upToPercent: 4 } })], ytdPaychecks(4)), 'inc', 2026, TODAY)!;
    expect(full.matchEarnedYtd).toBe(100_000);
    expect(full.missedYtd).toBe(0);

    const fresh = matchStatus(ledger([source({ match: { percent: 50, upToPercent: 6 } })], []), 'inc', 2026, '2026-01-01')!;
    expect(fresh.paychecks).toHaveLength(0);
    expect(fresh.grossYtd).toBe(0);
    expect(fresh.rateYtd).toBe(0);
    expect(fresh.missedYtd).toBe(0);
    // Twelve paychecks ahead, none of them contributing anything yet.
    expect(fresh.upcomingPaychecks).toBe(12);
    expect(fresh.currentRate).toBe(0);
    expect(fresh.projectedMatch).toBe(0);
    expect(fresh.projectedAvailable).toBe(180_000);
    expect(fresh.projectedMissed).toBe(180_000);
    expect(fresh.onTrack).toBe(false);
  });

  it('falls back to the source withholding when no paycheck has detail yet', () => {
    const d = ledger([source({ match: { percent: 50, upToPercent: 6 }, withholding: { retirement: 25_000 } })], []);
    const s = matchStatus(d, 'inc', 2026, '2026-01-01')!;
    expect(s.currentRate).toBe(5);
    expect(s.projectedContribution).toBe(300_000);
    expect(s.projectedMatch).toBe(150_000);
    expect(s.projectedMissed).toBe(30_000);
  });

  it('uses the net amount when a paycheck has no gross, and counts the gap', () => {
    const d = ledger([source({ match: { percent: 50, upToPercent: 6 } })], [paycheck('2026-01-15', undefined, { retirement: 11_400 })]);
    const s = matchStatus(d, 'inc', 2026, '2026-02-01')!;
    expect(s.missingGross).toBe(1);
    expect(s.grossYtd).toBe(380_000);
    expect(s.rateYtd).toBe(3);
    expect(s.matchEarnedYtd).toBe(5_700);
  });

  it('reports no match when the source has none', () => {
    const s = matchStatus(ledger([source()], ytdPaychecks(3)), 'inc', 2026, TODAY)!;
    expect(s.match).toBeNull();
    expect(s.matchAvailableYtd).toBe(0);
    expect(s.matchEarnedYtd).toBe(0);
    expect(s.missedYtd).toBe(0);
    expect(s.fullRate).toBe(0);
    expect(s.catchUpRate).toBeNull();
    // The contribution rate is still measured, so the screen can show it.
    expect(s.rateYtd).toBe(3);
    expect(s.onTrack).toBe(true);
  });

  it('treats a zero match as no match and returns null for an unknown source', () => {
    const s = matchStatus(ledger([source({ match: { percent: 0, upToPercent: 6 } })], []), 'inc', 2026, TODAY)!;
    expect(s.match).toBeNull();
    expect(matchStatus(emptyLedger(), 'nope', 2026, TODAY)).toBeNull();
  });

  it('ignores paychecks from other sources and other years', () => {
    const d = ledger(
      [source({ match: { percent: 50, upToPercent: 6 } })],
      [...ytdPaychecks(3), paycheck('2025-12-15', 500_000, { retirement: 15_000 }), paycheck('2026-03-15', 500_000, { retirement: 15_000 }, 'other')],
    );
    const s = matchStatus(d, 'inc', 2026, TODAY)!;
    expect(s.paychecks).toHaveLength(5);
    expect(s.grossYtd).toBe(2_500_000);
  });
});

describe('matchOverview', () => {
  it('adds up every active source and lists the ones without a match', () => {
    const second = source({ id: 'inc2', name: 'Weekend gig', employer: 'Hooli', match: { percent: 100, upToPercent: 3 } });
    const d = ledger([source({ match: { percent: 50, upToPercent: 6 } }), second, source({ id: 'inc3', name: 'Side work' })], [
      ...ytdPaychecks(3),
      ...ytdPaychecks(0, 'inc2'),
    ]);
    const o = matchOverview(d, 2026, TODAY);

    expect(o.sources.map((s) => s.sourceId)).toEqual(['inc', 'inc2']);
    expect(o.withoutMatch).toEqual([{ sourceId: 'inc3', name: 'Side work', employer: 'Initech' }]);
    // Interest income can't come with an employer match, so it is never listed.
    expect(matchOverview(ledger([source({ id: 'int', type: 'interest' })], []), 2026, TODAY).withoutMatch).toEqual([]);
    expect(o.matchEarnedYtd).toBe(37_500);
    expect(o.matchAvailableYtd).toBe(75_000 + 75_000);
    expect(o.missedYtd).toBe(37_500 + 75_000);
    expect(o.projectedMissed).toBe(90_000 + 180_000);
    expect(o.onTrack).toBe(false);
  });

  it('is on track when nothing is being left behind', () => {
    const d = ledger([source({ match: { percent: 50, upToPercent: 6 } })], ytdPaychecks(6));
    expect(matchOverview(d, 2026, TODAY).onTrack).toBe(true);
  });

  it('skips inactive sources', () => {
    const d = ledger([source({ active: false, match: { percent: 50, upToPercent: 6 } })], ytdPaychecks(3));
    const o = matchOverview(d, 2026, TODAY);
    expect(o.sources).toHaveLength(0);
    expect(o.withoutMatch).toHaveLength(0);
    expect(o.missedYtd).toBe(0);
  });
});

describe('matchStatus — rest of the year', () => {
  it('separates what the remaining paychecks earn from the whole-year totals', () => {
    const s = matchStatus(ledger([source({ match: { percent: 50, upToPercent: 6 } })], ytdPaychecks(3)), 'inc', 2026, TODAY)!;

    // Seven $5,000 paychecks left, 3% deferred, matched 50c on the dollar.
    expect(s.remainingMatch).toBe(52_500);
    expect(s.remainingAvailable).toBe(105_000);
    expect(s.remainingMissed).toBe(52_500);

    // And the two halves still add up to the year.
    expect(s.matchEarnedYtd + s.remainingMatch).toBe(s.projectedMatch);
    expect(s.matchAvailableYtd + s.remainingAvailable).toBe(s.projectedAvailable);
    expect(s.remainingMissed).toBeLessThan(s.projectedMissed);
  });

  it('has nothing left to earn once the year is over', () => {
    const s = matchStatus(ledger([source({ match: { percent: 50, upToPercent: 6 } })], ytdPaychecks(3)), 'inc', 2026, '2026-12-31')!;
    expect(s.upcomingPaychecks).toBe(0);
    expect(s.remainingMatch).toBe(0);
    expect(s.remainingAvailable).toBe(0);
    expect(s.remainingMissed).toBe(0);
    expect(s.projectedMatch).toBe(s.matchEarnedYtd);
  });
});
