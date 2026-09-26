/**
 * Plaid's own sign-in window.
 *
 * It has to be Plaid's page, in Plaid's frame: that is what keeps your bank
 * password out of this app entirely. Their script is fetched only when you
 * open it, never on a cold start.
 */

import { Platform } from 'react-native';

import { PlaidError } from './plaid';

const LINK_SCRIPT = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

type LinkHandler = { open: () => void; exit: () => void; destroy: () => void };
type PlaidGlobal = { create: (config: Record<string, unknown>) => LinkHandler };

export const linkSupported = () => Platform.OS === 'web';

function loadLink(): Promise<PlaidGlobal> {
  const w = globalThis as { Plaid?: PlaidGlobal; document?: Document };
  if (w.Plaid) return Promise.resolve(w.Plaid);
  const doc = w.document;
  if (!doc) return Promise.reject(new PlaidError('Bank sign-in only works in the app on the web.'));
  return new Promise((resolve, reject) => {
    const existing = doc.querySelector(`script[src="${LINK_SCRIPT}"]`);
    const onLoad = () => (w.Plaid ? resolve(w.Plaid) : reject(new PlaidError('Plaid Link did not load.')));
    if (existing) {
      existing.addEventListener('load', onLoad);
      existing.addEventListener('error', () => reject(new PlaidError('Plaid Link did not load.')));
      return;
    }
    const script = doc.createElement('script');
    script.src = LINK_SCRIPT;
    script.async = true;
    script.onload = onLoad;
    script.onerror = () => reject(new PlaidError('Plaid Link did not load.'));
    doc.head.appendChild(script);
  });
}

/**
 * Opens Plaid's own sign-in. Resolves with the public token when a bank is
 * connected, or null if you close it. Your credentials never leave that frame.
 */
export function openLink(token: string): Promise<string | null> {
  return loadLink().then(
    (Plaid) =>
      new Promise<string | null>((resolve, reject) => {
        const handler = Plaid.create({
          token,
          onSuccess: (publicToken: string) => {
            resolve(publicToken);
            handler.destroy();
          },
          onExit: (error: { display_message?: string; error_message?: string } | null) => {
            if (error) reject(new PlaidError(error.display_message ?? error.error_message ?? 'Bank sign-in was cancelled.'));
            else resolve(null);
            handler.destroy();
          },
        });
        handler.open();
      }),
  );
}
