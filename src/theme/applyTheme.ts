import { Platform } from 'react-native';

import { DARK, LIGHT } from './palette';
import type { ThemeChoice } from '@/domain/types';

/**
 * Applies the chosen palette on the web by flipping one attribute: every token
 * is a CSS variable, so the whole app repaints without re-rendering. Also keeps
 * the iOS status-bar colour in step, since a home-screen app takes it from the
 * page's theme colour.
 */
export function applyTheme(choice: ThemeChoice) {
  if (Platform.OS !== 'web') return;
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return;
  const root = doc.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
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
