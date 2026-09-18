import type { Cents } from './types';

/**
 * US federal tax parameters by tax year. Amounts are in cents.
 *
 * Sources (verified September 2026):
 * - 2026: IRS Rev. Proc. 2025-32 (IRB 2025-45) https://www.irs.gov/irb/2025-45_IRB
 * - 2025: https://www.irs.gov/filing/federal-income-tax-rates-and-brackets and
 *   https://www.irs.gov/newsroom/one-big-beautiful-bill-provisions-individuals-and-workers
 * - SALT: https://www.irs.gov/forms-pubs/correction-to-state-and-local-income-tax-deduction-amount-in-the-2026-form-1040-es
 * - Retirement limits: https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500
 * - HSA: IRS Rev. Proc. 2025-19
 * - Social Security wage base: https://www.ssa.gov/oact/cola/cbb.html
 * - Mileage: https://www.irs.gov/tax-professionals/standard-mileage-rates
 *
 * Years without published tables fall back to the latest year, and the UI
 * says so. Update this file each fall when the IRS publishes new amounts.
 */

import type { FilingStatus } from './types';

export type { FilingStatus };

export const FILING_STATUS_LABEL: Record<FilingStatus, string> = {
  single: 'Single',
  married_joint: 'Married filing jointly',
  married_separate: 'Married filing separately',
  head_of_household: 'Head of household',
};

/** [upper bound of bracket in cents (Infinity for the top), rate]. */
export type Brackets = [number, number][];

export interface TaxYearTable {
  year: number;
  brackets: Record<FilingStatus, Brackets>;
  standardDeduction: Record<FilingStatus, Cents>;
  /** Long-term capital gains / qualified dividends: top of 0% and 15% bands. */
  capitalGains: Record<FilingStatus, [Cents, Cents]>;
  saltCap: { limit: Cents; limitSeparate: Cents; phaseDownStart: Cents; phaseDownStartSeparate: Cents; floor: Cents; floorSeparate: Cents };
  childTaxCredit: Cents;
  otherDependentCredit: Cents;
  studentLoanInterestMax: Cents;
  socialSecurityWageBase: Cents;
  additionalMedicareThreshold: Record<FilingStatus, Cents>;
  limits: {
    k401: Cents;
    k401CatchUp50: Cents;
    ira: Cents;
    iraCatchUp50: Cents;
    hsaSelf: Cents;
    hsaFamily: Cents;
    hsaCatchUp55: Cents;
    healthFsa: Cents;
  };
  /** Business mileage rate in cents per mile, with effective start dates (MM-DD). */
  mileage: { from: string; business: number; medical: number; charitable: number }[];
  /** Enhanced senior deduction per person age 65+ (2025–2028). */
  seniorDeduction: Cents;
  seniorPhaseOut: Record<'single' | 'joint', Cents>;
  /** Medical expenses above this share of AGI are deductible when itemizing. */
  medicalFloor: number;
}

const $ = (d: number) => Math.round(d * 100);
const b = (...pairs: [number, number][]): Brackets => pairs.map(([top, rate]) => [top === Infinity ? Infinity : $(top), rate]);

export const TAX_TABLES: TaxYearTable[] = [
  {
    year: 2025,
    brackets: {
      single: b([11_925, 0.1], [48_475, 0.12], [103_350, 0.22], [197_300, 0.24], [250_525, 0.32], [626_350, 0.35], [Infinity, 0.37]),
      married_joint: b([23_850, 0.1], [96_950, 0.12], [206_700, 0.22], [394_600, 0.24], [501_050, 0.32], [751_600, 0.35], [Infinity, 0.37]),
      married_separate: b([11_925, 0.1], [48_475, 0.12], [103_350, 0.22], [197_300, 0.24], [250_525, 0.32], [375_800, 0.35], [Infinity, 0.37]),
      head_of_household: b([17_000, 0.1], [64_850, 0.12], [103_350, 0.22], [197_300, 0.24], [250_500, 0.32], [626_350, 0.35], [Infinity, 0.37]),
    },
    standardDeduction: { single: $(15_750), married_joint: $(31_500), married_separate: $(15_750), head_of_household: $(23_625) },
    capitalGains: { single: [$(48_350), $(533_400)], married_joint: [$(96_700), $(600_050)], married_separate: [$(48_350), $(300_000)], head_of_household: [$(64_750), $(566_700)] },
    saltCap: { limit: $(40_000), limitSeparate: $(20_000), phaseDownStart: $(500_000), phaseDownStartSeparate: $(250_000), floor: $(10_000), floorSeparate: $(5_000) },
    childTaxCredit: $(2_200),
    otherDependentCredit: $(500),
    studentLoanInterestMax: $(2_500),
    socialSecurityWageBase: $(176_100),
    additionalMedicareThreshold: { single: $(200_000), married_joint: $(250_000), married_separate: $(125_000), head_of_household: $(200_000) },
    limits: { k401: $(23_500), k401CatchUp50: $(7_500), ira: $(7_000), iraCatchUp50: $(1_000), hsaSelf: $(4_300), hsaFamily: $(8_550), hsaCatchUp55: $(1_000), healthFsa: $(3_300) },
    mileage: [{ from: '01-01', business: 70, medical: 21, charitable: 14 }],
    seniorDeduction: $(6_000),
    seniorPhaseOut: { single: $(75_000), joint: $(150_000) },
    medicalFloor: 0.075,
  },
  {
    year: 2026,
    brackets: {
      single: b([12_400, 0.1], [50_400, 0.12], [105_700, 0.22], [201_775, 0.24], [256_225, 0.32], [640_600, 0.35], [Infinity, 0.37]),
      married_joint: b([24_800, 0.1], [100_800, 0.12], [211_400, 0.22], [403_550, 0.24], [512_450, 0.32], [768_700, 0.35], [Infinity, 0.37]),
      married_separate: b([12_400, 0.1], [50_400, 0.12], [105_700, 0.22], [201_775, 0.24], [256_225, 0.32], [384_350, 0.35], [Infinity, 0.37]),
      head_of_household: b([17_700, 0.1], [67_450, 0.12], [105_700, 0.22], [201_750, 0.24], [256_200, 0.32], [640_600, 0.35], [Infinity, 0.37]),
    },
    standardDeduction: { single: $(16_100), married_joint: $(32_200), married_separate: $(16_100), head_of_household: $(24_150) },
    capitalGains: { single: [$(49_450), $(545_500)], married_joint: [$(98_900), $(613_700)], married_separate: [$(49_450), $(306_850)], head_of_household: [$(66_200), $(579_600)] },
    saltCap: { limit: $(40_400), limitSeparate: $(20_200), phaseDownStart: $(505_000), phaseDownStartSeparate: $(252_500), floor: $(10_000), floorSeparate: $(5_000) },
    childTaxCredit: $(2_200),
    otherDependentCredit: $(500),
    studentLoanInterestMax: $(2_500),
    socialSecurityWageBase: $(184_500),
    additionalMedicareThreshold: { single: $(200_000), married_joint: $(250_000), married_separate: $(125_000), head_of_household: $(200_000) },
    limits: { k401: $(24_500), k401CatchUp50: $(8_000), ira: $(7_500), iraCatchUp50: $(1_100), hsaSelf: $(4_400), hsaFamily: $(8_750), hsaCatchUp55: $(1_000), healthFsa: $(3_400) },
    mileage: [
      { from: '01-01', business: 72.5, medical: 20.5, charitable: 14 },
      { from: '07-01', business: 76, medical: 23.5, charitable: 14 },
    ],
    seniorDeduction: $(6_000),
    seniorPhaseOut: { single: $(75_000), joint: $(150_000) },
    medicalFloor: 0.075,
  },
];

export function taxTableFor(year: number): { table: TaxYearTable; exact: boolean } {
  const exact = TAX_TABLES.find((t) => t.year === year);
  if (exact) return { table: exact, exact: true };
  const sorted = [...TAX_TABLES].sort((a, b) => a.year - b.year);
  const fallback = year < sorted[0].year ? sorted[0] : sorted[sorted.length - 1];
  return { table: fallback, exact: false };
}

export function mileageRateOn(table: TaxYearTable, date: string, purpose: 'business' | 'medical' | 'charitable'): number {
  const md = date.slice(5);
  let rate = table.mileage[0];
  for (const r of table.mileage) if (md >= r.from) rate = r;
  return rate[purpose];
}

/** Federal holidays that can land on a tax deadline: MLK Day and DC Emancipation Day (observed). */
function isDeadlineHoliday(d: Date) {
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const dow = d.getUTCDay();
  if (m === 1 && dow === 1 && day >= 15 && day <= 21) return true;
  if (m === 4) {
    if (day === 16 && dow >= 1 && dow <= 5) return true;
    if (day === 15 && dow === 5) return true; // Apr 16 on Saturday
    if (day === 17 && dow === 1) return true; // Apr 16 on Sunday
  }
  return false;
}

/** Moves a deadline past weekends and federal holidays. */
export function rollDeadline(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || isDeadlineHoliday(d)) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Estimated-payment due dates (Form 1040-ES) for a tax year. */
export function estimatedPaymentDueDates(year: number): { quarter: number; due: string }[] {
  const roll = rollDeadline;
  return [
    { quarter: 1, due: roll(`${year}-04-15`) },
    { quarter: 2, due: roll(`${year}-06-15`) },
    { quarter: 3, due: roll(`${year}-09-15`) },
    { quarter: 4, due: roll(`${year + 1}-01-15`) },
  ];
}
