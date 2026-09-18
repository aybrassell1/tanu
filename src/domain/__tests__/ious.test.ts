import { describe, expect, it } from 'vitest';

import { emptyLedger } from '../factory';
import {
  ageBucket,
  canRepay,
  iouAging,
  iouBalance,
  iouSummary,
  iousForPerson,
  maxRepayment,
  moneyMoveDescription,
  moneyMovePlan,
  moneyMoveTransaction,
  openIous,
  principalTransaction,
  relatedTransactions,
} from '../ious';
import { incomeAmount, postingsFor, spendingAmount } from '../ledger';
import type { Account, Iou, IouEntry, LedgerData, Transaction } from '../types';

const TODAY = '2026-09-17';
const stamp = '2026-01-01T00:00:00.000Z';

function iou(p: Partial<Iou> & Pick<Iou, 'id' | 'person' | 'direction' | 'amount'>): Iou {
  return { date: TODAY, entries: [], tags: [], archived: false, createdAt: stamp, updatedAt: stamp, ...p };
}
function entry(id: string, amount: number, date = TODAY, txId?: string): IouEntry {
  return { id, date, amount, txId };
}
function ledger(ious: Iou[], transactions: Transaction[] = []): LedgerData {
  const d = emptyLedger();
  d.ious = ious;
  d.transactions = transactions;
  return d;
}
const checking: Account = {
  id: 'chk',
  name: 'Checking',
  type: 'checking',
  startingBalance: 100_000,
  startingDate: '2026-01-01',
  color: '#000',
  icon: 'box',
  tags: [],
  archived: false,
  createdAt: stamp,
  updatedAt: stamp,
};
const accounts = new Map([[checking.id, checking]]);
const asTx = (input: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>, id = 'tx1'): Transaction => ({ ...input, id, createdAt: stamp, updatedAt: stamp });

// ─── Balances ────────────────────────────────────────────────────────────────

describe('iouBalance', () => {
  it('a fresh IOU is fully outstanding', () => {
    const b = iouBalance(iou({ id: 'a', person: 'Sam', direction: 'owed_to_me', amount: 4_500 }));
    expect(b).toMatchObject({ amount: 4_500, repaid: 0, outstanding: 4_500, settled: false });
    expect(b.ratio).toBe(0);
  });

  it('partial repayments reduce what is outstanding without settling it', () => {
    const b = iouBalance(iou({ id: 'a', person: 'Sam', direction: 'owed_to_me', amount: 10_000, entries: [entry('e1', 2_500), entry('e2', 1_500)] }));
    expect(b.repaid).toBe(4_000);
    expect(b.outstanding).toBe(6_000);
    expect(b.settled).toBe(false);
    expect(b.ratio).toBeCloseTo(0.4);
  });

  it('repayments covering the amount settle it', () => {
    const b = iouBalance(iou({ id: 'a', person: 'Sam', direction: 'i_owe', amount: 10_000, entries: [entry('e1', 4_000), entry('e2', 6_000)], settledOn: TODAY }));
    expect(b.outstanding).toBe(0);
    expect(b.settled).toBe(true);
    expect(b.ratio).toBe(1);
  });

  it('never reports a negative outstanding, even with damaged data', () => {
    const b = iouBalance(iou({ id: 'a', person: 'Sam', direction: 'owed_to_me', amount: 5_000, entries: [entry('e1', 9_000)] }));
    expect(b.repaid).toBe(9_000);
    expect(b.outstanding).toBe(0);
    expect(b.settled).toBe(true);
  });
});

describe('canRepay / maxRepayment', () => {
  const partial = iou({ id: 'a', person: 'Sam', direction: 'owed_to_me', amount: 10_000, entries: [entry('e1', 3_000)] });

  it('allows anything up to the outstanding amount', () => {
    expect(maxRepayment(partial)).toBe(7_000);
    expect(canRepay(partial, 1)).toBe(true);
    expect(canRepay(partial, 7_000)).toBe(true);
  });

  it('rejects over-repayment, zero, negatives and fractional cents', () => {
    expect(canRepay(partial, 7_001)).toBe(false);
    expect(canRepay(partial, 0)).toBe(false);
    expect(canRepay(partial, -500)).toBe(false);
    expect(canRepay(partial, 100.5)).toBe(false);
  });

  it('a settled IOU takes no more repayments', () => {
    const settled = iou({ id: 'a', person: 'Sam', direction: 'owed_to_me', amount: 5_000, entries: [entry('e1', 5_000)] });
    expect(maxRepayment(settled)).toBe(0);
    expect(canRepay(settled, 1)).toBe(false);
  });
});

// ─── Summary & grouping ──────────────────────────────────────────────────────

describe('iouSummary', () => {
  const data = () =>
    ledger([
      iou({ id: '1', person: 'Sam', direction: 'owed_to_me', amount: 4_000, date: '2026-09-10' }),
      iou({ id: '2', person: 'sam ', direction: 'owed_to_me', amount: 6_000, date: '2026-08-01', entries: [entry('e1', 1_000)] }),
      iou({ id: '3', person: 'Sam', direction: 'i_owe', amount: 2_000, date: '2026-09-01' }),
      iou({ id: '4', person: 'Mom', direction: 'i_owe', amount: 50_000, date: '2026-03-01', dueDate: '2026-09-01' }),
      iou({ id: '5', person: 'Alex', direction: 'owed_to_me', amount: 1_500, date: '2026-05-01', entries: [entry('e1', 1_500)] }),
      iou({ id: '6', person: 'Gone', direction: 'owed_to_me', amount: 9_900, date: '2026-05-01', archived: true }),
    ]);

  it('adds up both sides from outstanding amounts only', () => {
    const s = iouSummary(data(), TODAY);
    expect(s.owedToMe).toBe(9_000); // 4000 + (6000 - 1000)
    expect(s.iOwe).toBe(52_000);
    expect(s.net).toBe(-43_000);
  });

  it('leaves out settled and archived IOUs', () => {
    const s = iouSummary(data(), TODAY);
    expect(s.people.map((p) => p.person)).not.toContain('Alex');
    expect(s.people.map((p) => p.person)).not.toContain('Gone');
    expect(openIous(data())).toHaveLength(4);
  });

  it('groups by person regardless of case or spacing, and nets each side', () => {
    const s = iouSummary(data(), TODAY);
    const sam = s.people.find((p) => p.person === 'Sam')!;
    expect(sam.owedToMe).toBe(9_000);
    expect(sam.iOwe).toBe(2_000);
    expect(sam.net).toBe(7_000);
    expect(sam.ious).toHaveLength(3);
    expect(sam.oldest).toBe('2026-08-01');
  });

  it('sorts people by how much is on the table', () => {
    expect(iouSummary(data(), TODAY).people.map((p) => p.person)).toEqual(['Mom', 'Sam']);
  });

  it('marks IOUs past their due date as overdue', () => {
    const s = iouSummary(data(), TODAY);
    expect(s.overdue.map((i) => i.id)).toEqual(['4']);
    expect(s.people.find((p) => p.person === 'Mom')!.overdue).toBe(1);
  });

  it('a due date in the future is not overdue', () => {
    const s = iouSummary(ledger([iou({ id: '1', person: 'Sam', direction: 'owed_to_me', amount: 1_000, dueDate: '2026-12-01' })]), TODAY);
    expect(s.overdue).toHaveLength(0);
  });

  it('an empty ledger summarises to zero', () => {
    const s = iouSummary(emptyLedger(), TODAY);
    expect(s).toMatchObject({ owedToMe: 0, iOwe: 0, net: 0, people: [], overdue: [] });
  });
});

describe('iousForPerson', () => {
  it('returns one person’s IOUs, open first then newest', () => {
    const data = ledger([
      iou({ id: '1', person: 'Sam', direction: 'owed_to_me', amount: 1_000, date: '2026-01-01' }),
      iou({ id: '2', person: 'SAM', direction: 'i_owe', amount: 2_000, date: '2026-05-01', entries: [entry('e1', 2_000)] }),
      iou({ id: '3', person: 'Sam', direction: 'owed_to_me', amount: 3_000, date: '2026-09-01' }),
      iou({ id: '4', person: 'Jordan', direction: 'owed_to_me', amount: 3_000, date: '2026-09-01' }),
    ]);
    expect(iousForPerson(data, 'sam').map((i) => i.id)).toEqual(['3', '1', '2']);
    expect(iousForPerson(data, 'nobody')).toEqual([]);
  });
});

// ─── Aging ───────────────────────────────────────────────────────────────────

describe('iouAging', () => {
  const data = () =>
    ledger([
      iou({ id: '1', person: 'Sam', direction: 'owed_to_me', amount: 1_000, date: '2026-09-15' }), // 2 days
      iou({ id: '2', person: 'Alex', direction: 'owed_to_me', amount: 2_000, date: '2026-08-20' }), // 28 days
      iou({ id: '3', person: 'Mom', direction: 'i_owe', amount: 4_000, date: '2026-08-18' }), // 30 days
      iou({ id: '4', person: 'Pat', direction: 'owed_to_me', amount: 8_000, date: '2026-01-01' }), // 259 days
      iou({ id: '5', person: 'Old', direction: 'owed_to_me', amount: 500, date: '2026-01-01', entries: [entry('e1', 500)] }),
    ]);

  it('buckets by how long the money has been out', () => {
    const buckets = iouAging(data(), TODAY);
    expect(buckets.map((b) => b.bucket)).toEqual(['under_month', 'one_to_three', 'older']);
    expect(buckets[0].ious.map((i) => i.id)).toEqual(['2', '1']);
    expect(buckets[1].ious.map((i) => i.id)).toEqual(['3']);
    expect(buckets[2].ious.map((i) => i.id)).toEqual(['4']);
  });

  it('splits each bucket by direction and leaves settled IOUs out', () => {
    const buckets = iouAging(data(), TODAY);
    expect(buckets[0]).toMatchObject({ owedToMe: 3_000, iOwe: 0, count: 2 });
    expect(buckets[1]).toMatchObject({ owedToMe: 0, iOwe: 4_000, count: 1 });
    expect(buckets[2]).toMatchObject({ owedToMe: 8_000, iOwe: 0, count: 1 });
  });

  it('bucket edges fall on 30 and 90 days', () => {
    const at = (date: string) => ageBucket(iou({ id: 'x', person: 'p', direction: 'owed_to_me', amount: 100, date }), TODAY);
    expect(at('2026-08-19')).toBe('under_month'); // 29 days
    expect(at('2026-08-18')).toBe('one_to_three'); // 30 days
    expect(at('2026-06-20')).toBe('one_to_three'); // 89 days
    expect(at('2026-06-19')).toBe('older'); // 90 days
  });

  it('always returns all three buckets on an empty ledger', () => {
    expect(iouAging(emptyLedger(), TODAY).every((b) => b.count === 0 && b.owedToMe === 0 && b.iOwe === 0)).toBe(true);
  });
});

// ─── Money movement ──────────────────────────────────────────────────────────

describe('moneyMovePlan', () => {
  it('lending money out is spending, and getting it back is a reimbursement — never income', () => {
    expect(moneyMovePlan('owed_to_me', 'principal')).toMatchObject({ txType: 'expense', flow: 'out' });
    const back = moneyMovePlan('owed_to_me', 'repayment');
    expect(back).toMatchObject({ txType: 'reimbursement', flow: 'in' });
    expect(back.explain).toMatch(/not income|never be counted twice|counted twice/i);
  });

  it('borrowed money arrives as a balance adjustment, not income', () => {
    expect(moneyMovePlan('i_owe', 'principal')).toMatchObject({ txType: 'adjustment', flow: 'in', signed: true, category: false });
  });

  it('paying someone back is spending only when the money never arrived in your books', () => {
    expect(moneyMovePlan('i_owe', 'repayment')).toMatchObject({ txType: 'expense', flow: 'out' });
    expect(moneyMovePlan('i_owe', 'repayment', { principalRecorded: true })).toMatchObject({ txType: 'adjustment', flow: 'out', signed: true });
  });
});

describe('moneyMoveTransaction', () => {
  const base = { amount: 4_500, date: TODAY, accountId: 'chk', person: ' Sam ' } as const;

  it('lending out leaves the account and counts as spending once', () => {
    const tx = asTx(moneyMoveTransaction({ ...base, direction: 'owed_to_me', kind: 'principal', categoryId: 'cat' }));
    expect(tx.type).toBe('expense');
    expect(tx.amount).toBe(4_500);
    expect(tx.payee).toBe('Sam');
    expect(tx.tags).toContain('iou');
    expect(spendingAmount(tx)).toBe(4_500);
    expect(incomeAmount(tx)).toBe(0);
    expect(postingsFor(tx, accounts)).toEqual([{ accountId: 'chk', delta: -4_500, date: TODAY, txId: 'tx1' }]);
  });

  it('a repayment received cancels that spending instead of adding income', () => {
    const lent = asTx(moneyMoveTransaction({ ...base, direction: 'owed_to_me', kind: 'principal', categoryId: 'cat' }), 'lend');
    const back = asTx(moneyMoveTransaction({ ...base, direction: 'owed_to_me', kind: 'repayment', categoryId: 'cat' }), 'back');
    expect(back.type).toBe('reimbursement');
    expect(incomeAmount(back)).toBe(0);
    expect(spendingAmount(lent) + spendingAmount(back)).toBe(0);
    const net = [...postingsFor(lent, accounts), ...postingsFor(back, accounts)].reduce((s, p) => s + p.delta, 0);
    expect(net).toBe(0);
  });

  it('borrowing raises the balance without touching income or spending', () => {
    const tx = asTx(moneyMoveTransaction({ ...base, direction: 'i_owe', kind: 'principal' }));
    expect(tx.type).toBe('adjustment');
    expect(tx.amount).toBe(4_500);
    expect(tx.adjustmentKind).toBe('other');
    expect(tx.categoryId).toBeUndefined();
    expect(incomeAmount(tx)).toBe(0);
    expect(spendingAmount(tx)).toBe(0);
    expect(postingsFor(tx, accounts)[0].delta).toBe(4_500);
  });

  it('paying back borrowed cash that was recorded lowers the balance by a signed adjustment', () => {
    const got = asTx(moneyMoveTransaction({ ...base, direction: 'i_owe', kind: 'principal' }), 'in');
    const paid = asTx(moneyMoveTransaction({ ...base, direction: 'i_owe', kind: 'repayment', principalRecorded: true }), 'out');
    expect(paid.amount).toBe(-4_500);
    expect(spendingAmount(paid)).toBe(0);
    const net = [...postingsFor(got, accounts), ...postingsFor(paid, accounts)].reduce((s, p) => s + p.delta, 0);
    expect(net).toBe(0);
  });

  it('paying back a friend who covered a cost is the spending, and the category decides its tax treatment', () => {
    const tx = asTx(moneyMoveTransaction({ ...base, direction: 'i_owe', kind: 'repayment', categoryId: 'food' }));
    expect(tx.type).toBe('expense');
    expect(tx.categoryId).toBe('food');
    expect(spendingAmount(tx)).toBe(4_500);
    expect(tx.taxRelated).toBeUndefined();
  });

  it('both sides of a loan opt out of taxes together, so the category never goes negative', () => {
    const lent = moneyMoveTransaction({ ...base, direction: 'owed_to_me', kind: 'principal', categoryId: 'food' });
    const back = moneyMoveTransaction({ ...base, direction: 'owed_to_me', kind: 'repayment', categoryId: 'food' });
    expect(lent.taxRelated).toBe(false);
    expect(back.taxRelated).toBe(false);
  });

  it('describes itself in plain words and keeps the user tags', () => {
    expect(moneyMoveDescription('owed_to_me', 'principal', 'Sam', 'dinner')).toBe('Lent to Sam — dinner');
    expect(moneyMoveDescription('i_owe', 'repayment', 'Mom')).toBe('Paid back Mom');
    expect(moneyMoveTransaction({ ...base, direction: 'owed_to_me', kind: 'principal', tags: ['trip', 'iou'] }).tags).toEqual(['iou', 'trip']);
  });
});

describe('relatedTransactions', () => {
  it('finds the hand-over and every linked repayment, newest first', () => {
    const lend = asTx(moneyMoveTransaction({ amount: 4_500, date: '2026-09-01', accountId: 'chk', person: 'Sam', direction: 'owed_to_me', kind: 'principal' }), 'lend');
    const back = asTx(moneyMoveTransaction({ amount: 1_500, date: '2026-09-10', accountId: 'chk', person: 'Sam', direction: 'owed_to_me', kind: 'repayment' }), 'back');
    const unrelated = asTx(moneyMoveTransaction({ amount: 4_500, date: '2026-09-01', accountId: 'chk', person: 'Jordan', direction: 'owed_to_me', kind: 'principal' }), 'other');
    const it1 = iou({ id: '1', person: 'Sam', direction: 'owed_to_me', amount: 4_500, date: '2026-09-01', entries: [entry('e1', 1_500, '2026-09-10', 'back')] });
    const data = ledger([it1], [lend, back, unrelated]);

    expect(principalTransaction(data, it1)?.id).toBe('lend');
    expect(relatedTransactions(data, it1).map((t) => t.id)).toEqual(['back', 'lend']);
  });

  it('finds nothing when the user declined to record any money movement', () => {
    const it1 = iou({ id: '1', person: 'Sam', direction: 'owed_to_me', amount: 4_500, entries: [entry('e1', 1_000)] });
    const data = ledger([it1]);
    expect(principalTransaction(data, it1)).toBeUndefined();
    expect(relatedTransactions(data, it1)).toEqual([]);
  });
});
