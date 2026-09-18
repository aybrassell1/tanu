/**
 * CSV import of bank and card statements.
 *
 * Pure and fully local: nothing in here touches the network or the store. The
 * pipeline is three steps the UI can show between:
 *
 *   parseCsv(text)                  → { headers, rows }        (text → grid)
 *   guessMapping(headers, rows)     → ColumnMapping            (which column is what)
 *   parseRows(rows, mapping, opts)  → { drafts, skipped, errors }
 *
 * Money stays in integer cents and dates stay `YYYY-MM-DD`, like everywhere
 * else. Nothing throws on malformed input: a bad row becomes a `RowError` with
 * a sentence the user can act on.
 */

import { accountNature } from './catalog';
import { categoryPath } from './categories';
import { daysInMonth, diffDays, isValidISODate, toISODate } from './dates';
import { indexLedger } from './ledger';
import { categoryFor, merchantProfiles } from './merchants';
import { merchantKey, normalizeDescription, similarDescription } from './merchantText';
import type { Cents, CategoryKind, ID, ISODate, LedgerData, Transaction, TransactionType } from './types';

export { merchantKey, normalizeDescription, similarDescription } from './merchantText';

// ─── 1. The grid ─────────────────────────────────────────────────────────────

export type CsvTable = {
  headers: string[];
  rows: string[][];
  /** The separator that was detected, for the UI to mention if it looks wrong. */
  delimiter: string;
  /** True when the file had no header line and headers were invented. */
  headerless: boolean;
};

const DELIMITERS = [',', ';', '\t', '|'];

/** Counts separators outside quotes on the first line, to pick the delimiter. */
function detectDelimiter(text: string): string {
  let best = ',';
  let bestCount = 0;
  for (const d of DELIMITERS) {
    let count = 0;
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') quoted = !quoted;
      else if (!quoted && (c === '\n' || c === '\r')) break;
      else if (!quoted && c === d) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/**
 * RFC4180-ish reader: quoted fields, embedded delimiters, newlines and doubled
 * quotes, `\r\n` / `\r` / `\n` line endings, and a leading byte-order mark.
 */
export function parseCsv(text: string): CsvTable {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = detectDelimiter(src);
  const grid: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    grid.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        // A doubled quote is a literal quote; a single one closes the field.
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field.trim() === '') {
      quoted = true;
      field = '';
    } else if (c === delimiter) endField();
    else if (c === '\n') endRow();
    else if (c === '\r') {
      if (src[i + 1] === '\n') i++;
      endRow();
    } else field += c;
  }
  if (field !== '' || row.length > 0 || quoted) endRow();

  const filled = grid.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (filled.length === 0) return { headers: [], rows: [], delimiter, headerless: false };

  const first = filled[0].map((c) => c.trim());
  // Amex and a few others export without a header line.
  const headerless = looksLikeDataRow(first);
  if (headerless) {
    const width = Math.max(...filled.map((r) => r.length));
    return { headers: Array.from({ length: width }, (_, i) => `Column ${i + 1}`), rows: filled, delimiter, headerless: true };
  }
  return { headers: first, rows: filled.slice(1), delimiter, headerless: false };
}

/** A row is data (not a header) when one cell is a date and another is an amount. */
function looksLikeDataRow(cells: string[]): boolean {
  const dates = cells.filter((c) => parseCsvDate(c, 'mdy') !== null).length;
  const amounts = cells.filter((c) => parseAmount(c) !== null).length;
  return dates >= 1 && amounts >= 1;
}

// ─── 2. Values ───────────────────────────────────────────────────────────────

/** Which way round an ambiguous numeric date is written. */
export type DateFormat = 'iso' | 'mdy' | 'dmy';

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const yearOf = (n: number) => (n >= 100 ? n : n >= 69 ? 1900 + n : 2000 + n);

function build(year: number, month: number, day: number): ISODate | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  const iso = toISODate(year, month, day);
  return isValidISODate(iso) ? iso : null;
}

/**
 * Reads a statement date. `format` decides the ambiguous `01/02/2026` case, but
 * an impossible reading (month 13) is swapped rather than rejected.
 */
export function parseCsvDate(raw: string, format: DateFormat = 'mdy'): ISODate | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  // Drop a trailing time ("2026-01-05T00:00:00", "01/05/2026 14:03").
  const text = value.replace(/[T\s]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*([AaPp]\.?[Mm]\.?)?[A-Za-z+\-0-9:]*\s*$/, '').trim();

  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (iso) return build(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const named = /^(\d{1,2})[-\s/]([A-Za-z]{3,})[-\s/](\d{2,4})$/.exec(text) ?? /^([A-Za-z]{3,})[-\s/](\d{1,2}),?[-\s/](\d{2,4})$/.exec(text);
  if (named) {
    const monthFirst = /^[A-Za-z]/.test(named[1]);
    const monthText = (monthFirst ? named[1] : named[2]).slice(0, 3).toLowerCase();
    const dayText = monthFirst ? named[2] : named[1];
    const month = MONTH_NAMES.indexOf(monthText) + 1;
    if (month === 0) return null;
    return build(yearOf(Number(named[3])), month, Number(dayText));
  }

  const parts = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(text);
  if (!parts) return null;
  const a = Number(parts[1]);
  const b = Number(parts[2]);
  const year = yearOf(Number(parts[3]));
  let month = format === 'dmy' ? b : a;
  let day = format === 'dmy' ? a : b;
  // Forgive a wrong guess when only one reading is possible.
  if (month > 12 && day <= 12) [month, day] = [day, month];
  return build(year, month, day);
}

/**
 * Reads an amount in cents. Handles `$`, thousands separators, `(123.45)` and a
 * trailing `-` for negatives, unicode minus signs and decimal commas.
 */
export function parseAmount(raw: string): Cents | null {
  let s = (raw ?? '').trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s
    .replace(/[−‒–—]/g, '-')
    .replace(/(?:usd|cad|eur|gbp|aud|nzd|chf|mxn)/gi, '')
    .replace(/[$€£¥₹\s]/g, '')
    .trim();
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  // "1.234,56" and "1234,56" use a decimal comma; "1,234" is a thousands group.
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;

  const [whole, frac = ''] = s.split('.');
  const cents = frac.length <= 2 ? Number(whole) * 100 + Number(frac.padEnd(2, '0')) : Math.round(Number(s) * 100);
  if (!Number.isFinite(cents)) return null;
  return negative && cents !== 0 ? -cents : cents;
}

// ─── 3. Mapping ──────────────────────────────────────────────────────────────

export type MappedField = 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'category' | 'notes' | 'balance';

/** Single amount column, or separate debit / credit columns. */
export type AmountMode = 'single' | 'debitCredit';

/** In a single amount column, which sign means money leaving. */
export type SignConvention = 'negativeIsSpending' | 'positiveIsSpending';

export type ColumnMapping = {
  /** Column index, or null when the file has no such column. */
  date: number | null;
  description: number | null;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  category: number | null;
  notes: number | null;
  balance: number | null;
  dateFormat: DateFormat;
  amountMode: AmountMode;
  signConvention: SignConvention;
};

export const EMPTY_MAPPING: ColumnMapping = {
  date: null,
  description: null,
  amount: null,
  debit: null,
  credit: null,
  category: null,
  notes: null,
  balance: null,
  dateFormat: 'mdy',
  amountMode: 'single',
  signConvention: 'negativeIsSpending',
};

/** Header phrases per field, most specific first; earlier entries score higher. */
const HEADER_HINTS: Record<MappedField, string[]> = {
  date: ['transaction date', 'trans date', 'transactiondate', 'posted date', 'post date', 'posting date', 'value date', 'date'],
  description: ['description', 'payee', 'merchant', 'merchant name', 'name', 'transaction description', 'details', 'narrative', 'reference', 'memo/description'],
  amount: ['transaction amount', 'amount', 'amt', 'value'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'money out', 'paid out', 'charges'],
  credit: ['credit', 'deposit', 'deposits', 'money in', 'paid in'],
  category: ['category', 'categorie', 'transaction category'],
  notes: ['memo', 'note', 'notes', 'comment', 'comments', 'extended details'],
  balance: ['running balance', 'balance after transaction', 'balance'],
};

/** Headers that must never be taken for another field ("Debit/Credit" flag columns). */
const EXACT_BLOCK: Record<MappedField, string[]> = {
  date: [],
  description: ['transaction type', 'type'],
  amount: [],
  debit: ['debit/credit', 'debit or credit'],
  credit: ['debit/credit', 'debit or credit'],
  category: ['type'],
  notes: [],
  balance: [],
};

function headerScore(header: string, field: MappedField): number {
  const h = header.trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ');
  if (!h) return 0;
  if (EXACT_BLOCK[field].includes(h)) return 0;
  const hints = HEADER_HINTS[field];
  for (const [i, hint] of hints.entries()) {
    const weight = hints.length - i;
    if (h === hint) return 100 + weight;
    if (h.includes(hint)) return 50 + weight;
  }
  return 0;
}

const column = (rows: string[][], index: number) => rows.map((r) => (r[index] ?? '').trim());

const share = (values: string[], test: (v: string) => boolean) => {
  const filled = values.filter((v) => v !== '');
  return filled.length ? filled.filter(test).length / filled.length : 0;
};

/**
 * Guesses which column is which from the headers, falling back to the shape of
 * the data (dates look like dates, amounts like amounts) when headers are
 * missing or unhelpful. Also guesses the date format and the sign convention.
 */
export function guessMapping(headers: string[], sampleRows: string[][] = []): ColumnMapping {
  const rows = sampleRows.slice(0, 50);
  const mapping: ColumnMapping = { ...EMPTY_MAPPING };
  const used = new Set<number>();

  const claim = (field: MappedField, index: number | null) => {
    if (index === null) return;
    mapping[field] = index;
    used.add(index);
  };

  const byHeader = (field: MappedField): number | null => {
    let best: number | null = null;
    let bestScore = 0;
    for (const [i, h] of headers.entries()) {
      if (used.has(i)) continue;
      const s = headerScore(h, field);
      if (s > bestScore) {
        best = i;
        bestScore = s;
      }
    }
    return best;
  };

  // Date first: it is the least ambiguous and frees the column for the rest.
  let date = byHeader('date');
  if (date === null) {
    let bestShare = 0;
    for (const [i] of headers.entries()) {
      if (used.has(i)) continue;
      const s = share(column(rows, i), (v) => parseCsvDate(v) !== null);
      if (s > 0.6 && s > bestShare) {
        bestShare = s;
        date = i;
      }
    }
  }
  claim('date', date);

  claim('balance', byHeader('balance'));
  const debit = byHeader('debit');
  const credit = byHeader('credit');
  if (debit !== null || credit !== null) {
    claim('debit', debit);
    claim('credit', credit);
    mapping.amountMode = 'debitCredit';
  }

  let amount = byHeader('amount');
  if (amount === null && mapping.amountMode === 'single') {
    let bestShare = 0;
    for (const [i] of headers.entries()) {
      if (used.has(i)) continue;
      const s = share(column(rows, i), (v) => parseAmount(v) !== null);
      if (s > 0.8 && s > bestShare) {
        bestShare = s;
        amount = i;
      }
    }
  }
  claim('amount', amount);
  if (mapping.amount === null && mapping.amountMode === 'single' && (mapping.debit !== null || mapping.credit !== null)) mapping.amountMode = 'debitCredit';

  claim('category', byHeader('category'));
  let description = byHeader('description');
  if (description === null) {
    // The remaining column with the most text in it.
    let bestLength = 0;
    for (const [i] of headers.entries()) {
      if (used.has(i)) continue;
      const values = column(rows, i);
      const textShare = share(values, (v) => /[a-z]{3}/i.test(v));
      const avg = values.length ? values.reduce((t, v) => t + v.length, 0) / values.length : 0;
      if (textShare > 0.5 && avg > bestLength) {
        bestLength = avg;
        description = i;
      }
    }
  }
  claim('description', description);
  claim('notes', byHeader('notes'));

  mapping.dateFormat = guessDateFormat(mapping.date === null ? [] : column(rows, mapping.date));
  if (mapping.amountMode === 'single' && mapping.amount !== null) {
    const values = column(rows, mapping.amount).map(parseAmount).filter((c): c is number => c !== null);
    // Statements that never show a negative put charges in as positive numbers.
    mapping.signConvention = values.some((c) => c < 0) ? 'negativeIsSpending' : 'positiveIsSpending';
  }
  return mapping;
}

/** ISO wins outright; otherwise a day above 12 in the first slot means D/M/Y. */
export function guessDateFormat(values: string[]): DateFormat {
  const parts = values
    .map((v) => /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec((v ?? '').trim()))
    .filter((m): m is RegExpExecArray => m !== null);
  const isoish = values.filter((v) => /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test((v ?? '').trim())).length;
  if (isoish > parts.length) return 'iso';
  if (parts.some((m) => Number(m[1]) > 12)) return 'dmy';
  return 'mdy';
}

// ─── 4. Drafts ───────────────────────────────────────────────────────────────

export type DraftTransaction = {
  /** 1-based position among the file's data rows, for error messages. */
  row: number;
  type: Extract<TransactionType, 'expense' | 'income' | 'refund'>;
  /** Always positive, like every stored transaction. */
  amount: Cents;
  date: ISODate;
  description: string;
  accountId: ID;
  categoryId?: ID;
  /** Where the category came from: the file's own column, or past transactions. */
  categorySource?: 'file' | 'learned';
  notes?: string;
  /**
   * An existing transaction this looks like, or `row:<n>` for an earlier row of
   * the same file. Set means the UI should default the row to "skip".
   */
  duplicateOf?: ID;
  duplicateScope?: 'existing' | 'file';
  raw: string[];
};

export type RowError = { row: number; message: string; raw: string[] };

export type ParseResult = {
  drafts: DraftTransaction[];
  /** Rows deliberately ignored: blank lines, repeated headers, zero amounts. */
  skipped: number;
  errors: RowError[];
};

export type ParseOptions = {
  /** The account every imported row belongs to. */
  accountId: ID;
  /** Used for duplicate detection, category matching and learned categories. */
  data?: LedgerData;
  /** Learn a category from past transactions with the same merchant. */
  autoCategorize?: boolean;
};

const MONEY_IN: DraftTransaction['type'][] = ['income', 'refund'];

const cell = (row: string[], index: number | null) => (index === null ? '' : (row[index] ?? '').trim());

/**
 * Turns grid rows into draft transactions, flagging duplicates against both the
 * existing ledger and earlier rows of the same file. Never throws.
 */
export function parseRows(rows: string[][], mapping: ColumnMapping, options: ParseOptions): ParseResult {
  const { accountId, data, autoCategorize = true } = options;
  const drafts: DraftTransaction[] = [];
  const errors: RowError[] = [];
  let skipped = 0;

  const account = data?.accounts.find((a) => a.id === accountId);
  const liability = account ? accountNature(account.type) === 'liability' : false;
  const categoryLookup = data ? buildCategoryLookup(data) : new Map<string, { id: ID; kind: string }>();
  const learned = data && autoCategorize ? learnCategories(data) : () => undefined;
  const existing = data ? existingCandidates(data, accountId) : [];

  for (const [i, raw] of rows.entries()) {
    const row = i + 1;
    if (raw.every((c) => (c ?? '').trim() === '')) {
      skipped++;
      continue;
    }

    const dateText = cell(raw, mapping.date);
    const description = cell(raw, mapping.description);
    // A repeated header line inside the file is not an error.
    if (mapping.date !== null && dateText !== '' && parseCsvDate(dateText, mapping.dateFormat) === null && headerish(raw, mapping)) {
      skipped++;
      continue;
    }

    if (mapping.date === null) {
      errors.push({ row, message: 'No date column is selected.', raw });
      continue;
    }
    const date = parseCsvDate(dateText, mapping.dateFormat);
    if (!date) {
      errors.push({ row, message: dateText ? `Could not read the date "${dateText}".` : 'This row has no date.', raw });
      continue;
    }

    const signed = readAmount(raw, mapping);
    if (signed === null) {
      const shown = mapping.amountMode === 'single' ? cell(raw, mapping.amount) : `${cell(raw, mapping.debit)} / ${cell(raw, mapping.credit)}`;
      errors.push({ row, message: shown.trim() && shown.trim() !== '/' ? `Could not read the amount "${shown}".` : 'This row has no amount.', raw });
      continue;
    }
    if (signed === 0) {
      skipped++;
      continue;
    }

    if (!description.trim()) {
      errors.push({ row, message: 'This row has no description, so there would be nothing to recognise it by.', raw });
      continue;
    }

    const moneyIn = signed > 0;
    // Credits on a card reduce what you owe; recording them as income would
    // invent money that never entered an asset account.
    const type: DraftTransaction['type'] = moneyIn ? (liability ? 'refund' : 'income') : 'expense';
    const amount = Math.abs(signed);
    const notes = cell(raw, mapping.notes) || undefined;

    const draft: DraftTransaction = { row, type, amount, date, description, accountId, notes, raw };

    const fileCategory = cell(raw, mapping.category);
    const wanted = type === 'income' ? 'income' : 'expense';
    const matched = fileCategory ? categoryLookup.get(normalizeDescription(fileCategory)) : undefined;
    if (matched && matched.kind === wanted) {
      draft.categoryId = matched.id;
      draft.categorySource = 'file';
    } else if (autoCategorize) {
      const guess = learned(merchantKey(description), wanted);
      if (guess) {
        draft.categoryId = guess;
        draft.categorySource = 'learned';
      }
    }

    const dupe = findDuplicate(draft, existing, drafts);
    if (dupe) {
      draft.duplicateOf = dupe.id;
      draft.duplicateScope = dupe.scope;
    }
    drafts.push(draft);
  }

  return { drafts, skipped, errors };
}

/** A row whose mapped cells are all non-numeric text is a repeated header. */
function headerish(raw: string[], mapping: ColumnMapping): boolean {
  const amounts = [mapping.amount, mapping.debit, mapping.credit].filter((i): i is number => i !== null);
  return amounts.every((i) => parseAmount((raw[i] ?? '').trim()) === null);
}

/** Signed cents in "money in is positive" terms, or null when unreadable. */
function readAmount(raw: string[], mapping: ColumnMapping): Cents | null {
  if (mapping.amountMode === 'debitCredit') {
    const debit = mapping.debit === null ? null : parseAmount(cell(raw, mapping.debit));
    const credit = mapping.credit === null ? null : parseAmount(cell(raw, mapping.credit));
    if (debit !== null && debit !== 0) return -Math.abs(debit);
    if (credit !== null && credit !== 0) return Math.abs(credit);
    if (debit === 0 || credit === 0) return 0;
    return null;
  }
  if (mapping.amount === null) return null;
  const value = parseAmount(cell(raw, mapping.amount));
  if (value === null) return null;
  return mapping.signConvention === 'positiveIsSpending' ? -value : value;
}

// ─── Categories learned from past transactions ───────────────────────────────

function buildCategoryLookup(data: LedgerData) {
  const map = new Map<string, { id: ID; kind: string }>();
  const index = indexLedger(data);
  for (const c of data.categories) {
    if (c.archived) continue;
    const entry = { id: c.id, kind: c.kind };
    // Both "Groceries" and "Food › Groceries" (however the export writes it).
    for (const key of [c.name, categoryPath(index.categories, c.id)]) {
      const normalized = normalizeDescription(key);
      if (normalized && !map.has(normalized)) map.set(normalized, entry);
    }
  }
  return map;
}

/**
 * The category you have used most for each merchant, for the kind of category
 * this row wants. `merchants.ts` decides what counts as a habit.
 */
function learnCategories(data: LedgerData): (key: string, kind: CategoryKind) => ID | undefined {
  const profiles = merchantProfiles(data);
  return (key, kind) => categoryFor(profiles.get(key), kind);
}

// ─── Duplicates ──────────────────────────────────────────────────────────────

type Candidate = { id: ID; date: ISODate; amount: Cents; text: string; moneyIn: boolean };

const INFLOW_TYPES: TransactionType[] = ['income', 'refund', 'reimbursement', 'investment_withdrawal'];

function existingCandidates(data: LedgerData, accountId: ID): Candidate[] {
  const out: Candidate[] = [];
  for (const t of data.transactions) {
    const here = t.accountId === accountId;
    const arriving = t.toAccountId === accountId;
    if (!here && !arriving) continue;
    if (t.type === 'adjustment') continue;
    out.push({
      id: t.id,
      date: t.date,
      amount: Math.abs(t.amount),
      text: `${t.payee ?? ''} ${t.description}`.trim(),
      moneyIn: arriving || INFLOW_TYPES.includes(t.type),
    });
  }
  return out;
}

const looksSame = (a: Candidate, b: Candidate) => a.amount === b.amount && a.moneyIn === b.moneyIn && Math.abs(diffDays(a.date, b.date)) <= 1 && similarDescription(a.text, b.text);

/**
 * Same account, same amount and direction, a date within a day and a
 * recognisably similar description. The file is checked against itself too, so
 * a statement that overlaps the previous export does not double up.
 */
function findDuplicate(draft: DraftTransaction, existing: Candidate[], earlier: DraftTransaction[]): { id: ID; scope: 'existing' | 'file' } | null {
  const me: Candidate = { id: '', date: draft.date, amount: draft.amount, text: draft.description, moneyIn: MONEY_IN.includes(draft.type) };
  for (const c of existing) if (looksSame(me, c)) return { id: c.id, scope: 'existing' };
  for (const d of earlier) {
    // A row already flagged as a copy is not itself the original.
    if (d.duplicateOf) continue;
    const other: Candidate = { id: `row:${d.row}`, date: d.date, amount: d.amount, text: d.description, moneyIn: MONEY_IN.includes(d.type) };
    if (looksSame(me, other)) return { id: other.id, scope: 'file' };
  }
  return null;
}

// ─── Handing drafts to the store ─────────────────────────────────────────────

export type NewTransaction = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>;

/** Shapes a draft the way `ledger.importTransactions` expects it. */
export function draftToTransaction(draft: DraftTransaction): NewTransaction {
  return {
    type: draft.type,
    amount: draft.amount,
    date: draft.date,
    description: draft.description,
    accountId: draft.accountId,
    categoryId: draft.categoryId,
    notes: draft.notes,
    tags: [],
    attachments: [],
  };
}

export type ImportSummary = {
  total: number;
  duplicates: number;
  selected: number;
  spendingCount: number;
  incomeCount: number;
  spending: Cents;
  income: Cents;
  /** Earliest and latest date among the selected rows. */
  from?: ISODate;
  to?: ISODate;
};

/** Counts for the confirmation line, over the rows the user has kept. */
export function summarize(drafts: DraftTransaction[], included: (d: DraftTransaction) => boolean): ImportSummary {
  const s: ImportSummary = { total: drafts.length, duplicates: 0, selected: 0, spendingCount: 0, incomeCount: 0, spending: 0, income: 0 };
  for (const d of drafts) {
    if (d.duplicateOf) s.duplicates++;
    if (!included(d)) continue;
    s.selected++;
    if (d.type === 'expense') {
      s.spendingCount++;
      s.spending += d.amount;
    } else {
      s.incomeCount++;
      s.income += d.amount;
    }
    if (!s.from || d.date < s.from) s.from = d.date;
    if (!s.to || d.date > s.to) s.to = d.date;
  }
  return s;
}
