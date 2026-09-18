import { ScrollViewStyleReset } from 'expo-router/html';
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
        <meta name="theme-color" content="#FFFFFF" />

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
        <script dangerouslySetInnerHTML={{ __html: SERVICE_WORKER }} />
        <style dangerouslySetInnerHTML={{ __html: BODY }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

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
  body { background-color: #FFFFFF; overscroll-behavior-y: none; }
  /* The app draws its own surfaces; keep the shell neutral in either theme. */
  @media (prefers-color-scheme: dark) { body { background-color: #FFFFFF; } }
`;
