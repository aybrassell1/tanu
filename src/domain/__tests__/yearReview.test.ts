import { describe, expect, it } from 'vitest';

import { createId, emptyLedger } from '../factory';
import { periodStats } from '../reports';
import { buildSampleLedger } from '../sample';
import type { Account, Goal, LedgerData, Transaction } from '../types';
import { leanMonthLabel, yearCategoryTotals, yearReview, yearReviewText, yearsWithData } from '../yearReview';

const TODAY = '2026-09-16';
const stamp = '2024-01-01T00:00:00.000Z';

const account = (id: string, type: Account['type'], startingBalance: number): Account => ({
  id,
  name: id,
  type,
  startingBalance,
  startingDate: '2025-01-01',
  spendable: type === 'checking',
  color: '#000',
  icon: 'box',
  tags: [],
  archived: false,
  createdAt: stamp,
  updatedAt: stamp,
});

function tx(partial: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'date' | 'accountId'>): Transaction {
  return { id: createId('tx'), description: 'test', tags: [], attachments: [], createdAt: stamp, updatedAt: stamp, ...partial };
}

/**
 * A tiny, hand-checkable 2025: $60,000 of pay, $18,000 of spending across
 * three merchants, one $2,400 card payment and $300 of interest.
 */
function fixture(): LedgerData {
  const d = emptyLedger();
  d.accounts = [account('chk', 'checking', 1_000_000), account('card', 'credit_card', 500_000), account('roth', 'roth_ira', 1_000_000)];
  d.transactions = [
    // 12 paychecks of $5,000 on the 15th.
    ...Array.from({ length: 12 }, (_, m) =>
      tx({ type: 'income', amount: 500_000, date: `2025-${String(m + 1).padStart(2, '0')}-15`, accountId: 'chk', categoryId: 'income.salary', description: 'Paycheck' }),
    ),
    // $1,000/month of groceries at the same shop, always on a Monday (2025-01-06 is a Monday).
    ...Array.from({ length: 12 }, (_, m) =>
      tx({ type: 'expense', amount: 100_000, date: `2025-${String(m + 1).padStart(2, '0')}-06`, accountId: 'chk', categoryId: 'food.groceries', payee: 'Corner Market' }),
    ),
    // One big purchase and one medium one.
    tx({ type: 'expense', amount: 400_000, date: '2025-07-04', accountId: 'card', categoryId: 'travel.flights', payee: 'Skyways' }),
    tx({ type: 'expense', amount: 200_000, date: '2025-11-20', accountId: 'card', categoryId: 'shopping.electronics', payee: 'Gadget Hut' }),
    // Not spending: a card payment and an investment contribution.
    tx({ type: 'debt_payment', amount: 240_000, date: '2025-12-01', accountId: 'chk', toAccountId: 'card' }),
    tx({ type: 'investment_contribution', amount: 360_000, date: '2025-06-01', accountId: 'chk', toAccountId: 'roth' }),
    // Interest counts as spending.
    tx({ type: 'interest', amount: 30_000, date: '2025-08-31', accountId: 'card' }),
  ];
  return d;
}

const goal = (over: Partial<Goal>): Goal => ({
  id: createId('goal'),
  name: 'Emergency fund',
  kind: 'savings',
  template: 'emergency',
  target: 1_000_000,
  linkedAccountIds: [],
  startDate: '2025-01-01',
  icon: 'umbrella',
  color: '#000',
  tags: [],
  archived: false,
  createdAt: stamp,
  updatedAt: stamp,
  ...over,
});

describe('yearsWithData', () => {
  it('lists years with anything recorded, newest first', () => {
    const years = yearsWithData(fixture());
    expect(years).toEqual([2025]);
    expect(yearsWithData(emptyLedger())).toEqual([]);
  });
});

describe('yearReview totals', () => {
  const review = yearReview(fixture(), 2025, TODAY);

  it('matches periodStats for the same window', () => {
    const stats = periodStats(fixture(), '2025-01-01', '2025-12-31');
    expect(review.stats.income).toBe(stats.income);
    expect(review.stats.spending).toBe(stats.spending);
    expect(review.stats.saved).toBe(stats.saved);
  });

  it('adds income, spending and the savings rate', () => {
    expect(review.year).toBe(2025);
    expect(review.isPartial).toBe(false);
    expect(review.stats.income).toBe(6_000_000);
    // 12 × $1,000 groceries + $4,000 flight + $2,000 gadget + $300 interest.
    expect(review.stats.spending).toBe(1_200_000 + 400_000 + 200_000 + 30_000);
    expect(review.stats.saved).toBe(6_000_000 - 1_830_000);
    expect(review.stats.savingsRate).toBeCloseTo(4_170_000 / 6_000_000, 6);
    // Transfers and the card payment are not spending, but they are transactions.
    expect(review.transactionCount).toBe(29);
    expect(review.hasData).toBe(true);
  });

  it('ranks categories and merchants', () => {
    expect(review.topCategories[0].label).toBe('Food & drink');
    expect(review.topCategories[0].amount).toBe(1_200_000);
    expect(review.topMerchants[0]).toMatchObject({ label: 'Corner Market', amount: 1_200_000, count: 12 });
    expect(review.merchantCount).toBe(3);
    expect(review.topMerchants.map((m) => m.label)).toContain('Skyways');
    expect(yearCategoryTotals(fixture(), 2025, TODAY)[0].label).toBe('Groceries');
  });

  it('finds the biggest purchase and the best / worst month', () => {
    expect(review.biggestPurchase?.amount).toBe(400_000);
    expect(review.biggestPurchase?.payee).toBe('Skyways');
    expect(review.months).toHaveLength(12);
    // July carried the $4,000 flight, so it kept the least.
    expect(review.worstMonth?.month).toBe('2025-07');
    expect(review.bestMonth?.saved).toBeGreaterThan(review.worstMonth!.saved);
  });

  it('separates debt, interest and investing from spending', () => {
    expect(review.debt.paidDown).toBe(240_000 - 600_000 - 30_000);
    expect(review.debt.interest).toBe(30_000);
    expect(review.investments.contributions).toBe(360_000);
  });

  it('tracks net worth across the year', () => {
    expect(review.netWorth.start).toBe(1_000_000 - 500_000 + 1_000_000);
    expect(review.netWorth.change).toBe(review.netWorth.end - review.netWorth.start);
  });

  it('computes fun-but-true facts from real data', () => {
    const busiest = review.facts.find((f) => f.key === 'busiest-day');
    // Every grocery run is on the 6th; 2025 has more Mondays on the 6th than any other day.
    expect(busiest).toBeDefined();
    expect(review.facts.find((f) => f.key === 'frequent-merchant')?.value).toBe('Corner Market');
    expect(review.facts.find((f) => f.key === 'no-spend')?.detail).toBe('out of 365 days');
    expect(review.facts.find((f) => f.key === 'priciest-day')?.value).toContain('4,000');
  });

  it('only compares with a previous year that has data', () => {
    expect(review.previous).toBeNull();
    expect(review.previousYear).toBe(2024);
  });
});

describe('year over year', () => {
  it('compares when the previous year was tracked', () => {
    const data = fixture();
    data.accounts = data.accounts.map((a) => ({ ...a, startingDate: '2024-01-01' }));
    data.transactions.push(tx({ type: 'expense', amount: 90_000, date: '2024-05-05', accountId: 'chk', categoryId: 'food.groceries', payee: 'Corner Market' }));
    const review = yearReview(data, 2025, TODAY);
    expect(review.previous).not.toBeNull();
    expect(review.previous!.spending).toBe(90_000);
    expect(yearReviewText(review)).toContain('Versus 2024');
  });
});

describe('partial and empty years', () => {
  it('stops at today for the current year', () => {
    const data = fixture();
    data.transactions.push(tx({ type: 'expense', amount: 5000, date: '2026-03-02', accountId: 'chk', categoryId: 'food.groceries', payee: 'Corner Market' }));
    const review = yearReview(data, 2026, TODAY);
    expect(review.isPartial).toBe(true);
    expect(review.to).toBe(TODAY);
    expect(review.months).toHaveLength(9);
    expect(review.stats.spending).toBe(5000);
  });

  it('survives a year with nothing in it', () => {
    const review = yearReview(emptyLedger(), 2019, TODAY);
    expect(review.hasData).toBe(false);
    expect(review.stats.income).toBe(0);
    expect(review.topMerchants).toEqual([]);
    expect(review.bestMonth).toBeNull();
    expect(review.biggestPurchase).toBeNull();
    expect(review.facts.length).toBeGreaterThanOrEqual(0);
    expect(() => yearReviewText(review)).not.toThrow();
  });
});

describe('partly tracked years', () => {
  /** The same 2025, but nothing was recorded before 1 September. */
  function fromSeptember(): LedgerData {
    const d = fixture();
    d.accounts = d.accounts.map((a) => ({ ...a, startingDate: '2025-09-01' }));
    d.transactions = d.transactions.filter((t) => t.date >= '2025-09-01');
    return d;
  }

  it('counts days from when tracking began, not from 1 January', () => {
    const review = yearReview(fromSeptember(), 2025, TODAY);
    // 1 Sep – 31 Dec 2025 is 122 days.
    expect(review.trackedFrom).toBe('2025-09-01');
    expect(review.trackedDays).toBe(122);
    expect(review.fullyTracked).toBe(false);
    expect(review.facts.find((f) => f.key === 'no-spend')?.detail).toBe('out of 122 days tracked');
    const average = review.facts.find((f) => f.key === 'daily-average');
    expect(average?.detail).toBe('spent per tracked day');
    // $4,000 of groceries + $2,000 gadget = $6,000 over 122 days, not over 365.
    expect(review.stats.spending).toBe(600_000);
    expect(average?.value).toBe('$49');
  });

  it('still reports whole days for a year that was tracked throughout', () => {
    const review = yearReview(fixture(), 2025, TODAY);
    expect(review.fullyTracked).toBe(true);
    expect(review.trackedDays).toBe(365);
    expect(review.facts.find((f) => f.key === 'no-spend')?.detail).toBe('out of 365 days');
  });

  it('says so in the share text', () => {
    expect(yearReviewText(yearReview(fromSeptember(), 2025, TODAY))).toContain('Tracked from 2025-09-01');
  });
});

describe('like-for-like comparisons', () => {
  it('cuts the previous year to the same span as a part year', () => {
    const data = fixture();
    data.accounts = data.accounts.map((a) => ({ ...a, startingDate: '2024-01-01' }));
    // A whole 2024 of spending; only the first months should be compared with.
    for (let m = 1; m <= 12; m++) {
      data.transactions.push(tx({ type: 'expense', amount: 10_000, date: `2024-${String(m).padStart(2, '0')}-10`, accountId: 'chk', categoryId: 'food.groceries' }));
    }
    data.transactions.push(tx({ type: 'expense', amount: 5000, date: '2026-03-02', accountId: 'chk', categoryId: 'food.groceries' }));
    const review = yearReview(data, 2026, TODAY);
    expect(review.isPartial).toBe(true);
    // 1 Jan – 16 Sep 2026 is 259 days, so 2025 is cut to 1 Jan – 16 Sep too.
    expect(review.previousSpan).toEqual({ from: '2025-01-01', to: '2025-09-16' });
    expect(review.previous!.spending).toBe(900_000 + 400_000 + 30_000);
    expect(review.comparable).toBe(true);
  });

  it('refuses to compare with a year that was barely tracked', () => {
    const data = fixture();
    data.accounts = data.accounts.map((a) => ({ ...a, startingDate: '2025-09-01' }));
    data.transactions = data.transactions.filter((t) => t.date >= '2025-09-01');
    data.transactions.push(tx({ type: 'expense', amount: 5000, date: '2026-03-02', accountId: 'chk', categoryId: 'food.groceries' }));
    const review = yearReview(data, 2026, TODAY);
    // 2025 exists, but only 16 of the 259 compared days were tracked.
    expect(review.previous).not.toBeNull();
    expect(review.previousTrackedDays).toBe(16);
    expect(review.comparable).toBe(false);
    expect(yearReviewText(review)).toContain('not like for like');
  });

  it('has nothing to compare with when the previous year was never tracked', () => {
    const review = yearReview(fixture(), 2025, TODAY);
    expect(review.previous).toBeNull();
    expect(review.previousSpan).toBeNull();
    expect(review.comparable).toBe(false);
  });
});

describe('month labels', () => {
  it('only calls a month tough when it went backwards', () => {
    expect(leanMonthLabel({ month: '2025-11', label: 'Nov', income: 500_000, spending: 374_200, saved: 125_800 })).toEqual({
      label: 'Leanest month',
      caption: 'kept the least',
    });
    expect(leanMonthLabel({ month: '2025-11', label: 'Nov', income: 100_000, spending: 374_200, saved: -274_200 })).toEqual({
      label: 'Toughest month',
      caption: 'spent more than came in',
    });
  });

  it('uses the same wording in the share text', () => {
    // Every month of the fixture kept money except July, which broke even.
    const text = yearReviewText(yearReview(fixture(), 2025, TODAY));
    expect(text).toContain('Leanest month');
    expect(text).not.toContain('Toughest month');
  });

  it('skips the extremes when only one month was active', () => {
    const d = emptyLedger();
    d.accounts = [account('chk', 'checking', 1_000_000)];
    d.transactions = [tx({ type: 'income', amount: 500_000, date: '2025-04-01', accountId: 'chk', categoryId: 'income.salary' })];
    const review = yearReview(d, 2025, TODAY);
    expect(review.bestMonth).toBeNull();
    expect(review.worstMonth).toBeNull();
  });
});

describe('goals and subscriptions', () => {
  it('counts goals completed inside the year and subscriptions paid', () => {
    const data = fixture();
    data.goals = [goal({ completedAt: '2025-09-01' }), goal({ name: 'Later', completedAt: '2026-02-01' }), goal({ name: 'Open' })];
    data.recurring = [
      {
        id: 'r_stream',
        name: 'Streamly',
        kind: 'subscription',
        amount: 1299,
        variable: false,
        frequency: { unit: 'month', interval: 1 },
        startDate: '2025-01-10',
        accountId: 'chk',
        autopay: true,
        essential: false,
        active: true,
        skipped: [],
        tags: [],
        createdAt: stamp,
        updatedAt: stamp,
      },
    ];
    for (let m = 1; m <= 12; m++) {
      data.transactions.push(
        tx({ type: 'expense', amount: 1299, date: `2025-${String(m).padStart(2, '0')}-10`, accountId: 'chk', categoryId: 'subscriptions.streaming', payee: 'Streamly', recurringId: 'r_stream' }),
      );
    }
    const review = yearReview(data, 2025, TODAY);
    expect(review.goalsCompleted.map((g) => g.name)).toEqual(['Emergency fund']);
    expect(review.subscriptions).toMatchObject({ count: 1, total: 15_588 });
  });
});

describe('share text', () => {
  it('writes a readable summary', () => {
    const text = yearReviewText(yearReview(fixture(), 2025, TODAY));
    expect(text).toContain('2025 in review');
    expect(text).toContain('Income');
    expect(text).toContain('Biggest categories');
    expect(text).toContain('Corner Market');
    expect(text).toContain('Fun but true');
    expect(text.split('\n').length).toBeGreaterThan(10);
  });

  it('marks a year that is still running', () => {
    expect(yearReviewText(yearReview(fixture(), 2026, TODAY))).toContain('(year to date)');
  });
});

describe('sample ledger', () => {
  const today = '2026-09-16';
  const data = buildSampleLedger(today);

  it('reviews the sample year against periodStats', () => {
    const review = yearReview(data, 2026, today);
    const stats = periodStats(data, '2026-01-01', today);
    expect(review.hasData).toBe(true);
    expect(review.stats.income).toBe(stats.income);
    expect(review.stats.spending).toBe(stats.spending);
    expect(review.transactionCount).toBe(stats.transactionCount);
    expect(review.topCategories.length).toBeGreaterThan(0);
    expect(review.topMerchants.length).toBeGreaterThan(0);
    expect(review.months).toHaveLength(9);
    expect(review.months.reduce((t, m) => t + m.spending, 0)).toBe(stats.spending);
  });

  it('offers the sample years for the switcher', () => {
    expect(yearsWithData(data)).toContain(2026);
    expect(yearsWithData(data)).toContain(2025);
  });
});
