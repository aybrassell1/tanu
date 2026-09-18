import { accountGroup, accountNature } from './catalog';
import { addDays, diffDays } from './dates';
import { balanceOn, balanceSeries, indexLedger } from './ledger';
import { sum } from './money';
import { poolEffect, spendableAccounts } from './position';
import { scheduledEvents, type ScheduledEvent } from './schedule';
import type { Cents, ID, ISODate, LedgerData } from './types';

/**
 * Cash-flow forecast. Starts from today's *actual* balances and layers
 * *projected* events on top (paychecks, bills, debt payments,
 * contributions, future-dated transactions). Overdue, unsettled items are
 * assumed to still come out today. Nothing here is written to the ledger.
 */

export type ForecastScope = 'spendable' | 'cash';

export interface ForecastEvent extends ScheduledEvent {
  effect: Cents;
  running: Cents;
}

export interface ForecastDay {
  date: ISODate;
  balance: Cents;
  inflow: Cents;
  outflow: Cents;
}

export interface Forecast {
  scope: ForecastScope;
  accountIds: ID[];
  today: ISODate;
  to: ISODate;
  start: Cents;
  end: Cents;
  lowest: { date: ISODate; balance: Cents };
  totalIn: Cents;
  totalOut: Cents;
  events: ForecastEvent[];
  days: ForecastDay[];
  /** Actual balances for the lookback window, ending today. */
  history: { date: ISODate; balance: Cents }[];
}

export function forecastAccounts(data: LedgerData, scope: ForecastScope) {
  if (scope === 'spendable') return spendableAccounts(data);
  return data.accounts.filter(
    (a) => !a.archived && accountNature(a.type) === 'asset' && ['cash', 'savings'].includes(accountGroup(a.type)),
  );
}

export function buildForecast(
  data: LedgerData,
  { today, to, scope = 'spendable', lookbackDays = 30 }: { today: ISODate; to: ISODate; scope?: ForecastScope; lookbackDays?: number },
): Forecast {
  const index = indexLedger(data);
  const accounts = forecastAccounts(data, scope);
  const pool = new Set(accounts.map((a) => a.id));
  const start = sum(accounts.map((a) => balanceOn(index, a.id, today)));

  const historyDates = Array.from({ length: lookbackDays + 1 }, (_, i) => addDays(today, i - lookbackDays));
  const perAccount = accounts.map((a) => balanceSeries(index, a.id, historyDates));
  const history = historyDates.map((date, i) => ({ date, balance: sum(perAccount.map((s) => s[i])) }));

  const raw = scheduledEvents(data, { from: addDays(today, -45), to, today }).filter(
    (e) => e.status === 'overdue' || (e.status === 'upcoming' && e.date >= today),
  );

  let running = start;
  let totalIn = 0;
  let totalOut = 0;
  const events: ForecastEvent[] = [];
  const dayMap = new Map<ISODate, ForecastDay>();
  const length = Math.max(0, diffDays(today, to));
  const days: ForecastDay[] = Array.from({ length: length + 1 }, (_, i) => {
    const day = { date: addDays(today, i), balance: 0, inflow: 0, outflow: 0 };
    dayMap.set(day.date, day);
    return day;
  });

  for (const e of raw) {
    const effect = poolEffect(data, e, pool);
    if (effect === 0) continue;
    const date = e.date < today ? today : e.date;
    running += effect;
    if (effect > 0) totalIn += effect;
    else totalOut -= effect;
    events.push({ ...e, effect, running });
    const day = dayMap.get(date);
    if (day) {
      if (effect > 0) day.inflow += effect;
      else day.outflow -= effect;
    }
  }

  let balance = start;
  let lowest = { date: today, balance: start };
  for (const day of days) {
    balance += day.inflow - day.outflow;
    day.balance = balance;
    if (balance < lowest.balance) lowest = { date: day.date, balance };
  }

  return {
    scope,
    accountIds: accounts.map((a) => a.id),
    today,
    to,
    start,
    end: balance,
    lowest,
    totalIn,
    totalOut,
    events,
    days,
    history,
  };
}
