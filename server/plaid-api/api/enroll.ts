/**
 * Turning notifications on for one connected bank, and off again.
 *
 * The app sends the item it wants watched, the access token to read it with,
 * and where to push. Everything is encrypted before it is stored, and removing
 * a connection removes the record — there is no copy kept for later.
 */

import { cors, dropItem, getItem, plaid, putItem, sameSecret, seal, type PushSubscriptionJSON } from './_lib.js';

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

export default async function handler(req: Req, res: Res) {
  const env = process.env;
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  const origin = String(req.headers.origin ?? '');
  for (const [name, value] of Object.entries(cors(origin, allowed))) res.setHeader(name, value);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (origin && !allowed.includes(origin)) return res.status(403).json({ error: 'origin_not_allowed' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const key = req.headers['x-tanu-key'];
  if (!sameSecret(Array.isArray(key) ? (key[0] ?? '') : (key ?? ''), env.APP_KEY ?? '')) return res.status(401).json({ error: 'unauthorized' });

  const body = (typeof req.body === 'string' ? safeParse(req.body) : (req.body as Record<string, unknown>)) ?? {};
  const itemId = typeof body.item_id === 'string' ? body.item_id : '';
  if (!itemId) return res.status(400).json({ error: 'item_id_required' });

  try {
    // Turning it off for one bank takes the whole record with it.
    if (body.action === 'forget') {
      await dropItem(env, itemId);
      return res.status(200).json({ ok: true, watching: false });
    }

    const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
    const subscription = body.subscription as PushSubscriptionJSON | undefined;
    if (!accessToken || !subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys.auth) {
      return res.status(400).json({ error: 'access_token_and_subscription_required' });
    }

    // Keep the cursor from any earlier enrolment, so switching phones doesn't
    // replay every transaction we have already told you about.
    const existing = await getItem(env, itemId);
    await putItem(env, {
      itemId,
      token: await seal(env, accessToken),
      cursor: existing?.cursor,
      subscription,
      institution: typeof body.institution === 'string' ? body.institution : existing?.institution,
      updatedAt: new Date().toISOString(),
    });
    // Point the item at this deployment, so Plaid knows where to call. Doing
    // it here means an existing connection starts sending webhooks without
    // being reconnected, and nothing has to be set by hand in the dashboard.
    let webhookSet = false;
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
    if (host) {
      try {
        await plaid(env, '/item/webhook/update', { access_token: accessToken, webhook: `https://${host}/api/webhook` });
        webhookSet = true;
      } catch {
        // Worth saying, not worth failing: the dashboard can set it instead.
      }
    }
    return res.status(200).json({ ok: true, watching: true, webhookSet });
  } catch (e) {
    return res.status(500).json({ error: 'enroll_failed', detail: e instanceof Error ? e.message : String(e) });
  }
}

function safeParse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}
