import { describe, expect, it } from 'vitest';

import {
  draftToTransaction,
  guessDateFormat,
  guessMapping,
  merchantKey,
  parseAmount,
  parseCsv,
  parseCsvDate,
  parseRows,
  similarDescription,
  summarize,
  type ColumnMapping,
} from '../csvImport';
import { emptyLedger } from '../factory';
import type { Account, LedgerData, Transaction } from '../types';

const stamp = '2026-01-01T00:00:00.000Z';

const account = (p: Partial<Account> & Pick<Account, 'id' | 'type'>): Account => ({
  name: p.name ?? p.id,
  startingBalance: 500_000,
  startingDate: '2020-01-01',
  color: '#000',
  icon: 'credit-card',
  tags: [],
  archived: false,
  createdAt: stamp,
  updatedAt: stamp,
  ...p,
});

let seq = 0;
const tx = (p: Partial<Transaction> & Pick<Transaction, 'type' | 'amount'>): Transaction => ({
  id: `t${++seq}`,
  date: '2026-06-01',
  description: 'x',
  accountId: 'chk',
  tags: [],
  attachments: [],
  createdAt: stamp,
  updatedAt: stamp,
  ...p,
});

function ledger(): LedgerData {
  const d = emptyLedger();
  d.accounts = [account({ id: 'chk', type: 'checking', name: 'Everyday checking' }), account({ id: 'card', type: 'credit_card', name: 'Sapphire' })];
  return d;
}

// ─── parseCsv ────────────────────────────────────────────────────────────────

describe('parseCsv', () => {
  it('reads headers and rows with \\r\\n endings and a byte-order mark', () => {
    const table = parseCsv('﻿Date,Description,Amount\r\n2026-01-02,Coffee,-4.50\r\n2026-01-03,Pay,1200.00\r\n');
    expect(table.headers).toEqual(['Date', 'Description', 'Amount']);
    expect(table.rows).toEqual([
      ['2026-01-02', 'Coffee', '-4.50'],
      ['2026-01-03', 'Pay', '1200.00'],
    ]);
    expect(table.headerless).toBe(false);
    expect(table.delimiter).toBe(',');
  });

  it('keeps commas, newlines and doubled quotes inside quoted fields', () => {
    const table = parseCsv('Date,Description,Amount\n2026-01-02,"Joe\'s Bar, Grill",-4.50\n2026-01-03,"Line one\nline two",-1.00\n2026-01-04,"He said ""hi""",-2.00');
    expect(table.rows[0][1]).toBe("Joe's Bar, Grill");
    expect(table.rows[1][1]).toBe('Line one\nline two');
    expect(table.rows[2][1]).toBe('He said "hi"');
    expect(table.rows).toHaveLength(3);
  });

  it('drops blank lines and tolerates a missing final newline', () => {
    const table = parseCsv('Date,Amount\n\n2026-01-02,-4.50');
    expect(table.rows).toEqual([['2026-01-02', '-4.50']]);
  });

  it('detects semicolon and tab separated files', () => {
    expect(parseCsv('Date;Description;Amount\n2026-01-02;Coffee;-4,50').delimiter).toBe(';');
    expect(parseCsv('Date\tDescription\tAmount\n2026-01-02\tCoffee\t-4.50').rows[0][1]).toBe('Coffee');
  });

  it('invents headers when the file has no header row', () => {
    const table = parseCsv('01/02/2026,Coffee,4.50\n01/03/2026,Bagel,3.00');
    expect(table.headerless).toBe(true);
    expect(table.headers).toEqual(['Column 1', 'Column 2', 'Column 3']);
    expect(table.rows).toHaveLength(2);
  });

  it('returns an empty table for empty input instead of throwing', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [], delimiter: ',', headerless: false });
    expect(parseCsv('\n\n   \n').rows).toEqual([]);
  });
});

// ─── values ──────────────────────────────────────────────────────────────────

describe('parseAmount', () => {
  it('reads currency symbols, separators and negatives in every common shape', () => {
    expect(parseAmount('12.34')).toBe(1234);
    expect(parseAmount('$1,234.56')).toBe(123_456);
    expect(parseAmount('(42.10)')).toBe(-4210);
    expect(parseAmount('-$42.10')).toBe(-4210);
    expect(parseAmount('42.10-')).toBe(-4210);
    expect(parseAmount('−42.10')).toBe(-4210);
    expect(parseAmount('+9.00')).toBe(900);
    expect(parseAmount('1.234,56')).toBe(123_456);
    expect(parseAmount('4,50')).toBe(450);
    expect(parseAmount('1,234')).toBe(123_400);
    expect(parseAmount('12 USD')).toBe(1200);
    expect(parseAmount('0.00')).toBe(0);
    expect(parseAmount('($0.00)')).toBe(0);
  });

  it('rejects anything that is not a number', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('   ')).toBeNull();
    expect(parseAmount('n/a')).toBeNull();
    expect(parseAmount('12.34.56')).toBeNull();
    expect(parseAmount('--5')).toBeNull();
  });
});

describe('parseCsvDate', () => {
  it('reads ISO dates regardless of the chosen format', () => {
    expect(parseCsvDate('2026-01-05', 'iso')).toBe('2026-01-05');
    expect(parseCsvDate('2026/1/5', 'mdy')).toBe('2026-01-05');
    expect(parseCsvDate('2026-01-05T00:00:00', 'iso')).toBe('2026-01-05');
  });

  it('uses the mapping to settle the ambiguous day/month order', () => {
    expect(parseCsvDate('01/02/2026', 'mdy')).toBe('2026-01-02');
    expect(parseCsvDate('01/02/2026', 'dmy')).toBe('2026-02-01');
    expect(parseCsvDate('3/7/26', 'mdy')).toBe('2026-03-07');
  });

  it('swaps the parts when only one reading is possible', () => {
    expect(parseCsvDate('25/12/2026', 'mdy')).toBe('2026-12-25');
    expect(parseCsvDate('12/25/2026', 'dmy')).toBe('2026-12-25');
  });

  it('reads month names and two-digit years', () => {
    expect(parseCsvDate('05-Jan-2026')).toBe('2026-01-05');
    expect(parseCsvDate('Jan 5, 2026')).toBe('2026-01-05');
    expect(parseCsvDate('01/05/99')).toBe('1999-01-05');
  });

  it('rejects impossible and unreadable dates', () => {
    expect(parseCsvDate('02/30/2026', 'mdy')).toBeNull();
    expect(parseCsvDate('13/13/2026', 'mdy')).toBeNull();
    expect(parseCsvDate('')).toBeNull();
    expect(parseCsvDate('Pending')).toBeNull();
  });
});

describe('guessDateFormat', () => {
  it('picks dmy only when a first part cannot be a month', () => {
    expect(guessDateFormat(['01/02/2026', '03/04/2026'])).toBe('mdy');
    expect(guessDateFormat(['13/02/2026', '03/04/2026'])).toBe('dmy');
    expect(guessDateFormat(['2026-01-02', '2026-03-04'])).toBe('iso');
  });
});

describe('merchantKey and similarDescription', () => {
  it('reduces noisy statement text to the merchant', () => {
    expect(merchantKey("SQ *TRADER JOE'S #482 SAN FRA")).toBe('trader joes san fra');
    expect(merchantKey('TRADER JOE S #117')).toBe('trader joes');
    expect(similarDescription("SQ *TRADER JOE'S #482", "TRADER JOE'S #117")).toBe(true);
    expect(similarDescription('AMAZON MKTPL', 'Amazon Mktpl*2R44')).toBe(true);
    expect(similarDescription('Trader Joes', 'Shell Oil')).toBe(false);
    expect(similarDescription('', 'Shell Oil')).toBe(false);
  });
});

// ─── guessMapping ────────────────────────────────────────────────────────────

describe('guessMapping', () => {
  it('maps a Chase checking export', () => {
    const table = parseCsv(
      'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\nDEBIT,01/14/2026,"TRADER JOE S #482",-52.13,ACH_DEBIT,2431.02,\nCREDIT,01/15/2026,"ACME PAYROLL DIRECT DEP",1840.22,ACH_CREDIT,4271.24,',
    );
    const m = guessMapping(table.headers, table.rows);
    expect(table.headers[m.date!]).toBe('Posting Date');
    expect(table.headers[m.description!]).toBe('Description');
    expect(table.headers[m.amount!]).toBe('Amount');
    expect(table.headers[m.balance!]).toBe('Balance');
    expect(m.amountMode).toBe('single');
    expect(m.signConvention).toBe('negativeIsSpending');
    expect(m.dateFormat).toBe('mdy');
  });

  it('maps a Chase credit-card export with a category column', () => {
    const table = parseCsv(
      'Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n01/14/2026,01/15/2026,TRADER JOE S,Groceries,Sale,-52.13,\n01/16/2026,01/17/2026,PAYMENT THANK YOU,,Payment,200.00,',
    );
    const m = guessMapping(table.headers, table.rows);
    expect(table.headers[m.date!]).toBe('Transaction Date');
    expect(table.headers[m.category!]).toBe('Category');
    expect(table.headers[m.notes!]).toBe('Memo');
    // "Type" must not be mistaken for the description or the category.
    expect(table.headers[m.description!]).toBe('Description');
  });

  it('maps a Capital One export with separate debit and credit columns', () => {
    const table = parseCsv(
      'Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n2026-01-14,2026-01-15,1234,TRADER JOE S,Grocery,52.13,\n2026-01-16,2026-01-17,1234,PAYMENT,,,200.00',
    );
    const m = guessMapping(table.headers, table.rows);
    expect(m.amountMode).toBe('debitCredit');
    expect(table.headers[m.debit!]).toBe('Debit');
    expect(table.headers[m.credit!]).toBe('Credit');
    expect(m.amount).toBeNull();
    expect(m.dateFormat).toBe('iso');
  });

  it('maps an Amex style export with no header row and positive charges', () => {
    const table = parseCsv('01/14/2026,TRADER JOE S,52.13\n01/16/2026,SHELL OIL,41.00');
    const m = guessMapping(table.headers, table.rows);
    expect(m.date).toBe(0);
    expect(m.description).toBe(1);
    expect(m.amount).toBe(2);
    expect(m.signConvention).toBe('positiveIsSpending');
  });

  it('returns null columns rather than guessing wildly on an unrelated file', () => {
    const m = guessMapping(['Foo', 'Bar'], [['hello there', 'world wide']]);
    expect(m.date).toBeNull();
    expect(m.amount).toBeNull();
  });
});

// ─── parseRows ───────────────────────────────────────────────────────────────

const mapping = (p: Partial<ColumnMapping> = {}): ColumnMapping => ({
  date: 0,
  description: 1,
  amount: 2,
  debit: null,
  credit: null,
  category: null,
  notes: null,
  balance: null,
  dateFormat: 'mdy',
  amountMode: 'single',
  signConvention: 'negativeIsSpending',
  ...p,
});

describe('parseRows', () => {
  it('splits spending and income by sign and always stores positive cents', () => {
    const rows = [
      ['01/14/2026', 'Trader Joes', '-52.13'],
      ['01/15/2026', 'Acme Payroll', '1,840.22'],
    ];
    const { drafts, errors, skipped } = parseRows(rows, mapping(), { accountId: 'chk', data: ledger() });
    expect(errors).toEqual([]);
    expect(skipped).toBe(0);
    expect(drafts.map((d) => [d.type, d.amount, d.date])).toEqual([
      ['expense', 5213, '2026-01-14'],
      ['income', 184_022, '2026-01-15'],
    ]);
  });

  it('flips the sign convention for card exports where a charge is positive', () => {
    const rows = [['01/14/2026', 'Trader Joes', '52.13']];
    const spending = parseRows(rows, mapping({ signConvention: 'positiveIsSpending' }), { accountId: 'card', data: ledger() });
    expect(spending.drafts[0].type).toBe('expense');
    const income = parseRows(rows, mapping(), { accountId: 'chk', data: ledger() });
    expect(income.drafts[0].type).toBe('income');
  });

  it('reads separate debit and credit columns', () => {
    const rows = [
      ['2026-01-14', 'Trader Joes', '52.13', ''],
      ['2026-01-16', 'Payment', '', '200.00'],
    ];
    const { drafts } = parseRows(rows, mapping({ amount: null, debit: 2, credit: 3, amountMode: 'debitCredit', dateFormat: 'iso' }), { accountId: 'chk', data: ledger() });
    expect(drafts.map((d) => [d.type, d.amount])).toEqual([
      ['expense', 5213],
      ['income', 20_000],
    ]);
  });

  it('records money arriving on a credit card as a refund, never as income', () => {
    const rows = [['01/16/2026', 'Store credit', '200.00']];
    const { drafts } = parseRows(rows, mapping(), { accountId: 'card', data: ledger() });
    expect(drafts[0].type).toBe('refund');
  });

  it('reports a message per bad row and never throws', () => {
    const rows = [
      ['nope', 'Trader Joes', '-52.13'],
      ['01/15/2026', 'Trader Joes', 'n/a'],
      ['01/16/2026', '', '-5.00'],
      ['01/17/2026', 'Fine', '-5.00'],
      [],
      ['', '', ''],
      ['01/18/2026', 'Zero', '0.00'],
    ];
    const { drafts, errors, skipped } = parseRows(rows, mapping(), { accountId: 'chk', data: ledger() });
    expect(drafts).toHaveLength(1);
    expect(errors.map((e) => e.row)).toEqual([1, 2, 3]);
    expect(errors[0].message).toContain('"nope"');
    expect(errors[1].message).toContain('amount');
    // Blank lines and zero-amount rows are skipped quietly.
    expect(skipped).toBe(3);
  });

  it('skips a header line repeated inside the file', () => {
    const rows = [
      ['01/14/2026', 'Trader Joes', '-52.13'],
      ['Date', 'Description', 'Amount'],
      ['01/15/2026', 'Shell', '-41.00'],
    ];
    const { drafts, skipped, errors } = parseRows(rows, mapping(), { accountId: 'chk', data: ledger() });
    expect(drafts).toHaveLength(2);
    expect(skipped).toBe(1);
    expect(errors).toEqual([]);
  });

  it('errors on every row when no date column is chosen', () => {
    const { drafts, errors } = parseRows([['01/14/2026', 'Trader Joes', '-52.13']], mapping({ date: null }), { accountId: 'chk' });
    expect(drafts).toEqual([]);
    expect(errors[0].message).toContain('date column');
  });

  it('works without a ledger to compare against', () => {
    const { drafts } = parseRows([['01/14/2026', 'Trader Joes', '-52.13']], mapping(), { accountId: 'chk' });
    expect(drafts[0].duplicateOf).toBeUndefined();
  });
});

// ─── duplicates ──────────────────────────────────────────────────────────────

describe('duplicate detection', () => {
  it('flags a row that matches an existing transaction within a day', () => {
    const data = ledger();
    data.transactions = [tx({ id: 'old', type: 'expense', amount: 5213, date: '2026-01-15', description: "TRADER JOE'S #482", accountId: 'chk' })];
    const rows = [['01/14/2026', 'TRADER JOE S 482', '-52.13']];
    const { drafts } = parseRows(rows, mapping(), { accountId: 'chk', data });
    expect(drafts[0].duplicateOf).toBe('old');
    expect(drafts[0].duplicateScope).toBe('existing');
  });

  it('does not flag a different account, amount, direction or week', () => {
    const data = ledger();
    data.transactions = [tx({ id: 'old', type: 'expense', amount: 5213, date: '2026-01-15', description: 'Trader Joes', accountId: 'card' })];
    const rows = [
      ['01/14/2026', 'Trader Joes', '-52.13'], // other account
      ['01/15/2026', 'Trader Joes', '-52.14'], // other amount
      ['01/15/2026', 'Trader Joes', '52.13'], // other direction
      ['01/25/2026', 'Trader Joes', '-52.13'], // ten days later
    ];
    const { drafts } = parseRows(rows, mapping(), { accountId: 'chk', data });
    expect(drafts.every((d) => d.duplicateOf === undefined)).toBe(true);
  });

  it('flags a repeat inside the same file and points at the first row', () => {
    const rows = [
      ['01/14/2026', 'Trader Joes', '-52.13'],
      ['01/14/2026', 'TRADER JOES', '-52.13'],
      ['01/15/2026', 'Trader Joes', '-52.13'],
    ];
    const { drafts } = parseRows(rows, mapping(), { accountId: 'chk', data: ledger() });
    expect(drafts[0].duplicateOf).toBeUndefined();
    // Both later rows point at the original, not at each other.
    expect(drafts[1].duplicateOf).toBe('row:1');
    expect(drafts[2].duplicateOf).toBe('row:1');
    expect(drafts[1].duplicateScope).toBe('file');
  });
});

// ─── categories ──────────────────────────────────────────────────────────────

describe('categories', () => {
  it('uses the file category column when it names a category you have', () => {
    const data = ledger();
    const name = data.categories.find((c) => c.kind === 'expense' && c.parentId !== null)!;
    const rows = [['01/14/2026', 'Trader Joes', '-52.13', name.name]];
    const { drafts } = parseRows(rows, mapping({ category: 3 }), { accountId: 'chk', data });
    expect(drafts[0].categoryId).toBe(name.id);
    expect(drafts[0].categorySource).toBe('file');
  });

  it('learns a category from repeated past transactions with the same merchant', () => {
    const data = ledger();
    const groceries = data.categories.find((c) => c.kind === 'expense' && c.parentId !== null)!;
    data.transactions = [
      tx({ type: 'expense', amount: 1000, date: '2025-11-01', description: "TRADER JOE'S #482", categoryId: groceries.id }),
      tx({ type: 'expense', amount: 2000, date: '2025-12-01', description: 'TRADER JOES #117', categoryId: groceries.id }),
    ];
    const { drafts } = parseRows([['01/14/2026', 'SQ *TRADER JOE S 900', '-52.13']], mapping(), { accountId: 'chk', data });
    expect(drafts[0].categoryId).toBe(groceries.id);
    expect(drafts[0].categorySource).toBe('learned');
  });

  it('stays out of the way when there is only one past example or no agreement', () => {
    const data = ledger();
    const [a, b] = data.categories.filter((c) => c.kind === 'expense' && c.parentId !== null);
    data.transactions = [
      tx({ type: 'expense', amount: 1000, date: '2025-11-01', description: 'ONE OFF SHOP', categoryId: a.id }),
      tx({ type: 'expense', amount: 1000, date: '2025-11-02', description: 'SPLIT SHOP', categoryId: a.id }),
      tx({ type: 'expense', amount: 1000, date: '2025-11-03', description: 'SPLIT SHOP', categoryId: b.id }),
    ];
    const rows = [
      ['01/14/2026', 'ONE OFF SHOP', '-52.13'],
      ['01/14/2026', 'SPLIT SHOP', '-11.00'],
    ];
    const { drafts } = parseRows(rows, mapping(), { accountId: 'chk', data });
    expect(drafts[0].categoryId).toBeUndefined();
    expect(drafts[1].categoryId).toBeUndefined();
  });

  it('can be turned off', () => {
    const data = ledger();
    const groceries = data.categories.find((c) => c.kind === 'expense' && c.parentId !== null)!;
    data.transactions = [
      tx({ type: 'expense', amount: 1000, date: '2025-11-01', description: 'TRADER JOES', categoryId: groceries.id }),
      tx({ type: 'expense', amount: 2000, date: '2025-12-01', description: 'TRADER JOES', categoryId: groceries.id }),
    ];
    const { drafts } = parseRows([['01/14/2026', 'TRADER JOES', '-52.13']], mapping(), { accountId: 'chk', data, autoCategorize: false });
    expect(drafts[0].categoryId).toBeUndefined();
  });
});

// ─── whole files ─────────────────────────────────────────────────────────────

describe('parse → guess → rows, end to end', () => {
  it('imports a Chase checking export', () => {
    const table = parseCsv(
      'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\r\n' +
        'DEBIT,01/14/2026,"TRADER JOE S #482 SAN FRANCISCO CA",-52.13,ACH_DEBIT,2431.02,\r\n' +
        'CREDIT,01/15/2026,"ACME PAYROLL DIRECT DEP",1840.22,ACH_CREDIT,4271.24,\r\n' +
        'DEBIT,01/16/2026,"SHELL OIL 574412",-41.00,DEBIT_CARD,4230.24,\r\n',
    );
    const m = guessMapping(table.headers, table.rows);
    const { drafts, errors } = parseRows(table.rows, m, { accountId: 'chk', data: ledger() });
    expect(errors).toEqual([]);
    expect(drafts.map((d) => [d.type, d.amount, d.date])).toEqual([
      ['expense', 5213, '2026-01-14'],
      ['income', 184_022, '2026-01-15'],
      ['expense', 4100, '2026-01-16'],
    ]);
    // The running balance must never be mistaken for the amount.
    expect(drafts[0].amount).not.toBe(243_102);
  });

  it('imports an Amex style headerless export where charges are positive', () => {
    const table = parseCsv('01/14/2026,TRADER JOE S,52.13\n01/16/2026,AUTOPAY PAYMENT THANK YOU,-200.00\n');
    const m = guessMapping(table.headers, table.rows);
    const { drafts, errors } = parseRows(table.rows, m, { accountId: 'card', data: ledger() });
    expect(errors).toEqual([]);
    expect(m.signConvention).toBe('negativeIsSpending');
    expect(drafts.map((d) => d.type)).toEqual(['refund', 'expense']);

    // Amex charges come through positive, so the user flips the convention.
    const flipped = parseRows(table.rows, { ...m, signConvention: 'positiveIsSpending' }, { accountId: 'card', data: ledger() });
    expect(flipped.drafts.map((d) => [d.type, d.amount])).toEqual([
      ['expense', 5213],
      ['refund', 20_000],
    ]);
  });

  it('imports a Capital One export with debit and credit columns', () => {
    const table = parseCsv(
      'Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n' +
        '2026-01-14,2026-01-15,1234,TRADER JOE S,Grocery,52.13,\n' +
        '2026-01-16,2026-01-17,1234,PAYMENT,,,200.00\n',
    );
    const m = guessMapping(table.headers, table.rows);
    const { drafts, errors } = parseRows(table.rows, m, { accountId: 'card', data: ledger() });
    expect(errors).toEqual([]);
    expect(drafts.map((d) => [d.type, d.amount, d.date, d.description])).toEqual([
      ['expense', 5213, '2026-01-14', 'TRADER JOE S'],
      ['refund', 20_000, '2026-01-16', 'PAYMENT'],
    ]);
  });
});

// ─── handing off ─────────────────────────────────────────────────────────────

describe('draftToTransaction and summarize', () => {
  it('produces a row the store can validate', () => {
    const { drafts } = parseRows([['01/14/2026', 'Trader Joes', '-52.13']], mapping(), { accountId: 'chk', data: ledger() });
    expect(draftToTransaction(drafts[0])).toMatchObject({ type: 'expense', amount: 5213, date: '2026-01-14', description: 'Trader Joes', accountId: 'chk', tags: [], attachments: [] });
  });

  it('counts what is about to be imported', () => {
    const data = ledger();
    data.transactions = [tx({ id: 'old', type: 'expense', amount: 5213, date: '2026-01-14', description: 'Trader Joes', accountId: 'chk' })];
    const rows = [
      ['01/14/2026', 'Trader Joes', '-52.13'],
      ['01/15/2026', 'Acme Payroll', '1000.00'],
      ['01/16/2026', 'Shell', '-41.00'],
    ];
    const { drafts } = parseRows(rows, mapping(), { accountId: 'chk', data });
    const s = summarize(drafts, (d) => !d.duplicateOf);
    expect(s).toMatchObject({ total: 3, duplicates: 1, selected: 2, spendingCount: 1, incomeCount: 1, spending: 4100, income: 100_000, from: '2026-01-15', to: '2026-01-16' });
  });
});
