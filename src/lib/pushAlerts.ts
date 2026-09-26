/**
 * Getting told when money moves, without opening anything.
 *
 * A phone cannot wake an app up to go and look — Safari has never implemented
 * background sync — so the only way this works is the other direction: Plaid
 * tells your server something arrived, and your server tells your phone.
 *
 * The cost is honest and worth stating: for this to say *what* you were
 * charged, the server has to be able to read the account, so it keeps the
 * access token. It is encrypted there, and it is the only reason that record
 * exists. Turning notifications off deletes it.
 */

import { Platform } from 'react-native';

import type { BankConnection } from '@/domain/types';
import { PlaidError, type BankApi } from '@/lib/plaid';

export type PushState = 'unsupported' | 'not_installed' | 'denied' | 'off' | 'on';

const web = () => Platform.OS === 'web' && typeof globalThis !== 'undefined';

/** iOS only allows this in an app added to the home screen, never in a tab. */
export function installedAsApp(): boolean {
  if (!web()) return false;
  const nav = globalThis.navigator as (Navigator & { standalone?: boolean }) | undefined;
  if (nav?.standalone) return true;
  return !!globalThis.matchMedia?.('(display-mode: standalone)').matches;
}

export function pushSupported(): boolean {
  return web() && 'serviceWorker' in (globalThis.navigator ?? {}) && 'PushManager' in globalThis;
}

/** Where things stand right now, without asking for anything. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  // Asking in a browser tab on iOS fails in a way that looks like a bug.
  if (!installedAsApp()) return 'not_installed';
  if (Notification.permission === 'denied') return 'denied';
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  return existing ? 'on' : 'off';
}

/**
 * Asks, subscribes, and hands back what the server needs to reach this phone.
 * Null when the person says no.
 */
export async function subscribe(vapidPublicKey: string): Promise<PushSubscriptionJSON | null> {
  if (!pushSupported()) throw new PlaidError('This device cannot show notifications from a web app.');
  if (!installedAsApp()) throw new PlaidError('Add Tanu to your home screen first — iOS only allows notifications there.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    }));
  return subscription.toJSON() as PushSubscriptionJSON;
}

export async function unsubscribe(): Promise<void> {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  await existing?.unsubscribe();
}

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Tells your server to watch one bank, or to stop and forget it. */
export async function enroll(
  api: BankApi,
  connection: BankConnection,
  subscription: PushSubscriptionJSON | null,
): Promise<void> {
  const body = subscription
    ? { item_id: connection.itemId, access_token: connection.accessToken, subscription, institution: connection.institutionName }
    : { item_id: connection.itemId, action: 'forget' };

  const response = await fetch(`${api.url.replace(/\/+$/, '')}/api/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tanu-key': api.key },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new PlaidError(`Your server would not set that up (${response.status}). ${detail.slice(0, 160)}`);
  }
}

/** The VAPID key travels as base64url; the browser wants bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = globalThis.atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
