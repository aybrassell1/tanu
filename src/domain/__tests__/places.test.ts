import { describe, expect, it } from 'vitest';

import type { FinancialSnapshot } from '../affordability';
import {
  TOUR_QUESTIONS,
  TOUR_STAGES,
  checklistProgress,
  coreQuestions,
  stageQuestions,
  stillToDo,
  newPlace,
  placeCost,
  placeHighlights,
  rankPlaces,
  scorePlace,
  tourQuestions,
  unanswered,
} from '../places';
import type { CustomTourQuestion, Place, PlaceFee } from '../types';

const stamp = '2026-01-01T00:00:00.000Z';
let seq = 0;

/** Take-home $5,000, essentials $2,000, currently paying $1,400 for housing. */
const snapshot = (over: Partial<FinancialSnapshot> = {}): FinancialSnapshot =>
  ({
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

const fee = (label: string, amount: number, when: PlaceFee['when'] = 'monthly', extra: Partial<PlaceFee> = {}): PlaceFee => ({
  id: `f${++seq}`,
  label,
  amount,
  when,
  ...extra,
});

const place = (over: Partial<Place> = {}): Place => ({
  ...newPlace(),
  id: over.id ?? 'p1',
  name: over.name ?? 'Maple Court',
  createdAt: stamp,
  updatedAt: stamp,
  ...over,
});

describe('what a place really costs', () => {
  it('keeps every cost named instead of lumping them together', () => {
    const cost = placeCost(
      place({
        rent: 150_000,
        fees: [
          fee('Valet trash', 3_500),
          fee('Amenity fee', 4_500),
          fee('Parking', 7_500),
          fee('Electric', 12_000, 'monthly', { utility: true, estimated: true }),
        ],
      }),
    );
    expect(cost.monthly).toBe(177_500);
    expect(cost.aboveRent).toBe(27_500);
    // The names survive, so next week you still know what the $35 was.
    expect(cost.breakdown.map((b) => b.label)).toEqual(['Rent', 'Valet trash', 'Amenity fee', 'Parking', 'Electric']);
    // Only the utility counts as housing for the 30% rule.
    expect(cost.utilities).toBe(12_000);
  });

  it('counts the deposit, the fees and the first month up front', () => {
    const cost = placeCost(
      place({
        rent: 150_000,
        firstMonthUpfront: true,
        fees: [fee('Security deposit', 150_000, 'upfront'), fee('Admin fee', 25_000, 'upfront'), fee('Application fee', 7_500, 'upfront')],
      }),
    );
    expect(cost.upfront).toBe(332_500);
    expect(cost.upfrontBreakdown.map((b) => b.label)).toEqual(["First month's rent", 'Security deposit', 'Admin fee', 'Application fee']);
    // A year of living there: twelve months, plus what you hand over at signing
    // (less the first month, which is already one of the twelve).
    expect(cost.firstYear).toBe(150_000 * 12 + 182_500);
  });

  it('leaves the first month out when it is not due at signing', () => {
    const cost = placeCost(place({ rent: 150_000, firstMonthUpfront: false, fees: [fee('Security deposit', 50_000, 'upfront')] }));
    expect(cost.upfront).toBe(50_000);
    expect(cost.upfrontBreakdown.map((b) => b.label)).toEqual(['Security deposit']);
  });

  it('ignores a monthly fee when adding up what is due at signing, and the other way round', () => {
    const cost = placeCost(place({ rent: 100_000, firstMonthUpfront: false, fees: [fee('Parking', 5_000), fee('Admin fee', 30_000, 'upfront')] }));
    expect(cost.monthly).toBe(105_000);
    expect(cost.upfront).toBe(30_000);
  });
});

describe('grading a place', () => {
  it('grades a place you can carry well', () => {
    const scored = scorePlace(snapshot(), place({ rent: 130_000, fees: [fee('Utilities', 10_000, 'monthly', { utility: true })] }));
    expect(scored.result.verdict).toBe('comfortable');
    expect(['A', 'B']).toContain(scored.grade);
    expect(scored.parts.affordability).toBe(55);
  });

  it('marks down a place that eats the budget', () => {
    const scored = scorePlace(snapshot(), place({ rent: 320_000, fees: [fee('Utilities', 25_000, 'monthly', { utility: true })] }));
    expect(scored.result.verdict).toBe('not_affordable');
    expect(scored.grade).toBe('F');
    expect(scored.weakest).toBe('affordability');
    // Rent alone is over half of gross pay.
    expect(scored.rentShare).toBeGreaterThan(0.5);
  });

  it('counts the fees, so two places with the same rent can grade differently', () => {
    const plain = scorePlace(snapshot(), place({ rent: 190_000 }));
    const fees = scorePlace(
      snapshot(),
      place({ rent: 190_000, fees: [fee('Parking', 15_000), fee('Amenity fee', 8_500), fee('Electric', 18_000, 'monthly', { utility: true })] }),
    );
    expect(fees.cost.monthly).toBeGreaterThan(plain.cost.monthly);
    expect(fees.score).toBeLessThan(plain.score);
  });

  it('lets your own impressions move the grade', () => {
    const base = place({ rent: 150_000, fees: [fee('Utilities', 10_000, 'monthly', { utility: true })] });
    const loved = scorePlace(snapshot(), { ...base, ratings: [{ id: 'condition', score: 5 }, { id: 'light', score: 5 }, { id: 'quiet', score: 5 }] });
    const grim = scorePlace(snapshot(), { ...base, ratings: [{ id: 'condition', score: 1 }, { id: 'light', score: 2 }, { id: 'quiet', score: 1 }] });
    expect(loved.score).toBeGreaterThan(grim.score);
    expect(loved.parts.condition).toBe(25);
    expect(grim.weakest).toBe('condition');
  });

  it('never marks a place down for a question you have not asked yet', () => {
    const blank = place({ rent: 150_000 });
    const asked = { ...blank, answers: [{ id: 'laundry', answer: 'yes' as const }, { id: 'storage', answer: 'yes' as const }] };
    expect(scorePlace(snapshot(), asked).parts.fit).toBeGreaterThan(scorePlace(snapshot(), blank).parts.fit);
    expect(scorePlace(snapshot(), blank).answered).toBe(0);
    // And a part with nothing in it is never named as the weak one.
    expect(scorePlace(snapshot(), blank).weakest).not.toBe('condition');
  });

  it('only counts answers to scored questions', () => {
    // "How much did rent go up?" is worth asking but is not a pass/fail.
    const noted = place({ rent: 150_000, answers: [{ id: 'rent_increase', note: 'Went up 4%' }] });
    const scored = scorePlace(snapshot(), noted);
    expect(scored.answered).toBe(0);
    expect(checklistProgress(noted).answered).toBe(1);
    expect(unanswered(noted).some((q) => q.id === 'rent_increase')).toBe(false);
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

  it('ranks what you toured and says what the spread is', () => {
    const ranked = rankPlaces(snapshot(), [
      place({ id: 'a', name: 'Pricey Lofts', rent: 260_000, fees: [fee('Utilities', 20_000, 'monthly', { utility: true })] }),
      place({ id: 'b', name: 'Maple Court', rent: 140_000, fees: [fee('Utilities', 10_000, 'monthly', { utility: true })] }),
      place({ id: 'c', name: 'Old Mill', rent: 175_000, status: 'passed' }),
    ]);
    expect(ranked[0].place.name).toBe('Maple Court');
    const highlights = placeHighlights(ranked);
    expect(highlights.best?.place.id).toBe('b');
    expect(highlights.cheapest?.place.id).toBe('b');
    // The place you passed on is not in the comparison.
    expect(highlights.spread).toBe(130_000);
  });

  it('works for a place with nothing filled in yet', () => {
    const scored = scorePlace(snapshot(), place({ rent: 0 }));
    expect(scored.cost.monthly).toBe(0);
    expect(scored.rated).toBe(0);
    expect(scored.answered).toBe(0);
    expect(checklistProgress(place()).total).toBe(coreQuestions().length);
    expect(rankPlaces(snapshot(), [])).toEqual([]);
    expect(placeHighlights([])).toEqual({ best: null, cheapest: null, spread: 0 });
  });

  it('gives every question a unique id, a stage and someone to answer it', () => {
    const ids = new Set(TOUR_QUESTIONS.map((q) => q.id));
    expect(ids.size).toBe(TOUR_QUESTIONS.length);
    const stages = new Set(TOUR_STAGES.map((s) => s.id));
    expect(TOUR_QUESTIONS.every((q) => q.label && stages.has(q.stage) && (q.ask === 'them' || q.ask === 'you'))).toBe(true);
    // A scored question has to be answerable yes or no.
    expect(TOUR_QUESTIONS.filter((q) => q.scored).every((q) => q.kind === 'yesno')).toBe(true);
  });
});

describe('a tour happens in an order', () => {
  it('keeps the short list short enough to actually ask', () => {
    // The whole point: a leasing agent asked forty questions stops answering.
    expect(coreQuestions().length).toBeLessThanOrEqual(24);
    expect(coreQuestions().filter((q) => q.ask === 'them').length).toBeLessThanOrEqual(18);
    // And it is still worth having the rest.
    expect(TOUR_QUESTIONS.length).toBeGreaterThan(60);
  });

  it('puts something in every stage, short list and all', () => {
    for (const stage of TOUR_STAGES) {
      const here = stageQuestions(stage.id);
      expect(here.core.length).toBeGreaterThan(0);
      expect(here.more.length).toBeGreaterThan(0);
      expect(here.core.every((q) => q.stage === stage.id)).toBe(true);
    }
  });

  it('asks the money at the desk and tries the taps in the unit', () => {
    const desk = stageQuestions('desk').core.map((q) => q.id);
    expect(desk).toContain('total_move_in');
    expect(desk).toContain('move_in_specials');
    const unit = stageQuestions('unit').core;
    expect(unit.map((q) => q.id)).toContain('water_pressure');
    // Standing in the kitchen is not the moment to ask about the deposit.
    expect(unit.map((q) => q.id)).not.toContain('deposit_refundable');
    // Most of what is left in the unit is yours to try, not theirs to answer.
    expect(unit.filter((q) => q.ask === 'you').length).toBeGreaterThan(unit.filter((q) => q.ask === 'them').length);
  });

  it('separates what to ask them from what to check yourself', () => {
    const fresh = stillToDo(place());
    expect(fresh.ask.length + fresh.check.length).toBe(coreQuestions().length);
    expect(fresh.check.length).toBeGreaterThan(0);
    // Answering one takes it off the list it was on.
    const asked = place({ answers: [{ id: 'total_move_in', note: '$1,800 all in' }] });
    expect(stillToDo(asked).ask.map((q) => q.id)).not.toContain('total_move_in');
    expect(stillToDo(asked).ask.length).toBe(fresh.ask.length - 1);
  });

  it('counts progress against the short list, and extras separately', () => {
    // 'late_fee' is a real question, just not one of the essentials.
    const answered = place({ answers: [{ id: 'total_move_in', note: '$1,800' }, { id: 'late_fee', note: '5 days' }] });
    const progress = checklistProgress(answered);
    expect(progress.answered).toBe(1);
    expect(progress.total).toBe(coreQuestions().length);
    expect(progress.extra).toBe(1);
  });

  it('offers the short list first when it lists what is left', () => {
    const left = unanswered(place());
    expect(left.slice(0, coreQuestions().length).every((q) => q.core)).toBe(true);
    expect(left).toHaveLength(TOUR_QUESTIONS.length);
  });
});

describe('questions you add yourself', () => {
  const mine: CustomTourQuestion[] = [
    { id: 'q1', label: 'Is the water heater shared?', kind: 'yesno', createdAt: stamp },
    { id: 'q2', label: 'Where do the bins live?', kind: 'note', createdAt: stamp },
  ];

  it('joins them onto the checklist, kept apart from the built-in ones', () => {
    const all = tourQuestions(mine);
    expect(all).toHaveLength(TOUR_QUESTIONS.length + 2);
    expect(all.slice(-2).every((q) => q.mine)).toBe(true);
    // You would not write a question down in order to skip it, so yours are
    // always in the short list — and never buried inside a stage.
    expect(all.slice(-2).every((q) => q.core)).toBe(true);
    expect(checklistProgress(place(), mine).total).toBe(coreQuestions().length + 2);
    expect(TOUR_STAGES.some((s) => stageQuestions(s.id, mine).core.some((q) => q.mine))).toBe(false);
  });

  it('counts a yes/no one toward the grade and a note one not at all', () => {
    const answered = place({ rent: 150_000, answers: [{ id: 'q1', answer: 'no' }, { id: 'q2', note: 'Round the back' }] });
    const scored = scorePlace(snapshot(), answered, mine);
    expect(scored.answered).toBe(1);
    expect(scored.parts.fit).toBe(0);
    expect(unanswered(answered, mine).map((q) => q.id)).not.toContain('q1');
  });
});
