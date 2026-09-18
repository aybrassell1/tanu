import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { DateBadge } from '@/components/finance/Rows';
import {
  Banner,
  Card,
  DateField,
  EmptyState,
  LineChart,
  ListCard,
  ListRow,
  Money,
  NavHeader,
  Pill,
  Screen,
  Section,
  Segmented,
  StatTile,
  Text,
  type LineSeries,
} from '@/components/ui';
import { RECURRING_KINDS } from '@/domain/catalog';
import { addDays, diffDays, formatDate } from '@/domain/dates';
import { buildForecast, forecastAccounts, type ForecastEvent, type ForecastScope } from '@/domain/forecast';
import { useData, useMoney, useSettings, useToday } from '@/store/hooks';
import { colors, series, spacing } from '@/theme/tokens';

type Horizon = '7' | '30' | '60' | '90' | 'custom';

const HORIZONS: { value: Horizon; label: string }[] = [
  { value: '7', label: '7d' },
  { value: '30', label: '30d' },
  { value: '60', label: '60d' },
  { value: '90', label: '90d' },
  { value: 'custom', label: 'Custom' },
];

const SCOPES: { value: ForecastScope; label: string }[] = [
  { value: 'spendable', label: 'Spendable' },
  { value: 'cash', label: 'All cash' },
];

const PAST_DUE = 'past-due';

function eventHref(e: ForecastEvent) {
  switch (e.source) {
    case 'recurring':
      return `/bills/${e.sourceId}`;
    case 'income':
      return `/income/${e.sourceId}`;
    case 'debt':
      return `/accounts/${e.sourceId}`;
    default:
      return `/transactions/${e.sourceId}`;
  }
}

function kindLabel(e: ForecastEvent) {
  if (e.source === 'transaction') return 'Scheduled';
  if (e.kind === 'income') return e.source === 'income' ? 'Paycheck' : 'Money in';
  return RECURRING_KINDS[e.kind]?.label ?? 'Payment';
}

export default function ForecastScreen() {
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const settings = useSettings();
  const money = useMoney();
  const [horizon, setHorizon] = useState<Horizon>('30');
  const [customEnd, setCustomEnd] = useState<string>(() => addDays(today, 120));
  const [scope, setScope] = useState<ForecastScope>('spendable');

  const to = horizon === 'custom' ? (customEnd > today ? customEnd : addDays(today, 1)) : addDays(today, Number(horizon));
  const f = useMemo(() => buildForecast(data, { today, to, scope, lookbackDays: 30 }), [data, today, to, scope]);
  const hasCashAccounts = useMemo(() => forecastAccounts(data, 'cash').length > 0, [data]);

  const groups = useMemo(() => {
    const out: { key: string; label: string; events: ForecastEvent[] }[] = [];
    for (const e of f.events) {
      const key = e.date < today ? PAST_DUE : e.date;
      let group = out.find((g) => g.key === key);
      if (!group) {
        const label = key === PAST_DUE ? 'Past due — assumed today' : key === today ? `Today · ${formatDate(key, 'short', today)}` : formatDate(key, 'weekday', today);
        group = { key, label, events: [] };
        out.push(group);
      }
      group.events.push(e);
    }
    return out;
  }, [f.events, today]);

  const end = diffDays(today, to);
  const chartSeries: LineSeries[] = [
    { key: 'actual', label: 'Actual', color: series[0], area: true, points: f.history.map((h) => ({ x: diffDays(today, h.date), y: h.balance })) },
    { key: 'projected', label: 'Projected', color: colors.projected, dashed: true, points: f.days.map((d) => ({ x: diffDays(today, d.date), y: d.balance })) },
  ];

  const noAccounts = f.accountIds.length === 0;
  const belowZero = f.lowest.balance < 0;
  const belowBuffer = !belowZero && settings.spendingBuffer > 0 && f.lowest.balance < settings.spendingBuffer;

  return (
    <Screen header={<NavHeader title="Cash-flow forecast" />}>
      <View style={{ gap: spacing.sm }}>
        <View style={styles.controls}>
          <View style={styles.horizon}>
            <Segmented items={HORIZONS} value={horizon} onChange={setHorizon} size="sm" />
          </View>
          <View style={styles.scope}>
            <Segmented items={SCOPES} value={scope} onChange={setScope} size="sm" />
          </View>
        </View>
        {horizon === 'custom' && <DateField label="Forecast through" value={customEnd} onChange={(d) => d && setCustomEnd(d)} error={customEnd <= today ? 'Pick a date after today.' : undefined} />}
        <Text variant="caption" color={colors.textTertiary}>
          {scope === 'spendable' ? 'Spendable accounts you pay everyday bills from.' : 'All checking, savings and cash accounts.'}
        </Text>
      </View>



      {noAccounts ? (
        <EmptyState
          icon="credit-card"
          title={scope === 'spendable' ? 'No spendable accounts' : 'No cash accounts'}
          message={scope === 'spendable' ? 'Mark a checking or cash account as spendable, or add one, to forecast your cash.' : 'Add a checking, savings or cash account to forecast your cash.'}
          actionLabel="Add an account"
          onAction={() => router.push('/money')}
          secondaryLabel={scope === 'spendable' && hasCashAccounts ? 'Show all cash' : undefined}
          onSecondary={() => setScope('cash')}
        />
      ) : (
        <>
          <View style={styles.tiles}>
            <StatTile label="Today" icon="check-circle" value={<Money cents={f.start} variant="h3" compact tone="balance" />} caption={<Pill label="Actual" tone="muted" size="sm" />} />
            <StatTile
              label="Lowest"
              icon="arrow-down"
              value={<Money cents={f.lowest.balance} variant="h3" compact tone="balance" />}
              caption={<TileCaption text={f.lowest.date === today ? 'Today' : formatDate(f.lowest.date, 'short', today)} />}
            />
            <StatTile label="Range end" icon="flag" value={<Money cents={f.end} variant="h3" compact tone="balance" />} caption={<TileCaption text={formatDate(to, 'short', today)} />} />

          </View>

          {belowZero && (
            <Banner
              tone="negative"
              icon="alert-triangle"
              title={`Projected to go below zero ${f.lowest.date === today ? 'today' : `by ${formatDate(f.lowest.date, 'short', today)}`}`}
              message={`Lowest projected balance is ${money(f.lowest.balance)}. Move money in or reschedule a payment before then.`}
            />
          )}
          {belowBuffer && (
            <Banner
              tone="warning"
              icon="alert-circle"
              title={`Projected to dip below your ${money(settings.spendingBuffer, { whole: true })} buffer`}
              message={`Lowest projected balance is ${money(f.lowest.balance)} on ${formatDate(f.lowest.date, 'short', today)}.`}
            />
          )}

          <Section title="Will I have enough cash?" subtitle="Solid line is actual, dashed line is projected">
            <Card>
              <LineChart
                series={chartSeries}
                height={200}
                includeZero
                formatY={(v) => money(v, { compact: true, whole: true })}
                formatX={(x) => formatDate(addDays(today, x), 'short', today)}
                xTicks={[-30, 0, end]}
                marker={{ x: 0, label: 'Today' }}
                accessibilityLabel={`Cash balance: ${money(f.start)} today, lowest projected ${money(f.lowest.balance)} on ${formatDate(f.lowest.date, 'short', today)}, ${money(f.end)} projected at ${formatDate(to, 'short', today)}`}
              />
            </Card>
          </Section>

          <Section title="Expected events" subtitle={f.events.length ? `${f.events.length} through ${formatDate(to, 'short', today)} · balance after each` : undefined}>
            {groups.length === 0 ? (
              <EmptyState
                compact
                icon="calendar"
                title="Nothing expected in this range"
                message="Add bills and paychecks so the forecast can project where your cash is headed."
                actionLabel="Add paycheck"
                onAction={() => router.push('/income/edit')}
                secondaryLabel="Add bill"
                onSecondary={() => router.push('/bills/edit')}
              />
            ) : (
              groups.map((g) => (
                <View key={g.key} style={{ gap: spacing.sm }}>
                  <Text variant="caption" color={g.key === PAST_DUE ? colors.negative : colors.textTertiary} style={styles.groupLabel}>
                    {g.label.toUpperCase()}
                  </Text>
                  <ListCard>
                    {g.events.map((e) => (
                      <ListRow
                        key={e.key}
                        leading={<DateBadge date={e.date} muted={e.date < today} />}
                        title={e.name}
                        subtitle={[kindLabel(e), e.date < today ? `Due ${formatDate(e.date, 'short', today)}` : null, e.estimate ? 'Estimate' : null].filter(Boolean).join(' · ')}
                        trailing={<Money cents={e.effect} signed weight="semibold" tone="flow" />}
                        trailingCaption={`→ ${money(e.running)}`}
                        onPress={() => router.push(eventHref(e))}
                        accessibilityLabel={`${e.name}, ${money(e.effect, { signed: true })}, projected balance after ${money(e.running)}`}
                      />
                    ))}
                  </ListCard>
                </View>
              ))
            )}
          </Section>
        </>
      )}
    </Screen>
  );
}

function TileCaption({ text }: { text: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Pill label="Projected" tone="projected" size="sm" />
      <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  horizon: { flexGrow: 5, flexBasis: 260 },
  scope: { flexGrow: 3, flexBasis: 170 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  groupLabel: { letterSpacing: 0.6 },
});
