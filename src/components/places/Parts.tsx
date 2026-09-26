import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, View } from 'react-native';

import { Pill, Row, Text } from '@/components/ui';
import { PLACE_STATUS, type Grade } from '@/domain/places';
import type { PlaceStatus } from '@/domain/types';
import { colors, radius, spacing } from '@/theme/tokens';

/** A, B, C, D or F — colour plus the letter, never colour alone. */
export function GradeBadge({ grade, size = 56 }: { grade: Grade | null; size?: number }) {
  const tone = gradeTone(grade);
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: radius.md, backgroundColor: tone.bg }]} accessibilityLabel={grade ? `Grade ${grade}` : 'Not graded yet'}>
      <Text variant={size >= 48 ? 'h1' : 'h3'} weight="bold" color={tone.fg}>
        {grade ?? '?'}
      </Text>
    </View>
  );
}

export function gradeTone(grade: Grade | null): { bg: string; fg: string } {
  if (!grade) return { bg: colors.surfaceMuted, fg: colors.textSecondary };
  if (grade === 'A' || grade === 'B') return { bg: colors.positiveSoft, fg: colors.positive };
  if (grade === 'C') return { bg: colors.warningSoft, fg: colors.warning };
  return { bg: colors.negativeSoft, fg: colors.negative };
}

const STATUSES: PlaceStatus[] = ['touring', 'shortlist', 'applied', 'chosen', 'passed'];

export function StatusPicker({ value, onChange }: { value: PlaceStatus; onChange: (s: PlaceStatus) => void }) {
  return (
    <View style={styles.statuses}>
      {STATUSES.map((s) => (
        <Pill key={s} size="sm" label={PLACE_STATUS[s].label} selected={value === s} onPress={() => onChange(s)} />
      ))}
    </View>
  );
}

/**
 * Five stars, tapped once. Tapping the star you are on clears it, so a rating
 * is never something you are stuck with.
 */
export function RatingRow({ label, score, onChange }: { label: string; score: number; onChange: (score: number) => void }) {
  return (
    <Row>
      <Text style={{ flex: 1 }}>{label}</Text>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            onPress={() => onChange(score === n ? 0 : n)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${n} out of 5`}
            accessibilityState={{ selected: score >= n }}
          >
            <Feather name="star" size={22} color={score >= n ? colors.star : colors.borderStrong} />
          </Pressable>
        ))}
      </View>
    </Row>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
  statuses: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stars: { flexDirection: 'row', gap: 6 },
});
