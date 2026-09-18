import type {
  AccountGroup,
  AccountType,
  AssetType,
  GoalKind,
  GoalTemplate,
  IncomeType,
  Nature,
  RecurringKind,
  TransactionType,
} from './types';

/** Static metadata for enums: labels, icons and behaviour flags. */

export interface AccountTypeInfo {
  label: string;
  group: AccountGroup;
  nature: Nature;
  icon: string;
  /** Optional fields relevant to this type, used by forms and detail views. */
  fields: {
    creditLimit?: boolean;
    apr?: boolean;
    promo?: boolean;
    payment?: boolean;
    statement?: boolean;
    originalBalance?: boolean;
    costBasis?: boolean;
  };
}

const card = { creditLimit: true, apr: true, promo: true, payment: true, statement: true };
const loan = { apr: true, promo: true, payment: true, originalBalance: true };
const invest = { costBasis: true };

export const ACCOUNT_TYPES: Record<AccountType, AccountTypeInfo> = {
  checking: { label: 'Checking', group: 'cash', nature: 'asset', icon: 'credit-card', fields: {} },
  savings: { label: 'Savings', group: 'savings', nature: 'asset', icon: 'shield', fields: { apr: true } },
  cash: { label: 'Cash', group: 'cash', nature: 'asset', icon: 'dollar-sign', fields: {} },
  credit_card: { label: 'Credit card', group: 'credit', nature: 'liability', icon: 'credit-card', fields: card },
  store_card: { label: 'Store credit card', group: 'credit', nature: 'liability', icon: 'shopping-bag', fields: card },
  auto_loan: { label: 'Auto loan', group: 'loan', nature: 'liability', icon: 'truck', fields: loan },
  student_loan: { label: 'Student loan', group: 'loan', nature: 'liability', icon: 'book-open', fields: loan },
  personal_loan: { label: 'Personal loan', group: 'loan', nature: 'liability', icon: 'user', fields: loan },
  mortgage: { label: 'Mortgage', group: 'loan', nature: 'liability', icon: 'home', fields: loan },
  medical_debt: { label: 'Medical debt', group: 'loan', nature: 'liability', icon: 'activity', fields: loan },
  brokerage: { label: 'Brokerage', group: 'investment', nature: 'asset', icon: 'trending-up', fields: invest },
  roth_ira: { label: 'Roth IRA', group: 'investment', nature: 'asset', icon: 'sun', fields: invest },
  traditional_ira: { label: 'Traditional IRA', group: 'investment', nature: 'asset', icon: 'sunrise', fields: invest },
  '401k': { label: '401(k)', group: 'investment', nature: 'asset', icon: 'briefcase', fields: invest },
  hsa: { label: 'HSA', group: 'investment', nature: 'asset', icon: 'heart', fields: invest },
  other_investment: { label: 'Other investment', group: 'investment', nature: 'asset', icon: 'bar-chart-2', fields: invest },
  other_asset: { label: 'Other asset', group: 'other_asset', nature: 'asset', icon: 'box', fields: {} },
  other_liability: { label: 'Other liability', group: 'other_liability', nature: 'liability', icon: 'alert-circle', fields: { apr: true, payment: true } },
};

export const ACCOUNT_GROUPS: { group: AccountGroup; label: string; types: AccountType[] }[] = [
  { group: 'cash', label: 'Cash & checking', types: ['checking', 'cash'] },
  { group: 'savings', label: 'Savings', types: ['savings'] },
  { group: 'credit', label: 'Credit cards', types: ['credit_card', 'store_card'] },
  { group: 'loan', label: 'Loans', types: ['auto_loan', 'student_loan', 'personal_loan', 'mortgage', 'medical_debt'] },
  { group: 'investment', label: 'Investments', types: ['brokerage', 'roth_ira', 'traditional_ira', '401k', 'hsa', 'other_investment'] },
  { group: 'other_asset', label: 'Other assets', types: ['other_asset'] },
  { group: 'other_liability', label: 'Other liabilities', types: ['other_liability'] },
];

export const accountNature = (type: AccountType): Nature => ACCOUNT_TYPES[type].nature;
export const accountGroup = (type: AccountType): AccountGroup => ACCOUNT_TYPES[type].group;
export const isLiquid = (type: AccountType) => ['cash', 'savings'].includes(ACCOUNT_TYPES[type].group);
export const isInvestment = (type: AccountType) => ACCOUNT_TYPES[type].group === 'investment';
export const isDebt = (type: AccountType) => ACCOUNT_TYPES[type].nature === 'liability';
export const isCreditCard = (type: AccountType) => ACCOUNT_TYPES[type].group === 'credit';

export interface TransactionTypeInfo {
  label: string;
  /** Short verb used in lists and quick add. */
  short: string;
  icon: string;
  /** Needs a destination account. */
  twoAccounts: boolean;
  /** Which category kind applies, if any. */
  category: 'expense' | 'income' | null;
  description: string;
}

export const TRANSACTION_TYPES: Record<TransactionType, TransactionTypeInfo> = {
  expense: { label: 'Expense', short: 'Spent', icon: 'arrow-up-right', twoAccounts: false, category: 'expense', description: 'Money spent from an account or charged to a card.' },
  income: { label: 'Income', short: 'Earned', icon: 'arrow-down-left', twoAccounts: false, category: 'income', description: 'Paychecks, interest, dividends and other money earned.' },
  transfer: { label: 'Transfer', short: 'Moved', icon: 'repeat', twoAccounts: true, category: null, description: 'Move money between your own accounts. Not income or spending.' },
  debt_payment: { label: 'Debt payment', short: 'Paid debt', icon: 'check-circle', twoAccounts: true, category: null, description: 'Pay down a card or loan. Reduces cash and debt; not spending.' },
  investment_contribution: { label: 'Investment contribution', short: 'Invested', icon: 'trending-up', twoAccounts: true, category: null, description: 'Move cash into an investment account.' },
  investment_withdrawal: { label: 'Investment withdrawal', short: 'Withdrew', icon: 'trending-down', twoAccounts: true, category: null, description: 'Move money out of an investment account.' },
  refund: { label: 'Refund', short: 'Refund', icon: 'corner-down-left', twoAccounts: false, category: 'expense', description: 'Money returned for a purchase. Reduces spending in its category.' },
  reimbursement: { label: 'Reimbursement', short: 'Reimbursed', icon: 'rotate-ccw', twoAccounts: false, category: 'expense', description: 'Money paid back to you for an expense. Reduces spending.' },
  interest: { label: 'Interest charge', short: 'Interest', icon: 'percent', twoAccounts: false, category: 'expense', description: 'Interest or fees added to a card or loan balance.' },
  adjustment: { label: 'Balance adjustment', short: 'Adjusted', icon: 'sliders', twoAccounts: false, category: null, description: 'Correct a balance or record a market value change. Not income or spending.' },
};

export const RECURRING_KINDS: Record<RecurringKind, { label: string; icon: string; txType: TransactionType }> = {
  bill: { label: 'Bill', icon: 'file-text', txType: 'expense' },
  subscription: { label: 'Subscription', icon: 'refresh-cw', txType: 'expense' },
  debt_payment: { label: 'Debt payment', icon: 'check-circle', txType: 'debt_payment' },
  transfer: { label: 'Transfer', icon: 'repeat', txType: 'transfer' },
  savings: { label: 'Savings contribution', icon: 'shield', txType: 'transfer' },
  investment: { label: 'Investment contribution', icon: 'trending-up', txType: 'investment_contribution' },
};

export const INCOME_TYPES: Record<IncomeType, { label: string; icon: string; employment: boolean }> = {
  salary: { label: 'Salary', icon: 'briefcase', employment: true },
  hourly: { label: 'Hourly wages', icon: 'clock', employment: true },
  overtime: { label: 'Overtime', icon: 'clock', employment: true },
  bonus: { label: 'Bonus', icon: 'award', employment: true },
  freelance: { label: 'Freelance', icon: 'edit-3', employment: false },
  side_business: { label: 'Side business', icon: 'package', employment: false },
  reselling: { label: 'Reselling', icon: 'tag', employment: false },
  interest: { label: 'Interest', icon: 'percent', employment: false },
  dividends: { label: 'Dividends', icon: 'pie-chart', employment: false },
  investment_income: { label: 'Investment income', icon: 'trending-up', employment: false },
  gift: { label: 'Gifts', icon: 'gift', employment: false },
  refund: { label: 'Refunds', icon: 'corner-down-left', employment: false },
  other: { label: 'Other income', icon: 'plus-circle', employment: false },
};

export const GOAL_KINDS: Record<GoalKind, { label: string; description: string }> = {
  savings: { label: 'Save money', description: 'Set aside money that sits in one of your accounts.' },
  debt_payoff: { label: 'Pay off debt', description: 'Progress follows the balance of linked debts.' },
  net_worth: { label: 'Reach a net worth', description: 'Progress follows your total net worth.' },
  investment: { label: 'Invest', description: 'Progress follows the value of linked investment accounts.' },
  custom: { label: 'Custom', description: 'Track progress with manual contributions.' },
};

export const GOAL_TEMPLATES: Record<GoalTemplate, { label: string; icon: string; kind: GoalKind }> = {
  emergency: { label: 'Emergency fund', icon: 'umbrella', kind: 'savings' },
  move_out: { label: 'Move-out fund', icon: 'home', kind: 'savings' },
  vacation: { label: 'Vacation', icon: 'map', kind: 'savings' },
  car: { label: 'Car', icon: 'truck', kind: 'savings' },
  purchase: { label: 'Large purchase', icon: 'shopping-bag', kind: 'savings' },
  general: { label: 'General savings', icon: 'shield', kind: 'savings' },
  custom: { label: 'Custom goal', icon: 'flag', kind: 'custom' },
};

export const ASSET_TYPES: Record<AssetType, { label: string; icon: string }> = {
  vehicle: { label: 'Vehicle', icon: 'truck' },
  property: { label: 'Property', icon: 'home' },
  electronics: { label: 'Electronics', icon: 'monitor' },
  jewelry: { label: 'Jewelry', icon: 'star' },
  collectible: { label: 'Collectible', icon: 'archive' },
  other: { label: 'Other', icon: 'box' },
};

/** Palette for accounts, categories and goals. Muted so numbers stay readable. */
export const ENTITY_COLORS = [
  '#2469FE',
  '#475569',
  '#16A34A',
  '#F59E0B',
  '#E5484D',
  '#8B5CF6',
  '#0EA5E9',
  '#EC4899',
  '#14B8A6',
  '#64748B',
];
