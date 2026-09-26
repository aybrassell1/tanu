import { ScrollViewStyleReset } from 'expo-router/html';

import { themeCss } from '@/theme/palette';
import type { ReactNode } from 'react';

/**
 * The HTML shell for the web build. Tanu is meant to be added to the iPhone
 * home screen, so it declares the standalone app metadata iOS needs: its own
 * icon, no browser chrome, and a viewport that reaches under the notch.
 */
export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />

        <title>Tanu</title>
        <meta name="description" content="Everything you own, owe, earn, spend and plan — in one calm place." />
        {/* Brand blue until the opening screen hands over, so iOS paints the status bar to match. */}
        <meta name="theme-color" content="#2469FE" />

        {/* Home-screen app on iOS: own icon, no Safari chrome. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Tanu" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="assets/apple-touch-icon.png" />
        <link rel="icon" href="favicon.ico" />
        <link rel="manifest" href="manifest.json" />

        {/* Nothing here leaves the device; don't let anyone index a personal ledger. */}
        <meta name="robots" content="noindex, nofollow" />

        <ScrollViewStyleReset />
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
        <script dangerouslySetInnerHTML={{ __html: SERVICE_WORKER }} />
        <style dangerouslySetInnerHTML={{ __html: themeCss() }} />
        <style dangerouslySetInnerHTML={{ __html: BODY }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

/**
 * The saved palette, before a single pixel is drawn.
 *
 * Without this the page starts with no `data-theme`, so a phone set to dark
 * gets the dark palette from the media query, and the app flips to light a
 * second later once the ledger has loaded. One attribute, set here, and the
 * first frame is already right.
 */
const THEME = `
  try {
    var choice = window.localStorage.getItem('masterfinance:theme');
    if (choice === 'light' || choice === 'dark') document.documentElement.setAttribute('data-theme', choice);
  } catch (e) {}
`;

const SERVICE_WORKER = `
  // Dev servers rebuild constantly; a cache there only serves stale pages.
  var local = ['localhost', '127.0.0.1'].indexOf(window.location.hostname) !== -1;
  if ('serviceWorker' in navigator && !local) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(new URL('sw.js', window.location.href).pathname).catch(function () {});
    });
  }
`;

const BODY = `
  /* Brand blue until the opening screen hands over: iOS paints the area under
     the notch with the page's own background, not with the app's root view. */
  body { background-color: #2469FE; overscroll-behavior-y: none; }
  body.app-ready { background-color: var(--c-background); }
  /* Form controls and scrollbars follow the theme too. */
  :root { color-scheme: light; }
  [data-theme='dark'] { color-scheme: dark; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { color-scheme: dark; } }
`;
