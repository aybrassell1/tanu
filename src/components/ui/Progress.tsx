import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors, radius } from '@/theme/tokens';

const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1);

type ProgressBarProps = {
  value: number;
  color?: string;
  height?: number;
  /** Optional marker (0–1), e.g. planned spending or elapsed month. */
  marker?: number;
  accessibilityLabel?: string;
};

export function ProgressBar({ value, color = colors.primary, height = 8, marker, accessibilityLabel }: ProgressBarProps) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamp(value) * 100) }}
      style={[styles.track, { height }]}
    >
      <View style={[styles.fill, { width: `${clamp(value) * 100}%`, backgroundColor: color }]} />
      {marker !== undefined && <View style={[styles.marker, { left: `${clamp(marker) * 100}%`, height: height + 6, top: -3 }]} />}
    </View>
  );
}

export type Segment = { key: string; value: number; color: string };

/** Horizontal share bar with 2px surface gaps between segments. */
export function SplitBar({ segments, height = 12 }: { segments: Segment[]; height?: number }) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return <View style={[styles.track, { height }]} />;
  const visible = segments.filter((s) => s.value > 0);
  return (
    <View style={[styles.split, { height }]}>
      {visible.map((s, i) => (
        <View
          key={s.key}
          style={{
            flex: s.value / total,
            backgroundColor: s.color,
            marginLeft: i === 0 ? 0 : 2,
            borderTopLeftRadius: i === 0 ? radius.pill : 0,
            borderBottomLeftRadius: i === 0 ? radius.pill : 0,
            borderTopRightRadius: i === visible.length - 1 ? radius.pill : 0,
            borderBottomRightRadius: i === visible.length - 1 ? radius.pill : 0,
          }}
        />
      ))}
    </View>
  );
}

type RingProps = { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode };

export function ProgressRing({ value, size = 44, stroke = 4, color = colors.primary, children }: RingProps) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - clamp(value))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { backgroundColor: colors.track, borderRadius: radius.pill, overflow: 'visible', width: '100%' },
  fill: { height: '100%', borderRadius: radius.pill },
  marker: { position: 'absolute', width: 2, marginLeft: -1, backgroundColor: colors.ink, borderRadius: 1 },
  split: { flexDirection: 'row', width: '100%', overflow: 'hidden', borderRadius: radius.pill },
});
