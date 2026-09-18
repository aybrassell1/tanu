import Feather from '@expo/vector-icons/Feather';
import { useMemo, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Card, Pill, Segmented, Text, Disclosure } from '@/components/ui';
import { addDays, addMonths, addMonthsToMonth, formatDate, minDate, monthEnd, monthOf, monthStart } from '@/domain/dates';
import type { ISODate, ISOMonth } from '@/domain/types';
import { useMoney, useToday } from '@/store/hooks';
import { colors, radius, spacing } from '@/theme/tokens';

// ─── Periods ─────────────────────────────────────────────────────────────────

export type RangeKey = 'this_month' | 'last_month' | '3m' | '12m' | 'this_year';

export const RANGE_ITEMS: { value: RangeKey; label: string }[] = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: '3m', label: '3 months' },
  { value: '12m', label: '12 months' },
  { value: 'this_year', label: 'This year' },
];

export interface DateRange {
  key: RangeKey;
  from: ISODate;
  to: ISODate;
  /** Plain-language name used mid-sentence ("this month", "the last 3 months"). */
  phrase: string;
  /** The comparable period just before this one. */
  previous: { from: ISODate; to: ISODate; phrase: string };
  /** Dates shown under the control, e.g. "Jun 17 – Sep 16". */
  caption: string;
}

export function rangeFor(key: RangeKey, today: ISODate): DateRange {
  const month = monthOf(today);
  const prev = addMonthsToMonth(month, -1);
  const caption = (from: ISODate, to: ISODate) => `${formatDate(from, 'short', today)} – ${formatDate(to, 'short', today)}`;
  const build = (from: ISODate, to: ISODate, phrase: string, previous: DateRange['previous']): DateRange => ({ key, from, to, phrase, previous, caption: caption(from, to) });
  switch (key) {
    case 'this_month':
      return build(monthStart(month), today, 'this month so far', {
        from: monthStart(prev),
        to: minDate(addMonths(today, -1), monthEnd(prev)),
        phrase: 'the same point last month',
      });
    case 'last_month': {
      const before = addMonthsToMonth(month, -2);
      return build(monthStart(prev), monthEnd(prev), 'last month', { from: monthStart(before), to: monthEnd(before), phrase: 'the month before' });
    }
    case '3m':
      return build(addDays(addMonths(today, -3), 1), today, 'the last 3 months', { from: addDays(addMonths(today, -6), 1), to: addMonths(today, -3), phrase: 'the 3 months before' });
    case '12m':
      return build(addDays(addMonths(today, -12), 1), today, 'the last 12 months', { from: addDays(addMonths(today, -24), 1), to: addMonths(today, -12), phrase: 'the 12 months before' });
    case 'this_year': {
      const year = Number(today.slice(0, 4));
      return build(`${year}-01-01`, today, 'this year so far', { from: `${year - 1}-01-01`, to: addMonths(today, -12), phrase: 'the same point last year' });
    }
  }
}

/** Short axis label for a month: single letter when many columns share the width. */
export const monthLabel = (month: ISOMonth, count: number) => {
  const [y, m] = month.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const name = names[Number(m) - 1];
  if (count > 8) return name.charAt(0);
  return count > 1 && m === '01' ? `${name} '${y.slice(2)}` : name;
};

export function PeriodControl({ value, onChange, range }: { value: RangeKey; onChange: (k: RangeKey) => void; range: DateRange }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ flex: 1, minWidth: 440 }}>
          <Segmented items={RANGE_ITEMS} value={value} onChange={onChange} size="sm" />
        </View>
      </ScrollView>
      <Text variant="caption" color={colors.textTertiary}>
        {range.caption}
      </Text>
    </View>
  );
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

export const percent = (ratio: number, digits = 0) => (Number.isFinite(ratio) ? `${(ratio * 100).toFixed(digits)}%` : '—');

/** Share of a total as a whole percent, guarding against zero totals. */
export const shareOf = (part: number, total: number) => (total > 0 ? part / total : 0);

/** Relative change, or null when there is nothing to compare against. */
export const relativeChange = (current: number, previous: number) => (previous !== 0 ? (current - previous) / Math.abs(previous) : null);

/** Money formatter for chart axes (compact, whole). */
export function useAxisMoney() {
  const money = useMoney();
  return (v: number) => money(Math.round(v), { compact: true, whole: true });
}

// ─── Building blocks ─────────────────────────────────────────────────────────

type Good = 'up' | 'down' | 'none';

/** Signed difference with an arrow; color always paired with the arrow and sign. */
export function Delta({ value, format, good = 'none', suffix, variant = 'small' }: { value: number; format: (abs: number) => string; good?: Good; suffix?: string; variant?: 'small' | 'caption' | 'body' }) {
  const zero = value === 0;
  const up = value > 0;
  const tone = zero || good === 'none' ? colors.textSecondary : (good === 'up') === up ? colors.positive : colors.negative;
  const iconName = zero ? 'minus' : up ? 'arrow-up-right' : 'arrow-down-right';
  const sign = zero ? '' : up ? '+' : '−';
  return (
    <View style={styles.delta}>
      <Feather name={iconName} size={variant === 'caption' ? 11 : 13} color={tone} />
      <Text variant={variant} weight="semibold" color={tone} tabular numberOfLines={1}>
        {`${sign}${format(Math.abs(value))}${suffix ?? ''}`}
      </Text>
    </View>
  );
}

export function MoneyDelta({ cents, good = 'none', whole = true, compact, variant, suffix }: { cents: number; good?: Good; whole?: boolean; compact?: boolean; variant?: 'small' | 'caption' | 'body'; suffix?: string }) {
  const money = useMoney();
  return <Delta value={cents} good={good} variant={variant} suffix={suffix} format={(abs) => money(abs, { whole, compact })} />;
}

/** Text-only delta for captions and hints ("▲ $120 vs August"). */
export function deltaPhrase(diff: number, format: (abs: number) => string, against: string) {
  if (diff === 0) return `Same as ${against}`;
  return `${diff > 0 ? '▲ +' : '▼ −'}${format(Math.abs(diff))} vs ${against}`;
}

/** Card holding one chart: the question it answers as its title. */
export function ChartCard({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <Card style={{ gap: spacing.md }}>
      <View style={styles.chartHeader}>
        <Text variant="h3" accessibilityRole="header" style={{ flex: 1 }}>
          {title}
        </Text>
        {badge}
      </View>
      {children}
    </Card>
  );
}

/** One plain-language sentence computed from the data. */
export function Takeaway({ children }: { children: string }) {
  return (
    <View style={styles.takeaway} accessibilityRole="summary">
      <Feather name="message-circle" size={16} color={colors.primary} style={{ marginTop: 2 }} />
      <Text color={colors.ink} style={{ flex: 1 }}>
        {children}
      </Text>
    </View>
  );
}

export function PartialNote({ label = 'Month to date' }: { label?: string }) {
  return <Pill size="sm" tone="muted" icon="clock" label={label} />;
}

export type TableColumn = { label: string; align?: 'left' | 'right'; flex?: number };

/** Accessible table of the numbers behind a chart, collapsed by default to keep reports visual. */
export function DataTable({ columns, rows, caption, open }: { columns: TableColumn[]; rows: { key: string; cells: ReactNode[] }[]; caption?: string; open?: boolean }) {
  return (
    <Disclosure label="Show the numbers" count={rows.length} initiallyOpen={open}>
      <DataTableBody columns={columns} rows={rows} caption={caption} />
    </Disclosure>
  );
}

function DataTableBody({ columns, rows, caption }: { columns: TableColumn[]; rows: { key: string; cells: ReactNode[] }[]; caption?: string }) {
  return (
    <View style={styles.table}>
      <View style={[styles.tr, styles.thead]}>
        {columns.map((c, i) => (
          <Text key={c.label || i} variant="caption" color={colors.textTertiary} style={[styles.cell, { flex: c.flex ?? 1, textAlign: c.align ?? (i === 0 ? 'left' : 'right') }]} numberOfLines={2}>
            {c.label.toUpperCase()}
          </Text>
        ))}
      </View>
      {rows.map((row) => (
        <View key={row.key} style={styles.tr}>
          {row.cells.map((cell, i) => {
            const col = columns[i];
            const align = col?.align ?? (i === 0 ? 'left' : 'right');
            return (
              <View key={i} style={[styles.cell, { flex: col?.flex ?? 1, alignItems: align === 'right' ? 'flex-end' : 'flex-start' }]}>
                {typeof cell === 'string' ? (
                  <Text variant="small" tabular weight={i === 0 ? 'medium' : 'regular'} align={align} numberOfLines={2}>
                    {cell}
                  </Text>
                ) : (
                  cell
                )}
              </View>
            );
          })}
        </View>
      ))}
      {!!caption && (
        <Text variant="caption" color={colors.textTertiary} style={{ paddingTop: spacing.sm }}>
          {caption}
        </Text>
      )}
    </View>
  );
}

/** Money cell for a DataTable. */
export function MoneyCell({ cents, signed, color, compact }: { cents: number; signed?: boolean; color?: string; compact?: boolean }) {
  const money = useMoney();
  return (
    <Text variant="small" tabular align="right" color={color} numberOfLines={1}>
      {money(cents, { whole: true, signed, compact })}
    </Text>
  );
}

export function Muted({ children }: { children: string }) {
  return (
    <Text variant="small" color={colors.textSecondary}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  delta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  chartHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  takeaway: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  table: { borderTopWidth: 1, borderTopColor: colors.border },
  tr: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  thead: { paddingVertical: 6 },
  cell: { justifyContent: 'center' },
});

/** Period selector state for a report. */
export function useRange(initial: RangeKey = 'this_month') {
  const today = useToday();
  const [key, setKey] = useState<RangeKey>(initial);
  const range = useMemo(() => rangeFor(key, today), [key, today]);
  return { key, setKey, range, today };
}
