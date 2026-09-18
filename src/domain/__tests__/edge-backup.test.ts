import { describe, expect, it } from 'vitest';

import { backupFileName, integrityWarnings, parseBackup, serializeBackup, transactionsCsv, transactionsFileName } from '../backup';
import { addDays, isValidISODate, monthOf, todayISO } from '../dates';
import { debtLines } from '../debt';
import { emptyFilters, filterTransactions } from '../filters';
import { emptyLedger, SCHEMA_VERSION } from '../factory';
import { buildForecast } from '../forecast';
import { allocationsByAccount, goalProgress } from '../goals';
import { balanceOn, indexLedger } from '../ledger';
import { netWorthOn, spendingPosition } from '../position';
import { allocatedAmounts } from '../goals';
import { monthlyReview, periodStats } from '../reports';
import { buildSampleLedger } from '../sample';
import { compareScenario } from '../scenarios';
import { openEvents, scheduledEvents } from '../schedule';
import { searchLedger } from '../search';
import type { Account, LedgerData, Transaction } from '../types';
import { validateAccount, validateRecurring, validateTransaction } from '../validation';

const stamp = '2026-01-01T00:00:00.000Z';
const acct = (id: string, extra: Partial<Account> = {}): Account => ({ id, name: id, type: 'checking', startingBalance: 1_000, startingDate: '2026-01-01', color: '#000', icon: 'x', tags: [], archived: false, createdAt: stamp, updatedAt: stamp, ...extra });
const tx = (p: Partial<Transaction>): Transaction => ({ id: 't', type: 'expense', amount: 100, date: '2026-09-01', description: 'x', accountId: 'a', tags: [], attachments: [], createdAt: stamp, updatedAt: stamp, ...p });

describe('parseBackup', () => {
  it('accepts raw LedgerData without the wrapper and fills missing arrays', () => {
    const r = parseBackup(JSON.stringify({ accounts: [acct('a')], transactions: [tx({})] }));
    expect(r.data.accounts).toHaveLength(1);
    expect(r.data.goals).toEqual([]);
    expect(r.data.categories.length).toBeGreaterThan(10);
    expect(r.data.meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(r.data.meta.onboarded).toBe(true);
    expect(r.data.settings.currency).toBe('USD');
    expect(r.warnings).toEqual([]);
    expect(balanceOn(indexLedger(r.data), 'a', '2026-09-30')).toBe(900);
  });

  it('rejects bad JSON, non-objects, missing accounts', () => {
    expect(() => parseBackup('{nope')).toThrow(/valid JSON/);
    expect(() => parseBackup('null')).toThrow(/doesn't look like/);
    expect(() => parseBackup('42')).toThrow(/doesn't look like/);
    expect(() => parseBackup('[]')).toThrow(/doesn't look like/);
    expect(() => parseBackup(JSON.stringify({ transactions: [] }))).toThrow(/doesn't look like/);
    expect(() => parseBackup(JSON.stringify({ format: 'masterfinance-backup', schemaVersion: 1 }))).toThrow(/doesn't look like/);
  });

  it('rejects a newer schema version (meta or wrapper)', () => {
    expect(() => parseBackup(JSON.stringify({ accounts: [], transactions: [], meta: { schemaVersion: SCHEMA_VERSION + 1 } }))).toThrow(/newer/);
    // BUG: the wrapper's own `schemaVersion` is ignored; a newer-format file whose data lacks
    // meta.schemaVersion is silently imported as v1. Fix in backup.ts parseBackup:
    //   if (file?.format === BACKUP_FORMAT && (file.schemaVersion ?? 0) > SCHEMA_VERSION) throw new Error('This backup was made by a newer version of the app.');
    expect(() =>
      parseBackup(JSON.stringify({ format: 'masterfinance-backup', schemaVersion: SCHEMA_VERSION + 1, exportedAt: stamp, data: { accounts: [], transactions: [] } })),
    ).toThrow(/newer/);
  });

  it('integrity warnings: duplicates and orphans', () => {
    const d = emptyLedger();
    d.accounts = [acct('a')];
    d.transactions = [tx({ id: 'x' }), tx({ id: 'x' }), tx({ id: 'y', accountId: 'gone' }), tx({ id: 'z', type: 'transfer', toAccountId: 'gone' }), tx({ id: 'w', amount: 1.5 })];
    d.recurring = [{ id: 'r', name: 'R', kind: 'bill', amount: 1, variable: false, frequency: { unit: 'month', interval: 1 }, startDate: '2026-01-01', accountId: 'gone', autopay: true, essential: true, active: true, skipped: [], tags: [], createdAt: stamp, updatedAt: stamp }];
    d.goalContributions = [{ id: 'c', goalId: 'nope', date: '2026-01-01', amount: 1, createdAt: stamp }];
    const w = integrityWarnings(d);
    expect(w).toHaveLength(5);
    expect(w[0]).toMatch(/^1 transactions share an id/);
    expect(w[1]).toMatch(/^2 transactions point to accounts/);
  });

  it('a transaction with an unknown type produces a warning instead of crashing', () => {
    const text = JSON.stringify({ accounts: [acct('a')], transactions: [tx({ type: 'bogus' as never })] });
    // BUG: integrityWarnings calls indexLedger first; postingsFor has no default branch and returns
    // undefined for an unknown type, so `for (const p of postingsFor(...))` throws
    // "is not iterable" and the user gets a crash instead of the "unknown type" warning.
    // Fix in ledger.ts postingsFor: add `default: return [];` (and/or run the type check before indexing).
    expect(() => parseBackup(text)).not.toThrow();
  });

  it('records missing tags/attachments arrays do not crash search, filters or CSV', () => {
    const raw = { accounts: [acct('a')], transactions: [{ id: 't', type: 'expense', amount: 100, date: '2026-09-01', description: 'x', accountId: 'a', createdAt: stamp, updatedAt: stamp }] };
    const { data, warnings } = parseBackup(JSON.stringify(raw));
    // BUG: parseBackup only checks top-level arrays; per-record required arrays (tags, attachments,
    // skipped, valuations, linkedAccountIds, amounts) are not defaulted or warned about, so
    // transactionsCsv / searchLedger / filterTransactions throw on `t.tags.map` / `t.attachments.length`.
    // Fix in backup.ts parseBackup: normalise records, e.g.
    //   data.transactions = data.transactions.map((t) => ({ ...t, tags: Array.isArray(t.tags) ? t.tags : [], attachments: Array.isArray(t.attachments) ? t.attachments : [] }));
    expect(warnings).toEqual([]);
    expect(() => transactionsCsv(data)).not.toThrow();
    expect(() => searchLedger(data, 'x')).not.toThrow();
    expect(() => filterTransactions(data, { ...emptyFilters(), receiptsOnly: true }, '2026-09-16')).not.toThrow();
  });

  it('round trip preserves everything', () => {
    const d = buildSampleLedger('2026-09-16');
    const r = parseBackup(serializeBackup(d));
    expect(r.warnings).toEqual([]);
    expect(r.data.accounts).toEqual(d.accounts);
    expect(r.data.recurring).toEqual(d.recurring);
    expect(r.data.goalContributions).toEqual(d.goalContributions);
    expect(r.data.settings).toEqual(d.settings);
    expect(r.counts.transactions).toBe(d.transactions.length);
  });
});

describe('transactionsCsv', () => {
  const parseCsv = (text: string) => {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    row.push(cell);
    rows.push(row);
    return rows;
  };

  it('escapes quotes, commas and newlines', () => {
    const d = emptyLedger();
    d.accounts = [acct('a', { name: 'Chase, "Main"' })];
    d.transactions = [tx({ description: 'Dinner, "fancy"', payee: 'Line1\nLine2', notes: 'a,b\n"c"', tags: ['x', 'y'], amount: 12_345, categoryId: 'food.restaurants', essential: false })];
    const rows = parseCsv(transactionsCsv(d));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(['2026-09-01', 'Expense', '123.45', 'Dinner, "fancy"', 'Line1\nLine2', 'Food & drink › Restaurants', 'Chase, "Main"', '', 'No', '', '#x #y', 'a,b\n"c"']);
  });

  it('quotes carriage returns too', () => {
    const d = emptyLedger();
    d.accounts = [acct('a')];
    d.transactions = [tx({ description: 'one\rtwo' })];
    // BUG (minor): csvCell only quotes on [",\n]; a bare "\r" is emitted unquoted, which Excel and
    // RFC 4180 parsers treat as a line break. Fix in backup.ts: /[",\r\n]/.test(s)
    expect(transactionsCsv(d).split('\n')[1]).toContain('"one\rtwo"');
  });
});

// ─── Export file names ───────────────────────────────────────────────────────

describe('export file names', () => {
  /** 17 Sep 2026, 9:30pm — the UTC date is already the 18th east of the meridian. */
  const lateEvening = new Date(2026, 8, 17, 21, 30);

  it('uses the local calendar date, not the UTC one', () => {
    expect(backupFileName(lateEvening)).toBe('tanu-backup-2026-09-17-21-30.json');
    expect(transactionsFileName(lateEvening)).toBe('tanu-transactions-2026-09-17.csv');
  });

  it('agrees with the date the app calls today', () => {
    for (const at of [new Date(2026, 0, 1, 0, 5), new Date(2026, 11, 31, 23, 59), lateEvening]) {
      expect(backupFileName(at)).toContain(todayISO(at));
      expect(transactionsFileName(at)).toContain(todayISO(at));
      expect(isValidISODate(transactionsFileName(at).slice('tanu-transactions-'.length, -'.csv'.length))).toBe(true);
    }
  });
});

// ─── Sample ledger across dates ──────────────────────────────────────────────

const TODAYS = ['2026-01-01', '2026-09-16', '2028-02-29', '2026-12-31', '2027-03-31', '2026-03-01', '2027-06-15', '2029-08-02'];

function hasNaN(value: unknown, path = ''): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? null : path;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = hasNaN(value[i], `${path}[${i}]`);
      if (r) return r;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'ratio' || k === 'savingsRate') continue; // may legitimately be Infinity
      const r = hasNaN(v, `${path}.${k}`);
      if (r) return r;
    }
  }
  return null;
}

describe.each(TODAYS)('sample ledger @ %s', (today) => {
  const d: LedgerData = buildSampleLedger(today);
  const i = indexLedger(d);

  it('checking never negative over its history', () => {
    let lowest = Infinity;
    let at = '';
    const acc = d.accounts.find((a) => a.id === 'acc_checking')!;
    for (let date = acc.startingDate; date <= today; date = addDays(date, 1)) {
      const b = balanceOn(i, 'acc_checking', date);
      if (b < lowest) { lowest = b; at = date; }
    }
    expect({ lowest: lowest >= 0, at }).toEqual({ lowest: true, at });
  });

  it('every transaction, account and recurring item validates', () => {
    const bad = d.transactions.map((t) => ({ t, e: validateTransaction(d, t) })).filter((x) => Object.keys(x.e).length);
    expect(bad.map((x) => [x.t.description, x.t.date, x.e])).toEqual([]);
    for (const a of d.accounts) expect(validateAccount(a)).toEqual({});
    for (const r of d.recurring) expect(validateRecurring(d, r)).toEqual({});
    for (const t of d.transactions) {
      expect(Number.isInteger(t.amount)).toBe(true);
      expect(isValidISODate(t.date)).toBe(true);
    }
  });

  it('no transaction is dated before its accounts started', () => {
    const early = d.transactions.filter((t) => {
      const from = i.accounts.get(t.accountId)!;
      const to = t.toAccountId ? i.accounts.get(t.toAccountId) : undefined;
      return t.date < from.startingDate || (to && t.date < to.startingDate);
    });
    expect(early.length).toBe(0);
  });

  it('savings never over-allocated on any day', () => {
    for (let date = d.accounts[0].startingDate; date <= today; date = addDays(date, 7)) {
      for (const a of allocationsByAccount(d, date).values()) expect(a.overAllocated).toBe(false);
    }
    for (const a of allocationsByAccount(d, today).values()) expect(a.overAllocated).toBe(false);
  });

  it('statement balances are sane', () => {
    for (const a of d.accounts.filter((x) => x.statementClosingDay)) {
      expect(a.statementBalance).toBeGreaterThanOrEqual(0);
      expect(a.statementBalance!).toBeLessThanOrEqual(a.creditLimit!);
      expect(Number.isInteger(a.statementBalance)).toBe(true);
    }
    for (const a of d.accounts.filter((x) => x.creditLimit)) {
      expect(balanceOn(i, a.id, today)).toBeLessThanOrEqual(a.creditLimit!);
    }
  });

  it('recurring occurrences are settled at most once; no duplicate schedule events', () => {
    const seen = new Set<string>();
    for (const t of d.transactions) {
      if (!t.recurringId) continue;
      const key = `${t.recurringId}:${t.occurrenceDate}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    const events = scheduledEvents(d, { from: addDays(today, -60), to: addDays(today, 60), today });
    const keys = events.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('derived views have no NaN and reconcile', () => {
    const f = buildForecast(d, { today, to: addDays(today, 60) });
    expect(f.end).toBe(f.start + f.totalIn - f.totalOut);
    const pos = spendingPosition(d, today, allocatedAmounts(d, today));
    expect(pos.available).toBe(pos.spendableCash - pos.committed - pos.setAside - pos.buffer);
    const nw = netWorthOn(d, today);
    expect(nw.netWorth).toBe(nw.assets - nw.liabilities);
    const review = monthlyReview(d, monthOf(today), today);
    const stats = periodStats(d, `${today.slice(0, 4)}-01-01`, today);
    const cmp = compareScenario(d, d.scenarios[0].changes, 24, today);
    const goals = d.goals.map((g) => goalProgress(d, g, today));
    const all = { f, pos, nw, review, stats, cmp, goals, debt: debtLines(d, today), open: openEvents(d, today, addDays(today, 30)) };
    expect(hasNaN(all)).toBeNull();
  });
});
