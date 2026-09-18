import { addDays } from '@/domain/dates';
import { nextOccurrence } from '@/domain/recurrence';
import type { ISODate, LedgerData, RecurringItem, RecurringKind, SubscriptionUsage } from '@/domain/types';

/** Next due date on or after today that isn't already paid or skipped. */
export function nextDueDate(data: LedgerData, item: RecurringItem, today: ISODate): ISODate | null {
  const settled = new Set(data.transactions.filter((t) => t.recurringId === item.id && t.occurrenceDate).map((t) => t.occurrenceDate));
  let from = today;
  for (let i = 0; i < 60; i++) {
    const date = nextOccurrence(item.startDate, item.frequency, from, item.endDate);
    if (!date) return null;
    if (!settled.has(date) && !item.skipped.includes(date)) return date;
    from = addDays(date, 1);
  }
  return null;
}

export const RECURRING_GROUPS: { key: string; title: string; kinds: RecurringKind[] }[] = [
  { key: 'bills', title: 'Bills', kinds: ['bill'] },
  { key: 'subscriptions', title: 'Subscriptions', kinds: ['subscription'] },
  { key: 'debt', title: 'Debt payments', kinds: ['debt_payment'] },
  { key: 'savings', title: 'Savings & transfers', kinds: ['savings', 'transfer'] },
  { key: 'investments', title: 'Investments', kinds: ['investment'] },
];

export const USAGE_OPTIONS: { value: SubscriptionUsage; label: string }[] = [
  { value: 'often', label: 'Often' },
  { value: 'sometimes', label: 'Sometimes' },
  { value: 'rarely', label: 'Rarely' },
  { value: 'never', label: 'Never' },
];

export const USAGE_BADGE: Record<SubscriptionUsage, { tone: 'positive' | 'primary' | 'warning' | 'negative'; label: string }> = {
  often: { tone: 'positive', label: 'Use often' },
  sometimes: { tone: 'primary', label: 'Sometimes' },
  rarely: { tone: 'warning', label: 'Rarely used' },
  never: { tone: 'negative', label: 'Not used' },
};
