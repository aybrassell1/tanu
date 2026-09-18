import type { IconName } from '@/data/icons';

export type ReportId =
  | 'spending-categories'
  | 'month-vs-month'
  | 'cash-flow'
  | 'income'
  | 'savings-rate'
  | 'debt'
  | 'net-worth'
  | 'recurring'
  | 'normal-month'
  | 'largest'
  | 'accounts'
  | 'year'
  | 'daily';

export interface ReportInfo {
  id: ReportId;
  /** The question the report answers. */
  question: string;
  /** What the report shows. */
  subtitle: string;
  /** Short title for the nav bar. */
  short: string;
  icon: IconName;
}

export const REPORT_SECTIONS: { title: string; reports: ReportInfo[] }[] = [
  {
    title: 'Spending',
    reports: [
      { id: 'spending-categories', question: 'Where is my money going?', subtitle: 'Spending by category and subcategory', short: 'Spending by category', icon: 'pie-chart' },
      { id: 'month-vs-month', question: 'Am I spending more than last month?', subtitle: 'This month so far vs the same point last month', short: 'Month vs month', icon: 'columns' },
      { id: 'normal-month', question: 'What does a normal month cost?', subtitle: 'Average monthly spending and income', short: 'Typical month', icon: 'calendar' },
      { id: 'recurring', question: 'What do my recurring costs add up to?', subtitle: 'Bills, subscriptions and planned payments', short: 'Recurring costs', icon: 'repeat' },
      { id: 'daily', question: 'Which days do I spend the most?', subtitle: 'Spending heatmap, no-spend days and weekday habits', short: 'Daily spending', icon: 'grid' },
      { id: 'largest', question: 'What were my biggest expenses?', subtitle: 'Your largest single purchases', short: 'Largest expenses', icon: 'maximize-2' },
      { id: 'accounts', question: 'Which accounts do I spend from?', subtitle: 'Spending by card and account', short: 'Spending by account', icon: 'credit-card' },
    ],
  },
  {
    title: 'Income & saving',
    reports: [
      { id: 'cash-flow', question: 'Am I cash-flow positive?', subtitle: 'Income vs spending for 12 months', short: 'Cash flow', icon: 'activity' },
      { id: 'income', question: 'How is my income trending?', subtitle: 'Monthly income and where it comes from', short: 'Income', icon: 'briefcase' },
      { id: 'savings-rate', question: 'How much am I saving?', subtitle: 'Money kept each month and your savings rate', short: 'Savings rate', icon: 'shield' },
    ],
  },
  {
    title: 'Debt & net worth',
    reports: [
      { id: 'debt', question: 'Is my debt going down?', subtitle: 'Total owed at each month-end', short: 'Debt trend', icon: 'trending-down' },
      { id: 'net-worth', question: 'Is my net worth growing?', subtitle: 'What you own minus what you owe', short: 'Net worth trend', icon: 'bar-chart-2' },
    ],
  },
  {
    title: 'Year',
    reports: [{ id: 'year', question: 'How does this year compare to last year?', subtitle: 'Year to date vs the same period last year', short: 'Year over year', icon: 'layers' }],
  },
];

export const REPORTS: ReportInfo[] = REPORT_SECTIONS.flatMap((s) => s.reports);

export const findReport = (id: string | undefined) => REPORTS.find((r) => r.id === id);
