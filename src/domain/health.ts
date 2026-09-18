import { financialSnapshot } from './affordability';
import { addMonthsToMonth, lastMonths, monthEnd, monthOf } from './dates';
import { monthBudgets } from './budgets';
import { monthEndDates, netWorthTrend, overallUtilization } from './position';
import { monthlySeries, savingsRate as savingsRateOver, trailingYear } from './reports';
import type { ISODate, LedgerData } from './types';

/**
 * A quick "money checkup": a handful of vital signs compared against widely
 * used rules of thumb. Informational only.
 *
 * The savings rate is the one defined in `reports.ts`, measured over the
 * trailing 12 months (`trailingYear`) — the same window Retirement uses, so
 * the two screens can never disagree. Year in review measures the same rate
 * over a calendar year and labels it as such.
 */

export type HealthStatus = 'strong' | 'okay' | 'weak' | 'na';

export interface HealthMetric {
  key: string;
  label: string;
  emoji: string;
  /** Headline value already formatted for display. */
  display: string;
  status: HealthStatus;
  /** Short target, e.g. "3+ months". */
  target: string;
  /** 0–1 position for a mini meter; null when not applicable. */
  meter: number | null;
  href: string;
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function moneyCheckup(data: LedgerData, today: ISODate): { metrics: HealthMetric[]; strong: number; rated: number } {
  const s = financialSnapshot(data, today);
  const lastComplete = addMonthsToMonth(monthOf(today), -1);
  const months = monthlySeries(data, lastComplete, 6, monthEnd(lastComplete));
  const window = trailingYear(today);
  const { rate: savingsRate, hasIncome } = savingsRateOver(data, window.from, window.to);
  const positiveMonths = months.filter((m) => m.income > 0 || m.spending > 0).filter((m) => m.saved > 0).length;
  const activeMonths = months.filter((m) => m.income > 0 || m.spending > 0).length;

  const util = overallUtilization(data, today);
  // Change since tracking began (opening balances aren't growth); needs at
  // least one earlier month-end to rate.
  const nw = netWorthTrend(data, monthEndDates(lastMonths(monthOf(today), 13), today));
  const nwChange = nw.change.change;
  const hasHistory = nw.points.length > 1 && nw.points.some((p) => p.assets > 0 || p.liabilities > 0);
  const budgets = monthBudgets(data, monthOf(today), today).lines.filter((l) => l.budget.mode === 'limit');
  const dti = s.gross > 0 ? s.debtPayments / s.gross : 0;

  const metrics: HealthMetric[] = [
    {
      key: 'emergency',
      label: 'Emergency cushion',
      emoji: 'umbrella',
      display: s.essential > 0 ? `${Math.min(99, s.emergencyMonths).toFixed(1)} mo` : '—',
      status: s.essential <= 0 ? 'na' : s.emergencyMonths >= 3 ? 'strong' : s.emergencyMonths >= 1 ? 'okay' : 'weak',
      target: '3–6 months',
      meter: s.essential > 0 ? clamp(s.emergencyMonths / 6) : null,
      href: '/savings',
    },
    {
      key: 'savings_rate',
      label: 'Savings rate, 12 months',
      emoji: 'money-bag',
      display: hasIncome ? pct(savingsRate) : '—',
      status: !hasIncome ? 'na' : savingsRate >= 0.2 ? 'strong' : savingsRate >= 0.1 ? 'okay' : 'weak',
      target: '20%+ of income kept',
      meter: hasIncome ? clamp(savingsRate / 0.3) : null,
      href: '/reports/savings-rate',
    },
    {
      key: 'dti',
      label: 'Debt payments vs income',
      emoji: 'balance-scale',
      display: s.gross > 0 ? pct(dti) : '—',
      status: s.gross <= 0 ? 'na' : dti <= 0.2 ? 'strong' : dti <= 0.36 ? 'okay' : 'weak',
      target: 'Under 20%',
      meter: s.gross > 0 ? clamp(1 - dti / 0.5) : null,
      href: '/debt',
    },
    {
      key: 'utilization',
      label: 'Credit used',
      emoji: 'credit-card',
      display: util.limit > 0 ? pct(util.utilization) : '—',
      status: util.limit <= 0 ? 'na' : util.utilization < 0.3 ? 'strong' : util.utilization < 0.5 ? 'okay' : 'weak',
      target: 'Under 30%',
      meter: util.limit > 0 ? clamp(1 - util.utilization) : null,
      href: '/debt',
    },
    {
      key: 'cash_flow',
      label: 'Months in the green',
      emoji: 'chart-increasing',
      display: activeMonths ? `${positiveMonths} of ${activeMonths}` : '—',
      status: !activeMonths ? 'na' : positiveMonths / activeMonths >= 0.8 ? 'strong' : positiveMonths / activeMonths >= 0.5 ? 'okay' : 'weak',
      target: 'Most months',
      meter: activeMonths ? positiveMonths / activeMonths : null,
      href: '/reports/cash-flow',
    },
    {
      key: 'net_worth',
      label: 'Net worth, 12 months',
      emoji: 'gem-stone',
      display: hasHistory ? (nwChange >= 0 ? '▲ Up' : '▼ Down') : '—',
      status: !hasHistory ? 'na' : nwChange > 0 ? 'strong' : nwChange === 0 ? 'okay' : 'weak',
      target: 'Growing',
      meter: null,
      href: '/net-worth',
    },
  ];
  if (budgets.length) {
    const onTrack = budgets.filter((b) => b.state !== 'over').length;
    metrics.push({
      key: 'budgets',
      label: 'Budgets on track',
      emoji: 'bullseye',
      display: `${onTrack} of ${budgets.length}`,
      status: onTrack === budgets.length ? 'strong' : onTrack / budgets.length >= 0.5 ? 'okay' : 'weak',
      target: 'All',
      meter: onTrack / budgets.length,
      href: '/budgets',
    });
  }

  const rated = metrics.filter((m) => m.status !== 'na');
  return { metrics, strong: rated.filter((m) => m.status === 'strong').length, rated: rated.length };
}
