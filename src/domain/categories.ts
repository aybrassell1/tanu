import type { Category, CategoryKind, ID, LedgerData } from './types';

export function categoryPath(categories: Map<ID, Category>, id: ID | undefined) {
  if (!id) return 'Uncategorized';
  const c = categories.get(id);
  if (!c) return 'Uncategorized';
  const parent = c.parentId ? categories.get(c.parentId) : undefined;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

/** Top-level category id for any category (itself when already top-level). */
export function rootCategoryId(categories: Map<ID, Category>, id: ID | undefined): ID | undefined {
  if (!id) return undefined;
  const c = categories.get(id);
  return c?.parentId ?? c?.id;
}

export function childrenOf(data: LedgerData, parentId: ID, includeArchived = false) {
  return data.categories
    .filter((c) => c.parentId === parentId && (includeArchived || !c.archived))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function rootCategories(data: LedgerData, kind: CategoryKind, includeArchived = false) {
  return data.categories
    .filter((c) => c.parentId === null && c.kind === kind && (includeArchived || !c.archived))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** A category plus all its subcategories. */
export function categoryFamily(data: LedgerData, id: ID): Set<ID> {
  return new Set([id, ...data.categories.filter((c) => c.parentId === id).map((c) => c.id)]);
}

export function isCategoryUsed(data: LedgerData, id: ID) {
  return (
    data.transactions.some((t) => t.categoryId === id) ||
    data.recurring.some((r) => r.categoryId === id) ||
    data.incomeSources.some((s) => s.categoryId === id) ||
    data.budgets.some((b) => b.categoryId === id) ||
    data.favorites.some((f) => f.categoryId === id)
  );
}
