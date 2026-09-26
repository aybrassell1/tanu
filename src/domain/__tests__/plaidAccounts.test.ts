import { describe, expect, it } from 'vitest';

import { ACCOUNT_TYPES } from '../catalog';
import { accountTypeFor, draftAccountFrom } from '../plaidAccounts';

describe('an account at the bank, as an account here', () => {
  it('reads the kinds people actually have', () => {
    expect(accountTypeFor('depository', 'checking')).toBe('checking');
    expect(accountTypeFor('depository', 'savings')).toBe('savings');
    expect(accountTypeFor('depository', 'money market')).toBe('savings');
    expect(accountTypeFor('credit', 'credit card')).toBe('credit_card');
    expect(accountTypeFor('loan', 'student')).toBe('student_loan');
    expect(accountTypeFor('loan', 'auto')).toBe('auto_loan');
    expect(accountTypeFor('loan', 'mortgage')).toBe('mortgage');
    expect(accountTypeFor('investment', '401k')).toBe('401k');
    expect(accountTypeFor('investment', 'roth ira')).toBe('roth_ira');
    expect(accountTypeFor('depository', 'hsa')).toBe('hsa');
  });

  it('falls back to the right nature when the subtype is unfamiliar', () => {
    // A kind we have never heard of should still land somewhere sensible,
    // never as an asset when it is money owed.
    expect(accountTypeFor('credit', 'some new card product')).toBe('credit_card');
    expect(accountTypeFor('loan', 'whatever')).toBe('personal_loan');
    expect(accountTypeFor('depository', undefined)).toBe('checking');
    expect(accountTypeFor('investment', undefined)).toBe('brokerage');
    expect(accountTypeFor('nonsense', 'nonsense')).toBe('other_asset');
    expect(ACCOUNT_TYPES[accountTypeFor('credit', 'anything')].nature).toBe('liability');
  });

  it('is not fooled by capitals', () => {
    expect(accountTypeFor('DEPOSITORY', 'Checking')).toBe('checking');
    expect(accountTypeFor('Credit', 'CREDIT CARD')).toBe('credit_card');
  });

  it('opens at what the bank says, today', () => {
    const draft = draftAccountFrom(
      { name: 'Online Savings', mask: '1459', type: 'depository', subtype: 'savings', lastBalance: 812_345 },
      '2026-09-26',
      '#2469FE',
    );
    expect(draft.name).toBe('Online Savings ••1459');
    expect(draft.type).toBe('savings');
    expect(draft.startingBalance).toBe(812_345);
    // Starting today means history that arrives later is recorded without
    // moving a balance that was already right.
    expect(draft.startingDate).toBe('2026-09-26');
    expect(draft.icon).toBe(ACCOUNT_TYPES.savings.icon);
    expect(draft.archived).toBe(false);
  });

  it('opens at zero when the bank would not say', () => {
    const draft = draftAccountFrom({ name: 'Mystery', type: 'depository' }, '2026-09-26', '#000');
    expect(draft.startingBalance).toBe(0);
    expect(draft.name).toBe('Mystery');
  });
});
