/**
 * Core financial data model.
 *
 * Integrity rules that the rest of the app relies on:
 * - Money is always stored as integer cents (`Cents`) to avoid float drift.
 * - Dates are local calendar dates as `YYYY-MM-DD` strings (`ISODate`).
 * - Account balances are never stored directly. They are derived from the
 *   account's starting balance plus the postings of every transaction
 *   (see `ledger.ts`). Updating a balance manually creates an `adjustment`.
 * - Transaction `type` decides how money is classified. Transfers, debt
 *   payments and investment contributions move money between accounts and
 *   are never counted as income or spending (see `classify.ts`).
 * - Savings goals earmark money that already sits in an account via
 *   contributions; they never create or duplicate cash.
 */

export type ID = string;
export type Cents = number;
/** Calendar date, `YYYY-MM-DD`. */
export type ISODate = string;
/** Calendar month, `YYYY-MM`. */
export type ISOMonth = string;
/** ISO timestamp for audit fields. */
export type Timestamp = string;

export type IconName = string;

// ─── Accounts ────────────────────────────────────────────────────────────────

export type AccountType =
  | 'checking'
  | 'savings'
  | 'cash'
  | 'credit_card'
  | 'store_card'
  | 'auto_loan'
  | 'student_loan'
  | 'personal_loan'
  | 'mortgage'
  | 'medical_debt'
  | 'brokerage'
  | 'roth_ira'
  | 'traditional_ira'
  | '401k'
  | 'hsa'
  | 'other_investment'
  | 'other_asset'
  | 'other_liability';

export type AccountGroup = 'cash' | 'savings' | 'credit' | 'loan' | 'investment' | 'other_asset' | 'other_liability';

export type Nature = 'asset' | 'liability';

/** How the scheduled payment for a liability is sized when no recurring item covers it. */
export type PlannedPayment = 'statement' | 'minimum' | 'fixed';

export interface Account {
  id: ID;
  name: string;
  institution?: string;
  type: AccountType;
  /** Balance on `startingDate`, in natural terms (liabilities: amount owed). */
  startingBalance: Cents;
  startingDate: ISODate;
  creditLimit?: Cents;
  /** Annual percentage rate, e.g. 24.99. */
  apr?: number;
  promoApr?: number;
  promoExpires?: ISODate;
  minimumPayment?: Cents;
  /** Planned / required regular payment for loans, or a fixed card payment. */
  paymentAmount?: Cents;
  plannedPayment?: PlannedPayment;
  /** Day of month the payment is due (1–31). */
  dueDay?: number;
  statementBalance?: Cents;
  statementClosingDay?: number;
  /** Original principal for loans; used for payoff progress. */
  originalBalance?: Cents;
  /** Investments: cost basis on `startingDate`. */
  startingCostBasis?: Cents;
  /** Checking/cash accounts count toward "available to spend" when true. */
  spendable?: boolean;
  color: string;
  icon: IconName;
  notes?: string;
  tags: string[];
  archived: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Categories & budgets ────────────────────────────────────────────────────

export type CategoryKind = 'expense' | 'income';

/** How spending in a category matters for US federal taxes. */
export type TaxTag =
  | 'charitable'
  | 'medical'
  | 'business'
  | 'home_office'
  | 'mortgage_interest'
  | 'property_tax'
  | 'state_local_tax'
  | 'education'
  | 'childcare'
  | 'student_loan_interest'
  | 'car_loan_interest'
  | 'hsa_eligible'
  | 'federal_estimated'
  | 'state_estimated'
  | 'tax_prep'
  | 'other';

/** How income in a category is taxed. */
export type IncomeTaxKind =
  | 'wages'
  | 'tips'
  | 'overtime'
  | 'self_employment'
  | 'interest'
  | 'dividends'
  | 'capital_gains'
  | 'rental'
  | 'retirement'
  | 'social_security'
  | 'unemployment'
  | 'other_taxable'
  | 'nontaxable';

export interface Category {
  id: ID;
  name: string;
  /** Spending categories: tax treatment suggested for new transactions. */
  taxTag?: TaxTag;
  /** Income categories: how the income is taxed. */
  incomeTax?: IncomeTaxKind;
  parentId: ID | null;
  kind: CategoryKind;
  icon: IconName;
  color: string;
  /** Default essential/discretionary flag for new transactions. */
  essential: boolean;
  archived: boolean;
  order: number;
}

export type BudgetMode = 'limit' | 'flexible';

export interface Budget {
  id: ID;
  categoryId: ID;
  mode: BudgetMode;
  rollover: boolean;
  /** Amount history; the entry with the latest `month <= target` applies. */
  amounts: { month: ISOMonth; amount: Cents }[];
}

// ─── Transactions ────────────────────────────────────────────────────────────

export type TransactionType =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'debt_payment'
  | 'investment_contribution'
  | 'investment_withdrawal'
  | 'refund'
  | 'reimbursement'
  | 'interest'
  | 'adjustment';

export type AdjustmentKind = 'reconcile' | 'valuation' | 'other';

export interface Attachment {
  id: ID;
  uri: string;
  name: string;
  mimeType?: string;
}

/** One line of a split purchase. Amounts are positive and sum to the transaction. */
export interface TransactionSplit {
  id: ID;
  categoryId?: ID;
  amount: Cents;
  note?: string;
  essential?: boolean;
  /** A TaxTag key for this line only. */
  taxCategory?: string;
}

export interface Transaction {
  id: ID;
  type: TransactionType;
  /** Positive cents. Only `adjustment` is signed (natural-terms delta). */
  amount: Cents;
  date: ISODate;
  description: string;
  payee?: string;
  categoryId?: ID;
  /**
   * The account money leaves (expense, transfers, payments, contributions,
   * withdrawals) or arrives in (income, refund, reimbursement). For
   * `interest` and `adjustment` it is the affected account.
   */
  accountId: ID;
  /** Destination for transfer-like types. */
  toAccountId?: ID;
  notes?: string;
  tags: string[];
  essential?: boolean;
  /** true = counts for taxes, false = reviewed and not tax related, undefined = not reviewed. */
  taxRelated?: boolean;
  /** A TaxTag key, or free text from older data. */
  taxCategory?: string;
  /** Paycheck breakdown (income transactions with a gross amount). */
  withholding?: PaycheckWithholding;
  /** Category breakdown for one purchase; amounts sum to `amount`. */
  splits?: TransactionSplit[];
  /** Out-of-pocket medical kept for a later HSA/FSA reimbursement. */
  reimbursableFrom?: 'hsa' | 'fsa';
  reimbursedOn?: ISODate;
  adjustmentKind?: AdjustmentKind;
  /** Link to the recurring item and the specific occurrence it settles. */
  recurringId?: ID;
  occurrenceDate?: ISODate;
  /** Link to an income source (paychecks). */
  incomeSourceId?: ID;
  grossAmount?: Cents;
  hours?: number;
  attachments: Attachment[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** A saved shortcut for quick add. */
export interface FavoriteTransaction {
  id: ID;
  label: string;
  type: TransactionType;
  amount?: Cents;
  categoryId?: ID;
  accountId?: ID;
  toAccountId?: ID;
  payee?: string;
  tags: string[];
}

// ─── Schedules ───────────────────────────────────────────────────────────────

export type FrequencyUnit = 'day' | 'week' | 'month' | 'year';

export interface Frequency {
  unit: FrequencyUnit;
  interval: number;
}

export type RecurringKind = 'bill' | 'subscription' | 'debt_payment' | 'transfer' | 'savings' | 'investment';

export type SubscriptionUsage = 'often' | 'sometimes' | 'rarely' | 'never';

export interface RecurringItem {
  id: ID;
  name: string;
  kind: RecurringKind;
  amount: Cents;
  /** Amount varies (utilities); treated as an estimate. */
  variable: boolean;
  frequency: Frequency;
  /** First due date; later occurrences are computed from it. */
  startDate: ISODate;
  endDate?: ISODate;
  categoryId?: ID;
  /** Account the payment comes from. */
  accountId: ID;
  /** Destination for debt payments, transfers, savings and investments. */
  toAccountId?: ID;
  payee?: string;
  autopay: boolean;
  essential: boolean;
  active: boolean;
  /** Occurrence dates deliberately skipped. */
  skipped: ISODate[];
  usage?: SubscriptionUsage;
  lastUsed?: ISODate;
  notes?: string;
  tags: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Income ──────────────────────────────────────────────────────────────────

export type IncomeType =
  | 'salary'
  | 'hourly'
  | 'overtime'
  | 'bonus'
  | 'freelance'
  | 'side_business'
  | 'reselling'
  | 'interest'
  | 'dividends'
  | 'investment_income'
  | 'gift'
  | 'refund'
  | 'other';

/** Amounts taken out of a paycheck before it is deposited, in cents. */
export interface PaycheckWithholding {
  federal?: Cents;
  state?: Cents;
  socialSecurity?: Cents;
  medicare?: Cents;
  /** Pre-tax 401(k)/403(b) contributions. */
  retirement?: Cents;
  /** Pre-tax HSA contributions through payroll. */
  hsa?: Cents;
  /** Other pre-tax deductions: health, dental and vision premiums, FSA. */
  benefits?: Cents;
}

export type TaxForm = 'W-2' | '1099-NEC' | '1099-K' | '1099-MISC' | 'none';

export interface IncomeSource {
  id: ID;
  name: string;
  /** Expected deductions per paycheck, copied onto recorded paychecks. */
  withholding?: PaycheckWithholding;
  taxForm?: TaxForm;
  type: IncomeType;
  employer?: string;
  /** Omitted for irregular income. */
  frequency?: Frequency;
  /** A known pay date the schedule is anchored to. */
  anchorDate?: ISODate;
  endDate?: ISODate;
  hourlyRate?: Cents;
  expectedHours?: number;
  expectedGross?: Cents;
  expectedNet?: Cents;
  /** Employer 401(k) match: `percent` of pay matched on the first `upToPercent` you contribute. */
  match?: { percent: number; upToPercent: number };
  depositAccountId: ID;
  categoryId?: ID;
  active: boolean;
  notes?: string;
  tags: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Goals ───────────────────────────────────────────────────────────────────

export type GoalKind = 'savings' | 'debt_payoff' | 'net_worth' | 'investment' | 'custom';

export type GoalTemplate = 'emergency' | 'move_out' | 'vacation' | 'car' | 'purchase' | 'general' | 'custom';

export interface Goal {
  id: ID;
  name: string;
  kind: GoalKind;
  template: GoalTemplate;
  target: Cents;
  targetDate?: ISODate;
  /** Debt payoff / investment goals track these accounts. */
  linkedAccountIds: ID[];
  /** Value when the goal was created (debt balance, net worth, …). */
  startValue?: Cents;
  startDate: ISODate;
  icon: IconName;
  color: string;
  notes?: string;
  tags: string[];
  archived: boolean;
  completedAt?: ISODate;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Money assigned to (or released from) a savings/custom goal. For savings
 * goals `accountId` says which account physically holds the money, so the
 * allocation can be checked against that account's real balance.
 */
export interface GoalContribution {
  id: ID;
  goalId: ID;
  date: ISODate;
  amount: Cents;
  accountId?: ID;
  note?: string;
  createdAt: Timestamp;
}

// ─── Sinking funds ───────────────────────────────────────────────────────────

/** Money reserved for a cost that doesn't arrive monthly. */
export interface SinkingFund {
  id: ID;
  name: string;
  emoji?: string;
  categoryId?: ID;
  /** What the cost runs per year. */
  yearlyTarget: Cents;
  /** Amount set aside each month. */
  monthly: Cents;
  /** Account that physically holds the reserve. */
  accountId?: ID;
  /** When the cost is next expected. */
  dueDate?: ISODate;
  entries: SinkingEntry[];
  notes?: string;
  archived: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Positive adds to the reserve, negative spends it. */
export interface SinkingEntry {
  id: ID;
  date: ISODate;
  amount: Cents;
  note?: string;
  txId?: ID;
}

// ─── Policies & warranties ───────────────────────────────────────────────────

export type PolicyKind = 'auto' | 'home' | 'renters' | 'health' | 'dental' | 'vision' | 'life' | 'disability' | 'umbrella' | 'pet' | 'travel' | 'phone' | 'warranty' | 'other';

export interface PolicyClaim {
  id: ID;
  date: ISODate;
  description: string;
  amount?: Cents;
  reimbursed?: Cents;
  status: 'open' | 'paid' | 'denied';
  note?: string;
}

export interface Policy {
  id: ID;
  kind: PolicyKind;
  name: string;
  provider?: string;
  policyNumber?: string;
  premium?: Cents;
  premiumFrequency?: Frequency;
  deductible?: Cents;
  /** Coverage limit, or what a warranty covers. */
  coverage?: Cents;
  startDate?: ISODate;
  /** Renewal for insurance, expiry for a warranty. */
  renewalDate?: ISODate;
  /** Asset this covers (car, laptop, home). */
  linkedAssetId?: ID;
  /** Recurring item that pays the premium. */
  recurringId?: ID;
  contact?: string;
  notes?: string;
  documents: Attachment[];
  claims: PolicyClaim[];
  tags: string[];
  archived: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── IOUs ────────────────────────────────────────────────────────────────────

/** Money lent to or borrowed from a person, outside your accounts. */
export interface Iou {
  id: ID;
  person: string;
  direction: 'owed_to_me' | 'i_owe';
  amount: Cents;
  date: ISODate;
  dueDate?: ISODate;
  reason?: string;
  /** Repayments; each one reduces what is outstanding. */
  entries: IouEntry[];
  settledOn?: ISODate;
  notes?: string;
  tags: string[];
  archived: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface IouEntry {
  id: ID;
  date: ISODate;
  amount: Cents;
  note?: string;
  txId?: ID;
}

// ─── Assets ──────────────────────────────────────────────────────────────────

export type AssetType = 'vehicle' | 'property' | 'electronics' | 'jewelry' | 'collectible' | 'other';

export interface AssetValuation {
  id: ID;
  date: ISODate;
  value: Cents;
  note?: string;
}

export interface Asset {
  id: ID;
  name: string;
  type: AssetType;
  purchasePrice?: Cents;
  purchaseDate?: ISODate;
  valuations: AssetValuation[];
  /** Loan secured by this asset (e.g. auto loan) for equity. */
  linkedLiabilityId?: ID;
  /** Tag used to find related expenses, e.g. `car`. */
  expenseTag?: string;
  notes?: string;
  tags: string[];
  archived: boolean;
  soldDate?: ISODate;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

export type ScenarioChange =
  | { id: ID; type: 'income_change'; mode: 'amount' | 'percent'; value: number; startMonth: number }
  | { id: ID; type: 'expense_change'; label: string; monthlyAmount: Cents; startMonth: number }
  | { id: ID; type: 'cancel_recurring'; recurringId: ID; startMonth: number }
  | { id: ID; type: 'change_recurring'; recurringId: ID; newAmount: Cents; startMonth: number }
  | { id: ID; type: 'extra_debt_payment'; monthlyAmount: Cents; accountId?: ID; startMonth: number }
  | { id: ID; type: 'one_time'; label: string; amount: Cents; month: number }
  | {
      id: ID;
      type: 'new_loan';
      label: string;
      principal: Cents;
      apr: number;
      termMonths: number;
      downPayment: Cents;
      assetValue: Cents;
      startMonth: number;
    }
  | { id: ID; type: 'savings_contribution'; perPaycheck: Cents; startMonth: number };

export interface Scenario {
  id: ID;
  name: string;
  notes?: string;
  horizonMonths: number;
  changes: ScenarioChange[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Settings & root ─────────────────────────────────────────────────────────

export type DashboardWidgetId =
  | 'overview'
  | 'health'
  | 'alerts'
  | 'upcoming'
  | 'cashflow'
  | 'cash'
  | 'netWorth'
  | 'debt'
  | 'investments'
  | 'goals'
  | 'budgets'
  | 'forecast'
  | 'recent';

// ─── Taxes ───────────────────────────────────────────────────────────────────

export type FilingStatus = 'single' | 'married_joint' | 'married_separate' | 'head_of_household';

export interface TaxProfile {
  filingStatus: FilingStatus;
  dependentsUnder17: number;
  otherDependents: number;
  /** Number of filers (you and spouse) aged 65 or older. */
  seniors: number;
  /** Eligible for retirement catch-up contributions. */
  age50Plus: boolean;
  hsaCoverage: 'none' | 'self' | 'family';
  /** Rough effective state income tax rate, percent. */
  stateRate: number;
  deduction: 'auto' | 'standard' | 'itemized';
  /** Car loan meets the 2025–2028 interest deduction rules (new, US-assembled, after 2024). */
  carLoanQualifies: boolean;
  /** Last year's total federal tax, for the estimated-payment safe harbor. */
  priorYearTax?: Cents;
  priorYearAgi?: Cents;
  /** Set once the user has reviewed the profile. */
  configured: boolean;
}

export type TaxDocumentStatus = 'expected' | 'received' | 'not_needed';

export interface TaxDocument {
  /** Stable key for suggested documents (e.g. "w2:inc_paycheck"), or an id for custom ones. */
  key: string;
  form: string;
  issuer: string;
  status: TaxDocumentStatus;
  attachments: Attachment[];
  custom: boolean;
  note?: string;
}

export type TaxAdjustmentKind = 'capital_gain_long' | 'capital_gain_short' | 'other_income' | 'other_deduction' | 'credit' | 'federal_withholding' | 'state_withholding';

export interface TaxAdjustment {
  id: ID;
  kind: TaxAdjustmentKind;
  label: string;
  amount: Cents;
}

export interface MileageEntry {
  id: ID;
  date: ISODate;
  miles: number;
  purpose: 'business' | 'medical' | 'charitable';
  note?: string;
}

export interface TaxYearRecord {
  year: number;
  documents: TaxDocument[];
  adjustments: TaxAdjustment[];
  mileage: MileageEntry[];
  filedOn?: ISODate;
  notes?: string;
}

/** On-device lock and local reminders. Nothing leaves the device. */
export interface SecuritySettings {
  lock: boolean;
  /** Minutes in the background before the lock screen returns. */
  lockAfterMinutes: number;
}

export interface NotificationSettings {
  enabled: boolean;
  /** Days before a bill's due date to remind. */
  billsDaysBefore: number;
  /** Hour of the day (0–23) reminders fire. */
  hour: number;
  paydays: boolean;
  weeklyReview: boolean;
  /** Warn when the forecast dips below this. */
  lowBalance?: Cents;
}

export interface Settings {
  currency: string;
  weekStartsOn: 0 | 1;
  /** Cash kept aside when computing available-to-spend. */
  spendingBuffer: Cents;
  /** Annual return assumption for scenario projections, percent. */
  investmentReturn: number;
  hideAmounts: boolean;
  security: SecuritySettings;
  notifications: NotificationSettings;
  dashboard: { order: DashboardWidgetId[]; hidden: DashboardWidgetId[] };
}

export interface LedgerMeta {
  schemaVersion: number;
  isSample: boolean;
  onboarded: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface LedgerData {
  meta: LedgerMeta;
  settings: Settings;
  taxProfile: TaxProfile;
  taxYears: TaxYearRecord[];
  accounts: Account[];
  categories: Category[];
  budgets: Budget[];
  transactions: Transaction[];
  favorites: FavoriteTransaction[];
  recurring: RecurringItem[];
  incomeSources: IncomeSource[];
  goals: Goal[];
  goalContributions: GoalContribution[];
  sinkingFunds: SinkingFund[];
  policies: Policy[];
  ious: Iou[];
  assets: Asset[];
  scenarios: Scenario[];
}
