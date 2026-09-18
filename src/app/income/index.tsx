import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { EventRow } from '@/components/finance/Rows';
import { ColumnChart, EmptyState, HBarList, IconButton, IconTile, ListCard, ListRow, Money, NavHeader, Pill, Screen, Section, StatTile, Text, VisualTile } from '@/components/ui';
import { INCOME_EMOJI } from '@/data/visuals';
import { icon } from '@/data/icons';
import { INCOME_TYPES } from '@/domain/catalog';
import { addDays, addMonthsToMonth, formatMonth, monthEnd, monthOf, monthStart } from '@/domain/dates';
import { incomeAmount, indexLedger } from '@/domain/ledger';
import { sum } from '@/domain/money';
import { frequencyLabel } from '@/domain/recurrence';
import { monthlySeries, periodStats, transactionsBetween } from '@/domain/reports';
import { incomeMonthlyEquivalent, openEvents, scheduledEvents } from '@/domain/schedule';
import type { IncomeSource } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { colors, series, spacing } from '@/theme/tokens';

export default function IncomeScreen() {
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const month = monthOf(today);

  const model = useMemo(() => {
    const monthToDate = periodStats(data, monthStart(month), today);

    // Expected this month = scheduled paychecks (actual when received, estimate
    // otherwise) + income that arrived outside any schedule.
    const monthEvents = scheduledEvents(data, { from: monthStart(month), to: monthEnd(month), today }).filter((e) => e.kind === 'income' && e.status !== 'skipped');
    const linkedIds = new Set(monthEvents.map((e) => e.transactionId).filter(Boolean));
    const unscheduled = sum(transactionsBetween(data, monthStart(month), today).filter((t) => !linkedIds.has(t.id)).map(incomeAmount));
    const pendingEvents = monthEvents.filter((e) => e.status !== 'paid');
    const expectedMonth = sum(monthEvents.map((e) => e.amount)) + unscheduled;

    const lastSix = monthlySeries(data, addMonthsToMonth(month, -1), 6, today);
    // Average only over months that actually have income, so new users aren't understated.
    const withIncome = lastSix.filter((s) => s.income > 0);
    const average = withIncome.length ? Math.round(sum(withIncome.map((s) => s.income)) / withIncome.length) : 0;

    const year = periodStats(data, `${today.slice(0, 4)}-01-01`, today);
    const trend = monthlySeries(data, month, 12, today);
    const next = openEvents(data, today, addDays(today, 45), 30).filter((e) => e.kind === 'income');

    return { monthToDate, expectedMonth, pendingCount: pendingEvents.length, average, year, trend, next };
  }, [data, today, month]);

  const index = indexLedger(data);
  const active = data.incomeSources.filter((s) => s.active).sort((a, b) => incomeMonthlyEquivalent(b) - incomeMonthlyEquivalent(a));
  const inactive = data.incomeSources.filter((s) => !s.active);
  const receivedThisYear = new Map(model.year.incomeBySource.map((s) => [s.key, s.amount]));
  const hasTrend = model.trend.some((m) => m.income > 0);

  const sourceRow = (s: IncomeSource) => {
    const account = index.accounts.get(s.depositAccountId);
    const info = INCOME_TYPES[s.type];
    const subtitle = [info.label, s.frequency ? frequencyLabel(s.frequency) : 'Irregular', account?.name ?? 'No account'].join(' · ');
    const scheduled = !!s.frequency && s.active;
    return (
      <ListRow
        key={s.id}
        title={s.name}
        subtitle={subtitle}
        leading={<VisualTile emoji={INCOME_EMOJI[s.type]} />}
        trailing={
          scheduled ? (
            <Text weight="semibold" tabular>
              {`${money(incomeMonthlyEquivalent(s))}/mo`}
            </Text>
          ) : (
            <Money cents={receivedThisYear.get(s.id) ?? 0} weight="semibold" />
          )
        }
        trailingCaption={scheduled ? 'Expected' : 'this year'}
        chevron
        onPress={() => router.push(`/income/${s.id}`)}
      />
    );
  };

  return (
    <Screen header={<NavHeader title="Income" right={<IconButton icon="plus" accessibilityLabel="Add income source" onPress={() => router.push('/income/edit')} />} />}>
      <View style={styles.tiles}>
        <StatTile label="Earned" icon="check-circle" value={<Money cents={model.monthToDate.income} variant="h3" compact tone="flow" />} caption="This month, so far" />
        <StatTile
          label="Expected"
          icon="calendar"
          value={<Money cents={model.expectedMonth} variant="h3" compact />}
          caption={
            <View style={{ gap: 4 }}>
              <Pill label="Expected" tone="projected" size="sm" />
              {model.pendingCount > 0 && (
                <Text variant="caption" color={colors.textTertiary} numberOfLines={2}>
                  {model.pendingCount === 1 ? '1 paycheck not in yet' : `${model.pendingCount} paychecks not in yet`}
                </Text>
              )}
            </View>
          }
        />
        <StatTile label="Average" icon="bar-chart-2" value={<Money cents={model.average} variant="h3" compact />} caption="Last 6 full months" />
      </View>

      {data.incomeSources.length === 0 ? (
        <EmptyState
          icon="briefcase"
          title="Add your paychecks"
          message="Income sources tell Tanu when money is coming in, so your cash-flow forecast and available-to-spend know about payday."
          actionLabel="Add income source"
          onAction={() => router.push('/income/edit')}
          secondaryLabel="Record income"
          onSecondary={() => router.push({ pathname: '/quick-add', params: { mode: 'income' } })}
        />
      ) : (
        <>
          <Section title="Next paychecks" subtitle="Next 45 days · amounts are expected until recorded">
            {model.next.length === 0 ? (
              <EmptyState
                compact
                icon="calendar"
                title="No paychecks expected soon"
                message="Scheduled sources will show their next pay dates here."
                actionLabel="Record income"
                onAction={() => router.push({ pathname: '/quick-add', params: { mode: 'income' } })}
              />
            ) : (
              <ListCard>
                {model.next.map((e) => (
                  <EventRow
                    key={e.key}
                    event={e}
                    onPress={() => router.push(e.source === 'income' ? `/income/${e.sourceId}` : `/transactions/${e.sourceId}`)}
                    actionLabel="Record"
                    onAction={e.source === 'income' ? () => router.push({ pathname: '/quick-add', params: { mode: 'income', sourceId: e.sourceId, occurrenceDate: e.date } }) : undefined}
                  />
                ))}
              </ListCard>
            )}
          </Section>

          <Section title="Sources" subtitle="Monthly amounts are expected take-home">
            {active.length === 0 ? (
              <EmptyState compact icon="pause-circle" title="No active sources" message="Activate a source or add a new one to include it in forecasts." actionLabel="Add income source" onAction={() => router.push('/income/edit')} />
            ) : (
              <ListCard>{active.map(sourceRow)}</ListCard>
            )}
            {inactive.length > 0 && (
              <View style={{ gap: spacing.sm }}>
                <Text variant="caption" color={colors.textTertiary} style={styles.groupLabel}>
                  INACTIVE
                </Text>
                <ListCard>{inactive.map(sourceRow)}</ListCard>
              </View>
            )}
          </Section>
        </>
      )}

      <Section title="Which sources pay me the most?" subtitle={`Received since Jan 1, ${today.slice(0, 4)}`}>
        {model.year.incomeBySource.length === 0 ? (
          <EmptyState compact icon="pie-chart" title="No income recorded this year" message="Recorded paychecks and other income will be ranked here." actionLabel="Record income" onAction={() => router.push({ pathname: '/quick-add', params: { mode: 'income' } })} />
        ) : (
          <HBarList
            items={model.year.incomeBySource.map((s) => {
              const isSource = data.incomeSources.some((x) => x.id === s.key);
              return {
                key: s.key,
                label: s.label,
                value: s.amount,
                valueLabel: money(s.amount),
                color: series[0],
                caption: model.year.income > 0 ? `${Math.round((s.amount / model.year.income) * 100)}% of income` : undefined,
                onPress: isSource ? () => router.push(`/income/${s.key}`) : undefined,
              };
            })}
          />
        )}
      </Section>

      {hasTrend && (
        <Section title="How is my income trending?" subtitle="Actual income, last 12 months">
          <ColumnChart
            data={model.trend.map((m) => ({ key: m.month, label: formatMonth(m.month, 'tiny'), values: [m.income] }))}
            series={[{ label: 'Income', color: series[0] }]}
            highlightKey={month}
            formatY={(v) => money(v, { compact: true, whole: true })}
            formatTitle={(d) => (d.key === month ? `${formatMonth(d.key)} (so far)` : formatMonth(d.key))}
            reference={model.average > 0 ? { value: model.average, label: '6-mo avg' } : undefined}
            accessibilityLabel="Monthly income over the last 12 months"
          />
        </Section>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  groupLabel: { letterSpacing: 0.6, marginTop: spacing.sm },
});
