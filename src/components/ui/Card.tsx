import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, gradients, radius, shadows, spacing } from '@/theme/tokens';
import { usePressScale } from '@/theme/motion';


type CardProps = {
  children: ReactNode;
  variant?: 'elevated' | 'outlined' | 'muted';
  padding?: number;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
};

export function Card({ children, variant = 'outlined', padding = spacing.lg, style, onPress, accessibilityLabel }: CardProps) {
  const press = usePressScale(0.99);
  if (onPress) {
    return (
      <Animated.View style={[press.style, style]}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          {...press.handlers}
          style={({ pressed }) => [styles.base, styles[variant], { padding }, pressed && styles.pressed]}
        >
          {children}
        </Pressable>
      </Animated.View>
    );
  }
  return <View style={[styles.base, styles[variant], { padding }, style]}>{children}</View>;
}

/** The signature Deltex blue→sky gradient panel. */
export function GradientCard({
  children,
  padding = spacing.xl,
  style,
  palette = 'hero',
}: Omit<CardProps, 'variant' | 'onPress'> & { palette?: 'hero' | 'projected' }) {
  return (
    <LinearGradient colors={gradients[palette]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.gradient, { padding }, style]}>
      {/*
        The gradient's light end can't carry white text on its own, so a shade
        runs the same diagonal and deepens as the blue lightens. The card still
        reads as a gradient; white text keeps about 6:1 wherever it lands.
      */}
      <LinearGradient
        colors={['transparent', colors.gradientShade]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}
      />
      {/* Soft diagonal sheen to echo the template's banded gradient. */}
      <View style={[styles.sheen, { pointerEvents: 'none' }]} />
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.lg },
  elevated: { backgroundColor: colors.surface, boxShadow: shadows.card },
  outlined: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  muted: { backgroundColor: colors.surfaceMuted },
  pressed: { opacity: 0.85 },
  gradient: { borderRadius: radius.xl, overflow: 'hidden' },
  sheen: {
    position: 'absolute',
    // Kept inside the card: a wider band makes the browser scroll the card sideways on focus.
    width: '100%',
    height: 90,
    left: 0,
    top: '55%',
    backgroundColor: 'rgba(255,255,255,0.10)',
    transform: [{ rotate: '-18deg' }],
  },
});
