import { AppState } from 'react-native';
import { create } from 'zustand';

import { parseBackup } from '@/domain/backup';
import { isCategoryUsed } from '@/domain/categories';
import { RECURRING_KINDS } from '@/domain/catalog';
import { todayISO } from '@/domain/dates';
import { createId, emptyLedger, nowStamp } from '@/domain/factory';
import { balanceOn, indexLedger } from '@/domain/ledger';
import { claimAmountErrors } from '@/domain/policies';
import { buildSampleLedger } from '@/domain/sample';
import { expectedGross, openEvents } from '@/domain/schedule';
import type {
  Account,
  Asset,
  AssetValuation,
  Budget,
  BudgetMode,
  Category,
  Cents,
  DashboardWidgetId,
  FavoriteTransaction,
  Goal,
  GoalContribution,
  ID,
  IncomeSource,
  ISODate,
  ISOMonth,
  LedgerData,
  RecurringItem,
  Scenario,
  Iou,
  IouEntry,
  Policy,
  Settings,
  SinkingEntry,
  SinkingFund,
  TaxAdjustment,
  TaxDocument,
  TaxProfile,
  TaxYearRecord,
  MileageEntry,
  PaycheckWithholding,
  Transaction,
} from '@/domain/types';
import { hasErrors, validateAccount, validateContribution, validateRecurring, validateTransaction, type Errors } from '@/domain/validation';

import { loadLedgerText, saveLedgerText } from './storage';

/**
 * Single store for all financial data. Every mutation goes through an action
 * that validates, stamps and replaces only the collections it touches.
 * Changes are persisted locally (debounced) and never leave the device.
 */

type UndoEntry = { label: string; data: LedgerData };

interface LedgerState {
  data: LedgerData;
  hydrated: boolean;
  loadError: string | null;
  saveError: string | null;
  undo: UndoEntry | null;
}

export const useLedgerStore = create<LedgerState>(() => ({
  data: emptyLedger(),
  hydrated: false,
  loadError: null,
  saveError: null,
  undo: null,
}));

export type Result<T = ID> = { ok: true; id: T } | { ok: false; errors: Record<string, string> };

const ok = <T,>(id: T): Result<T> => ({ ok: true, id });
const fail = (errors: Errors<object> | Record<string, string>): Result<never> => ({ ok: false, errors: errors as Record<string, string> });

/**
 * Every commit records the previous snapshot, so `undo` always reverts the
 * most recent change and can never skip over (and silently discard) a later one.
 */
function commit(recipe: (d: LedgerData) => LedgerData, undoLabel = 'Change') {
  const prev = useLedgerStore.getState().data;
  const next = recipe(prev);
  next.meta = { ...next.meta, updatedAt: nowStamp() };
  useLedgerStore.setState({ data: next, undo: { label: undoLabel, data: prev } });
}

const get = () => useLedgerStore.getState().data;

function upsert<T extends { id: ID }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const copy = list.slice();
  copy[i] = item;
  return copy;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSaved: LedgerData | null = null;

async function flush() {
  const { data, hydrated } = useLedgerStore.getState();
  if (!hydrated || data === lastSaved) return;
  try {
    await saveLedgerText(JSON.stringify(data));
    lastSaved = data;
    if (useLedgerStore.getState().saveError) useLedgerStore.setState({ saveError: null });
  } catch (e) {
    useLedgerStore.setState({ saveError: e instanceof Error ? e.message : 'Could not save your data.' });
  }
}

let hydration: Promise<void> | null = null;

export function hydrateLedger() {
  hydration ??= hydrate();
  return hydration;
}

async function hydrate() {
  try {
    const text = await loadLedgerText();
    const data = text ? parseBackup(text, { keepOnboarding: true }).data : emptyLedger();
    lastSaved = data;
    useLedgerStore.setState({ data, hydrated: true });
  } catch (e) {
    // Never overwrite unreadable data: keep it on disk and start read-only-safe.
    useLedgerStore.setState({ hydrated: true, loadError: e instanceof Error ? e.message : 'Could not read saved data.' });
  }

  useLedgerStore.subscribe((state, prev) => {
    if (state.data === prev.data || state.loadError) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
  });
  AppState.addEventListener('change', (s) => {
    if (s !== 'active') void flush();
  });
}

// ─── Actions ─────────────────────────────────────────────────────────────────

function withTaxYear(d: LedgerData, year: number, fn: (r: TaxYearRecord) => TaxYearRecord): LedgerData {
  const existing = d.taxYears.find((r) => r.year === year) ?? { year, documents: [], adjustments: [], mileage: [] };
  return { ...d, taxYears: [...d.taxYears.filter((r) => r.year !== year), fn(existing)].sort((a, b) => a.year - b.year) };
}

export const ledger = {
  undo() {
    const entry = useLedgerStore.getState().undo;
    if (!entry) return;
    useLedgerStore.setState({ data: entry.data, undo: null });
  },

  // Transactions ──────────────────────────────────────────────────────────────
  saveTransaction(input: Omit<Transaction, 'createdAt' | 'updatedAt' | 'id'> & { id?: ID }): Result {
    const data = get();
    const existing = input.id ? data.transactions.find((t) => t.id === input.id) : undefined;
    const tx: Transaction = {
      ...input,
      id: existing?.id ?? createId('tx'),
      description: input.description.trim() || input.payee?.trim() || '',
      payee: input.payee?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      createdAt: existing?.createdAt ?? nowStamp(),
      updatedAt: nowStamp(),
    };
    // Transfer-like transactions don't carry spending flags.
    if (!['expense', 'refund', 'reimbursement', 'interest'].includes(tx.type)) delete tx.essential;
    const errors = validateTransaction(data, tx);
    if (hasErrors(errors)) return fail(errors);
    commit((d) => ({ ...d, transactions: upsert(d.transactions, tx) }));
    return ok(tx.id);
  },

  deleteTransaction(id: ID) {
    commit((d) => ({ ...d, transactions: d.transactions.filter((t) => t.id !== id) }), 'Transaction deleted');
  },

  duplicateTransaction(id: ID, date: ISODate): Result {
    const t = get().transactions.find((x) => x.id === id);
    if (!t) return fail({ form: 'Transaction not found.' });
    const { id: _id, createdAt: _c, updatedAt: _u, recurringId: _r, occurrenceDate: _o, ...rest } = t;
    return ledger.saveTransaction({ ...rest, date, attachments: [] });
  },

  /**
   * Files several transactions at once, from the tidy-up queue. One commit, so
   * accepting twenty suggestions is a single undo away from where you were.
   */
  categorizeTransactions(assignments: { id: ID; categoryId: ID }[]): Result<number> {
    const data = get();
    const wanted = new Map(assignments.map((a) => [a.id, a.categoryId]));
    const kinds = new Map(data.categories.map((c) => [c.id, c.kind]));
    let count = 0;
    const transactions = data.transactions.map((t) => {
      const categoryId = wanted.get(t.id);
      if (!categoryId || !kinds.has(categoryId)) return t;
      count += 1;
      return { ...t, categoryId, updatedAt: nowStamp() };
    });
    if (!count) return ok(0);
    commit((d) => ({ ...d, transactions }), count === 1 ? 'Category set' : `${count} categories set`);
    return ok(count);
  },

  saveFavorite(fav: Omit<FavoriteTransaction, 'id'> & { id?: ID }) {
    const same = get().favorites.find(
      (f) => f.id !== fav.id && f.type === fav.type && f.label === fav.label && f.amount === fav.amount && f.categoryId === fav.categoryId && f.accountId === fav.accountId && f.toAccountId === fav.toAccountId,
    );
    if (same) return ok(same.id);
    const item = { ...fav, id: fav.id ?? createId('fav') };
    commit((d) => ({ ...d, favorites: upsert(d.favorites, item) }));
    return ok(item.id);
  },

  deleteFavorite(id: ID) {
    commit((d) => ({ ...d, favorites: d.favorites.filter((f) => f.id !== id) }));
  },

  // Accounts ──────────────────────────────────────────────────────────────────
  saveAccount(input: Omit<Account, 'createdAt' | 'updatedAt' | 'id'> & { id?: ID }): Result {
    const existing = input.id ? get().accounts.find((a) => a.id === input.id) : undefined;
    const account: Account = { ...input, id: existing?.id ?? createId('acc'), name: input.name.trim(), createdAt: existing?.createdAt ?? nowStamp(), updatedAt: nowStamp() };
    const errors = validateAccount(account);
    if (hasErrors(errors)) return fail(errors);
    commit((d) => ({ ...d, accounts: upsert(d.accounts, account) }));
    return ok(account.id);
  },

  archiveAccount(id: ID, archived: boolean) {
    commit((d) => ({ ...d, accounts: d.accounts.map((a) => (a.id === id ? { ...a, archived, updatedAt: nowStamp() } : a)) }));
  },

  /** Deletes an account and every transaction that touches it. */
  deleteAccount(id: ID) {
    commit(
      (d) => ({
        ...d,
        accounts: d.accounts.filter((a) => a.id !== id),
        transactions: d.transactions.filter((t) => t.accountId !== id && t.toAccountId !== id),
        recurring: d.recurring.filter((r) => r.accountId !== id && r.toAccountId !== id),
        goalContributions: d.goalContributions.filter((c) => c.accountId !== id),
        goals: d.goals.map((g) => ({ ...g, linkedAccountIds: g.linkedAccountIds.filter((x) => x !== id) })),
        incomeSources: d.incomeSources.map((s) => (s.depositAccountId === id ? { ...s, active: false } : s)),
        favorites: d.favorites.filter((f) => f.accountId !== id && f.toAccountId !== id),
        assets: d.assets.map((a) => (a.linkedLiabilityId === id ? { ...a, linkedLiabilityId: undefined } : a)),
      }),
      'Account deleted',
    );
  },

  /**
   * Sets an account to a known balance by recording the difference as an
   * adjustment. Valuation adjustments are market moves on investments.
   */
  updateBalance(accountId: ID, newBalance: Cents, date: ISODate, kind: 'reconcile' | 'valuation' = 'reconcile', note?: string): Result<Cents> {
    const data = get();
    const account = data.accounts.find((a) => a.id === accountId);
    if (!account) return fail({ form: 'Account not found.' });
    const current = balanceOn(indexLedger(data), accountId, date);
    const delta = newBalance - current;
    if (delta === 0) return ok(0);
    const result = ledger.saveTransaction({
      type: 'adjustment',
      adjustmentKind: kind,
      amount: delta,
      date,
      description: kind === 'valuation' ? 'Market value update' : 'Balance update',
      accountId,
      notes: note,
      tags: [],
      attachments: [],
    });
    return result.ok ? ok(delta) : result;
  },

  // Categories & budgets ──────────────────────────────────────────────────────
  saveCategory(input: Omit<Category, 'id' | 'order'> & { id?: ID; order?: number }): Result {
    if (!input.name.trim()) return fail({ name: 'Name the category.' });
    const data = get();
    // Categories are two levels deep: a parent can't become a subcategory.
    if (input.parentId && input.id && data.categories.some((c) => c.parentId === input.id)) {
      return fail({ parentId: 'This category has subcategories, so it has to stay top-level.' });
    }
    if (input.parentId && data.categories.find((c) => c.id === input.parentId)?.parentId) {
      return fail({ parentId: 'Choose a top-level category as the parent.' });
    }
    const siblings = data.categories.filter((c) => c.parentId === input.parentId && c.kind === input.kind);
    const id = input.id ?? `${input.parentId ? `${input.parentId}.` : ''}custom_${createId('c').slice(2)}`;
    const cat: Category = { ...input, id, name: input.name.trim(), order: input.order ?? siblings.length };
    commit((d) => ({ ...d, categories: upsert(d.categories, cat) }));
    return ok(id);
  },

  archiveCategory(id: ID, archived: boolean) {
    commit((d) => ({ ...d, categories: d.categories.map((c) => (c.id === id || c.parentId === id ? { ...c, archived } : c)) }));
  },

  /** Deletes an unused category; used ones must be archived to keep history intact. */
  deleteCategory(id: ID): Result {
    const data = get();
    const family = [id, ...data.categories.filter((c) => c.parentId === id).map((c) => c.id)];
    if (family.some((c) => isCategoryUsed(data, c))) return fail({ form: 'This category has history. Archive it instead so past reports stay correct.' });
    commit((d) => ({ ...d, categories: d.categories.filter((c) => !family.includes(c.id)) }));
    return ok(id);
  },

  setBudget(categoryId: ID, amount: Cents, month: ISOMonth, mode: BudgetMode, rollover: boolean) {
    const existing = get().budgets.find((b) => b.categoryId === categoryId);
    const amounts = (existing?.amounts ?? []).filter((a) => a.month !== month);
    const budget: Budget = {
      id: existing?.id ?? createId('bud'),
      categoryId,
      mode,
      rollover,
      amounts: [...amounts, { month, amount }].sort((a, b) => (a.month < b.month ? -1 : 1)),
    };
    commit((d) => ({ ...d, budgets: upsert(d.budgets, budget) }));
    return ok(budget.id);
  },

  removeBudget(id: ID) {
    commit((d) => ({ ...d, budgets: d.budgets.filter((b) => b.id !== id) }), 'Budget removed');
  },

  // Recurring ─────────────────────────────────────────────────────────────────
  saveRecurring(input: Omit<RecurringItem, 'createdAt' | 'updatedAt' | 'id'> & { id?: ID }): Result {
    const existing = input.id ? get().recurring.find((r) => r.id === input.id) : undefined;
    const item: RecurringItem = { ...input, id: existing?.id ?? createId('rec'), name: input.name.trim(), createdAt: existing?.createdAt ?? nowStamp(), updatedAt: nowStamp() };
    if (item.kind === 'bill' || item.kind === 'subscription') delete item.toAccountId;
    const errors = validateRecurring(get(), item);
    if (hasErrors(errors)) return fail(errors);
    commit((d) => ({ ...d, recurring: upsert(d.recurring, item) }));
    return ok(item.id);
  },

  /** Removes the schedule; past payments stay as ordinary transactions. */
  deleteRecurring(id: ID) {
    commit(
      (d) => ({
        ...d,
        recurring: d.recurring.filter((r) => r.id !== id),
        transactions: d.transactions.map((t) => (t.recurringId === id ? { ...t, recurringId: undefined, occurrenceDate: undefined } : t)),
      }),
      'Recurring payment deleted',
    );
  },

  setOccurrenceSkipped(id: ID, date: ISODate, skipped: boolean) {
    commit((d) => ({
      ...d,
      recurring: d.recurring.map((r) =>
        r.id === id ? { ...r, skipped: skipped ? [...new Set([...r.skipped, date])] : r.skipped.filter((x) => x !== date), updatedAt: nowStamp() } : r,
      ),
    }));
  },

  /** Records a payment for a specific occurrence, linking the two. */
  payOccurrence(
    id: ID,
    occurrenceDate: ISODate,
    overrides: { amount?: Cents; date?: ISODate; accountId?: ID; categoryId?: ID; payee?: string; notes?: string } = {},
  ): Result {
    const r = get().recurring.find((x) => x.id === id);
    if (!r) return fail({ form: 'Recurring payment not found.' });
    return ledger.saveTransaction({
      type: RECURRING_KINDS[r.kind].txType,
      amount: overrides.amount ?? r.amount,
      date: overrides.date ?? occurrenceDate,
      description: r.name,
      payee: overrides.payee ?? r.payee,
      categoryId: overrides.categoryId ?? r.categoryId,
      notes: overrides.notes,
      accountId: overrides.accountId ?? r.accountId,
      toAccountId: r.toAccountId,
      essential: r.kind === 'bill' || r.kind === 'subscription' ? r.essential : undefined,
      recurringId: r.id,
      occurrenceDate,
      tags: r.tags,
      attachments: [],
    });
  },

  /**
   * Records every past-due autopay occurrence as paid on its due date. Used to
   * confirm charges that happened automatically at the bank.
   */
  confirmAutopay(today: ISODate): Result<number> {
    const due = openEvents(get(), today, today, 45).filter((e) => e.status === 'overdue' && e.autopay && e.source === 'recurring');
    let count = 0;
    const before = get();
    for (const e of due) {
      const r = ledger.payOccurrence(e.sourceId, e.date);
      if (r.ok) count++;
    }
    // Collapse into a single undo step.
    if (count) useLedgerStore.setState({ undo: { label: 'Autopay confirmed', data: before } });
    return ok(count);
  },

  // Income ────────────────────────────────────────────────────────────────────
  saveIncomeSource(input: Omit<IncomeSource, 'createdAt' | 'updatedAt' | 'id'> & { id?: ID }): Result {
    if (!input.name.trim()) return fail({ name: 'Name this income source.' });
    if (!get().accounts.some((a) => a.id === input.depositAccountId)) return fail({ depositAccountId: 'Choose the account it is deposited into.' });
    if (input.frequency && !input.anchorDate) return fail({ anchorDate: 'Add a recent or upcoming pay date.' });
    const existing = input.id ? get().incomeSources.find((s) => s.id === input.id) : undefined;
    const source: IncomeSource = { ...input, id: existing?.id ?? createId('inc'), name: input.name.trim(), createdAt: existing?.createdAt ?? nowStamp(), updatedAt: nowStamp() };
    commit((d) => ({ ...d, incomeSources: upsert(d.incomeSources, source) }));
    return ok(source.id);
  },

  deleteIncomeSource(id: ID) {
    commit(
      (d) => ({
        ...d,
        incomeSources: d.incomeSources.filter((s) => s.id !== id),
        transactions: d.transactions.map((t) => (t.incomeSourceId === id ? { ...t, incomeSourceId: undefined } : t)),
      }),
      'Income source deleted',
    );
  },

  recordPaycheck(sourceId: ID, input: { amount: Cents; date: ISODate; accountId?: ID; occurrenceDate?: ISODate; grossAmount?: Cents; withholding?: PaycheckWithholding; hours?: number; notes?: string }): Result {
    const s = get().incomeSources.find((x) => x.id === sourceId);
    if (!s) return fail({ form: 'Income source not found.' });
    return ledger.saveTransaction({
      type: 'income',
      amount: input.amount,
      date: input.date,
      description: s.type === 'salary' || s.type === 'hourly' ? 'Paycheck' : s.name,
      payee: s.employer ?? s.name,
      categoryId: s.categoryId,
      accountId: input.accountId ?? s.depositAccountId,
      incomeSourceId: s.id,
      occurrenceDate: input.occurrenceDate,
      grossAmount: input.grossAmount ?? expectedGross(s),
      withholding: input.withholding ?? s.withholding,
      hours: input.hours,
      notes: input.notes,
      tags: s.tags,
      attachments: [],
    });
  },

  // Goals ─────────────────────────────────────────────────────────────────────
  saveGoal(input: Omit<Goal, 'createdAt' | 'updatedAt' | 'id'> & { id?: ID }): Result {
    if (!input.name.trim()) return fail({ name: 'Name your goal.' });
    if (!(input.target > 0)) return fail({ target: 'Set a target amount.' });
    if ((input.kind === 'debt_payoff' || input.kind === 'investment') && input.linkedAccountIds.length === 0) {
      return fail({ linkedAccountIds: 'Choose at least one account to track.' });
    }
    const existing = input.id ? get().goals.find((g) => g.id === input.id) : undefined;
    const goal: Goal = { ...input, id: existing?.id ?? createId('goal'), name: input.name.trim(), createdAt: existing?.createdAt ?? nowStamp(), updatedAt: nowStamp() };
    commit((d) => ({ ...d, goals: upsert(d.goals, goal) }));
    return ok(goal.id);
  },

  deleteGoal(id: ID) {
    commit(
      (d) => ({ ...d, goals: d.goals.filter((g) => g.id !== id), goalContributions: d.goalContributions.filter((c) => c.goalId !== id) }),
      'Goal deleted',
    );
  },

  addContribution(input: Omit<GoalContribution, 'id' | 'createdAt'>): Result {
    const c: GoalContribution = { ...input, id: createId('gc'), createdAt: nowStamp() };
    const errors = validateContribution(get(), c, todayISO());
    if (hasErrors(errors)) return fail(errors);
    commit((d) => ({ ...d, goalContributions: [...d.goalContributions, c] }));
    return ok(c.id);
  },

  deleteContribution(id: ID) {
    commit((d) => ({ ...d, goalContributions: d.goalContributions.filter((c) => c.id !== id) }), 'Contribution removed');
  },

  // Assets ────────────────────────────────────────────────────────────────────
  saveAsset(input: Omit<Asset, 'createdAt' | 'updatedAt' | 'id'> & { id?: ID }): Result {
    if (!input.name.trim()) return fail({ name: 'Name this asset.' });
    if (!input.valuations.length) return fail({ valuations: 'Add an estimated value.' });
    const existing = input.id ? get().assets.find((a) => a.id === input.id) : undefined;
    const asset: Asset = { ...input, id: existing?.id ?? createId('asset'), name: input.name.trim(), createdAt: existing?.createdAt ?? nowStamp(), updatedAt: nowStamp() };
    commit((d) => ({ ...d, assets: upsert(d.assets, asset) }));
    return ok(asset.id);
  },

  deleteAsset(id: ID) {
    commit((d) => ({ ...d, assets: d.assets.filter((a) => a.id !== id) }), 'Asset deleted');
  },

  addValuation(assetId: ID, valuation: Omit<AssetValuation, 'id'>): Result {
    if (!(valuation.value >= 0)) return fail({ value: 'Enter a value.' });
    if (!get().assets.some((a) => a.id === assetId)) return fail({ form: 'Asset not found.' });
    const v = { ...valuation, id: createId('val') };
    // One value per day: a new valuation on the same date replaces the old one.
    commit((d) => ({
      ...d,
      assets: d.assets.map((a) =>
        a.id === assetId ? { ...a, valuations: [...a.valuations.filter((x) => x.date !== v.date), v].sort((x, y) => (x.date < y.date ? -1 : 1)), updatedAt: nowStamp() } : a,
      ),
    }));
    return ok(v.id);
  },

  deleteValuation(assetId: ID, valuationId: ID) {
    // An asset always keeps at least one value.
    if ((get().assets.find((a) => a.id === assetId)?.valuations.length ?? 0) <= 1) return;
    commit((d) => ({
      ...d,
      assets: d.assets.map((a) => (a.id === assetId ? { ...a, valuations: a.valuations.filter((v) => v.id !== valuationId) } : a)),
    }));
  },

  // Scenarios ─────────────────────────────────────────────────────────────────
  saveScenario(input: Omit<Scenario, 'createdAt' | 'updatedAt' | 'id'> & { id?: ID }): Result {
    if (!input.name.trim()) return fail({ name: 'Name this scenario.' });
    const existing = input.id ? get().scenarios.find((s) => s.id === input.id) : undefined;
    const s: Scenario = { ...input, id: existing?.id ?? createId('sc'), createdAt: existing?.createdAt ?? nowStamp(), updatedAt: nowStamp() };
    commit((d) => ({ ...d, scenarios: upsert(d.scenarios, s) }));
    return ok(s.id);
  },

  deleteScenario(id: ID) {
    commit((d) => ({ ...d, scenarios: d.scenarios.filter((s) => s.id !== id) }), 'Scenario deleted');
  },

  /** Quietly drops a scenario that was opened from an idea but never given a change. */
  discardEmptyScenario(id: ID) {
    const s = get().scenarios.find((x) => x.id === id);
    if (!s || s.changes.length > 0) return;
    const { undo } = useLedgerStore.getState();
    commit((d) => ({ ...d, scenarios: d.scenarios.filter((x) => x.id !== id) }));
    useLedgerStore.setState({ undo });
  },

  // Taxes ─────────────────────────────────────────────────────────────────────
  updateTaxProfile(patch: Partial<TaxProfile>) {
    commit((d) => ({ ...d, taxProfile: { ...d.taxProfile, ...patch, configured: true } }), 'Tax profile saved');
  },

  saveTaxDocument(year: number, doc: Omit<TaxDocument, 'key'> & { key?: string }): Result {
    if (!doc.form.trim()) return fail({ form: 'Name the form.' });
    const key = doc.key ?? createId('doc');
    commit((d) => withTaxYear(d, year, (r) => ({ ...r, documents: [...r.documents.filter((x) => x.key !== key), { ...doc, key, form: doc.form.trim() }] })));
    return { ok: true, id: key };
  },

  deleteTaxDocument(year: number, key: string) {
    commit((d) => withTaxYear(d, year, (r) => ({ ...r, documents: r.documents.filter((x) => x.key !== key) })), 'Document removed');
  },

  saveTaxAdjustment(year: number, input: Omit<TaxAdjustment, 'id'> & { id?: ID }): Result {
    if (!input.label.trim()) return fail({ label: 'Add a short label.' });
    if (!Number.isInteger(input.amount) || input.amount === 0) return fail({ amount: 'Enter an amount.' });
    if (input.kind !== 'capital_gain_long' && input.kind !== 'capital_gain_short' && input.amount < 0) return fail({ amount: 'Enter a positive amount.' });
    const id = input.id ?? createId('adj');
    commit((d) => withTaxYear(d, year, (r) => ({ ...r, adjustments: [...r.adjustments.filter((x) => x.id !== id), { ...input, id, label: input.label.trim() }] })), 'Saved');
    return { ok: true, id };
  },

  deleteTaxAdjustment(year: number, id: ID) {
    commit((d) => withTaxYear(d, year, (r) => ({ ...r, adjustments: r.adjustments.filter((x) => x.id !== id) })), 'Removed');
  },

  saveMileage(input: Omit<MileageEntry, 'id'> & { id?: ID }): Result {
    if (!(input.miles > 0) || !Number.isFinite(input.miles)) return fail({ miles: 'Enter the miles driven.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return fail({ date: 'Pick a date.' });
    const id = input.id ?? createId('mi');
    const year = Number(input.date.slice(0, 4));
    commit((d) => {
      // A date change can move the trip to another tax year.
      const cleared = { ...d, taxYears: d.taxYears.map((r) => ({ ...r, mileage: r.mileage.filter((m) => m.id !== id) })) };
      return withTaxYear(cleared, year, (r) => ({ ...r, mileage: [...r.mileage, { ...input, id }].sort((a, b) => (a.date < b.date ? -1 : 1)) }));
    }, 'Trip saved');
    return { ok: true, id };
  },

  deleteMileage(id: ID) {
    commit((d) => ({ ...d, taxYears: d.taxYears.map((r) => ({ ...r, mileage: r.mileage.filter((m) => m.id !== id) })) }), 'Trip deleted');
  },

  /** Confirms or dismisses a transaction's tax treatment without touching anything else. */
  setTransactionTax(ids: ID[], taxRelated: boolean, taxCategory?: string) {
    const set = new Set(ids);
    commit(
      (d) => ({
        ...d,
        transactions: d.transactions.map((t) => (set.has(t.id) ? { ...t, taxRelated, taxCategory: taxRelated ? (taxCategory ?? t.taxCategory) : undefined, updatedAt: nowStamp() } : t)),
      }),
      'Tax review',
    );
  },

  setTaxYearFiled(year: number, filedOn: ISODate | undefined) {
    commit((d) => withTaxYear(d, year, (r) => ({ ...r, filedOn })), filedOn ? 'Marked as filed' : undefined);
  },

  // Sinking funds ─────────────────────────────────────────────────────────────
  saveSinkingFund(input: Omit<SinkingFund, 'id' | 'entries' | 'createdAt' | 'updatedAt'> & { id?: ID; entries?: SinkingEntry[] }): Result {
    if (!input.name.trim()) return fail({ name: 'Name this fund.' });
    if (!Number.isInteger(input.yearlyTarget) || input.yearlyTarget <= 0) return fail({ yearlyTarget: 'Enter what it costs per year.' });
    if (!Number.isInteger(input.monthly) || input.monthly < 0) return fail({ monthly: 'Enter a monthly amount.' });
    const existing = input.id ? get().sinkingFunds.find((f) => f.id === input.id) : undefined;
    const fund: SinkingFund = {
      ...input,
      id: existing?.id ?? createId('sink'),
      name: input.name.trim(),
      entries: input.entries ?? existing?.entries ?? [],
      createdAt: existing?.createdAt ?? nowStamp(),
      updatedAt: nowStamp(),
    };
    commit((d) => ({ ...d, sinkingFunds: upsert(d.sinkingFunds, fund) }), existing ? 'Fund updated' : 'Fund added');
    return ok(fund.id);
  },

  deleteSinkingFund(id: ID) {
    commit((d) => ({ ...d, sinkingFunds: d.sinkingFunds.filter((f) => f.id !== id) }), 'Fund deleted');
  },

  /** Adds to a fund (positive) or spends from it (negative). */
  addSinkingEntry(fundId: ID, input: Omit<SinkingEntry, 'id'> & { id?: ID }): Result {
    const fund = get().sinkingFunds.find((f) => f.id === fundId);
    if (!fund) return fail({ form: 'Fund not found.' });
    if (!Number.isInteger(input.amount) || input.amount === 0) return fail({ amount: 'Enter an amount.' });
    const balance = fund.entries.reduce((sum, e) => sum + e.amount, 0);
    if (input.amount < 0 && -input.amount > balance) return fail({ amount: 'That is more than this fund holds.' });
    const entry: SinkingEntry = { ...input, id: input.id ?? createId('se') };
    commit(
      (d) => ({ ...d, sinkingFunds: d.sinkingFunds.map((f) => (f.id === fundId ? { ...f, entries: [...f.entries.filter((e) => e.id !== entry.id), entry], updatedAt: nowStamp() } : f)) }),
      input.amount > 0 ? 'Money set aside' : 'Money used',
    );
    return ok(entry.id);
  },

  deleteSinkingEntry(fundId: ID, entryId: ID) {
    commit((d) => ({ ...d, sinkingFunds: d.sinkingFunds.map((f) => (f.id === fundId ? { ...f, entries: f.entries.filter((e) => e.id !== entryId), updatedAt: nowStamp() } : f)) }), 'Entry removed');
  },

  // Policies & warranties ──────────────────────────────────────────────────────
  savePolicy(input: Omit<Policy, 'id' | 'claims' | 'documents' | 'createdAt' | 'updatedAt'> & { id?: ID; claims?: Policy['claims']; documents?: Policy['documents'] }): Result {
    if (!input.name.trim()) return fail({ name: 'Name this policy.' });
    if (input.renewalDate && input.startDate && input.renewalDate < input.startDate) return fail({ renewalDate: 'Renewal is before the start date.' });
    if (input.linkedAssetId && !get().assets.some((a) => a.id === input.linkedAssetId)) return fail({ linkedAssetId: 'That item no longer exists.' });
    const existing = input.id ? get().policies.find((x) => x.id === input.id) : undefined;
    const policy: Policy = {
      ...input,
      id: existing?.id ?? createId('pol'),
      name: input.name.trim(),
      claims: input.claims ?? existing?.claims ?? [],
      documents: input.documents ?? existing?.documents ?? [],
      createdAt: existing?.createdAt ?? nowStamp(),
      updatedAt: nowStamp(),
    };
    commit((d) => ({ ...d, policies: upsert(d.policies, policy) }), existing ? 'Policy updated' : 'Policy added');
    return ok(policy.id);
  },

  deletePolicy(id: ID) {
    commit((d) => ({ ...d, policies: d.policies.filter((x) => x.id !== id) }), 'Policy deleted');
  },

  savePolicyClaim(policyId: ID, input: Omit<Policy['claims'][number], 'id'> & { id?: ID }): Result {
    if (!input.description.trim()) return fail({ description: 'Describe the claim.' });
    const amountErrors = claimAmountErrors(input);
    if (amountErrors) return fail(amountErrors);
    const claim = { ...input, id: input.id ?? createId('clm'), description: input.description.trim() };
    const found = get().policies.some((x) => x.id === policyId);
    if (!found) return fail({ form: 'Policy not found.' });
    commit((d) => ({ ...d, policies: d.policies.map((x) => (x.id === policyId ? { ...x, claims: [...x.claims.filter((c) => c.id !== claim.id), claim], updatedAt: nowStamp() } : x)) }), 'Claim saved');
    return ok(claim.id);
  },

  deletePolicyClaim(policyId: ID, claimId: ID) {
    commit((d) => ({ ...d, policies: d.policies.map((x) => (x.id === policyId ? { ...x, claims: x.claims.filter((c) => c.id !== claimId), updatedAt: nowStamp() } : x)) }), 'Claim removed');
  },

  // IOUs ───────────────────────────────────────────────────────────────────────
  saveIou(input: Omit<Iou, 'id' | 'entries' | 'createdAt' | 'updatedAt'> & { id?: ID; entries?: IouEntry[] }): Result {
    if (!input.person.trim()) return fail({ person: 'Who is it with?' });
    if (!Number.isInteger(input.amount) || input.amount <= 0) return fail({ amount: 'Enter the amount.' });
    const existing = input.id ? get().ious.find((x) => x.id === input.id) : undefined;
    const iou: Iou = {
      ...input,
      id: existing?.id ?? createId('iou'),
      person: input.person.trim(),
      entries: input.entries ?? existing?.entries ?? [],
      createdAt: existing?.createdAt ?? nowStamp(),
      updatedAt: nowStamp(),
    };
    commit((d) => ({ ...d, ious: upsert(d.ious, iou) }), existing ? 'IOU updated' : 'IOU added');
    return ok(iou.id);
  },

  deleteIou(id: ID) {
    commit((d) => ({ ...d, ious: d.ious.filter((x) => x.id !== id) }), 'IOU deleted');
  },

  /** Records a repayment. Settles the IOU once nothing is outstanding. */
  addIouEntry(iouId: ID, input: Omit<IouEntry, 'id'> & { id?: ID }): Result {
    const iou = get().ious.find((x) => x.id === iouId);
    if (!iou) return fail({ form: 'IOU not found.' });
    if (!Number.isInteger(input.amount) || input.amount <= 0) return fail({ amount: 'Enter an amount.' });
    const paid = iou.entries.reduce((sum, e) => sum + e.amount, 0);
    if (paid + input.amount > iou.amount) return fail({ amount: 'That is more than is outstanding.' });
    const entry: IouEntry = { ...input, id: input.id ?? createId('ie') };
    commit(
      (d) => ({
        ...d,
        ious: d.ious.map((x) => {
          if (x.id !== iouId) return x;
          const entries = [...x.entries.filter((e) => e.id !== entry.id), entry];
          const total = entries.reduce((sum, e) => sum + e.amount, 0);
          return { ...x, entries, settledOn: total >= x.amount ? entry.date : undefined, updatedAt: nowStamp() };
        }),
      }),
      'Repayment recorded',
    );
    return ok(entry.id);
  },

  deleteIouEntry(iouId: ID, entryId: ID) {
    commit(
      (d) => ({
        ...d,
        ious: d.ious.map((x) => {
          if (x.id !== iouId) return x;
          const entries = x.entries.filter((e) => e.id !== entryId);
          const total = entries.reduce((sum, e) => sum + e.amount, 0);
          return { ...x, entries, settledOn: total >= x.amount ? x.settledOn : undefined, updatedAt: nowStamp() };
        }),
      }),
      'Repayment removed',
    );
  },

  // Imports & medical reimbursements ───────────────────────────────────────────
  /** Adds many transactions at once (CSV import). Invalid rows are reported, not saved. */
  importTransactions(rows: (Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> & { id?: ID })[]): { added: number; errors: { row: number; message: string }[] } {
    const errors: { row: number; message: string }[] = [];
    const stamp = nowStamp();
    const prepared: Transaction[] = [];
    const data = get();
    for (const [i, row] of rows.entries()) {
      const tx: Transaction = { ...row, id: row.id ?? createId('tx'), createdAt: stamp, updatedAt: stamp };
      const rowErrors = validateTransaction({ ...data, transactions: [...data.transactions, ...prepared] }, tx);
      if (hasErrors(rowErrors)) errors.push({ row: i, message: Object.values(rowErrors)[0] as string });
      else prepared.push(tx);
    }
    if (prepared.length) commit((d) => ({ ...d, transactions: [...d.transactions, ...prepared] }), 'Imported ' + prepared.length + ' transactions');
    return { added: prepared.length, errors };
  },

  /** Flags out-of-pocket medical spending you can reimburse from an HSA/FSA later. */
  setReimbursable(ids: ID[], source: 'hsa' | 'fsa' | undefined, reimbursedOn?: ISODate) {
    const set = new Set(ids);
    commit(
      (d) => ({
        ...d,
        transactions: d.transactions.map((t) => (set.has(t.id) ? { ...t, reimbursableFrom: source, reimbursedOn: source ? reimbursedOn : undefined, updatedAt: nowStamp() } : t)),
      }),
      'Reimbursement updated',
    );
  },

  // Settings & data ───────────────────────────────────────────────────────────
  updateSettings(patch: Partial<Settings>) {
    commit((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  },

  /** Stops a detected charge being offered as a bill again. */
  ignoreRecurringSuggestion(key: string) {
    commit((d) => ({ ...d, settings: { ...d.settings, ignoredRecurring: [...new Set([...(d.settings.ignoredRecurring ?? []), key])] } }), 'Suggestion dismissed');
  },

  /** Offers every dismissed charge again. */
  clearIgnoredRecurring() {
    commit((d) => ({ ...d, settings: { ...d.settings, ignoredRecurring: [] } }), 'Dismissed suggestions restored');
  },

  setDashboard(order: DashboardWidgetId[], hidden: DashboardWidgetId[]) {
    commit((d) => ({ ...d, settings: { ...d.settings, dashboard: { order, hidden } } }));
  },

  completeOnboarding() {
    commit((d) => ({ ...d, meta: { ...d.meta, onboarded: true } }));
  },

  loadSampleData() {
    const sample = buildSampleLedger(todayISO());
    commit(() => ({ ...sample, settings: { ...sample.settings, ...get().settings, dashboard: get().settings.dashboard } }), 'Sample data loaded');
  },

  /** Wipes all financial data, keeping preferences. */
  eraseAllData() {
    const settings = get().settings;
    const fresh = emptyLedger();
    commit(() => ({ ...fresh, settings, meta: { ...fresh.meta, onboarded: true } }), 'All data erased');
  },

  replaceAllData(data: LedgerData) {
    commit(() => data, 'Backup restored');
  },
};

export const getLedger = get;
