import { describe, expect, it } from 'vitest';

import { debtLines, debtSummary } from '../debt';
import { emptyLedger } from '../factory';
import { filterTransactions, emptyFilters, filteredTotals } from '../filters';
import { balanceOn, balanceSeries, creditInfo, debtActivity, indexLedger, investmentInfo } from '../ledger';
import { assetValueOn, netWorthOn, netWorthSeries } from '../position';
import { categoryAverages, monthlyReview, periodStats, yearOverYear } from '../reports';
import { searchLedger } from '../search';
import type { Account, AccountType, Asset, LedgerData, Transaction } from '../types';
import { validateAccount, validateRecurring, validateTransaction } from '../validation';

const TODAY = '2026-09-16';
const stamp = '2026-01-01T00:00:00.000Z';
let seq = 0;

function acct(id: string, type: AccountType, startingBalance: number, extra: Partial<Account> = {}): Account {
  return { id, name: id, type, startingBalance, startingDate: '2026-01-01', color: '#000', icon: 'box', tags: [], archived: false, createdAt: stamp, updatedAt: stamp, ...extra };
}
function tx(p: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'accountId'>): Transaction {
  seq++;
  return { id: `t${seq}`, date: '2026-09-01', description: 'test', tags: [], attachments: [], createdAt: `2026-01-01T00:00:${String(seq % 60).padStart(2, '0')}.000Z`, updatedAt: stamp, ...p };
}
function ledger(accounts: Account[], transactions: Transaction[] = [], extra: Partial<LedgerData> = {}): LedgerData {
  const d = emptyLedger();
  d.accounts = accounts;
  d.transactions = transactions;
  Object.assign(d, extra);
  return d;
}
const base = () => [acct('chk', 'checking', 100_000, { spendable: true }), acct('sav', 'savings', 50_000), acct('card', 'credit_card', 20_000, { creditLimit: 100_000 })];

describe('postings & balances', () => {
  it('liability with credit (negative) balance after refund larger than balance', () => {
    const d = ledger(base(), [tx({ type: 'refund', amount: 25_000, accountId: 'card', categoryId: 'clothing.clothes' })]);
    const i = indexLedger(d);
    expect(balanceOn(i, 'card', TODAY)).toBe(-5_000);
    // Credit balance is money the issuer owes you: net worth goes up.
    expect(netWorthOn(d, TODAY).netWorth).toBe(150_000 + 5_000);
    const credit = creditInfo(d.accounts[2], -5_000)!;
    expect(credit.utilization).toBe(0);
    expect(credit.available).toBe(105_000);
  });

  it('cash advance card → checking moves money and raises debt', () => {
    const d = ledger(base(), [tx({ type: 'transfer', amount: 10_000, accountId: 'card', toAccountId: 'chk' })]);
    const i = indexLedger(d);
    expect(balanceOn(i, 'card', TODAY)).toBe(30_000);
    expect(balanceOn(i, 'chk', TODAY)).toBe(110_000);
    expect(netWorthOn(d, TODAY).netWorth).toBe(130_000);
    const s = periodStats(d, '2026-09-01', '2026-09-30');
    expect(s.spending).toBe(0);
    expect(s.income).toBe(0);
    expect(s.debtPayments).toBe(0);
  });

  it('cash advance counts as new debt in debtActivity (principal not overstated)', () => {
    // Pay $100 then take a $100 cash advance: debt unchanged, so no principal was repaid.
    const d = ledger(base(), [
      tx({ type: 'debt_payment', amount: 10_000, accountId: 'chk', toAccountId: 'card', date: '2026-09-02' }),
      tx({ type: 'transfer', amount: 10_000, accountId: 'card', toAccountId: 'chk', date: '2026-09-03' }),
    ]);
    const i = indexLedger(d);
    expect(balanceOn(i, 'card', TODAY)).toBe(20_000);
    // BUG: debtActivity only treats `expense` on the debt as new charges; a transfer OUT of a
    // liability (cash advance / balance transfer out) is ignored, so principal = 10_000 even though
    // the balance did not go down. Fix in ledger.ts debtActivity:
    //   else if (tx.accountId === accountId) { ... else if (TRANSFER_TYPES.includes(tx.type)) charges += tx.amount; }
    expect(debtActivity(i, 'card', '2026-09-01', '2026-09-30').principal).toBe(0);
  });

  it('investment withdrawal and investment→investment transfer', () => {
    const d = ledger(
      [...base(), acct('bro', 'brokerage', 40_000, { startingCostBasis: 30_000 }), acct('ira', 'roth_ira', 10_000)],
      [
        tx({ type: 'investment_withdrawal', amount: 5_000, accountId: 'bro', toAccountId: 'chk' }),
        tx({ type: 'transfer', amount: 7_000, accountId: 'bro', toAccountId: 'ira' }),
        tx({ type: 'investment_contribution', amount: 2_000, accountId: 'sav', toAccountId: 'ira' }),
      ],
    );
    const i = indexLedger(d);
    expect(balanceOn(i, 'bro', TODAY)).toBe(28_000);
    expect(balanceOn(i, 'ira', TODAY)).toBe(19_000);
    expect(balanceOn(i, 'chk', TODAY)).toBe(105_000);
    const s = periodStats(d, '2026-09-01', '2026-09-30');
    expect(s.investmentWithdrawals).toBe(5_000);
    expect(s.investmentContributions).toBe(2_000);
    expect(s.toSavings).toBe(-2_000);
    expect(s.spending + s.income).toBe(0);
    const bro = investmentInfo(i, d.accounts[3], TODAY)!;
    expect(bro.costBasis).toBe(30_000 - 5_000 - 7_000);
    expect(bro.value).toBe(28_000);
    expect(netWorthOn(d, TODAY).netWorth).toBe(100_000 + 50_000 - 20_000 + 50_000);
  });

  it('transactions before account startingDate are ignored for balances', () => {
    const d = ledger([acct('chk', 'checking', 100_000, { startingDate: '2026-06-01' })], [tx({ type: 'expense', amount: 5_000, accountId: 'chk', date: '2026-05-31' })]);
    const i = indexLedger(d);
    expect(balanceOn(i, 'chk', '2026-05-31')).toBe(0);
    expect(balanceOn(i, 'chk', '2026-06-01')).toBe(100_000);
    expect(balanceSeries(i, 'chk', ['2026-05-31', '2026-06-01'])).toEqual([0, 100_000]);
  });

  it('transaction referencing a deleted account does not crash and leaves others intact', () => {
    const d = ledger(base(), [tx({ type: 'transfer', amount: 1_000, accountId: 'chk', toAccountId: 'gone' }), tx({ type: 'expense', amount: 500, accountId: 'gone2' })]);
    const i = indexLedger(d);
    expect(balanceOn(i, 'chk', TODAY)).toBe(99_000);
    expect(balanceOn(i, 'gone', TODAY)).toBe(0);
    const s = periodStats(d, '2026-09-01', '2026-09-30');
    expect(s.spending).toBe(500);
    expect(s.byAccount[0].label).toBe('Unknown account');
  });

  it('same-day ordering does not matter and balanceSeries matches balanceOn on sorted dates', () => {
    const txs = [
      tx({ type: 'expense', amount: 300, accountId: 'chk', date: '2026-09-05' }),
      tx({ type: 'income', amount: 1_000, accountId: 'chk', date: '2026-09-03' }),
      tx({ type: 'expense', amount: 200, accountId: 'chk', date: '2026-09-05' }),
      tx({ type: 'adjustment', amount: -50, accountId: 'chk', date: '2026-09-04' }),
    ];
    const d = ledger(base(), txs);
    const i = indexLedger(d);
    const dates = ['2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'];
    expect(balanceSeries(i, 'chk', dates)).toEqual(dates.map((x) => balanceOn(i, 'chk', x)));
    expect(balanceOn(i, 'chk', '2026-09-05')).toBe(100_000 + 1_000 - 50 - 500);
  });

  it('balanceSeries with unsorted dates matches balanceOn', () => {
    const d = ledger(base(), [tx({ type: 'expense', amount: 300, accountId: 'chk', date: '2026-09-05' })]);
    const i = indexLedger(d);
    const dates = ['2026-09-10', '2026-09-01'];
    // BUG (contract): balanceSeries silently returns wrong values for unsorted dates (the Sep 1
    // balance includes the Sep 5 expense). netWorthSeries / monthlyReview pass caller-provided
    // arrays straight through. Fix: sort a copy of the dates with their original indexes, or
    // assert ascending order.
    expect(balanceSeries(i, 'chk', dates)).toEqual(dates.map((x) => balanceOn(i, 'chk', x)));
  });

  it('interest on an asset is rejected', () => {
    const d = ledger(base());
    expect(validateTransaction(d, tx({ type: 'interest', amount: 100, accountId: 'sav' })).accountId).toBeTruthy();
    expect(validateTransaction(d, tx({ type: 'interest', amount: 100, accountId: 'card', categoryId: 'financial.interest' }))).toEqual({});
  });

  it('netWorthOn includes archived accounts and handles sold assets', () => {
    const accounts = base();
    accounts[1].archived = true;
    const car: Asset = {
      id: 'car', name: 'Car', type: 'vehicle', valuations: [
        { id: 'v1', date: '2026-01-01', value: 1_000_000 },
        { id: 'v2', date: '2026-06-01', value: 900_000 },
        { id: 'v3', date: '2026-06-01', value: 880_000 },
      ], purchaseDate: '2026-01-01', soldDate: '2026-09-10', tags: [], archived: true, createdAt: stamp, updatedAt: stamp,
    };
    const d = ledger(accounts, [], { assets: [car] });
    expect(assetValueOn(car, '2025-12-31')).toBe(0);
    expect(assetValueOn(car, '2026-05-31')).toBe(1_000_000);
    expect(assetValueOn(car, '2026-06-01')).toBe(880_000);
    expect(assetValueOn(car, '2026-09-09')).toBe(880_000);
    expect(assetValueOn(car, '2026-09-10')).toBe(0);
    expect(netWorthOn(d, '2026-09-09').netWorth).toBe(130_000 + 880_000);
    expect(netWorthOn(d, TODAY).netWorth).toBe(130_000);
    const series = netWorthSeries(d, ['2026-09-09', TODAY]);
    expect(series.map((s) => s.netWorth)).toEqual([1_010_000, 130_000]);
  });

  it('assetValueOn with same-date valuations in unsorted array', () => {
    const a: Asset = {
      id: 'a', name: 'A', type: 'other', valuations: [
        { id: 'v2', date: '2026-06-01', value: 500 },
        { id: 'v1', date: '2026-03-01', value: 900 },
      ], tags: [], archived: false, createdAt: stamp, updatedAt: stamp,
    };
    expect(assetValueOn(a, TODAY)).toBe(500);
  });
});

describe('classification & reports', () => {
  it('refunds larger than expenses in a category go negative but total stays exact', () => {
    const d = ledger(base(), [
      tx({ type: 'expense', amount: 1_000, accountId: 'card', categoryId: 'clothing.clothes' }),
      tx({ type: 'refund', amount: 4_000, accountId: 'card', categoryId: 'clothing.clothes' }),
      tx({ type: 'expense', amount: 2_500, accountId: 'chk', categoryId: 'food.groceries' }),
    ]);
    const s = periodStats(d, '2026-09-01', '2026-09-30');
    expect(s.spending).toBe(-500);
    const shopping = s.byCategory.find((c) => c.key === 'clothing')!;
    expect(shopping.amount).toBe(-3_000);
    expect(s.byCategory.reduce((a, c) => a + c.amount, 0)).toBe(s.spending);
    expect(s.byAccount.reduce((a, c) => a + c.amount, 0)).toBe(s.spending);
    expect(s.essential + s.discretionary).toBe(s.spending);
  });

  it('reimbursement reduces spending; interest counts and is tracked', () => {
    const d = ledger(base(), [
      tx({ type: 'expense', amount: 8_630, accountId: 'card', categoryId: 'food.restaurants' }),
      tx({ type: 'reimbursement', amount: 8_630, accountId: 'chk', categoryId: 'food.restaurants' }),
      tx({ type: 'interest', amount: 417, accountId: 'card', categoryId: 'financial.interest' }),
    ]);
    const s = periodStats(d, '2026-09-01', '2026-09-30');
    expect(s.spending).toBe(417);
    expect(s.interestCharged).toBe(417);
    expect(s.essential).toBe(417);
    expect(s.income).toBe(0);
  });

  it('income by source groups by source then category', () => {
    const d = ledger(base(), [
      tx({ type: 'income', amount: 225_000, accountId: 'chk', incomeSourceId: 'job', categoryId: 'income.paycheck' }),
      tx({ type: 'income', amount: 225_000, accountId: 'chk', incomeSourceId: 'job', categoryId: 'income.paycheck', date: '2026-09-15' }),
      tx({ type: 'income', amount: 3_000, accountId: 'sav', categoryId: 'income.interest' }),
      tx({ type: 'income', amount: 1_000, accountId: 'chk' }),
    ], {
      incomeSources: [{ id: 'job', name: 'Acme', type: 'salary', depositAccountId: 'chk', active: true, tags: [], createdAt: stamp, updatedAt: stamp }],
    });
    const s = periodStats(d, '2026-09-01', '2026-09-30');
    expect(s.income).toBe(454_000);
    expect(s.incomeBySource.map((x) => [x.label, x.amount])).toEqual([
      ['Acme', 450_000],
      ['Income › Interest', 3_000],
      ['Other income', 1_000],
    ]);
  });

  it('savings→savings nets to 0, checking→savings counts', () => {
    const d = ledger([...base(), acct('sav2', 'savings', 0)], [
      tx({ type: 'transfer', amount: 10_000, accountId: 'sav', toAccountId: 'sav2' }),
      tx({ type: 'transfer', amount: 2_000, accountId: 'chk', toAccountId: 'sav2' }),
    ]);
    expect(periodStats(d, '2026-09-01', '2026-09-30').toSavings).toBe(2_000);
  });

  it('essential flag: transaction override beats category default', () => {
    const d = ledger(base(), [
      tx({ type: 'expense', amount: 1_000, accountId: 'chk', categoryId: 'food.groceries', essential: false }),
      tx({ type: 'expense', amount: 2_000, accountId: 'chk', categoryId: 'food.coffee', essential: true }),
      tx({ type: 'expense', amount: 4_000, accountId: 'chk', categoryId: 'housing.rent' }),
      tx({ type: 'expense', amount: 8_000, accountId: 'chk' }),
    ]);
    const s = periodStats(d, '2026-09-01', '2026-09-30');
    expect(s.essential).toBe(6_000);
    expect(s.discretionary).toBe(9_000);
  });

  it('monthlyReview debt reconciles: start + charges + interest − payments = end', () => {
    const d = ledger(
      [acct('chk', 'checking', 500_000, { spendable: true }), acct('card', 'credit_card', 100_000), acct('loan', 'auto_loan', 1_000_000)],
      [
        tx({ type: 'expense', amount: 5_000, accountId: 'card', date: '2026-08-20' }),
        tx({ type: 'interest', amount: 2_000, accountId: 'card', date: '2026-09-01' }),
        tx({ type: 'interest', amount: 5_000, accountId: 'loan', date: '2026-09-01' }),
        tx({ type: 'expense', amount: 7_000, accountId: 'card', date: '2026-09-05' }),
        tx({ type: 'refund', amount: 1_000, accountId: 'card', date: '2026-09-06' }),
        tx({ type: 'debt_payment', amount: 30_000, accountId: 'chk', toAccountId: 'card', date: '2026-09-10' }),
        tx({ type: 'debt_payment', amount: 42_500, accountId: 'chk', toAccountId: 'loan', date: '2026-09-05' }),
      ],
    );
    const r = monthlyReview(d, '2026-09', TODAY);
    expect(r.debt.start).toBe(105_000 + 1_000_000);
    expect(r.debt.newCharges).toBe(6_000);
    expect(r.debt.interest).toBe(7_000);
    expect(r.debt.payments).toBe(72_500);
    expect(r.debt.end).toBe(r.debt.start + r.debt.newCharges + r.debt.interest - r.debt.payments);
    expect(r.isPartial).toBe(true);
    expect(r.netWorth.change).toBe(r.netWorth.end - r.netWorth.start);
  });

  it('categoryAverages divides by the number of months', () => {
    const d = ledger(base(), [
      tx({ type: 'expense', amount: 3_000, accountId: 'chk', categoryId: 'food.groceries', date: '2026-06-10' }),
      tx({ type: 'expense', amount: 3_001, accountId: 'chk', categoryId: 'food.groceries', date: '2026-08-31' }),
      tx({ type: 'expense', amount: 99_999, accountId: 'chk', categoryId: 'food.groceries', date: '2026-09-01' }),
    ]);
    const a = categoryAverages(d, '2026-09', 3);
    expect(a.months).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(a.total).toBe(2_000);
  });

  it('yearOverYear on Jan 1 and Feb 29 uses valid date ranges', () => {
    const d = ledger(base(), [
      tx({ type: 'expense', amount: 100, accountId: 'chk', date: '2027-02-28' }),
      tx({ type: 'expense', amount: 200, accountId: 'chk', date: '2027-03-01' }),
      tx({ type: 'expense', amount: 400, accountId: 'chk', date: '2028-01-01' }),
    ]);
    const jan1 = yearOverYear(d, '2028-01-01');
    expect(jan1.thisYear.spending).toBe(400);
    expect(jan1.lastYearToDate.to).toBe('2027-01-01');
    const leap = yearOverYear(d, '2028-02-29');
    expect(leap.lastYearToDate.spending).toBe(100);
    // BUG (minor): the comparison window ends on '2027-02-29', which is not a real date; any UI
    // formatting `lastYearToDate.to` shows "Feb 29, 2027". Fix in reports.ts yearOverYear:
    //   const lastTo = addMonths(today, -12)  // clamps to 2027-02-28
    expect(leap.lastYearToDate.to).toBe('2027-02-28');
  });
});

describe('debt summary', () => {
  it('monthChange includes activity on the 1st of the month', () => {
    const d = ledger(
      [acct('chk', 'checking', 500_000), acct('loan', 'auto_loan', 1_000_000, { startingDate: '2026-01-01', apr: 6 })],
      [
        tx({ type: 'interest', amount: 5_000, accountId: 'loan', date: '2026-09-01' }),
        tx({ type: 'debt_payment', amount: 42_500, accountId: 'chk', toAccountId: 'loan', date: '2026-09-05' }),
      ],
    );
    const line = debtLines(d, TODAY)[0];
    expect(line.balance).toBe(962_500);
    // BUG: debtLines uses balanceOn(monthStartDay) which is the balance at the END of the 1st,
    // so interest/charges/payments posted on the 1st are dropped from monthChange (sample ledger
    // posts all interest on the 1st). Fix in debt.ts debtLines:
    //   const startBal = account.startingDate < monthStartDay ? balanceOn(index, account.id, addDays(monthStartDay, -1)) : account.startingBalance;
    expect(line.monthChange).toBe(5_000 - 42_500);
  });

  it('debtSummary principal ignores payments that only cover new card charges', () => {
    const d = ledger(base(), [
      tx({ type: 'expense', amount: 30_000, accountId: 'card', date: '2026-03-01' }),
      tx({ type: 'debt_payment', amount: 30_000, accountId: 'chk', toAccountId: 'card', date: '2026-03-20' }),
      tx({ type: 'debt_payment', amount: 5_000, accountId: 'chk', toAccountId: 'card', date: '2026-04-20' }),
    ]);
    const s = debtSummary(d, TODAY);
    expect(s.total).toBe(15_000);
    expect(s.principalPaidYtd).toBe(5_000);
  });
});

describe('filters & search', () => {
  const d = ledger(base(), [
    tx({ id: 'a', type: 'expense', amount: 1_549, accountId: 'card', categoryId: 'subscriptions.streaming', tags: ['fun', 'car-wash'], payee: 'Netflix' }),
    tx({ id: 'b', type: 'transfer', amount: 50_000, accountId: 'chk', toAccountId: 'sav', description: 'Move' }),
    tx({ id: 'c', type: 'adjustment', amount: -2_000, accountId: 'chk', description: 'Fix' }),
    tx({ id: 'd', type: 'refund', amount: 500, accountId: 'card', categoryId: 'subscriptions', tags: ['car'] }),
    tx({ id: 'e', type: 'income', amount: 100_000, accountId: 'chk', categoryId: 'income.paycheck', date: '2026-08-15' }),
  ]);

  it('account filter matches toAccountId', () => {
    const r = filterTransactions(d, { ...emptyFilters(), accountIds: ['sav'] }, TODAY);
    expect(r.map((t) => t.id)).toEqual(['b']);
  });

  it('category family inclusion', () => {
    const r = filterTransactions(d, { ...emptyFilters(), categoryIds: ['subscriptions'] }, TODAY);
    expect(r.map((t) => t.id).sort()).toEqual(['a', 'd']);
    const sub = filterTransactions(d, { ...emptyFilters(), categoryIds: ['subscriptions.streaming'] }, TODAY);
    expect(sub.map((t) => t.id)).toEqual(['a']);
  });

  it('min/max use absolute value (negative adjustments)', () => {
    const r = filterTransactions(d, { ...emptyFilters(), min: 1_500, max: 2_000 }, TODAY);
    expect(r.map((t) => t.id).sort()).toEqual(['a', 'c']);
  });

  it('tag and amount queries', () => {
    expect(filterTransactions(d, { ...emptyFilters(), query: '#car' }, TODAY).map((t) => t.id).sort()).toEqual(['a', 'd']);
    expect(filterTransactions(d, { ...emptyFilters(), query: '15.49' }, TODAY).map((t) => t.id)).toEqual(['a']);
    expect(filterTransactions(d, { ...emptyFilters(), query: '$1,000' }, TODAY).map((t) => t.id)).toEqual(['e']);
    // Search: `#car` is an exact tag match.
    expect(searchLedger(d, '#car').filter((r) => r.kind === 'transaction').map((r) => r.id)).toEqual(['d']);
    expect(searchLedger(d, '#Car').filter((r) => r.kind === 'transaction').map((r) => r.id)).toEqual(['d']);
  });

  it('filteredTotals keeps transfers separate', () => {
    const t = filteredTotals(d.transactions);
    expect(t.income).toBe(100_000);
    expect(t.spending).toBe(1_049);
    expect(t.moved).toBe(50_000);
  });

  it('oldest sort is the exact reverse of newest and does not mutate the index', () => {
    const newest = filterTransactions(d, emptyFilters(), TODAY).map((t) => t.id);
    const oldest = filterTransactions(d, emptyFilters(), TODAY, 'oldest').map((t) => t.id);
    expect(oldest).toEqual([...newest].reverse());
    expect(filterTransactions(d, emptyFilters(), TODAY).map((t) => t.id)).toEqual(newest);
  });

  it('preset "30" covers 30 days inclusive', () => {
    // today Sep 13 → from Aug 15 (30 days inclusive) includes the Aug 15 paycheck
    expect(filterTransactions(d, { ...emptyFilters(), preset: '30' }, '2026-09-13').map((t) => t.id)).toContain('e');
    const r2 = filterTransactions(d, { ...emptyFilters(), preset: '30' }, '2026-09-14');
    expect(r2.map((t) => t.id)).not.toContain('e');
    expect(r2.length).toBe(4);
  });
});

describe('validation rules', () => {
  const d = ledger([...base(), acct('bro', 'brokerage', 0), acct('loan', 'auto_loan', 0)]);
  const v = (p: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'accountId'>) => validateTransaction(d, tx(p));

  it('validateTransaction rules', () => {
    expect(v({ type: 'expense', amount: 10.5, accountId: 'chk' }).amount).toBeTruthy();
    expect(v({ type: 'expense', amount: 0, accountId: 'chk' }).amount).toBeTruthy();
    expect(v({ type: 'expense', amount: -5, accountId: 'chk' }).amount).toBeTruthy();
    expect(v({ type: 'expense', amount: NaN, accountId: 'chk' }).amount).toBeTruthy();
    expect(v({ type: 'adjustment', amount: -5, accountId: 'chk' })).toEqual({});
    expect(v({ type: 'adjustment', amount: 0, accountId: 'chk' }).amount).toBeTruthy();
    expect(v({ type: 'expense', amount: 5, accountId: 'chk', date: '2026-02-30' }).date).toBeTruthy();
    expect(v({ type: 'expense', amount: 5, accountId: 'nope' }).accountId).toBeTruthy();
    expect(v({ type: 'transfer', amount: 5, accountId: 'chk' }).toAccountId).toBeTruthy();
    expect(v({ type: 'investment_contribution', amount: 5, accountId: 'chk', toAccountId: 'sav' }).toAccountId).toBeTruthy();
    expect(v({ type: 'investment_withdrawal', amount: 5, accountId: 'chk', toAccountId: 'bro' }).accountId).toBeTruthy();
    expect(v({ type: 'investment_withdrawal', amount: 5, accountId: 'bro', toAccountId: 'chk' })).toEqual({});
    expect(v({ type: 'debt_payment', amount: 5, accountId: 'card', toAccountId: 'loan' })).toEqual({});
    expect(v({ type: 'income', amount: 5, accountId: 'card' }).accountId).toBeTruthy();
    expect(v({ type: 'refund', amount: 5, accountId: 'card', categoryId: 'income.paycheck' }).categoryId).toBeTruthy();
    expect(v({ type: 'expense', amount: 5, accountId: 'chk', categoryId: 'nope' }).categoryId).toBeTruthy();
    expect(v({ type: 'expense', amount: 5, accountId: 'chk', description: '  ' }).description).toBeTruthy();
    expect(v({ type: 'expense', amount: 5, accountId: 'chk', description: '', payee: 'X' })).toEqual({});
  });

  it('validateTransaction rejects a transaction dated before its account started', () => {
    // BUG: postings dated before an account's startingDate are silently ignored by balanceOn,
    // but the transaction still counts in periodStats. A transfer from an older account into a
    // newer one before its start date destroys money in net worth. validateTransaction should
    // flag it, e.g.: if (from && tx.date < from.startingDate) e.date = 'This is before the account’s starting date.'
    const d2 = ledger([acct('chk', 'checking', 100_000), acct('sav', 'savings', 0, { startingDate: '2026-06-01' })]);
    const t = tx({ type: 'transfer', amount: 10_000, accountId: 'chk', toAccountId: 'sav', date: '2026-03-01' });
    const withTx = ledger(d2.accounts, [t]);
    // Observed effect: checking loses $100 but savings ignores it → net worth 90_000 instead of 100_000.
    expect(netWorthOn(withTx, TODAY).netWorth).toBe(90_000);
    expect(Object.keys(validateTransaction(d2, t)).length).toBeGreaterThan(0);
  });

  it('validateRecurring rules', () => {
    const r = { id: 'r', name: 'Rent', kind: 'bill' as const, amount: 150_000, variable: false, frequency: { unit: 'month' as const, interval: 1 }, startDate: '2026-01-01', accountId: 'chk', autopay: true, essential: true, active: true, skipped: [], tags: [], createdAt: stamp, updatedAt: stamp };
    const dd = ledger([...base(), acct('bro', 'brokerage', 0)]);
    expect(validateRecurring(dd, r)).toEqual({});
    expect(validateRecurring(dd, { ...r, name: '' }).name).toBeTruthy();
    expect(validateRecurring(dd, { ...r, amount: 0 }).amount).toBeTruthy();
    expect(validateRecurring(dd, { ...r, frequency: { unit: 'week', interval: 0 } }).frequency).toBeTruthy();
    expect(validateRecurring(dd, { ...r, frequency: { unit: 'week', interval: 1.5 } }).frequency).toBeTruthy();
    expect(validateRecurring(dd, { ...r, startDate: '2026-02-30' }).startDate).toBeTruthy();
    expect(validateRecurring(dd, { ...r, endDate: '2025-12-31' }).endDate).toBeTruthy();
    expect(validateRecurring(dd, { ...r, accountId: 'x' }).accountId).toBeTruthy();
    expect(validateRecurring(dd, { ...r, kind: 'transfer' }).toAccountId).toBeTruthy();
    expect(validateRecurring(dd, { ...r, kind: 'debt_payment', toAccountId: 'sav' }).toAccountId).toBeTruthy();
    expect(validateRecurring(dd, { ...r, kind: 'investment', toAccountId: 'sav' }).toAccountId).toBeTruthy();
    expect(validateRecurring(dd, { ...r, kind: 'investment', toAccountId: 'bro' })).toEqual({});
    // BUG: validateRecurring only checks `amount > 0`, so fractional cents (e.g. 1549.5) are
    // accepted and flow into forecasts/budgets as non-integer money. Fix in validation.ts:
    //   if (!Number.isInteger(item.amount) || item.amount <= 0) e.amount = 'Amount must be greater than zero.';
    expect(validateRecurring(dd, { ...r, amount: 1_549.5 }).amount).toBeTruthy();
  });

  it('validateAccount rules', () => {
    const a = acct('x', 'credit_card', 0);
    expect(validateAccount(a)).toEqual({});
    expect(validateAccount({ ...a, name: ' ' }).name).toBeTruthy();
    expect(validateAccount({ ...a, startingBalance: 1.5 }).startingBalance).toBeTruthy();
    expect(validateAccount({ ...a, startingDate: '2026-13-01' }).startingDate).toBeTruthy();
    expect(validateAccount({ ...a, creditLimit: 0 }).creditLimit).toBeTruthy();
    expect(validateAccount({ ...a, apr: -1 }).apr).toBeTruthy();
    expect(validateAccount({ ...a, apr: 101 }).apr).toBeTruthy();
    expect(validateAccount({ ...a, promoApr: 0 }).promoExpires).toBeTruthy();
    expect(validateAccount({ ...a, dueDay: 0 }).dueDay).toBeTruthy();
    expect(validateAccount({ ...a, dueDay: 32 }).dueDay).toBeTruthy();
    expect(validateAccount({ ...a, statementClosingDay: 32 }).statementClosingDay).toBeTruthy();
  });

  it('validateAccount rejects NaN / fractional numeric fields', () => {
    const a = acct('x', 'credit_card', 0);
    // BUG: range checks like `apr < 0 || apr > 100` are false for NaN, and dueDay 15.5 passes,
    // producing dates like "2026-09-15.5" in debt events. Money fields minimumPayment /
    // paymentAmount / statementBalance / creditLimit are never checked for integer cents.
    // Fix in validation.ts: use Number.isFinite / Number.isInteger guards, e.g.
    //   if (account.apr !== undefined && !(account.apr >= 0 && account.apr <= 100)) ...
    //   if (account.dueDay !== undefined && !(Number.isInteger(account.dueDay) && account.dueDay >= 1 && account.dueDay <= 31)) ...
    //   for (const k of ['creditLimit','minimumPayment','paymentAmount','statementBalance','originalBalance'] as const)
    //     if (account[k] !== undefined && !(Number.isInteger(account[k]) && account[k]! >= 0)) e[k] = 'Enter a valid amount.';
    expect(validateAccount({ ...a, apr: NaN }).apr).toBeTruthy();
    expect(validateAccount({ ...a, dueDay: 15.5 }).dueDay).toBeTruthy();
    expect(validateAccount({ ...a, minimumPayment: 25.5 }).minimumPayment).toBeTruthy();
    expect(validateAccount({ ...a, paymentAmount: -100 }).paymentAmount).toBeTruthy();
    expect(validateAccount({ ...a, creditLimit: 1000.25 }).creditLimit).toBeTruthy();
    expect(validateAccount({ ...a, promoApr: 0, promoExpires: 'soon' }).promoExpires).toBeTruthy();
  });
});
