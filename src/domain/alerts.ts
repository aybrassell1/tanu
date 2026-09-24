import { isCreditCard } from './catalog';
import { addDays, diffDays, formatDate, monthOf, relativePhrase } from './dates';
import { buildForecast } from './forecast';
import { allocationsByAccount, goalProgress } from './goals';
import { balanceOn, indexLedger, creditInfo } from './ledger';
import { needsCategory, tidySummary } from './merchants';
import { formatMoney } from './money';
import { detectPriceChanges, priceChangeAlerts } from './priceChanges';
import { candidateTotals, detectRecurring } from './recurringDetect';
import { monthBudgets } from './budgets';
import { iouBalance, iouSummary } from './ious';
import { daysUntilRenewal, isWarranty, policySummary } from './policies';
import { openEvents } from './schedule';
import { fundsDueSoon } from './sinking';
import { taxReminders } from './taxes';
import type { LedgerData, ISODate } from './types';

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface FinanceAlert {
  id: string;
  severity: AlertSeverity;
  icon: string;
  title: string;
  detail: string;
  href?: string;
}

const RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** Reminders derived from the data. Nothing here is stored. */
export function buildAlerts(data: LedgerData, today: ISODate, format?: (cents: number) => string): FinanceAlert[] {
  const index = indexLedger(data);
  const money = format ?? ((c: number) => formatMoney(c, { currency: data.settings.currency }));
  const alerts: FinanceAlert[] = [];

  const open = openEvents(data, today, addDays(today, 3));
  const autopayToConfirm = open.filter((e) => e.status === 'overdue' && e.autopay && e.source === 'recurring');
  if (autopayToConfirm.length) {
    alerts.push({
      id: 'autopay:confirm',
      severity: 'info',
      icon: 'check-square',
      title: `${autopayToConfirm.length} autopay charge${autopayToConfirm.length > 1 ? 's' : ''} to confirm`,
      detail: autopayToConfirm.map((e) => `${e.name} ${money(e.amount)}`).join(', '),
      href: '/bills',
    });
  }

  for (const e of open) {
    if (e.kind === 'income' || autopayToConfirm.includes(e)) continue;
    if (e.status === 'overdue') {
      alerts.push({
        id: `overdue:${e.key}`,
        severity: 'critical',
        icon: 'alert-triangle',
        title: `${e.name} is past due`,
        detail: `${money(e.amount)} was due ${formatDate(e.date)}. Mark it paid or skip it.`,
        href: e.source === 'recurring' ? `/bills/${e.sourceId}` : e.source === 'debt' ? `/accounts/${e.sourceId}` : undefined,
      });
    } else if (!e.autopay) {
      alerts.push({
        id: `due:${e.key}`,
        severity: 'warning',
        icon: 'clock',
        title: `${e.name} due ${relativePhrase(e.date, today)}`,
        detail: `${money(e.amount)} · not on autopay`,
        href: e.source === 'recurring' ? `/bills/${e.sourceId}` : e.source === 'debt' ? `/accounts/${e.sourceId}` : undefined,
      });
    }
  }

  const forecast = buildForecast(data, { today, to: addDays(today, 30) });
  if (forecast.accountIds.length && forecast.lowest.balance < 0) {
    alerts.push({
      id: 'forecast:negative',
      severity: 'critical',
      icon: 'trending-down',
      title: 'Cash projected to go negative',
      detail: `Spendable cash could reach ${money(forecast.lowest.balance)} on ${formatDate(forecast.lowest.date)}.`,
      href: '/forecast',
    });
  }

  for (const line of monthBudgets(data, monthOf(today), today).lines) {
    if (line.budget.mode === 'flexible') continue;
    if (line.state === 'over') {
      alerts.push({ id: `budget:${line.budget.id}`, severity: 'warning', icon: 'pie-chart', title: `${line.category.name} is over budget`, detail: `${money(line.spent)} of ${money(line.amount)} this month`, href: '/budgets' });
    } else if (line.state === 'approaching') {
      alerts.push({ id: `budget:${line.budget.id}`, severity: 'info', icon: 'pie-chart', title: `${line.category.name} budget nearly used`, detail: `${money(line.remaining)} left this month`, href: '/budgets' });
    }
  }

  for (const account of data.accounts) {
    if (account.archived) continue;
    const balance = balanceOn(index, account.id, today);
    const credit = creditInfo(account, balance);
    if (credit && credit.utilization >= 0.3) {
      alerts.push({ id: `util:${account.id}`, severity: credit.utilization >= 0.7 ? 'warning' : 'info', icon: 'credit-card', title: `${account.name} at ${Math.round(credit.utilization * 100)}% utilization`, detail: `${money(credit.available)} of ${money(credit.limit)} available`, href: `/accounts/${account.id}` });
    }
    if (account.promoExpires && account.promoApr !== undefined && balance > 0) {
      const days = diffDays(today, account.promoExpires);
      if (days >= 0 && days <= 60) {
        alerts.push({ id: `promo:${account.id}`, severity: 'warning', icon: 'percent', title: `${account.name} promo APR ends ${relativePhrase(account.promoExpires, today)}`, detail: `${money(balance)} balance moves to ${account.apr ?? 0}% APR`, href: `/accounts/${account.id}` });
      }
    }
    if (isCreditCard(account.type) && balance > 0 && !account.dueDay) {
      alerts.push({ id: `nodue:${account.id}`, severity: 'info', icon: 'calendar', title: `Add a due date for ${account.name}`, detail: 'Needed to include the payment in upcoming bills and cash flow.', href: `/accounts/edit?id=${account.id}` });
    }
  }

  for (const alloc of allocationsByAccount(data, today).values()) {
    if (!alloc.overAllocated) continue;
    const name = index.accounts.get(alloc.accountId)?.name ?? 'An account';
    alerts.push({ id: `alloc:${alloc.accountId}`, severity: 'warning', icon: 'layers', title: `${name} is over-allocated`, detail: `Goals claim ${money(alloc.allocated)} but the balance is ${money(alloc.balance)}.`, href: '/savings' });
  }

  for (const goal of data.goals) {
    if (goal.archived || !goal.targetDate) continue;
    const p = goalProgress(data, goal, today);
    if (p.status === 'behind' && p.requiredMonthly) {
      alerts.push({ id: `goal:${goal.id}`, severity: 'info', icon: 'flag', title: `${goal.name} is behind schedule`, detail: `About ${money(p.requiredMonthly)}/mo needed to finish by ${formatDate(goal.targetDate)}.`, href: `/goals/${goal.id}` });
    }
  }

  // Price creep, measured from real charges rather than stored amounts.
  // `priceChangeAlerts` already returns this shape, so nothing is recomputed.
  for (const alert of priceChangeAlerts(detectPriceChanges(data, today), money)) alerts.push(alert);

  const unused = data.recurring.filter((r) => r.active && r.kind === 'subscription' && (r.usage === 'never' || r.usage === 'rarely'));
  if (unused.length) {
    alerts.push({ id: 'subs:unused', severity: 'info', icon: 'refresh-cw', title: `${unused.length} subscription${unused.length > 1 ? 's' : ''} you rarely use`, detail: unused.map((r) => r.name).join(', '), href: '/subscriptions' });
  }

  for (const r of taxReminders(data, today, money)) alerts.push({ id: r.id, severity: r.severity, icon: 'percent', title: r.title, detail: r.detail, href: r.href });

  for (const policy of policySummary(data, today).expiringSoon) {
    const days = daysUntilRenewal(policy, today);
    alerts.push({
      id: `policy:${policy.id}`,
      severity: days !== null && days <= 14 ? 'warning' : 'info',
      icon: 'shield',
      title: `${policy.name} ${isWarranty(policy.kind) ? 'expires' : 'renews'} ${relativePhrase(policy.renewalDate!, today)}`,
      detail: [policy.provider, policy.premium ? `${money(policy.premium)} premium` : null].filter(Boolean).join(' · '),
      href: `/policies/${policy.id}`,
    });
  }

  for (const iou of iouSummary(data, today).overdue) {
    const { outstanding } = iouBalance(iou);
    alerts.push({
      id: `iou:${iou.id}`,
      severity: 'info',
      icon: 'users',
      title: iou.direction === 'owed_to_me' ? `${iou.person} still owes you` : `You still owe ${iou.person}`,
      detail: `${money(outstanding)} · due ${formatDate(iou.dueDate!)}`,
      href: `/ious/${iou.id}`,
    });
  }

  for (const status of fundsDueSoon(data, today)) {
    const fund = status.fund;
    if (status.shortfall <= 0) continue;
    alerts.push({
      id: `sink:${fund.id}`,
      severity: status.overdue ? 'warning' : 'info',
      icon: 'umbrella',
      title: `${fund.name} needs ${money(status.shortfall)} more`,
      detail: status.overdue ? `Due ${formatDate(fund.dueDate!)}` : `Due ${relativePhrase(fund.dueDate!, today)} · ${money(status.requiredMonthly ?? status.monthly)}/mo to get there`,
      href: '/sinking',
    });
  }

  // A bill the app doesn't know about is missing from every forecast.
  const untracked = candidateTotals(detectRecurring(data, today).filter((c) => c.status === 'active'));
  if (untracked.count > 0) {
    alerts.push({
      id: 'recurring:found',
      severity: 'info',
      icon: 'repeat',
      title: untracked.count === 1 ? '1 charge looks like a bill you don’t track' : `${untracked.count} charges look like bills you don’t track`,
      detail: `About ${money(untracked.monthly)} a month, missing from your forecast`,
      href: '/bills/detected',
    });
  }

  // Uncategorised money is money the reports and budgets can't explain.
  const tidy = tidySummary(needsCategory(data));
  if (tidy.total >= 3) {
    alerts.push({
      id: 'tidy:uncategorized',
      severity: 'info',
      icon: 'tag',
      title: `${tidy.total} transactions have no category`,
      detail: tidy.suggested > 0 ? `${tidy.suggested} can be filed from your own history` : 'Reports and budgets leave them out',
      href: '/tidy',
    });
  }

  return alerts.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}
