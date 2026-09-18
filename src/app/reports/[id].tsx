import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ComponentType } from 'react';

import { findReport, type ReportId } from '@/components/reports/catalog';
import { CashFlowReport, IncomeReport, SavingsRateReport } from '@/components/reports/FlowReports';
import { AccountsReport, LargestExpensesReport, MonthVsMonthReport, NormalMonthReport, RecurringReport, SpendingCategoriesReport } from '@/components/reports/SpendingReports';
import { DebtReport, NetWorthReport, YearReport } from '@/components/reports/TrendReports';
import { DailyReport } from '@/components/reports/DailyReport';
import { EmptyState, NavHeader, Screen, Text } from '@/components/ui';

const REPORT_COMPONENTS: Record<ReportId, ComponentType> = {
  'spending-categories': SpendingCategoriesReport,
  'month-vs-month': MonthVsMonthReport,
  'cash-flow': CashFlowReport,
  income: IncomeReport,
  'savings-rate': SavingsRateReport,
  debt: DebtReport,
  'net-worth': NetWorthReport,
  recurring: RecurringReport,
  'normal-month': NormalMonthReport,
  largest: LargestExpensesReport,
  accounts: AccountsReport,
  year: YearReport,
  daily: DailyReport,
};

export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const report = findReport(id);

  if (!report) {
    return (
      <Screen header={<NavHeader title="Report" />}>
        <EmptyState icon="bar-chart" title="Report not found" message="That report doesn't exist." actionLabel="All reports" onAction={() => router.replace('/reports')} />
      </Screen>
    );
  }

  const Report = REPORT_COMPONENTS[report.id];
  return (
    <Screen header={<NavHeader title={report.short} />}>
      <Text variant="h2" accessibilityRole="header">
        {report.question}
      </Text>
      <Report />
    </Screen>
  );
}
