import { balanceOn, indexLedger } from './ledger';
import { taxLinesOf } from './taxes';
import type { Cents, ID, ISODate, LedgerData, TaxTag, Transaction } from './types';

/**
 * HSA/FSA reimbursement ledger.
 *
 * Medical money you paid out of pocket can be paid back to yourself from an
 * HSA (there is no deadline) or an FSA (within the plan year). This module
 * lists those costs and tracks three states:
 *
 *   open       — medical spending, nothing claimed yet
 *   flagged    — you marked it as reimbursable from the HSA or FSA
 *   reimbursed — the money has come back (`reimbursedOn`)
 *
 * "Out of pocket" is the whole point: anything already paid straight from an
 * HSA account is excluded, because there is nothing to reimburse. Receipts
 * matter for an audit years later, so each item reports whether it has one.
 */

/** Tax tags that mark medical spending. */
export const MEDICAL_TAGS: TaxTag[] = ['medical', 'hsa_eligible'];
const MEDICAL = new Set<TaxTag>(MEDICAL_TAGS);

export type ReimbursementStatus = 'open' | 'flagged' | 'reimbursed';

export interface ReimbursableItem {
  id: ID;
  tx: Transaction;
  date: ISODate;
  description: string;
  payee?: string;
  /** The medical part of the transaction (splits are respected). */
  amount: Cents;
  accountId: ID;
  accountName: string;
  categoryId?: ID;
  categoryName?: string;
  tags: TaxTag[];
  status: ReimbursementStatus;
  source?: 'hsa' | 'fsa';
  reimbursedOn?: ISODate;
  hasReceipt: boolean;
}

export interface HsaAccountInfo {
  id: ID;
  name: string;
  balance: Cents;
}

export interface ReimbursementLedger {
  from?: ISODate;
  to: ISODate;
  /** Newest first. */
  items: ReimbursableItem[];
  open: ReimbursableItem[];
  flagged: ReimbursableItem[];
  reimbursed: ReimbursableItem[];
  totals: {
    open: Cents;
    flagged: Cents;
    reimbursed: Cents;
    /** Everything not yet reimbursed — what you could still claim back. */
    outstanding: Cents;
    /** Every medical cost in range, whatever its state. */
    all: Cents;
    hsaFlagged: Cents;
    fsaFlagged: Cents;
  };
  counts: { open: number; flagged: number; reimbursed: number; all: number };
  /** Outstanding items with no attachment — the ones an audit would question. */
  missingReceipts: number;
  missingReceiptTotal: Cents;
  hsaAccounts: HsaAccountInfo[];
  hsaBalance: Cents;
  /** Outstanding claims covered by the HSA balance today. */
  coverage: number;
}

/** The medical share of one transaction, summed over its split lines. */
export function medicalAmount(data: LedgerData, tx: Transaction): { amount: Cents; tags: TaxTag[] } {
  let amount = 0;
  const tags: TaxTag[] = [];
  for (const line of taxLinesOf(data, tx)) {
    if (!MEDICAL.has(line.tag)) continue;
    amount += line.amount;
    if (!tags.includes(line.tag)) tags.push(line.tag);
  }
  return { amount, tags };
}

const statusOf = (tx: Transaction): ReimbursementStatus =>
  tx.reimbursedOn ? 'reimbursed' : tx.reimbursableFrom ? 'flagged' : 'open';

/**
 * Every out-of-pocket medical cost with its reimbursement state.
 * `to` defaults to today so future-dated transactions never inflate a claim.
 */
export function reimbursementLedger(
  data: LedgerData,
  today: ISODate,
  options: { from?: ISODate; to?: ISODate } = {},
): ReimbursementLedger {
  const index = indexLedger(data);
  const to = options.to ?? today;
  const { from } = options;

  const hsaAccounts: HsaAccountInfo[] = data.accounts
    .filter((a) => a.type === 'hsa' && !a.archived)
    .map((a) => ({ id: a.id, name: a.name, balance: balanceOn(index, a.id, today) }));
  const paidFromHsa = new Set(data.accounts.filter((a) => a.type === 'hsa').map((a) => a.id));

  const items: ReimbursableItem[] = [];
  for (const tx of index.sorted) {
    if (tx.date > to) continue;
    if (from && tx.date < from) continue;
    // Already paid with HSA money: nothing to claim back.
    if (paidFromHsa.has(tx.accountId)) continue;
    const { amount, tags } = medicalAmount(data, tx);
    if (amount <= 0) continue;
    const account = index.accounts.get(tx.accountId);
    const category = tx.categoryId ? index.categories.get(tx.categoryId) : undefined;
    items.push({
      id: tx.id,
      tx,
      date: tx.date,
      description: tx.description,
      payee: tx.payee,
      amount,
      accountId: tx.accountId,
      accountName: account?.name ?? 'Unknown account',
      categoryId: tx.categoryId,
      categoryName: category?.name,
      tags,
      status: statusOf(tx),
      source: tx.reimbursableFrom,
      reimbursedOn: tx.reimbursedOn,
      hasReceipt: tx.attachments.length > 0,
    });
  }

  const pick = (status: ReimbursementStatus) => items.filter((i) => i.status === status);
  const open = pick('open');
  const flagged = pick('flagged');
  const reimbursed = pick('reimbursed');
  const total = (list: ReimbursableItem[]) => list.reduce((s, i) => s + i.amount, 0);
  const openTotal = total(open);
  const flaggedTotal = total(flagged);
  const outstanding = openTotal + flaggedTotal;
  const withoutReceipt = [...open, ...flagged].filter((i) => !i.hasReceipt);
  const hsaBalance = hsaAccounts.reduce((s, a) => s + a.balance, 0);

  return {
    from,
    to,
    items,
    open,
    flagged,
    reimbursed,
    totals: {
      open: openTotal,
      flagged: flaggedTotal,
      reimbursed: total(reimbursed),
      outstanding,
      all: total(items),
      hsaFlagged: total(flagged.filter((i) => i.source === 'hsa')),
      fsaFlagged: total(flagged.filter((i) => i.source === 'fsa')),
    },
    counts: { open: open.length, flagged: flagged.length, reimbursed: reimbursed.length, all: items.length },
    missingReceipts: withoutReceipt.length,
    missingReceiptTotal: total(withoutReceipt),
    hsaAccounts,
    hsaBalance,
    coverage: outstanding > 0 ? Math.min(1, Math.max(0, hsaBalance) / outstanding) : 1,
  };
}

/** Ids for "flag everything eligible": medical spending nothing has been done with yet. */
export function eligibleIds(ledger: ReimbursementLedger): ID[] {
  return ledger.open.map((i) => i.id);
}
