import { ACCOUNT_TYPES, ASSET_TYPES, INCOME_TYPES, RECURRING_KINDS } from './catalog';
import { categoryPath } from './categories';
import { categoryIdsOf, indexLedger } from './ledger';
import { centsToInput } from './money';
import type { ID, LedgerData } from './types';

export type SearchKind = 'transaction' | 'account' | 'debt' | 'bill' | 'subscription' | 'income' | 'goal' | 'asset' | 'category' | 'scenario';

export interface SearchResult {
  kind: SearchKind;
  id: ID;
  title: string;
  subtitle: string;
  href: string;
  /** Where the match was found, e.g. "note" or "#car". */
  matched?: string;
  date?: string;
  amount?: number;
}

export function normalizeTag(tag: string) {
  return tag.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-');
}

export function allTags(data: LedgerData) {
  const counts = new Map<string, number>();
  const add = (tags: string[]) => tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1));
  data.transactions.forEach((t) => add(t.tags));
  data.accounts.forEach((a) => add(a.tags));
  data.recurring.forEach((r) => add(r.tags));
  data.goals.forEach((g) => add(g.tags));
  data.assets.forEach((a) => add(a.tags));
  data.incomeSources.forEach((s) => add(s.tags));
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Searches every entity. A query starting with `#` matches tags exactly;
 * otherwise text fields, notes, tags and amounts are matched.
 */
export function searchLedger(data: LedgerData, rawQuery: string, limitPerKind = 50): SearchResult[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];
  const index = indexLedger(data);
  const tagQuery = query.startsWith('#') ? normalizeTag(query) : null;

  const match = (fields: (string | undefined)[], tags: string[], notes?: string): string | null => {
    if (tagQuery) return tags.includes(tagQuery) ? `#${tagQuery}` : null;
    if (tags.some((t) => t.includes(query))) return `#${tags.find((t) => t.includes(query))}`;
    if (fields.some((f) => f?.toLowerCase().includes(query))) return 'name';
    if (notes?.toLowerCase().includes(query)) return 'note';
    return null;
  };
  const amountMatch = (cents: number) => !tagQuery && /^[\d.,$]+$/.test(query) && centsToInput(cents).startsWith(query.replace(/[$,]/g, ''));

  const results: SearchResult[] = [];
  const push = (list: SearchResult[]) => results.push(...list.slice(0, limitPerKind));

  push(
    index.sorted
      .map((t): SearchResult | null => {
        const m = match([t.description, t.payee, ...categoryIdsOf(t).map((id) => categoryPath(index.categories, id))], t.tags, [t.notes, ...(t.splits?.map((s) => s.note) ?? [])].filter(Boolean).join(' ')) ?? (amountMatch(Math.abs(t.amount)) ? 'amount' : null);
        if (!m) return null;
        return { kind: 'transaction', id: t.id, title: t.payee || t.description, subtitle: `${categoryPath(index.categories, t.categoryId)} · ${index.accounts.get(t.accountId)?.name ?? ''}`, href: `/transactions/${t.id}`, matched: m, date: t.date, amount: t.amount };
      })
      .filter((r): r is SearchResult => r !== null),
  );

  push(
    data.accounts
      .map((a): SearchResult | null => {
        const m = match([a.name, a.institution, ACCOUNT_TYPES[a.type].label], a.tags, a.notes);
        if (!m) return null;
        const debt = ACCOUNT_TYPES[a.type].nature === 'liability';
        return { kind: debt ? 'debt' : 'account', id: a.id, title: a.name, subtitle: [ACCOUNT_TYPES[a.type].label, a.institution].filter(Boolean).join(' · '), href: `/accounts/${a.id}`, matched: m };
      })
      .filter((r): r is SearchResult => r !== null),
  );

  push(
    data.recurring
      .map((r): SearchResult | null => {
        const m = match([r.name, r.payee, RECURRING_KINDS[r.kind].label], r.tags, r.notes);
        if (!m) return null;
        return { kind: r.kind === 'subscription' ? 'subscription' : 'bill', id: r.id, title: r.name, subtitle: RECURRING_KINDS[r.kind].label, href: `/bills/${r.id}`, matched: m, amount: r.amount };
      })
      .filter((r): r is SearchResult => r !== null),
  );

  push(
    data.incomeSources
      .map((s): SearchResult | null => {
        const m = match([s.name, s.employer, INCOME_TYPES[s.type].label], s.tags, s.notes);
        return m ? { kind: 'income', id: s.id, title: s.name, subtitle: INCOME_TYPES[s.type].label, href: `/income/${s.id}`, matched: m } : null;
      })
      .filter((r): r is SearchResult => r !== null),
  );

  push(
    data.goals
      .map((g): SearchResult | null => {
        const m = match([g.name], g.tags, g.notes);
        return m ? { kind: 'goal', id: g.id, title: g.name, subtitle: 'Goal', href: `/goals/${g.id}`, matched: m } : null;
      })
      .filter((r): r is SearchResult => r !== null),
  );

  push(
    data.assets
      .map((a): SearchResult | null => {
        const m = match([a.name, ASSET_TYPES[a.type].label], a.tags, a.notes);
        return m ? { kind: 'asset', id: a.id, title: a.name, subtitle: ASSET_TYPES[a.type].label, href: `/assets/${a.id}`, matched: m } : null;
      })
      .filter((r): r is SearchResult => r !== null),
  );

  if (!tagQuery) {
    push(
      data.categories
        .filter((c) => !c.archived && c.name.toLowerCase().includes(query))
        .map((c) => ({ kind: 'category' as const, id: c.id, title: categoryPath(index.categories, c.id), subtitle: c.kind === 'income' ? 'Income category' : 'Spending category', href: `/transactions?category=${c.id}` })),
    );
    push(
      data.scenarios
        .filter((s) => s.name.toLowerCase().includes(query) || s.notes?.toLowerCase().includes(query))
        .map((s) => ({ kind: 'scenario' as const, id: s.id, title: s.name, subtitle: 'Scenario (hypothetical)', href: `/scenarios/${s.id}` })),
    );
  }

  return results;
}
