/**
 * What your bank says, next to what this app worked out.
 *
 * Balances here are derived: add up the transactions and that is the number.
 * A bank's own figure is a second opinion, and when the two disagree it means
 * something is missing — a charge that never came across, a fee nobody
 * recorded, a starting balance that was a guess.
 *
 * So the difference is shown rather than silently applied. Overwriting a
 * derived balance without saying so would hide the very thing worth knowing.
 */

import { balanceOn, indexLedger } from './ledger';
import type { Cents, ID, ISODate, LedgerData } from './types';

/** Differences smaller than this are rounding and pending noise, not news. */
export const NOISE = 1;

export interface BalanceCheck {
  connectionId: ID;
  /** The bank's id for the account. */
  externalId: string;
  accountId: ID;
  accountName: string;
  /** What the bank last told us. */
  bank: Cents;
  /** What this app adds up to. */
  derived: Cents;
  /** Bank minus derived: positive means the bank thinks you have more. */
  difference: Cents;
  /** When the bank's figure was taken. */
  asOf?: string;
  agrees: boolean;
}

/**
 * Every connected account where a bank balance has been seen, newest
 * disagreement first. Accounts nobody has linked are not included.
 */
export function balanceChecks(data: LedgerData, today: ISODate): BalanceCheck[] {
  const index = indexLedger(data);
  const out: BalanceCheck[] = [];

  for (const connection of data.connections) {
    for (const account of connection.accounts) {
      if (!account.accountId || account.lastBalance === undefined) continue;
      const local = data.accounts.find((a) => a.id === account.accountId);
      if (!local || local.archived) continue;
      const derived = balanceOn(index, account.accountId, today);
      const difference = account.lastBalance - derived;
      out.push({
        connectionId: connection.id,
        externalId: account.externalId,
        accountId: account.accountId,
        accountName: local.name,
        bank: account.lastBalance,
        derived,
        difference,
        asOf: account.lastBalanceAt,
        agrees: Math.abs(difference) <= NOISE,
      });
    }
  }

  return out.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
}

/** Just the ones worth a word, and what they add up to. */
export function balanceDisagreements(checks: BalanceCheck[]): { checks: BalanceCheck[]; total: Cents } {
  const off = checks.filter((c) => !c.agrees);
  return { checks: off, total: off.reduce((sum, c) => sum + c.difference, 0) };
}

/**
 * Plaid reports a credit card's balance as what you owe, and this app stores
 * it the same way, so both natures compare directly. Investment accounts give
 * a current value, which is the same idea.
 */
export const bankBalanceOf = (balances: { current?: number | null } | undefined): Cents | undefined =>
  balances?.current === null || balances?.current === undefined ? undefined : Math.round(balances.current * 100);
