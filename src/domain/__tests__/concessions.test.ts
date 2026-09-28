import { describe, expect, it } from 'vitest';

import { concessionEffect, newPlace, placeCost } from '../places';
import type { Place } from '../types';

const stamp = '2026-09-27T00:00:00.000Z';

const place = (over: Partial<Place> = {}): Place => ({
  ...newPlace(),
  id: 'p1',
  name: 'Maple Court',
  rent: 165_000,
  createdAt: stamp,
  updatedAt: stamp,
  ...over,
});

describe('free months, and what they are actually worth', () => {
  it('spread over the lease, it lowers every month', () => {
    // Two months free on a fourteen-month lease: you pay twelve months of rent
    // across fourteen months.
    const effect = concessionEffect(place({ leaseMonths: 14, concession: { freeMonths: 2, applied: 'spread' } }))!;
    expect(effect.askingRent).toBe(165_000);
    expect(effect.effectiveRent).toBe(141_429);
    expect(effect.payMonth).toBe(141_429);
    expect(effect.freeAtStart).toBe(0);
    expect(effect.worth).toBe(330_000);
    // And at renewal it goes back up, which is the part nobody mentions.
    expect(effect.renewalJump).toBe(23_571);
  });

  it('taken up front, the months are free and the rest is full price', () => {
    const effect = concessionEffect(place({ leaseMonths: 14, concession: { freeMonths: 2, applied: 'upfront' } }))!;
    expect(effect.freeAtStart).toBe(2);
    // What you must be able to afford every other month is unchanged.
    expect(effect.payMonth).toBe(165_000);
    expect(effect.worth).toBe(330_000);
    // Nothing falls away at renewal, because nothing was lowered.
    expect(effect.renewalJump).toBe(0);
    // The average is the same either way; only the shape differs.
    expect(effect.effectiveRent).toBe(141_429);
  });

  it('counts half months, which landlords really do offer', () => {
    const effect = concessionEffect(place({ rent: 200_000, leaseMonths: 12, concession: { freeMonths: 1.5, applied: 'spread' } }))!;
    expect(effect.worth).toBe(300_000);
    expect(effect.effectiveRent).toBe(175_000);
  });

  it('adds money off at signing to what the offer is worth', () => {
    const effect = concessionEffect(place({ leaseMonths: 12, concession: { freeMonths: 1, applied: 'upfront', upfrontCredit: 50_000 } }))!;
    expect(effect.worth).toBe(215_000);
  });

  it('is nothing when there is no offer', () => {
    expect(concessionEffect(place())).toBeUndefined();
    expect(concessionEffect(place({ concession: { freeMonths: 0, applied: 'spread' } }))).toBeUndefined();
  });

  it('does not believe more free months than the lease has', () => {
    const effect = concessionEffect(place({ leaseMonths: 12, concession: { freeMonths: 18, applied: 'spread' } }))!;
    expect(effect.effectiveRent).toBe(0);
    expect(effect.worth).toBe(165_000 * 12);
  });

  it('assumes a year when nobody said how long the lease is', () => {
    expect(concessionEffect(place({ concession: { freeMonths: 1, applied: 'spread' } }))!.leaseMonths).toBe(12);
  });
});

describe('what the offer does to the cost of the place', () => {
  it('a spread offer lowers the monthly figure the grade is built on', () => {
    const plain = placeCost(place({ leaseMonths: 14 }));
    const offered = placeCost(place({ leaseMonths: 14, concession: { freeMonths: 2, applied: 'spread' } }));
    expect(plain.monthly).toBe(165_000);
    expect(offered.monthly).toBe(141_429);
    expect(offered.breakdown[0].label).toBe('Rent, after the offer');
  });

  it('an upfront offer leaves the monthly figure alone, because it has to', () => {
    // You still need 165,000 a month from month three onwards.
    const offered = placeCost(place({ leaseMonths: 14, concession: { freeMonths: 2, applied: 'upfront' } }));
    expect(offered.monthly).toBe(165_000);
    expect(offered.concession?.freeAtStart).toBe(2);
  });

  it('does not ask for a first month that is free', () => {
    const offered = placeCost(place({ firstMonthUpfront: true, concession: { freeMonths: 1, applied: 'upfront' } }));
    expect(offered.upfrontBreakdown.find((b) => b.key === 'first')).toBeUndefined();
    expect(offered.upfront).toBe(0);
  });

  it('takes money off at signing off what is due at signing', () => {
    const offered = placeCost(
      place({
        firstMonthUpfront: false,
        fees: [{ id: 'f1', label: 'Security deposit', amount: 165_000, when: 'upfront' }],
        concession: { freeMonths: 0, applied: 'upfront', upfrontCredit: 50_000 },
      }),
    );
    expect(offered.upfront).toBe(115_000);
  });

  it('counts the free months into the first year', () => {
    const upfront = placeCost(place({ firstMonthUpfront: false, leaseMonths: 14, concession: { freeMonths: 2, applied: 'upfront' } }));
    // Ten paid months in the first twelve.
    expect(upfront.firstYear).toBe(165_000 * 10);

    const spread = placeCost(place({ firstMonthUpfront: false, leaseMonths: 14, concession: { freeMonths: 2, applied: 'spread' } }));
    expect(spread.firstYear).toBe(141_429 * 12);
  });
});
