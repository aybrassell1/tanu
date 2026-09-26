import { TRANSACTION_TYPES } from './catalog';
import { categoryPath } from './categories';
import { todayISO } from './dates';
import { buildDefaultCategories, LEGACY_CATEGORY_MAP } from './defaultCategories';
import { createId, defaultSettings, defaultTaxProfile, emptyLedger, SCHEMA_VERSION } from './factory';
import { indexLedger } from './ledger';
import { centsToInput } from './money';
import type { LedgerData } from './types';

/**
 * Backups are plain JSON so data is never trapped in the app. Imports are
 * validated, migrated to the current schema and checked for broken links
 * before anything replaces existing data.
 */

export const BACKUP_FORMAT = 'tanu-backup';

/** The app was called MasterFinance before; those backups still restore. */
const LEGACY_FORMATS = ['masterfinance-backup'];
const isBackupFile = (format: unknown) => format === BACKUP_FORMAT || LEGACY_FORMATS.includes(format as string);

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  data: LedgerData;
}

export function serializeBackup(data: LedgerData): string {
  const file: BackupFile = { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data };
  return JSON.stringify(file, null, 2);
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Named for the user's own calendar date and clock, not UTC: a backup taken on
 * the evening of the 17th must not be filed under the 18th.
 */
export function backupFileName(now = new Date()) {
  return `tanu-backup-${todayISO(now)}-${pad(now.getHours())}-${pad(now.getMinutes())}.json`;
}

/** Local-date filename for the transactions CSV export. */
export function transactionsFileName(now = new Date()) {
  return `tanu-transactions-${todayISO(now)}.csv`;
}

export interface ImportResult {
  data: LedgerData;
  warnings: string[];
  counts: Record<string, number>;
}

const ARRAYS = [
  'accounts',
  'categories',
  'budgets',
  'transactions',
  'favorites',
  'recurring',
  'incomeSources',
  'goals',
  'goalContributions',
  'assets',
  'scenarios',
  'taxYears',
  'sinkingFunds',
  'policies',
  'ious',
] as const;

/** Upgrades older snapshots. Add a step per schema bump. */
export function migrate(data: LedgerData): LedgerData {
  const version = data.meta?.schemaVersion ?? 1;
  if (version > SCHEMA_VERSION) {
    throw new Error('This backup was made by a newer version of the app.');
  }
  let out = data;
  if (version < 2) out = migrateToV2(out);
  if (version < 3) out = migrateToV3(out);
  if (version < 4) out = migrateToV4(out);
  if (version < 5) out = migrateToV5(out);
  if (version < 6) out = migrateToV6(out);
  return { ...out, meta: { ...out.meta, schemaVersion: SCHEMA_VERSION } };
}

/** v6: banks you can connect, so transactions arrive on their own. */
function migrateToV6(data: LedgerData): LedgerData {
  return { ...data, connections: Array.isArray(data.connections) ? data.connections : [] };
}

type LegacyPlace = {
  parking?: number; petRent?: number; otherMonthly?: number; utilitiesEstimate?: number; insurance?: number;
  deposit?: number; applicationFee?: number; adminFee?: number; petDeposit?: number;
};

/** v5: a place's costs became a named list, and you can add your own questions. */
function migrateToV5(data: LedgerData): LedgerData {
  const named: [keyof LegacyPlace, string, 'monthly' | 'upfront', boolean?][] = [
    ['utilitiesEstimate', 'Utilities', 'monthly', true],
    ['parking', 'Parking', 'monthly'],
    ['petRent', 'Pet rent', 'monthly'],
    ['otherMonthly', 'Monthly fees', 'monthly'],
    ['insurance', "Renter's insurance", 'monthly'],
    ['deposit', 'Security deposit', 'upfront'],
    ['adminFee', 'Admin fee', 'upfront'],
    ['applicationFee', 'Application fee', 'upfront'],
    ['petDeposit', 'Pet deposit', 'upfront'],
  ];
  return {
    ...data,
    tourQuestions: Array.isArray(data.tourQuestions) ? data.tourQuestions : [],
    places: (Array.isArray(data.places) ? data.places : []).map((place) => {
      if (Array.isArray(place.fees)) return place;
      const old = place as unknown as LegacyPlace;
      const fees = named
        .filter(([key]) => (old[key] ?? 0) > 0)
        .map(([key, label, when, utility]) => ({ id: createId('fee'), label, amount: old[key] as number, when, ...(utility ? { utility: true } : {}) }));
      return { ...place, fees };
    }),
  };
}

/** v4: places you tour while apartment hunting. */
function migrateToV4(data: LedgerData): LedgerData {
  return { ...data, places: Array.isArray(data.places) ? data.places : [] };
}

/** v3: split transactions, sinking funds, policies, IOUs, lock and reminders. */
function migrateToV3(data: LedgerData): LedgerData {
  const defaults = defaultSettings();
  return {
    ...data,
    sinkingFunds: Array.isArray(data.sinkingFunds) ? data.sinkingFunds : [],
    policies: Array.isArray(data.policies) ? data.policies : [],
    ious: Array.isArray(data.ious) ? data.ious : [],
    settings: { ...data.settings, security: { ...defaults.security, ...data.settings?.security }, notifications: { ...defaults.notifications, ...data.settings?.notifications } },
  };
}

const LEGACY_TAX_TEXT: Record<string, string> = {
  'charitable contribution': 'charitable',
  'hsa eligible': 'hsa_eligible',
  medical: 'medical',
  business: 'business',
};

/**
 * v2: expanded category taxonomy with tax meaning, taxes profile and records.
 * Moved categories are remapped everywhere they are referenced, and custom
 * categories and user renames are kept.
 */
function migrateToV2(data: LedgerData): LedgerData {
  const defaults = buildDefaultCategories();
  const defaultsById = new Map(defaults.map((c) => [c.id, c]));
  const remap = (id: string | undefined) => (id && LEGACY_CATEGORY_MAP[id] ? LEGACY_CATEGORY_MAP[id] : id);

  const existing = data.categories
    .filter((c) => !LEGACY_CATEGORY_MAP[c.id])
    .map((c) => {
      const d = defaultsById.get(c.id);
      return d ? { ...c, taxTag: c.taxTag ?? d.taxTag, incomeTax: c.incomeTax ?? d.incomeTax } : c;
    });
  const have = new Set(existing.map((c) => c.id));
  const categories = [...existing, ...defaults.filter((d) => !have.has(d.id))];

  return {
    ...data,
    taxProfile: { ...defaultTaxProfile(), ...data.taxProfile },
    taxYears: Array.isArray(data.taxYears) ? data.taxYears : [],
    categories,
    transactions: data.transactions.map((t) => {
      const legacyTax = t.taxCategory ? LEGACY_TAX_TEXT[t.taxCategory.toLowerCase()] : undefined;
      return { ...t, categoryId: remap(t.categoryId), ...(legacyTax ? { taxCategory: legacyTax } : {}) };
    }),
    recurring: data.recurring.map((r) => ({ ...r, categoryId: remap(r.categoryId) })),
    incomeSources: data.incomeSources.map((s) => ({ ...s, categoryId: remap(s.categoryId) })),
    favorites: data.favorites.map((f) => ({ ...f, categoryId: remap(f.categoryId) })),
    budgets: data.budgets.map((b) => ({ ...b, categoryId: remap(b.categoryId)! })),
  };
}

export function parseBackup(text: string, options: { keepOnboarding?: boolean } = {}): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const file = parsed as Partial<BackupFile>;
  if (isBackupFile(file?.format) && typeof file.schemaVersion === 'number' && file.schemaVersion > SCHEMA_VERSION) {
    throw new Error('This backup was made by a newer version of the app.');
  }
  const raw = (isBackupFile(file?.format) ? file.data : parsed) as Partial<LedgerData> | undefined;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.accounts) || !Array.isArray(raw.transactions)) {
    throw new Error("That file doesn't look like a Tanu backup.");
  }

  const base = emptyLedger();
  const data: LedgerData = {
    ...base,
    ...raw,
    // Restoring a backup counts as onboarding; loading saved app data keeps its flag.
    meta: { ...base.meta, ...raw.meta, onboarded: options.keepOnboarding ? raw.meta?.onboarded ?? true : true },
    settings: {
      ...defaultSettings(),
      ...raw.settings,
      security: { ...defaultSettings().security, ...raw.settings?.security },
      notifications: { ...defaultSettings().notifications, ...raw.settings?.notifications },
      dashboard: { ...defaultSettings().dashboard, ...raw.settings?.dashboard },
    },
    taxProfile: { ...defaultTaxProfile(), ...raw.taxProfile },
  } as LedgerData;
  for (const key of ARRAYS) {
    if (!Array.isArray(data[key])) (data as unknown as Record<string, unknown[]>)[key] = key === 'categories' ? base.categories : [];
  }
  normalizeRecords(data);
  const migrated = migrate(data);
  return { data: migrated, warnings: integrityWarnings(migrated), counts: countRecords(migrated) };
}

/** Fills list fields that older or hand-edited files may omit. */
function normalizeRecords(data: LedgerData) {
  const list = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);
  data.transactions = data.transactions.map((t) => ({ ...t, tags: list(t.tags), attachments: list(t.attachments) }));
  data.accounts = data.accounts.map((a) => ({ ...a, tags: list(a.tags) }));
  data.recurring = data.recurring.map((r) => ({ ...r, tags: list(r.tags), skipped: list(r.skipped) }));
  data.incomeSources = data.incomeSources.map((s) => ({ ...s, tags: list(s.tags) }));
  data.goals = data.goals.map((g) => ({ ...g, tags: list(g.tags), linkedAccountIds: list(g.linkedAccountIds) }));
  data.assets = data.assets.map((a) => ({ ...a, tags: list(a.tags), valuations: list(a.valuations) }));
  data.favorites = data.favorites.map((f) => ({ ...f, tags: list(f.tags) }));
  data.scenarios = data.scenarios.map((s) => ({ ...s, changes: list(s.changes) }));
  data.budgets = data.budgets.map((b) => ({ ...b, amounts: list(b.amounts) }));
}

export function countRecords(data: LedgerData): Record<string, number> {
  return Object.fromEntries(ARRAYS.map((k) => [k, data[k].length]));
}

/** Broken references that would make balances or reports wrong. */
export function integrityWarnings(data: LedgerData): string[] {
  const index = indexLedger(data);
  const warnings: string[] = [];
  const ids = new Set<string>();
  let dupes = 0;
  for (const t of data.transactions) {
    if (ids.has(t.id)) dupes++;
    ids.add(t.id);
  }
  if (dupes) warnings.push(`${dupes} transactions share an id with another transaction.`);
  const orphanTx = data.transactions.filter((t) => !index.accounts.has(t.accountId) || (t.toAccountId && !index.accounts.has(t.toAccountId)));
  if (orphanTx.length) warnings.push(`${orphanTx.length} transactions point to accounts that don't exist.`);
  const badType = data.transactions.filter((t) => !(t.type in TRANSACTION_TYPES));
  if (badType.length) warnings.push(`${badType.length} transactions have an unknown type.`);
  const badAmount = data.transactions.filter((t) => !Number.isInteger(t.amount));
  if (badAmount.length) warnings.push(`${badAmount.length} transactions have non-cent amounts.`);
  const orphanRec = data.recurring.filter((r) => !index.accounts.has(r.accountId));
  if (orphanRec.length) warnings.push(`${orphanRec.length} recurring payments point to missing accounts.`);
  const orphanContrib = data.goalContributions.filter((c) => !data.goals.some((g) => g.id === c.goalId));
  if (orphanContrib.length) warnings.push(`${orphanContrib.length} goal contributions belong to missing goals.`);
  return warnings;
}

const csvCell = (value: string | number | undefined) => {
  const s = value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function transactionsCsv(data: LedgerData): string {
  const index = indexLedger(data);
  const header = ['Date', 'Type', 'Amount', 'Description', 'Payee', 'Category', 'Account', 'To account', 'Essential', 'Tax related', 'Tags', 'Notes'];
  const rows = index.sorted.map((t) => [
    t.date,
    TRANSACTION_TYPES[t.type].label,
    centsToInput(t.amount),
    t.description,
    t.payee,
    t.categoryId ? categoryPath(index.categories, t.categoryId) : '',
    index.accounts.get(t.accountId)?.name,
    t.toAccountId ? index.accounts.get(t.toAccountId)?.name : '',
    t.essential === undefined ? '' : t.essential ? 'Yes' : 'No',
    t.taxRelated ? 'Yes' : '',
    t.tags.map((x) => `#${x}`).join(' '),
    t.notes,
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}
