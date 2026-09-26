/**
 * Making an account here out of one at the bank.
 *
 * The bank has already told us the name, what kind of account it is and what
 * is in it. Asking someone to type all that again, accurately, before they can
 * use any of it is the sort of thing that makes people give up on an app.
 */

import { ACCOUNT_TYPES } from './catalog';
import type { Account, AccountType, Cents, ConnectedAccount, ISODate } from './types';

/**
 * Plaid's type and subtype, as this app's kinds. Their taxonomy is broader
 * than ours in places, so several of theirs land on one of ours; anything
 * unrecognised falls back to something harmless of the right nature.
 */
const BY_SUBTYPE: Record<string, AccountType> = {
  checking: 'checking',
  savings: 'savings',
  hsa: 'hsa',
  cd: 'savings',
  'money market': 'savings',
  'cash management': 'checking',
  ebt: 'cash',
  prepaid: 'cash',
  paypal: 'cash',

  'credit card': 'credit_card',

  auto: 'auto_loan',
  student: 'student_loan',
  mortgage: 'mortgage',
  home: 'mortgage',
  'home equity': 'mortgage',
  loan: 'personal_loan',
  'line of credit': 'personal_loan',
  construction: 'personal_loan',
  consumer: 'personal_loan',
  business: 'personal_loan',
  commercial: 'personal_loan',
  overdraft: 'personal_loan',

  '401k': '401k',
  '401a': '401k',
  '403B': '401k',
  '457b': '401k',
  ira: 'traditional_ira',
  'roth ira': 'roth_ira',
  roth: 'roth_ira',
  'roth 401k': 'roth_ira',
  brokerage: 'brokerage',
  'non-taxable brokerage account': 'brokerage',
  mutual_fund: 'brokerage',
  stock_plan: 'brokerage',
  crypto_exchange: 'other_investment',
};

const BY_TYPE: Record<string, AccountType> = {
  depository: 'checking',
  credit: 'credit_card',
  loan: 'personal_loan',
  investment: 'brokerage',
  brokerage: 'brokerage',
  other: 'other_asset',
};

export function accountTypeFor(type: string, subtype?: string): AccountType {
  const bySubtype = subtype ? BY_SUBTYPE[subtype.toLowerCase()] : undefined;
  return bySubtype ?? BY_TYPE[type.toLowerCase()] ?? 'other_asset';
}

/**
 * An account ready to save, from what the bank said.
 *
 * It starts today at the balance the bank reports, so the number is right from
 * the first minute. History that arrives later is still recorded and still
 * shows in reports, but it does not move a balance that was already correct.
 */
export function draftAccountFrom(
  connected: Pick<ConnectedAccount, 'name' | 'mask' | 'type' | 'subtype' | 'lastBalance'>,
  today: ISODate,
  color: string,
): Omit<Account, 'id' | 'createdAt' | 'updatedAt'> {
  const type = accountTypeFor(connected.type, connected.subtype);
  return {
    name: connected.mask ? `${connected.name} ••${connected.mask}` : connected.name,
    type,
    startingBalance: connected.lastBalance ?? 0,
    startingDate: today,
    color,
    icon: ACCOUNT_TYPES[type].icon,
    tags: [],
    archived: false,
  };
}

/** What the new account would start at, for saying so before you tap. */
export const openingBalanceOf = (connected: { lastBalance?: Cents }): Cents => connected.lastBalance ?? 0;
