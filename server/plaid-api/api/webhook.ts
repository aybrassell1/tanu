/**
 * Plaid telling us something arrived, and us telling your phone.
 *
 * Anyone can post to this address, so nothing here is believed until the
 * signature checks out: Plaid signs every webhook, and an unsigned or stale
 * one is dropped without a word.
 *
 * What happens then: fetch what is new, turn it into a sentence, push it. The
 * transactions are not written down — the notification is the only thing that
 * outlives the request, and it lives on your phone.
 */

import webpush from 'web-push';

import { getItem, open, plaid, putItem, type Stored } from './_lib.js';

interface Req {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}
interface Res {
  status(code: number): Res;
  setHeader(name: string, value: string): void;
  json(body: Record<string, unknown>): void;
  end(): void;
}

interface PlaidTransaction {
  transaction_id: string;
  amount: number;
  name: string;
  merchant_name?: string | null;
  pending?: boolean;
  date: string;
}

export default async function handler(req: Req, res: Res) {
  const env = process.env;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  const body = (typeof req.body === 'string' ? safeParse(req.body) : (req.body as Record<string, unknown>)) ?? {};

  // Unverified webhooks are not webhooks. 200 either way, so a rejected one
  // isn't retried at us forever.
  const verified = await verify(env, String(header(req, 'plaid-verification')), raw);
  if (!verified) return res.status(200).json({ ok: false, reason: 'unverified' });

  const code = String(body.webhook_code ?? '');
  const itemId = String(body.item_id ?? '');
  if (!itemId) return res.status(200).json({ ok: false, reason: 'no_item' });

  // Only the codes that mean "there is something new to say".
  if (!['SYNC_UPDATES_AVAILABLE', 'DEFAULT_UPDATE', 'INITIAL_UPDATE', 'HISTORICAL_UPDATE'].includes(code)) {
    return res.status(200).json({ ok: true, ignored: code });
  }

  try {
    const item = await getItem(env, itemId);
    if (!item) return res.status(200).json({ ok: false, reason: 'not_watched' });

    const token = await open(env, item.token);
    // Our own cursor, kept apart from the app's, so neither disturbs the other.
    const first = !item.cursor;
    const result = await plaid<{ added: PlaidTransaction[]; next_cursor: string }>(env, '/transactions/sync', {
      access_token: token,
      ...(item.cursor ? { cursor: item.cursor } : {}),
      count: 100,
    });
    await putItem(env, { ...item, cursor: result.next_cursor, updatedAt: new Date().toISOString() });

    // The first sync is the whole history; nobody wants that as a notification.
    const fresh = (result.added ?? []).filter((t) => !t.pending);
    if (first || fresh.length === 0) return res.status(200).json({ ok: true, notified: false, count: fresh.length });

    await push(env, item, message(fresh, item.institution));
    return res.status(200).json({ ok: true, notified: true, count: fresh.length });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: e instanceof Error ? e.message : String(e) });
  }
}

/** One charge gets named; several get counted. */
function message(fresh: PlaidTransaction[], institution?: string): { title: string; body: string } {
  const spent = fresh.filter((t) => t.amount > 0);
  const one = spent[0] ?? fresh[0];
  const name = (one.merchant_name || one.name || 'Somewhere').trim();
  const amount = money(Math.abs(one.amount));

  if (fresh.length === 1) {
    return one.amount > 0
      ? { title: `${amount} at ${name}`, body: institution ? `Charged to ${institution}` : 'Tap to see it in Tanu' }
      : { title: `${amount} in from ${name}`, body: institution ? `Into ${institution}` : 'Tap to see it in Tanu' };
  }
  return {
    title: `${fresh.length} new transactions`,
    body: `Including ${amount} at ${name}${institution ? ` · ${institution}` : ''}`,
  };
}

const money = (dollars: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(dollars);

async function push(env: NodeJS.ProcessEnv, item: Stored, payload: { title: string; body: string }): Promise<void> {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw new Error('No VAPID keys set.');
  webpush.setVapidDetails(env.VAPID_SUBJECT ?? 'mailto:nobody@example.com', publicKey, privateKey);
  await webpush.sendNotification(item.subscription as unknown as webpush.PushSubscription, JSON.stringify(payload));
}

// ─── Is this really Plaid? ───────────────────────────────────────────────────

const keyCache = new Map<string, JsonWebKey>();

async function verify(env: NodeJS.ProcessEnv, jwt: string, raw: string): Promise<boolean> {
  try {
    const [headerPart, payloadPart, signaturePart] = jwt.split('.');
    if (!headerPart || !payloadPart || !signaturePart) return false;
    const head = JSON.parse(b64url(headerPart)) as { alg?: string; kid?: string };
    // Only ES256. Anything else is someone trying it on.
    if (head.alg !== 'ES256' || !head.kid) return false;

    let jwk = keyCache.get(head.kid);
    if (!jwk) {
      const response = await plaid<{ key: JsonWebKey }>(env, '/webhook_verification_key/get', { key_id: head.kid });
      jwk = response.key;
      keyCache.set(head.kid, jwk);
    }

    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const signature = Uint8Array.from(Buffer.from(signaturePart.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
    if (!(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, signed))) return false;

    const claims = JSON.parse(b64url(payloadPart)) as { iat?: number; request_body_sha256?: string };
    // Five minutes, so a captured webhook cannot be replayed tomorrow.
    if (!claims.iat || Math.abs(Date.now() / 1000 - claims.iat) > 300) return false;

    const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))).toString('hex');
    return timingSafe(digest, claims.request_body_sha256 ?? '');
  } catch {
    return false;
  }
}

const b64url = (part: string) => Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

function timingSafe(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const header = (req: Req, name: string): string => {
  const value = req.headers[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
};

function safeParse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}
