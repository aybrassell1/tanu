import { addDays, addMonths, diffDays, monthsBetween, monthOf, parseISODate } from './dates';
import type { Cents, Frequency, ISODate } from './types';

export const FREQUENCY_PRESETS: { key: string; label: string; frequency: Frequency }[] = [
  { key: 'weekly', label: 'Weekly', frequency: { unit: 'week', interval: 1 } },
  { key: 'biweekly', label: 'Every 2 weeks', frequency: { unit: 'week', interval: 2 } },
  { key: 'monthly', label: 'Monthly', frequency: { unit: 'month', interval: 1 } },
  { key: 'quarterly', label: 'Quarterly', frequency: { unit: 'month', interval: 3 } },
  { key: 'semiannual', label: 'Every 6 months', frequency: { unit: 'month', interval: 6 } },
  { key: 'annual', label: 'Yearly', frequency: { unit: 'year', interval: 1 } },
];

const UNIT_LABEL = { day: 'day', week: 'week', month: 'month', year: 'year' } as const;

export function frequencyLabel(f: Frequency) {
  const preset = FREQUENCY_PRESETS.find((p) => p.frequency.unit === f.unit && p.frequency.interval === f.interval);
  if (preset) return preset.label;
  if (f.unit === 'day' && f.interval === 1) return 'Daily';
  return `Every ${f.interval} ${UNIT_LABEL[f.unit]}s`;
}

/** Short form for tight rows: "/mo", "/wk", "/2wk", "/yr". */
export function frequencySuffix(f: Frequency) {
  const unit = { day: 'day', week: 'wk', month: 'mo', year: 'yr' }[f.unit];
  if (f.unit === 'month' && f.interval === 3) return '/qtr';
  return f.interval === 1 ? `/${unit}` : `/${f.interval}${unit}`;
}

/** Safety net against runaway loops; the date window normally ends iteration first. */
const MAX_OCCURRENCES = 100_000;

/**
 * The nth occurrence (0-based) of a schedule. Month/year schedules keep the
 * start date's day of month and clamp in short months, so a bill due on the
 * 31st lands on Feb 28 without drifting to the 28th afterwards.
 */
export function nthOccurrence(start: ISODate, f: Frequency, n: number): ISODate {
  switch (f.unit) {
    case 'day':
      return addDays(start, n * f.interval);
    case 'week':
      return addDays(start, n * f.interval * 7);
    case 'month':
      return addMonths(start, n * f.interval, parseISODate(start).day);
    case 'year':
      return addMonths(start, n * f.interval * 12, parseISODate(start).day);
  }
}

/** Occurrence dates within [from, to], respecting an optional end date. */
export function occurrencesBetween(start: ISODate, f: Frequency, from: ISODate, to: ISODate, end?: ISODate): ISODate[] {
  if (f.interval < 1) return [];
  const last = end && end < to ? end : to;
  if (last < start || last < from) return [];

  let n = 0;
  if (from > start) {
    const approx =
      f.unit === 'day' || f.unit === 'week'
        ? Math.floor(diffDays(start, from) / (f.interval * (f.unit === 'week' ? 7 : 1)))
        : Math.floor(monthsBetween(monthOf(start), monthOf(from)) / (f.interval * (f.unit === 'year' ? 12 : 1)));
    n = Math.max(0, approx - 1);
  }

  const out: ISODate[] = [];
  for (let guard = 0; guard < MAX_OCCURRENCES; guard++, n++) {
    const date = nthOccurrence(start, f, n);
    if (date > last) break;
    if (date >= from) out.push(date);
  }
  return out;
}

export function nextOccurrence(start: ISODate, f: Frequency, onOrAfter: ISODate, end?: ISODate): ISODate | null {
  const horizon = f.unit === 'year' ? 400 * f.interval : 62 * f.interval + 7;
  return occurrencesBetween(start, f, onOrAfter, addDays(onOrAfter, horizon), end)[0] ?? null;
}

const DAYS_PER_MONTH = 365.2425 / 12;

/** Average monthly cost of a schedule. */
export function monthlyEquivalent(amount: Cents, f: Frequency): Cents {
  switch (f.unit) {
    case 'day':
      return Math.round((amount * DAYS_PER_MONTH) / f.interval);
    case 'week':
      return Math.round((amount * 52) / 12 / f.interval);
    case 'month':
      return Math.round(amount / f.interval);
    case 'year':
      return Math.round(amount / 12 / f.interval);
  }
}

export function annualEquivalent(amount: Cents, f: Frequency): Cents {
  switch (f.unit) {
    case 'day':
      return Math.round((amount * 365.2425) / f.interval);
    case 'week':
      return Math.round((amount * 52) / f.interval);
    case 'month':
      return Math.round((amount * 12) / f.interval);
    case 'year':
      return Math.round(amount / f.interval);
  }
}

/** Expected occurrences per month (e.g. biweekly ≈ 2.17). */
export function occurrencesPerMonth(f: Frequency) {
  return monthlyEquivalent(1_000_000, f) / 1_000_000;
}
