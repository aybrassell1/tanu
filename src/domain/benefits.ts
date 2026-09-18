import { INCOME_TYPES } from './catalog';
import { addDays } from './dates';
import { expectedGross, scheduledEvents } from './schedule';
import type { Cents, ID, IncomeSource, ISODate, LedgerData, Transaction } from './types';

/**
 * Employer 401(k) match: how much of it you have actually captured.
 *
 * The plan is described on the income source as `match = { percent, upToPercent }`,
 * read as "the employer pays `percent`% of every dollar you put in, on the first
 * `upToPercent`% of your pay". So one paycheck earns:
 *
 *     match = gross × min(yourRate, upToPercent)/100 × percent/100
 *
 * Only recorded paychecks count as fact: `grossAmount` is the pay the match is
 * sized from and `withholding.retirement` is what you deferred into the plan.
 * Everything after today is a projection from the pay schedule and is labelled
 * as such by the caller.
 */

const pct = (n: number) => n / 100;

/** A single recorded paycheck seen through the match formula. */
export interface MatchPaycheck {
  txId: ID;
  date: ISODate;
  gross: Cents;
  contributed: Cents;
  /** Percent of gross deferred on this paycheck. */
  rate: number;
  matched: Cents;
  /** What the employer would have paid at the full match rate. */
  available: Cents;
  missed: Cents;
}

export interface MatchStatus {
  sourceId: ID;
  name: string;
  employer?: string;
  /** null when no match is set up for this source yet. */
  match: { percent: number; upToPercent: number } | null;
  year: number;
  paychecks: MatchPaycheck[];
  /** Paychecks recorded without a gross amount; the match can't be sized from them. */
  missingGross: number;

  grossYtd: Cents;
  contributedYtd: Cents;
  /** Contribution rate so far, percent of gross. */
  rateYtd: number;
  matchEarnedYtd: Cents;
  /** Match the pay so far could have earned at the full rate. */
  matchAvailableYtd: Cents;
  /** Match already gone: available minus earned, year to date. */
  missedYtd: Cents;

  /** Paychecks still expected between today and the end of the year. */
  upcomingPaychecks: number;
  upcomingGross: Cents;
  /** Rate the projection assumes going forward (latest paycheck, else the source's withholding). */
  currentRate: number;

  projectedGross: Cents;
  projectedContribution: Cents;
  projectedMatch: Cents;
  projectedAvailable: Cents;
  /** Money left on the table by year end if nothing changes. */
  projectedMissed: Cents;

  /** Match the paychecks still to come would earn at `currentRate`. Whole year minus year to date. */
  remainingMatch: Cents;
  /** Match those same paychecks could earn at the full rate. */
  remainingAvailable: Cents;
  /** What the rest of the year alone would leave behind. */
  remainingMissed: Cents;

  /** Rate that captures every future match dollar (the plan's cap). */
  fullRate: number;
  /**
   * Rate on the remaining paychecks that would bring the whole year's
   * contribution up to `upToPercent` of annual pay. Relevant for plans that
   * true up at year end. null when no pay is left to adjust.
   */
  catchUpRate: number | null;
  onTrack: boolean;
}

export interface MatchOverview {
  year: number;
  /** Active sources that have a match configured. */
  sources: MatchStatus[];
  /** Active sources with no match set up, so the screen can offer to add one. */
  withoutMatch: { sourceId: ID; name: string; employer?: string }[];
  matchEarnedYtd: Cents;
  matchAvailableYtd: Cents;
  missedYtd: Cents;
  projectedMatch: Cents;
  projectedAvailable: Cents;
  projectedMissed: Cents;
  onTrack: boolean;
}

/** Rounding slack so a cent of division never reads as "leaving money on the table". */
const TOLERANCE: Cents = 100;

const inYear = (date: ISODate, year: number) => date.startsWith(`${year}-`);

/** Paychecks recorded against an income source in a year, oldest first. */
export function paychecksFor(data: LedgerData, sourceId: ID, year: number, upTo: ISODate): Transaction[] {
  return data.transactions
    .filter((t) => t.type === 'income' && t.incomeSourceId === sourceId && inYear(t.date, year) && t.date <= upTo)
    .sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date < b.date ? -1 : 1));
}

/** The rate a paycheck deferred, as a percent of gross. */
const rateOf = (gross: Cents, contributed: Cents) => (gross > 0 ? (contributed / gross) * 100 : 0);

/** Employer money earned on `gross` when you defer at `rate` percent. */
function matchOn(gross: Cents, rate: number, match: { percent: number; upToPercent: number }): Cents {
  if (gross <= 0) return 0;
  const counted = Math.max(0, Math.min(rate, match.upToPercent));
  return Math.round(gross * pct(counted) * pct(match.percent));
}

/** The rate the projection should assume: what the most recent paycheck did. */
function currentRateOf(source: IncomeSource, paychecks: MatchPaycheck[]): number {
  for (let i = paychecks.length - 1; i >= 0; i--) if (paychecks[i].gross > 0) return paychecks[i].rate;
  const planned = source.withholding?.retirement;
  const gross = expectedGross(source);
  return planned !== undefined && gross ? rateOf(gross, planned) : 0;
}

/** Gross pay still expected from a source between tomorrow and the end of the year. */
function upcomingPay(data: LedgerData, source: IncomeSource, year: number, today: ISODate) {
  const yearEnd = `${year}-12-31`;
  if (today >= yearEnd) return { count: 0, gross: 0 };
  const from = today < `${year}-01-01` ? `${year}-01-01` : addDays(today, 1);
  const events = scheduledEvents(data, { from, to: yearEnd, today }).filter(
    (e) => e.kind === 'income' && e.source === 'income' && e.sourceId === source.id && e.status === 'upcoming',
  );
  const per = expectedGross(source);
  let gross = 0;
  for (const e of events) gross += per ?? e.amount;
  return { count: events.length, gross };
}

export function matchStatus(data: LedgerData, sourceId: ID, year: number, today: ISODate): MatchStatus | null {
  const source = data.incomeSources.find((s) => s.id === sourceId);
  if (!source) return null;
  const match = source.match && source.match.upToPercent > 0 && source.match.percent > 0 ? source.match : null;
  const cutoff = today < `${year}-12-31` ? today : `${year}-12-31`;

  const paychecks: MatchPaycheck[] = [];
  let missingGross = 0;
  for (const t of paychecksFor(data, sourceId, year, cutoff)) {
    if (t.grossAmount === undefined) missingGross++;
    const gross = t.grossAmount ?? t.amount;
    const contributed = t.withholding?.retirement ?? 0;
    const rate = rateOf(gross, contributed);
    const matched = match ? matchOn(gross, rate, match) : 0;
    const available = match ? matchOn(gross, match.upToPercent, match) : 0;
    paychecks.push({ txId: t.id, date: t.date, gross, contributed, rate, matched, available, missed: available - matched });
  }

  const grossYtd = paychecks.reduce((s, p) => s + p.gross, 0);
  const contributedYtd = paychecks.reduce((s, p) => s + p.contributed, 0);
  const matchEarnedYtd = paychecks.reduce((s, p) => s + p.matched, 0);
  const matchAvailableYtd = paychecks.reduce((s, p) => s + p.available, 0);

  const upcoming = upcomingPay(data, source, year, today);
  const currentRate = currentRateOf(source, paychecks);
  const projectedGross = grossYtd + upcoming.gross;
  const projectedContribution = contributedYtd + Math.round(upcoming.gross * pct(currentRate));
  const remainingMatch = match ? matchOn(upcoming.gross, currentRate, match) : 0;
  const remainingAvailable = match ? matchOn(upcoming.gross, match.upToPercent, match) : 0;
  const projectedMatch = matchEarnedYtd + remainingMatch;
  const projectedAvailable = matchAvailableYtd + remainingAvailable;

  const fullRate = match?.upToPercent ?? 0;
  const targetContribution = match ? projectedGross * pct(match.upToPercent) : 0;
  const catchUpRate =
    match && upcoming.gross > 0 ? Math.max(0, ((targetContribution - contributedYtd) / upcoming.gross) * 100) : null;

  return {
    sourceId: source.id,
    name: source.name,
    employer: source.employer,
    match,
    year,
    paychecks,
    missingGross,
    grossYtd,
    contributedYtd,
    rateYtd: rateOf(grossYtd, contributedYtd),
    matchEarnedYtd,
    matchAvailableYtd,
    missedYtd: matchAvailableYtd - matchEarnedYtd,
    upcomingPaychecks: upcoming.count,
    upcomingGross: upcoming.gross,
    currentRate,
    projectedGross,
    projectedContribution,
    projectedMatch,
    projectedAvailable,
    projectedMissed: projectedAvailable - projectedMatch,
    remainingMatch,
    remainingAvailable,
    remainingMissed: remainingAvailable - remainingMatch,
    fullRate,
    catchUpRate,
    onTrack: projectedAvailable - projectedMatch <= TOLERANCE,
  };
}

/** Every active income source's match, plus the ones that have none set up. */
export function matchOverview(data: LedgerData, year: number, today: ISODate): MatchOverview {
  const active = data.incomeSources.filter((s) => s.active);
  const sources: MatchStatus[] = [];
  const withoutMatch: MatchOverview['withoutMatch'] = [];
  for (const s of active) {
    const status = matchStatus(data, s.id, year, today);
    if (!status) continue;
    if (status.match) sources.push(status);
    // Only a job can come with a match; interest and freelance income never do.
    else if (INCOME_TYPES[s.type].employment) withoutMatch.push({ sourceId: s.id, name: s.name, employer: s.employer });
  }
  const total = (pick: (s: MatchStatus) => Cents) => sources.reduce((sum, s) => sum + pick(s), 0);
  const projectedAvailable = total((s) => s.projectedAvailable);
  const projectedMatch = total((s) => s.projectedMatch);
  return {
    year,
    sources,
    withoutMatch,
    matchEarnedYtd: total((s) => s.matchEarnedYtd),
    matchAvailableYtd: total((s) => s.matchAvailableYtd),
    missedYtd: total((s) => s.missedYtd),
    projectedMatch,
    projectedAvailable,
    projectedMissed: projectedAvailable - projectedMatch,
    onTrack: projectedAvailable - projectedMatch <= TOLERANCE,
  };
}
