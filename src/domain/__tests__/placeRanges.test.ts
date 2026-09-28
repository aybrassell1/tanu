import { describe, expect, it } from "vitest";

import type { FinancialSnapshot } from "../affordability";
import {
  concessionEffect,
  newPlace,
  placeCost,
  placeHighlights,
  rankPlaces,
  scorePlace,
  setUtilityCost,
  utilityCost,
} from "../places";
import type { Place, PlaceFee } from "../types";

const stamp = "2026-09-27T00:00:00.000Z";

const place = (over: Partial<Place> = {}): Place => ({
  ...newPlace(),
  id: "p1",
  name: "Maple Court",
  rent: 165_000,
  createdAt: stamp,
  updatedAt: stamp,
  ...over,
});

const snapshot = (over: Partial<FinancialSnapshot> = {}): FinancialSnapshot =>
  ({
    gross: 800_000,
    takeHome: 500_000,
    spending: 300_000,
    essential: 200_000,
    surplus: 200_000,
    currentHousing: 300_000,
    liquidSavings: 1_000_000,
    debtPayments: 40_000,
    takeHomeBasis: "measured",
    ...(over as object),
  }) as FinancialSnapshot;

const fee = (
  label: string,
  amount: number,
  high?: number,
  over: Partial<PlaceFee> = {},
): PlaceFee => ({
  id: label.toLowerCase(),
  label,
  amount,
  high,
  when: "monthly",
  ...over,
});

describe("costs quoted as a range", () => {
  it("gives a cheap month and an expensive one", () => {
    // "Electric runs $50 to $200." Both are true; only one is a budget.
    const cost = placeCost(
      place({ fees: [fee("Electric", 5_000, 20_000, { utility: true })] }),
    );
    expect(cost.monthly).toBe(170_000);
    expect(cost.monthlyHigh).toBe(185_000);
    expect(cost.utilities).toBe(5_000);
    expect(cost.utilitiesHigh).toBe(20_000);
    expect(cost.ranged).toBe(true);
    expect(cost.breakdown[1].high).toBe(20_000);
  });

  it("leaves a fixed amount alone", () => {
    const cost = placeCost(place({ fees: [fee("Valet trash", 3_500)] }));
    expect(cost.monthly).toBe(cost.monthlyHigh);
    expect(cost.ranged).toBe(false);
    expect(cost.breakdown[1].high).toBeUndefined();
  });

  it("handles a deposit that depends on the credit check", () => {
    // $500 to $1,700 at signing is the difference between yes and not yet.
    const cost = placeCost(
      place({
        firstMonthUpfront: false,
        fees: [fee("Security deposit", 50_000, 170_000, { when: "upfront" })],
      }),
    );
    expect(cost.upfront).toBe(50_000);
    expect(cost.upfrontHigh).toBe(170_000);
    expect(cost.ranged).toBe(true);
  });

  it("carries the span into the first year", () => {
    const cost = placeCost(
      place({
        firstMonthUpfront: false,
        fees: [fee("Gas", 3_000, 9_000, { utility: true })],
      }),
    );
    expect(cost.firstYear).toBe(168_000 * 12);
    expect(cost.firstYearHigh).toBe(174_000 * 12);
  });

  it("grades on the top of the range, because that month arrives too", () => {
    // A place you can only afford in July is not a place you can afford.
    const cheapEnd = scorePlace(
      snapshot(),
      place({
        rent: 120_000,
        fees: [fee("Heat", 1_000, 1_000, { utility: true })],
      }),
    );
    const wideEnd = scorePlace(
      snapshot(),
      place({
        rent: 120_000,
        fees: [fee("Heat", 1_000, 250_000, { utility: true })],
      }),
    );
    expect(wideEnd.score).toBeLessThan(cheapEnd.score);
    expect(wideEnd.rentShare).toBeGreaterThan(cheapEnd.rentShare);
  });

  it("ignores a top below the bottom rather than going backwards", () => {
    const cost = placeCost(place({ fees: [fee("Internet", 8_000, 3_000)] }));
    expect(cost.monthlyHigh).toBe(cost.monthly);
    expect(cost.ranged).toBe(false);
  });
});

describe("what each utility costs", () => {
  it("keeps one line per utility, however many times you edit it", () => {
    let fees = setUtilityCost([], "electric", "Electric", 5_000, 20_000);
    fees = setUtilityCost(fees, "electric", "Electric", 6_000, 18_000);
    expect(fees).toHaveLength(1);
    expect(fees[0].amount).toBe(6_000);
    expect(fees[0].high).toBe(18_000);
    expect(fees[0].utility).toBe(true);
    expect(fees[0].when).toBe("monthly");
  });

  it("drops the line when you clear both ends, rather than leaving a zero", () => {
    // A zero reads like an answer. An absent line reads like a question.
    const fees = setUtilityCost(
      setUtilityCost([], "gas", "Gas", 4_000),
      "gas",
      "Gas",
      undefined,
      undefined,
    );
    expect(fees).toEqual([]);
    expect(utilityCost(fees, "gas")).toBeUndefined();
  });

  it("takes a single figure without inventing a range", () => {
    const fees = setUtilityCost([], "water", "Water", 4_500);
    expect(fees[0].high).toBeUndefined();
    expect(placeCost(place({ fees })).ranged).toBe(false);
  });

  it("counts toward the housing share, the way utilities do", () => {
    const fees = setUtilityCost([], "electric", "Electric", 5_000, 20_000);
    expect(placeCost(place({ fees })).utilitiesHigh).toBe(20_000);
  });

  it("leaves other fees where they are", () => {
    const fees = setUtilityCost(
      [fee("Valet trash", 3_500)],
      "heat",
      "Heat",
      7_000,
    );
    expect(fees.map((f) => f.label)).toEqual(["Valet trash", "Heat"]);
  });
});

describe("a grade you can stand behind", () => {
  it("grades two places the same when they cost the same", () => {
    // $3,000 with four months free on a year is $2,000 a month. So is $2,000.
    const offered = scorePlace(
      snapshot(),
      place({
        rent: 300_000,
        leaseMonths: 12,
        concession: { freeMonths: 4, applied: "spread" },
      }),
    );
    const plain = scorePlace(snapshot(), place({ rent: 200_000 }));
    expect(offered.cost.rent).toBe(200_000);
    expect(offered.parts.affordability).toBe(plain.parts.affordability);
    expect(offered.grade).toBe(plain.grade);
    expect(Math.round(offered.rentShare * 100)).toBe(
      Math.round(plain.rentShare * 100),
    );
  });

  it("does not let one answer decide a letter", () => {
    const none = scorePlace(snapshot(), place({ rent: 150_000 }));
    const oneNo = scorePlace(
      snapshot(),
      place({ rent: 150_000, answers: [{ id: "security", answer: "no" }] }),
    );
    const oneYes = scorePlace(
      snapshot(),
      place({ rent: 150_000, answers: [{ id: "security", answer: "yes" }] }),
    );
    expect(none.grade).toBe(oneNo.grade);
    expect(none.grade).toBe(oneYes.grade);
    // It still moves — it just doesn't decide.
    expect(oneNo.parts.fit).toBeLessThan(none.parts.fit);
    expect(oneYes.parts.fit).toBeGreaterThan(none.parts.fit);
  });

  it("stops blaming the questions until a few have been answered", () => {
    const one = scorePlace(
      snapshot(),
      place({ rent: 150_000, answers: [{ id: "security", answer: "no" }] }),
    );
    expect(one.weakest).not.toBe("fit");
    const several = scorePlace(
      snapshot(),
      place({
        rent: 150_000,
        answers: [
          { id: "security", answer: "no" },
          { id: "locks", answer: "no" },
          { id: "laundry", answer: "no" },
          { id: "damp_check", answer: "no" },
        ],
      }),
    );
    expect(several.weakest).toBe("fit");
    expect(several.agreed).toBe(0);
    expect(several.answered).toBe(4);
  });

  it("refuses to grade a place nobody has priced", () => {
    const blank = scorePlace(snapshot(), place({ rent: 0 }));
    expect(blank.grade).toBeNull();
    expect(blank.basis).toBe("not_priced");
    expect(blank.cost.priced).toBe(false);
  });

  it("keeps an empty shell out of the comparison and off the top", () => {
    const ranked = rankPlaces(snapshot(), [
      place({ id: "blank", name: "Not filled in", rent: 0 }),
      place({ id: "real", name: "Maple Court", rent: 140_000 }),
    ]);
    // A place with no rent typed in is not the cheapest place you toured.
    expect(ranked[0].place.id).toBe("real");
    const highlights = placeHighlights(ranked);
    expect(highlights.cheapest?.place.id).toBe("real");
    expect(highlights.best?.place.id).toBe("real");
    expect(highlights.spread).toBe(0);
  });
});

describe("free months that are not whole months", () => {
  it("turns the half month into money off at signing", () => {
    // Six weeks free, taken up front: one free month, and half of another.
    const effect = concessionEffect(
      place({
        rent: 180_000,
        leaseMonths: 13,
        concession: { freeMonths: 1.5, applied: "upfront" },
      }),
    )!;
    expect(effect.freeAtStart).toBe(1);
    expect(effect.startCredit).toBe(90_000);
    expect(effect.worth).toBe(270_000);
  });

  it("does not lose half a month of rent from what you owe at signing", () => {
    const cost = placeCost(
      place({
        rent: 180_000,
        leaseMonths: 13,
        firstMonthUpfront: false,
        fees: [
          {
            id: "dep",
            label: "Security deposit",
            amount: 180_000,
            when: "upfront",
          },
        ],
        concession: { freeMonths: 1.5, applied: "upfront" },
      }),
    );
    expect(cost.upfront).toBe(90_000);
  });

  it("applies half a free month even when there is no whole one", () => {
    // "Half off your first month" used to vanish from every figure.
    const effect = concessionEffect(
      place({
        rent: 180_000,
        concession: { freeMonths: 0.5, applied: "upfront" },
      }),
    )!;
    expect(effect.freeAtStart).toBe(0);
    expect(effect.startCredit).toBe(90_000);
    const cost = placeCost(
      place({
        rent: 180_000,
        firstMonthUpfront: true,
        concession: { freeMonths: 0.5, applied: "upfront" },
      }),
    );
    expect(cost.upfront).toBe(90_000);
  });

  it("survives a lease length that is not a number", () => {
    const effect = concessionEffect(
      place({
        leaseMonths: NaN,
        concession: { freeMonths: NaN, applied: "spread" },
      }),
    );
    expect(effect).toBeUndefined();
  });
});
