import { Platform } from 'react-native';

import { DARK, LIGHT } from './palette';
import type { ThemeChoice } from '@/domain/types';

/**
 * Applies the chosen palette on the web by flipping one attribute: every token
 * is a CSS variable, so the whole app repaints without re-rendering. Also keeps
 * the iOS status-bar colour in step, since a home-screen app takes it from the
 * page's theme colour.
 */
/**
 * Where the chosen palette is kept for the next cold start. The ledger holds
 * the real setting, but parsing it takes a moment the first paint doesn't have,
 * so the choice alone lives here and `+html.tsx` reads it before anything draws.
 */
export const THEME_KEY = 'masterfinance:theme';

export function applyTheme(choice: ThemeChoice) {
  if (Platform.OS !== 'web') return;
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return;
  const root = doc.documentElement;
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(THEME_KEY, choice);
  } catch {
    // A blocked or full store only costs us the head start next time.
  }
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

/**
 * Hands the page back from the opening screen: the area under the notch and the
 * status bar stop being brand blue and take the theme's background. Called when
 * the opening screen has gone, not when the theme is decided, so the strip at
 * the top stays blue for the whole animation.
 */
export function revealApp(choice: ThemeChoice) {
  if (Platform.OS !== 'web') return;
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return;
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isDark(choice) ? DARK.background : LIGHT.background);
  // Releases the brand blue the page opened with (see +html.tsx).
  doc.body?.classList.add('app-ready');
}

/** Whether the given choice resolves to the dark palette right now. */
export function isDark(choice: ThemeChoice): boolean {
  if (choice !== 'system') return choice === 'dark';
  if (Platform.OS !== 'web') return false;
  const query = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia;
  return !!query?.('(prefers-color-scheme: dark)').matches;
}
