import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { IconName } from '@/data/icons';
import { colors, radius } from '@/theme/tokens';
import { EmojiIcon } from './Glyph';
import { Text } from './Text';

export const PILL_TONES = {
  light: { bg: colors.surface, border: colors.border, fg: colors.ink },
  muted: { bg: colors.surfaceMuted, border: colors.surfaceMuted, fg: colors.ink },
  primary: { bg: colors.primarySoft, border: colors.primarySoft, fg: colors.primary },
  positive: { bg: colors.positiveSoft, border: colors.positiveSoft, fg: colors.positive },
  negative: { bg: colors.negativeSoft, border: colors.negativeSoft, fg: colors.negative },
  warning: { bg: colors.warningSoft, border: colors.warningSoft, fg: colors.warning },
  projected: { bg: colors.projectedSoft, border: colors.projectedSoft, fg: colors.projected },
  glass: { bg: colors.glass, border: colors.glassBorder, fg: colors.onPrimary },
  dark: { bg: colors.ink, border: colors.ink, fg: colors.onPrimary },
} as const;

export type PillTone = keyof typeof PILL_TONES;

type PillProps = {
  label: string;
  icon?: IconName;
  /** Full-color illustration instead of a line icon. */
  emoji?: string | null;
  trailingIcon?: IconName;
  tone?: PillTone;
  size?: 'sm' | 'md';
  onPress?: () => void;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/** Rounded badge or chip, like the template's "⚡ How it works" / "Step - 1". */
export function Pill({ label, icon, emoji, trailingIcon, tone = 'light', size = 'md', onPress, selected, style, accessibilityLabel }: PillProps) {
  const t = PILL_TONES[selected ? 'dark' : tone];
  const small = size === 'sm';
  const content = (
    <View style={[styles.pill, small && styles.small, { backgroundColor: t.bg, borderColor: t.border }, style]}>
      {emoji ? <EmojiIcon name={emoji} size={small ? 13 : 16} /> : icon && <Feather name={icon} size={small ? 11 : 13} color={t.fg} />}
      <Text variant={small ? 'caption' : 'small'} weight="medium" color={t.fg} numberOfLines={1}>
        {label}
      </Text>
      {trailingIcon && <Feather name={trailingIcon} size={small ? 11 : 13} color={t.fg} />}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={selected === undefined ? undefined : { selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  small: { paddingHorizontal: 8, paddingVertical: 3, gap: 4 },
});
