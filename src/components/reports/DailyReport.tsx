import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { MonthSwitcher } from '@/components/finance/Pickers';
import { Card, ColumnChart, Text } from '@/components/ui';
import { EmojiIcon } from '@/components/ui/Glyph';
import { addDays, daysInMonth, dayOfWeek, formatDate, monthOf, monthStart, parseISODate, startOfWeek, WEEKDAYS, minDate, monthEnd } from '@/domain/dates';
import { spendingAmount } from '@/domain/ledger';
import type { ISODate, ISOMonth } from '@/domain/types';
import { useData, useMoney, useSettings, useToday } from '@/store/hooks';
import { colors, radius, series, spacing } from '@/theme/tokens';

import { ChartCard, Takeaway, useAxisMoney } from './shared';

/** Sequential blue ramp (validated reference steps), light → dark. */
const RAMP = ['#EEF3FB', '#CDE2FB', '#9EC5F4', '#6DA7EC', '#3987E5', '#256ABF', '#184F95'];

export function DailyReport() {
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const axisMoney = useAxisMoney();
  const { weekStartsOn } = useSettings();
  const [month, setMonth] = useState<ISOMonth>(monthOf(today));
  const [selected, setSelected] = useState<ISODate | null>(null);

  const model = useMemo(() => {
    const byDay = new Map<ISODate, number>();
    const from = monthStart(month);
    const to = minDate(monthEnd(month), today);
    for (const t of data.transactions) {
      if (t.date < from || t.date > to) continue;
      const s = spendingAmount(t);
      if (s) byDay.set(t.date, (byDay.get(t.date) ?? 0) + s);
    }
    const days: ISODate[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
    const amounts = days.map((d) => Math.max(0, byDay.get(d) ?? 0));
    const max = Math.max(1, ...amounts);
    const total = amounts.reduce((a, b) => a + b, 0);
    const noSpend = amounts.filter((a) => a === 0).length;
    const top = days.reduce((best, d) => ((byDay.get(d) ?? 0) > (byDay.get(best) ?? 0) ? d : best), days[0] ?? from);

    // Average by weekday across the last 12 weeks, for habits rather than one month.
    const weekday = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
    for (let d = addDays(today, -83); d <= today; d = addDays(d, 1)) weekday[dayOfWeek(d)].count++;
    for (const t of data.transactions) {
      if (t.date < addDays(today, -83) || t.date > today) continue;
      weekday[dayOfWeek(t.date)].total += spendingAmount(t);
    }
    return { byDay, days, max, total, noSpend, top, weekday: weekday.map((w) => (w.count ? Math.round(w.total / w.count) : 0)) };
  }, [data, month, today]);

  const first = monthStart(month);
  const { year, month: m } = parseISODate(first);
  const gridStart = startOfWeek(first, weekStartsOn);
  const cells = Math.ceil((dayOfWeekOffset(first, weekStartsOn) + daysInMonth(year, m)) / 7) * 7;
  const level = (cents: number) => (cents <= 0 ? 0 : 1 + Math.min(RAMP.length - 2, Math.floor((cents / model.max) * (RAMP.length - 1))));
  const selectedAmount = selected ? model.byDay.get(selected) ?? 0 : null;
  const orderedDays = Array.from({ length: 7 }, (_, i) => (i + weekStartsOn) % 7);
  const busiest = orderedDays.reduce((best, d) => (model.weekday[d] > model.weekday[best] ? d : best), orderedDays[0]);

  return (
    <>
      <MonthSwitcher month={month} onChange={(v) => { setMonth(v); setSelected(null); }} max={monthOf(today)} />

      <View style={styles.tiles}>
        <Stat emoji="money-with-wings" label="Spent" value={money(model.total, { whole: true })} />
        <Stat emoji="sparkles" label="No-spend days" value={String(model.noSpend)} />
        <Stat emoji="fire" label="Biggest day" value={model.byDay.get(model.top) ? formatDate(model.top, 'short', today) : '—'} />
      </View>

      <ChartCard title="Which days did I spend the most?">
        <View style={styles.week}>
          {orderedDays.map((d) => (
            <Text key={d} variant="caption" color={colors.textTertiary} align="center" style={styles.cellLabel}>
              {WEEKDAYS[d].charAt(0)}
            </Text>
          ))}
        </View>
        <View style={styles.grid}>
          {Array.from({ length: cells }, (_, i) => {
            const date = addDays(gridStart, i);
            const inMonth = monthOf(date) === month && date <= today;
            const amount = model.byDay.get(date) ?? 0;
            const isSel = date === selected;
            return (
              <View key={date} style={styles.cellWrap}>
                {inMonth ? (
                  <Pressable
                    onPress={() => setSelected(isSel ? null : date)}
                    accessibilityRole="button"
                    accessibilityLabel={`${formatDate(date, 'weekday', today)}: ${money(amount)}`}
                    style={[styles.cell, { backgroundColor: RAMP[level(amount)] }, isSel && styles.cellSelected]}
                  >
                    <Text variant="caption" color={level(amount) >= 4 ? colors.onPrimary : colors.textSecondary}>
                      {parseISODate(date).day}
                    </Text>
                  </Pressable>
                ) : (
                  <View style={styles.cell} />
                )}
              </View>
            );
          })}
        </View>
        <View style={styles.legend}>
          <Text variant="caption" color={colors.textTertiary}>
            Less
          </Text>
          {RAMP.map((c) => (
            <View key={c} style={[styles.swatch, { backgroundColor: c }]} />
          ))}
          <Text variant="caption" color={colors.textTertiary}>
            More
          </Text>
          <View style={{ flex: 1 }} />
          {selected && (
            <Text variant="small" weight="semibold" tabular>
              {formatDate(selected, 'short', today)} · {money(selectedAmount ?? 0)}
            </Text>
          )}
        </View>
      </ChartCard>

      <ChartCard title="Which weekdays cost the most?">
        <ColumnChart
          accessibilityLabel="Average spending by weekday over the last 12 weeks"
          data={orderedDays.map((d) => ({ key: String(d), label: WEEKDAYS[d].slice(0, 2), values: [model.weekday[d]] }))}
          series={[{ label: 'Average per day', color: series[0] }]}
          formatY={axisMoney}
          formatTitle={(d) => `${WEEKDAYS[Number(d.key)]} average`}
          highlightKey={String(busiest)}
          height={150}
        />
        <Text variant="caption" color={colors.textTertiary}>
          Average over the last 12 weeks
        </Text>
      </ChartCard>

      {model.weekday[busiest] > 0 && <Takeaway>{`${WEEKDAYS[busiest]}s are your priciest day, averaging ${money(model.weekday[busiest], { whole: true })}.`}</Takeaway>}
    </>
  );
}

function dayOfWeekOffset(date: ISODate, weekStartsOn: 0 | 1) {
  return (dayOfWeek(date) - weekStartsOn + 7) % 7;
}

function Stat({ emoji, label, value }: { emoji: string; label: string; value: string }) {
  return (
    <Card variant="muted" padding={spacing.md} style={{ flex: 1, gap: 4 }}>
      <EmojiIcon name={emoji} size={22} />
      <Text variant="h3" tabular numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>
        {label}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing.sm },
  week: { flexDirection: 'row' },
  cellLabel: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cellWrap: { width: `${100 / 7}%`, padding: 2 },
  cell: { aspectRatio: 1, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  cellSelected: { borderWidth: 2, borderColor: colors.ink },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: spacing.sm },
  swatch: { width: 12, height: 12, borderRadius: 3 },
});
