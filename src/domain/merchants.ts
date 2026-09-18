/**
 * What you usually do with a given merchant.
 *
 * Every screen that asks "which category is this?" can answer from your own
 * history instead of making you pick again: quick add fills itself in once it
 * recognises a payee, a CSV import categorises the rows it knows, and the
 * tidy-up queue offers a category for transactions that never got one. They all
 * read the same habits here, so a suggestion never depends on which door you
 * came in through.
 *
 * A suggestion is only ever a default. Nothing here writes to the ledger, and a
 * habit has to be clear before it is offered: a couple of past transactions
 * that mostly agree, not a single lucky match.
 */

import { merchantKey } from './merchantText';
import type { Cents, CategoryKind, ID, ISODate, LedgerData, Transaction, TransactionType } from './types';

/** At least this many past transactions before a merchant counts as a habit. */
export const MIN_SAMPLES = 2;
/** …and this share of them must agree on the category. */
export const MIN_SHARE = 0.6;

/** Types that name someone you paid or were paid by; the rest have no merchant. */
const SUGGESTIBLE: TransactionType[] = ['expense', 'income', 'refund', 'reimbursement'];

export type MerchantProfile = {
  /** The merchant fingerprint these transactions share. */
  key: string;
  /** The name as you last wrote it, for showing back to you. */
  name: string;
  /** The account you normally use here. */
  accountId?: ID;
  /** What you paid last time, as a starting point — never a forecast. */
  lastAmount: Cents;
  /** The middle of what you usually pay. */
  typicalAmount: Cents;
  lastDate: ISODate;
  /** How many past transactions this is drawn from. */
  seen: number;
  /** Your usual answer per kind of category, with how much of your history agrees. */
  categories: Partial<Record<CategoryKind, { id: ID; share: number; of: number }>>;
  /** Whether you usually mark spending here as essential. */
  essential?: boolean;
};

export type MerchantSuggestion = MerchantProfile & {
  /** The category for the kind that was asked for, once it clears the bar. */
  categoryId?: ID;
};

type Tally = {
  key: string;
  name: string;
  byKind: Map<CategoryKind, Map<ID, number>>;
  accounts: Map<ID, number>;
  amounts: Cents[];
  essential: { yes: number; no: number };
  lastDate: ISODate;
  lastAmount: Cents;
  total: number;
};

const label = (t: Transaction) => (t.payee || t.description || '').trim();

/** One entry per merchant you have used, keyed by its fingerprint. */
export function merchantProfiles(data: LedgerData): Map<string, MerchantProfile> {
  const kinds = new Map(data.categories.map((c) => [c.id, c.kind]));
  const archivedCategory = new Set(data.categories.filter((c) => c.archived).map((c) => c.id));
  const archivedAccount = new Set(data.accounts.filter((a) => a.archived).map((a) => a.id));
  const tallies = new Map<string, Tally>();

  for (const t of data.transactions) {
    if (!SUGGESTIBLE.includes(t.type)) continue;
    // A split purchase has no single category to learn from.
    if (t.splits && t.splits.length > 0) continue;
    const name = label(t);
    const key = merchantKey(name);
    if (!key) continue;

    const tally = tallies.get(key) ?? {
      key,
      name,
      byKind: new Map<CategoryKind, Map<ID, number>>(),
      accounts: new Map<ID, number>(),
      amounts: [],
      essential: { yes: 0, no: 0 },
      lastDate: t.date,
      lastAmount: t.amount,
      total: 0,
    };

    tally.total += 1;
    tally.amounts.push(t.amount);
    const kind = t.categoryId ? kinds.get(t.categoryId) : undefined;
    if (t.categoryId && kind && !archivedCategory.has(t.categoryId)) {
      const counts = tally.byKind.get(kind) ?? new Map<ID, number>();
      counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
      tally.byKind.set(kind, counts);
    }
    if (!archivedAccount.has(t.accountId)) tally.accounts.set(t.accountId, (tally.accounts.get(t.accountId) ?? 0) + 1);
    if (t.essential === true) tally.essential.yes += 1;
    if (t.essential === false) tally.essential.no += 1;
    // The most recent spelling and amount win, so the name you see is current.
    if (t.date >= tally.lastDate) {
      tally.lastDate = t.date;
      tally.lastAmount = t.amount;
      tally.name = name;
    }
    tallies.set(key, tally);
  }

  const out = new Map<string, MerchantProfile>();
  for (const [key, tally] of mergeByPrefix(tallies)) {
    const categories: MerchantProfile['categories'] = {};
    for (const [kind, counts] of tally.byKind) {
      const top = pickTop(counts);
      const of = [...counts.values()].reduce((a, b) => a + b, 0);
      if (top) categories[kind] = { id: top.id, share: top.count / of, of };
    }
    out.set(key, {
      key,
      name: tally.name,
      accountId: pickTop(tally.accounts)?.id,
      lastAmount: tally.lastAmount,
      typicalAmount: median(tally.amounts),
      lastDate: tally.lastDate,
      seen: tally.total,
      categories,
      essential: tally.essential.yes === 0 && tally.essential.no === 0 ? undefined : tally.essential.yes >= tally.essential.no,
    });
  }
  return out;
}

/** The category you habitually use here, or nothing if the habit isn't clear. */
export function categoryFor(profile: MerchantProfile | undefined, kind: CategoryKind): ID | undefined {
  const best = profile?.categories[kind];
  if (!best) return undefined;
  return best.of >= MIN_SAMPLES && best.share >= MIN_SHARE ? best.id : undefined;
}

/** Spending categories answer expenses; income categories answer money coming in. */
export function kindForType(type: TransactionType): CategoryKind {
  return type === 'income' || type === 'refund' || type === 'reimbursement' ? 'income' : 'expense';
}

/**
 * What you usually do with this payee, or nothing if you have not been here
 * often enough for a default to be fair. Matching is loose at the edges: typing
 * "trader" finds "trader joes" once you have been there twice.
 */
export function suggestFor(data: LedgerData, payee: string, kind: CategoryKind = 'expense', profiles?: Map<string, MerchantProfile>): MerchantSuggestion | null {
  const key = merchantKey(payee ?? '');
  if (!key) return null;
  const all = profiles ?? merchantProfiles(data);

  let match = all.get(key);
  if (!match || match.seen < MIN_SAMPLES) {
    match = undefined;
    for (const profile of all.values()) {
      if (profile.seen < MIN_SAMPLES) continue;
      if (!profile.key.startsWith(key) && !key.startsWith(profile.key)) continue;
      if (!match || profile.seen > match.seen) match = profile;
    }
  }
  if (!match) return null;
  return { ...match, categoryId: categoryFor(match, kind) };
}

export type TidyItem = {
  transaction: Transaction;
  suggestion: MerchantSuggestion | null;
};

/**
 * Spending and income with no category yet, newest first, each with whatever
 * your history suggests. This is the queue behind the tidy-up screen.
 */
export function needsCategory(data: LedgerData, limit = 200): TidyItem[] {
  const profiles = merchantProfiles(data);
  const out: TidyItem[] = [];
  for (const t of data.transactions) {
    if (!SUGGESTIBLE.includes(t.type)) continue;
    if (t.categoryId) continue;
    if (t.splits && t.splits.length > 0) continue;
    out.push({ transaction: t, suggestion: suggestFor(data, label(t), kindForType(t.type), profiles) });
  }
  out.sort((a, b) => (a.transaction.date < b.transaction.date ? 1 : a.transaction.date > b.transaction.date ? -1 : 0));
  return out.slice(0, limit);
}

export type TidyGroup = {
  /** Merchant fingerprint and kind, e.g. `expense|adobe`. */
  key: string;
  /** The merchant as you last wrote it. */
  name: string;
  kind: CategoryKind;
  items: TidyItem[];
  total: Cents;
  earliest: ISODate;
  latest: ISODate;
  suggestion: MerchantSuggestion | null;
};

/**
 * The queue by merchant, because four unfiled Adobe charges are one decision,
 * not four. Biggest group first, then most recent.
 */
export function groupNeedsCategory(items: TidyItem[]): TidyGroup[] {
  const groups = new Map<string, TidyGroup>();
  for (const item of items) {
    const t = item.transaction;
    const kind = kindForType(t.type);
    const name = label(t);
    // Anything unrecognisable stays on its own, so one blank row can't swallow another.
    const key = merchantKey(name) ? `${kind}|${merchantKey(name)}` : `${kind}|#${t.id}`;
    const group = groups.get(key) ?? { key, name, kind, items: [], total: 0, earliest: t.date, latest: t.date, suggestion: item.suggestion };
    group.items.push(item);
    group.total += t.amount;
    if (t.date < group.earliest) group.earliest = t.date;
    if (t.date >= group.latest) {
      group.latest = t.date;
      group.name = name;
    }
    group.suggestion = group.suggestion ?? item.suggestion;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length || (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0));
}

/** How much of the tidy-up the app can offer to do for you. */
export function tidySummary(items: TidyItem[]): { total: number; suggested: number; unknown: number } {
  const suggested = items.filter((i) => i.suggestion?.categoryId).length;
  return { total: items.length, suggested, unknown: items.length - suggested };
}

/**
 * One card reader writes "TRADER JOES", another "TRADER JOES SAN FRA", and the
 * fingerprint keeps up to four words, so the same shop can arrive as two keys.
 * A longer key folds into a shorter one it starts with, which puts the history
 * back together. Single-word keys never absorb anything: "shell" should not
 * swallow "shell shock games".
 */
function mergeByPrefix(tallies: Map<string, Tally>): Map<string, Tally> {
  const keys = [...tallies.keys()].sort((a, b) => a.length - b.length);
  const canonical = new Map<string, Tally>();
  for (const key of keys) {
    const host = keys.find((other) => other !== key && other.includes(' ') && key.startsWith(`${other} `) && canonical.has(other));
    const tally = tallies.get(key)!;
    if (!host) {
      canonical.set(key, tally);
      continue;
    }
    const into = canonical.get(host)!;
    into.total += tally.total;
    into.amounts.push(...tally.amounts);
    into.essential.yes += tally.essential.yes;
    into.essential.no += tally.essential.no;
    for (const [id, n] of tally.accounts) into.accounts.set(id, (into.accounts.get(id) ?? 0) + n);
    for (const [kind, counts] of tally.byKind) {
      const merged = into.byKind.get(kind) ?? new Map<ID, number>();
      for (const [id, n] of counts) merged.set(id, (merged.get(id) ?? 0) + n);
      into.byKind.set(kind, merged);
    }
    if (tally.lastDate >= into.lastDate) {
      into.lastDate = tally.lastDate;
      into.lastAmount = tally.lastAmount;
      into.name = tally.name;
    }
  }
  return canonical;
}

function pickTop(counts: Map<ID, number>): { id: ID; count: number } | null {
  let best: { id: ID; count: number } | null = null;
  for (const [id, count] of counts) if (!best || count > best.count) best = { id, count };
  return best;
}

function median(values: Cents[]): Cents {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
