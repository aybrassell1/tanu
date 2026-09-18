import { Appearance, Platform } from 'react-native';

import { DARK, LIGHT, type Palette } from './palette';

/**
 * Design tokens. Visual language borrowed from the Deltex Webflow template:
 * Inter, a single saturated blue, blue→sky gradient hero cards, soft grey
 * surfaces, generous radii, pill badges and tightly tracked headlines.
 * Financial screens stay calm: color is reserved for meaning.
 *
 * Theming: on the web every token is a CSS variable, so switching theme
 * repaints instantly without re-rendering anything. Native can't do that, so
 * it resolves the device's scheme once at startup. Either way the rest of the
 * app keeps reading `colors.x` and never needs to know which theme is on.
 */

const web = Platform.OS === 'web';
/** Native only: the palette picked at launch. */
export const nativePalette: Palette = web ? LIGHT : Appearance.getColorScheme() === 'dark' ? DARK : LIGHT;

const token = (key: keyof Palette): string => (web ? `var(--c-${key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())})` : (nativePalette[key] as string));
const list = (key: 'series' | 'gradientHero' | 'gradientSoft' | 'gradientProjected', index: number): string =>
  web ? `var(--c-${key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}-${index})` : (nativePalette[key] as string[])[index];

export const colors = {
  primary: token('primary'),
  primaryPressed: token('primaryPressed'),
  primarySoft: token('primarySoft'),
  primaryMuted: token('primaryMuted'),

  ink: token('ink'),
  /** Pressed state and text colours for ink-filled surfaces. */
  inkPressed: token('inkPressed'),
  onInk: token('onInk'),
  onInkMuted: token('onInkMuted'),
  textSecondary: token('textSecondary'),
  /** Captions and axis labels; 4.5:1 on its own surface in both themes. */
  textTertiary: token('textTertiary'),
  onPrimary: token('onPrimary'),
  /** Text on a gradient panel. */
  onGradient: token('onGradient'),
  onGradientMuted: token('onGradientMuted'),

  background: token('background'),
  surface: token('surface'),
  surfaceMuted: token('surfaceMuted'),
  surfaceSunken: token('surfaceSunken'),
  track: token('track'),
  border: token('border'),
  borderStrong: token('borderStrong'),

  star: token('star'),

  /** Money in / good status. Text-safe step. */
  positive: token('positive'),
  positiveSoft: token('positiveSoft'),
  /** Money out / critical status. */
  negative: token('negative'),
  negativeSoft: token('negativeSoft'),
  warning: token('warning'),
  warningSoft: token('warningSoft'),
  /** Projection / hypothetical accents. */
  projected: token('projected'),
  projectedSoft: token('projectedSoft'),

  glass: token('glass'),
  glassBorder: token('glassBorder'),
  /** Recessed panel inside a gradient card. */
  gradientScrim: token('gradientScrim'),
  gradientShade: token('gradientShade'),
  overlay: token('overlay'),
} as const;

/** Status marks (icons, dots, bars). Always paired with an icon or label. */
export const status = {
  good: token('statusGood'),
  warning: token('statusWarning'),
  critical: token('statusCritical'),
} as const;

/** Validated categorical order (dataviz validator, against each theme's surface). */
export const series = [list('series', 0), list('series', 1), list('series', 2), list('series', 3), list('series', 4), list('series', 5), list('series', 6), list('series', 7)] as const;

export const chart = {
  grid: token('chartGrid'),
  axis: token('chartAxis'),
  label: token('chartLabel'),
  comparison: token('chartComparison'),
} as const;

export const gradients = {
  hero: [list('gradientHero', 0), list('gradientHero', 1), list('gradientHero', 2)],
  soft: [list('gradientSoft', 0), list('gradientSoft', 1)],
  projected: [list('gradientProjected', 0), list('gradientProjected', 1), list('gradientProjected', 2)],
} as const;

export const radius = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
} as const;

export const shadows = {
  card: token('shadowCard'),
  float: token('shadowFloat'),
} as const;

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export type FontWeight = keyof typeof fonts;

type TypeStyle = { fontSize: number; lineHeight: number; letterSpacing: number; weight: FontWeight };

export const typography = {
  display: { fontSize: 40, lineHeight: 46, letterSpacing: -1.8, weight: 'medium' },
  h1: { fontSize: 30, lineHeight: 36, letterSpacing: -1.1, weight: 'medium' },
  h2: { fontSize: 22, lineHeight: 28, letterSpacing: -0.7, weight: 'medium' },
  h3: { fontSize: 17, lineHeight: 22, letterSpacing: -0.35, weight: 'semibold' },
  body: { fontSize: 15, lineHeight: 22, letterSpacing: -0.15, weight: 'regular' },
  small: { fontSize: 13, lineHeight: 18, letterSpacing: -0.1, weight: 'regular' },
  caption: { fontSize: 11, lineHeight: 14, letterSpacing: 0, weight: 'medium' },
} as const satisfies Record<string, TypeStyle>;

export type TypographyVariant = keyof typeof typography;

/** Bottom padding scroll views need so content clears the floating tab bar. */
export const TAB_BAR_CLEARANCE = 120;

/**
 * A soft tint of a saved colour (a category, an account) for use behind an
 * icon. On the web it mixes with the current surface, so the same category
 * reads the same way in either theme; native falls back to a fixed alpha.
 */
export function tintOf(color: string | undefined, strength = 0.18): string {
  const base = color ?? colors.primary;
  if (!web) return `${base}${Math.round(strength * 255).toString(16).padStart(2, '0')}`;
  return `color-mix(in srgb, ${base} ${Math.round(strength * 100)}%, ${colors.surface})`;
}
