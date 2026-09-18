import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { categoryOptions, MonthSwitcher } from '@/components/finance/Pickers';
import { Button, Card, EmptyState, IconButton, IconTile, ListCard, Money, MoneyField, NavHeader, Pill, ProgressBar, Screen, Section, Segmented, SelectSheet, Sheet, StatusBadge, SwitchRow, Text, useOverlay, VisualTile } from '@/components/ui';
import { categoryEmoji } from '@/data/visuals';
import { icon } from '@/data/icons';
import { budgetAmountFor, budgetNestingWarning, categorySpent, monthBudgets, type BudgetLine } from '@/domain/budgets';
import { categoryPath } from '@/domain/categories';
import { daysInMonth, formatMonth, minDate, monthEnd, monthOf, monthStart, parseISODate } from '@/domain/dates';
import { indexLedger } from '@/domain/ledger';
import { categoryAverages } from '@/domain/reports';
import type { Budget, BudgetMode, Cents, ID, ISOMonth } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

type Editing = {
  categoryId: ID;
  budget?: Budget;
  amount: Cents | undefined;
  mode: BudgetMode;
  rollover: boolean;
  suggestion?: Cents;
};

const AVERAGE_MONTHS = 3;

export default function BudgetsScreen() {
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { confirm, toast } = useOverlay();
  const currentMonth = monthOf(today);
  const [month, setMonth] = useState<ISOMonth>(currentMonth);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [amountError, setAmountError] = useState<string | undefined>();

  const index = indexLedger(data);
  const m = useMemo(() => monthBudgets(data, month, today), [data, month, today]);
  const averages = useMemo(() => categoryAverages(data, month, AVERAGE_MONTHS), [data, month]);

  const budgetedIds = useMemo(() => new Set(data.budgets.map((b) => b.categoryId)), [data.budgets]);
  const addOptions = useMemo(() => categoryOptions(data, 'expense', (id) => !budgetedIds.has(id)), [data, budgetedIds]);

  /** Average monthly spending in a category over the complete months before `month`. */
  const averageFor = (categoryId: ID): Cents => {
    const root = averages.byCategory.find((c) => c.key === categoryId);
    if (root) return root.amount;
    for (const c of averages.byCategory) {
      const sub = c.subs.find((s) => s.key === categoryId);
      if (sub) return sub.amount;
    }
    return 0;
  };

  const openNew = (categoryId: ID) => {
    const suggestion = averageFor(categoryId);
    setAmountError(undefined);
    setEditing({ categoryId, amount: suggestion > 0 ? suggestion : undefined, mode: 'limit', rollover: false, suggestion });
  };

  const openLine = (line: BudgetLine) => {
    setAmountError(undefined);
    setEditing({
      categoryId: line.category.id,
      budget: line.budget,
      amount: budgetAmountFor(line.budget, month) ?? line.base,
      mode: line.budget.mode,
      rollover: line.budget.rollover,
      suggestion: averageFor(line.category.id),
    });
  };

  const save = () => {
    if (!editing) return;
    if (editing.amount === undefined || editing.amount <= 0) {
      setAmountError('Enter a monthly amount.');
      return;
    }
    const result = ledger.setBudget(editing.categoryId, editing.amount, month, editing.mode, editing.rollover);
    if (!result.ok) {
      setAmountError(Object.values(result.errors)[0]);
      return;
    }
    toast(editing.budget ? 'Budget updated' : 'Budget added');
    setEditing(null);
  };

  const remove = async () => {
    if (!editing?.budget) return;
    const budget = editing.budget;
    const name = categoryPath(index.categories, budget.categoryId);
    setEditing(null);
    const ok = await confirm({
      title: `Remove the ${name} budget?`,
      message: 'This removes it from every month. Spending in this category is still tracked.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    ledger.removeBudget(budget.id);
    toast({ message: 'Budget removed', actionLabel: 'Undo', onAction: ledger.undo });
  };

  /** Averages cover the complete months before `month`; spending so far in `month` is shown separately. */
  const budgetHint = (e: Editing) => {
    const monthSpent = categorySpent(data, e.categoryId, monthStart(month), minDate(monthEnd(month), today));
    const soFar = monthSpent > 0 ? ` ${money(monthSpent)} so far in ${formatMonth(month, 'short')}.` : '';
    const before = `the ${AVERAGE_MONTHS} months before ${formatMonth(month, 'short')}`;
    const avg = e.suggestion && e.suggestion > 0 ? `You spent about ${money(e.suggestion)} a month here over ${before}.` : monthSpent > 0 ? `No spending here in ${before}.` : `No spending here in ${before} or this month.`;
    const nesting = e.amount ? budgetNestingWarning(data, e.categoryId, e.amount, month) : null;
    const warn = !nesting
      ? ''
      : nesting.kind === 'child_exceeds_parent'
        ? ` Heads up: this is more than the ${money(nesting.limit)} budget for its parent category.`
        : ` Heads up: subcategory budgets add up to ${money(nesting.total)}, more than this amount.`;
    return `${avg}${soFar}${warn}`;
  };

  const isCurrent = month === currentMonth;
  const { year, month: monthNumber, day } = parseISODate(today);
  const totalDays = daysInMonth(year, monthNumber);
  const remaining = m.totalBudgeted - m.totalSpent;
  const editingName = editing ? categoryPath(index.categories, editing.categoryId) : '';

  return (
    <Screen header={<NavHeader title="Budgets" right={<IconButton icon="plus" accessibilityLabel="Add budget" onPress={() => setPicking(true)} />} />}>
      <View style={{ gap: spacing.sm }}>
        <MonthSwitcher month={month} onChange={setMonth} />
        <Text variant="small" color={colors.textSecondary} align="center">
          Budgets are optional. Categories without one are still tracked.
        </Text>
      </View>

      {m.lines.length === 0 ? (
        <EmptyState
          icon="target"
          title={data.budgets.length === 0 ? 'No budgets yet' : `No budgets in ${formatMonth(month)}`}
          message={data.budgets.length === 0 ? 'Set a monthly amount for the categories you want to keep an eye on. Everything else is still tracked below.' : 'Budgets apply from the month they were set. Add one for this month or look at a later month.'}
          actionLabel="Add budget"
          onAction={() => setPicking(true)}
        />
      ) : (
        <>
          <Card style={{ gap: spacing.lg }}>
            <View style={styles.summaryGrid}>
              <SummaryStat label="Budgeted" cents={m.totalBudgeted} />
              <SummaryStat label="Spent" cents={m.totalSpent} caption={isCurrent ? 'Actual, so far' : 'Actual'} />
              <SummaryStat label={remaining >= 0 ? 'Remaining' : 'Over'} cents={Math.abs(remaining)} />
              <SummaryStat label="Planned recurring" cents={m.totalPlanned} projected />
            </View>
            <View style={{ gap: 6 }}>
              <ProgressBar
                value={m.totalBudgeted > 0 ? m.totalSpent / m.totalBudgeted : 0}
                color={remaining < 0 ? colors.negative : colors.primary}
                marker={isCurrent ? day / totalDays : undefined}
                accessibilityLabel={`${money(m.totalSpent)} spent of ${money(m.totalBudgeted)} budgeted`}
              />
              <View style={styles.between}>
                <Text variant="caption" color={colors.textTertiary}>
                  {m.totalBudgeted > 0 ? `${Math.round((m.totalSpent / m.totalBudgeted) * 100)}% spent` : ''}
                </Text>
                {isCurrent && (
                  <Text variant="caption" color={colors.textTertiary}>
                    Day {day} of {totalDays}
                  </Text>
                )}
              </View>
            </View>
          </Card>

          <ListCard>
            {m.lines.map((line) => (
              <BudgetRow key={line.budget.id} line={line} name={categoryPath(index.categories, line.category.id)} onPress={() => openLine(line)} />
            ))}
          </ListCard>
        </>
      )}

      <Section title="Tracked without a budget" subtitle={m.unbudgeted.length ? `Spending in ${formatMonth(month)}` : undefined}>
        {m.unbudgeted.length === 0 ? (
          <EmptyState
            compact
            icon="check-circle"
            title="Nothing unbudgeted"
            message={`No spending outside your budgets in ${formatMonth(month)}.`}
            actionLabel="Add spending"
            onAction={() => router.push({ pathname: '/quick-add', params: { mode: 'expense' } })}
          />
        ) : (
          <ListCard>
            {m.unbudgeted.map((u) => {
              const category = index.categories.get(u.categoryId);
              const canBudget = !!category && category.kind === 'expense' && !budgetedIds.has(u.categoryId);
              return (
                <View key={u.categoryId} style={styles.unbudgetedRow}>
                  <VisualTile emoji={categoryEmoji(category?.id) ?? 'package'} size={36} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text weight="medium" numberOfLines={1}>
                      {categoryPath(index.categories, u.categoryId)}
                    </Text>
                    <Money cents={u.amount} variant="small" color={colors.textSecondary} />
                  </View>
                  {canBudget && <Button label="Set budget" size="sm" variant="secondary" onPress={() => openNew(u.categoryId)} />}
                </View>
              );
            })}
          </ListCard>
        )}
      </Section>

      <SelectSheet
        visible={picking}
        onClose={() => setPicking(false)}
        title="Budget a category"
        options={addOptions}
        searchable
        onSelect={(id) => {
          setPicking(false);
          openNew(id);
        }}
      />

      <Sheet
        visible={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.budget ? 'Edit budget' : 'New budget'}
        subtitle={editingName}
        footer={
          <View style={{ gap: spacing.sm }}>
            <Button label="Save" size="lg" fullWidth onPress={save} />
            {editing?.budget && <Button label="Remove budget" icon="trash-2" variant="danger" fullWidth onPress={remove} />}
          </View>
        }
      >
        {editing && (
          <>
            <MoneyField
              label="Amount per month"
              value={editing.amount}
              onChange={(c) => {
                setAmountError(undefined);
                setEditing({ ...editing, amount: c });
              }}
              error={amountError}
              hint={budgetHint(editing)}
              autoFocus={!editing.budget}
            />
            <View style={{ gap: spacing.sm }}>
              <Segmented
                items={[
                  { value: 'limit', label: 'Limit' },
                  { value: 'flexible', label: 'Flexible' },
                ]}
                value={editing.mode}
                onChange={(mode) => setEditing({ ...editing, mode })}
              />
              <Text variant="small" color={colors.textSecondary}>
                {editing.mode === 'limit'
                  ? 'A ceiling. You get a heads-up when you approach it and a clear flag when you go over.'
                  : 'A guide, not a limit. Progress is shown without warnings, which suits categories that vary month to month.'}
              </Text>
            </View>
            <SwitchRow
              label="Roll over unused money"
              description="Leftover (or overspending) carries into next month"
              value={editing.rollover}
              onChange={(rollover) => setEditing({ ...editing, rollover })}
            />
            <Text variant="caption" color={colors.textTertiary}>
              Applies from {formatMonth(month)} onward; earlier months keep their amount.
            </Text>
          </>
        )}
      </Sheet>
    </Screen>
  );
}

function SummaryStat({ label, cents, caption, projected }: { label: string; cents: Cents; caption?: string; projected?: boolean }) {
  return (
    <View style={styles.summaryStat}>
      <Text variant="small" color={colors.textSecondary} numberOfLines={1}>
        {label}
      </Text>
      <Money cents={cents} variant="h3" />
      {projected ? (
        <Pill label="Scheduled" tone="projected" size="sm" />
      ) : (
        !!caption && (
          <Text variant="caption" color={colors.textTertiary}>
            {caption}
          </Text>
        )
      )}
    </View>
  );
}

function BudgetRow({ line, name, onPress }: { line: BudgetLine; name: string; onPress: () => void }) {
  const money = useMoney();
  const flexible = line.budget.mode === 'flexible';
  const over = line.remaining < 0;
  const badge = flexible
    ? ({ tone: 'primary', label: 'Flexible' } as const)
    : line.state === 'over'
      ? ({ tone: 'negative', label: 'Over' } as const)
      : line.state === 'approaching'
        ? ({ tone: 'warning', label: 'Approaching' } as const)
        : ({ tone: 'positive', label: 'On track' } as const);
  const barColor = flexible ? colors.primary : line.state === 'over' ? colors.negative : line.state === 'approaching' ? colors.warning : colors.primary;
  const plannedMarker = line.amount > 0 && line.planned > 0 ? line.planned / line.amount : undefined;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${name}, ${badge.label}, ${money(line.spent)} of ${money(line.amount)}`} style={({ pressed }) => [styles.line, pressed && { opacity: 0.6 }]}>
      <View style={styles.lineTop}>
        <VisualTile emoji={categoryEmoji(line.category.id) ?? 'package'} size={36} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text weight="medium" numberOfLines={1}>
            {name}
          </Text>
          <StatusBadge tone={badge.tone} label={badge.label} />
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text weight="semibold" tabular>
            {money(line.spent)}
          </Text>
          <Text variant="caption" color={colors.textTertiary} tabular>
            of {money(line.amount)}
          </Text>
        </View>
      </View>
      <ProgressBar value={line.ratio} color={barColor} marker={plannedMarker} accessibilityLabel={`${Math.round(Math.min(line.ratio, 9.99) * 100)}% of budget spent`} />
      <View style={styles.between}>
        <Text variant="caption" color={over && !flexible ? colors.negative : colors.textSecondary} tabular>
          {over ? `${money(-line.remaining)} over` : `${money(line.remaining)} left`}
        </Text>
        <Text variant="caption" color={colors.textTertiary} tabular>
          {[
            line.planned > 0 ? `${money(line.planned)} scheduled` : null,
            line.rollover > 0 ? `+${money(line.rollover)} rolled over` : line.rollover < 0 ? `−${money(-line.rollover)} carried over` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.lg, columnGap: spacing.md },
  summaryStat: { flexBasis: '45%', flexGrow: 1, gap: 2, alignItems: 'flex-start' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  line: { paddingVertical: 14, gap: 10 },
  lineTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  unbudgetedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 12 },
});
