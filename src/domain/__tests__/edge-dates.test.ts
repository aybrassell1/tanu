import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  addMonthsToMonth,
  dayOfWeek,
  daysInMonth,
  diffDays,
  formatDate,
  isValidISODate,
  lastMonths,
  monthEnd,
  monthRange,
  monthsBetween,
  nextDayOfMonth,
  relativeDay,
  relativePhrase,
  startOfWeek,
} from '../dates';
import { centsToInput, formatMoney, monthlyInterest, parseMoney } from '../money';
import {
  annualEquivalent,
  frequencyLabel,
  frequencySuffix,
  monthlyEquivalent,
  nextOccurrence,
  nthOccurrence,
  occurrencesBetween,
} from '../recurrence';

const TODAY = '2026-09-16';

describe('dates', () => {
  it('validates ISO dates including leap days', () => {
    expect(isValidISODate('2028-02-29')).toBe(true);
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2100-02-29')).toBe(false);
    expect(isValidISODate('2000-02-29')).toBe(true);
    expect(isValidISODate('2026-04-31')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('2026-00-10')).toBe(false);
    expect(isValidISODate('2026-9-1')).toBe(false);
    expect(isValidISODate('')).toBe(false);
  });

  it('adds days across year boundaries and leap days', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09'); // US DST start
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02'); // US DST end
    expect(diffDays('2026-03-07', '2026-03-09')).toBe(2);
    expect(diffDays('2028-01-01', '2029-01-01')).toBe(366);
    expect(diffDays('2027-01-01', '2026-12-31')).toBe(-1);
  });

  it('adds months with clamping and negative offsets', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', -13)).toBe('2024-12-15');
    expect(addMonths('2026-12-31', 2)).toBe('2027-02-28');
    expect(addMonths('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addMonthsToMonth('2026-01', -1)).toBe('2025-12');
    expect(monthsBetween('2025-11', '2026-02')).toBe(3);
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(lastMonths('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
    expect(monthEnd('2028-02')).toBe('2028-02-29');
    expect(daysInMonth(2100, 2)).toBe(28);
  });

  it('nextDayOfMonth clamps day 31 in 30-day months and February', () => {
    expect(nextDayOfMonth(31, '2026-04-15')).toBe('2026-04-30');
    expect(nextDayOfMonth(31, '2026-04-30')).toBe('2026-04-30');
    expect(nextDayOfMonth(31, '2026-05-01')).toBe('2026-05-31');
    expect(nextDayOfMonth(30, '2026-02-01')).toBe('2026-02-28');
    expect(nextDayOfMonth(15, '2026-12-16')).toBe('2027-01-15');
    expect(nextDayOfMonth(31, '2026-01-31')).toBe('2026-01-31');
    expect(nextDayOfMonth(29, '2028-02-29')).toBe('2028-02-29');
    // after clamped Feb 28, next is Mar 31 (not Mar 28)
    expect(nextDayOfMonth(31, '2026-03-01')).toBe('2026-03-31');
  });

  it('weekday helpers', () => {
    expect(dayOfWeek('2026-09-16')).toBe(3);
    expect(startOfWeek('2027-01-01', 0)).toBe('2026-12-27');
    expect(startOfWeek('2027-01-03', 1)).toBe('2026-12-28');
    expect(startOfWeek('2026-09-14', 1)).toBe('2026-09-14');
  });

  it('formats dates relative to a fixed today', () => {
    expect(formatDate('2026-02-05', 'short', TODAY)).toBe('Feb 5');
    expect(formatDate('2027-02-05', 'short', TODAY)).toBe('Feb 5, 2027');
    expect(formatDate('2026-09-16', 'long', TODAY)).toBe('Wed, September 16, 2026');
    expect(formatDate('2026-12-31', 'weekday', TODAY)).toBe('Thu, Dec 31');
  });

  it('relativeDay boundaries', () => {
    expect(relativeDay(TODAY, TODAY)).toBe('Today');
    expect(relativeDay('2026-09-17', TODAY)).toBe('Tomorrow');
    expect(relativeDay('2026-09-15', TODAY)).toBe('Yesterday');
    expect(relativeDay('2026-09-18', TODAY)).toBe('In 2 days');
    expect(relativeDay('2026-09-30', TODAY)).toBe('In 14 days');
    expect(relativeDay('2026-10-01', TODAY)).toBe('Oct 1');
    expect(relativeDay('2026-09-02', TODAY)).toBe('14 days ago');
    expect(relativeDay('2026-09-01', TODAY)).toBe('Sep 1');
    expect(relativeDay('2027-01-01', '2026-12-31')).toBe('Tomorrow');
    expect(relativeDay('2027-02-01', '2026-12-31')).toBe('Feb 1, 2027');
    expect(relativePhrase('2026-09-18', TODAY)).toBe('in 2 days');
    expect(relativePhrase('2026-09-02', TODAY)).toBe('14 days ago');
  });
});

describe('money parsing & formatting', () => {
  it('parses edge inputs', () => {
    expect(parseMoney('1,000')).toBe(100_000);
    expect(parseMoney('.5')).toBe(50);
    expect(parseMoney('5.')).toBe(500);
    expect(parseMoney(' 12 ')).toBe(1200);
    expect(parseMoney('1e3')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('-')).toBeNull();
    expect(parseMoney('.')).toBeNull();
    expect(parseMoney('$-5.25')).toBe(-525);
    expect(parseMoney('-$5.25')).toBe(-525);
    expect(parseMoney('0.1')).toBe(10);
    expect(parseMoney('19.99')).toBe(1999);
    expect(parseMoney('1.005')).toBeNull();
    expect(parseMoney('--5')).toBeNull();
    expect(parseMoney('5-')).toBeNull();
    expect(parseMoney('Infinity')).toBeNull();
    expect(parseMoney('NaN')).toBeNull();
  });

  it('"-0" parses to plain zero', () => {
    // BUG: parseMoney('-0') returns -0 (negative zero), which is !== 0 under Object.is
    // and can leak a signed zero into the ledger. Fix in money.ts:
    //   return negative && cents !== 0 ? -cents : cents;
    expect(Object.is(parseMoney('-0'), 0)).toBe(true);
  });

  it('"-." is not a number', () => {
    // BUG: parseMoney('-.') passes the regex (only '', '-' and '.' are excluded) and returns -0.
    // Fix: also reject when there are no digits at all, e.g. `if (!/\d/.test(cleaned)) return null;`
    expect(parseMoney('-.')).toBeNull();
  });

  it('round-trips centsToInput', () => {
    for (const c of [0, 1, 9, 10, 99, 100, 101, 123456, -1, -99, -100, -123456]) {
      expect(parseMoney(centsToInput(c))).toBe(c === 0 ? 0 : c);
    }
    expect(centsToInput(-5)).toBe('-0.05');
    expect(centsToInput(undefined)).toBe('');
  });

  it('formats negatives, signed and whole', () => {
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(-1)).toBe('−$0.01');
    expect(formatMoney(1, { signed: true })).toBe('+$0.01');
    expect(formatMoney(0, { signed: true })).toBe('$0.00');
    expect(formatMoney(-123456, { whole: true })).toBe('−$1,235');
  });

  it('compact thresholds', () => {
    expect(formatMoney(999_999, { compact: true })).toBe('$10,000'); // 9,999.99 rounds, below threshold
    expect(formatMoney(1_000_000, { compact: true })).toBe('$10K');
    expect(formatMoney(-1_250_000, { compact: true })).toBe('−$12.5K');
    expect(formatMoney(12_345_600, { compact: true })).toBe('$123K');
    expect(formatMoney(100_000_000, { compact: true })).toBe('$1M');
    expect(formatMoney(150_000_000, { compact: true })).toBe('$1.5M');
  });

  it('compact never shows 1000K', () => {
    // BUG: formatMoney(99_995_000, {compact:true}) → "$1000K" because 999.95 is < 1_000_000
    // dollars but trim() rounds it up to "1000". Fix: pick the unit after rounding, e.g.
    //   const k = abs / 1_000; if (abs >= 1_000_000 || Number(trim(k)) >= 1000) → use M.
    expect(formatMoney(99_995_000, { compact: true })).toBe('$1M');
  });

  it('monthlyInterest is integer', () => {
    expect(monthlyInterest(100_000, 24)).toBe(2_000);
    expect(monthlyInterest(0, 30)).toBe(0);
    expect(Number.isInteger(monthlyInterest(123_457, 19.99))).toBe(true);
  });
});

describe('recurrence edge cases', () => {
  const monthly = { unit: 'month', interval: 1 } as const;
  const yearly = { unit: 'year', interval: 1 } as const;

  it('Feb 29 yearly anchor clamps then returns to 29 in leap years', () => {
    expect(occurrencesBetween('2024-02-29', yearly, '2024-01-01', '2029-12-31')).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
      '2029-02-28',
    ]);
    expect(nextOccurrence('2024-02-29', yearly, '2027-03-01')).toBe('2028-02-29');
  });

  it('month-end anchor across a full year', () => {
    expect(occurrencesBetween('2026-01-31', monthly, '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
      '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31',
    ]);
    expect(occurrencesBetween('2026-01-30', monthly, '2026-02-01', '2026-03-31')).toEqual(['2026-02-28', '2026-03-30']);
  });

  it('weekly/biweekly across year boundaries', () => {
    expect(occurrencesBetween('2026-12-18', { unit: 'week', interval: 2 }, '2026-12-01', '2027-01-31')).toEqual(['2026-12-18', '2027-01-01', '2027-01-15', '2027-01-29']);
    expect(occurrencesBetween('2020-01-03', { unit: 'week', interval: 1 }, '2026-12-28', '2027-01-10')).toEqual(['2027-01-01', '2027-01-08']);
  });

  it('custom intervals', () => {
    expect(occurrencesBetween('2026-09-01', { unit: 'day', interval: 3 }, '2026-09-05', '2026-09-14')).toEqual(['2026-09-07', '2026-09-10', '2026-09-13']);
    expect(occurrencesBetween('2026-01-05', { unit: 'week', interval: 5 }, '2026-03-01', '2026-06-30')).toEqual(['2026-03-16', '2026-04-20', '2026-05-25', '2026-06-29']);
    expect(occurrencesBetween('2025-11-30', { unit: 'month', interval: 2 }, '2026-01-01', '2026-07-31')).toEqual(['2026-01-30', '2026-03-30', '2026-05-30', '2026-07-30']);
    expect(occurrencesBetween('2025-08-31', { unit: 'month', interval: 3 }, '2026-01-01', '2026-12-31')).toEqual(['2026-02-28', '2026-05-31', '2026-08-31', '2026-11-30']);
    expect(occurrencesBetween('2020-06-15', { unit: 'year', interval: 2 }, '2025-01-01', '2027-01-01')).toEqual(['2026-06-15']);
  });

  it('window before start, to before start, end date', () => {
    expect(occurrencesBetween('2026-09-10', monthly, '2026-01-01', '2026-10-31')).toEqual(['2026-09-10', '2026-10-10']);
    expect(occurrencesBetween('2026-09-10', monthly, '2026-01-01', '2026-09-09')).toEqual([]);
    expect(occurrencesBetween('2026-01-10', monthly, '2026-01-01', '2026-12-31', '2026-03-10')).toEqual(['2026-01-10', '2026-02-10', '2026-03-10']);
    expect(occurrencesBetween('2026-01-10', monthly, '2026-04-01', '2026-12-31', '2026-03-10')).toEqual([]);
    expect(occurrencesBetween('2026-01-10', monthly, '2026-05-01', '2026-04-01')).toEqual([]);
    expect(occurrencesBetween('2026-01-10', { unit: 'month', interval: 0 }, '2026-01-01', '2026-12-31')).toEqual([]);
    expect(nextOccurrence('2026-01-10', monthly, '2026-04-11', '2026-04-10')).toBeNull();
    expect(nextOccurrence('2026-01-31', monthly, '2026-02-01')).toBe('2026-02-28');
    expect(nextOccurrence('2026-01-01', { unit: 'week', interval: 10 }, '2026-01-02')).toBe('2026-03-12');
    expect(nextOccurrence('2026-01-01', { unit: 'day', interval: 400 }, '2026-01-02')).toBe(addDays('2026-01-01', 400));
  });

  it('nthOccurrence is consistent with occurrencesBetween for long-running schedules', () => {
    const f = { unit: 'month', interval: 1 } as const;
    const all = occurrencesBetween('2000-01-31', f, '2000-01-01', '2040-12-31');
    // Fast-forward path must agree with the full enumeration.
    const window = occurrencesBetween('2000-01-31', f, '2031-02-01', '2031-04-30');
    expect(window).toEqual(all.filter((d) => d >= '2031-02-01' && d <= '2031-04-30'));
    expect(nthOccurrence('2000-01-31', f, 1)).toBe('2000-02-29');
  });

  it('daily schedule over a long window is not silently truncated', () => {
    // BUG (minor): occurrencesBetween caps output at MAX_OCCURRENCES=2000 iterations, so a daily
    // item queried over > 2000 days silently drops the tail. Fix: bound by `last` only, or throw.
    const days = occurrencesBetween('2020-01-01', { unit: 'day', interval: 1 }, '2020-01-01', '2026-01-01');
    expect(days.length).toBe(diffDays('2020-01-01', '2026-01-01') + 1);
  });

  it('monthly/annual equivalents round to integer cents', () => {
    expect(monthlyEquivalent(1549, monthly)).toBe(1549);
    expect(monthlyEquivalent(13_900, yearly)).toBe(1158);
    expect(monthlyEquivalent(1000, { unit: 'week', interval: 1 })).toBe(4333);
    expect(monthlyEquivalent(100, { unit: 'day', interval: 1 })).toBe(3044);
    expect(monthlyEquivalent(9999, { unit: 'month', interval: 3 })).toBe(3333);
    expect(annualEquivalent(1549, monthly)).toBe(18_588);
    expect(annualEquivalent(225_000, { unit: 'week', interval: 2 })).toBe(5_850_000);
    expect(annualEquivalent(100, { unit: 'day', interval: 1 })).toBe(36_524);
    for (const f of [monthly, yearly, { unit: 'week', interval: 3 } as const, { unit: 'day', interval: 7 } as const]) {
      expect(Number.isInteger(monthlyEquivalent(12_345, f))).toBe(true);
      expect(Number.isInteger(annualEquivalent(12_345, f))).toBe(true);
    }
  });

  it('labels', () => {
    expect(frequencyLabel({ unit: 'day', interval: 1 })).toBe('Daily');
    expect(frequencyLabel({ unit: 'day', interval: 3 })).toBe('Every 3 days');
    expect(frequencyLabel({ unit: 'week', interval: 5 })).toBe('Every 5 weeks');
    expect(frequencySuffix({ unit: 'month', interval: 3 })).toBe('/qtr');
    expect(frequencySuffix({ unit: 'week', interval: 2 })).toBe('/2wk');
  });
});
