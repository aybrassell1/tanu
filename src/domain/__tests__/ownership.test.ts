import { describe, expect, it } from 'vitest';

import { emptyLedger } from '../factory';
import { costKindOf, ownershipCost, valueOn } from '../ownership';
import type { Account, AccountType, Asset, LedgerData, Transaction } from '../types';

const stamp = '2024-09-01T00:00:00.000Z';
const TODAY = '2026-09-17';
let seq = 0;

function acct(id: string, type: AccountType, startingBalance = 0): Account {
  return { id, name: id, type, startingBalance, startingDate: '2024-09-01', color: '#000', icon: 'box', tags: [], archived: false, createdAt: stamp, updatedAt: stamp };
}

function tx(p: Partial<Transaction> & Pick<Transaction, 'amount' | 'date'>): Transaction {
  seq++;
  return {
    id: `t${seq}`,
    type: 'expense',
    description: 'Car cost',
    accountId: 'chk',
    tags: ['car'],
    attachments: [],
    createdAt: stamp,
    updatedAt: stamp,
    ...p,
  };
}

function car(extra: Partial<Asset> = {}): Asset {
  return {
    id: 'car',
    name: 'Civic',
    type: 'vehicle',
    purchasePrice: 2_000_000,
    purchaseDate: '2024-09-01',
    valuations: [
      { id: 'v1', date: '2025-09-17', value: 1_600_000 },
      { id: 'v2', date: '2026-09-17', value: 1_300_000 },
    ],
    linkedLiabilityId: 'loan',
    expenseTag: 'car',
    tags: [],
    archived: false,
    createdAt: stamp,
    updatedAt: stamp,
    ...extra,
  };
}

const RECENT: Transaction[] = [
  tx({ date: '2026-01-15', amount: 60_000, categoryId: 'transportation.insurance' }),
  tx({ date: '2026-02-10', amount: 4_000, categoryId: 'transportation.gas' }),
  tx({ date: '2026-03-10', amount: 4_000, categoryId: 'transportation.gas' }),
  tx({ date: '2026-04-02', amount: 15_000, categoryId: 'transportation.maintenance' }),
  tx({ date: '2026-04-20', amount: 1_000, categoryId: 'transportation.tolls' }),
  tx({ date: '2026-05-05', amount: 9_000, categoryId: 'transportation.registration' }),
  // Interest belongs to the loan; tagging it must not count it twice.
  tx({ date: '2026-02-01', amount: 5_000, type: 'interest', accountId: 'loan' }),
  // A debt payment is not spending — it must never land in a cost bucket.
  tx({ date: '2026-02-01', amount: 40_000, type: 'debt_payment', accountId: 'chk', toAccountId: 'loan', categoryId: 'transportation.car_payment' }),
];

const OLDER: Transaction[] = [
  tx({ date: '2024-10-01', amount: 60_000, categoryId: 'transportation.insurance' }),
  tx({ date: '2024-12-01', amount: 6_000, type: 'interest', accountId: 'loan' }),
  tx({ date: '2024-12-01', amount: 50_000, type: 'debt_payment', accountId: 'chk', toAccountId: 'loan' }),
];

function ledger(transactions: Transaction[], asset = car()): LedgerData {
  const d = emptyLedger();
  d.accounts = [acct('chk', 'checking', 1_000_000), acct('loan', 'auto_loan', 1_200_000)];
  d.transactions = transactions;
  d.assets = [asset];
  return d;
}

describe('ownershipCost', () => {
  const summary = ownershipCost(ledger([...RECENT, ...OLDER]), 'car', TODAY)!;

  it('buckets tagged costs over the last 12 months', () => {
    const byKind = Object.fromEntries(summary.last12.lines.map((l) => [l.kind, l.amount]));
    expect(byKind).toEqual({
      insurance: 60_000,
      fuel: 8_000,
      maintenance: 15_000,
      fees: 9_000,
      tolls_parking: 1_000,
      loan_interest: 5_000,
      loan_principal: 35_000,
    });
    // The interest and the debt payment are not counted as tagged spending.
    expect(summary.last12.transactions).toBe(6);
    expect(summary.last12.months).toBe(12);
    expect(summary.last12.from).toBe('2025-09-18');
    expect(summary.last12.to).toBe(TODAY);
  });

  it('makes a full-year window report the same number twice', () => {
    // A 12-month window's yearly rate *is* its total, so the card must print
    // one of them, never "$X a year · $X in total".
    expect(summary.last12.months).toBe(12);
    expect(summary.last12.perYear).toBe(summary.last12.total);
  });

  it('keeps principal out of the cost of ownership but inside cash out', () => {
    const { last12 } = summary;
    expect(last12.loanInterest).toBe(5_000);
    expect(last12.loanPrincipal).toBe(35_000);
    expect(last12.running).toBe(98_000);
    expect(last12.cashOut).toBe(133_000);
    // The card's sentence splits cash out exactly this way: what became equity
    // and what was really spent (interest included).
    expect(last12.running + last12.loanPrincipal).toBe(last12.cashOut);
    expect(last12.loanInterest).toBeLessThan(last12.running);
    expect(last12.lines.find((l) => l.kind === 'loan_principal')!.cost).toBe(false);
    expect(last12.lines.find((l) => l.kind === 'loan_interest')!.cost).toBe(true);
  });

  it('adds depreciation and reports a monthly and yearly figure', () => {
    const { last12 } = summary;
    // $16,000 a year ago down to $13,000 today.
    expect(last12.depreciation).toBe(300_000);
    expect(last12.total).toBe(398_000);
    expect(last12.perMonth).toBe(33_167);
    expect(last12.perYear).toBe(398_000);
  });

  it('totals everything since purchase and per month owned', () => {
    const since = summary.sincePurchase;
    expect(since.from).toBe('2024-09-01');
    expect(summary.monthsOwned).toBeCloseTo(24.54, 1);
    expect(since.loanInterest).toBe(11_000);
    expect(since.loanPrincipal).toBe(79_000);
    // Running costs: last 12 months plus the older insurance and interest.
    expect(since.running).toBe(98_000 + 60_000 + 6_000);
    expect(since.depreciation).toBe(700_000);
    expect(since.total).toBe(864_000);
    expect(summary.perMonthOwned).toBe(35_205);
  });

  it('carries the loan and value context', () => {
    expect(summary.value).toBe(1_300_000);
    // Every payment reduces what is owed; interest adds it back.
    expect(summary.loan).toEqual({ id: 'loan', name: 'loan', balance: 1_200_000 - 90_000 + 11_000 });
    expect(summary.hasData).toBe(true);
    expect(summary.ownedFrom).toBe('2024-09-01');
  });
});

describe('ownershipCost edge cases', () => {
  it('returns null for an unknown asset', () => {
    expect(ownershipCost(emptyLedger(), 'nope', TODAY)).toBeNull();
  });

  it('reports no data when nothing links costs to the asset', () => {
    const bare = car({ expenseTag: undefined, linkedLiabilityId: undefined });
    const s = ownershipCost(ledger(RECENT, bare), 'car', TODAY)!;
    expect(s.hasData).toBe(false);
    expect(s.last12.lines).toHaveLength(0);
    expect(s.last12.running).toBe(0);
    // Depreciation still counts: it is a cost whether or not you tag anything.
    expect(s.last12.total).toBe(300_000);
  });

  it('shows a gain as negative depreciation', () => {
    const rising = car({
      expenseTag: undefined,
      linkedLiabilityId: undefined,
      valuations: [
        { id: 'v1', date: '2025-09-17', value: 1_000_000 },
        { id: 'v2', date: '2026-09-17', value: 1_200_000 },
      ],
    });
    const s = ownershipCost(ledger([], rising), 'car', TODAY)!;
    expect(s.last12.depreciation).toBe(-200_000);
    expect(s.last12.total).toBe(-200_000);
  });

  it('clips a short ownership window to the time actually owned', () => {
    const fresh = car({
      purchaseDate: '2026-06-17',
      purchasePrice: 1_000_000,
      linkedLiabilityId: undefined,
      valuations: [{ id: 'v1', date: '2026-09-17', value: 900_000 }],
    });
    const s = ownershipCost(ledger([tx({ date: '2026-07-01', amount: 30_000, categoryId: 'transportation.insurance' })], fresh), 'car', TODAY)!;
    expect(s.last12.from).toBe('2026-06-17');
    expect(s.last12.months).toBeCloseTo(3.06, 1);
    expect(s.last12.depreciation).toBe(100_000);
    expect(s.last12.total).toBe(130_000);
    // Annualized from three months, not spread over twelve.
    expect(s.last12.perMonth).toBe(42_547);
  });

  it('stops at the sale date when the asset is sold', () => {
    const sold = car({ soldDate: '2026-03-01' });
    const s = ownershipCost(ledger(RECENT, sold), 'car', TODAY)!;
    expect(s.ownedTo).toBe('2026-03-01');
    expect(s.last12.to).toBe('2026-03-01');
    // Only the costs up to the sale.
    expect(s.last12.running).toBe(60_000 + 4_000 + 5_000);
  });
});

describe('helpers', () => {
  it('maps categories to cost buckets', () => {
    expect(costKindOf('transportation.gas')).toBe('fuel');
    expect(costKindOf('transportation.ev_charging')).toBe('fuel');
    expect(costKindOf('transportation.repairs')).toBe('maintenance');
    expect(costKindOf('housing.property_tax')).toBe('fees');
    expect(costKindOf('transportation.car_lease')).toBe('payment');
    expect(costKindOf('food.restaurants')).toBe('other');
    expect(costKindOf(undefined)).toBe('other');
  });

  it('falls back to the purchase price before the first valuation', () => {
    const a = car();
    expect(valueOn(a, '2024-12-01')).toBe(2_000_000);
    expect(valueOn(a, '2025-10-01')).toBe(1_600_000);
    expect(valueOn(a, '2024-01-01')).toBeUndefined();
  });
});
