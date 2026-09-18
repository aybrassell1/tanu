import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { WIDGETS, type DashboardModel } from '@/components/dashboard/Widgets';
import { Banner, Button, EmptyState, IconButton, Row, Screen, Text } from '@/components/ui';
import { buildAlerts } from '@/domain/alerts';
import { monthBudgets } from '@/domain/budgets';
import { accountGroup, isInvestment } from '@/domain/catalog';
import { addDays, addMonths, formatDate, lastMonths, monthOf, monthStart } from '@/domain/dates';
import { debtSummary } from '@/domain/debt';
import { buildForecast } from '@/domain/forecast';
import { DEFAULT_DASHBOARD } from '@/domain/factory';
import { moneyCheckup } from '@/domain/health';
import { allocatedAmounts, emergencyFund, goalProgress } from '@/domain/goals';
import { balanceOn, indexLedger, investmentInfo } from '@/domain/ledger';
import { sum } from '@/domain/money';
import { monthEndDates, moneyMap, netWorthTrend, overallUtilization, periodHasData } from '@/domain/position';
import { periodStats } from '@/domain/reports';
import { openEvents } from '@/domain/schedule';
import { useData, useMoney, useSettings, useToday } from '@/store/hooks';
import { ledger, useLedgerStore } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function HomeScreen() {
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const settings = useSettings();
  const money = useMoney();
  const { loadError, saveError } = useLedgerStore();

  const model = useMemo<DashboardModel>(() => {
    const index = indexLedger(data);
    const allocations = allocatedAmounts(data, today);
    const month = monthOf(today);
    const lastMonthStart = monthStart(monthOf(addMonths(today, -1, 1)));
    const lastMonthSameDay = addMonths(today, -1);
    const balances = data.accounts.filter((a) => !a.archived).map((a) => ({ a, bal: balanceOn(index, a.id, today) }));
    const groupSum = (g: string, type?: string) => sum(balances.filter(({ a }) => accountGroup(a.type) === g && (!type || a.type === type)).map((x) => x.bal));
    const debt = debtSummary(data, today);
    const originals = debt.lines.filter((l) => l.account.originalBalance);
    const payoffRatio = originals.length
      ? 1 - sum(originals.map((l) => Math.max(0, l.balance))) / sum(originals.map((l) => l.account.originalBalance!))
      : null;
    const investments = balances.filter(({ a }) => isInvestment(a.type)).map(({ a }) => investmentInfo(index, a, today)!);
    const monthStats = periodStats(data, monthStart(month), today);
    const ef = emergencyFund(data, today);
    const nwTrend = netWorthTrend(data, monthEndDates(lastMonths(month, 13), today));

    return {
      today,
      map: moneyMap(data, today, allocations),
      alerts: buildAlerts(data, today, (c) => money(c)),
      upcoming: openEvents(data, today, addDays(today, 14), 14),
      month: monthStats,
      lastMonthToDate: periodHasData(data, lastMonthStart, lastMonthSameDay) ? periodStats(data, lastMonthStart, lastMonthSameDay) : null,
      cash: { checking: groupSum('cash', 'checking'), savings: groupSum('savings'), cash: groupSum('cash', 'cash'), emergency: { current: ef.current, target: ef.target } },
      netWorthHistory: nwTrend.points,
      netWorthChange: { change: nwTrend.change.change, since: nwTrend.since, hasData: nwTrend.change.hasData },
      debt: {
        total: debt.total,
        creditCards: debt.creditCards,
        loans: debt.loans,
        monthChange: debt.monthChange,
        utilization: overallUtilization(data, today).utilization,
        principalPaidYtd: debt.principalPaidYtd,
        payoffRatio,
        count: debt.lines.length,
      },
      investments: {
        value: sum(investments.map((i) => i.value)),
        gain: sum(investments.map((i) => i.gain)),
        contributionsThisMonth: monthStats.investmentContributions,
        count: investments.length,
      },
      goals: data.goals.filter((g) => !g.archived).map((g) => goalProgress(data, g, today)).filter((g) => g.status !== 'complete' && !g.goal.completedAt).sort((a, b) => b.ratio - a.ratio),
      budgets: monthBudgets(data, month, today).lines,
      forecast: buildForecast(data, { today, to: addDays(today, 30) }),
      recent: index.sorted.filter((t) => t.date <= today).slice(0, 5),
      hasAccounts: balances.length > 0,
      checkup: moneyCheckup(data, today),
    };
  }, [data, today, money]);

  const { order, hidden } = settings.dashboard;
  // Widgets added in later versions appear for existing users too.
  const widgets = [...order, ...DEFAULT_DASHBOARD.filter((id) => !order.includes(id))].filter((id) => !hidden.includes(id) && id in WIDGETS);

  return (
    <Screen tabBar>
      <Row>
        <View style={{ flex: 1 }}>
          <Text variant="small" color={colors.textTertiary}>
            {formatDate(today, 'long', today)}
          </Text>
          <Text variant="h2">{greeting()}</Text>
        </View>
        <IconButton icon={settings.hideAmounts ? 'eye-off' : 'eye'} accessibilityLabel={settings.hideAmounts ? 'Show amounts' : 'Hide amounts'} onPress={() => ledger.updateSettings({ hideAmounts: !settings.hideAmounts })} />
        <IconButton icon="search" accessibilityLabel="Search everything" onPress={() => router.push('/search')} />
      </Row>

      {loadError && <Banner tone="negative" icon="alert-triangle" title="Saved data couldn't be read" message={`${loadError} Your file was left untouched and changes won't be saved.`} />}
      {saveError && <Banner tone="negative" icon="alert-triangle" title="Changes aren't being saved" message={saveError} />}
      {data.meta.isSample && (
        <Banner
          tone="projected"
          icon="info"
          title="You're exploring sample data"
          message="Numbers here are made up. Erase them when you're ready to add your own."
          action={<Button label="Start fresh" size="sm" variant="secondary" onPress={() => router.push('/settings')} />}
        />
      )}

      {!model.hasAccounts ? (
        <EmptyState
          icon="layers"
          title="Add your first account"
          message="Start with checking, savings or a credit card. Balances are entered manually — no bank login needed."
          actionLabel="Add account"
          onAction={() => router.push('/accounts/edit')}
          secondaryLabel={data.accounts.length === 0 ? 'Explore sample data' : undefined}
          onSecondary={() => ledger.loadSampleData()}
        />
      ) : (
        widgets.map((id) => {
          const Widget = WIDGETS[id];
          return <Widget key={id} m={model} />;
        })
      )}

      {model.hasAccounts && (
        <Button label="Customize dashboard" variant="ghost" icon="sliders" onPress={() => router.push('/dashboard-edit')} style={{ alignSelf: 'center', marginTop: spacing.sm }} />
      )}
    </Screen>
  );
}
