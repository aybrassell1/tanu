import { categoryPath } from './categories';
import { addDays, addMonthsToMonth, monthEnd, monthOf, monthStart } from './dates';
import { categoryIdsOf, categoryLines, indexLedger, spendingAmount, TRANSFER_TYPES } from './ledger';
import { centsToInput } from './money';
import type { Cents, ID, ISODate, LedgerData, Transaction, TransactionType } from './types';

export type DatePreset = 'month' | 'last_month' | '30' | '90' | 'year' | 'all' | 'custom';

export interface TransactionFilters {
  query: string;
  preset: DatePreset;
  from?: ISODate;
  to?: ISODate;
  types: TransactionType[];
  accountIds: ID[];
  categoryIds: ID[];
  tags: string[];
  min?: Cents;
  max?: Cents;
  recurring: 'any' | 'yes' | 'no';
  essential: 'any' | 'essential' | 'discretionary';
  taxOnly: boolean;
  receiptsOnly: boolean;
}

export type TransactionSort = 'newest' | 'oldest' | 'largest' | 'smallest';

export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
];

// Optional keys are listed explicitly so spreading this over existing filters clears them.
export const emptyFilters = (): TransactionFilters => ({
  query: '',
  preset: 'all',
  from: undefined,
  to: undefined,
  min: undefined,
  max: undefined,
  types: [],
  accountIds: [],
  categoryIds: [],
  tags: [],
  recurring: 'any',
  essential: 'any',
  taxOnly: false,
  receiptsOnly: false,
});

export function presetRange(preset: DatePreset, today: ISODate, custom?: { from?: ISODate; to?: ISODate }): { from?: ISODate; to?: ISODate } {
  const month = monthOf(today);
  switch (preset) {
    case 'month':
      return { from: monthStart(month), to: monthEnd(month) };
    case 'last_month': {
      const m = addMonthsToMonth(month, -1);
      return { from: monthStart(m), to: monthEnd(m) };
    }
    case '30':
      return { from: addDays(today, -29), to: today };
    case '90':
      return { from: addDays(today, -89), to: today };
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case 'all':
      return {};
    case 'custom':
      return { from: custom?.from, to: custom?.to };
  }
}

/** Number of non-default filters, for the filter button badge (query and date excluded). */
export function activeFilterCount(f: TransactionFilters) {
  return (
    (f.types.length ? 1 : 0) +
    (f.accountIds.length ? 1 : 0) +
    (f.categoryIds.length ? 1 : 0) +
    (f.tags.length ? 1 : 0) +
    (f.min !== undefined || f.max !== undefined ? 1 : 0) +
    (f.recurring !== 'any' ? 1 : 0) +
    (f.essential !== 'any' ? 1 : 0) +
    (f.taxOnly ? 1 : 0) +
    (f.receiptsOnly ? 1 : 0)
  );
}

export function filterTransactions(data: LedgerData, f: TransactionFilters, today: ISODate, sort: TransactionSort = 'newest'): Transaction[] {
  const index = indexLedger(data);
  const { from, to } = presetRange(f.preset, today, f);
  const q = f.query.trim().toLowerCase();
  const tagQuery = q.startsWith('#') ? q.slice(1) : null;
  const amountQuery = /^[\d.,$]+$/.test(q) ? q.replace(/[$,]/g, '') : null;

  const categories = expandCategoryIds(data, f.categoryIds);

  const out = index.sorted.filter((t) => {
    if (from && t.date < from) return false;
    if (to && t.date > to) return false;
    if (f.types.length && !f.types.includes(t.type)) return false;
    if (f.accountIds.length && !f.accountIds.includes(t.accountId) && !(t.toAccountId && f.accountIds.includes(t.toAccountId))) return false;
    if (categories.size && !categoryIdsOf(t).some((id) => categories.has(id))) return false;
    if (f.tags.length && !f.tags.every((tag) => t.tags.includes(tag))) return false;
    const abs = Math.abs(t.amount);
    if (f.min !== undefined && abs < f.min) return false;
    if (f.max !== undefined && abs > f.max) return false;
    if (f.recurring === 'yes' && !t.recurringId) return false;
    if (f.recurring === 'no' && t.recurringId) return false;
    if (f.essential !== 'any') {
      if (!spendingAmount(t)) return false;
      const essential = t.essential ?? index.categories.get(t.categoryId ?? '')?.essential ?? false;
      if ((f.essential === 'essential') !== essential) return false;
    }
    if (f.taxOnly && !t.taxRelated) return false;
    if (f.receiptsOnly && t.attachments.length === 0) return false;
    if (q) {
      if (tagQuery !== null) return t.tags.some((tag) => tag.startsWith(tagQuery));
      const haystack = [t.description, t.payee, t.notes, ...categoryIdsOf(t).map((id) => categoryPath(index.categories, id)), index.accounts.get(t.accountId)?.name, t.tags.join(' ')]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q) && !(amountQuery && centsToInput(abs).startsWith(amountQuery))) return false;
    }
    return true;
  });

  switch (sort) {
    case 'oldest':
      return out.reverse();
    case 'largest':
      return out.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    case 'smallest':
      return out.sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount));
    default:
      return out;
  }
}

/** Totals for a filtered list; transfers are counted separately, never as in/out. */
/** Selecting a top-level category includes its subcategories. */
export function expandCategoryIds(data: LedgerData, ids: ID[]): Set<ID> {
  const out = new Set<ID>();
  for (const id of ids) {
    out.add(id);
    for (const c of data.categories) if (c.parentId === id) out.add(c.id);
  }
  return out;
}

/**
 * Totals for a filtered list. Under a category filter only the matching lines
 * of a split purchase count, so the total matches what was actually filtered.
 */
export function filteredTotals(list: Transaction[], categories?: Set<ID>) {
  let income = 0;
  let spending = 0;
  let moved = 0;
  for (const t of list) {
    if (t.type === 'income') income += t.amount;
    if (categories?.size) {
      for (const line of categoryLines(t)) if (line.categoryId && categories.has(line.categoryId)) spending += line.amount;
    } else {
      spending += spendingAmount(t);
    }
    if (TRANSFER_TYPES.includes(t.type)) moved += t.amount;
  }
  return { income, spending, moved, count: list.length };
}
