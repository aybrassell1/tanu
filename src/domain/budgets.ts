import { categoryFamily } from './categories';
import { addMonthsToMonth, monthEnd, monthStart, minDate } from './dates';
import { categoryLines, indexLedger, spendingAmount } from './ledger';
import { occurrencesBetween } from './recurrence';
import type { Budget, Category, Cents, ISODate, ISOMonth, LedgerData } from './types';

export type BudgetState = 'ok' | 'approaching' | 'over' | 'unbudgeted';

export interface BudgetLine {
  budget: Budget;
  category: Category;
  /** Budgeted for the month, including rollover. */
  amount: Cents;
  base: Cents;
  rollover: Cents;
  spent: Cents;
  /** Recurring charges scheduled in this category during the month. */
  planned: Cents;
  remaining: Cents;
  ratio: number;
  state: BudgetState;
}

export const APPROACHING_RATIO = 0.8;

export function budgetAmountFor(budget: Budget, month: ISOMonth): Cents | null {
  let match: { month: ISOMonth; amount: Cents } | null = null;
  for (const entry of budget.amounts) {
    if (entry.month <= month && (!match || entry.month >= match.month)) match = entry;
  }
  return match?.amount ?? null;
}

function spentIn(data: LedgerData, ids: Set<string>, from: ISODate, to: ISODate) {
  let total = 0;
  for (const t of data.transactions) {
    if (t.date < from || t.date > to) continue;
    for (const line of categoryLines(t)) if (line.categoryId && ids.has(line.categoryId)) total += line.amount;
  }
  return total;
}

function plannedIn(data: LedgerData, ids: Set<string>, from: ISODate, to: ISODate) {
  let total = 0;
  for (const r of data.recurring) {
    if (!r.active || !r.categoryId || !ids.has(r.categoryId)) continue;
    total += r.amount * occurrencesBetween(r.startDate, r.frequency, from, to, r.endDate).length;
  }
  return total;
}

/** Spending in a category and its subcategories during [from, to]. */
export function categorySpent(data: LedgerData, categoryId: string, from: ISODate, to: ISODate): Cents {
  return spentIn(data, categoryFamily(data, categoryId), from, to);
}

/**
 * Budget nesting problems for a proposed amount: a subcategory budget larger
 * than its parent's, or subcategory budgets adding up to more than the parent.
 */
export function budgetNestingWarning(data: LedgerData, categoryId: string, amount: Cents, month: ISOMonth): { kind: 'child_exceeds_parent' | 'children_exceed'; limit: Cents; total: Cents } | null {
  const index = indexLedger(data);
  const category = index.categories.get(categoryId);
  if (!category) return null;
  if (category.parentId) {
    const parent = data.budgets.find((b) => b.categoryId === category.parentId);
    const parentAmount = parent ? budgetAmountFor(parent, month) : null;
    if (parentAmount !== null && amount > parentAmount) return { kind: 'child_exceeds_parent', limit: parentAmount, total: amount };
    return null;
  }
  let children = 0;
  for (const b of data.budgets) {
    if (index.categories.get(b.categoryId)?.parentId !== categoryId) continue;
    children += budgetAmountFor(b, month) ?? 0;
  }
  return children > amount ? { kind: 'children_exceed', limit: amount, total: children } : null;
}

const ROLLOVER_LOOKBACK = 12;

export function budgetLine(data: LedgerData, budget: Budget, month: ISOMonth, today: ISODate): BudgetLine | null {
  const category = indexLedger(data).categories.get(budget.categoryId);
  const base = budgetAmountFor(budget, month);
  if (!category || base === null) return null;
  const ids = categoryFamily(data, budget.categoryId);

  let rollover = 0;
  if (budget.rollover) {
    for (let i = ROLLOVER_LOOKBACK; i >= 1; i--) {
      const m = addMonthsToMonth(month, -i);
      const amount = budgetAmountFor(budget, m);
      if (amount === null) continue;
      rollover += amount - spentIn(data, ids, monthStart(m), monthEnd(m));
    }
  }

  const from = monthStart(month);
  // Future-dated transactions haven't been spent yet.
  const spent = spentIn(data, ids, from, minDate(monthEnd(month), today));
  // Overspending carried forward can shrink a budget to zero, never below.
  const amount = Math.max(0, base + rollover);
  const ratio = amount > 0 ? spent / amount : spent > 0 ? Infinity : 0;
  const state: BudgetState = ratio > 1 ? 'over' : ratio >= APPROACHING_RATIO ? 'approaching' : 'ok';

  return {
    budget,
    category,
    amount,
    base,
    rollover,
    spent,
    planned: plannedIn(data, ids, from, monthEnd(month)),
    remaining: amount - spent,
    ratio,
    state,
  };
}

export function monthBudgets(data: LedgerData, month: ISOMonth, today: ISODate) {
  const lines = data.budgets
    .map((b) => budgetLine(data, b, month, today))
    .filter((l): l is BudgetLine => l !== null)
    .sort((a, b) => b.ratio - a.ratio);

  const budgeted = new Set<string>();
  for (const l of lines) for (const id of categoryFamily(data, l.category.id)) budgeted.add(id);
  const unbudgeted = new Map<string, Cents>();
  for (const t of data.transactions) {
    if (t.date < monthStart(month) || t.date > minDate(monthEnd(month), today)) continue;
    for (const line of categoryLines(t)) {
      const id = line.categoryId ?? 'uncategorized';
      if (budgeted.has(id)) continue;
      unbudgeted.set(id, (unbudgeted.get(id) ?? 0) + line.amount);
    }
  }

  // A subcategory budget inside a budgeted parent is a sub-limit; totals count the parent only.
  const budgetedIds = new Set(lines.map((l) => l.category.id));
  const topLevel = lines.filter((l) => !(l.category.parentId && budgetedIds.has(l.category.parentId)));
  return {
    lines,
    totalBudgeted: topLevel.reduce((s, l) => s + l.amount, 0),
    totalSpent: topLevel.reduce((s, l) => s + l.spent, 0),
    totalPlanned: topLevel.reduce((s, l) => s + l.planned, 0),
    unbudgeted: [...unbudgeted.entries()].map(([categoryId, amount]) => ({ categoryId, amount })).sort((a, b) => b.amount - a.amount),
  };
}
