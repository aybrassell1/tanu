import { describe, expect, it } from 'vitest';

import { carAffordability, financialSnapshot, houseAffordability, purchaseAffordability, rentAffordability, type FinancialSnapshot } from '../affordability';
import { buildSampleLedger } from '../sample';
import { compareScenario } from '../scenarios';
import { carScenario } from '../affordability';

const snapshot: FinancialSnapshot = {
  takeHome: 500_000,
  takeHomeBasis: 'measured',
  gross: 650_000,
  grossEstimated: false,
  spending: 300_000,
  essential: 200_000,
  debtPayments: 50_000,
  surplus: 150_000,
  liquidSavings: 1_000_000,
  emergencyMonths: 5,
  currentHousing: 150_000,
  currentCar: 40_000,
};

describe('affordability', () => {
  it('computes a standard car loan payment', () => {
    const r = carAffordability(snapshot, { price: 3_000_000, downPayment: 600_000, tradeIn: 0, salesTaxPct: 0, fees: 0, apr: 6, termMonths: 60, insurance: 15_000, fuel: 10_000, maintenance: 5_000, replaceCurrent: false });
    // $24,000 at 6% for 60 months ≈ $463.99/mo.
    expect(r.payment).toBe(46_399);
    expect(r.monthlyCost).toBe(46_399 + 30_000);
    expect(r.newSurplus).toBe(150_000 - r.monthlyCost);
    expect(r.savingsAfter).toBe(400_000);
    expect(r.checks.find((c) => c.key === 'down')!.status).toBe('good');
    expect(r.checks.find((c) => c.key === 'term')!.status).toBe('stretch');
  });

  it('replacing the current car only charges the difference', () => {
    const base = { price: 1_000_000, downPayment: 1_000_000, tradeIn: 0, salesTaxPct: 0, fees: 0, apr: 0, termMonths: 0, insurance: 10_000, fuel: 10_000, maintenance: 0 };
    const r = carAffordability(snapshot, { ...base, replaceCurrent: true });
    expect(r.financed).toBe(0);
    expect(r.netMonthlyChange).toBe(20_000 - 40_000);
    expect(r.newSurplus).toBe(170_000);
  });

  it('flags rent above the 30% guideline and unaffordable surplus', () => {
    const ok = rentAffordability(snapshot, { rent: 150_000, utilities: 10_000, insurance: 1_500, other: 0, moveInCosts: 300_000, replaceCurrent: true });
    expect(ok.checks.find((c) => c.key === 'rent_share')!.status).toBe('good');
    expect(ok.incomeNeededYearly).toBe(Math.round((160_000 / 0.3) * 12));
    const bad = rentAffordability(snapshot, { rent: 400_000, utilities: 0, insurance: 0, other: 0, moveInCosts: 0, replaceCurrent: false });
    expect(bad.verdict).toBe('not_affordable');
  });

  it('prices a house with PMI below 20% down and finds the 28% max price', () => {
    const r = houseAffordability(snapshot, { price: 30_000_000, downPayment: 3_000_000, apr: 6.5, termYears: 30, propertyTaxPct: 1.2, insuranceYearly: 150_000, hoaMonthly: 0, pmiPct: 0.5, closingPct: 3, maintenancePct: 1, replaceCurrent: true });
    expect(r.loan).toBe(27_000_000);
    // $270,000 at 6.5% for 30 years ≈ $1,706.58.
    expect(r.principalInterest).toBe(170_658);
    expect(r.breakdown.find((b) => b.key === 'pmi')!.amount).toBe(11_250);
    expect(r.upfront).toBe(3_000_000 + 900_000);
    // At the max price the housing payment is ~28% of gross.
    const atMax = houseAffordability(snapshot, { price: r.maxPriceAt28, downPayment: Math.round(r.maxPriceAt28 * 0.1), apr: 6.5, termYears: 30, propertyTaxPct: 1.2, insuranceYearly: 150_000, hoaMonthly: 0, pmiPct: 0.5, closingPct: 3, maintenancePct: 1, replaceCurrent: true });
    expect(Math.abs(atMax.housingPayment - 0.28 * snapshot.gross)).toBeLessThan(200);
  });

  it('big purchase: months to save and cash impact', () => {
    const save = purchaseAffordability(snapshot, { cost: 250_000, method: 'save', monthlySaving: 50_000, apr: 0, termMonths: 0 });
    expect(save.monthsToSave).toBe(5);
    const cash = purchaseAffordability(snapshot, { cost: 250_000, method: 'cash', monthlySaving: 0, apr: 0, termMonths: 0 });
    expect(cash.savingsAfter).toBe(750_000);
  });

  it('builds a snapshot from real data and a car scenario that projects cleanly', () => {
    const today = '2026-09-16';
    const data = buildSampleLedger(today);
    const s = financialSnapshot(data, today);
    expect(s.takeHome).toBeGreaterThan(0);
    expect(s.gross).toBeGreaterThan(s.takeHome);
    expect(s.currentHousing).toBe(145_000);
    expect(s.currentCar).toBeGreaterThan(42_500);
    expect(Number.isFinite(s.surplus)).toBe(true);
    const input = { price: 2_500_000, downPayment: 500_000, tradeIn: 0, salesTaxPct: 7, fees: 50_000, apr: 7, termMonths: 60, insurance: 16_000, fuel: 14_000, maintenance: 6_000, replaceCurrent: false };
    const r = carAffordability(s, input);
    const cmp = compareScenario(data, carScenario(input, r), 24, today);
    expect(cmp.scenario.end.debt).toBeGreaterThan(cmp.baseline.end.debt);
  });
});
