import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { todayISO } from '@/domain/dates';
import { formatMoney, type MoneyFormat } from '@/domain/money';
import type { Cents, ISODate, LedgerData } from '@/domain/types';

import { useLedgerStore } from './ledger';

export const useData = () => useLedgerStore((s) => s.data);
export const useSettings = () => useLedgerStore((s) => s.data.settings);

/** Today's date; refreshes when the app returns to the foreground or the day rolls over. */
export function useToday(): ISODate {
  const [today, setToday] = useState(todayISO);
  useEffect(() => {
    const refresh = () => setToday((prev) => (prev === todayISO() ? prev : todayISO()));
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    const timer = setInterval(refresh, 60_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, []);
  return today;
}

/** Memoizes a derived computation on the ledger snapshot and today's date. */
export function useDerived<T>(compute: (data: LedgerData, today: ISODate) => T, deps: unknown[] = []): T {
  const data = useData();
  const today = useToday();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => compute(data, today), [data, today, ...deps]);
}

export const HIDDEN_AMOUNT = '•••••';
export const HIDDEN_PERCENT = '••%';

/** Percent formatter that is masked in privacy mode, for shares of money (e.g. "% of income"). */
export function usePercent() {
  const { hideAmounts } = useSettings();
  return useMemo(
    () => (ratio: number, digits = 0) => (hideAmounts ? HIDDEN_PERCENT : Number.isFinite(ratio) ? `${(ratio * 100).toFixed(digits)}%` : '—'),
    [hideAmounts],
  );
}

/** Currency formatter honoring the user's currency and privacy mode. */
export function useMoney() {
  const { currency, hideAmounts } = useSettings();
  return useMemo(
    () => (cents: Cents, options: Omit<MoneyFormat, 'currency'> & { reveal?: boolean } = {}) =>
      hideAmounts && !options.reveal ? HIDDEN_AMOUNT : formatMoney(cents, { ...options, currency }),
    [currency, hideAmounts],
  );
}
