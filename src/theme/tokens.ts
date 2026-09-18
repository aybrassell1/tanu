/**
 * Design tokens. Visual language borrowed from the Deltex Webflow template:
 * Inter, a single saturated blue, blue→sky gradient hero cards, soft grey
 * surfaces, generous radii, pill badges and tightly tracked headlines.
 * Financial screens stay calm: color is reserved for meaning.
 */

export const colors = {
  primary: '#2469FE',
  primaryPressed: '#1C58DB',
  primarySoft: '#EAF1FF',
  primaryMuted: '#BCD3FF',

  ink: '#0C0407',
  textSecondary: '#5C5C5C',
  /** 3.7:1 on white; for captions and axis labels. */
  textTertiary: '#858585',
  onPrimary: '#FFFFFF',

  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceMuted: '#F7F7F7',
  surfaceSunken: '#F0F0F0',
  track: '#EDEDED',
  border: '#E8E8E8',
  borderStrong: '#D6D6D6',

  star: '#FCB823',

  /** Money in / good status. Text-safe step. */
  positive: '#15803D',
  positiveSoft: '#E8F6EC',
  /** Money out / critical status. */
  negative: '#C92A2A',
  negativeSoft: '#FDECEC',
  warning: '#B45309',
  warningSoft: '#FEF3E2',
  /** Projection / hypothetical accents. */
  projected: '#7C3AED',
  projectedSoft: '#F3EEFE',

  glass: 'rgba(255,255,255,0.2)',
  glassBorder: 'rgba(255,255,255,0.35)',
  overlay: 'rgba(12,4,7,0.4)',
} as const;

/** Status marks (icons, dots, bars). Always paired with an icon or label. */
export const status = {
  good: '#0CA30C',
  warning: '#FAB219',
  critical: '#D03B3B',
} as const;

/** Validated categorical order (dataviz validator, light surface #FFFFFF). */
export const series = ['#2469FE', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4', '#008300', '#4A3AA7', '#E34948'] as const;

export const chart = {
  grid: '#EFEFEF',
  axis: '#D6D6D6',
  label: '#858585',
  comparison: '#C9CED8',
} as const;

export const gradients = {
  hero: ['#2469FE', '#5A95FC', '#A9D5FB'],
  soft: ['#EAF1FF', '#F7FBFF'],
  projected: ['#6D28D9', '#8B5CF6', '#C4B5FD'],
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
  card: '0px 1px 2px rgba(12,4,7,0.04), 0px 8px 24px rgba(12,4,7,0.06)',
  float: '0px 12px 32px rgba(12,4,7,0.14)',
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
