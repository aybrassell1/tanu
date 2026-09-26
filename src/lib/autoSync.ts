/**
 * Catching up with your banks when you open the app.
 *
 * There is no server to wake up and poll for you, so this is the honest
 * version of automatic: the moment the app opens, anything that arrived since
 * last time is fetched, filed using your own category habits, and told to you.
 * Nothing is fetched while you are elsewhere, and nothing here can lose data —
 * a sync is one commit and one undo, the same as pressing the button yourself.
 */

import { useEffect, useRef } from 'react';

import { planSync } from '@/domain/plaidSync';
import type { BankConnection, LedgerData } from '@/domain/types';
import { PlaidError, syncAll, type BankApi } from '@/lib/plaid';
import { useLedgerStore, ledger } from '@/store/ledger';

/** How stale a connection has to be before opening the app goes and looks. */
const STALE_HOURS = 4;
/** Don't try again this soon after a failure; a bank that is down stays down. */
const RETRY_MINUTES = 30;

export interface AutoSyncOutcome {
  connection: BankConnection;
  added: number;
  /** Rows that were found but left for you, when adding automatically is off. */
  waiting: number;
  error?: string;
}

/** Whether a connection is worth asking about right now. */
function due(connection: BankConnection, now: number): boolean {
  if (connection.needsAttention) return false;
  if (!connection.lastSyncedAt) return true;
  const since = now - Date.parse(connection.lastSyncedAt);
  return Number.isFinite(since) ? since > STALE_HOURS * 3_600_000 : true;
}

/** One pass over every bank that is due. Pure orchestration; the store does the writing. */
export async function runAutoSync(data: LedgerData, now = Date.now()): Promise<AutoSyncOutcome[]> {
  const api = data.settings.bankApi as BankApi | undefined;
  if (!api?.url || !api.key) return [];
  const autoAdd = data.settings.autoSync?.autoAdd ?? true;
  const outcomes: AutoSyncOutcome[] = [];

  for (const connection of data.connections) {
    if (!due(connection, now)) continue;
    // An account nobody has pointed at a real one has nothing to give.
    if (!connection.accounts.some((a) => a.accountId)) continue;

    try {
      const payload = await syncAll(api, connection.accessToken, connection.cursor);
      // Always read the freshest ledger: an earlier bank in this loop may have
      // just written, and planning against a stale copy would duplicate rows.
      const current = useLedgerStore.getState().data;
      const plan = planSync(current, connection.id, payload);
      const drafts = plan.rows.filter((r) => r.draft);

      if (!autoAdd) {
        outcomes.push({ connection, added: 0, waiting: drafts.length });
        continue;
      }

      const result = ledger.applySync(connection.id, {
        add: drafts.filter((r) => !r.replaces).map((r) => r.draft!),
        replace: drafts.filter((r) => r.replaces).map((r) => ({ id: r.replaces!, with: r.draft! })),
        removeIds: plan.removed,
        cursor: payload.next_cursor,
      });
      outcomes.push({ connection, added: result.ok ? result.id : 0, waiting: 0 });
    } catch (e) {
      const message = e instanceof PlaidError ? e.message : 'Could not reach your bank.';
      // Only a broken login is worth interrupting you about; everything else
      // is a bad minute on someone's network and will pass.
      if (e instanceof PlaidError && e.code === 'ITEM_LOGIN_REQUIRED') {
        ledger.flagConnection(connection.id, 'Your bank ended the connection. Reconnect to keep syncing.');
      }
      outcomes.push({ connection, added: 0, waiting: 0, error: message });
    }
  }
  return outcomes;
}

/**
 * Runs a catch-up once the ledger is in, then leaves you alone. `onDone` gets
 * whatever happened, so the app can say so without this module knowing how.
 */
export function useAutoSync(onDone: (outcomes: AutoSyncOutcome[]) => void) {
  const hydrated = useLedgerStore((s) => s.hydrated);
  const connections = useLedgerStore((s) => s.data.connections.length);
  const enabled = useLedgerStore((s) => s.data.settings.autoSync?.onOpen ?? true);
  const attempted = useRef(0);
  const report = useRef(onDone);
  report.current = onDone;

  useEffect(() => {
    if (!hydrated || !enabled || connections === 0) return;
    const now = Date.now();
    // Once per launch, and never again straight after a failure.
    if (attempted.current && now - attempted.current < RETRY_MINUTES * 60_000) return;
    attempted.current = now;

    let cancelled = false;
    void runAutoSync(useLedgerStore.getState().data, now).then((outcomes) => {
      if (!cancelled && outcomes.length) report.current(outcomes);
    });
    return () => {
      cancelled = true;
    };
  }, [hydrated, enabled, connections]);
}

/** What to say about a pass, or nothing when there is nothing to say. */
export function summarize(outcomes: AutoSyncOutcome[]): string | null {
  const added = outcomes.reduce((n, o) => n + o.added, 0);
  const waiting = outcomes.reduce((n, o) => n + o.waiting, 0);
  const broken = outcomes.filter((o) => o.error);
  if (added > 0) return added === 1 ? 'Added 1 new transaction from your bank' : `Added ${added} new transactions from your bank`;
  if (waiting > 0) return waiting === 1 ? '1 transaction is waiting for you' : `${waiting} transactions are waiting for you`;
  if (broken.length === outcomes.length && broken.length > 0) return broken[0].error ?? null;
  return null;
}
