import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { colors, radius } from '@/theme/tokens';
import { Text } from './Text';

type Option<T extends string> = T | { value: T; label: string };

const valueOf = <T extends string>(o: Option<T>) => (typeof o === 'string' ? o : o.value);
const labelOf = <T extends string>(o: Option<T>) => (typeof o === 'string' ? o : o.label);

type Props<T extends string> = {
  items: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
};

/** Text tabs with a dot over the active item ("• My Courses  Chats  Tutors"). */
export function SegmentedTabs<T extends string>({ items, value, onChange }: Props<T>) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityRole="tablist">
      {items.map((item) => {
        const v = valueOf(item);
        const active = v === value;
        return (
          <Pressable key={v} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => onChange(v)} hitSlop={8} style={styles.item}>
            <View style={[styles.dot, active && styles.dotActive]} />
            <Text variant="body" weight={active ? 'semibold' : 'medium'} color={active ? colors.ink : colors.textTertiary}>
              {labelOf(item)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Compact pill segmented control for switching views or ranges. */
export function Segmented<T extends string>({ items, value, onChange, size = 'md' }: Props<T> & { size?: 'sm' | 'md' }) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {items.map((item) => {
        const v = valueOf(item);
        const active = v === value;
        return (
          <Pressable
            key={v}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(v)}
            style={[styles.segment, size === 'sm' && styles.segmentSm, active && styles.segmentActive]}
          >
            <Text variant="small" weight={active ? 'semibold' : 'medium'} color={active ? colors.ink : colors.textSecondary} numberOfLines={1}>
              {labelOf(item)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 24 },
  item: { alignItems: 'center', gap: 4 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent' },
  dotActive: { backgroundColor: colors.ink },
  segmented: { flexDirection: 'row', backgroundColor: colors.surfaceSunken, borderRadius: radius.md, padding: 3 },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', height: 34, borderRadius: 9, paddingHorizontal: 6 },
  segmentSm: { height: 28 },
  segmentActive: { backgroundColor: colors.surface, boxShadow: '0px 1px 3px rgba(12,4,7,0.12)' },
});
