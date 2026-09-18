import { describe, expect, it } from 'vitest';

import { emptyLedger } from '../factory';
import { claimAmountErrors, claimTotals, policiesForAsset, policyStatus, policySummary, suggestedPolicies, yearlyPremium } from '../policies';
import type { Account, Asset, LedgerData, Policy, PolicyClaim, Transaction } from '../types';

const stamp = '2026-01-01T00:00:00.000Z';
const TODAY = '2026-09-17';

let seq = 0;
const policy = (p: Partial<Policy> = {}): Policy => ({
  id: `pol${++seq}`,
  kind: 'auto',
  name: 'Policy',
  documents: [],
  claims: [],
  tags: [],
  archived: false,
  createdAt: stamp,
  updatedAt: stamp,
  ...p,
});

const claim = (c: Partial<PolicyClaim> = {}): PolicyClaim => ({ id: `clm${++seq}`, date: '2026-05-01', description: 'Claim', status: 'open', ...c });

const account = (a: Partial<Account> & Pick<Account, 'type'>): Account => ({
  id: `acc${++seq}`,
  name: 'Account',
  startingBalance: 0,
  startingDate: '2025-01-01',
  color: '#000',
  icon: 'x',
  tags: [],
  archived: false,
  createdAt: stamp,
  updatedAt: stamp,
  ...a,
});

const asset = (a: Partial<Asset> = {}): Asset => ({
  id: `ast${++seq}`,
  name: 'Thing',
  type: 'vehicle',
  valuations: [],
  tags: [],
  archived: false,
  createdAt: stamp,
  updatedAt: stamp,
  ...a,
});

const tx = (t: Partial<Transaction> & Pick<Transaction, 'type' | 'amount'>): Transaction => ({
  id: `t${++seq}`,
  date: '2026-06-01',
  description: 'x',
  accountId: 'chk',
  tags: [],
  attachments: [],
  createdAt: stamp,
  updatedAt: stamp,
  ...t,
});

const withPolicies = (policies: Policy[]): LedgerData => ({ ...emptyLedger(), policies });

describe('policyStatus', () => {
  it('reads the renewal date against today', () => {
    expect(policyStatus(policy({ renewalDate: '2026-12-31' }), TODAY)).toBe('active');
    // Exactly 60 days out is still "expiring soon".
    expect(policyStatus(policy({ renewalDate: '2026-11-16' }), TODAY)).toBe('expiring');
    expect(policyStatus(policy({ renewalDate: '2026-11-17' }), TODAY)).toBe('active');
    expect(policyStatus(policy({ renewalDate: TODAY }), TODAY)).toBe('expiring');
    expect(policyStatus(policy({ renewalDate: '2026-09-16' }), TODAY)).toBe('expired');
    expect(policyStatus(policy({}), TODAY)).toBe('none');
  });
});

describe('yearlyPremium', () => {
  it('normalises the premium from its frequency', () => {
    expect(yearlyPremium(policy({ premium: 12_000, premiumFrequency: { unit: 'month', interval: 1 } }))).toBe(144_000);
    expect(yearlyPremium(policy({ premium: 60_000, premiumFrequency: { unit: 'month', interval: 6 } }))).toBe(120_000);
    expect(yearlyPremium(policy({ premium: 5_000, premiumFrequency: { unit: 'week', interval: 1 } }))).toBe(260_000);
    // No frequency means the premium is already a yearly figure.
    expect(yearlyPremium(policy({ premium: 90_000 }))).toBe(90_000);
    expect(yearlyPremium(policy({}))).toBe(0);
  });
});

describe('claimTotals', () => {
  it('splits claimed, reimbursed and what is still outstanding', () => {
    const p = policy({
      claims: [
        claim({ amount: 100_000, reimbursed: 60_000, status: 'paid' }),
        claim({ amount: 40_000, status: 'open' }),
        claim({ amount: 25_000, reimbursed: 0, status: 'denied' }),
        // No amount recorded yet.
        claim({ status: 'open' }),
      ],
    });
    const t = claimTotals(p);
    expect(t.claimed).toBe(165_000);
    expect(t.reimbursed).toBe(60_000);
    // Denied claims never count as outstanding.
    expect(t.outstanding).toBe(40_000 + 40_000);
    expect(t.open).toBe(2);
    expect(t.denied).toBe(1);
  });

  it('never goes negative when reimbursement exceeds the claim', () => {
    const t = claimTotals(policy({ claims: [claim({ amount: 10_000, reimbursed: 15_000, status: 'paid' })] }));
    expect(t.outstanding).toBe(0);
    expect(t.reimbursed).toBe(15_000);
  });

  it('is zero for a policy with no claims', () => {
    expect(claimTotals(policy({}))).toEqual({ claimed: 0, reimbursed: 0, outstanding: 0, open: 0, denied: 0 });
  });
});

describe('policySummary', () => {
  it('groups by status and totals only what is still in force', () => {
    const data = withPolicies([
      policy({ kind: 'auto', name: 'Car', renewalDate: '2027-03-01', premium: 15_000, premiumFrequency: { unit: 'month', interval: 1 }, coverage: 10_000_000 }),
      policy({ kind: 'renters', name: 'Apartment', renewalDate: '2026-10-01', premium: 18_000, premiumFrequency: { unit: 'year', interval: 1 }, coverage: 3_000_000 }),
      policy({ kind: 'warranty', name: 'Laptop', renewalDate: '2026-01-05', premium: 9_900, coverage: 200_000 }),
      policy({ kind: 'life', name: 'Term life', coverage: 50_000_000 }),
      policy({ kind: 'pet', name: 'Old cover', renewalDate: '2027-01-01', premium: 5_000, archived: true }),
    ]);

    const s = policySummary(data, TODAY);
    expect(s.active.map((p) => p.name)).toEqual(['Car']);
    expect(s.expiringSoon.map((p) => p.name)).toEqual(['Apartment']);
    expect(s.expired.map((p) => p.name)).toEqual(['Laptop']);
    expect(s.undated.map((p) => p.name)).toEqual(['Term life']);
    // Expired and archived policies are excluded from both totals.
    expect(s.yearlyPremiums).toBe(180_000 + 18_000);
    expect(s.totalCoverage).toBe(10_000_000 + 3_000_000 + 50_000_000);
    expect(s.byKind.map((k) => k.kind)).toEqual(['auto', 'renters', 'life']);
    expect(s.byKind.find((k) => k.kind === 'auto')).toEqual({ kind: 'auto', count: 1, yearly: 180_000, coverage: 10_000_000 });
  });

  it('sorts by date and rolls up claims across every policy', () => {
    const data = withPolicies([
      policy({ name: 'Later', renewalDate: '2027-06-01', claims: [claim({ amount: 30_000, reimbursed: 10_000, status: 'paid' })] }),
      policy({ name: 'Sooner', renewalDate: '2026-12-01', claims: [claim({ amount: 20_000, status: 'open' })] }),
    ]);
    const s = policySummary(data, TODAY);
    expect(s.active.map((p) => p.name)).toEqual(['Sooner', 'Later']);
    expect(s.claims).toEqual({ claimed: 50_000, reimbursed: 10_000, outstanding: 40_000, open: 1, denied: 0 });
  });

  it('is empty and safe on an empty ledger', () => {
    const s = policySummary(emptyLedger(), TODAY);
    expect(s.active).toEqual([]);
    expect(s.yearlyPremiums).toBe(0);
    expect(s.totalCoverage).toBe(0);
    expect(s.byKind).toEqual([]);
  });
});

describe('policiesForAsset', () => {
  it('lists cover for one asset, soonest first, skipping archived', () => {
    const data = withPolicies([
      policy({ name: 'Warranty', kind: 'warranty', linkedAssetId: 'car', renewalDate: '2027-01-01' }),
      policy({ name: 'Auto', kind: 'auto', linkedAssetId: 'car', renewalDate: '2026-11-01' }),
      policy({ name: 'No date', kind: 'other', linkedAssetId: 'car' }),
      policy({ name: 'Other asset', kind: 'phone', linkedAssetId: 'phone' }),
      policy({ name: 'Archived', kind: 'auto', linkedAssetId: 'car', archived: true }),
    ]);
    expect(policiesForAsset(data, 'car').map((p) => p.name)).toEqual(['Auto', 'Warranty', 'No date']);
    expect(policiesForAsset(data, 'nothing')).toEqual([]);
  });
});

describe('suggestedPolicies', () => {
  const base = () => {
    const d = emptyLedger();
    d.accounts = [account({ id: 'chk', type: 'checking' })];
    return d;
  };

  it('flags a car with no auto policy, from an asset or an auto loan', () => {
    const fromAsset = base();
    fromAsset.assets = [asset({ type: 'vehicle' })];
    expect(suggestedPolicies(fromAsset).map((s) => s.key)).toEqual(['auto']);
    expect(suggestedPolicies(fromAsset)[0].title).toBe('You have a car but no auto policy recorded');

    const fromLoan = base();
    fromLoan.accounts.push(account({ type: 'auto_loan' }));
    expect(suggestedPolicies(fromLoan).map((s) => s.key)).toEqual(['auto']);

    // Recording an auto policy clears it.
    fromLoan.policies = [policy({ kind: 'auto' })];
    expect(suggestedPolicies(fromLoan)).toEqual([]);
    // An archived one does not.
    fromLoan.policies = [policy({ kind: 'auto', archived: true })];
    expect(suggestedPolicies(fromLoan).map((s) => s.key)).toEqual(['auto']);
    // Neither does a sold car.
    const sold = base();
    sold.assets = [asset({ type: 'vehicle', soldDate: '2026-02-01' })];
    expect(suggestedPolicies(sold)).toEqual([]);
  });

  it('flags a mortgage with no home policy, and renting with no renters policy', () => {
    const owner = base();
    owner.accounts.push(account({ type: 'mortgage' }));
    expect(suggestedPolicies(owner).map((s) => s.key)).toEqual(['home']);

    const renter = base();
    renter.transactions = [tx({ type: 'expense', amount: 150_000, categoryId: 'housing.rent' })];
    expect(suggestedPolicies(renter).map((s) => s.key)).toEqual(['renters']);

    // Paying rent while holding a mortgage is not a renter.
    const both = base();
    both.accounts.push(account({ type: 'mortgage' }));
    both.transactions = [tx({ type: 'expense', amount: 150_000, categoryId: 'housing.rent' })];
    expect(suggestedPolicies(both).map((s) => s.key)).toEqual(['home']);

    renter.policies = [policy({ kind: 'renters' })];
    expect(suggestedPolicies(renter)).toEqual([]);
  });

  it('flags pet costs with no pet policy, but ignores transfers', () => {
    const pets = base();
    pets.transactions = [tx({ type: 'expense', amount: 8_000, categoryId: 'pets.vet' })];
    expect(suggestedPolicies(pets).map((s) => s.key)).toEqual(['pet']);

    const transfersOnly = base();
    transfersOnly.transactions = [tx({ type: 'transfer', amount: 8_000, categoryId: 'pets.vet', toAccountId: 'chk' })];
    expect(suggestedPolicies(transfersOnly)).toEqual([]);
  });

  it('flags dependents with no life policy', () => {
    const family = base();
    family.taxProfile = { ...family.taxProfile, dependentsUnder17: 2 };
    const found = suggestedPolicies(family);
    expect(found.map((s) => s.key)).toEqual(['life']);
    expect(found[0].reason).toBe('Your tax profile lists 2 dependents.');

    family.taxProfile = { ...family.taxProfile, dependentsUnder17: 0, otherDependents: 1 };
    expect(suggestedPolicies(family)[0].reason).toBe('Your tax profile lists 1 dependent.');

    family.policies = [policy({ kind: 'life' })];
    expect(suggestedPolicies(family)).toEqual([]);
  });

  it('says nothing about an empty ledger', () => {
    expect(suggestedPolicies(emptyLedger())).toEqual([]);
  });
});

describe('claimAmountErrors', () => {
  it('accepts a claim reimbursed in part or in full', () => {
    expect(claimAmountErrors({ amount: 80_000, reimbursed: 0 })).toBeUndefined();
    expect(claimAmountErrors({ amount: 80_000, reimbursed: 30_000 })).toBeUndefined();
    expect(claimAmountErrors({ amount: 80_000, reimbursed: 80_000 })).toBeUndefined();
    // Nothing claimed and nothing back yet is a perfectly ordinary open claim.
    expect(claimAmountErrors({})).toBeUndefined();
    expect(claimAmountErrors({ amount: 80_000 })).toBeUndefined();
  });

  it('rejects being paid back more than was claimed', () => {
    expect(claimAmountErrors({ amount: 80_000, reimbursed: 90_000 })).toEqual({ reimbursed: 'Reimbursed cannot be more than the amount claimed.' });
    expect(claimAmountErrors({ reimbursed: 90_000 })?.amount).toContain('amount claimed');
  });

  it('rejects negative amounts', () => {
    expect(claimAmountErrors({ amount: -1 })?.amount).toBeTruthy();
    expect(claimAmountErrors({ amount: 100, reimbursed: -1 })?.reimbursed).toBeTruthy();
  });

  it('leaves the outstanding clamp in place for data recorded before the rule', () => {
    // claimTotals must never report a negative outstanding, whatever it is handed.
    const totals = claimTotals(policy({ claims: [claim({ amount: 80_000, reimbursed: 90_000, status: 'paid' })] }));
    expect(totals.outstanding).toBe(0);
    expect(totals.reimbursed).toBe(90_000);
  });
});
