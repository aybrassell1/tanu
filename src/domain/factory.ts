import { buildDefaultCategories } from './defaultCategories';
import type { DashboardWidgetId, ID, LedgerData, Settings, TaxProfile } from './types';

export const SCHEMA_VERSION = 5;

let counter = 0;

/** Collision-resistant local id; no crypto dependency needed for a single device. */
export function createId(prefix = 'id'): ID {
  counter = (counter + 1) % 1_679_616;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(4, '0')}${Math.random().toString(36).slice(2, 7)}`;
}

export const nowStamp = () => new Date().toISOString();

export const DEFAULT_DASHBOARD: DashboardWidgetId[] = [
  'overview',
  'alerts',
  'health',
  'upcoming',
  'cashflow',
  'cash',
  'netWorth',
  'debt',
  'goals',
  'budgets',
  'investments',
  'forecast',
  'recent',
];

export function defaultSettings(): Settings {
  return {
    currency: 'USD',
    weekStartsOn: 0,
    spendingBuffer: 0,
    investmentReturn: 5,
    theme: 'system',
    hideAmounts: false,
    security: { lock: false, lockAfterMinutes: 5 },
    notifications: { enabled: false, billsDaysBefore: 2, hour: 9, paydays: false, weeklyReview: false },
    dashboard: { order: [...DEFAULT_DASHBOARD], hidden: [] },
  };
}

export function defaultTaxProfile(): TaxProfile {
  return {
    filingStatus: 'single',
    dependentsUnder17: 0,
    otherDependents: 0,
    seniors: 0,
    age50Plus: false,
    hsaCoverage: 'none',
    stateRate: 0,
    deduction: 'auto',
    carLoanQualifies: false,
    configured: false,
  };
}

export function emptyLedger(): LedgerData {
  const now = nowStamp();
  return {
    meta: { schemaVersion: SCHEMA_VERSION, isSample: false, onboarded: false, createdAt: now, updatedAt: now },
    settings: defaultSettings(),
    taxProfile: defaultTaxProfile(),
    taxYears: [],
    accounts: [],
    categories: buildDefaultCategories(),
    budgets: [],
    transactions: [],
    favorites: [],
    recurring: [],
    incomeSources: [],
    goals: [],
    goalContributions: [],
    sinkingFunds: [],
    policies: [],
    ious: [],
    assets: [],
    scenarios: [],
    places: [],
    tourQuestions: [],
  };
}
