/**
 * The two palettes. Everything visual comes from here.
 *
 * Dark is not the light theme inverted: surfaces are warm near-blacks that
 * step *up* as they come forward, text never hits pure white, and the money
 * colours are lifted until they read on a dark surface (checked against the
 * dataviz validator's 4.5:1 floor for text and 3:1 for marks).
 */

export type PaletteName = 'light' | 'dark';

export interface Palette {
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  primaryMuted: string;

  ink: string;
  /** Pressed state of an ink-filled surface (the inverted chip, dark buttons). */
  inkPressed: string;
  /** Text on an ink-filled surface. */
  onInk: string;
  /** Muted text on an ink-filled surface, e.g. a chart tooltip label. */
  onInkMuted: string;
  textSecondary: string;
  textTertiary: string;
  onPrimary: string;
  /** Text and icons on a gradient panel: always near-white, in both themes. */
  onGradient: string;
  /** A step back from onGradient, for labels and captions on a gradient. */
  onGradientMuted: string;

  background: string;
  surface: string;
  surfaceMuted: string;
  surfaceSunken: string;
  track: string;
  border: string;
  borderStrong: string;

  star: string;

  positive: string;
  positiveSoft: string;
  negative: string;
  negativeSoft: string;
  warning: string;
  warningSoft: string;
  projected: string;
  projectedSoft: string;

  glass: string;
  glassBorder: string;
  /** Recessed panel drawn *inside* a gradient card, so text on it still reads. */
  gradientScrim: string;
  /**
   * Laid over a gradient panel along the same diagonal, deepening toward the
   * light end. Without it a hero's pale corner drops white text to ~1.5:1.
   */
  gradientShade: string;
  overlay: string;

  statusGood: string;
  statusWarning: string;
  statusCritical: string;

  chartGrid: string;
  chartAxis: string;
  chartLabel: string;
  chartComparison: string;

  /** Categorical series, validated against this theme's surface. */
  series: [string, string, string, string, string, string, string, string];

  gradientHero: [string, string, string];
  gradientSoft: [string, string];
  gradientProjected: [string, string, string];

  shadowCard: string;
  shadowFloat: string;
}

export const LIGHT: Palette = {
  primary: '#2469FE',
  primaryPressed: '#1C58DB',
  primarySoft: '#EAF1FF',
  primaryMuted: '#BCD3FF',

  ink: '#0C0407',
  inkPressed: '#2A2427',
  onInk: '#FFFFFF',
  onInkMuted: 'rgba(255,255,255,0.7)',
  textSecondary: '#5C5C5C',
  textTertiary: '#6E6E6E',
  onPrimary: '#FFFFFF',
  onGradient: '#FFFFFF',
  onGradientMuted: 'rgba(255,255,255,0.92)',

  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceMuted: '#F7F7F7',
  surfaceSunken: '#F0F0F0',
  track: '#EDEDED',
  border: '#E8E8E8',
  borderStrong: '#D6D6D6',

  star: '#FCB823',

  positive: '#15803D',
  positiveSoft: '#E8F6EC',
  negative: '#C92A2A',
  negativeSoft: '#FDECEC',
  warning: '#B45309',
  warningSoft: '#FEF3E2',
  projected: '#7C3AED',
  projectedSoft: '#F3EEFE',

  glass: 'rgba(12,4,7,0.34)',
  glassBorder: 'rgba(255,255,255,0.38)',
  gradientScrim: 'rgba(8,18,52,0.22)',
  gradientShade: 'rgba(8,18,52,0.38)',
  overlay: 'rgba(12,4,7,0.4)',

  statusGood: '#0CA30C',
  statusWarning: '#FAB219',
  statusCritical: '#D03B3B',

  chartGrid: '#EFEFEF',
  chartAxis: '#D6D6D6',
  chartLabel: '#6E6E6E',
  chartComparison: '#C9CED8',

  series: ['#2469FE', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4', '#008300', '#4A3AA7', '#E34948'],

  gradientHero: ['#1A4ED8', '#2E6BF2', '#5E9BF9'],
  gradientSoft: ['#EAF1FF', '#F7FBFF'],
  gradientProjected: ['#6D28D9', '#8B5CF6', '#C4B5FD'],

  shadowCard: '0px 1px 2px rgba(12,4,7,0.04), 0px 8px 24px rgba(12,4,7,0.06)',
  shadowFloat: '0px 12px 32px rgba(12,4,7,0.14)',
};

export const DARK: Palette = {
  primary: '#7AA2FF',
  primaryPressed: '#93B4FF',
  primarySoft: '#16223D',
  primaryMuted: '#31406B',

  ink: '#F2EFEE',
  inkPressed: '#D9D5D3',
  onInk: '#131217',
  onInkMuted: 'rgba(19,18,23,0.66)',
  textSecondary: '#AFA8A6',
  textTertiary: '#8A8482',
  onPrimary: '#0B0A0C',
  onGradient: '#FFFFFF',
  onGradientMuted: 'rgba(255,255,255,0.92)',

  background: '#0E0D10',
  surface: '#17161A',
  surfaceMuted: '#1E1C21',
  surfaceSunken: '#26242A',
  track: '#2B2930',
  border: '#312E36',
  borderStrong: '#3A373F',

  star: '#FFC94D',

  positive: '#4ADE80',
  positiveSoft: '#12291C',
  negative: '#FF7A7A',
  negativeSoft: '#301618',
  warning: '#F0B357',
  warningSoft: '#2E2213',
  projected: '#B18BFF',
  projectedSoft: '#231A3A',

  glass: 'rgba(255,255,255,0.12)',
  glassBorder: 'rgba(255,255,255,0.24)',
  gradientScrim: 'rgba(0,0,0,0.25)',
  gradientShade: 'rgba(0,0,0,0.12)',
  overlay: 'rgba(0,0,0,0.6)',

  statusGood: '#3FD07E',
  statusWarning: '#F5C451',
  statusCritical: '#FF7B7B',

  chartGrid: '#242228',
  chartAxis: '#3A373F',
  chartLabel: '#8A8482',
  chartComparison: '#4A4750',

  // The same eight hues stepped for a dark surface; validated for CVD separation
  // and 3:1 contrast on #17161A (dataviz validator, dark mode).
  series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],

  gradientHero: ['#1D3A8F', '#2B4FCB', '#3F6AD8'],
  gradientSoft: ['#1A2036', '#14161F'],
  gradientProjected: ['#4C2E8F', '#6D45C4', '#8B6BE0'],

  shadowCard: '0px 1px 2px rgba(0,0,0,0.5), 0px 8px 24px rgba(0,0,0,0.45)',
  shadowFloat: '0px 12px 32px rgba(0,0,0,0.6)',
};

export const PALETTES: Record<PaletteName, Palette> = { light: LIGHT, dark: DARK };

/** CSS custom properties for one palette, e.g. `--c-surface: #17161A;`. */
export function paletteVars(palette: Palette): string {
  // Lists become one variable per entry, so a single colour can be read alone.
  return Object.entries(palette)
    .flatMap(([key, value]) => (Array.isArray(value) ? value.map((v, i) => `  --c-${kebab(key)}-${i}: ${v};`) : [`  --c-${kebab(key)}: ${value};`]))
    .join('\n');
}

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The stylesheet the web build injects: light by default, dark by choice or by system. */
export function themeCss(): string {
  return `:root {\n${paletteVars(LIGHT)}\n}\n\n[data-theme='dark'] {\n${paletteVars(DARK)}\n}\n\n@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {\n${paletteVars(DARK)}\n  }\n}`;
}
