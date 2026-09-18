import { diffDays } from './dates';
import { sum } from './money';
import type { Cents, ID, ISODate, Iou, LedgerData, Transaction, TransactionType } from './types';

/**
 * IOUs — money lent to or borrowed from a person. This is a side ledger: an IOU
 * on its own never moves money and never touches an account balance. Balances
 * only change when the user chooses to record the matching transaction, which
 * `moneyMovePlan` describes and `moneyMoveTransaction` builds. Repayments keep
 * the id of the transaction they created (`IouEntry.txId`) so the same money is
 * never counted twice.
 */

export type IouDirection = Iou['direction'];

/** Tag put on every transaction created from an IOU, so they can be found again. */
export const IOU_TAG = 'iou';

export const personKey = (person: string) => person.trim().toLowerCase();

// ─── Balances ────────────────────────────────────────────────────────────────

export interface IouBalance {
  /** The original amount lent or borrowed. */
  amount: Cents;
  /** Everything repaid so far. */
  repaid: Cents;
  /** Still to come. Never negative. */
  outstanding: Cents;
  settled: boolean;
  /** How much of the amount has been repaid, 0–1. */
  ratio: number;
}

export function iouBalance(iou: Pick<Iou, 'amount' | 'entries' | 'settledOn'>): IouBalance {
  const amount = Math.max(0, iou.amount);
  const repaid = sum(iou.entries.map((e) => e.amount));
  const outstanding = Math.max(0, amount - repaid);
  return {
    amount,
    repaid,
    outstanding,
    settled: outstanding === 0 || !!iou.settledOn,
    ratio: amount > 0 ? Math.min(1, Math.max(0, repaid / amount)) : 1,
  };
}

/** The largest repayment that still fits. Mirrors the store's rule. */
export const maxRepayment = (iou: Pick<Iou, 'amount' | 'entries' | 'settledOn'>): Cents => iouBalance(iou).outstanding;

/** Whether a repayment of `amount` is allowed (positive whole cents, not more than outstanding). */
export function canRepay(iou: Pick<Iou, 'amount' | 'entries' | 'settledOn'>, amount: Cents): boolean {
  if (!Number.isInteger(amount) || amount <= 0) return false;
  return amount <= maxRepayment(iou);
}

const isOpen = (iou: Iou) => !iou.archived && iouBalance(iou).outstanding > 0;

export const openIous = (data: LedgerData) => data.ious.filter(isOpen);

export const isOverdue = (iou: Iou, today: ISODate) => isOpen(iou) && !!iou.dueDate && iou.dueDate < today;

/** Days since the money changed hands. */
export const daysOutstanding = (iou: Iou, today: ISODate) => Math.max(0, diffDays(iou.date, today));

// ─── Summary ─────────────────────────────────────────────────────────────────

export interface IouPerson {
  person: string;
  /** Outstanding they owe you. */
  owedToMe: Cents;
  /** Outstanding you owe them. */
  iOwe: Cents;
  /** Positive when they owe you overall. */
  net: Cents;
  /** Date of their oldest open IOU, or null when nothing is open. */
  oldest: ISODate | null;
  /** Open IOUs with this person, oldest first. */
  ious: Iou[];
  overdue: number;
}

export interface IouSummary {
  owedToMe: Cents;
  iOwe: Cents;
  /** Positive when you are owed more than you owe. */
  net: Cents;
  people: IouPerson[];
  overdue: Iou[];
}

/** Two-sided picture of every open IOU, grouped by person. Settled and archived IOUs are left out. */
export function iouSummary(data: LedgerData, today: ISODate): IouSummary {
  const open = openIous(data);
  const groups = new Map<string, IouPerson>();

  for (const iou of open) {
    const key = personKey(iou.person);
    const outstanding = iouBalance(iou).outstanding;
    const group = groups.get(key) ?? { person: iou.person.trim(), owedToMe: 0, iOwe: 0, net: 0, oldest: null, ious: [], overdue: 0 };
    if (iou.direction === 'owed_to_me') group.owedToMe += outstanding;
    else group.iOwe += outstanding;
    group.net = group.owedToMe - group.iOwe;
    group.oldest = group.oldest === null || iou.date < group.oldest ? iou.date : group.oldest;
    group.ious.push(iou);
    if (isOverdue(iou, today)) group.overdue += 1;
    groups.set(key, group);
  }

  const people = [...groups.values()]
    .map((g) => ({ ...g, ious: [...g.ious].sort((a, b) => (a.date === b.date ? a.person.localeCompare(b.person) : a.date < b.date ? -1 : 1)) }))
    .sort((a, b) => {
      const exposure = b.owedToMe + b.iOwe - (a.owedToMe + a.iOwe);
      return exposure !== 0 ? exposure : a.person.localeCompare(b.person);
    });

  const owedToMe = sum(people.map((p) => p.owedToMe));
  const iOwe = sum(people.map((p) => p.iOwe));
  return {
    owedToMe,
    iOwe,
    net: owedToMe - iOwe,
    people,
    overdue: open.filter((i) => isOverdue(i, today)).sort((a, b) => ((a.dueDate ?? '') < (b.dueDate ?? '') ? -1 : 1)),
  };
}

/** Every IOU with one person, open ones first and newest first within each group. */
export function iousForPerson(data: LedgerData, person: string): Iou[] {
  const key = personKey(person);
  return data.ious
    .filter((i) => personKey(i.person) === key && !i.archived)
    .sort((a, b) => {
      const openA = iouBalance(a).outstanding > 0 ? 0 : 1;
      const openB = iouBalance(b).outstanding > 0 ? 0 : 1;
      if (openA !== openB) return openA - openB;
      return a.date === b.date ? 0 : a.date < b.date ? 1 : -1;
    });
}

// ─── Aging ───────────────────────────────────────────────────────────────────

export type AgeBucket = 'under_month' | 'one_to_three' | 'older';

export const AGE_BUCKETS: { bucket: AgeBucket; label: string }[] = [
  { bucket: 'under_month', label: 'Under a month' },
  { bucket: 'one_to_three', label: '1–3 months' },
  { bucket: 'older', label: 'Older than 3 months' },
];

export function ageBucket(iou: Iou, today: ISODate): AgeBucket {
  const days = daysOutstanding(iou, today);
  if (days < 30) return 'under_month';
  if (days < 90) return 'one_to_three';
  return 'older';
}

export interface IouAgingBucket {
  bucket: AgeBucket;
  label: string;
  owedToMe: Cents;
  iOwe: Cents;
  count: number;
  ious: Iou[];
}

/** How long open IOUs have been outstanding. Always returns the three buckets, oldest last. */
export function iouAging(data: LedgerData, today: ISODate): IouAgingBucket[] {
  const open = openIous(data);
  return AGE_BUCKETS.map(({ bucket, label }) => {
    const ious = open.filter((i) => ageBucket(i, today) === bucket).sort((a, b) => (a.date < b.date ? -1 : 1));
    const amount = (direction: IouDirection) => sum(ious.filter((i) => i.direction === direction).map((i) => iouBalance(i).outstanding));
    return { bucket, label, owedToMe: amount('owed_to_me'), iOwe: amount('i_owe'), count: ious.length, ious };
  });
}

// ─── Money movement ──────────────────────────────────────────────────────────

/** `principal` is the original hand-over; `repayment` is money going back. */
export type IouMoveKind = 'principal' | 'repayment';

export interface MoneyMovePlan {
  txType: TransactionType;
  /** Which way the money flows for the user's account. */
  flow: 'in' | 'out';
  /** Label for the "record the money movement too" switch. */
  title: string;
  /** One short line explaining what it does to income and spending. */
  explain: string;
  /** Adjustments carry a signed delta instead of a positive amount. */
  signed: boolean;
  /** Only spending-type moves take a category. */
  category: boolean;
}

/**
 * Which transaction a real money movement should become, so nothing is counted
 * twice. Money coming back from someone is a `reimbursement` (it cancels the
 * spending) and never income; money borrowed is a balance `adjustment`, because
 * a loan is not income either.
 */
export function moneyMovePlan(direction: IouDirection, kind: IouMoveKind, options: { principalRecorded?: boolean } = {}): MoneyMovePlan {
  if (direction === 'owed_to_me') {
    if (kind === 'principal') {
      return {
        txType: 'expense',
        flow: 'out',
        title: 'Also record the money leaving my account',
        explain: 'Logs what you handed over as spending. Repayments come back as reimbursements, so it nets out.',
        signed: false,
        category: true,
      };
    }
    return {
      txType: 'reimbursement',
      flow: 'in',
      title: 'Also record the money arriving',
      explain: 'A reimbursement cancels the original spending instead of adding income, so it is never counted twice.',
      signed: false,
      category: true,
    };
  }
  if (kind === 'principal') {
    return {
      txType: 'adjustment',
      flow: 'in',
      title: 'Also record the money arriving',
      explain: 'Borrowed money is not income, so this only raises the account balance.',
      signed: true,
      category: false,
    };
  }
  // Paying someone back. If the borrowed cash was recorded arriving, paying it
  // back just lowers the balance again; otherwise they covered a real cost for
  // you and this repayment is when the spending is yours.
  return options.principalRecorded
    ? {
        txType: 'adjustment',
        flow: 'out',
        title: 'Also record the money leaving my account',
        explain: 'You already recorded the borrowed money arriving, so paying it back only lowers the balance.',
        signed: true,
        category: false,
      }
    : {
        txType: 'expense',
        flow: 'out',
        title: 'Also record the money leaving my account',
        explain: 'They covered the cost for you, so paying them back is when the spending is yours.',
        signed: false,
        category: true,
      };
}

export interface MoneyMoveInput {
  direction: IouDirection;
  kind: IouMoveKind;
  /** Always a positive amount; the plan decides the sign. */
  amount: Cents;
  date: ISODate;
  accountId: ID;
  person: string;
  reason?: string;
  categoryId?: ID;
  tags?: string[];
  principalRecorded?: boolean;
}

export function moneyMoveDescription(direction: IouDirection, kind: IouMoveKind, person: string, reason?: string): string {
  const who = person.trim() || 'someone';
  const base =
    direction === 'owed_to_me' ? (kind === 'principal' ? `Lent to ${who}` : `${who} paid you back`) : kind === 'principal' ? `Borrowed from ${who}` : `Paid back ${who}`;
  return reason?.trim() ? `${base} — ${reason.trim()}` : base;
}

/** Builds the transaction for a real money movement. Pure: the caller saves it. */
export function moneyMoveTransaction(input: MoneyMoveInput): Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> {
  const plan = moneyMovePlan(input.direction, input.kind, { principalRecorded: input.principalRecorded });
  const magnitude = Math.abs(Math.round(input.amount));
  const amount = plan.signed ? (plan.flow === 'in' ? magnitude : -magnitude) : magnitude;
  return {
    type: plan.txType,
    amount,
    date: input.date,
    description: moneyMoveDescription(input.direction, input.kind, input.person, input.reason),
    payee: input.person.trim() || undefined,
    categoryId: plan.category ? input.categoryId : undefined,
    accountId: input.accountId,
    adjustmentKind: plan.txType === 'adjustment' ? 'other' : undefined,
    // Lending money out and getting it back are not tax events, and they have to
    // agree or the reimbursement would push the category's tax total negative.
    // Paying back someone who covered a real cost of yours is left to the
    // category, because that cost is genuinely yours.
    taxRelated: plan.category && input.direction === 'owed_to_me' ? false : undefined,
    tags: [...new Set([IOU_TAG, ...(input.tags ?? [])])],
    attachments: [],
  };
}

// ─── Linked transactions ─────────────────────────────────────────────────────

/** Transactions this IOU created: the repayments it links by id, plus the original hand-over. */
export function relatedTransactions(data: LedgerData, iou: Iou): Transaction[] {
  const byId = new Map(data.transactions.map((t) => [t.id, t]));
  const found = new Map<ID, Transaction>();
  const principal = principalTransaction(data, iou);
  if (principal) found.set(principal.id, principal);
  for (const entry of iou.entries) {
    const tx = entry.txId ? byId.get(entry.txId) : undefined;
    if (tx) found.set(tx.id, tx);
  }
  return [...found.values()].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

/**
 * The transaction recorded for the original hand-over. The data model only
 * links repayments by id, so the hand-over is matched on the IOU's own tag,
 * person and amount — the exact shape `moneyMoveTransaction` produces.
 */
export function principalTransaction(data: LedgerData, iou: Iou): Transaction | undefined {
  const entryIds = new Set(iou.entries.map((e) => e.txId).filter(Boolean));
  const key = personKey(iou.person);
  return data.transactions.find(
    (t) =>
      !entryIds.has(t.id) &&
      t.tags.includes(IOU_TAG) &&
      t.date === iou.date &&
      Math.abs(t.amount) === iou.amount &&
      personKey(t.payee ?? '') === key &&
      t.type === moneyMovePlan(iou.direction, 'principal').txType,
  );
}
