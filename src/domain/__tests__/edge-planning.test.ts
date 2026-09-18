import { describe, expect, it } from 'vitest';

import { budgetAmountFor, budgetLine, monthBudgets } from '../budgets';
import { effectiveApr, requiredPayment, simulatePayoff, type PayoffDebt, type PayoffOptions } from '../debt';
import { emptyLedger } from '../factory';
import { allocationsByAccount, goalHistory, goalProgress, goalValueOn } from '../goals';
import { netWorthOn } from '../position';
import { amortizedPayment, buildBaseline, compareScenario, project } from '../scenarios';
import type { Account, AccountType, Budget, Goal, GoalContribution, LedgerData, RecurringItem, ScenarioChange, Transaction } from '../types';
import { validateContribution } from '../validation';

const TODAY = '2026-09-16';
const stamp = '2026-01-01T00:00:00.000Z';
let seq = 0;

function acct(id: string, type: AccountType, startingBalance: number, extra: Partial<Account> = {}): Account {
  return { id, name: id, type, startingBalance, startingDate: '2026-01-01', color: '#000', icon: 'box', tags: [], archived: false, createdAt: stamp, updatedAt: stamp, ...extra };
}
function tx(p: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'accountId'>): Transaction {
  seq++;
  return { id: `t${seq}`, date: '2026-09-01', description: 'test', tags: [], attachments: [], createdAt: stamp, updatedAt: stamp, ...p };
}
function goal(p: Partial<Goal> & Pick<Goal, 'id' | 'kind' | 'target'>): Goal {
  return { name: p.id, template: 'general', linkedAccountIds: [], startDate: '2026-01-01', icon: 'x', color: '#000', tags: [], archived: false, createdAt: stamp, updatedAt: stamp, ...p };
}
function contrib(id: string, goalId: string, date: string, amount: number, accountId = 'sav'): GoalContribution {
  return { id, goalId, date, amount, accountId, createdAt: stamp };
}
function ledger(extra: Partial<LedgerData>, accounts?: Account[]): LedgerData {
  const d = emptyLedger();
  d.accounts = accounts ?? [acct('chk', 'checking', 300_000, { spendable: true }), acct('sav', 'savings', 100_000)];
  Object.assign(d, extra);
  return d;
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

describe('budgets', () => {
  const b = (p: Partial<Budget> = {}): Budget => ({ id: 'b', categoryId: 'food', mode: 'limit', rollover: false, amounts: [{ month: '2026-07', amount: 10_000 }], ...p });

  it('amount history picks latest entry <= month regardless of array order', () => {
    const budget = b({ amounts: [{ month: '2026-06', amount: 20_000 }, { month: '2026-01', amount: 10_000 }] });
    expect(budgetAmountFor(budget, '2025-12')).toBeNull();
    expect(budgetAmountFor(budget, '2026-05')).toBe(10_000);
    expect(budgetAmountFor(budget, '2026-06')).toBe(20_000);
    expect(budgetAmountFor(budget, '2027-01')).toBe(20_000);
  });

  it('rollover positive and negative, clamped at zero', () => {
    const d = ledger({
      transactions: [
        tx({ type: 'expense', amount: 6_000, accountId: 'chk', categoryId: 'food.groceries', date: '2026-07-10' }),
        tx({ type: 'expense', amount: 12_000, accountId: 'chk', categoryId: 'food.coffee', date: '2026-08-10' }),
        tx({ type: 'refund', amount: 1_000, accountId: 'chk', categoryId: 'food.groceries', date: '2026-08-11' }),
        tx({ type: 'expense', amount: 3_000, accountId: 'chk', categoryId: 'food', date: '2026-09-02' }),
      ],
    });
    const line = budgetLine(d, b({ rollover: true }), '2026-09', TODAY)!;
    expect(line.rollover).toBe(4_000 + -1_000);
    expect(line.amount).toBe(13_000);
    expect(line.spent).toBe(3_000);
    expect(line.remaining).toBe(10_000);

    const neg = ledger({ transactions: [tx({ type: 'expense', amount: 50_000, accountId: 'chk', categoryId: 'food.groceries', date: '2026-08-10' })] });
    const nl = budgetLine(neg, b({ rollover: true }), '2026-09', TODAY)!;
    expect(nl.rollover).toBe(10_000 + (10_000 - 50_000)); // Jul unspent + Aug overspent
    expect(nl.amount).toBe(0);
    expect(nl.state).toBe('ok'); // nothing spent this month
  });

  it('budget changed mid-year: rollover uses each month’s own amount', () => {
    const d = ledger({});
    const line = budgetLine(d, b({ rollover: true, amounts: [{ month: '2026-07', amount: 10_000 }, { month: '2026-08', amount: 5_000 }] }), '2026-09', TODAY)!;
    expect(line.base).toBe(5_000);
    expect(line.rollover).toBe(15_000);
  });

  it('future month: nothing spent yet even with future-dated tx; planned counts recurring', () => {
    const rent: RecurringItem = { id: 'r', name: 'Coffee sub', kind: 'subscription', amount: 1_500, variable: false, frequency: { unit: 'week', interval: 2 }, startDate: '2026-10-02', accountId: 'chk', categoryId: 'food.coffee', autopay: true, essential: false, active: true, skipped: [], tags: [], createdAt: stamp, updatedAt: stamp };
    const d = ledger({ recurring: [rent], transactions: [tx({ type: 'expense', amount: 9_000, accountId: 'chk', categoryId: 'food.groceries', date: '2026-10-05' })] });
    const line = budgetLine(d, b(), '2026-10', TODAY)!;
    expect(line.spent).toBe(0);
    expect(line.planned).toBe(1_500 * 3); // Oct 2, 16, 30
  });

  it('subcategory budget and unbudgeted list', () => {
    const d = ledger({
      budgets: [b({ id: 'b1', categoryId: 'food.restaurants' }), b({ id: 'b2', categoryId: 'shopping' })],
      transactions: [
        tx({ type: 'expense', amount: 2_000, accountId: 'chk', categoryId: 'food.restaurants', date: '2026-09-03' }),
        tx({ type: 'expense', amount: 3_000, accountId: 'chk', categoryId: 'food.groceries', date: '2026-09-03' }),
        tx({ type: 'expense', amount: 4_000, accountId: 'chk', categoryId: 'shopping.electronics', date: '2026-09-03' }),
        tx({ type: 'expense', amount: 500, accountId: 'chk', date: '2026-09-04' }),
        tx({ type: 'debt_payment', amount: 7_000, accountId: 'chk', toAccountId: 'x', categoryId: 'financial.credit_card_payments', date: '2026-09-04' }),
      ],
    });
    const m = monthBudgets(d, '2026-09', TODAY);
    expect(m.totalBudgeted).toBe(20_000);
    expect(m.totalSpent).toBe(6_000);
    expect(m.unbudgeted).toEqual([
      { categoryId: 'food.groceries', amount: 3_000 },
      { categoryId: 'uncategorized', amount: 500 },
    ]);
  });
});

// ─── Goals ───────────────────────────────────────────────────────────────────

describe('goals', () => {
  it('allocation: add, take out, over-allocation, archived goals release money', () => {
    const d = ledger({
      goals: [goal({ id: 'ef', kind: 'savings', target: 500_000 }), goal({ id: 'trip', kind: 'savings', target: 100_000 }), goal({ id: 'old', kind: 'savings', target: 1, archived: true })],
      goalContributions: [contrib('c1', 'ef', '2026-02-01', 60_000), contrib('c2', 'trip', '2026-03-01', 30_000), contrib('c3', 'old', '2026-03-01', 50_000)],
    });
    const alloc = allocationsByAccount(d, TODAY).get('sav')!;
    expect(alloc.allocated).toBe(90_000);
    expect(alloc.unallocated).toBe(10_000);
    const v = (amount: number, goalId = 'ef') => validateContribution(d, contrib('n', goalId, TODAY, amount), TODAY);
    expect(v(10_000).amount).toBeUndefined();
    expect(v(10_001).amount).toBeTruthy();
    expect(v(-60_000).amount).toBeUndefined();
    expect(v(-60_001).amount).toBeTruthy();
    expect(v(-30_001, 'trip').amount).toBeTruthy();
    expect(v(0).amount).toBeTruthy();
    expect(v(1.5).amount).toBeTruthy();
    expect(validateContribution(d, { ...contrib('n', 'ef', TODAY, 100), accountId: undefined }, TODAY).accountId).toBeTruthy();
    expect(validateContribution(d, contrib('n', 'missing', TODAY, 100), TODAY).form).toBeTruthy();

    // Balance falls below allocations → flagged.
    const spent = ledger({ ...d, transactions: [tx({ type: 'transfer', amount: 20_000, accountId: 'sav', toAccountId: 'chk', date: '2026-09-10' })] });
    const a2 = allocationsByAccount(spent, TODAY).get('sav')!;
    expect(a2.overAllocated).toBe(true);
    expect(a2.unallocated).toBe(-10_000);
  });

  it('future-dated allocations cannot be used to over-allocate', () => {
    const d = ledger({
      goals: [goal({ id: 'ef', kind: 'savings', target: 500_000 })],
      goalContributions: [contrib('c1', 'ef', '2026-09-20', 80_000)],
    });
    const r = validateContribution(d, contrib('c2', 'ef', TODAY, 50_000), TODAY);
    // BUG: allocationsByAccount ignores contributions dated after `today`, so validateContribution
    // accepts 50_000 even though an 80_000 allocation is already scheduled against a 100_000 account;
    // on Sep 20 the account is over-allocated by 30_000. Fix in validation.ts validateContribution:
    // compute the check at the latest relevant date (include all contributions for the account
    // regardless of date, e.g. allocationsByAccount(data, '9999-12-31')), or reject future dates.
    expect(r.amount).toBeTruthy();
  });

  it('debt payoff, investment and net worth goal values', () => {
    const accounts = [acct('chk', 'checking', 300_000), acct('loan', 'auto_loan', 1_000_000), acct('ira', 'roth_ira', 200_000)];
    const d = ledger({
      transactions: [
        tx({ type: 'debt_payment', amount: 37_500, accountId: 'chk', toAccountId: 'loan', date: '2026-09-05' }),
        tx({ type: 'investment_contribution', amount: 50_000, accountId: 'chk', toAccountId: 'ira', date: '2026-09-06' }),
      ],
      goals: [
        goal({ id: 'debt', kind: 'debt_payoff', target: 999, startValue: 1_000_000, linkedAccountIds: ['loan'] }),
        goal({ id: 'inv', kind: 'investment', target: 500_000, linkedAccountIds: ['ira'] }),
        goal({ id: 'nw', kind: 'net_worth', target: 0 }),
      ],
    }, accounts);
    const debt = goalProgress(d, d.goals[0], TODAY);
    expect(debt.current).toBe(37_500);
    expect(debt.target).toBe(1_000_000);
    expect(debt.remaining).toBe(962_500);
    expect(debt.owed).toBe(962_500);
    expect(goalValueOn(d, d.goals[1], TODAY)).toBe(250_000);
    expect(goalValueOn(d, d.goals[2], TODAY)).toBe(netWorthOn(d, TODAY).netWorth);
    const nw = goalProgress(d, d.goals[2], TODAY);
    expect(nw.current).toBe(-500_000);
    expect(nw.remaining).toBe(500_000);
    expect(nw.status).toBe('stalled'); // payments/contributions move money, net worth unchanged
  });

  it('status boundaries: complete, no_date, behind, on_track, stalled; requiredMonthly with past target date', () => {
    const contributions = [contrib('a', 'g', '2026-06-20', 10_000), contrib('b', 'g', '2026-07-20', 10_000), contrib('c', 'g', '2026-08-20', 10_000)];
    const mk = (g: Partial<Goal>) => {
      const d = ledger({ goals: [goal({ id: 'g', kind: 'savings', target: 60_000, ...g })], goalContributions: contributions });
      return goalProgress(d, d.goals[0], TODAY);
    };
    expect(mk({ target: 30_000 }).status).toBe('complete');
    expect(mk({ target: 30_000 }).projectedDate).toBe(TODAY);
    expect(mk({}).status).toBe('no_date');
    expect(mk({ targetDate: '2026-10-01' }).status).toBe('behind');
    expect(mk({ targetDate: '2027-09-01' }).status).toBe('on_track');
    const past = mk({ targetDate: '2026-01-01' });
    expect(past.requiredMonthly).toBe(30_000);
    expect(past.status).toBe('behind');
    const stalled = ledger({ goals: [goal({ id: 'g', kind: 'savings', target: 60_000 })], goalContributions: [contrib('a', 'g', '2026-02-01', 10_000)] });
    expect(goalProgress(stalled, stalled.goals[0], TODAY).status).toBe('stalled');
  });

  it('a brand-new goal’s starting allocation is not extrapolated as a monthly rate', () => {
    const d = ledger({
      goals: [goal({ id: 'g', kind: 'savings', target: 100_000, startDate: '2026-09-10', targetDate: '2027-09-10' })],
      goalContributions: [contrib('a', 'g', '2026-09-10', 50_000)],
    });
    const p = goalProgress(d, d.goals[0], TODAY);
    // BUG: for goals younger than the 90-day window, the rate is (current − value before startDate)
    // / spanDays, so a one-off $500 starting allocation 6 days ago becomes a ~$2,500/mo rate,
    // projectedDate lands within days and the goal reports 'on_track'. Fix in goals.ts goalProgress:
    // use a minimum span (e.g. `Math.max(30, diffDays(since, today))`) and for savings goals treat
    // contributions dated on goal.startDate as the starting value (past = value on startDate).
    expect(p.monthlyRate).toBeLessThanOrEqual(50_000);
    expect(p.status).not.toBe('on_track');
  });

  it('goalHistory: ascending month-ends ending today', () => {
    const d = ledger({ goals: [goal({ id: 'g', kind: 'savings', target: 1 })], goalContributions: [contrib('a', 'g', '2026-03-15', 5_000)] });
    const h = goalHistory(d, d.goals[0], '2026-03-31', 4);
    expect(h.at(-1)!.value).toBe(5_000);
    // BUG: for i >= 1 the point is addDays(addMonths(today, -i, 1), -1), i.e. the end of month
    // (today − i − 1), so last month's end is never plotted (for Sep 16 the series jumps from
    // Jul 31 straight to today) and the chart spans 13 months instead of 12. Fix in goals.ts goalHistory:
    //   const date = i === 0 ? today : addDays(addMonths(today, -i + 1, 1), -1);
    expect(h.map((x) => x.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    const leap = goalHistory(d, d.goals[0], '2028-03-01', 2);
    expect(leap.map((x) => x.date)).toEqual(['2028-02-29', '2028-03-01']);
  });
});

// ─── Debt payoff ─────────────────────────────────────────────────────────────

describe('debt simulation', () => {
  const opts = (p: Partial<PayoffOptions> = {}): PayoffOptions => ({ startMonth: '2026-10', extraMonthly: 0, order: 'listed', rollover: true, ...p });
  const conserved = (debts: PayoffDebt[], r: ReturnType<typeof simulatePayoff>) =>
    expect(r.totalPaid).toBe(debts.reduce((s, d) => s + d.balance, 0) + r.totalInterest);

  it('effectiveApr boundary on promo expiry day', () => {
    const a = { apr: 24, promoApr: 0, promoExpires: '2026-12-31' };
    expect(effectiveApr(a, '2026-12-31')).toBe(0);
    expect(effectiveApr(a, '2027-01-01')).toBe(24);
    expect(effectiveApr({ apr: undefined }, TODAY)).toBe(0);
  });

  it('promo APR expiring mid-simulation starts charging interest', () => {
    const debts: PayoffDebt[] = [{ id: 'a', name: 'A', balance: 120_000, apr: 24, promoApr: 0, promoExpires: '2026-12-31', payment: 10_000 }];
    const r = simulatePayoff(debts, opts());
    expect(r.series[3].total).toBe(90_000); // Oct..Dec, no interest
    expect(r.series[4].total).toBe(90_000 + 1_800 - 10_000); // Jan: 2% of 90_000
    expect(r.perDebt[0].interest).toBeGreaterThan(0);
    conserved(debts, r);
  });

  it('zero-balance debts and payment exactly equal to interest', () => {
    const none = simulatePayoff([{ id: 'z', name: 'Z', balance: 0, apr: 20, payment: 5_000 }], opts());
    expect(none.months).toBe(0);
    expect(none.totalPaid).toBe(0);
    const flat = simulatePayoff([{ id: 'a', name: 'A', balance: 100_000, apr: 12, payment: 1_000 }], opts());
    expect(flat.stuck).toBe(true);
    expect(flat.months).toBeNull();
    expect(flat.debtFreeMonth).toBeNull();
  });

  it('rollover redirects freed payments', () => {
    const debts: PayoffDebt[] = [
      { id: 'small', name: 'S', balance: 20_000, apr: 0, payment: 10_000 },
      { id: 'big', name: 'B', balance: 100_000, apr: 0, payment: 10_000 },
    ];
    const on = simulatePayoff(debts, opts({ rollover: true }));
    const off = simulatePayoff(debts, opts({ rollover: false }));
    expect(on.perDebt.find((x) => x.id === 'big')!.payoffMonth).toBe('2027-03'); // 2×10k + 4×20k... = 6 months
    expect(off.perDebt.find((x) => x.id === 'big')!.payoffMonth).toBe('2027-07'); // 10 months
    conserved(debts, on);
    conserved(debts, off);
  });

  it('lump sum in month 0 and perDebtExtra', () => {
    const debts: PayoffDebt[] = [{ id: 'a', name: 'A', balance: 100_000, apr: 0, payment: 10_000 }];
    const lump = simulatePayoff(debts, opts({ lumpSum: { amount: 50_000, month: 0 } }));
    expect(lump.series[1].total).toBe(40_000);
    expect(lump.months).toBe(5);
    const extra = simulatePayoff(debts, opts({ perDebtExtra: { a: 15_000 } }));
    expect(extra.months).toBe(4);
    conserved(debts, lump);
    conserved(debts, extra);
    const overLump = simulatePayoff(debts, opts({ lumpSum: { amount: 1_000_000, month: 0 } }));
    expect(overLump.months).toBe(1);
    expect(overLump.debtFreeMonth).toBe('2026-10');
    conserved(debts, overLump);
  });

  it('listed order: debts missing from listedOrder go last, not first', () => {
    const debts: PayoffDebt[] = [
      { id: 'a', name: 'A', balance: 100_000, apr: 0, payment: 1_000 },
      { id: 'b', name: 'B', balance: 100_000, apr: 0, payment: 1_000 },
    ];
    const r = simulatePayoff(debts, opts({ extraMonthly: 50_000, listedOrder: ['b'] }));
    // BUG: `order.indexOf(id)` is -1 for unlisted debts, so 'a' sorts ahead of the explicitly
    // prioritised 'b'. Fix in debt.ts simulatePayoff:
    //   const rank = (id: ID) => { const i = order.indexOf(id); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
    //   return open.sort((a, b) => rank(a.id) - rank(b.id));
    const b = r.perDebt.find((x) => x.id === 'b')!;
    const a = r.perDebt.find((x) => x.id === 'a')!;
    expect(b.payoffMonth! < a.payoffMonth!).toBe(true);
  });

  it('highest_apr and lowest_balance orderings', () => {
    const debts: PayoffDebt[] = [
      { id: 'low', name: 'L', balance: 50_000, apr: 5, payment: 1_000 },
      { id: 'high', name: 'H', balance: 200_000, apr: 25, payment: 5_000 },
    ];
    const av = simulatePayoff(debts, opts({ order: 'highest_apr', extraMonthly: 30_000 }));
    const sn = simulatePayoff(debts, opts({ order: 'lowest_balance', extraMonthly: 30_000 }));
    expect(av.totalInterest).toBeLessThan(sn.totalInterest);
    expect(sn.perDebt[0].payoffMonth! < av.perDebt[0].payoffMonth!).toBe(true);
    conserved(debts, av);
    conserved(debts, sn);
  });

  it('requiredPayment formula', () => {
    const card = acct('c', 'credit_card', 0, { apr: 24 });
    expect(requiredPayment(card, 500_000)).toBe(5_000 + 10_000);
    expect(requiredPayment(card, 50_000)).toBe(2_500);
    expect(requiredPayment(card, 1_000)).toBe(1_000);
    expect(requiredPayment({ ...card, minimumPayment: 3_500 }, 2_000)).toBe(2_000);
    expect(requiredPayment(acct('l', 'auto_loan', 0, { paymentAmount: 42_500 }), 1_000_000)).toBe(42_500);
    expect(requiredPayment(acct('l', 'auto_loan', 0, { paymentAmount: 42_500 }), 10_000)).toBe(10_000);
  });
});

// ─── Scenarios ───────────────────────────────────────────────────────────────

describe('scenarios', () => {
  const build = () => {
    const d = ledger(
      {
        incomeSources: [{ id: 'job', name: 'Job', type: 'salary', frequency: { unit: 'month', interval: 1 }, anchorDate: '2026-01-01', expectedNet: 400_000, depositAccountId: 'chk', active: true, tags: [], createdAt: stamp, updatedAt: stamp }],
        recurring: [{ id: 'nf', name: 'Netflix', kind: 'subscription', amount: 1_549, variable: false, frequency: { unit: 'month', interval: 1 }, startDate: '2026-01-12', accountId: 'chk', autopay: true, essential: false, active: true, skipped: [], tags: [], createdAt: stamp, updatedAt: stamp }],
      },
      [acct('chk', 'checking', 300_000, { spendable: true }), acct('sav', 'savings', 100_000), acct('loan', 'personal_loan', 120_000, { apr: 0, paymentAmount: 10_000 })],
    );
    d.settings = { ...d.settings, investmentReturn: 0 };
    return d;
  };
  const diff = (changes: ScenarioChange[], months = 12) => {
    const r = compareScenario(build(), changes, months, TODAY);
    return r.scenario.months.map((m, i) => ({ surplus: m.surplus - r.baseline.months[i].surplus, nw: m.netWorth - r.baseline.months[i].netWorth, r }));
  };

  it('baseline month 0 net worth = today + surplus', () => {
    const d = build();
    const r = compareScenario(d, [], 3, TODAY);
    expect(r.baseline.months[0].netWorth).toBe(netWorthOn(d, TODAY).netWorth + r.baseline.months[0].surplus + r.baseline.months[0].debtPayments);
  });

  it('income +$500/mo and +10%', () => {
    expect(diff([{ id: 'x', type: 'income_change', mode: 'amount', value: 50_000, startMonth: 0 }]).every((m) => m.surplus === 50_000)).toBe(true);
    expect(diff([{ id: 'x', type: 'income_change', mode: 'percent', value: 10, startMonth: 0 }])[0].surplus).toBe(40_000);
  });

  it('cancel a $15.49 subscription from month 3', () => {
    const d = diff([{ id: 'x', type: 'cancel_recurring', recurringId: 'nf', startMonth: 3 }]);
    expect(d.slice(0, 3).map((m) => m.surplus)).toEqual([0, 0, 0]);
    expect(d.slice(3).every((m) => m.surplus === 1_549)).toBe(true);
    expect(d[11].nw).toBe(1_549 * 9);
  });

  it('one-time windfall and expense', () => {
    const w = diff([{ id: 'x', type: 'one_time', label: 'Bonus', amount: 100_000, month: 1 }]);
    expect(w.map((m) => m.nw).slice(0, 3)).toEqual([0, 100_000, 100_000]);
    const e = diff([{ id: 'x', type: 'one_time', label: 'Deposit', amount: -100_000, month: 1 }]);
    expect(e.map((m) => m.nw).slice(0, 3)).toEqual([0, -100_000, -100_000]);
  });

  it('new_loan amortized payment matches standard formula', () => {
    const P = 2_000_000, r = 0.06 / 12, n = 60;
    const standard = (P * r) / (1 - Math.pow(1 + r, -n));
    expect(Math.abs(amortizedPayment(P, 6, n) - standard)).toBeLessThan(1);
    expect(Math.abs(amortizedPayment(P, 6, n) - 38_666)).toBeLessThanOrEqual(1);
    expect(Math.abs(amortizedPayment(100_000, 0, 3) - 100_000 / 3)).toBeLessThan(1);
    const res = compareScenario(build(), [{ id: 'car', type: 'new_loan', label: 'Car', principal: P, apr: 6, termMonths: n, downPayment: 300_000, assetValue: 2_300_000, startMonth: 0 }], 72, TODAY);
    // A fully amortized loan is paid off within its term.
    const debtAt = (m: number) => res.scenario.months[m].debt;
    // First payment lands in the purchase month (index 0); allow one residual-cent month.
    expect(debtAt(n)).toBe(0);
    expect(debtAt(n - 2)).toBeGreaterThan(0);
  });

  it('debtFreeMonth and extra payments', () => {
    const base = compareScenario(build(), [], 24, TODAY);
    expect(base.baseline.debtFreeMonth).toBe('2027-09'); // 12 × $100 from Oct 2026
    const extra = compareScenario(build(), [{ id: 'x', type: 'extra_debt_payment', monthlyAmount: 10_000, startMonth: 0 }], 24, TODAY);
    expect(extra.scenario.debtFreeMonth).toBe('2027-03');
  });

  it('compareScenario does not mutate data', () => {
    const d = build();
    const before = JSON.stringify(d);
    compareScenario(d, [{ id: 'car', type: 'new_loan', label: 'Car', principal: 500_000, apr: 5, termMonths: 24, downPayment: 0, assetValue: 500_000, startMonth: 1 }, { id: 'e', type: 'extra_debt_payment', monthlyAmount: 5_000, startMonth: 0 }], 24, TODAY);
    expect(JSON.stringify(d)).toBe(before);
  });

  it('projection starting net worth matches netWorthOn when a card has a credit balance', () => {
    const d = build();
    d.accounts.push(acct('card', 'credit_card', -5_000));
    const r = compareScenario(d, [], 1, TODAY);
    const m = r.baseline.months[0];
    // BUG: payoffDebtsFrom drops liabilities with balance <= 0 and buildBaseline only sums asset
    // accounts, so a card carrying a −$50 credit balance disappears from the projection (net worth
    // understated by $50 vs netWorthOn). Fix in scenarios.ts buildBaseline: add
    //   for liabilities with balance < 0: otherAssets += -balance
    expect(m.netWorth).toBe(netWorthOn(d, TODAY).netWorth + m.surplus + m.debtPayments);
  });

  it('horizon 0 does not return an undefined end', () => {
    const p = project(buildBaseline(build(), TODAY), [], 0);
    // BUG (minor): project(…, 0).end is undefined although typed ProjectionMonth; screens reading
    // `.end.netWorth` crash. Fix: clamp horizonMonths to >= 1 or make `end` nullable.
    expect(p.end).toBeDefined();
  });
});
