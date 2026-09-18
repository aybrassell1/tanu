import { diffDays } from './dates';
import { spendingAmount } from './ledger';
import { sum } from './money';
import { annualEquivalent } from './recurrence';
import type { Cents, ID, ISODate, LedgerData, Policy, PolicyClaim, PolicyKind } from './types';

/**
 * Insurance policies and warranties: what is covered, what it costs per year
 * and what has been claimed. Everything here is a plain read of what the user
 * recorded — no advice about how much cover to buy.
 */

export interface PolicyKindInfo {
  label: string;
  /** Feather icon name. */
  icon: string;
  /** Illustration key from `data/iconify.generated.ts`. */
  emoji: string;
  /** Warranties expire; insurance renews. Changes the wording around dates. */
  warranty?: boolean;
}

export const POLICY_KINDS: Record<PolicyKind, PolicyKindInfo> = {
  auto: { label: 'Auto', icon: 'truck', emoji: 'automobile' },
  home: { label: 'Home', icon: 'home', emoji: 'house-with-garden' },
  renters: { label: 'Renters', icon: 'key', emoji: 'key' },
  health: { label: 'Health', icon: 'activity', emoji: 'medical-symbol' },
  dental: { label: 'Dental', icon: 'smile', emoji: 'tooth' },
  vision: { label: 'Vision', icon: 'eye', emoji: 'glasses' },
  life: { label: 'Life', icon: 'users', emoji: 'heart-with-ribbon' },
  disability: { label: 'Disability', icon: 'user-check', emoji: 'manual-wheelchair' },
  umbrella: { label: 'Umbrella', icon: 'shield', emoji: 'umbrella' },
  pet: { label: 'Pet', icon: 'heart', emoji: 'paw-prints' },
  travel: { label: 'Travel', icon: 'map', emoji: 'luggage' },
  phone: { label: 'Phone', icon: 'smartphone', emoji: 'mobile-phone' },
  warranty: { label: 'Warranty', icon: 'file-text', emoji: 'page-with-curl', warranty: true },
  other: { label: 'Other', icon: 'shield', emoji: 'shield' },
};

/** Order used by pickers and the grouped list. */
export const POLICY_KIND_ORDER: PolicyKind[] = ['auto', 'home', 'renters', 'health', 'dental', 'vision', 'life', 'disability', 'umbrella', 'pet', 'travel', 'phone', 'warranty', 'other'];

export const isWarranty = (kind: PolicyKind) => POLICY_KINDS[kind].warranty === true;

/** How many days ahead counts as "expiring soon". */
export const EXPIRING_SOON_DAYS = 60;

export type PolicyStatus = 'active' | 'expiring' | 'expired' | 'none';

/**
 * Where a policy sits against today.
 * `none` means no renewal/expiry date was recorded, so nothing can be said.
 */
export function policyStatus(policy: Policy, today: ISODate): PolicyStatus {
  if (!policy.renewalDate) return 'none';
  if (policy.renewalDate < today) return 'expired';
  return diffDays(today, policy.renewalDate) <= EXPIRING_SOON_DAYS ? 'expiring' : 'active';
}

/** Days until renewal/expiry; negative once it has passed. `null` without a date. */
export function daysUntilRenewal(policy: Policy, today: ISODate): number | null {
  return policy.renewalDate ? diffDays(today, policy.renewalDate) : null;
}

/** What a policy costs per year, normalised from its premium and frequency. */
export function yearlyPremium(policy: Policy): Cents {
  if (!policy.premium) return 0;
  return annualEquivalent(policy.premium, policy.premiumFrequency ?? { unit: 'year', interval: 1 });
}

export interface ClaimTotals {
  /** Everything claimed, whatever the status. */
  claimed: Cents;
  /** Money actually paid back. */
  reimbursed: Cents;
  /** Claimed but not yet reimbursed, on claims that aren't denied. */
  outstanding: Cents;
  open: number;
  denied: number;
}

export function claimTotals(policy: Policy): ClaimTotals {
  let claimed = 0;
  let reimbursed = 0;
  let outstanding = 0;
  let open = 0;
  let denied = 0;
  for (const claim of policy.claims) {
    const amount = claim.amount ?? 0;
    const paid = claim.reimbursed ?? 0;
    claimed += amount;
    reimbursed += paid;
    if (claim.status === 'denied') denied += 1;
    else {
      if (claim.status === 'open') open += 1;
      outstanding += Math.max(0, amount - paid);
    }
  }
  return { claimed, reimbursed, outstanding, open, denied };
}

/**
 * What is wrong with a claim's two money fields, as field → message, or
 * `undefined` when they hold together. You can never be paid back more than you
 * claimed: `claimTotals` clamps outstanding at zero, which would otherwise hide
 * the mistake behind a sensible-looking total.
 */
export function claimAmountErrors(claim: Pick<PolicyClaim, 'amount' | 'reimbursed'>): Record<string, string> | undefined {
  const { amount, reimbursed } = claim;
  if (amount !== undefined && amount < 0) return { amount: 'An amount claimed cannot be negative.' };
  if (reimbursed !== undefined && reimbursed < 0) return { reimbursed: 'A reimbursement cannot be negative.' };
  if (reimbursed === undefined || reimbursed === 0) return undefined;
  if (amount === undefined) return { amount: 'Enter the amount claimed before recording what came back.' };
  if (reimbursed > amount) return { reimbursed: 'Reimbursed cannot be more than the amount claimed.' };
  return undefined;
}

export interface PolicySummary {
  active: Policy[];
  /** Renewal or expiry within the next 60 days (and not already past). */
  expiringSoon: Policy[];
  expired: Policy[];
  /** Policies with no renewal/expiry date recorded. */
  undated: Policy[];
  /** Total yearly cost of every policy that is not expired or archived. */
  yearlyPremiums: Cents;
  /** Total coverage recorded across those same policies. */
  totalCoverage: Cents;
  byKind: { kind: PolicyKind; count: number; yearly: Cents; coverage: Cents }[];
  claims: ClaimTotals;
}

/**
 * Counts and totals across every policy that isn't archived. Expired policies
 * are listed but never counted toward premiums or coverage.
 */
export function policySummary(data: LedgerData, today: ISODate): PolicySummary {
  const live = data.policies.filter((p) => !p.archived);
  const active: Policy[] = [];
  const expiringSoon: Policy[] = [];
  const expired: Policy[] = [];
  const undated: Policy[] = [];

  for (const policy of live) {
    const status = policyStatus(policy, today);
    if (status === 'expired') expired.push(policy);
    else if (status === 'expiring') expiringSoon.push(policy);
    else if (status === 'active') active.push(policy);
    else undated.push(policy);
  }

  const current = live.filter((p) => policyStatus(p, today) !== 'expired');
  const byKind = POLICY_KIND_ORDER.map((kind) => {
    const of = current.filter((p) => p.kind === kind);
    return { kind, count: of.length, yearly: sum(of.map(yearlyPremium)), coverage: sum(of.map((p) => p.coverage ?? 0)) };
  }).filter((k) => k.count > 0);

  const claims = live.reduce<ClaimTotals>(
    (totals, policy) => {
      const t = claimTotals(policy);
      return {
        claimed: totals.claimed + t.claimed,
        reimbursed: totals.reimbursed + t.reimbursed,
        outstanding: totals.outstanding + t.outstanding,
        open: totals.open + t.open,
        denied: totals.denied + t.denied,
      };
    },
    { claimed: 0, reimbursed: 0, outstanding: 0, open: 0, denied: 0 },
  );

  const byDate = (a: Policy, b: Policy) => (a.renewalDate ?? '').localeCompare(b.renewalDate ?? '');

  return {
    active: [...active].sort(byDate),
    expiringSoon: [...expiringSoon].sort(byDate),
    expired: [...expired].sort((a, b) => byDate(b, a)),
    undated,
    yearlyPremiums: sum(current.map(yearlyPremium)),
    totalCoverage: sum(current.map((p) => p.coverage ?? 0)),
    byKind,
    claims,
  };
}

/** Policies and warranties covering one asset, soonest renewal first. */
export function policiesForAsset(data: LedgerData, assetId: ID): Policy[] {
  return data.policies
    .filter((p) => p.linkedAssetId === assetId && !p.archived)
    .sort((a, b) => (a.renewalDate ?? '9999-12-31').localeCompare(b.renewalDate ?? '9999-12-31'));
}

export interface PolicySuggestion {
  key: string;
  kind: PolicyKind;
  /** What the user has, stated as a fact. */
  title: string;
  /** Where that fact came from. */
  reason: string;
}

/**
 * Gaps worth flagging, inferred only from what the user already recorded.
 * These state a fact ("you have a car but no auto policy recorded") and never
 * recommend a product or an amount of cover.
 */
export function suggestedPolicies(data: LedgerData): PolicySuggestion[] {
  const live = data.policies.filter((p) => !p.archived);
  const has = (kind: PolicyKind) => live.some((p) => p.kind === kind);

  const accounts = data.accounts.filter((a) => !a.archived);
  const hasAccount = (type: string) => accounts.some((a) => a.type === type);
  const hasAsset = (type: string) => data.assets.some((a) => !a.archived && !a.soldDate && a.type === type);

  const spentPrefixes = new Set<string>();
  for (const tx of data.transactions) {
    if (!tx.categoryId || spendingAmount(tx) === 0) continue;
    spentPrefixes.add(tx.categoryId);
  }
  const spent = (prefix: string) => [...spentPrefixes].some((id) => id === prefix || id.startsWith(prefix));

  const out: PolicySuggestion[] = [];

  const car = hasAsset('vehicle') || hasAccount('auto_loan');
  if (car && !has('auto')) {
    out.push({
      key: 'auto',
      kind: 'auto',
      title: 'You have a car but no auto policy recorded',
      reason: hasAsset('vehicle') ? 'You track a vehicle as an asset.' : 'You have an auto loan.',
    });
  }

  const mortgage = hasAccount('mortgage') || hasAsset('property');
  if (mortgage && !has('home')) {
    out.push({
      key: 'home',
      kind: 'home',
      title: 'You have a home but no home policy recorded',
      reason: hasAccount('mortgage') ? 'You have a mortgage.' : 'You track a property as an asset.',
    });
  }

  if (!mortgage && spent('housing.rent') && !has('renters')) {
    out.push({ key: 'renters', kind: 'renters', title: 'You pay rent but have no renters policy recorded', reason: 'You have spending in Rent.' });
  }

  if (spent('pets.') && !has('pet')) {
    out.push({ key: 'pet', kind: 'pet', title: 'You have pet costs but no pet policy recorded', reason: 'You have spending in Pets.' });
  }

  const dependents = data.taxProfile.dependentsUnder17 + data.taxProfile.otherDependents;
  if (dependents > 0 && !has('life')) {
    out.push({
      key: 'life',
      kind: 'life',
      title: 'You have dependents but no life policy recorded',
      reason: `Your tax profile lists ${dependents} dependent${dependents === 1 ? '' : 's'}.`,
    });
  }

  return out;
}
