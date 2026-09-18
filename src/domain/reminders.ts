import { addDays, formatDate, relativePhrase, startOfWeek } from './dates';
import { buildForecast } from './forecast';
import { formatMoney } from './money';
import { openEvents } from './schedule';
import type { Cents, ISODate, LedgerData } from './types';

/**
 * Plans the local reminders the device should schedule. Pure: it reads the
 * ledger and returns what *would* be delivered, so it can be previewed in the
 * UI and tested without touching the notification system.
 *
 * Everything here is derived from the same scheduled events the bills screen
 * and the forecast use, so a paid or skipped occurrence can never produce a
 * reminder and nothing is counted twice.
 */

export type ReminderKind = 'bill' | 'payday' | 'low_balance' | 'weekly_review';

export interface PlannedReminder {
  /** Stable across syncs, so re-scheduling is idempotent. */
  id: string;
  /** Local day the reminder fires. */
  date: ISODate;
  /**
   * The day the thing itself happens — the bill's due date, the payday, the
   * projected dip. Reminders for different days can all land on the same
   * firing day (a lead time slides past reminders forward to today), so this
   * is what orders them within that day.
   */
  dueDate: ISODate;
  /** Hour of the day (0–23) it fires. */
  hour: number;
  title: string;
  body: string;
  kind: ReminderKind;
}

/** How far ahead reminders are planned. */
export const REMINDER_HORIZON_DAYS = 60;
/** iOS keeps at most 64 pending local notifications, so stay below that. */
export const MAX_REMINDERS = 60;
/** Unpaid items older than this are no longer nagged about. */
const OVERDUE_LOOKBACK_DAYS = 14;

const KIND_ORDER: Record<ReminderKind, number> = { bill: 0, payday: 1, low_balance: 2, weekly_review: 3 };

export const REMINDER_KINDS: Record<ReminderKind, { label: string; icon: string }> = {
  bill: { label: 'Bill', icon: 'file-text' },
  payday: { label: 'Payday', icon: 'trending-up' },
  low_balance: { label: 'Low balance', icon: 'alert-triangle' },
  weekly_review: { label: 'Weekly review', icon: 'calendar' },
};

export function clampHour(hour: number): number {
  if (!Number.isFinite(hour)) return 9;
  return Math.min(23, Math.max(0, Math.round(hour)));
}

/** "9:00 AM" — used for the time picker and reminder subtitles. */
export function formatHour(hour: number): string {
  const h = clampHour(hour);
  const suffix = h < 12 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${suffix}`;
}

/**
 * The reminders to schedule for roughly the next two months, soonest first.
 * Returns an empty list when reminders are switched off.
 */
export function plannedReminders(data: LedgerData, today: ISODate): PlannedReminder[] {
  const prefs = data.settings.notifications;
  if (!prefs.enabled) return [];

  const hour = clampHour(prefs.hour);
  const horizon = addDays(today, REMINDER_HORIZON_DAYS);
  const money = (cents: Cents) => formatMoney(cents, { currency: data.settings.currency });
  const daysBefore = Math.max(0, Math.round(prefs.billsDaysBefore || 0));
  // A reminder is never scheduled into the past; it slides forward to today.
  const notBefore = (date: ISODate) => (date < today ? today : date);
  const planned: PlannedReminder[] = [];

  for (const event of openEvents(data, today, horizon, OVERDUE_LOOKBACK_DAYS)) {
    if (event.date > horizon) continue;

    if (event.kind === 'income') {
      if (!prefs.paydays || event.status === 'overdue') continue;
      const date = notBefore(event.date);
      planned.push({
        id: `payday:${event.key}`,
        date,
        dueDate: event.date,
        hour,
        kind: 'payday',
        title: `Payday · ${money(event.amount)}`,
        body: `${event.name} should land ${relativePhrase(event.date, date)}.`,
      });
      continue;
    }

    const date = notBefore(addDays(event.date, -daysBefore));
    planned.push({
      id: `bill:${event.key}`,
      date,
      dueDate: event.date,
      hour,
      kind: 'bill',
      title: `${event.name} · ${money(event.amount)}`,
      body:
        event.status === 'overdue'
          ? `Was due ${formatDate(event.date, 'weekday', date)} and still isn't marked paid.`
          : `${event.autopay ? 'Autopay runs' : 'Due'} ${relativePhrase(event.date, date)}${event.estimate ? ' (estimated amount)' : ''}.`,
    });
  }

  const floor = prefs.lowBalance;
  if (floor !== undefined && floor > 0) {
    const forecast = buildForecast(data, { today, to: horizon });
    // Every day of the forecast already has unpaid obligations applied, so the
    // first day under the floor is a projection even when it is today.
    const dip = forecast.days.find((d) => d.balance < floor);
    if (dip) {
      const date = notBefore(addDays(dip.date, -daysBefore));
      planned.push({
        id: `low_balance:${dip.date}`,
        date,
        dueDate: dip.date,
        hour,
        kind: 'low_balance',
        title: `Projected cash dips below ${money(floor)}`,
        body: `The plan leaves about ${money(dip.balance)} on ${formatDate(dip.date, 'weekday', date)}. Projected, not an actual balance.`,
      });
    }
  }

  if (prefs.weeklyReview) {
    let date = startOfWeek(today, data.settings.weekStartsOn);
    if (date < today) date = addDays(date, 7);
    for (; date <= horizon; date = addDays(date, 7)) {
      planned.push({
        id: `weekly_review:${date}`,
        date,
        dueDate: date,
        hour,
        kind: 'weekly_review',
        title: 'Weekly money review',
        body: 'Two minutes: look at last week’s spending and what’s coming up.',
      });
    }
  }

  const unique = new Map<string, PlannedReminder>();
  for (const reminder of planned) {
    if (reminder.date < today || reminder.date > horizon) continue;
    if (!unique.has(reminder.id)) unique.set(reminder.id, reminder);
  }

  // Soonest firing day first; within a day, whatever is due soonest.
  return [...unique.values()]
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id);
    })
    .slice(0, MAX_REMINDERS);
}
