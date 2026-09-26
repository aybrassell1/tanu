/**
 * Talking to your own Plaid pass-through.
 *
 * Everything here goes to the URL you deployed and nowhere else: the app has no
 * Plaid credentials of its own and could not reach Plaid directly if it tried.
 * Link itself is Plaid's script, loaded from their CDN only when you open it,
 * because bank sign-in has to happen inside their frame — that is the point of
 * it, and why Tanu never sees a password.
 */

import type { PlaidTransaction, SyncPayload } from '@/domain/plaidSync';

export interface BankApi {
  url: string;
  key: string;
  /** Identifies the server to the browser when subscribing to notifications. */
  vapidPublicKey?: string;
}

export class PlaidError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Anything this app asks the pass-through to do. */
type Action = 'link_token' | 'exchange' | 'sync' | 'accounts' | 'institution' | 'remove';

async function call<T>(api: BankApi, action: Action, body: Record<string, unknown> = {}): Promise<T> {
  const endpoint = `${api.url.replace(/\/+$/, '')}/api/plaid`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tanu-key': api.key },
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    throw new PlaidError("Couldn't reach your server. Check the address, and that it is deployed.");
  }

  const text = await response.text();
  const json = safeParse(text);
  if (!response.ok) {
    if (response.status === 401) throw new PlaidError('That key was refused. Check the key matches APP_KEY on the server.', 'unauthorized', 401);
    if (response.status === 403) throw new PlaidError('This app is not in the server\'s allowed origins.', 'origin_not_allowed', 403);
    const code = typeof json?.error_code === 'string' ? json.error_code : typeof json?.error === 'string' ? json.error : undefined;
    // Plaid says error_message; our own pass-through says detail.
    const detail = typeof json?.error_message === 'string' ? json.error_message : typeof json?.detail === 'string' ? json.detail : undefined;
    throw new PlaidError(detail ?? `The server said no (${response.status}).`, code, response.status);
  }
  return (json ?? {}) as T;
}

const safeParse = (text: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** Whether the deployment answers at all, and which Plaid environment it uses. */
export async function checkApi(api: BankApi): Promise<{ ok: boolean; env?: string; message?: string }> {
  try {
    // A link token is the cheapest call that proves the credentials work.
    await linkToken(api, 'tanu-health-check');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/** A short-lived token that opens Link. `accessToken` puts Link in repair mode. */
export async function linkToken(api: BankApi, userId: string, accessToken?: string): Promise<string> {
  const body: Record<string, unknown> = {
    user: { client_user_id: userId },
    client_name: 'Tanu',
    language: 'en',
    country_codes: ['US'],
  };
  // Repairing an existing connection asks for no products; adding one asks for
  // transactions, which is the only thing this app reads.
  if (accessToken) body.access_token = accessToken;
  else body.products = ['transactions'];
  const result = await call<{ link_token?: string }>(api, 'link_token', body);
  if (!result.link_token) throw new PlaidError('The server did not return a link token.');
  return result.link_token;
}

export async function exchange(api: BankApi, publicToken: string): Promise<{ access_token: string; item_id: string }> {
  return call<{ access_token: string; item_id: string }>(api, 'exchange', { public_token: publicToken });
}

export interface PlaidAccount {
  account_id: string;
  name: string;
  official_name?: string | null;
  mask?: string | null;
  type: string;
  subtype?: string | null;
  balances?: { current?: number | null; available?: number | null; iso_currency_code?: string | null };
}

export async function accounts(api: BankApi, accessToken: string): Promise<{ accounts: PlaidAccount[]; item: { institution_id?: string | null } }> {
  return call<{ accounts: PlaidAccount[]; item: { institution_id?: string | null } }>(api, 'accounts', { access_token: accessToken });
}

export async function institutionName(api: BankApi, institutionId: string): Promise<string | undefined> {
  const result = await call<{ institution?: { name?: string } }>(api, 'institution', { institution_id: institutionId, country_codes: ['US'] });
  return result.institution?.name;
}

export async function removeItem(api: BankApi, accessToken: string): Promise<void> {
  await call(api, 'remove', { access_token: accessToken });
}

/**
 * Everything since the cursor. Plaid pages, so this keeps asking until it says
 * there is no more, and hands back one payload.
 */
export async function syncAll(api: BankApi, accessToken: string, cursor?: string): Promise<SyncPayload> {
  const added: PlaidTransaction[] = [];
  const modified: PlaidTransaction[] = [];
  const removed: { transaction_id: string }[] = [];
  let next = cursor;
  let has_more = true;
  // A bank with years of history still finishes; the guard is for a server that
  // never stops saying "more".
  for (let page = 0; page < 40 && has_more; page++) {
    const body: Record<string, unknown> = { access_token: accessToken, count: 500 };
    if (next) body.cursor = next;
    const result = await call<SyncPayload>(api, 'sync', body);
    added.push(...(result.added ?? []));
    modified.push(...(result.modified ?? []));
    removed.push(...(result.removed ?? []));
    next = result.next_cursor;
    has_more = !!result.has_more;
  }
  return { added, modified, removed, next_cursor: next ?? '', has_more: false };
}
