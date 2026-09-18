import { isDebt, isLiquid } from './catalog';
import type { AccountType, Cents, ID, LedgerData } from './types';

/**
 * First-run setup: what a new ledger needs before the rest of the app can say
 * anything useful, and the shortcuts that make filling it in quick.
 */

export interface BillPreset {
  key: string;
  name: string;
  categoryId: ID;
  emoji: string;
  /** Most people pay this yearly rather than monthly. */
  yearly?: boolean;
  /** Utilities and the like: the amount moves every month. */
  variable?: boolean;
  essential: boolean;
}

/** The bills people actually have, in the order they usually think of them. */
export const BILL_PRESETS: BillPreset[] = [
  { key: 'rent', name: 'Rent', categoryId: 'housing.rent', emoji: 'house', essential: true },
  { key: 'mortgage', name: 'Mortgage', categoryId: 'housing.mortgage', emoji: 'house-with-garden', essential: true },
  { key: 'electric', name: 'Electricity', categoryId: 'housing.utilities', emoji: 'light-bulb', variable: true, essential: true },
  { key: 'gas', name: 'Gas & heating', categoryId: 'housing.gas_heating', emoji: 'fire', variable: true, essential: true },
  { key: 'water', name: 'Water', categoryId: 'housing.water', emoji: 'droplet', variable: true, essential: true },
  { key: 'trash', name: 'Trash', categoryId: 'housing.trash', emoji: 'wastebasket', essential: true },
  { key: 'internet', name: 'Internet', categoryId: 'housing.internet', emoji: 'globe-with-meridians', essential: true },
  { key: 'phone', name: 'Phone', categoryId: 'housing.phone', emoji: 'mobile-phone', essential: true },
  { key: 'car_insurance', name: 'Car insurance', categoryId: 'transportation.insurance', emoji: 'automobile', essential: true },
  { key: 'renters_insurance', name: 'Renters insurance', categoryId: 'housing.renters_insurance', emoji: 'shield', essential: true },
  { key: 'health_insurance', name: 'Health insurance', categoryId: 'health.health_insurance', emoji: 'stethoscope', essential: true },
  { key: 'gym', name: 'Gym', categoryId: 'health.fitness', emoji: 'flexed-biceps', essential: false },
  { key: 'streaming', name: 'Streaming', categoryId: 'subscriptions.streaming', emoji: 'television', essential: false },
  { key: 'music', name: 'Music', categoryId: 'subscriptions.music', emoji: 'headphone', essential: false },
  { key: 'cloud', name: 'Cloud storage', categoryId: 'subscriptions.cloud', emoji: 'cloud', essential: false },
  { key: 'childcare', name: 'Childcare', categoryId: 'kids.childcare', emoji: 'teddy-bear', essential: true },
  { key: 'pet', name: 'Pet food & care', categoryId: 'pets.pet_food', emoji: 'paw-prints', essential: true },
  { key: 'storage', name: 'Storage unit', categoryId: 'housing.storage', emoji: 'package', essential: false },
  { key: 'membership', name: 'Yearly membership', categoryId: 'subscriptions.memberships', emoji: 'ticket', yearly: true, essential: false },
];

/** Account types offered during setup, grouped the way people describe them. */
export const SETUP_ACCOUNTS: { group: string; hint: string; types: AccountType[] }[] = [
  { group: 'Everyday money', hint: 'What you spend from', types: ['checking', 'cash'] },
  { group: 'Savings', hint: 'Money set aside', types: ['savings'] },
  { group: 'Cards', hint: 'What you owe on plastic', types: ['credit_card', 'store_card'] },
  { group: 'Loans', hint: 'Anything you are paying off', types: ['auto_loan', 'student_loan', 'mortgage', 'personal_loan', 'medical_debt'] },
  { group: 'Investments & retirement', hint: 'Long-term money', types: ['401k', 'roth_ira', 'traditional_ira', 'brokerage', 'hsa'] },
];

export interface SetupStatus {
  hasSpendable: boolean;
  hasIncome: boolean;
  hasBills: boolean;
  hasDebtDetail: boolean;
  /** 0–1, for a progress meter. */
  progress: number;
  /** What to do next, most useful first. */
  missing: { key: 'accounts' | 'income' | 'bills' | 'debt'; label: string; href: string }[];
}

/**
 * What the ledger still needs. Everything in the app derives from these four:
 * without a spendable account there is no available-to-spend, without income
 * there is no payday, and without bills there is nothing committed.
 */
export function setupStatus(data: LedgerData): SetupStatus {
  const accounts = data.accounts.filter((a) => !a.archived);
  const hasSpendable = accounts.some((a) => isLiquid(a.type));
  const hasIncome = data.incomeSources.some((s) => s.active) || data.transactions.some((t) => t.type === 'income');
  const hasBills = data.recurring.some((r) => r.active);
  // A debt is only useful once it says when and how much to pay.
  const debts = accounts.filter((a) => isDebt(a.type));
  const hasDebtDetail = debts.length === 0 || debts.every((a) => a.dueDay !== undefined);

  const missing: SetupStatus['missing'] = [];
  if (!hasSpendable) missing.push({ key: 'accounts', label: 'Add an account you spend from', href: '/setup' });
  if (!hasIncome) missing.push({ key: 'income', label: 'Add your paycheck', href: '/income/edit' });
  if (!hasBills) missing.push({ key: 'bills', label: 'Add the bills you pay', href: '/bills/edit' });
  if (!hasDebtDetail) missing.push({ key: 'debt', label: 'Add due dates to your cards and loans', href: '/debt' });

  const done = [hasSpendable, hasIncome, hasBills, hasDebtDetail].filter(Boolean).length;
  return { hasSpendable, hasIncome, hasBills, hasDebtDetail, progress: done / 4, missing };
}

/** A starting balance is owed for debts and held for everything else. */
export const startingBalanceLabel = (type: AccountType) => (isDebt(type) ? 'Balance owed' : 'Balance today');

/** Rough monthly equivalent of what has been set up, for the closing summary. */
export function setupSummary(data: LedgerData): { accounts: number; owed: Cents; held: Cents; bills: number; monthlyBills: Cents; income: number } {
  const accounts = data.accounts.filter((a) => !a.archived);
  const owed = accounts.filter((a) => isDebt(a.type)).reduce((sum, a) => sum + a.startingBalance, 0);
  const held = accounts.filter((a) => !isDebt(a.type)).reduce((sum, a) => sum + a.startingBalance, 0);
  const bills = data.recurring.filter((r) => r.active);
  const monthlyBills = bills.reduce((sum, r) => {
    const perYear = { day: 365, week: 52, month: 12, year: 1 }[r.frequency.unit] / Math.max(1, r.frequency.interval);
    return sum + Math.round((r.amount * perYear) / 12);
  }, 0);
  return { accounts: accounts.length, owed, held, bills: bills.length, monthlyBills, income: data.incomeSources.filter((s) => s.active).length };
}
