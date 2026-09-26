import { describe, expect, it } from 'vitest';

import type { FinancialSnapshot } from '../affordability';
import { TOUR_QUESTIONS, checklistProgress, newPlace, placeCost, placeHighlights, rankPlaces, scorePlace, unanswered } from '../places';
import type { Place } from '../types';

const stamp = '2026-01-01T00:00:00.000Z';

/** Take-home $5,000, essentials $2,000, currently paying $1,400 for housing. */
const snapshot = (over: Partial<FinancialSnapshot> = {}): FinancialSnapshot => ({
  takeHome: 500_000,
  gross: 650_000,
  spending: 300_000,
  essential: 200_000,
  debtPayments: 40_000,
  surplus: 160_000,
  liquidSavings: 1_500_000,
  currentHousing: 140_000,
  takeHomeBasis: 'measured',
  ...(over as object),
}) as FinancialSnapshot;

const place = (over: Partial<Place> = {}): Place => ({
  ...newPlace(),
  id: over.id ?? 'p1',
  name: over.name ?? 'Maple Court',
  createdAt: stamp,
  updatedAt: stamp,
  ...over,
});

describe('what a place really costs', () => {
  it('adds up everything that arrives every month, not just the rent', () => {
    const cost = placeCost(
      place({ rent: 150_000, parking: 7_500, petRent: 3_500, otherMonthly: 2_500, utilitiesEstimate: 12_000, insurance: 1_500 }),
    );
    expect(cost.monthly).toBe(177_000);
    expect(cost.aboveRent).toBe(27_000);
    expect(cost.breakdown.map((b) => b.key)).toEqual(['rent', 'utilities', 'parking', 'pet', 'fees', 'insurance']);
  });

  it('counts the deposit, the fees and the first month up front', () => {
    const cost = placeCost(place({ rent: 150_000, deposit: 150_000, adminFee: 25_000, applicationFee: 7_500, petDeposit: 30_000, firstMonthUpfront: true }));
    expect(cost.upfront).toBe(362_500);
    // A year of living there: twelve months, plus what you hand over at signing
    // (less the first month, which is already one of the twelve).
    expect(cost.firstYear).toBe(150_000 * 12 + 212_500);
  });

  it('leaves the first month out when it is not due at signing', () => {
    const cost = placeCost(place({ rent: 150_000, deposit: 50_000, firstMonthUpfront: false }));
    expect(cost.upfront).toBe(50_000);
    expect(cost.upfrontBreakdown.map((b) => b.key)).toEqual(['deposit']);
  });
});

describe('grading a place', () => {
  it('grades a place you can carry well', () => {
    const scored = scorePlace(snapshot(), place({ rent: 130_000, utilitiesEstimate: 10_000, deposit: 130_000 }));
    expect(scored.result.verdict).toBe('comfortable');
    expect(['A', 'B']).toContain(scored.grade);
    expect(scored.parts.affordability).toBe(55);
  });

  it('marks down a place that eats the budget', () => {
    const scored = scorePlace(snapshot(), place({ rent: 320_000, utilitiesEstimate: 25_000, deposit: 320_000 }));
    expect(scored.result.verdict).toBe('not_affordable');
    expect(scored.grade).toBe('F');
    expect(scored.weakest).toBe('affordability');
    // Rent alone is over half of gross pay.
    expect(scored.rentShare).toBeGreaterThan(0.5);
  });

  it('counts the fees, so two places with the same rent can grade differently', () => {
    const plain = scorePlace(snapshot(), place({ rent: 190_000 }));
    const fees = scorePlace(snapshot(), place({ rent: 190_000, parking: 15_000, otherMonthly: 8_500, utilitiesEstimate: 18_000 }));
    expect(fees.cost.monthly).toBeGreaterThan(plain.cost.monthly);
    expect(fees.score).toBeLessThan(plain.score);
  });

  it('lets your own impressions move the grade', () => {
    const base = place({ rent: 150_000, utilitiesEstimate: 10_000 });
    const loved = scorePlace(snapshot(), { ...base, ratings: [{ id: 'condition', score: 5 }, { id: 'light', score: 5 }, { id: 'quiet', score: 5 }] });
    const grim = scorePlace(snapshot(), { ...base, ratings: [{ id: 'condition', score: 1 }, { id: 'light', score: 2 }, { id: 'quiet', score: 1 }] });
    expect(loved.score).toBeGreaterThan(grim.score);
    expect(loved.parts.condition).toBe(25);
    expect(grim.weakest).toBe('condition');
  });

  it('never marks a place down for a question you have not asked yet', () => {
    const blank = place({ rent: 150_000, utilitiesEstimate: 10_000 });
    const asked = { ...blank, answers: [{ id: 'laundry', answer: 'yes' as const }, { id: 'storage', answer: 'yes' as const }] };
    expect(scorePlace(snapshot(), asked).parts.fit).toBeGreaterThan(scorePlace(snapshot(), blank).parts.fit);
    expect(scorePlace(snapshot(), blank).answered).toBe(0);
  });

  it('only counts answers to scored questions', () => {
    // "How much did rent go up?" is worth asking but is not a pass/fail.
    const noted = place({ rent: 150_000, answers: [{ id: 'rent_increase', note: 'Went up 4%' }] });
    const scored = scorePlace(snapshot(), noted);
    expect(scored.answered).toBe(0);
    expect(checklistProgress(noted).answered).toBe(1);
    expect(unanswered(noted).some((q) => q.id === 'rent_increase')).toBe(false);
  });

  it('ranks what you toured and says what the spread is', () => {
    const ranked = rankPlaces(snapshot(), [
      place({ id: 'a', name: 'Pricey Lofts', rent: 260_000, utilitiesEstimate: 20_000 }),
      place({ id: 'b', name: 'Maple Court', rent: 140_000, utilitiesEstimate: 10_000 }),
      place({ id: 'c', name: 'Old Mill', rent: 175_000, utilitiesEstimate: 12_000, status: 'passed' }),
    ]);
    expect(ranked[0].place.name).toBe('Maple Court');
    const highlights = placeHighlights(ranked);
    expect(highlights.best?.place.id).toBe('b');
    expect(highlights.cheapest?.place.id).toBe('b');
    // The place you passed on is not in the comparison.
    expect(highlights.spread).toBe(130_000);
  });

  it('refuses to grade when there is no income to weigh it against', () => {
    const broke = snapshot({ takeHome: 0, gross: 0, spending: 0, essential: 0, surplus: 0, currentHousing: 0, liquidSavings: 0 });
    const scored = scorePlace(broke, place({ rent: 150_000 }));
    // An F here would be a guess dressed up as a judgement.
    expect(scored.grade).toBeNull();
    expect(scored.basis).toBe('no_income');
    expect(scored.weakest).toBeNull();
    // The costs still add up, because those don't need your income.
    expect(scored.cost.monthly).toBe(150_000);
  });

  it('works for a place with nothing filled in yet', () => {
    const scored = scorePlace(snapshot(), place({ rent: 0 }));
    expect(scored.cost.monthly).toBe(0);
    expect(scored.rated).toBe(0);
    expect(scored.answered).toBe(0);
    expect(checklistProgress(place()).total).toBe(TOUR_QUESTIONS.length);
    expect(rankPlaces(snapshot(), [])).toEqual([]);
    expect(placeHighlights([])).toEqual({ best: null, cheapest: null, spread: 0 });
  });

  it('gives every question a unique id and a group', () => {
    const ids = new Set(TOUR_QUESTIONS.map((q) => q.id));
    expect(ids.size).toBe(TOUR_QUESTIONS.length);
    expect(TOUR_QUESTIONS.every((q) => q.group && q.label)).toBe(true);
    // A scored question has to be answerable yes or no.
    expect(TOUR_QUESTIONS.filter((q) => q.scored).every((q) => q.kind === 'yesno')).toBe(true);
  });
});
