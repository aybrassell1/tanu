import { Pressable, StyleSheet, View } from 'react-native';

import { addDays, daysInMonth, diffDays, formatMonth, monthStart, parseISODate, startOfWeek, toISODate, WEEKDAYS } from '@/domain/dates';
import type { ISODate, ISOMonth } from '@/domain/types';
import { colors, radius } from '@/theme/tokens';
import { IconButton } from './Button';
import { Text } from './Text';

export type DayMarker = { color: string };

type CalendarGridProps = {
  month: ISOMonth;
  onMonthChange: (month: ISOMonth) => void;
  selected?: ISODate;
  today: ISODate;
  onSelect: (date: ISODate) => void;
  weekStartsOn?: 0 | 1;
  /** Up to three dots per day. */
  markers?: Map<ISODate, DayMarker[]>;
};

export function CalendarGrid({ month, onMonthChange, selected, today, onSelect, weekStartsOn = 0, markers }: CalendarGridProps) {
  const first = monthStart(month);
  const { year, month: m } = parseISODate(first);
  const gridStart = startOfWeek(first, weekStartsOn);
  const last = toISODate(year, m, daysInMonth(year, m));
  const weeks = Math.ceil((diffDays(gridStart, last) + 1) / 7);
  const shift = (n: number) => {
    const idx = year * 12 + (m - 1) + n;
    onMonthChange(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`);
  };
  const headers = Array.from({ length: 7 }, (_, i) => WEEKDAYS[(i + weekStartsOn) % 7].charAt(0));

  return (
    <View style={{ gap: 8 }}>
      <View style={styles.header}>
        <IconButton icon="chevron-left" size={34} accessibilityLabel="Previous month" onPress={() => shift(-1)} />
        <Text variant="h3" style={{ flex: 1 }} align="center">
          {formatMonth(month)}
        </Text>
        <IconButton icon="chevron-right" size={34} accessibilityLabel="Next month" onPress={() => shift(1)} />
      </View>
      <View style={styles.week}>
        {headers.map((h, i) => (
          <Text key={i} variant="caption" color={colors.textTertiary} align="center" style={styles.cell}>
            {h}
          </Text>
        ))}
      </View>
      {Array.from({ length: weeks }, (_, w) => (
        <View key={w} style={styles.week}>
          {Array.from({ length: 7 }, (_, d) => {
            const date = addDays(gridStart, w * 7 + d);
            const inMonth = date >= first && date <= last;
            const isSelected = date === selected;
            const isToday = date === today;
            const dots = markers?.get(date) ?? [];
            return (
              <Pressable
                key={date}
                onPress={() => onSelect(date)}
                accessibilityRole="button"
                accessibilityLabel={date}
                accessibilityState={{ selected: isSelected }}
                style={styles.cell}
              >
                <View style={[styles.day, isToday && styles.today, isSelected && styles.selected]}>
                  <Text variant="small" weight={isSelected || isToday ? 'semibold' : 'regular'} color={isSelected ? colors.onPrimary : inMonth ? colors.ink : colors.borderStrong}>
                    {parseISODate(date).day}
                  </Text>
                </View>
                <View style={styles.dots}>
                  {dots.slice(0, 3).map((dot, i) => (
                    <View key={i} style={[styles.dot, { backgroundColor: dot.color }]} />
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  week: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 2 },
  day: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 1, borderColor: colors.primary },
  selected: { backgroundColor: colors.primary, borderColor: colors.primary },
  dots: { flexDirection: 'row', gap: 2, height: 5, marginTop: 1 },
  dot: { width: 5, height: 5, borderRadius: 3 },
});
