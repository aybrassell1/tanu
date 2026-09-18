import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ChartCard, DataTable, MoneyCell, MoneyDelta, Takeaway, useAxisMoney } from '@/components/reports/shared';
import { ChangeSheet, changeTypeInfo, isChangeType, type ChangeType } from '@/components/scenarios/ChangeSheet';
import { Banner, Button, Card, EmptyState, GradientCard, IconButton, IconTile, KeyValue, LineChart, ListCard, Money, NavHeader, Pill, Row, Screen, Section, Segmented, Text, TextField, useOverlay } from '@/components/ui';
import { formatMonth, monthsBetween } from '@/domain/dates';
import { sum } from '@/domain/money';
import { compareScenario, describeChange, type Projection, type ProjectionMonth } from '@/domain/scenarios';
import type { Cents, ISOMonth, Scenario, ScenarioChange } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger, useLedgerStore } from '@/store/ledger';
import { colors, radius, series, spacing } from '@/theme/tokens';

const HORIZONS = ['12', '24', '36', '60'] as const;
const monthShort = (m: ISOMonth) => `${formatMonth(m, 'short')} '${m.slice(2, 4)}`;

export default function ScenarioScreen() {
  const { id, add, fresh } = useLocalSearchParams<{ id: string; add?: string; fresh?: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { confirm, toast } = useOverlay();
  const scenario = data.scenarios.find((s) => s.id === id);

  const [name, setName] = useState(scenario?.name ?? '');
  const [showBaseline, setShowBaseline] = useState(false);
  const [sheet, setSheet] = useState<{ type?: ChangeType; editing?: ScenarioChange } | null>(null);
  const addHandled = useRef(false);

  useEffect(() => {
    if (scenario) setName(scenario.name);
    // Only resync when the stored name changes (e.g. after Undo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario?.name]);

  useEffect(() => {
    if (addHandled.current || !scenario) return;
    addHandled.current = true;
    if (isChangeType(add)) setSheet({ type: add });
  }, [add, scenario]);

  // Keep a typed name even if the screen closes before the field blurs.
  const nameRef = useRef(name);
  nameRef.current = name;
  useEffect(
    () => () => {
      const latest = useLedgerStore.getState().data.scenarios.find((s) => s.id === id);
      // A scenario started from an idea is only kept once it has a change.
      if (latest && fresh === '1' && latest.changes.length === 0) {
        ledger.discardEmptyScenario(latest.id);
        return;
      }
      const trimmed = nameRef.current.trim();
      if (latest && trimmed && trimmed !== latest.name) ledger.saveScenario({ ...latest, name: trimmed });
    },
    [id, fresh],
  );

  const cmp = useMemo(() => (scenario ? compareScenario(data, scenario.changes, scenario.horizonMonths, today) : null), [data, scenario, today]);

  if (!scenario || !cmp) {
    return (
      <Screen header={<NavHeader title="Scenario" />}>
        <EmptyState icon="git-branch" title="Scenario not found" message="It may have been deleted." actionLabel="All scenarios" onAction={() => router.replace('/scenarios')} />
      </Screen>
    );
  }

  const h = scenario.horizonMonths;
  const { input, baseline, scenario: projected } = cmp;

  const persist = (patch: Partial<Scenario>) => {
    const result = ledger.saveScenario({ ...scenario, ...patch });
    if (!result.ok) toast({ message: Object.values(result.errors)[0] ?? 'Could not save the scenario.', tone: 'error' });
  };

  /** Restores a previous change list onto the latest stored copy of this scenario. */
  const restoreChanges = (changes: ScenarioChange[]) => {
    const latest = useLedgerStore.getState().data.scenarios.find((s) => s.id === scenario.id);
    if (latest) ledger.saveScenario({ ...latest, changes });
  };

  const remove = async () => {
    const ok = await confirm({ title: 'Delete scenario?', message: 'Only this what-if is removed. Your real data is never affected.', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    if (router.canGoBack()) router.back();
    else router.replace('/scenarios');
    ledger.deleteScenario(scenario.id);
    toast({ message: 'Scenario deleted', actionLabel: 'Undo', onAction: ledger.undo });
  };

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed) setName(scenario.name);
    else if (trimmed !== scenario.name) persist({ name: trimmed });
  };

  const removeChange = (change: ScenarioChange) => {
    const before = scenario.changes;
    persist({ changes: before.filter((c) => c.id !== change.id) });
    toast({ message: 'Change removed', actionLabel: 'Undo', onAction: () => restoreChanges(before) });
  };

  const saveChange = (change: ScenarioChange) => {
    const exists = scenario.changes.some((c) => c.id === change.id);
    persist({ changes: exists ? scenario.changes.map((c) => (c.id === change.id ? change : c)) : [...scenario.changes, change] });
    setSheet(null);
  };

  const debtFree = describeDebtFree(input.debts.length > 0, scenario.changes, h, baseline, projected);

  return (
    <Screen header={<NavHeader title="Scenario" right={<IconButton icon="trash-2" accessibilityLabel="Delete scenario" onPress={remove} />} />}>
      <View style={{ gap: spacing.md }}>
        <Row gap={spacing.sm}>
          <Pill tone="projected" icon="git-branch" label="Hypothetical" />
          <Text variant="small" color={colors.textSecondary} style={{ flex: 1 }}>
            Nothing here changes your real data.
          </Text>
        </Row>
        <TextField label="Name" value={name} onChangeText={setName} onBlur={commitName} onSubmitEditing={commitName} returnKeyType="done" />
        <View style={{ gap: 6 }}>
          <Text variant="small" weight="medium" color={colors.textSecondary}>
            Look ahead
          </Text>
          <Segmented items={HORIZONS.map((v) => ({ value: v, label: `${v} months` }))} value={String(h) as (typeof HORIZONS)[number]} onChange={(v) => persist({ horizonMonths: Number(v) })} />
        </View>
      </View>

      <Card style={{ gap: spacing.sm }}>
        <Pressable onPress={() => setShowBaseline(!showBaseline)} accessibilityRole="button" accessibilityState={{ expanded: showBaseline }} style={styles.collapseHeader}>
          <View style={{ flex: 1 }}>
            <Text variant="h3">Starting point</Text>
            <Text variant="small" color={colors.textTertiary}>
              What the projection starts from, based on your data today
            </Text>
          </View>
          <Feather name={showBaseline ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textSecondary} />
        </Pressable>
        {showBaseline && (
          <View>
            <KeyValue label="Monthly income" hint="From your active income sources">
              <Money cents={input.monthlyIncome} weight="medium" />
            </KeyValue>
            <KeyValue label="Recurring bills & subscriptions" hint={`${input.recurring.length} active, per month`}>
              <Money cents={sum(input.recurring.map((r) => r.monthly))} weight="medium" />
            </KeyValue>
            <KeyValue label="Average variable spending" hint="3-month average, excluding recurring bills and interest">
              <Money cents={input.variableSpending} weight="medium" />
            </KeyValue>
            <KeyValue label="Savings & investment contributions" hint="Recurring, per month">
              <Money cents={input.savingsContributions + input.investmentContributions} weight="medium" />
            </KeyValue>
            <KeyValue label="Cash & savings">
              <Money cents={input.cash + input.savings} weight="medium" tone="balance" />
            </KeyValue>
            <KeyValue label="Investments">
              <Money cents={input.investments} weight="medium" />
            </KeyValue>
            <KeyValue label="Total debt" hint={`${input.debts.length} ${input.debts.length === 1 ? 'debt' : 'debts'} with a balance`}>
              <Money cents={sum(input.debts.map((d) => d.balance))} weight="medium" />
            </KeyValue>
            <KeyValue label="Investment return">
              <View style={{ alignItems: 'flex-end' }}>
                <Text weight="medium">{`${input.investmentReturn}% a year`}</Text>
                <Text variant="caption" weight="medium" color={colors.primary} onPress={() => router.push('/settings')} suppressHighlighting accessibilityRole="link">
                  Change in Settings
                </Text>
              </View>
            </KeyValue>
          </View>
        )}
      </Card>

      <Section title="Changes" subtitle="Hypothetical adjustments to your current path">
        {scenario.changes.length === 0 ? (
          <EmptyState compact icon="sliders" title="No changes yet" message="Add a change to see how it would affect your future." actionLabel="Add a change" onAction={() => setSheet({})} />
        ) : (
          <>
            <ListCard>
              {scenario.changes.map((c) => (
                <View key={c.id} style={styles.changeRow}>
                  <Pressable onPress={() => setSheet({ editing: c })} accessibilityRole="button" accessibilityHint="Edit this change" style={({ pressed }) => [styles.changeMain, pressed && { opacity: 0.6 }]}>
                    <IconTile icon={changeTypeInfo(c.type).icon} color={colors.projected} size={34} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text weight="medium">{describeChange(data, c, (n) => money(n))}</Text>
                      <Text variant="caption" color={colors.textTertiary}>
                        {changeTypeInfo(c.type).label}
                      </Text>
                    </View>
                  </Pressable>
                  <IconButton icon="x" size={32} variant="plain" accessibilityLabel="Remove change" onPress={() => removeChange(c)} />
                </View>
              ))}
            </ListCard>
            <Button label="Add a change" icon="plus" variant="secondary" onPress={() => setSheet({})} />
          </>
        )}
      </Section>

      <Section title="Results" accessory={<Pill size="sm" tone="projected" icon="trending-up" label="Projected" />}>
        <GradientCard palette="projected" style={{ gap: spacing.sm }}>
          <Text variant="small" weight="medium" color="rgba(255,255,255,0.85)">
            {`Hypothetical · ${h} months`}
          </Text>
          <Text variant="h3" color={colors.onPrimary}>
            {summarySentence(scenario.changes.length, h, baseline, projected, debtFree, (c) => money(c, { whole: true }))}
          </Text>
        </GradientCard>

        {projected.negativeCash && (
          <Banner
            tone="negative"
            icon="alert-triangle"
            title={`Cash runs out in ${formatMonth(projected.negativeCash.month)}`}
            message={`In this hypothetical, cash and savings drop to ${money(projected.negativeCash.cash, { whole: true })}${projected.lowestCash < projected.negativeCash.cash ? ` and reach ${money(projected.lowestCash, { whole: true })} at the lowest` : ''}. You'd need to borrow or cut back to cover it.`}
          />
        )}

        <Card style={{ gap: spacing.sm }}>
          <DataTable
            columns={[{ label: '', flex: 1.5 }, { label: 'Baseline' }, { label: 'Scenario' }, { label: 'Difference', flex: 1.1 }]}
            rows={[
              moneyRow('surplus', 'Average monthly surplus', baseline.averageSurplus, projected.averageSurplus, 'up'),
              moneyRow('cash', 'Cash at end', baseline.end.cash, projected.end.cash, 'up'),
              moneyRow('savings', 'Savings at end', baseline.end.savings, projected.end.savings, 'up'),
              moneyRow('debt', 'Total debt at end', baseline.end.debt, projected.end.debt, 'down'),
              { key: 'free', cells: ['Debt-free', debtFree.baseLabel, debtFree.scenarioLabel, <DiffText key="d" text={debtFree.diffLabel} tone={debtFree.tone} />] },
              moneyRow('nw', 'Net worth at end', baseline.end.netWorth, projected.end.netWorth, 'up'),
            ]}
            caption="Cash includes savings. Surplus is income minus spending, debt payments and investment contributions."
          />
        </Card>

        <ComparisonChart title="How does net worth compare?" label="Net worth" pick={(m) => m.netWorth} baseline={baseline} projected={projected} horizon={h} />
        <ComparisonChart title="How does cash compare?" label="Cash" pick={(m) => m.cash} baseline={baseline} projected={projected} horizon={h} />

        <Text variant="caption" color={colors.textTertiary}>
          {`Assumptions: asset values are held constant; investments grow ${input.investmentReturn}% a year; variable spending uses your 3-month average; income comes from your active income sources. Nothing here changes your real data.`}
        </Text>
      </Section>

      <ChangeSheet
        visible={!!sheet}
        onClose={() => setSheet(null)}
        initialType={sheet?.type}
        editing={sheet?.editing}
        horizon={h}
        baseline={input}
        onSave={saveChange}
      />
    </Screen>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function moneyRow(key: string, label: string, base: Cents, scen: Cents, good: 'up' | 'down') {
  return {
    key,
    cells: [label, <MoneyCell key="b" cents={base} compact />, <MoneyCell key="s" cents={scen} compact />, <MoneyDelta key="d" cents={scen - base} good={good} compact />],
  };
}

function DiffText({ text, tone }: { text: string; tone: 'good' | 'bad' | 'none' }) {
  const color = tone === 'good' ? colors.positive : tone === 'bad' ? colors.negative : colors.textSecondary;
  return (
    <Row gap={3}>
      {tone !== 'none' && <Feather name={tone === 'good' ? 'check' : 'alert-circle'} size={12} color={color} />}
      <Text variant="small" weight="semibold" color={color} align="right" numberOfLines={2}>
        {text}
      </Text>
    </Row>
  );
}

interface DebtFree {
  baseLabel: string;
  scenarioLabel: string;
  diffLabel: string;
  tone: 'good' | 'bad' | 'none';
  /** Months sooner (positive) or later (negative), when both are within the horizon. */
  monthsSooner: number | null;
}

function describeDebtFree(hasDebt: boolean, changes: ScenarioChange[], h: number, baseline: Projection, projected: Projection): DebtFree {
  const scenarioHasDebt = hasDebt || changes.some((c) => c.type === 'new_loan' && c.principal > 0 && c.startMonth < h);
  const label = (had: boolean, month: ISOMonth | null) => (!had ? 'No debt' : month ? monthShort(month) : `Not within ${h} months`);
  const b = baseline.debtFreeMonth;
  const s = projected.debtFreeMonth;
  let diffLabel = '—';
  let tone: DebtFree['tone'] = 'none';
  let monthsSooner: number | null = null;
  if (b && s) {
    monthsSooner = monthsBetween(s, b);
    diffLabel = monthsSooner === 0 ? 'Same' : `${Math.abs(monthsSooner)} mo ${monthsSooner > 0 ? 'sooner' : 'later'}`;
    tone = monthsSooner > 0 ? 'good' : monthsSooner < 0 ? 'bad' : 'none';
  } else if (hasDebt && !b && s) {
    diffLabel = 'Within horizon';
    tone = 'good';
  } else if (scenarioHasDebt && b !== null && !s) {
    diffLabel = 'Beyond horizon';
    tone = 'bad';
  } else if (!hasDebt && scenarioHasDebt && !s) {
    diffLabel = 'New debt';
    tone = 'bad';
  }
  return { baseLabel: label(hasDebt, b), scenarioLabel: label(scenarioHasDebt, s), diffLabel, tone, monthsSooner };
}

function summarySentence(changeCount: number, h: number, baseline: Projection, projected: Projection, debtFree: DebtFree, whole: (c: Cents) => string) {
  if (changeCount === 0) return `This is your current path over ${h} months. Add a change to compare.`;
  const cashDiff = projected.end.cash - baseline.end.cash;
  const nwDiff = projected.end.netWorth - baseline.end.netWorth;
  const cash = cashDiff === 0 ? 'the same cash' : `about ${whole(Math.abs(cashDiff))} ${cashDiff > 0 ? 'more' : 'less'} cash`;
  const nw = nwDiff === 0 ? '' : `, a net worth ${whole(Math.abs(nwDiff))} ${nwDiff > 0 ? 'higher' : 'lower'}`;
  let debt = '';
  if (debtFree.monthsSooner) debt = `, and be debt-free ${Math.abs(debtFree.monthsSooner)} ${Math.abs(debtFree.monthsSooner) === 1 ? 'month' : 'months'} ${debtFree.monthsSooner > 0 ? 'sooner' : 'later'}`;
  else if (debtFree.diffLabel === 'Within horizon' && projected.debtFreeMonth) debt = `, and be debt-free by ${formatMonth(projected.debtFreeMonth)}`;
  else if (debtFree.diffLabel === 'Beyond horizon') debt = `, and no longer be debt-free within ${h} months`;
  return `With these changes you'd have ${cash} after ${h} months${nw}${debt}.`;
}

function ComparisonChart({ title, label, pick, baseline, projected, horizon }: { title: string; label: string; pick: (m: ProjectionMonth) => Cents; baseline: Projection; projected: Projection; horizon: number }) {
  const axis = useAxisMoney();
  const money = useMoney();
  const months = projected.months;
  const last = months.length - 1;
  if (last < 0) return null;
  const checkpoints = [...new Set([...months.map((_, i) => i).filter((i) => (i + 1) % 12 === 0), last])];
  const diff = pick(projected.end) - pick(baseline.end);

  return (
    <>
      <ChartCard title={title} badge={<Pill size="sm" tone="projected" label="Projected" />}>
        <LineChart
          series={[
            { key: 'scenario', label: 'Scenario', color: series[0], points: months.map((m, i) => ({ x: i, y: pick(m) })) },
            { key: 'baseline', label: 'Baseline', color: series[1], dashed: true, points: baseline.months.map((m, i) => ({ x: i, y: pick(m) })) },
          ]}
          formatY={axis}
          formatX={(x) => (months[x] ? monthShort(months[x].month) : '')}
          xTicks={[0, Math.round(last / 2), last]}
          includeZero={[...months, ...baseline.months].some((m) => pick(m) < 0)}
          accessibilityLabel={`Projected ${label.toLowerCase()} with and without these changes over ${horizon} months`}
        />
        <DataTable
          columns={[{ label: 'Month' }, { label: 'Baseline' }, { label: 'Scenario' }, { label: 'Difference', flex: 1.1 }]}
          rows={checkpoints.map((i) => ({
            key: String(i),
            cells: [monthShort(months[i].month), <MoneyCell key="b" cents={pick(baseline.months[i])} compact />, <MoneyCell key="s" cents={pick(months[i])} compact />, <MoneyDelta key="d" cents={pick(months[i]) - pick(baseline.months[i])} good="up" compact />],
          }))}
        />
      </ChartCard>
      <Takeaway>
        {diff === 0
          ? `After ${horizon} months your ${label.toLowerCase()} would be the same either way.`
          : `After ${horizon} months your ${label.toLowerCase()} would be about ${money(Math.abs(diff), { whole: true })} ${diff > 0 ? 'higher' : 'lower'} with these changes (${money(pick(projected.end), { whole: true })} vs ${money(pick(baseline.end), { whole: true })}).`}
      </Takeaway>
    </>
  );
}

const styles = StyleSheet.create({
  collapseHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.sm },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10 },
  changeMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
