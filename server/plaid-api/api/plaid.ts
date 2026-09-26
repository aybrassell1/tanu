/**
 * A pass-through for Plaid, and nothing else.
 *
 * Plaid's secret cannot live in a static app, so this function holds it and
 * signs the handful of calls Tanu needs. It keeps no database, writes no logs
 * and stores nothing: a request comes in, the same request goes to Plaid with
 * the credentials attached, and the answer goes straight back. Your
 * transactions pass through here on the way to your phone and are never
 * written down.
 *
 * Deploying it is in README.md next door.
 */

type Json = Record<string, unknown>;

interface Req {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

interface Res {
  status(code: number): Res;
  setHeader(name: string, value: string): void;
  json(body: Json): void;
  end(): void;
}

const PLAID_HOSTS: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://api.plaid.com',
};

/**
 * The only calls that reach Plaid, and the only fields that travel with them.
 * Anything else in the body is dropped, so a caller can never smuggle extra
 * parameters into a Plaid request.
 */
const ACTIONS: Record<string, { path: string; fields: string[] }> = {
  link_token: { path: '/link/token/create', fields: ['user', 'client_name', 'products', 'country_codes', 'language', 'redirect_uri', 'access_token'] },
  exchange: { path: '/item/public_token/exchange', fields: ['public_token'] },
  sync: { path: '/transactions/sync', fields: ['access_token', 'cursor', 'count', 'options'] },
  accounts: { path: '/accounts/get', fields: ['access_token'] },
  institution: { path: '/institutions/get_by_id', fields: ['institution_id', 'country_codes'] },
  remove: { path: '/item/remove', fields: ['access_token'] },
};

export default async function handler(req: Req, res: Res) {
  const env = process.env;
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  const origin = header(req, 'origin');

  res.setHeader('access-control-allow-origin', origin && allowed.includes(origin) ? origin : allowed[0] ?? '');
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, x-tanu-key');
  res.setHeader('access-control-max-age', '86400');
  res.setHeader('vary', 'Origin');
  res.setHeader('cache-control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  // An origin this deployment doesn't know never gets an answer, key or no key.
  if (origin && !allowed.includes(origin)) return res.status(403).json({ error: 'origin_not_allowed' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!secretsPresent(env)) return res.status(500).json({ error: 'not_configured', detail: 'Set PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV, APP_KEY and ALLOWED_ORIGINS.' });
  if (!sameSecret(header(req, 'x-tanu-key'), env.APP_KEY ?? '')) return res.status(401).json({ error: 'unauthorized' });

  const body = (typeof req.body === 'string' ? safeParse(req.body) : (req.body as Json)) ?? {};
  const action = ACTIONS[String(body.action ?? '')];
  if (!action) return res.status(404).json({ error: 'unknown_action' });

  const payload: Json = { client_id: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET };
  for (const field of action.fields) if (body[field] !== undefined) payload[field] = body[field];

  const host = PLAID_HOSTS[env.PLAID_ENV ?? 'sandbox'] ?? PLAID_HOSTS.sandbox;
  try {
    const response = await fetch(`${host}${action.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    // Plaid's own error bodies say what went wrong; pass them through untouched.
    const text = await response.text();
    res.status(response.status);
    res.setHeader('content-type', 'application/json');
    return res.json((safeParse(text) ?? { error: 'bad_upstream_response' }) as Json);
  } catch {
    return res.status(502).json({ error: 'plaid_unreachable' });
  }
}

const header = (req: Req, name: string): string => {
  const value = req.headers[name] ?? req.headers[name.toLowerCase()];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
};

const secretsPresent = (env: NodeJS.ProcessEnv) => !!(env.PLAID_CLIENT_ID && env.PLAID_SECRET && env.APP_KEY && env.ALLOWED_ORIGINS);

function safeParse(text: string): Json | null {
  try {
    return JSON.parse(text) as Json;
  } catch {
    return null;
  }
}

/** Constant-time compare, so a wrong key can't be found one character at a time. */
function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
