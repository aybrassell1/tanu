import Feather from '@expo/vector-icons/Feather';
import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import type { IconName } from '@/data/icons';
import { colors, radius } from '@/theme/tokens';
import { Text } from './Text';

const variants = {
  primary: { bg: colors.primary, pressed: colors.primaryPressed, fg: colors.onPrimary, border: colors.primary },
  secondary: { bg: colors.surface, pressed: colors.surfaceMuted, fg: colors.ink, border: colors.border },
  dark: { bg: colors.ink, pressed: '#2A2427', fg: colors.onPrimary, border: colors.ink },
  ghost: { bg: 'transparent', pressed: colors.surfaceMuted, fg: colors.primary, border: 'transparent' },
  danger: { bg: colors.surface, pressed: colors.negativeSoft, fg: colors.negative, border: colors.border },
} as const;

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: keyof typeof variants;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  trailingIcon?: IconName;
  fullWidth?: boolean;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

const SIZES = { sm: { height: 32, px: 12, icon: 14 }, md: { height: 40, px: 16, icon: 15 }, lg: { height: 52, px: 20, icon: 17 } };

export function Button({ label, onPress, variant = 'primary', size = 'md', icon, trailingIcon, fullWidth, disabled, loading, style, accessibilityHint }: ButtonProps) {
  const v = variants[variant];
  const s = SIZES[size];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive }}
      accessibilityHint={accessibilityHint}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { height: s.height, paddingHorizontal: s.px, borderRadius: size === 'lg' ? 14 : radius.md },
        fullWidth && styles.fullWidth,
        { backgroundColor: pressed ? v.pressed : v.bg, borderColor: v.border, opacity: inactive ? 0.5 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.fg} />
      ) : (
        icon && <Feather name={icon} size={s.icon} color={v.fg} />
      )}
      <Text variant={size === 'lg' ? 'body' : 'small'} weight="semibold" color={v.fg} numberOfLines={1}>
        {label}
      </Text>
      {trailingIcon && <Feather name={trailingIcon} size={s.icon} color={v.fg} />}
    </Pressable>
  );
}

type IconButtonProps = {
  icon: IconName;
  onPress?: () => void;
  variant?: 'light' | 'dark' | 'glass' | 'plain' | 'primary';
  size?: number;
  accessibilityLabel: string;
  disabled?: boolean;
};

export function IconButton({ icon, onPress, variant = 'light', size = 40, accessibilityLabel, disabled }: IconButtonProps) {
  const palette = {
    light: { bg: colors.surface, border: colors.border, fg: colors.ink },
    dark: { bg: colors.ink, border: colors.ink, fg: colors.onPrimary },
    glass: { bg: colors.glass, border: colors.glassBorder, fg: colors.onPrimary },
    plain: { bg: 'transparent', border: 'transparent', fg: colors.ink },
    primary: { bg: colors.primary, border: colors.primary, fg: colors.onPrimary },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [
        styles.icon,
        { width: size, height: size, backgroundColor: palette.bg, borderColor: palette.border, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      <Feather name={icon} size={Math.round(size * 0.45)} color={palette.fg} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', gap: 6, borderWidth: 1 },
  fullWidth: { alignSelf: 'stretch' },
  icon: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1 },
});
