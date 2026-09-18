import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { EventLine, useEventActions } from '@/components/bills/EventActions';
import { eventKindColor } from '@/components/finance/Rows';
import { CalendarGrid, EmptyState, IconButton, Legend, ListCard, Money, NavHeader, Pill, Screen, Section, Segmented, StatTile, Stack, Text, type DayMarker } from '@/components/ui';
import { addDays, formatDate, formatMonth, monthEnd, monthOf, monthStart, startOfWeek } from '@/domain/dates';
import { sum } from '@/domain/money';
import { scheduledEvents, type ScheduledEvent } from '@/domain/schedule';
import type { ISODate, ISOMonth } from '@/domain/types';
import { useData, useMoney, useSettings, useToday } from '@/store/hooks';
import { colors, spacing } from '@/theme/tokens';

type Mode = 'month' | 'week' | 'day';

const LEGEND = [
  { label: 'Income', color: eventKindColor('income'), shape: 'rect' as const },
  { label: 'Bills & subscriptions', color: eventKindColor('bill'), shape: 'rect' as const },
  { label: 'Debt payments', color: eventKindColor('debt_payment'), shape: 'rect' as const },
  { label: 'Transfers & contributions', color: eventKindColor('transfer'), shape: 'rect' as const },
];

export default function CalendarScreen() {
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const { weekStartsOn } = useSettings();
  const actions = useEventActions();
  const [mode, setMode] = useState<Mode>('month');
  const [selected, setSelected] = useState<ISODate>(today);
  const [month, setMonth] = useState<ISOMonth>(monthOf(today));

  const weekStart = startOfWeek(selected, weekStartsOn);
  // One query covering the visible grid (with spill-over days), the week and the day.
  const from = [addDays(monthStart(month), -7), weekStart, selected].sort()[0];
  const to = [addDays(monthEnd(month), 7), addDays(weekStart, 6), selected].sort()[2];

  const byDate = useMemo(() => {
    const map = new Map<ISODate, ScheduledEvent[]>();
    for (const e of scheduledEvents(data, { from, to, today })) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return map;
  }, [data, from, to, today]);

  const markers = useMemo(() => {
    const out = new Map<ISODate, DayMarker[]>();
    byDate.forEach((events, date) => {
      const colorsForDay = [...new Set(events.filter((e) => e.status !== 'skipped').map((e) => eventKindColor(e.kind)))];
      if (colorsForDay.length) out.set(date, colorsForDay.map((color) => ({ color })));
    });
    return out;
  }, [byDate]);

  const totals = useMemo(() => {
    const inMonth = [...byDate.values()].flat().filter((e) => monthOf(e.date) === month && e.status !== 'skipped');
    return {
      in: sum(inMonth.filter((e) => e.kind === 'income').map((e) => e.amount)),
      out: sum(inMonth.filter((e) => e.kind !== 'income').map((e) => e.amount + (e.paidAmount ?? 0))),
    };
  }, [byDate, month]);

  const select = (date: ISODate) => {
    setSelected(date);
    if (monthOf(date) !== month) setMonth(monthOf(date));
  };

  const changeMonth = (m: ISOMonth) => {
    setMonth(m);
    setSelected(m === monthOf(today) ? today : monthStart(m));
  };

  const addBill = () => router.push('/bills/edit');

  const dayEvents = (date: ISODate) => byDate.get(date) ?? [];

  return (
    <Screen header={<NavHeader title="Calendar" />}>
      <Stack gap={spacing.md}>
        <Segmented
          items={[
            { value: 'month', label: 'Month' },
            { value: 'week', label: 'Week' },
            { value: 'day', label: 'Day' },
          ]}
          value={mode}
          onChange={setMode}
        />
        <Text variant="small" color={colors.textTertiary}>
          Expected items are projections until you mark them paid.
        </Text>
        <Legend items={LEGEND} />
      </Stack>

      {mode === 'month' && (
        <>
          <CalendarGrid month={month} onMonthChange={changeMonth} selected={selected} today={today} onSelect={select} weekStartsOn={weekStartsOn} markers={markers} />

          <View style={styles.tiles}>
            <StatTile label="Expected in" icon="arrow-down-left" value={<Money cents={totals.in} variant="h3" color={totals.in > 0 ? colors.positive : colors.ink} />} caption={`${formatMonth(month, 'short')} · paid and upcoming`} />
            <StatTile label="Expected out" icon="arrow-up-right" value={<Money cents={totals.out} variant="h3" />} caption={`${formatMonth(month, 'short')} · paid and upcoming`} />
          </View>

          <DayEvents title={formatDate(selected, 'long', today)} events={dayEvents(selected)} actions={actions} onAdd={addBill} compact />
        </>
      )}

      {mode === 'week' && (
        <>
          <Stepper
            label={`${formatDate(weekStart, 'short', today)} – ${formatDate(addDays(weekStart, 6), 'short', today)}`}
            onPrev={() => select(addDays(selected, -7))}
            onNext={() => select(addDays(selected, 7))}
            prevLabel="Previous week"
            nextLabel="Next week"
            onToday={selected === today ? undefined : () => select(today)}
          />
          {[0, 1, 2, 3, 4, 5, 6].every((i) => dayEvents(addDays(weekStart, i)).length === 0) && (
            <EmptyState compact icon="calendar" title="A quiet week" message="No bills, payments or paychecks are scheduled." actionLabel="Add a bill" onAction={addBill} />
          )}
          <Stack gap={spacing.xl}>
            {Array.from({ length: 7 }, (_, i) => {
              const date = addDays(weekStart, i);
              const events = dayEvents(date);
              const isToday = date === today;
              return (
                <View key={date} style={{ gap: spacing.sm }}>
                  <View style={styles.dayHeader}>
                    <Text weight="semibold" color={isToday ? colors.primary : colors.ink} onPress={() => { setSelected(date); setMode('day'); }} suppressHighlighting accessibilityRole="button">
                      {formatDate(date, 'weekday', today)}
                    </Text>
                    {isToday && <Pill label="Today" size="sm" tone="primary" />}
                  </View>
                  {events.length === 0 ? (
                    <Text variant="small" color={colors.textTertiary}>
                      Nothing scheduled
                    </Text>
                  ) : (
                    <ListCard>
                      {events.map((e) => (
                        <EventLine key={e.key} event={e} actions={actions} compact />
                      ))}
                    </ListCard>
                  )}
                </View>
              );
            })}
          </Stack>
        </>
      )}

      {mode === 'day' && (
        <>
          <Stepper
            label={formatDate(selected, 'weekday', today)}
            onPrev={() => select(addDays(selected, -1))}
            onNext={() => select(addDays(selected, 1))}
            prevLabel="Previous day"
            nextLabel="Next day"
            onToday={selected === today ? undefined : () => select(today)}
          />
          <DayEvents title={selected === today ? 'Today' : formatDate(selected, 'long', today)} events={dayEvents(selected)} actions={actions} onAdd={addBill} compact />
        </>
      )}

      {actions.sheet}
    </Screen>
  );
}

function Stepper({ label, onPrev, onNext, prevLabel, nextLabel, onToday }: { label: string; onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string; onToday?: () => void }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.stepper}>
        <IconButton icon="chevron-left" size={36} accessibilityLabel={prevLabel} onPress={onPrev} />
        <Text variant="h3" align="center" style={{ flex: 1 }}>
          {label}
        </Text>
        <IconButton icon="chevron-right" size={36} accessibilityLabel={nextLabel} onPress={onNext} />
      </View>
      {onToday && (
        <View style={{ alignItems: 'center' }}>
          <Pill label="Jump to today" size="sm" icon="corner-up-left" onPress={onToday} />
        </View>
      )}
    </View>
  );
}

function DayEvents({ title, events, actions, onAdd, compact }: { title: string; events: ScheduledEvent[]; actions: ReturnType<typeof useEventActions>; onAdd: () => void; compact?: boolean }) {
  const money = useMoney();
  const open = events.filter((e) => e.status !== 'skipped');
  const out = sum(open.filter((e) => e.kind !== 'income').map((e) => e.amount));
  const incoming = sum(open.filter((e) => e.kind === 'income').map((e) => e.amount));
  return (
    <Section title={title} subtitle={events.length ? [`${events.length} scheduled`, incoming > 0 ? `${money(incoming)} coming in` : null, out > 0 ? `${money(out)} going out` : null].filter(Boolean).join(' · ') : undefined}>
      {events.length === 0 ? (
        <EmptyState compact icon="calendar" title="Nothing scheduled" message="No bills, payments or paychecks on this day." actionLabel="Add a bill" onAction={onAdd} />
      ) : (
        <ListCard>
          {events.map((e) => (
            <EventLine key={e.key} event={e} actions={actions} compact={compact} />
          ))}
        </ListCard>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dayHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
