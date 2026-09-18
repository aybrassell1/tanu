import { describe, expect, it } from 'vitest';

import { buildAlerts } from '../alerts';
import { addDays, addMonths, parseISODate } from '../dates';
import { createId, emptyLedger, nowStamp } from '../factory';
import { detectPriceChanges, median, normalizePayee, priceChangeAlerts, priceChangePhrase } from '../priceChanges';
import { buildSampleLedger } from '../sample';
import type { Account, Frequency, LedgerData, RecurringItem, SubscriptionUsage, Transaction } from '../types';

const TODAY = '2026-09-16';
const stamp = '2025-01-01T00:00:00.000Z';
const MONTHLY: Frequency = { unit: 'month', interval: 1 };

const account = (id: string): Account => ({
  id,
  name: id,
  type: 'checking',
  startingBalance: 1_000_000,
  startingDate: '2024-01-01',
  spendable: true,
  color: '#000',
  icon: 'box',
  tags: [],
  archived: false,
  createdAt: stamp,
  updatedAt: stamp,
});

function tx(partial: Partial<Transaction> & Pick<Transaction, 'amount' | 'date'>): Transaction {
  return {
    id: createId('tx'),
    type: 'expense',
    description: partial.payee ?? 'charge',
    accountId: 'chk',
    tags: [],
    attachments: [],
    createdAt: stamp,
    updatedAt: stamp,
    ...partial,
  };
}

function recurring(partial: Partial<RecurringItem> & Pick<RecurringItem, 'id' | 'name'>): RecurringItem {
  return {
    kind: 'subscription',
    amount: 0,
    variable: false,
    frequency: MONTHLY,
    startDate: '2024-01-01',
    accountId: 'chk',
    autopay: true,
    essential: false,
    active: true,
    skipped: [],
    tags: [],
    createdAt: stamp,
    updatedAt: stamp,
    ...partial,
  };
}

function ledger(build: (d: LedgerData) => void): LedgerData {
  const d = emptyLedger();
  d.accounts = [account('chk')];
  build(d);
  return d;
}

/** A charge `n` months before today, keeping the day of month. */
const monthsAgo = (n: number) => addMonths(TODAY, -n);

/** One charge per month, newest last. `amountAt` receives the months-ago index. */
function monthlyCharges(count: number, amountAt: (monthsBack: number, date: string) => number, extra: Partial<Transaction> = {}) {
  const out: Transaction[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = monthsAgo(i);
    out.push(tx({ ...extra, date, amount: amountAt(i, date) }));
  }
  return out;
}

describe('priceChanges helpers', () => {
  it('takes a median that resists a single outlier', () => {
    expect(median([1000, 1000, 1000, 9999])).toBe(1000);
    expect(median([100, 300])).toBe(200);
    expect(median([])).toBe(0);
  });

  it('normalizes payee spelling', () => {
    expect(normalizePayee('  Netflix   Inc ')).toBe('netflix inc');
  });
});

describe('price rises on recurring items', () => {
  const netflix = (usage?: SubscriptionUsage) =>
    ledger((d) => {
      d.recurring = [recurring({ id: 'r_netflix', name: 'Netflix', amount: 1299, categoryId: 'subscriptions.streaming', usage })];
      d.transactions = monthlyCharges(18, (back) => (back <= 3 ? 1299 : 999), { recurringId: 'r_netflix', payee: 'Netflix' });
    });

  it('finds the rise, the date, the percent and the yearly cost', () => {
    const report = detectPriceChanges(netflix(), TODAY);
    expect(report.increases).toHaveLength(1);
    const change = report.increases[0];
    expect(change.subject).toBe('recurring');
    expect(change.sourceId).toBe('r_netflix');
    expect(change.current).toBe(1299);
    expect(change.vs6Months).not.toBeNull();
    expect(change.vs6Months!.from).toBe(999);
    expect(change.vs12Months!.from).toBe(999);
    expect(change.headline.change).toBe(300);
    expect(change.headline.percent).toBeCloseTo(0.3, 3);
    // Monthly, so a $3.00 rise costs $36.00 a year.
    expect(change.yearlyImpact).toBe(3600);
    expect(report.yearlyIncrease).toBe(3600);
    expect(change.changedOn).toBe(monthsAgo(3));
    expect(change.direction).toBe('up');
    expect(change.lowUsage).toBe(false);
  });

  it('flags a rise on a subscription marked rarely used', () => {
    const report = detectPriceChanges(netflix('never'), TODAY);
    expect(report.lowUsage.map((c) => c.name)).toEqual(['Netflix']);
    const alerts = priceChangeAlerts(report, (c) => `$${(c / 100).toFixed(2)}`);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].title).toContain('Netflix');
    expect(alerts[0].href).toBe('/subscriptions');
  });

  it('reports a price drop separately', () => {
    const data = ledger((d) => {
      d.recurring = [recurring({ id: 'r_gym', name: 'Gym', amount: 3000 })];
      d.transactions = monthlyCharges(18, (back) => (back <= 3 ? 3000 : 4500), { recurringId: 'r_gym' });
    });
    const report = detectPriceChanges(data, TODAY);
    expect(report.increases).toHaveLength(0);
    expect(report.decreases).toHaveLength(1);
    expect(report.decreases[0].direction).toBe('down');
    expect(report.yearlyDecrease).toBe(18_000);
  });

  it('ignores a one-off spike at the end', () => {
    const data = ledger((d) => {
      d.recurring = [recurring({ id: 'r_phone', name: 'Phone', kind: 'bill', amount: 5000 })];
      d.transactions = monthlyCharges(18, (back) => (back === 0 ? 20_000 : 5000), { recurringId: 'r_phone' });
    });
    expect(detectPriceChanges(data, TODAY).increases).toHaveLength(0);
  });

  it('ignores a cancelled item and a stale one', () => {
    const data = ledger((d) => {
      d.recurring = [
        recurring({ id: 'r_dead', name: 'Cancelled', active: false }),
        recurring({ id: 'r_stale', name: 'Stale' }),
      ];
      d.transactions = [
        ...monthlyCharges(18, (back) => (back <= 3 ? 1999 : 999), { recurringId: 'r_dead' }),
        ...monthlyCharges(6, (back) => (back <= 1 ? 1999 : 999), { recurringId: 'r_stale' }).map((t) => ({ ...t, date: addMonths(t.date, -20) })),
      ];
      d.transactions.forEach((t) => (t.description = 'charge'));
    });
    expect(detectPriceChanges(data, TODAY).increases).toHaveLength(0);
  });

  it('needs a second charge at the new price before it reports a monthly bill', () => {
    const data = ledger((d) => {
      d.recurring = [recurring({ id: 'r_one', name: 'One charge so far' })];
      d.transactions = monthlyCharges(18, (back) => (back === 0 ? 1599 : 999), { recurringId: 'r_one' });
    });
    expect(detectPriceChanges(data, TODAY).increases).toHaveLength(0);

    const twice = ledger((d) => {
      d.recurring = [recurring({ id: 'r_one', name: 'One charge so far' })];
      d.transactions = monthlyCharges(18, (back) => (back <= 1 ? 1599 : 999), { recurringId: 'r_one' });
    });
    expect(detectPriceChanges(twice, TODAY).increases).toHaveLength(1);
  });

  it('trusts a single charge for a yearly subscription', () => {
    const yearly: Frequency = { unit: 'year', interval: 1 };
    const data = ledger((d) => {
      d.recurring = [recurring({ id: 'r_year', name: 'Yearly plan', frequency: yearly })];
      d.transactions = [
        tx({ date: addMonths(TODAY, -24), amount: 9900, recurringId: 'r_year' }),
        tx({ date: addMonths(TODAY, -12), amount: 9900, recurringId: 'r_year' }),
        tx({ date: addMonths(TODAY, -1), amount: 12_900, recurringId: 'r_year' }),
      ];
    });
    const report = detectPriceChanges(data, TODAY);
    expect(report.increases).toHaveLength(1);
    // Once a year, so the yearly cost of the rise is the rise itself.
    expect(report.increases[0].yearlyImpact).toBe(3000);
  });
});

describe('seasonal (variable) bills', () => {
  /** Electricity: cheap in winter, brutal in July. Same price both years. */
  const SEASON = [9000, 8500, 8000, 8500, 11_000, 15_000, 18_000, 18_500, 15_000, 11_000, 9000, 9500];
  const seasonal = (date: string) => SEASON[parseISODate(date).month - 1];

  const electric = (factor: (monthsBack: number) => number) =>
    ledger((d) => {
      d.recurring = [recurring({ id: 'r_power', name: 'Electricity', kind: 'bill', variable: true, amount: 12_000, categoryId: 'housing.utilities' })];
      d.transactions = monthlyCharges(24, (back, date) => Math.round(seasonal(date) * factor(back)), { recurringId: 'r_power' });
    });

  it('does not call summer a price rise', () => {
    const report = detectPriceChanges(electric(() => 1), TODAY);
    expect(report.increases).toHaveLength(0);
    expect(report.decreases).toHaveLength(0);
    // It was still looked at — it just didn't change.
    expect(report.watched).toBe(1);
  });

  it('still finds a real rise under the seasonality', () => {
    const report = detectPriceChanges(electric((back) => (back <= 5 ? 1.2 : 1)), TODAY);
    expect(report.increases).toHaveLength(1);
    const change = report.increases[0];
    expect(change.variable).toBe(true);
    expect(change.headline.basis).toBe('rolling');
    expect(change.headline.months).toBe(12);
    expect(change.headline.percent).toBeCloseTo(0.2, 2);
    // A rolling comparison can't say which day it changed.
    expect(change.changedOn).toBeNull();
    expect(change.vs6Months).toBeNull();
  });
});

describe('repeating payees', () => {
  it('detects a rise for a payee with no recurring item', () => {
    const data = ledger((d) => {
      d.transactions = monthlyCharges(17, (back) => (back <= 4 ? 4000 : 3000), { payee: 'Iron Works Gym', categoryId: 'health.gym' });
    });
    const report = detectPriceChanges(data, TODAY);
    expect(report.increases).toHaveLength(1);
    const change = report.increases[0];
    expect(change.subject).toBe('payee');
    expect(change.key).toBe('payee:iron works gym');
    expect(change.current).toBe(4000);
    expect(change.headline.from).toBe(3000);
    expect(change.yearlyImpact).toBeGreaterThan(11_000);
    expect(change.yearlyImpact).toBeLessThan(13_000);
    expect(priceChangePhrase(change, (c) => `$${(c / 100).toFixed(2)}`)).toContain('$30.00 → $40.00');
  });

  it('ignores everyday shopping with irregular amounts', () => {
    const amounts = [4210, 8890, 2300, 15_400, 6600, 3120, 9900, 11_200, 5400, 7700, 2600, 13_100, 4800, 6200, 9100, 3300];
    const data = ledger((d) => {
      d.transactions = amounts.map((amount, i) => tx({ date: addDays(TODAY, -7 * (amounts.length - i)), amount, payee: 'Corner Market' }));
    });
    expect(detectPriceChanges(data, TODAY).watched).toBe(0);
  });

  it('ignores interest charges, which are a balance times an APR, not a price', () => {
    const data = ledger((d) => {
      d.accounts = [account('chk'), { ...account('loan'), type: 'student_loan', startingBalance: 2_000_000 }];
      d.transactions = monthlyCharges(18, (back) => 9000 - back * 100, { type: 'interest', accountId: 'loan', payee: 'Nelnet' });
    });
    expect(detectPriceChanges(data, TODAY).watched).toBe(0);
  });

  it('does not report a payee twice when a recurring item already covers it', () => {
    const data = ledger((d) => {
      d.recurring = [recurring({ id: 'r_spot', name: 'Spotify', payee: 'Spotify' })];
      d.transactions = [
        ...monthlyCharges(18, (back) => (back <= 2 ? 1199 : 999), { recurringId: 'r_spot', payee: 'Spotify' }),
        // An unlinked charge for the same payee shouldn't spawn a second subject.
        tx({ date: addDays(TODAY, -3), amount: 1199, payee: 'Spotify' }),
      ];
    });
    const report = detectPriceChanges(data, TODAY);
    expect(report.increases).toHaveLength(1);
    expect(report.increases[0].subject).toBe('recurring');
  });
});

describe('the sample ledger', () => {
  const today = '2026-09-17';
  const data = buildSampleLedger(today);
  const report = detectPriceChanges(data, today);

  it('finds the streaming price that went up twice', () => {
    const netflix = report.increases.find((c) => c.name === 'Netflix');
    expect(netflix).toBeDefined();
    expect(netflix!.sourceId).toBe('rec_netflix');
    // $15.49 → $16.99 → $17.99, and the saved amount is still the first one.
    expect(netflix!.current).toBe(1799);
    expect(netflix!.vs12Months!.from).toBe(1549);
    expect(netflix!.vs6Months!.from).toBe(1699);
    expect(netflix!.yearlyImpact).toBe(3000);
    expect(data.recurring.find((r) => r.id === 'rec_netflix')!.amount).toBe(1549);
  });

  it('finds the one that got cheaper, with its saved amount already correct', () => {
    const spotify = report.decreases.find((c) => c.name === 'Spotify');
    expect(spotify).toBeDefined();
    expect(spotify!.current).toBe(999);
    expect(spotify!.headline.from).toBe(1199);
    expect(spotify!.yearlyImpact).toBeLessThan(0);
    expect(data.recurring.find((r) => r.id === 'rec_spotify')!.amount).toBe(999);
  });

  it('watches the seasonal electricity bill without calling summer a price rise', () => {
    const electric = data.recurring.find((r) => r.id === 'rec_electric')!;
    expect(electric.variable).toBe(true);
    const charges = data.transactions.filter((t) => t.recurringId === 'rec_electric');
    // Six extra months, so the rolling comparison has a prior year to use.
    expect(charges.filter((t) => t.date > addMonths(today, -18) && t.date <= addMonths(today, -12))).toHaveLength(6);
    expect(charges.some((t) => t.amount > 12_000)).toBe(true);
    expect(charges.some((t) => t.amount < 8_500)).toBe(true);
    expect([...report.increases, ...report.decreases].some((c) => c.name === 'Electric')).toBe(false);
  });

  it('reaches Home as an alert', () => {
    const ids = buildAlerts(data, today).map((a) => a.id);
    expect(ids).toContain('price:increases');
  });
});

describe('empty and minimal ledgers', () => {
  it('returns an empty report for an empty ledger', () => {
    const report = detectPriceChanges(emptyLedger(), TODAY);
    expect(report).toMatchObject({ increases: [], decreases: [], yearlyIncrease: 0, yearlyDecrease: 0, watched: 0 });
    expect(priceChangeAlerts(report, String)).toEqual([]);
  });

  it('survives a brand-new recurring item with one charge', () => {
    const data = ledger((d) => {
      d.recurring = [recurring({ id: 'r_new', name: 'New' })];
      d.transactions = [tx({ date: TODAY, amount: 1000, recurringId: 'r_new' })];
      d.meta.updatedAt = nowStamp();
    });
    expect(detectPriceChanges(data, TODAY).watched).toBe(0);
  });
});
