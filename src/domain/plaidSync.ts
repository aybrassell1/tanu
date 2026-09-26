/**
 * Turning what a bank sends into transactions you would have typed yourself.
 *
 * Plaid hands back a flat list of charges and deposits per account. Tanu needs
 * rather more care than that: a payment from your checking to your credit card
 * arrives twice, once from each side, and counting both would say you spent
 * money you only moved. So the two halves are paired into a single transfer,
 * everything keeps the bank's own id so a later sync recognises it, and your
 * own category habits are applied on the way through.
 *
 * Nothing here writes. It produces a list for you to look at, and you decide.
 */

import { accountNature } from './catalog';
import { diffDays } from './dates';
import { categoryFor, kindForType, merchantProfiles } from './merchants';
import { merchantKey, similarDescription } from './merchantText';
import type { Cents, ID, ISODate, LedgerData, Transaction, TransactionType } from './types';

/** The fields of a Plaid transaction this app reads. */
export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  /** Dollars. Positive is money leaving, negative is money arriving. */
  amount: number;
  /** Posted date, `YYYY-MM-DD`. */
  date: string;
  authorized_date?: string | null;
  /** The raw line from the bank. */
  name: string;
  /** Plaid's tidier name for the merchant, when it has one. */
  merchant_name?: string | null;
  pending?: boolean;
  pending_transaction_id?: string | null;
  iso_currency_code?: string | null;
  personal_finance_category?: { primary?: string; detailed?: string } | null;
}

export interface SyncPayload {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id: string }[];
  next_cursor: string;
  has_more: boolean;
}

/** Why a row is here, and what it would do to your ledger. */
export type RowKind =
  | 'new'
  | 'transfer'
  | 'duplicate'
  | 'unmapped'
  | 'pending'
  /** Money arriving on a card from an account that isn't connected. */
  | 'needs_pair'
  /** Nothing to record: a zero-amount line, which some banks send. */
  | 'ignored';

export interface SyncRow {
  /** The bank's id; also what lands on the transaction. */
  externalId: string;
  kind: RowKind;
  /** Ready to save, except for the id and stamps. Absent when it can't be. */
  draft?: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>;
  /** What this looked like before, for something the bank has since changed. */
  replaces?: ID;
  /** The other half of a paired transfer, so neither is offered twice. */
  pairedWith?: string;
  /** Reads as paying a card off rather than being paid back. */
  paymentLike?: boolean;
  /** Shown in the review list. */
  label: string;
  amount: Cents;
  date: ISODate;
  accountName: string;
}

export interface SyncResult {
  rows: SyncRow[];
  /** Ids the bank says it removed, that exist here. */
  removed: ID[];
  counts: { new: number; transfer: number; duplicate: number; unmapped: number; pending: number; needs_pair: number; ignored: number };
}

/**
 * Whether a connection is Plaid's test environment, where the banks and the
 * money are invented. Worth saying out loud: fake charges filed into a real
 * account are indistinguishable from real ones a week later.
 */
export const isSandbox = (accessToken: string) => accessToken.startsWith('access-sandbox');

/** Plaid deals in dollars as floats; everything here is integer cents. */
export const toCents = (amount: number): Cents => Math.round(amount * 100);

/**
 * What a sync would do, without doing any of it.
 *
 * `connectionId` scopes the work to one bank: ids from another connection are
 * left alone, so two banks can never tread on each other.
 */
export function planSync(data: LedgerData, connectionId: ID, payload: SyncPayload, options: { includePending?: boolean } = {}): SyncResult {
  const connection = data.connections.find((c) => c.id === connectionId);
  if (!connection) return { rows: [], removed: [], counts: emptyCounts() };

  const accountFor = new Map(connection.accounts.filter((a) => a.accountId).map((a) => [a.externalId, a.accountId as ID]));
  const nameFor = new Map(connection.accounts.map((a) => [a.externalId, a.name]));
  const seen = new Map(data.transactions.filter((t) => t.externalId).map((t) => [t.externalId as string, t]));
  const profiles = merchantProfiles(data);

  const rows: SyncRow[] = [];
  for (const tx of [...payload.added, ...payload.modified]) {
    const accountId = accountFor.get(tx.account_id);
    const accountName = nameFor.get(tx.account_id) ?? 'Unmapped account';
    const amount = Math.abs(toCents(tx.amount));
    const label = (tx.merchant_name || tx.name || '').trim();
    const date = (tx.authorized_date || tx.date) as ISODate;
    const base = { externalId: tx.transaction_id, label, amount, date, accountName };
    const paymentLike = tx.amount < 0 && looksLikePayment(tx);

    // A pending charge changes its amount and its date before it settles, and
    // arrives again with a new id when it does. Waiting is simpler than mending.
    if (tx.pending && !options.includePending) {
      rows.push({ ...base, kind: 'pending' });
      continue;
    }
    if (!accountId) {
      rows.push({ ...base, kind: 'unmapped' });
      continue;
    }
    if (amount === 0) {
      rows.push({ ...base, kind: 'ignored' });
      continue;
    }



    const existing = seen.get(tx.transaction_id);
    const type: TransactionType = spendingDirection(data, accountId, tx.amount);
    const draft: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> = {
      type,
      amount,
      date,
      description: label || tx.name || 'Unnamed transaction',
      payee: label || undefined,
      accountId,
      externalId: tx.transaction_id,
      connectionId,
      tags: [],
      attachments: [],
    };
    const learned = categoryFor(profiles.get(merchantKey(label || tx.name)), kindForType(type));
    if (learned) draft.categoryId = learned;

    if (existing) {
      // Only money and timing count as a change worth showing. Banks tidy up
      // their own descriptions for weeks afterwards, and re-offering a row
      // because a name got shorter would make every sync look like work.
      const changed = existing.amount !== amount || existing.date !== date;
      rows.push({ ...base, paymentLike, kind: changed ? 'new' : 'duplicate', draft: changed ? draft : undefined, replaces: changed ? existing.id : undefined });
      continue;
    }
    // The same charge recorded by hand before the sync caught up.
    const byHand = alreadyRecorded(data, draft);
    rows.push({ ...base, paymentLike, kind: byHand ? 'duplicate' : 'new', draft: byHand ? undefined : draft });
  }

  pairTransfers(rows);

  // Anything still unpaired that reads as a card payment has no source account
  // to have come from. Inventing one would be worse than waiting.
  for (const row of rows) {
    if (row.kind === 'new' && row.paymentLike) {
      row.kind = 'needs_pair';
      row.draft = undefined;
    }
  }

  const removed = payload.removed.map((r) => seen.get(r.transaction_id)?.id).filter((id): id is ID => !!id);
  const counts = emptyCounts();
  for (const row of rows) counts[row.kind] += 1;
  return { rows, removed, counts };
}

/**
 * Money leaving an account you own is spending unless it landed in another
 * account you own — which `pairTransfers` works out afterwards, once both
 * halves are on the table.
 */
function spendingDirection(data: LedgerData, accountId: ID, amount: number): TransactionType {
  if (amount > 0) return 'expense';
  // Money arriving on a card that is not a payment is a refund, which offsets
  // what you spent rather than counting as income. A payment never reaches
  // here: it has no source account, so it is held back instead.
  return isLiability(data, accountId) ? 'refund' : 'income';
}

const isLiability = (data: LedgerData, accountId: ID): boolean => {
  const account = data.accounts.find((a) => a.id === accountId);
  return account ? accountNature(account.type) === 'liability' : false;
};

/** The words banks use when you pay a card off, rather than when a shop pays you back. */
const PAYMENT_WORDS = /\b(payment|thank you|autopay|e-?pay|bill pay|pmt)\b/i;

const looksLikePayment = (tx: PlaidTransaction): boolean =>
  PAYMENT_WORDS.test(`${tx.merchant_name ?? ''} ${tx.name ?? ''}`) ||
  (tx.personal_finance_category?.primary ?? '') === 'TRANSFER_IN';

const emptyCounts = (): SyncResult['counts'] => ({ new: 0, transfer: 0, duplicate: 0, unmapped: 0, pending: 0, needs_pair: 0, ignored: 0 });

/**
 * Two halves of one move: the same amount leaving one of your accounts and
 * arriving in another within a couple of days. Left alone they would read as
 * spending plus income, which is a month of nonsense in every report.
 */
function pairTransfers(rows: SyncRow[]) {
  const out = rows.filter((r) => r.kind === 'new' && r.draft && r.draft.type === 'expense');
  const inn = rows.filter((r) => r.kind === 'new' && r.draft && ['income', 'debt_payment', 'refund'].includes(r.draft.type));
  const used = new Set<string>();

  for (const leaving of out) {
    const match = inn.find(
      (arriving) =>
        !used.has(arriving.externalId) &&
        arriving.draft!.accountId !== leaving.draft!.accountId &&
        arriving.amount === leaving.amount &&
        Math.abs(diffDays(leaving.date, arriving.date)) <= 3,
    );
    if (!match) continue;
    used.add(match.externalId);

    // One transfer, from the account it left to the one it reached. The other
    // row stays in the list so you can see it was recognised, not lost.
    leaving.kind = 'transfer';
    leaving.pairedWith = match.externalId;
    leaving.draft = {
      ...leaving.draft!,
      // Money that landed on a card is a debt payment; anywhere else it is a transfer.
      type: match.paymentLike || match.draft!.type === 'debt_payment' ? 'debt_payment' : 'transfer',
      toAccountId: match.draft!.accountId,
      categoryId: undefined,
    };
    match.kind = 'duplicate';
    match.pairedWith = leaving.externalId;
    match.draft = undefined;
  }
}

/** The same charge, typed in before the bank got round to sending it. */
function alreadyRecorded(data: LedgerData, draft: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>): boolean {
  return data.transactions.some(
    (t) =>
      !t.externalId &&
      t.accountId === draft.accountId &&
      t.amount === draft.amount &&
      Math.abs(diffDays(t.date, draft.date)) <= 3 &&
      similarDescription(`${t.payee ?? ''} ${t.description}`, `${draft.payee ?? ''} ${draft.description}`),
  );
}
