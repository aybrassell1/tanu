import type { Cents } from './types';

/** Parses user input like "17", "17.5", "$1,234.56" or "-20" into cents. */
export function parseMoney(input: string): Cents | null {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (!/^-?\d*(\.\d{0,2})?$/.test(cleaned) || !/\d/.test(cleaned)) return null;
  const negative = cleaned.startsWith('-');
  const [whole, frac = ''] = cleaned.replace('-', '').split('.');
  const cents = Number(whole || '0') * 100 + Number(frac.padEnd(2, '0'));
  return negative && cents !== 0 ? -cents : cents;
}

/** Cents → plain editable string ("1234.5" → "1234.50"). */
export function centsToInput(cents: Cents | undefined): string {
  if (cents === undefined) return '';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, decimals: boolean) {
  const key = `${currency}:${decimals}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals ? 2 : 0,
      maximumFractionDigits: decimals ? 2 : 0,
    });
    formatters.set(key, f);
  }
  return f;
}

/** The symbol the formatter prints for a currency ("$", "€", "CA$"). */
export function currencySymbol(currency = 'USD'): string {
  try {
    return formatter(currency, false).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

export type MoneyFormat = {
  currency?: string;
  /** Always show a sign: "+$5.00" / "−$5.00". */
  signed?: boolean;
  /** Drop cents: "$1,235". */
  whole?: boolean;
  /** Abbreviate large values: "$12.4K". */
  compact?: boolean;
};

const MINUS = '−';

export function formatMoney(cents: Cents, { currency = 'USD', signed, whole, compact }: MoneyFormat = {}) {
  const abs = Math.abs(cents) / 100;
  let body: string;
  if (compact && abs >= 10_000) {
    const symbol = formatter(currency, false).format(0).replace(/[\d\s.,]/g, '');
    body =
      // Anything that would round to "1000K" is shown in millions.
      abs >= 999_950
        ? `${symbol}${trim(abs / 1_000_000)}M`
        : `${symbol}${trim(abs / 1_000)}K`;
  } else {
    body = formatter(currency, !(whole || compact)).format(abs);
  }
  if (cents < 0) return `${MINUS}${body}`;
  if (signed && cents > 0) return `+${body}`;
  return body;
}

function trim(n: number) {
  return n >= 100 ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, '');
}

export function formatPercent(ratio: number, digits = 0) {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Monthly interest in cents for a balance at an APR (percent). */
export function monthlyInterest(balance: Cents, apr: number) {
  return Math.round((balance * apr) / 100 / 12);
}
