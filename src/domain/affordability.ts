import { accountGroup, isCreditCard, isDebt } from './catalog';
import { addMonthsToMonth, monthEnd, monthOf, monthStart } from './dates';
import { balanceOn, indexLedger, spendingAmount } from './ledger';
import { sum } from './money';
import { trackingStartDate } from './position';
import { monthlyEquivalent } from './recurrence';
import { categoryAverages, spendableIncome } from './reports';
import { defaultPlannedPayment, expectedGross, expectedNet, plannedDebtPayment } from './schedule';
import { amortizedPayment } from './scenarios';
import { createId } from './factory';
import type { Cents, ISODate, LedgerData, ScenarioChange } from './types';

/**
 * "Can I afford it?" calculators. They combine a snapshot of the user's real
 * finances with a hypothetical purchase and compare the result against widely
 * used rules of thumb. Results are guidance for exploring options, not advice,
 * and nothing here changes stored data.
 */

// ─── Snapshot ────────────────────────────────────────────────────────────────

export interface FinancialSnapshot {
  /** Monthly take-home pay: measured from the last 3 complete months when they were tracked. */
  takeHome: Cents;
  /** Where `takeHome` came from, so screens can say which. */
  takeHomeBasis: 'measured' | 'scheduled';
  /** Monthly gross pay (estimated from take-home when unknown). */
  gross: Cents;
  grossEstimated: boolean;
  /** Average monthly spending over the last 3 complete months, excluding interest. */
  spending: Cents;
  essential: Cents;
  /** Monthly loan payments plus card payments not already covered by spending. */
  debtPayments: Cents;
  /** Take-home minus spending and debt payments. */
  surplus: Cents;
  /** Cash and savings balances. */
  liquidSavings: Cents;
  emergencyMonths: number;
  currentHousing: Cents;
  currentCar: Cents;
}

const AVERAGE_MONTHS = 3;
const ASSUMED_TAKE_HOME_RATE = 0.75;

function averageInCategories(data: LedgerData, ids: string[], today: ISODate): Cents {
  const { from, to } = averageWindow(today);
  const total = sum(
    data.transactions
      .filter((t) => t.date >= from && t.date <= to && t.categoryId && ids.some((id) => t.categoryId === id || t.categoryId!.startsWith(`${id}.`)))
      .map(spendingAmount),
  );
  return Math.round(total / AVERAGE_MONTHS);
}

/** The window everything in the snapshot is averaged over: the last 3 complete months. */
function averageWindow(today: ISODate) {
  const last = addMonthsToMonth(monthOf(today), -1);
  return { from: monthStart(addMonthsToMonth(last, -(AVERAGE_MONTHS - 1))), to: monthEnd(last) };
}

/**
 * Snapshot of the finances the calculators reason about.
 *
 * Income and spending are measured over the *same* window (`averageWindow`)
 * and with the same rules the Money checkup uses, so "left over each month"
 * can never contradict "months in the green". Scheduled pay alone used to be
 * the income side, which ignored freelance and other undeclared income and
 * turned a real surplus into a phantom deficit.
 *
 * `surplus` is still a narrower number than the checkup's "saved": it takes
 * debt payments off (principal is saving, but it is not cash you can spend
 * again) and leaves out payroll money that never arrives, such as 401(k) and
 * HSA deductions.
 */
export function financialSnapshot(data: LedgerData, today: ISODate): FinancialSnapshot {
  const index = indexLedger(data);
  const averages = categoryAverages(data, monthOf(today), AVERAGE_MONTHS);
  const sources = data.incomeSources.filter((s) => s.active && s.frequency);

  const scheduledTakeHome = sum(sources.map((s) => monthlyEquivalent(expectedNet(s), s.frequency!)));
  const window = averageWindow(today);
  const trackingStart = trackingStartDate(data);
  const measuredTakeHome =
    trackingStart && trackingStart <= window.from ? Math.round(spendableIncome(data, window.from, window.to) / AVERAGE_MONTHS) : null;
  const takeHomeBasis: 'measured' | 'scheduled' = measuredTakeHome && measuredTakeHome > 0 ? 'measured' : 'scheduled';
  const takeHome = takeHomeBasis === 'measured' ? measuredTakeHome! : scheduledTakeHome > 0 ? scheduledTakeHome : averages.income;

  const knownGross = sum(sources.map((s) => monthlyEquivalent(expectedGross(s) ?? expectedNet(s), s.frequency!)));
  const grossEstimated = !sources.some((s) => expectedGross(s) !== undefined);
  // Income the declared sources don't explain (freelance, side work) has no
  // known gross, so it counts at face value on top of the declared gross.
  const gross = grossEstimated ? Math.round(takeHome / ASSUMED_TAKE_HOME_RATE) : knownGross + Math.max(0, takeHome - scheduledTakeHome);

  let debtPayments = 0;
  let mortgagePayments = 0;
  let carPayments = 0;
  for (const a of data.accounts) {
    if (a.archived || !isDebt(a.type)) continue;
    const balance = balanceOn(index, a.id, today);
    if (balance <= 0) continue;
    // Cards paid in full are already reflected in spending.
    if (isCreditCard(a.type) && defaultPlannedPayment(a) === 'statement') continue;
    const recurring = data.recurring.find((r) => r.active && r.toAccountId === a.id);
    const payment = recurring ? monthlyEquivalent(recurring.amount, recurring.frequency) : plannedDebtPayment(a, balance);
    debtPayments += payment;
    if (a.type === 'mortgage') mortgagePayments += payment;
    if (a.type === 'auto_loan') carPayments += payment;
  }

  const spending = Math.max(0, averages.total - averages.interest);
  const liquidSavings = sum(
    data.accounts.filter((a) => !a.archived && ['cash', 'savings'].includes(accountGroup(a.type))).map((a) => Math.max(0, balanceOn(index, a.id, today))),
  );

  const rentRecurring = sum(
    data.recurring.filter((r) => r.active && (r.categoryId === 'housing.rent' || r.categoryId === 'housing.mortgage')).map((r) => monthlyEquivalent(r.amount, r.frequency)),
  );
  const currentHousing = mortgagePayments + (rentRecurring || averageInCategories(data, ['housing.rent', 'housing.mortgage'], today));
  const currentCar =
    carPayments + averageInCategories(data, ['transportation.car_payment', 'transportation.insurance', 'transportation.gas', 'transportation.maintenance', 'transportation.repairs'], today);

  return {
    takeHome,
    takeHomeBasis,
    gross,
    grossEstimated,
    spending,
    essential: averages.essential,
    debtPayments,
    surplus: takeHome - spending - debtPayments,
    liquidSavings,
    emergencyMonths: averages.essential > 0 ? liquidSavings / averages.essential : Infinity,
    currentHousing,
    currentCar,
  };
}

// ─── Shared result shape ─────────────────────────────────────────────────────

export type CheckStatus = 'good' | 'stretch' | 'over';

export interface AffordabilityCheck {
  key: string;
  label: string;
  /** Measured value, as a ratio (0.25 = 25%) or plain number for months. */
  value: number;
  unit: 'percent' | 'months';
  /** Rule-of-thumb target shown to the user. */
  target: string;
  status: CheckStatus;
}

export type Verdict = 'comfortable' | 'manageable' | 'stretch' | 'not_affordable';

export interface AffordabilityResult {
  /** New monthly cost of the thing being considered. */
  monthlyCost: Cents;
  /** Cost it replaces (current rent, current car). */
  replaces: Cents;
  netMonthlyChange: Cents;
  newSurplus: Cents;
  upfront: Cents;
  savingsAfter: Cents;
  emergencyMonthsAfter: number;
  breakdown: { key: string; label: string; amount: Cents }[];
  checks: AffordabilityCheck[];
  verdict: Verdict;
  /** How take-home would be split each month afterwards. */
  budget: { spending: Cents; debts: Cents; newCost: Cents; leftover: Cents };
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : a > 0 ? Infinity : 0);

function band(value: number, good: number, stretch: number, lowerIsBetter = true): CheckStatus {
  if (lowerIsBetter) return value <= good ? 'good' : value <= stretch ? 'stretch' : 'over';
  return value >= good ? 'good' : value >= stretch ? 'stretch' : 'over';
}

function finish(
  s: FinancialSnapshot,
  parts: { monthlyCost: Cents; replaces: Cents; upfront: Cents; breakdown: AffordabilityResult['breakdown']; checks: AffordabilityCheck[] },
): AffordabilityResult {
  const netMonthlyChange = parts.monthlyCost - parts.replaces;
  const newSurplus = s.surplus - netMonthlyChange;
  const savingsAfter = s.liquidSavings - parts.upfront;
  const emergencyMonthsAfter = s.essential > 0 ? Math.max(0, savingsAfter) / s.essential : Infinity;

  const checks: AffordabilityCheck[] = [
    ...parts.checks,
    {
      key: 'leftover',
      label: 'Money left each month',
      value: ratio(newSurplus, s.takeHome),
      unit: 'percent',
      target: 'At least 10% of take-home',
      status: newSurplus < 0 ? 'over' : band(ratio(newSurplus, s.takeHome), 0.1, 0, false),
    },
    {
      key: 'emergency',
      label: 'Emergency cushion afterwards',
      value: emergencyMonthsAfter,
      unit: 'months',
      target: '3+ months of essentials',
      status: savingsAfter < 0 ? 'over' : band(emergencyMonthsAfter, 3, 1, false),
    },
  ];

  let verdict: Verdict;
  if (newSurplus < 0 || savingsAfter < 0) verdict = 'not_affordable';
  else if (checks.some((c) => c.status === 'over')) verdict = 'stretch';
  else if (checks.some((c) => c.status === 'stretch')) verdict = 'manageable';
  else verdict = 'comfortable';

  const spendingAfter = Math.max(0, s.spending - (parts.replaces > 0 ? Math.min(parts.replaces, s.spending) : 0));
  return {
    monthlyCost: parts.monthlyCost,
    replaces: parts.replaces,
    netMonthlyChange,
    newSurplus,
    upfront: parts.upfront,
    savingsAfter,
    emergencyMonthsAfter,
    breakdown: parts.breakdown.filter((b) => b.amount > 0),
    checks,
    verdict,
    budget: {
      spending: spendingAfter,
      debts: s.debtPayments,
      newCost: parts.monthlyCost,
      leftover: Math.max(0, s.takeHome - spendingAfter - s.debtPayments - parts.monthlyCost),
    },
  };
}

// ─── Car ─────────────────────────────────────────────────────────────────────

export interface CarInput {
  price: Cents;
  downPayment: Cents;
  tradeIn: Cents;
  salesTaxPct: number;
  fees: Cents;
  apr: number;
  termMonths: number;
  insurance: Cents;
  fuel: Cents;
  maintenance: Cents;
  replaceCurrent: boolean;
}

export function carAffordability(s: FinancialSnapshot, input: CarInput) {
  const total = Math.round(input.price * (1 + input.salesTaxPct / 100)) + input.fees;
  const financed = Math.max(0, total - input.downPayment - input.tradeIn);
  const payment = financed > 0 && input.termMonths > 0 ? amortizedPayment(financed, input.apr, input.termMonths) : 0;
  const totalInterest = Math.max(0, payment * input.termMonths - financed);
  const monthlyCost = payment + input.insurance + input.fuel + input.maintenance;
  const downShare = ratio(input.downPayment + input.tradeIn, input.price);

  const checks: AffordabilityCheck[] = [
    {
      key: 'car_share',
      label: 'Car costs vs take-home',
      value: ratio(monthlyCost, s.takeHome),
      unit: 'percent',
      target: '10–15% of take-home or less',
      status: band(ratio(monthlyCost, s.takeHome), 0.1, 0.15),
    },
  ];
  if (financed > 0) {
    checks.push(
      { key: 'down', label: 'Down payment', value: downShare, unit: 'percent', target: '20% or more', status: band(downShare, 0.2, 0.1, false) },
      { key: 'term', label: 'Loan length', value: input.termMonths, unit: 'months', target: '48 months or less', status: band(input.termMonths, 48, 60) },
    );
  }

  return {
    ...finish(s, {
      monthlyCost,
      replaces: input.replaceCurrent ? s.currentCar : 0,
      upfront: input.downPayment,
      breakdown: [
        { key: 'payment', label: 'Loan payment', amount: payment },
        { key: 'insurance', label: 'Insurance', amount: input.insurance },
        { key: 'fuel', label: 'Fuel / charging', amount: input.fuel },
        { key: 'maintenance', label: 'Maintenance', amount: input.maintenance },
      ],
      checks,
    }),
    financed,
    payment,
    totalInterest,
    totalCost: total + totalInterest,
  };
}

export function carScenario(input: CarInput, result: ReturnType<typeof carAffordability>): ScenarioChange[] {
  const changes: ScenarioChange[] = [
    { id: createId('chg'), type: 'new_loan', label: 'Car loan', principal: result.financed, apr: input.apr, termMonths: Math.max(1, input.termMonths), downPayment: input.downPayment, assetValue: input.price, startMonth: 0 },
  ];
  const running = input.insurance + input.fuel + input.maintenance - (input.replaceCurrent ? result.replaces : 0);
  if (running !== 0) changes.push({ id: createId('chg'), type: 'expense_change', label: 'Car running costs', monthlyAmount: running, startMonth: 0 });
  return changes;
}

// ─── Rent ────────────────────────────────────────────────────────────────────

export interface RentInput {
  rent: Cents;
  utilities: Cents;
  insurance: Cents;
  other: Cents;
  moveInCosts: Cents;
  replaceCurrent: boolean;
}

export function rentAffordability(s: FinancialSnapshot, input: RentInput) {
  const housing = input.rent + input.utilities;
  const monthlyCost = housing + input.insurance + input.other;
  const share = ratio(housing, s.gross);
  return {
    ...finish(s, {
      monthlyCost,
      replaces: input.replaceCurrent ? s.currentHousing : 0,
      upfront: input.moveInCosts,
      breakdown: [
        { key: 'rent', label: 'Rent', amount: input.rent },
        { key: 'utilities', label: 'Utilities', amount: input.utilities },
        { key: 'insurance', label: "Renter's insurance", amount: input.insurance },
        { key: 'other', label: 'Parking, pets & other', amount: input.other },
      ],
      checks: [{ key: 'rent_share', label: 'Rent + utilities vs gross pay', value: share, unit: 'percent', target: '30% of gross or less', status: band(share, 0.3, 0.4) }],
    }),
    /** Gross yearly income at which this rent meets the 30% guideline. */
    incomeNeededYearly: Math.round((housing / 0.3) * 12),
    maxRentAt30: Math.max(0, Math.round(s.gross * 0.3) - input.utilities),
  };
}

export function rentScenario(data: LedgerData, input: RentInput, result: ReturnType<typeof rentAffordability>): ScenarioChange[] {
  const changes: ScenarioChange[] = [];
  const rentItem = data.recurring.find((r) => r.active && r.categoryId === 'housing.rent');
  if (input.replaceCurrent && rentItem && rentItem.frequency.unit === 'month' && rentItem.frequency.interval === 1) {
    changes.push({ id: createId('chg'), type: 'change_recurring', recurringId: rentItem.id, newAmount: input.rent, startMonth: 0 });
    const rest = result.monthlyCost - input.rent - (result.replaces - monthlyEquivalent(rentItem.amount, rentItem.frequency));
    if (rest !== 0) changes.push({ id: createId('chg'), type: 'expense_change', label: 'Other housing costs', monthlyAmount: rest, startMonth: 0 });
  } else {
    changes.push({ id: createId('chg'), type: 'expense_change', label: 'New housing costs', monthlyAmount: result.netMonthlyChange, startMonth: 0 });
  }
  if (input.moveInCosts > 0) changes.push({ id: createId('chg'), type: 'one_time', label: 'Move-in costs', amount: -input.moveInCosts, month: 0 });
  return changes;
}

// ─── House ───────────────────────────────────────────────────────────────────

export interface HouseInput {
  price: Cents;
  downPayment: Cents;
  apr: number;
  termYears: number;
  propertyTaxPct: number;
  insuranceYearly: Cents;
  hoaMonthly: Cents;
  pmiPct: number;
  closingPct: number;
  maintenancePct: number;
  replaceCurrent: boolean;
}

export function houseAffordability(s: FinancialSnapshot, input: HouseInput) {
  const loan = Math.max(0, input.price - input.downPayment);
  const months = Math.max(1, Math.round(input.termYears * 12));
  const principalInterest = loan > 0 ? amortizedPayment(loan, input.apr, months) : 0;
  const tax = Math.round((input.price * input.propertyTaxPct) / 100 / 12);
  const insurance = Math.round(input.insuranceYearly / 12);
  const downShare = ratio(input.downPayment, input.price);
  const pmi = loan > 0 && downShare < 0.2 ? Math.round((loan * input.pmiPct) / 100 / 12) : 0;
  const maintenance = Math.round((input.price * input.maintenancePct) / 100 / 12);
  const housingPayment = principalInterest + tax + insurance + pmi + input.hoaMonthly;
  const closing = Math.round((input.price * input.closingPct) / 100);
  const replaces = input.replaceCurrent ? s.currentHousing : 0;

  const frontEnd = ratio(housingPayment, s.gross);
  // Other debts exclude an existing mortgage that this home would replace.
  const otherDebts = Math.max(0, s.debtPayments - (input.replaceCurrent ? Math.min(s.debtPayments, s.currentHousing) : 0));
  const backEnd = ratio(housingPayment + otherDebts, s.gross);

  // Highest price at which the housing payment stays at 28% of gross, keeping
  // the same down-payment share and rates.
  const d = Math.min(0.99, downShare);
  const r = input.apr / 100 / 12;
  const piFactor = r === 0 ? 1 / months : r / (1 - Math.pow(1 + r, -months));
  const perDollar = piFactor * (1 - d) + input.propertyTaxPct / 100 / 12 + (d < 0.2 ? (input.pmiPct / 100 / 12) * (1 - d) : 0);
  const maxPriceAt28 = Math.max(0, Math.floor((s.gross * 0.28 - insurance - input.hoaMonthly) / perDollar));

  return {
    ...finish(s, {
      monthlyCost: housingPayment + maintenance,
      replaces,
      upfront: input.downPayment + closing,
      breakdown: [
        { key: 'pi', label: 'Principal & interest', amount: principalInterest },
        { key: 'tax', label: 'Property tax', amount: tax },
        { key: 'insurance', label: 'Home insurance', amount: insurance },
        { key: 'pmi', label: 'Mortgage insurance (PMI)', amount: pmi },
        { key: 'hoa', label: 'HOA', amount: input.hoaMonthly },
        { key: 'maintenance', label: 'Upkeep set-aside', amount: maintenance },
      ],
      checks: [
        { key: 'front', label: 'Housing payment vs gross pay', value: frontEnd, unit: 'percent', target: '28% of gross or less', status: band(frontEnd, 0.28, 0.33) },
        { key: 'back', label: 'All debt payments vs gross pay', value: backEnd, unit: 'percent', target: '36% of gross or less', status: band(backEnd, 0.36, 0.43) },
        { key: 'down', label: 'Down payment', value: downShare, unit: 'percent', target: '20% avoids PMI', status: band(downShare, 0.2, 0.035, false) },
      ],
    }),
    loan,
    principalInterest,
    housingPayment,
    closing,
    totalInterest: Math.max(0, principalInterest * months - loan),
    maxPriceAt28,
  };
}

export function houseScenario(input: HouseInput, result: ReturnType<typeof houseAffordability>): ScenarioChange[] {
  const changes: ScenarioChange[] = [
    {
      id: createId('chg'),
      type: 'new_loan',
      label: 'Mortgage',
      principal: result.loan,
      apr: input.apr,
      termMonths: Math.max(1, Math.round(input.termYears * 12)),
      downPayment: input.downPayment,
      assetValue: input.price,
      startMonth: 0,
    },
  ];
  const running = result.monthlyCost - result.principalInterest - result.replaces;
  if (running !== 0) changes.push({ id: createId('chg'), type: 'expense_change', label: 'Taxes, insurance & upkeep', monthlyAmount: running, startMonth: 0 });
  if (result.closing > 0) changes.push({ id: createId('chg'), type: 'one_time', label: 'Closing costs', amount: -result.closing, month: 0 });
  return changes;
}

// ─── Big purchase ────────────────────────────────────────────────────────────

export interface PurchaseInput {
  cost: Cents;
  method: 'cash' | 'save' | 'finance';
  /** Monthly amount put aside when saving up. */
  monthlySaving: Cents;
  apr: number;
  termMonths: number;
}

export function purchaseAffordability(s: FinancialSnapshot, input: PurchaseInput) {
  const payment = input.method === 'finance' && input.termMonths > 0 ? amortizedPayment(input.cost, input.apr, input.termMonths) : 0;
  const monthsToSave = input.method === 'save' ? (input.monthlySaving > 0 ? Math.ceil(input.cost / input.monthlySaving) : Infinity) : 0;
  const monthlyCost = input.method === 'finance' ? payment : input.method === 'save' ? input.monthlySaving : 0;
  const share = ratio(input.cost, s.takeHome);
  return {
    ...finish(s, {
      monthlyCost,
      replaces: 0,
      upfront: input.method === 'cash' ? input.cost : 0,
      breakdown: [{ key: 'monthly', label: input.method === 'finance' ? 'Loan payment' : 'Saving toward it', amount: monthlyCost }],
      checks: [{ key: 'size', label: 'Price vs a month of take-home', value: share, unit: 'percent', target: 'Under 100% is easier to absorb', status: band(share, 0.5, 1) }],
    }),
    payment,
    monthsToSave,
    totalInterest: input.method === 'finance' ? Math.max(0, payment * input.termMonths - input.cost) : 0,
  };
}

export function purchaseScenario(input: PurchaseInput, label: string): ScenarioChange[] {
  if (input.method === 'finance') {
    return [{ id: createId('chg'), type: 'new_loan', label, principal: input.cost, apr: input.apr, termMonths: Math.max(1, input.termMonths), downPayment: 0, assetValue: 0, startMonth: 0 }];
  }
  return [{ id: createId('chg'), type: 'one_time', label, amount: -input.cost, month: 0 }];
}
