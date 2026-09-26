/**
 * The small amount of state that notifications require.
 *
 * Everything else in this deployment is a pass-through that remembers nothing.
 * Telling you what you were charged cannot work that way: Plaid calls us when
 * something arrives, and we have to know which phone to wake and be able to
 * ask what the charge was.
 *
 * So one record per connected bank, in Upstash: the access token (encrypted,
 * with the key in an environment variable, so the database alone is not
 * enough), a cursor of our own, and the push subscription. No transaction is
 * ever written down — they are fetched, turned into a notification, and let go.
 */

export interface Stored {
  /** Plaid's item id, which is what a webhook arrives quoting. */
  itemId: string;
  /** AES-GCM, base64. Useless without ENCRYPTION_KEY. */
  token: string;
  /** Our own place in the transactions stream, independent of the app's. */
  cursor?: string;
  /** Where to send a notification, as the browser gave it to us. */
  subscription: PushSubscriptionJSON;
  institution?: string;
  updatedAt: string;
}

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const KEY_PREFIX = 'tanu:item:';

// ─── Upstash, over its REST API so there is no client library to carry ───────

async function redis(env: NodeJS.ProcessEnv, command: unknown[]): Promise<unknown> {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('No store configured: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`Store said ${response.status}`);
  const body = (await response.json()) as { result?: unknown; error?: string };
  if (body.error) throw new Error(body.error);
  return body.result;
}

export async function putItem(env: NodeJS.ProcessEnv, item: Stored): Promise<void> {
  await redis(env, ['SET', `${KEY_PREFIX}${item.itemId}`, JSON.stringify(item)]);
}

export async function getItem(env: NodeJS.ProcessEnv, itemId: string): Promise<Stored | null> {
  const raw = await redis(env, ['GET', `${KEY_PREFIX}${itemId}`]);
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as Stored;
  } catch {
    return null;
  }
}

export async function dropItem(env: NodeJS.ProcessEnv, itemId: string): Promise<void> {
  await redis(env, ['DEL', `${KEY_PREFIX}${itemId}`]);
}

// ─── The access token, encrypted at rest ─────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

async function keyFrom(env: NodeJS.ProcessEnv): Promise<CryptoKey> {
  const raw = env.ENCRYPTION_KEY;
  if (!raw) throw new Error('No ENCRYPTION_KEY set.');
  const bytes = Uint8Array.from(Buffer.from(raw, 'base64'));
  if (bytes.byteLength !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes, base64 encoded.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(env: NodeJS.ProcessEnv, plain: string): Promise<string> {
  const key = await keyFrom(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
  const joined = new Uint8Array(iv.byteLength + cipher.byteLength);
  joined.set(iv);
  joined.set(cipher, iv.byteLength);
  return Buffer.from(joined).toString('base64');
}

export async function open(env: NodeJS.ProcessEnv, sealed: string): Promise<string> {
  const key = await keyFrom(env);
  const bytes = Uint8Array.from(Buffer.from(sealed, 'base64'));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  return dec.decode(plain);
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

export const PLAID_HOSTS: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
};

export const plaidHost = (env: NodeJS.ProcessEnv): string => PLAID_HOSTS[(env.PLAID_ENV ?? 'sandbox').trim().toLowerCase()] ?? PLAID_HOSTS.sandbox;

/** A call to Plaid with this deployment's credentials attached. */
export async function plaid<T>(env: NodeJS.ProcessEnv, path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${plaidHost(env)}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, ...body }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Plaid ${path} said ${response.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

/** Constant-time compare, so a wrong key can't be found one character at a time. */
export function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function cors(origin: string, allowed: string[]): Record<string, string> {
  const ok = origin && allowed.includes(origin);
  return {
    'access-control-allow-origin': ok ? origin : (allowed[0] ?? ''),
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-tanu-key',
    'access-control-max-age': '86400',
    vary: 'Origin',
    'cache-control': 'no-store',
  };
}
