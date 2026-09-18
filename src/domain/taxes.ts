import { addDays, diffDays, isValidISODate } from './dates';
import { categoryLines, indexLedger, spendingAmount, TRANSFER_TYPES } from './ledger';
import { centsToInput, sum } from './money';
import { expectedGross, scheduledEvents } from './schedule';
import { estimatedPaymentDueDates, mileageRateOn, rollDeadline, taxTableFor, type Brackets, type TaxYearTable } from './taxTables';
import type {
  Account,
  Cents,
  FilingStatus,
  IncomeTaxKind,
  ISODate,
  LedgerData,
  PaycheckWithholding,
  TaxDocument,
  TaxProfile,
  TaxTag,
  TaxYearRecord,
  Transaction,
} from './types';

/**
 * US federal tax estimates from the ledger. This is a planning estimate, not
 * tax preparation: it covers the common situations (wages, self-employment,
 * interest and dividends, standard vs itemized deductions, key credits) and
 * lists what it doesn't model so the user knows where it can be off.
 */

// ─── Metadata ────────────────────────────────────────────────────────────────

export const TAX_TAGS: Record<TaxTag, { label: string; emoji: string; group: 'itemized' | 'adjustment' | 'business' | 'credit' | 'payment' | 'info'; hint: string }> = {
  charitable: { label: 'Charitable giving', emoji: 'red-heart', group: 'itemized', hint: 'Deductible when you itemize. Keep receipts for gifts of $250+.' },
  medical: { label: 'Medical & dental', emoji: 'stethoscope', group: 'itemized', hint: 'Deductible above 7.5% of AGI when itemizing; often HSA-eligible.' },
  mortgage_interest: { label: 'Mortgage interest', emoji: 'house-with-garden', group: 'itemized', hint: 'Reported on Form 1098; deductible when itemizing.' },
  property_tax: { label: 'Property tax', emoji: 'house', group: 'itemized', hint: 'Counts toward the state & local tax (SALT) limit.' },
  state_local_tax: { label: 'State & local income tax', emoji: 'classical-building', group: 'itemized', hint: 'Counts toward the SALT limit when itemizing.' },
  business: { label: 'Business expenses', emoji: 'briefcase', group: 'business', hint: 'Reduces self-employment profit (Schedule C).' },
  home_office: { label: 'Home office', emoji: 'desktop-computer', group: 'business', hint: 'For self-employed people using space regularly and exclusively for work.' },
  student_loan_interest: { label: 'Student loan interest', emoji: 'graduation-cap', group: 'adjustment', hint: 'Up to $2,500, phased out at higher incomes (Form 1098-E).' },
  car_loan_interest: { label: 'Car loan interest', emoji: 'automobile', group: 'adjustment', hint: 'Up to $10,000 for qualifying new US-assembled vehicles, 2025–2028.' },
  education: { label: 'Education', emoji: 'books', group: 'credit', hint: 'May qualify for the American Opportunity or Lifetime Learning credit (Form 1098-T).' },
  childcare: { label: 'Child & dependent care', emoji: 'teddy-bear', group: 'credit', hint: 'May qualify for the dependent care credit or an FSA.' },
  hsa_eligible: { label: 'HSA/FSA eligible', emoji: 'pill', group: 'info', hint: 'Can be paid or reimbursed tax-free from an HSA or FSA.' },
  federal_estimated: { label: 'Federal estimated payments', emoji: 'receipt', group: 'payment', hint: 'Quarterly payments toward this year’s federal tax.' },
  state_estimated: { label: 'State estimated payments', emoji: 'receipt', group: 'payment', hint: 'Quarterly payments toward state tax; also count toward SALT.' },
  tax_prep: { label: 'Tax preparation', emoji: 'memo', group: 'info', hint: 'Not deductible for most individuals; deductible as a business expense for the business portion.' },
  other: { label: 'Other tax item', emoji: 'page-facing-up', group: 'info', hint: 'Kept for your records and exports.' },
};

export const INCOME_TAX_LABEL: Record<IncomeTaxKind, string> = {
  wages: 'Wages',
  tips: 'Tips',
  overtime: 'Overtime',
  self_employment: 'Self-employment',
  interest: 'Interest',
  dividends: 'Dividends',
  capital_gains: 'Capital gains',
  rental: 'Rental',
  retirement: 'Retirement income',
  social_security: 'Social Security',
  unemployment: 'Unemployment',
  other_taxable: 'Other taxable income',
  nontaxable: 'Not taxable',
};

/** Accounts whose growth and deposits aren't taxed in the year they happen. */
const TAX_ADVANTAGED = new Set(['401k', 'roth_ira', 'traditional_ira', 'hsa']);
const isTaxAdvantaged = (a: Account | undefined) => !!a && TAX_ADVANTAGED.has(a.type);

export function taxRecord(data: LedgerData, year: number): TaxYearRecord {
  return data.taxYears.find((y) => y.year === year) ?? { year, documents: [], adjustments: [], mileage: [] };
}

const inYear = (date: ISODate, year: number) => date.startsWith(`${year}-`);

/** The tax tag a transaction carries, explicitly or through its category. */
export function effectiveTaxTag(data: LedgerData, tx: Transaction): TaxTag | null {
  if (tx.taxRelated === false) return null;
  if (tx.taxCategory && tx.taxCategory in TAX_TAGS) return tx.taxCategory as TaxTag;
  const cat = tx.categoryId ? indexLedger(data).categories.get(tx.categoryId) : undefined;
  if (cat?.taxTag) return cat.taxTag;
  return tx.taxRelated ? 'other' : null;
}

export function incomeTaxKind(data: LedgerData, tx: Transaction): IncomeTaxKind {
  const index = indexLedger(data);
  const cat = tx.categoryId ? index.categories.get(tx.categoryId) : undefined;
  if (cat?.incomeTax) return cat.incomeTax;
  const source = tx.incomeSourceId ? data.incomeSources.find((s) => s.id === tx.incomeSourceId) : undefined;
  switch (source?.type) {
    case 'salary':
    case 'hourly':
    case 'bonus':
      return 'wages';
    case 'overtime':
      return 'overtime';
    case 'freelance':
    case 'side_business':
    case 'reselling':
      return 'self_employment';
    case 'interest':
      return 'interest';
    case 'dividends':
      return 'dividends';
    case 'gift':
    case 'refund':
      return 'nontaxable';
    default:
      return 'other_taxable';
  }
}

// ─── Estimate ────────────────────────────────────────────────────────────────

export interface TaxLine {
  key: string;
  label: string;
  amount: Cents;
  note?: string;
}

export interface TaxEstimate {
  year: number;
  exactTables: boolean;
  /** 'ytd' = recorded so far; 'projected' adds expected paychecks and annualizes other income. */
  basis: 'ytd' | 'projected';
  profile: TaxProfile;
  income: TaxLine[];
  totalIncome: Cents;
  adjustments: TaxLine[];
  agi: Cents;
  standardDeduction: Cents;
  itemized: TaxLine[];
  itemizedTotal: Cents;
  usedItemized: boolean;
  otherDeductions: TaxLine[];
  taxableIncome: Cents;
  incomeTax: Cents;
  credits: TaxLine[];
  selfEmploymentTax: Cents;
  additionalMedicare: Cents;
  totalTax: Cents;
  payments: TaxLine[];
  totalPayments: Cents;
  /** Positive = expected refund, negative = expected amount owed. */
  refund: Cents;
  effectiveRate: number;
  marginalRate: number;
  state: { tax: Cents; paid: Cents; refund: Cents } | null;
  /** Payroll taxes withheld (Social Security + Medicare). */
  fica: Cents;
  preTaxSavings: Cents;
  selfEmploymentProfit: Cents;
  missingPaycheckDetail: number;
  notModeled: string[];
}

function bracketTax(brackets: Brackets, income: Cents) {
  let tax = 0;
  let lower = 0;
  for (const [top, rate] of brackets) {
    if (income <= lower) break;
    tax += (Math.min(income, top) - lower) * rate;
    lower = top;
  }
  return Math.round(tax);
}

function marginal(brackets: Brackets, income: Cents) {
  for (const [top, rate] of brackets) if (income <= top) return rate;
  return brackets[brackets.length - 1][1];
}

/** Ordinary brackets on the rest; long-term gains stacked on top at 0/15/20%. */
function taxWithGains(table: TaxYearTable, status: FilingStatus, taxable: Cents, longTermGains: Cents) {
  const gains = Math.max(0, Math.min(longTermGains, taxable));
  const ordinary = taxable - gains;
  let tax = bracketTax(table.brackets[status], ordinary);
  const [zeroTop, fifteenTop] = table.capitalGains[status];
  const at0 = Math.max(0, Math.min(taxable, zeroTop) - ordinary);
  const at15 = Math.max(0, Math.min(taxable, fifteenTop) - Math.max(ordinary, zeroTop));
  const at20 = Math.max(0, gains - at0 - at15);
  tax += Math.round(at15 * 0.15 + at20 * 0.2);
  return tax;
}

const taggedAmount = (t: Transaction) => (t.type === 'expense' ? t.amount : spendingAmount(t));

/** Tax-meaningful amounts in a transaction, one entry per split line. */
export function taxLinesOf(data: LedgerData, tx: Transaction): { tag: TaxTag; amount: Cents }[] {
  if (tx.taxRelated === false) return [];
  const lines = categoryLines(tx);
  if (!lines.length) return [];
  const index = indexLedger(data);
  const out: { tag: TaxTag; amount: Cents }[] = [];
  for (const line of lines) {
    const explicit = line.taxCategory && line.taxCategory in TAX_TAGS ? (line.taxCategory as TaxTag) : undefined;
    const fromCategory = line.categoryId ? index.categories.get(line.categoryId)?.taxTag : undefined;
    const tag = explicit ?? fromCategory ?? (tx.taxRelated ? 'other' : undefined);
    if (tag) out.push({ tag, amount: Math.abs(line.amount) === line.amount ? line.amount : line.amount });
  }
  return out;
}

/** Federal estimated payments that count toward a tax year: after last year's Q4 due date through this year's. */
export function estimatedPaymentsFor(data: LedgerData, year: number, upTo?: ISODate) {
  const after = estimatedPaymentDueDates(year - 1)[3].due;
  const through = estimatedPaymentDueDates(year)[3].due;
  return data.transactions.filter((t) => t.date > after && t.date <= through && (!upTo || t.date <= upTo) && t.type === 'expense' && effectiveTaxTag(data, t) === 'federal_estimated');
}

const phaseOut = (amount: Cents, income: Cents, start: Cents, per1000: Cents) =>
  Math.max(0, amount - Math.ceil(Math.max(0, income - start) / 100_000) * per1000);

const joint = (s: FilingStatus) => s === 'married_joint';

export function estimateTaxes(data: LedgerData, year: number, today: ISODate, basis: 'ytd' | 'projected' = 'projected'): TaxEstimate {
  const index = indexLedger(data);
  const profile = data.taxProfile;
  const status = profile.filingStatus;
  const { table, exact } = taxTableFor(year);
  const record = taxRecord(data, year);
  const yearEnd = `${year}-12-31`;
  const cutoff = today < yearEnd ? today : yearEnd;
  const txs = data.transactions.filter((t) => inYear(t.date, year) && t.date <= cutoff);
  const notModeled: string[] = [
    'Qualified dividends are taxed as ordinary income (a conservative estimate)',
    'Social Security benefits and retirement withdrawals are treated simply',
    'Education, dependent care and earned income credits are not calculated',
    'Income limits for IRA deductions and the QBI deduction are not applied',
  ];

  // Share of the year still ahead, for annualizing irregular income.
  const elapsed = Math.max(1, diffDays(`${year}-01-01`, cutoff) + 1);
  const daysInYear = diffDays(`${year}-01-01`, `${year + 1}-01-01`);
  const annualize = basis === 'projected' && cutoff < yearEnd ? daysInYear / elapsed : 1;

  // ── Income ────────────────────────────────────────────────────────────────
  const buckets: Record<IncomeTaxKind, Cents> = {
    wages: 0, tips: 0, overtime: 0, self_employment: 0, interest: 0, dividends: 0, capital_gains: 0, rental: 0, retirement: 0, social_security: 0, unemployment: 0, other_taxable: 0, nontaxable: 0,
  };
  const withheld: Required<PaycheckWithholding> = { federal: 0, state: 0, socialSecurity: 0, medicare: 0, retirement: 0, hsa: 0, benefits: 0 };
  let missingPaycheckDetail = 0;
  const addWithholding = (w: PaycheckWithholding | undefined, scale = 1) => {
    if (!w) return;
    for (const k of Object.keys(withheld) as (keyof PaycheckWithholding)[]) withheld[k] += Math.round((w[k] ?? 0) * scale);
  };
  const taxableWages = (gross: Cents, w: PaycheckWithholding | undefined) => gross - (w?.retirement ?? 0) - (w?.hsa ?? 0) - (w?.benefits ?? 0);

  for (const t of txs) {
    if (t.type !== 'income') continue;
    const account = index.accounts.get(t.accountId);
    // Deposits into retirement/HSA accounts are pre-tax contributions or tax-sheltered growth.
    if (isTaxAdvantaged(account)) continue;
    const kind = incomeTaxKind(data, t);
    if (kind === 'wages' || kind === 'overtime' || kind === 'tips') {
      if (t.grossAmount === undefined && t.incomeSourceId) missingPaycheckDetail++;
      const gross = taxableWages(t.grossAmount ?? t.amount, t.withholding);
      buckets[kind] += gross;
      addWithholding(t.withholding);
    } else {
      buckets[kind] += t.amount;
    }
  }

  // Expected paychecks for the rest of the year.
  if (basis === 'projected' && cutoff < yearEnd) {
    const future = scheduledEvents(data, { from: addDays(cutoff, 1), to: yearEnd, today }).filter((e) => e.kind === 'income' && e.source === 'income' && e.status === 'upcoming');
    for (const e of future) {
      const source = data.incomeSources.find((s) => s.id === e.sourceId);
      if (!source) continue;
      const account = index.accounts.get(source.depositAccountId);
      if (isTaxAdvantaged(account)) continue;
      const pseudo = { type: 'income', categoryId: source.categoryId, incomeSourceId: source.id } as Transaction;
      const kind = incomeTaxKind(data, pseudo);
      if (kind === 'wages' || kind === 'overtime' || kind === 'tips') {
        const gross = expectedGross(source) ?? e.amount;
        buckets[kind] += taxableWages(gross, source.withholding);
        addWithholding(source.withholding);
      } else if (kind !== 'nontaxable') {
        buckets[kind] += e.amount;
      }
    }
    // Irregular income (freelance, interest, dividends) grows with the year.
    for (const k of ['self_employment', 'interest', 'dividends', 'rental', 'other_taxable', 'unemployment'] as IncomeTaxKind[]) {
      buckets[k] = Math.round(buckets[k] * annualize);
    }
  }

  for (const adj of record.adjustments) {
    if (adj.kind === 'capital_gain_long' || adj.kind === 'capital_gain_short') buckets.capital_gains += adj.amount;
    if (adj.kind === 'other_income') buckets.other_taxable += adj.amount;
    if (adj.kind === 'federal_withholding') withheld.federal += adj.amount;
    if (adj.kind === 'state_withholding') withheld.state += adj.amount;
  }
  // Net capital losses offset at most $3,000 of other income ($1,500 married filing separately).
  buckets.capital_gains = Math.max(buckets.capital_gains, status === 'married_separate' ? -150_000 : -300_000);
  const longTermGains = Math.min(Math.max(0, sum(record.adjustments.filter((a) => a.kind === 'capital_gain_long').map((a) => a.amount))), Math.max(0, buckets.capital_gains));

  // ── Spending with tax meaning ─────────────────────────────────────────────
  const tagged: Record<TaxTag, Cents> = Object.fromEntries(Object.keys(TAX_TAGS).map((k) => [k, 0])) as Record<TaxTag, Cents>;
  for (const t of txs) {
    for (const line of taxLinesOf(data, t)) {
      if (line.tag === 'federal_estimated') continue;
      tagged[line.tag] += line.amount;
    }
  }
  // Q4 estimated payments are made in January of the following year.
  tagged.federal_estimated = sum(estimatedPaymentsFor(data, year, cutoff).map((t) => t.amount));
  // Interest charged on loans, by loan type.
  let mortgageInterest = 0;
  let studentInterest = 0;
  let carInterest = 0;
  for (const t of txs) {
    if (t.type !== 'interest') continue;
    const a = index.accounts.get(t.accountId);
    if (a?.type === 'mortgage') mortgageInterest += t.amount;
    if (a?.type === 'student_loan') studentInterest += t.amount;
    if (a?.type === 'auto_loan') carInterest += t.amount;
  }
  mortgageInterest += tagged.mortgage_interest;
  studentInterest += tagged.student_loan_interest;
  carInterest += tagged.car_loan_interest;

  const mileageDeduction = (purpose: 'business' | 'medical' | 'charitable') =>
    Math.round(sum(record.mileage.filter((m) => m.purpose === purpose && isValidISODate(m.date)).map((m) => m.miles * mileageRateOn(table, m.date, purpose))));

  // Self-employment profit.
  const seExpenses = tagged.business + tagged.home_office + mileageDeduction('business');
  const seProfit = Math.max(0, buckets.self_employment - Math.round(seExpenses * (basis === 'projected' ? annualize : 1)));

  // ── Contributions (adjustments) ───────────────────────────────────────────
  let hsaDirect = 0;
  let traditionalIra = 0;
  for (const t of txs) {
    if (!TRANSFER_TYPES.includes(t.type) || !t.toAccountId) continue;
    const to = index.accounts.get(t.toAccountId);
    if (to?.type === 'hsa') hsaDirect += t.amount;
    if (to?.type === 'traditional_ira') traditionalIra += t.amount;
  }

  // ── Self-employment tax ───────────────────────────────────────────────────
  const wagesTotal = buckets.wages + buckets.tips + buckets.overtime;
  const seBase = Math.round(seProfit * 0.9235);
  const ssRoom = Math.max(0, table.socialSecurityWageBase - wagesTotal);
  const selfEmploymentTax = seBase >= 40_000 ? Math.round(Math.min(seBase, ssRoom) * 0.124 + seBase * 0.029) : 0;
  const addlThreshold = table.additionalMedicareThreshold[status];
  const additionalMedicare = Math.round(Math.max(0, wagesTotal + seBase - addlThreshold) * 0.009);

  const income: TaxLine[] = [
    { key: 'wages', label: 'Wages, salary & bonuses', amount: buckets.wages, note: 'After pre-tax retirement, HSA and benefit deductions' },
    { key: 'overtime', label: 'Overtime', amount: buckets.overtime },
    { key: 'tips', label: 'Tips', amount: buckets.tips },
    { key: 'self_employment', label: 'Self-employment profit', amount: seProfit, note: seExpenses > 0 ? 'Income minus business expenses and mileage' : undefined },
    { key: 'interest', label: 'Interest', amount: buckets.interest },
    { key: 'dividends', label: 'Dividends', amount: buckets.dividends },
    { key: 'capital_gains', label: 'Capital gains', amount: buckets.capital_gains },
    { key: 'rental', label: 'Rental income', amount: buckets.rental },
    { key: 'retirement', label: 'Pensions & retirement withdrawals', amount: buckets.retirement },
    { key: 'unemployment', label: 'Unemployment', amount: buckets.unemployment },
    { key: 'other', label: 'Other taxable income', amount: buckets.other_taxable },
  ].filter((l) => l.amount !== 0);
  const totalIncome = sum(income.map((l) => l.amount));

  const studentCapped = Math.min(studentInterest, table.studentLoanInterestMax);
  const adjustments: TaxLine[] = [
    { key: 'se_half', label: 'Half of self-employment tax', amount: Math.round(selfEmploymentTax / 2) },
    { key: 'hsa', label: 'HSA contributions (outside payroll)', amount: hsaDirect },
    { key: 'ira', label: 'Traditional IRA contributions', amount: traditionalIra, note: 'Income limits may reduce this if you have a workplace plan' },
    { key: 'student_loan', label: 'Student loan interest', amount: studentCapped },
  ].filter((l) => l.amount > 0);
  const preAgi = totalIncome - sum(adjustments.map((l) => l.amount));
  // Student loan interest phases out between $85k–$100k ($175k–$205k joint) in 2026.
  if (studentCapped > 0) {
    const [start, end] = joint(status) ? [17_500_000, 20_500_000] : [8_500_000, 10_000_000];
    const allowed = status === 'married_separate' ? 0 : preAgi <= start ? studentCapped : preAgi >= end ? 0 : Math.round(studentCapped * (1 - (preAgi - start) / (end - start)));
    const line = adjustments.find((l) => l.key === 'student_loan')!;
    line.amount = allowed;
  }
  const agi = Math.max(0, totalIncome - sum(adjustments.map((l) => l.amount)));

  // ── Deductions ────────────────────────────────────────────────────────────
  const separate = status === 'married_separate';
  const salt = table.saltCap;
  const saltLimit = Math.max(separate ? salt.floorSeparate : salt.floor, (separate ? salt.limitSeparate : salt.limit) - Math.round(Math.max(0, agi - (separate ? salt.phaseDownStartSeparate : salt.phaseDownStart)) * 0.3));
  const saltPaid = tagged.property_tax + tagged.state_local_tax + tagged.state_estimated + withheld.state;
  const medical = tagged.medical + mileageDeduction('medical');
  const itemized: TaxLine[] = [
    { key: 'mortgage', label: 'Mortgage interest', amount: mortgageInterest },
    { key: 'salt', label: 'State & local taxes (SALT)', amount: Math.min(saltPaid, saltLimit), note: saltPaid > saltLimit ? `Limited to the SALT cap` : undefined },
    { key: 'charity', label: 'Charitable giving', amount: tagged.charitable + mileageDeduction('charitable') },
    { key: 'medical', label: 'Medical above 7.5% of AGI', amount: Math.max(0, medical - Math.round(agi * table.medicalFloor)) },
    ...record.adjustments.filter((a) => a.kind === 'other_deduction').map((a) => ({ key: a.id, label: a.label, amount: a.amount })),
  ].filter((l) => l.amount > 0);
  const itemizedTotal = sum(itemized.map((l) => l.amount));
  const standardDeduction = table.standardDeduction[status];
  const usedItemized = profile.deduction === 'itemized' || (profile.deduction === 'auto' && itemizedTotal > standardDeduction);

  // Deductions taken whether or not you itemize (2025–2028).
  const jointPhase = joint(status) ? 'joint' : 'single';
  const otherDeductions: TaxLine[] = [];
  if (profile.seniors > 0 && !separate) {
    // $6,000 each, reduced by 6% of income above the threshold.
    const seniors = joint(status) ? Math.min(profile.seniors, 2) : 1;
    const reduced = Math.max(0, table.seniorDeduction * seniors - Math.round(Math.max(0, agi - table.seniorPhaseOut[jointPhase]) * 0.06));
    otherDeductions.push({ key: 'senior', label: 'Senior deduction (65+)', amount: reduced });
  }
  if (buckets.tips > 0 && !separate) {
    otherDeductions.push({ key: 'tips', label: 'No tax on tips', amount: phaseOut(Math.min(buckets.tips, 2_500_000), agi, joint(status) ? 30_000_000 : 15_000_000, 10_000) });
  }
  if (buckets.overtime > 0 && !separate) {
    // Only the "half" premium of time-and-a-half is deductible: one third of overtime pay.
    const premium = Math.round(buckets.overtime / 3);
    otherDeductions.push({ key: 'overtime', label: 'No tax on overtime (premium portion)', amount: phaseOut(Math.min(premium, joint(status) ? 2_500_000 : 1_250_000), agi, joint(status) ? 30_000_000 : 15_000_000, 10_000) });
  }
  if (carInterest > 0 && profile.carLoanQualifies) {
    otherDeductions.push({ key: 'car_loan', label: 'Car loan interest', amount: phaseOut(Math.min(carInterest, 1_000_000), agi, joint(status) ? 20_000_000 : 10_000_000, 20_000) });
  }
  const beforeQbi = Math.max(0, agi - (usedItemized ? itemizedTotal : standardDeduction) - sum(otherDeductions.map((l) => l.amount)));
  if (seProfit > 0) {
    otherDeductions.push({ key: 'qbi', label: 'Qualified business income (20%)', amount: Math.round(Math.min(seProfit - Math.round(selfEmploymentTax / 2), beforeQbi) * 0.2) });
  }
  const filteredOther = otherDeductions.filter((l) => l.amount > 0);
  const taxableIncome = Math.max(0, agi - (usedItemized ? itemizedTotal : standardDeduction) - sum(filteredOther.map((l) => l.amount)));

  // ── Tax, credits, payments ────────────────────────────────────────────────
  const incomeTax = taxWithGains(table, status, taxableIncome, longTermGains);
  const ctcStart = joint(status) ? 40_000_000 : 20_000_000;
  const childCredit = phaseOut(table.childTaxCredit * profile.dependentsUnder17 + table.otherDependentCredit * profile.otherDependents, agi, ctcStart, 5_000);
  const nonrefundable = Math.min(childCredit, incomeTax);
  // Unused credit is refundable up to $1,700 per child, limited to 15% of earnings above $2,500.
  const earned = wagesTotal + seProfit;
  const refundable = Math.min(childCredit - nonrefundable, 170_000 * profile.dependentsUnder17, Math.round(Math.max(0, earned - 250_000) * 0.15));
  const manualCredits = Math.min(
    sum(record.adjustments.filter((a) => a.kind === 'credit').map((a) => a.amount)),
    incomeTax - nonrefundable,
  );
  const credits: TaxLine[] = [
    { key: 'ctc', label: 'Child & other dependent credits', amount: nonrefundable },
    ...record.adjustments.filter((a) => a.kind === 'credit').map((a) => ({ key: a.id, label: a.label, amount: a.amount })),
  ].filter((l) => l.amount > 0);
  const totalTax = incomeTax - nonrefundable - Math.max(0, manualCredits) + selfEmploymentTax + additionalMedicare;

  const payments: TaxLine[] = [
    { key: 'withholding', label: 'Federal tax withheld from pay', amount: withheld.federal },
    { key: 'estimated', label: 'Estimated payments', amount: tagged.federal_estimated },
    { key: 'refundable_ctc', label: 'Refundable child tax credit', amount: refundable },
  ].filter((l) => l.amount > 0);
  const totalPayments = sum(payments.map((l) => l.amount));

  const state =
    profile.stateRate > 0 || withheld.state > 0
      ? (() => {
          const tax = Math.round(agi * (profile.stateRate / 100));
          const paid = withheld.state + tagged.state_estimated;
          return { tax, paid, refund: paid - tax };
        })()
      : null;

  if (missingPaycheckDetail > 0) notModeled.unshift(`${missingPaycheckDetail} paychecks have no gross pay or withholding, so take-home was used`);
  if (!exact) notModeled.unshift(`IRS amounts for ${year} aren’t published yet; ${table.year} amounts are used`);

  return {
    year,
    exactTables: exact,
    basis,
    profile,
    income,
    totalIncome,
    adjustments,
    agi,
    standardDeduction,
    itemized,
    itemizedTotal,
    usedItemized,
    otherDeductions: filteredOther,
    taxableIncome,
    incomeTax,
    credits,
    selfEmploymentTax,
    additionalMedicare,
    totalTax,
    payments,
    totalPayments,
    refund: totalPayments - totalTax,
    effectiveRate: agi > 0 ? totalTax / agi : 0,
    marginalRate: marginal(table.brackets[status], taxableIncome),
    state,
    fica: withheld.socialSecurity + withheld.medicare,
    preTaxSavings: withheld.retirement + withheld.hsa,
    selfEmploymentProfit: seProfit,
    missingPaycheckDetail,
    notModeled,
  };
}

// ─── Estimated payments ──────────────────────────────────────────────────────

export interface QuarterPlan {
  quarter: number;
  due: ISODate;
  paid: Cents;
  suggested: Cents;
  status: 'paid' | 'due_soon' | 'upcoming' | 'missed' | 'not_needed';
}

/**
 * Quarterly estimated tax plan. Payments are needed when withholding won't
 * cover the tax by at least $1,000; the target is the smaller of 90% of this
 * year's tax and the prior-year safe harbor (100%, or 110% above $150k AGI).
 */
export function estimatedPaymentPlan(data: LedgerData, estimate: TaxEstimate, today: ISODate) {
  const profile = data.taxProfile;
  const dues = estimatedPaymentDueDates(estimate.year);
  const payments = estimatedPaymentsFor(data, estimate.year);
  const withholding = estimate.payments.find((p) => p.key === 'withholding')?.amount ?? 0;
  const safeHarbor = profile.priorYearTax !== undefined ? Math.round(profile.priorYearTax * ((profile.priorYearAgi ?? 0) > 15_000_000 ? 1.1 : 1)) : Infinity;
  const required = Math.min(Math.round(estimate.totalTax * 0.9), safeHarbor);
  const needed = Math.max(0, required - withholding);
  const shortfall = estimate.totalTax - withholding;
  // Payments are only needed to avoid a penalty; the safe harbor can cover it even if you'll owe at filing.
  const needsPayments = shortfall >= 100_000 && needed > 0;

  const windows = dues.map((d, i) => {
    const after = i === 0 ? estimatedPaymentDueDates(estimate.year - 1)[3].due : dues[i - 1].due;
    return { ...d, paid: sum(payments.filter((p) => p.date > after && p.date <= d.due).map((p) => p.amount)) };
  });
  const share = Math.round(needed / 4);
  // What's left is spread over the quarters still ahead that aren't covered yet.
  const open = windows.filter((w) => w.due >= today && w.paid < share);
  const outstanding = Math.max(0, needed - sum(windows.map((w) => w.paid)) + sum(open.map((w) => w.paid)));
  const quarters: QuarterPlan[] = windows.map((w) => {
    const isOpen = open.includes(w);
    const suggested = !needsPayments ? 0 : isOpen ? Math.max(0, Math.round(outstanding / open.length) - w.paid) : share;
    let status: QuarterPlan['status'];
    if (!needsPayments) status = w.paid > 0 ? 'paid' : 'not_needed';
    else if (!isOpen && w.paid >= share) status = 'paid';
    else if (!isOpen) status = 'missed';
    else if (suggested === 0) status = 'paid';
    else if (diffDays(today, w.due) <= 30) status = 'due_soon';
    else status = 'upcoming';
    return { quarter: w.quarter, due: w.due, paid: w.paid, suggested, status };
  });
  return { needsPayments, required, needed, quarters, paid: sum(quarters.map((q) => q.paid)) };
}

// ─── Deductions & contributions ──────────────────────────────────────────────

export interface TaxGroupItem {
  tx: Transaction;
  /** This tag's share of the transaction: the whole amount unless it was split. */
  amount: Cents;
}

export function taxTaggedTransactions(data: LedgerData, year: number) {
  const groups = new Map<TaxTag, TaxGroupItem[]>();
  const possible: TaxGroupItem[] = [];
  for (const t of indexLedger(data).sorted) {
    if (!inYear(t.date, year)) continue;
    // Income (like a refund) is handled by the estimate, not as a deduction.
    if (t.type === 'income') continue;
    const lines = taxLinesOf(data, t);
    if (!lines.length) continue;
    // Category suggestions the user hasn't confirmed yet. Tax payments need no review.
    if (t.taxRelated === undefined && !(t.taxCategory && t.taxCategory in TAX_TAGS) && lines.some((l) => TAX_TAGS[l.tag].group !== 'payment')) {
      possible.push({ tx: t, amount: sum(lines.filter((l) => TAX_TAGS[l.tag].group !== 'payment').map((l) => l.amount)) });
    }
    for (const line of lines) {
      const item = { tx: t, amount: line.amount };
      const list = groups.get(line.tag);
      if (list) list.push(item);
      else groups.set(line.tag, [item]);
    }
  }
  return {
    groups: [...groups.entries()].map(([tag, items]) => ({ tag, items, total: sum(items.map((i) => i.amount)) })).sort((a, b) => b.total - a.total),
    possible,
  };
}

export interface ContributionLimit {
  key: '401k' | 'ira' | 'hsa';
  label: string;
  contributed: Cents;
  limit: Cents;
  applicable: boolean;
}

export function contributionLimits(data: LedgerData, year: number): ContributionLimit[] {
  const index = indexLedger(data);
  const { table } = taxTableFor(year);
  const p = data.taxProfile;
  const txs = data.transactions.filter((t) => inYear(t.date, year));
  const typeOf = (id: string | undefined) => (id ? index.accounts.get(id)?.type : undefined);
  // New money into these accounts: deposits, or transfers from outside the group (not rollovers between them).
  const deposits = (types: string[]) =>
    sum(
      txs
        .filter((t) => {
          if (t.type === 'income') return types.includes(typeOf(t.accountId) ?? '');
          if (!t.toAccountId || !TRANSFER_TYPES.includes(t.type)) return false;
          return types.includes(typeOf(t.toAccountId) ?? '') && !types.includes(typeOf(t.accountId) ?? '');
        })
        .map((t) => t.amount),
    );
  const payroll = (key: 'retirement' | 'hsa') => sum(txs.map((t) => t.withholding?.[key] ?? 0));
  const has = (type: string) => data.accounts.some((a) => !a.archived && a.type === type);

  const k401 = Math.max(deposits(['401k']), payroll('retirement'));
  const ira = deposits(['roth_ira', 'traditional_ira']);
  const hsa = Math.max(deposits(['hsa']), payroll('hsa'));
  return [
    { key: '401k', label: '401(k) / 403(b)', contributed: k401, limit: table.limits.k401 + (p.age50Plus ? table.limits.k401CatchUp50 : 0), applicable: has('401k') || k401 > 0 },
    { key: 'ira', label: 'IRA (Roth + traditional)', contributed: ira, limit: table.limits.ira + (p.age50Plus ? table.limits.iraCatchUp50 : 0), applicable: has('roth_ira') || has('traditional_ira') || ira > 0 },
    {
      key: 'hsa',
      label: 'HSA',
      contributed: hsa,
      limit: p.hsaCoverage === 'family' ? table.limits.hsaFamily : table.limits.hsaSelf,
      applicable: has('hsa') || hsa > 0 || p.hsaCoverage !== 'none',
    },
  ];
}

// ─── Documents ───────────────────────────────────────────────────────────────

export interface SuggestedDocument {
  key: string;
  form: string;
  issuer: string;
  why: string;
  arrives: string;
}

/** Forms you should expect for a tax year, inferred from accounts and income. */
export function suggestedDocuments(data: LedgerData, year: number): SuggestedDocument[] {
  const index = indexLedger(data);
  const out: SuggestedDocument[] = [];
  const txs = data.transactions.filter((t) => inYear(t.date, year));
  const push = (d: SuggestedDocument) => {
    if (!out.some((x) => x.key === d.key)) out.push(d);
  };

  for (const s of data.incomeSources) {
    const had = txs.some((t) => t.incomeSourceId === s.id);
    if (!had) continue;
    const kind = incomeTaxKind(data, { type: 'income', categoryId: s.categoryId, incomeSourceId: s.id } as Transaction);
    if (s.taxForm === 'W-2' || ((kind === 'wages' || kind === 'overtime' || kind === 'tips') && s.taxForm !== 'none' && !s.taxForm?.startsWith('1099'))) {
      push({ key: `w2:${s.id}`, form: 'W-2', issuer: s.employer ?? s.name, why: 'Wages and withholding from your job', arrives: 'By January 31' });
    } else if (kind === 'self_employment' || s.taxForm?.startsWith('1099')) {
      // Clients send a 1099-NEC once they pay you $600 or more in the year.
      const byPayer = new Map<string, Cents>();
      for (const t of txs) if (t.incomeSourceId === s.id && t.payee) byPayer.set(t.payee, (byPayer.get(t.payee) ?? 0) + t.amount);
      const payers = [...byPayer].filter(([, total]) => total >= 60_000).map(([payer]) => payer);
      for (const payer of byPayer.size ? payers : [s.name]) {
        push({ key: `1099nec:${s.id}:${payer}`, form: s.taxForm?.startsWith('1099') ? s.taxForm : '1099-NEC', issuer: payer, why: 'Freelance or contract income', arrives: 'By January 31' });
      }
    }
  }

  const byAccount = new Map<string, Transaction[]>();
  for (const t of txs) {
    const list = byAccount.get(t.accountId);
    if (list) list.push(t);
    else byAccount.set(t.accountId, [t]);
  }
  for (const a of data.accounts) {
    const list = byAccount.get(a.id) ?? [];
    const incoming = data.transactions.filter((t) => inYear(t.date, year) && t.toAccountId === a.id);
    const issuer = a.institution ?? a.name;
    const interest = sum(list.filter((t) => t.type === 'income' && incomeTaxKind(data, t) === 'interest').map((t) => t.amount));
    if (interest >= 1_000 && !isTaxAdvantaged(a)) push({ key: `1099int:${a.id}`, form: '1099-INT', issuer, why: 'Interest of $10 or more', arrives: 'By January 31' });
    if (a.type === 'brokerage' && (list.length > 0 || incoming.length > 0)) push({ key: `1099b:${a.id}`, form: 'Consolidated 1099 (DIV/B)', issuer, why: 'Dividends and any investment sales', arrives: 'Mid-February' });
    if (a.type === 'mortgage') push({ key: `1098:${a.id}`, form: '1098', issuer, why: 'Mortgage interest paid', arrives: 'By January 31' });
    if (a.type === 'student_loan' && list.some((t) => t.type === 'interest')) push({ key: `1098e:${a.id}`, form: '1098-E', issuer, why: 'Student loan interest paid', arrives: 'By January 31' });
    if (a.type === 'hsa') push({ key: `5498sa:${a.id}`, form: '5498-SA / 1099-SA', issuer, why: 'HSA contributions and withdrawals', arrives: 'January–May' });
    if ((a.type === 'roth_ira' || a.type === 'traditional_ira') && incoming.length > 0) push({ key: `5498:${a.id}`, form: '5498', issuer, why: 'IRA contributions (informational)', arrives: 'By May 31' });
    if (a.type === '401k' && list.some((t) => TRANSFER_TYPES.includes(t.type) && t.toAccountId)) push({ key: `1099r:${a.id}`, form: '1099-R', issuer, why: 'Retirement plan withdrawals', arrives: 'By January 31' });
  }
  if (txs.some((t) => t.type === 'expense' && effectiveTaxTag(data, t) === 'education')) push({ key: '1098t', form: '1098-T', issuer: 'Your school', why: 'Tuition paid (for education credits)', arrives: 'By January 31' });
  if (txs.some((t) => t.type === 'income' && incomeTaxKind(data, t) === 'unemployment')) push({ key: '1099g', form: '1099-G', issuer: 'State unemployment office', why: 'Unemployment benefits', arrives: 'By January 31' });
  if (txs.some((t) => t.type === 'income' && incomeTaxKind(data, t) === 'social_security')) push({ key: 'ssa1099', form: 'SSA-1099', issuer: 'Social Security Administration', why: 'Social Security benefits', arrives: 'By January 31' });
  if (txs.some((t) => t.type === 'expense' && effectiveTaxTag(data, t) === 'charitable' && t.amount >= 25_000)) push({ key: 'charity', form: 'Donation receipts', issuer: 'Charities', why: 'Written acknowledgment for gifts of $250 or more', arrives: 'Keep through the year' });
  if (data.taxProfile.dependentsUnder17 > 0 && txs.some((t) => effectiveTaxTag(data, t) === 'childcare')) push({ key: 'childcare', form: 'Childcare provider info', issuer: 'Daycare / caregiver', why: 'Provider tax ID for the dependent care credit', arrives: 'Ask your provider' });
  return out;
}

/** Suggested documents merged with what the user saved (status, attachments, custom ones). */
export function documentChecklist(data: LedgerData, year: number): (TaxDocument & { why?: string; arrives?: string })[] {
  const saved = taxRecord(data, year).documents;
  const suggested = suggestedDocuments(data, year).map((s) => {
    const existing = saved.find((d) => d.key === s.key);
    return { key: s.key, form: s.form, issuer: s.issuer, status: existing?.status ?? 'expected', attachments: existing?.attachments ?? [], custom: false, note: existing?.note, why: s.why, arrives: s.arrives } as TaxDocument & { why?: string; arrives?: string };
  });
  return [...suggested, ...saved.filter((d) => d.custom)];
}

export interface TaxDate {
  date: ISODate;
  label: string;
  kind: 'filing' | 'estimated' | 'documents' | 'extension';
}

export function taxCalendar(year: number): TaxDate[] {
  const next = year + 1;
  const dates: TaxDate[] = [
    ...estimatedPaymentDueDates(year).map((d) => ({ date: d.due, label: `Q${d.quarter} estimated payment · ${year}`, kind: 'estimated' as const })),
    { date: `${next}-01-31`, label: `${year} W-2s and 1099s arrive`, kind: 'documents' },
    { date: rollDeadline(`${next}-04-15`), label: `File ${year} return or extension`, kind: 'filing' },
    { date: rollDeadline(`${next}-10-15`), label: `Extended ${year} return due`, kind: 'extension' },
  ];
  return dates.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Tax years with any activity, most recent first, always including this year. */
export function taxYears(data: LedgerData, today: ISODate): number[] {
  const years = new Set<number>([Number(today.slice(0, 4))]);
  for (const t of data.transactions) years.add(Number(t.date.slice(0, 4)));
  for (const r of data.taxYears) years.add(r.year);
  return [...years].filter((y) => y >= 2000 && y <= Number(today.slice(0, 4))).sort((a, b) => b - a);
}

// ─── Export ──────────────────────────────────────────────────────────────────

const csvCell = (value: string | number | undefined) => {
  const s = value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** A one-file summary to hand to a tax preparer: estimate, tagged items, documents and mileage. */
export function taxPacketCsv(data: LedgerData, year: number, today: ISODate, estimate: TaxEstimate): string {
  const index = indexLedger(data);
  const rows: (string | number | undefined)[][] = [[`Tax summary ${year}`, `Exported ${today}`, 'Planning estimate, not a filed return']];
  const money = (c: Cents) => centsToInput(c);
  const section = (title: string) => rows.push([], [title]);

  section('Estimate');
  for (const l of estimate.income) rows.push(['Income', l.label, money(l.amount)]);
  for (const l of estimate.adjustments) rows.push(['Adjustment', l.label, money(l.amount)]);
  rows.push(['AGI', '', money(estimate.agi)]);
  rows.push(['Deduction', estimate.usedItemized ? 'Itemized' : 'Standard', money(estimate.usedItemized ? estimate.itemizedTotal : estimate.standardDeduction)]);
  for (const l of estimate.otherDeductions) rows.push(['Deduction', l.label, money(l.amount)]);
  rows.push(['Taxable income', '', money(estimate.taxableIncome)], ['Total federal tax', '', money(estimate.totalTax)]);
  for (const l of estimate.payments) rows.push(['Payment', l.label, money(l.amount)]);
  rows.push([estimate.refund >= 0 ? 'Estimated refund' : 'Estimated owed', '', money(Math.abs(estimate.refund))]);

  section('Tax-related transactions');
  rows.push(['Date', 'Tax item', 'Amount', 'Description', 'Payee', 'Category', 'Account']);
  for (const g of taxTaggedTransactions(data, year).groups) {
    for (const { tx: t, amount } of g.items) {
      const cat = t.categoryId ? index.categories.get(t.categoryId) : undefined;
      rows.push([t.date, TAX_TAGS[g.tag].label, money(amount), t.description, t.payee, cat?.name, index.accounts.get(t.accountId)?.name]);
    }
  }

  section('Documents');
  rows.push(['Form', 'From', 'Status', 'Note']);
  for (const d of documentChecklist(data, year)) rows.push([d.form, d.issuer, d.status.replace('_', ' '), d.note]);

  const trips = taxRecord(data, year).mileage;
  if (trips.length) {
    section('Mileage');
    rows.push(['Date', 'Purpose', 'Miles', 'Note']);
    for (const m of trips) rows.push([m.date, m.purpose, m.miles, m.note]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

// ─── Reminders ───────────────────────────────────────────────────────────────

export interface TaxReminder {
  id: string;
  severity: 'warning' | 'info';
  title: string;
  detail: string;
  href: string;
  date: ISODate;
}

/** Estimated payments coming due and document season, for Home alerts. */
export function taxReminders(data: LedgerData, today: ISODate, format: (cents: Cents) => string): TaxReminder[] {
  if (data.transactions.length === 0) return [];
  const out: TaxReminder[] = [];
  const year = Number(today.slice(0, 4));
  // In early January the Q4 payment for last year is the one due.
  for (const y of [year - 1, year]) {
    const due = estimatedPaymentDueDates(y).find((d) => d.due >= today && diffDays(today, d.due) <= 21);
    if (!due) continue;
    const plan = estimatedPaymentPlan(data, estimateTaxes(data, y, today, 'projected'), today);
    const q = plan.quarters.find((x) => x.quarter === due.quarter);
    if (!plan.needsPayments || !q || q.status === 'paid' || q.suggested <= 0) continue;
    out.push({ id: `tax:est:${y}:${due.quarter}`, severity: diffDays(today, due.due) <= 7 ? 'warning' : 'info', title: `Q${due.quarter} estimated tax due ${due.due.slice(5).replace('-', '/')}`, detail: `About ${format(q.suggested)} suggested`, href: `/taxes?year=${y}`, date: due.due });
  }
  // Filing season: February through the April deadline.
  const deadline = rollDeadline(`${year}-04-15`);
  if (today >= `${year}-02-01` && today <= deadline && !taxRecord(data, year - 1).filedOn) {
    const docs = documentChecklist(data, year - 1);
    const waiting = docs.filter((d) => d.status === 'expected').length;
    out.push({ id: `tax:file:${year - 1}`, severity: diffDays(today, deadline) <= 14 ? 'warning' : 'info', title: `${year - 1} taxes due ${deadline.slice(5).replace('-', '/')}`, detail: waiting ? `${waiting} of ${docs.length} documents still to collect` : 'Documents collected', href: `/taxes?year=${year - 1}`, date: deadline });
  }
  return out;
}
