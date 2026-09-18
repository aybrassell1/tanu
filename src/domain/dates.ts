import type { ISODate, ISOMonth } from './types';

/**
 * Calendar-date helpers working on `YYYY-MM-DD` strings. Arithmetic runs in
 * UTC so daylight-saving transitions can never shift a date.
 */

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function toISODate(year: number, month: number, day: number): ISODate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function parseISODate(date: ISODate) {
  const [y, m, d] = date.split('-').map(Number);
  return { year: y, month: m, day: d };
}

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = parseISODate(value);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** The local calendar date of a stored timestamp (stamps are UTC). */
export function localDateOf(timestamp: string): ISODate {
  const d = new Date(timestamp);
  return Number.isNaN(d.getTime()) ? timestamp.slice(0, 10) : toISODate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function todayISO(now = new Date()): ISODate {
  return toISODate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toUTC(date: ISODate) {
  const { year, month, day } = parseISODate(date);
  return Date.UTC(year, month - 1, day);
}

function fromUTC(ms: number): ISODate {
  const d = new Date(ms);
  return toISODate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

const DAY_MS = 86_400_000;

export function addDays(date: ISODate, days: number): ISODate {
  return fromUTC(toUTC(date) + days * DAY_MS);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function diffDays(a: ISODate, b: ISODate) {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
}

/**
 * Adds months, keeping `anchorDay` (defaults to the date's own day) and
 * clamping to the month's length: Jan 31 + 1 month → Feb 28/29.
 */
export function addMonths(date: ISODate, months: number, anchorDay?: number): ISODate {
  const { year, month, day } = parseISODate(date);
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return toISODate(y, m, Math.min(anchorDay ?? day, daysInMonth(y, m)));
}

/** 0 = Sunday. */
export function dayOfWeek(date: ISODate) {
  return new Date(toUTC(date)).getUTCDay();
}

export function startOfWeek(date: ISODate, weekStartsOn: 0 | 1 = 0) {
  const offset = (dayOfWeek(date) - weekStartsOn + 7) % 7;
  return addDays(date, -offset);
}

export const minDate = (a: ISODate, b: ISODate) => (a < b ? a : b);
export const maxDate = (a: ISODate, b: ISODate) => (a > b ? a : b);

// ─── Months ──────────────────────────────────────────────────────────────────

export function monthOf(date: ISODate): ISOMonth {
  return date.slice(0, 7);
}

export function monthStart(month: ISOMonth): ISODate {
  return `${month}-01`;
}

export function monthEnd(month: ISOMonth): ISODate {
  const [y, m] = month.split('-').map(Number);
  return toISODate(y, m, daysInMonth(y, m));
}

export function addMonthsToMonth(month: ISOMonth, n: number): ISOMonth {
  return monthOf(addMonths(monthStart(month), n));
}

/** Inclusive list of months from `from` to `to`. */
export function monthRange(from: ISOMonth, to: ISOMonth): ISOMonth[] {
  const out: ISOMonth[] = [];
  for (let m = from; m <= to; m = addMonthsToMonth(m, 1)) out.push(m);
  return out;
}

/** The last `count` months ending with `endMonth`, oldest first. */
export function lastMonths(endMonth: ISOMonth, count: number): ISOMonth[] {
  return monthRange(addMonthsToMonth(endMonth, -(count - 1)), endMonth);
}

export function monthsBetween(from: ISOMonth, to: ISOMonth) {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** Next date on or after `from` that falls on `day` of a month (clamped). */
export function nextDayOfMonth(day: number, from: ISODate): ISODate {
  const { year, month } = parseISODate(from);
  const thisMonth = toISODate(year, month, Math.min(day, daysInMonth(year, month)));
  return thisMonth >= from ? thisMonth : addMonths(toISODate(year, month, 1), 1, day);
}

// ─── Formatting ──────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type DateStyle = 'short' | 'medium' | 'weekday' | 'long';

export function formatDate(date: ISODate, style: DateStyle = 'short', today = todayISO()) {
  const { year, month, day } = parseISODate(date);
  const base = `${MONTHS[month - 1]} ${day}`;
  const { year: thisYear } = parseISODate(today);
  switch (style) {
    case 'short':
      return year === thisYear ? base : `${base}, ${year}`;
    case 'medium':
      return `${base}, ${year}`;
    case 'weekday':
      return `${WEEKDAYS[dayOfWeek(date)]}, ${year === thisYear ? base : `${base}, ${year}`}`;
    case 'long':
      return `${WEEKDAYS[dayOfWeek(date)]}, ${MONTHS_LONG[month - 1]} ${day}, ${year}`;
  }
}

export function formatMonth(month: ISOMonth, style: 'long' | 'short' | 'tiny' = 'long') {
  const [y, m] = month.split('-').map(Number);
  if (style === 'tiny') return MONTHS[m - 1].charAt(0);
  if (style === 'short') return MONTHS[m - 1];
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** Lower-cased relative day for use mid-sentence ("due in 3 days", "due Nov 5"). */
export function relativePhrase(date: ISODate, today = todayISO()) {
  const s = relativeDay(date, today);
  return /^(Today|Tomorrow|Yesterday|In )/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/** "Today", "Tomorrow", "In 3 days", "2 days ago", else a short date. */
export function relativeDay(date: ISODate, today = todayISO()) {
  const diff = diffDays(today, date);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff <= 14) return `In ${diff} days`;
  if (diff < -1 && diff >= -14) return `${-diff} days ago`;
  return formatDate(date, 'short', today);
}
