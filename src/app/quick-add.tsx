import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { accountOptions, categoryOptions } from '@/components/finance/Pickers';
import { Banner, Button, DateField, IconButton, Pill, SelectSheet, Text, useOverlay } from '@/components/ui';
import { icon } from '@/data/icons';
import { ACCOUNT_EMOJI, categoryEmoji, INCOME_EMOJI } from '@/data/visuals';
import { accountNature, isCreditCard, isDebt, isInvestment } from '@/domain/catalog';
import { categoryPath } from '@/domain/categories';
import { addDays, diffDays, formatDate, relativeDay } from '@/domain/dates';
import { balanceOn, indexLedger } from '@/domain/ledger';
import { centsToInput, formatMoney } from '@/domain/money';
import { openEvents, primaryCashAccount, type ScheduledEvent } from '@/domain/schedule';
import type { Cents, ID, ISODate, LedgerData, TransactionType } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, fonts, radius, spacing } from '@/theme/tokens';

type Mode = 'expense' | 'income' | 'transfer' | 'debt' | 'balance';

const MODES: { value: Mode; label: string; icon: string }[] = [
  { value: 'expense', label: 'Expense', icon: 'arrow-up-right' },
  { value: 'income', label: 'Income', icon: 'arrow-down-left' },
  { value: 'transfer', label: 'Transfer', icon: 'repeat' },
  { value: 'debt', label: 'Pay debt', icon: 'check-circle' },
  { value: 'balance', label: 'Update balance', icon: 'sliders' },
];

// ─── Amount keypad ───────────────────────────────────────────────────────────

function pressKey(current: string, key: string): string {
  if (key === 'back') return current.slice(0, -1);
  if (key === '-') return current.startsWith('-') ? current.slice(1) : `-${current}`;
  if (key === '.') return current.includes('.') ? current : `${current || '0'}.`;
  const [whole, frac] = current.replace('-', '').split('.');
  if (frac !== undefined && frac.length >= 2) return current;
  if (frac === undefined && whole.length >= 9) return current;
  if (current === '0') return key;
  if (current === '-0') return `-${key}`;
  return current + key;
}

const toCents = (text: string): Cents => {
  const negative = text.startsWith('-');
  const [w, f = ''] = text.replace('-', '').split('.');
  const cents = Number(w || '0') * 100 + Number((f + '00').slice(0, 2));
  return negative ? -cents : cents;
};

function Keypad({ onKey }: { onKey: (k: string) => void }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];
  return (
    <View style={styles.keypad}>
      {keys.map((k) => (
        <Pressable
          key={k}
          onPress={() => onKey(k)}
          onLongPress={k === 'back' ? () => onKey('clear') : undefined}
          accessibilityRole="button"
          accessibilityLabel={k === 'back' ? 'Delete' : k === '-' ? 'Toggle negative' : k}
          style={({ pressed }) => [styles.key, pressed && { backgroundColor: colors.surfaceSunken }]}
        >
          {k === 'back' ? <Feather name="delete" size={22} color={colors.ink} /> : <Text style={styles.keyText}>{k === '-' ? '±' : k}</Text>}
        </Pressable>
      ))}
    </View>
  );
}

// ─── Suggestions from history ────────────────────────────────────────────────

function recentCategories(data: LedgerData, type: 'expense' | 'income', limit = 8): ID[] {
  const out: ID[] = [];
  for (const t of indexLedger(data).sorted) {
    if (t.type !== type || !t.categoryId || out.includes(t.categoryId)) continue;
    out.push(t.categoryId);
    if (out.length >= limit) break;
  }
  return out;
}

function recentPayees(data: LedgerData, categoryId: ID | undefined, limit = 6): string[] {
  const out: string[] = [];
  for (const t of indexLedger(data).sorted.slice(0, 400)) {
    if (t.type !== 'expense' || !t.payee || out.includes(t.payee)) continue;
    if (categoryId && t.categoryId !== categoryId) continue;
    out.push(t.payee);
    if (out.length >= limit) break;
  }
  return out;
}

/** Accounts money can come from (or go into, for income) in each mode. */
function accountFitsMode(data: LedgerData, mode: Mode, id: ID | undefined): boolean {
  const account = id ? data.accounts.find((a) => a.id === id && !a.archived) : undefined;
  if (!account) return false;
  // Income is deposited into, and transfers / debt payments are paid from, asset accounts.
  if (mode === 'income' || mode === 'transfer' || mode === 'debt') return accountNature(account.type) === 'asset';
  return true;
}

/** The everyday deposit account: primary spendable checking, else any asset account. */
function defaultDepositAccount(data: LedgerData): ID | undefined {
  return primaryCashAccount(data)?.id ?? data.accounts.find((a) => !a.archived && accountNature(a.type) === 'asset')?.id;
}

function defaultAccountFor(data: LedgerData, categoryId: ID | undefined): ID | undefined {
  const sorted = indexLedger(data).sorted;
  const byCategory = categoryId ? sorted.find((t) => t.type === 'expense' && t.categoryId === categoryId) : undefined;
  const lastExpense = sorted.find((t) => t.type === 'expense');
  const candidate = byCategory?.accountId ?? lastExpense?.accountId;
  if (candidate && data.accounts.some((a) => a.id === candidate && !a.archived)) return candidate;
  return primaryCashAccount(data)?.id ?? data.accounts.find((a) => !a.archived)?.id;
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function QuickAddScreen() {
  const params = useLocalSearchParams<{ mode?: string; accountId?: string; sourceId?: string; toAccountId?: string; occurrenceDate?: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const { toast } = useOverlay();
  const index = indexLedger(data);

  const [mode, setMode] = useState<Mode>(MODES.some((m) => m.value === params.mode) ? (params.mode as Mode) : 'expense');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<ISODate>(today);
  const [categoryId, setCategoryId] = useState<ID | undefined>();
  const [payee, setPayee] = useState('');
  const [note, setNote] = useState('');
  const validAccount = (id?: string) => (id && data.accounts.some((a) => a.id === id) ? id : undefined);
  const [accountId, setAccountId] = useState<ID | undefined>(validAccount(params.accountId));
  const [toAccountId, setToAccountId] = useState<ID | undefined>(validAccount(params.toAccountId));
  const [sourceId, setSourceId] = useState<ID | undefined>(data.incomeSources.some((x) => x.id === params.sourceId) ? params.sourceId : undefined);
  const [link, setLink] = useState<ScheduledEvent | null>(null);
  const [linkOn, setLinkOn] = useState(true);
  const [picker, setPicker] = useState<'category' | 'account' | 'to' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cents = toCents(amount);
  // Balances and favorites respect privacy mode; the amount being typed is always visible.
  const money = useMoney();
  const plain = (c: Cents) => formatMoney(c, { currency: data.settings.currency });
  const hasAccounts = data.accounts.some((a) => !a.archived);

  // Web: allow typing on a physical keyboard.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (/^[0-9.]$/.test(e.key)) setAmount((a) => pressKey(a, e.key));
      else if (e.key === 'Backspace') setAmount((a) => pressKey(a, 'back'));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Sensible defaults whenever the mode changes.
  useEffect(() => {
    setError(null);
    setLink(null);
    // A category from the other side (income vs spending) doesn't carry over.
    const wantKind = mode === 'income' ? 'income' : mode === 'expense' ? 'expense' : null;
    if (wantKind) setCategoryId((c) => (c && index.categories.get(c)?.kind === wantKind ? c : undefined));
    if (mode === 'expense') setAccountId((a) => (accountFitsMode(data, 'expense', a) ? a : defaultAccountFor(data, categoryId)));
    if (mode === 'income') {
      const source = data.incomeSources.find((s) => s.id === sourceId) ?? data.incomeSources.find((s) => s.active);
      if (source) chooseSource(source.id);
      else setAccountId((a) => (accountFitsMode(data, 'income', a) ? a : defaultDepositAccount(data)));
    }
    if (mode === 'transfer' || mode === 'debt') setAccountId((a) => (accountFitsMode(data, mode, a) ? a : defaultDepositAccount(data)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const upcoming = useMemo(() => openEvents(data, today, addDays(today, 10), 20), [data, today]);

  // Opened from a debt's "Pay" button: fill in that payment.
  useEffect(() => {
    if (mode === 'debt' && params.toAccountId && index.accounts.has(params.toAccountId)) chooseDebt(params.toAccountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Suggest linking an expense to a matching bill so it isn't counted twice.
  useEffect(() => {
    if (mode !== 'expense') return;
    const name = payee.trim().toLowerCase();
    const match = upcoming.find(
      (e) =>
        e.source === 'recurring' &&
        (e.kind === 'bill' || e.kind === 'subscription') &&
        Math.abs(diffDays(e.date, date)) <= 7 &&
        // A payee match, or the same category with an amount close to the bill's.
        ((name.length >= 3 && (e.name.toLowerCase().includes(name) || name.includes(e.name.toLowerCase()))) ||
          (!!categoryId && e.categoryId === categoryId && cents > 0 && Math.abs(cents - e.amount) <= e.amount * 0.2)),
    );
    // Keep the user's on/off choice while the same bill stays matched.
    if (match?.key !== link?.key) setLinkOn(true);
    setLink(match ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, categoryId, payee, date, upcoming, cents]);

  const chooseSource = (id: ID) => {
    const s = data.incomeSources.find((x) => x.id === id);
    setSourceId(id);
    if (!s) return;
    setAccountId(accountFitsMode(data, 'income', s.depositAccountId) ? s.depositAccountId : defaultDepositAccount(data));
    setCategoryId(s.categoryId);
    // A specific paycheck (from a "Record" button) wins; otherwise the nearest open one.
    const open = openEvents(data, today, addDays(today, 10), 60).filter((e) => e.kind === 'income' && e.sourceId === id);
    const next = open.find((e) => e.date === params.occurrenceDate) ?? open.find((e) => e.status === 'overdue' && e.date >= addDays(today, -20)) ?? open.find((e) => e.status === 'upcoming');
    const expected = next?.amount ?? s.expectedNet;
    if (expected) setAmount(centsToInput(expected).replace(/\.00$/, ''));
    setLink(next ?? null);
  };

  const chooseDebt = (id: ID) => {
    setToAccountId(id);
    const account = index.accounts.get(id)!;
    const event = upcoming.find((e) => e.kind === 'debt_payment' && (e.toAccountId === id || (e.source === 'debt' && e.sourceId === id)));
    const suggestion = event?.amount ?? account.paymentAmount ?? account.minimumPayment;
    if (suggestion) setAmount(centsToInput(suggestion).replace(/\.00$/, ''));
    setLink(event?.source === 'recurring' ? event : null);
  };

  const chooseBalanceAccount = (id: ID) => {
    setAccountId(id);
    setAmount('');
  };

  const favorites = data.favorites.filter((f) => f.type === 'expense');
  const recentCats = recentCategories(data, 'expense');
  const payees = recentPayees(data, categoryId);
  const lastExpense = index.sorted.find((t) => t.type === 'expense' && t.date <= today);
  const debts = data.accounts.filter((a) => !a.archived && isDebt(a.type));
  const currentBalance = accountId ? balanceOn(index, accountId, date) : 0;
  const balanceAccount = accountId ? index.accounts.get(accountId) : undefined;

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const reset = () => {
    setAmount('');
    setPayee('');
    setNote('');
    setError(null);
  };

  const save = (again: boolean) => {
    setError(null);
    if (!hasAccounts) return setError('Add an account first.');
    if (mode !== 'balance' && cents <= 0) return setError('Enter an amount.');
    let result: { ok: true; id: unknown } | { ok: false; errors: Record<string, string> };
    let summary = '';

    switch (mode) {
      case 'expense': {
        if (!categoryId) return setError('Pick a category.');
        if (link && linkOn && link.source === 'recurring') {
          result = ledger.payOccurrence(link.sourceId, link.date, { amount: cents, date, accountId, categoryId, payee: payee || undefined, notes: note || undefined });
        } else {
          result = ledger.saveTransaction({
            type: 'expense', amount: cents, date, description: payee || categoryPath(index.categories, categoryId), payee: payee || undefined,
            categoryId, accountId: accountId!, notes: note || undefined, tags: [], attachments: [],
          });
        }
        summary = `${plain(cents)} · ${categoryPath(index.categories, categoryId)}`;
        break;
      }
      case 'income': {
        if (sourceId) {
          result = ledger.recordPaycheck(sourceId, { amount: cents, date, accountId, occurrenceDate: link?.sourceId === sourceId ? link.date : undefined, notes: note || undefined });
        } else {
          if (!categoryId) return setError('Pick an income category or source.');
          result = ledger.saveTransaction({
            type: 'income', amount: cents, date, description: payee || categoryPath(index.categories, categoryId), payee: payee || undefined,
            categoryId, accountId: accountId!, notes: note || undefined, tags: [], attachments: [],
          });
        }
        summary = `${plain(cents)} income recorded`;
        break;
      }
      case 'transfer': {
        const to = toAccountId ? index.accounts.get(toAccountId) : undefined;
        const from = accountId ? index.accounts.get(accountId) : undefined;
        let type: TransactionType = 'transfer';
        if (to && isDebt(to.type)) type = 'debt_payment';
        else if (to && isInvestment(to.type) && !(from && isInvestment(from.type))) type = 'investment_contribution';
        else if (from && isInvestment(from.type) && !(to && isInvestment(to.type))) type = 'investment_withdrawal';
        result = ledger.saveTransaction({
          type, amount: cents, date, description: `Transfer to ${to?.name ?? ''}`.trim(), accountId: accountId!, toAccountId, notes: note || undefined, tags: [], attachments: [],
        });
        summary = `${plain(cents)} moved to ${to?.name ?? 'account'}`;
        break;
      }
      case 'debt': {
        if (!toAccountId) return setError('Choose which debt you paid.');
        const to = index.accounts.get(toAccountId);
        if (!to) return setError('That debt no longer exists.');
        if (link && link.source === 'recurring' && link.toAccountId === toAccountId) {
          result = ledger.payOccurrence(link.sourceId, link.date, { amount: cents, date, accountId, notes: note || undefined });
        } else {
          result = ledger.saveTransaction({
            type: 'debt_payment', amount: cents, date, description: `${to.name} payment`, accountId: accountId!, toAccountId, notes: note || undefined, tags: [], attachments: [],
            categoryId: isCreditCard(to.type) ? 'financial.credit_card_payments' : 'financial.loan_payments',
          });
        }
        summary = `${plain(cents)} paid to ${to.name}`;
        break;
      }
      case 'balance': {
        if (!accountId) return setError('Choose an account.');
        if (amount === '' || amount === '-') return setError('Enter the new balance.');
        const kind = balanceAccount && isInvestment(balanceAccount.type) ? 'valuation' : 'reconcile';
        const r = ledger.updateBalance(accountId, cents, date, kind, note || undefined);
        if (!r.ok) {
          result = r;
          break;
        }
        result = r;
        summary = r.id === 0 ? 'Balance already matches' : `${balanceAccount?.name}: ${plain(cents)} (${formatMoney(r.id as number, { signed: true, currency: data.settings.currency })})`;
        break;
      }
    }

    if (!result.ok) {
      setError(Object.values(result.errors)[0] ?? 'Check the details and try again.');
      return;
    }
    if (mode === 'balance' && result.id === 0) toast(summary);
    else toast({ message: `Saved · ${summary}`, actionLabel: 'Undo', onAction: ledger.undo });
    if (again) reset();
    else close();
  };

  const accountName = (id?: ID) => (id ? index.accounts.get(id)?.name : undefined) ?? 'Choose account';

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon="x" accessibilityLabel="Close" onPress={close} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modes}>
          {MODES.map((m) => (
            <Pill key={m.value} label={m.label} icon={icon(m.icon)} selected={mode === m.value} onPress={() => { setMode(m.value); reset(); }} />
          ))}
        </ScrollView>
      </View>

      <View style={styles.amountWrap}>
        <Text variant="small" color={colors.textTertiary}>
          {mode === 'balance' ? (balanceAccount ? `Current balance ${money(currentBalance)} · enter new balance` : 'New balance') : 'Amount'}
        </Text>
        <Text style={[styles.amount, amount === '' && { color: colors.textTertiary }]} numberOfLines={1} adjustsFontSizeToFit accessibilityLabel={`Amount ${amount || '0'}`}>
          {formatMoney(amount === '' ? 0 : cents, { currency: data.settings.currency })}
        </Text>
        {mode === 'balance' && balanceAccount && amount !== '' && (
          <Text variant="small" color={colors.textSecondary}>
            Records a {formatMoney(cents - currentBalance, { signed: true, currency: data.settings.currency })} adjustment — not income or spending
          </Text>
        )}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!hasAccounts && (
          <Banner tone="warning" icon="alert-circle" title="Add an account first" message="Quick add records money in and out of your accounts." action={<Button label="Add account" size="sm" onPress={() => router.replace('/accounts/edit')} />} />
        )}

        {mode === 'expense' && (
          <>
            {(favorites.length > 0 || lastExpense) && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {lastExpense && (
                  <Pill
                    icon="rotate-cw"
                    tone="primary"
                    label={`Repeat ${lastExpense.payee ?? 'last'}`}
                    onPress={() => {
                      setAmount(centsToInput(lastExpense.amount).replace(/\.00$/, ''));
                      setCategoryId(lastExpense.categoryId);
                      setPayee(lastExpense.payee ?? '');
                      setAccountId(lastExpense.accountId);
                    }}
                  />
                )}
                {favorites.map((f) => (
                  <Pill
                    key={f.id}
                    icon="star"
                    label={f.amount ? `${f.label} ${money(f.amount)}` : f.label}
                    onPress={() => {
                      if (f.amount) setAmount(centsToInput(f.amount).replace(/\.00$/, ''));
                      setCategoryId(f.categoryId);
                      setPayee(f.payee ?? '');
                      if (f.accountId) setAccountId(f.accountId);
                    }}
                  />
                ))}
              </ScrollView>
            )}

            <View style={styles.group}>
              <Text variant="caption" color={colors.textTertiary}>CATEGORY</Text>
              <View style={styles.wrap}>
                {[...new Set([...(categoryId && !recentCats.includes(categoryId) ? [categoryId] : []), ...recentCats])].map((id) => {
                  const c = index.categories.get(id);
                  if (!c) return null;
                  const parent = c.parentId ? index.categories.get(c.parentId) : undefined;
                  return (
                    <Pill
                      key={id}
                      icon={icon(c.icon)}
                      emoji={categoryEmoji(id)}
                      label={parent ? `${parent.name} › ${c.name}` : c.name}
                      selected={categoryId === id}
                      onPress={() => {
                        setCategoryId(id);
                        setAccountId(defaultAccountFor(data, id));
                      }}
                    />
                  );
                })}
                <Pill icon="more-horizontal" label="All categories" onPress={() => setPicker('category')} />
              </View>
            </View>

            <View style={styles.group}>
              <Text variant="caption" color={colors.textTertiary}>MERCHANT</Text>
              <TextInput value={payee} onChangeText={setPayee} placeholder="Where? (optional)" placeholderTextColor={colors.textTertiary} style={styles.input} accessibilityLabel="Merchant" />
              {payees.length > 0 && (
                <View style={styles.wrap}>
                  {payees.map((p) => (
                    <Pill key={p} label={p} size="sm" selected={payee === p} onPress={() => setPayee(payee === p ? '' : p)} />
                  ))}
                </View>
              )}
            </View>

            {link && (
              <Pressable onPress={() => setLinkOn(!linkOn)} accessibilityRole="checkbox" accessibilityState={{ checked: linkOn }}>
                <Banner
                  tone={linkOn ? 'primary' : 'muted'}
                  icon={linkOn ? 'check-square' : 'square'}
                  title={`Mark ${link.name} (${relativeDay(link.date, today).toLowerCase()}) as paid`}
                  message="Links this expense to the bill so it isn't counted twice."
                />
              </Pressable>
            )}
          </>
        )}

        {mode === 'income' && (
          <View style={styles.group}>
            <Text variant="caption" color={colors.textTertiary}>SOURCE</Text>
            <View style={styles.wrap}>
              {data.incomeSources.filter((s) => s.active).map((s) => (
                <Pill key={s.id} emoji={INCOME_EMOJI[s.type]} label={s.name} selected={sourceId === s.id} onPress={() => chooseSource(s.id)} />
              ))}
              {recentCategories(data, 'income', 4).map((id) => (
                <Pill key={id} label={index.categories.get(id)?.name ?? id} selected={!sourceId && categoryId === id} onPress={() => { setSourceId(undefined); setCategoryId(id); setLink(null); setAccountId((a) => (accountFitsMode(data, 'income', a) ? a : defaultDepositAccount(data))); }} />
              ))}
              <Pill icon="more-horizontal" label="Other income" onPress={() => { setSourceId(undefined); setPicker('category'); setAccountId((a) => (accountFitsMode(data, 'income', a) ? a : defaultDepositAccount(data))); }} />
            </View>
            {link && sourceId && (
              <Text variant="small" color={colors.textSecondary}>
                Records the paycheck expected {formatDate(link.date, 'weekday', today)}.
              </Text>
            )}
            {!sourceId && categoryId && (
              <Text variant="small" color={colors.textSecondary}>Category: {categoryPath(index.categories, categoryId)}</Text>
            )}
          </View>
        )}

        {mode === 'debt' && (
          <View style={styles.group}>
            <Text variant="caption" color={colors.textTertiary}>WHICH DEBT</Text>
            {debts.length === 0 && <Text color={colors.textSecondary}>No cards or loans yet.</Text>}
            <View style={styles.wrap}>
              {debts.map((a) => (
                <Pill key={a.id} emoji={ACCOUNT_EMOJI[a.type]} label={`${a.name} · ${money(balanceOn(index, a.id, today))}`} selected={toAccountId === a.id} onPress={() => chooseDebt(a.id)} />
              ))}
            </View>
          </View>
        )}

        {mode === 'balance' && (
          <View style={styles.group}>
            <Text variant="caption" color={colors.textTertiary}>ACCOUNT</Text>
            <View style={styles.wrap}>
              {data.accounts.filter((a) => !a.archived).map((a) => (
                <Pill key={a.id} emoji={ACCOUNT_EMOJI[a.type]} label={a.name} selected={accountId === a.id} onPress={() => chooseBalanceAccount(a.id)} />
              ))}
            </View>
          </View>
        )}

        <View style={styles.row}>
          {mode !== 'balance' && (
            <Pressable style={styles.selector} onPress={() => setPicker('account')} accessibilityRole="button" accessibilityLabel={`From ${accountName(accountId)}`}>
              <Text variant="caption" color={colors.textTertiary}>{mode === 'income' ? 'INTO' : 'FROM'}</Text>
              <Text weight="medium" numberOfLines={1}>{accountName(accountId)}</Text>
            </Pressable>
          )}
          {mode === 'transfer' && (
            <Pressable style={styles.selector} onPress={() => setPicker('to')} accessibilityRole="button" accessibilityLabel={`To ${accountName(toAccountId)}`}>
              <Text variant="caption" color={colors.textTertiary}>TO</Text>
              <Text weight="medium" numberOfLines={1}>{accountName(toAccountId)}</Text>
            </Pressable>
          )}
        </View>

        <DateField value={date} onChange={(d) => d && setDate(d)} shortcuts />

        <TextInput value={note} onChangeText={setNote} placeholder="Add a note" placeholderTextColor={colors.textTertiary} style={styles.input} accessibilityLabel="Note" />

        {mode === 'expense' && (
          <Text variant="small" color={colors.primary} onPress={() => router.push({ pathname: '/transactions/edit', params: { type: 'expense' } })} suppressHighlighting>
            Need tags, receipts or tax details? Open the full form
          </Text>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {error && (
          <View style={styles.error} accessibilityLiveRegion="polite">
            <Feather name="alert-circle" size={14} color={colors.negative} />
            <Text variant="small" color={colors.negative}>{error}</Text>
          </View>
        )}
        {mode === 'balance' && (
          <Pill
            label={amount.startsWith('-') ? 'Negative balance' : 'Make negative'}
            icon="minus-circle"
            size="sm"
            selected={amount.startsWith('-')}
            onPress={() => setAmount((a) => pressKey(a, '-'))}
            style={{ alignSelf: 'center' }}
          />
        )}
        <Keypad onKey={(k) => setAmount((a) => (k === 'clear' ? '' : pressKey(a, k)))} />
        <View style={styles.actions}>
          {mode !== 'balance' && <Button label="Save + new" variant="secondary" size="lg" onPress={() => save(true)} style={{ flex: 1 }} />}
          <Button label="Save" size="lg" onPress={() => save(false)} style={{ flex: 1 }} />
        </View>
      </View>

      <SelectSheet
        visible={picker === 'category'}
        onClose={() => setPicker(null)}
        title={mode === 'income' ? 'Income category' : 'Category'}
        options={categoryOptions(data, mode === 'income' ? 'income' : 'expense')}
        value={categoryId}
        onSelect={(id) => {
          setCategoryId(id);
          if (mode === 'expense') setAccountId(defaultAccountFor(data, id));
        }}
        searchable
      />
      <SelectSheet
        visible={picker === 'account'}
        onClose={() => setPicker(null)}
        title={mode === 'income' ? 'Deposit into' : 'Pay from'}
        options={accountOptions(data, today, mode === 'income' || mode === 'debt' ? (a) => accountNature(a.type) === 'asset' : undefined, false, money)}
        value={accountId}
        onSelect={setAccountId}
      />
      <SelectSheet visible={picker === 'to'} onClose={() => setPicker(null)} title="Move to" options={accountOptions(data, today, (a) => a.id !== accountId, false, money)} value={toAccountId} onSelect={setToAccountId} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, width: '100%', maxWidth: 720, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  modes: { gap: spacing.sm, paddingRight: spacing.lg },
  amountWrap: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: 2 },
  amount: { fontFamily: fonts.medium, fontSize: 52, lineHeight: 62, letterSpacing: -2.4, color: colors.ink, fontVariant: ['tabular-nums'] },
  body: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.lg },
  chipRow: { gap: spacing.sm },
  group: { gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  selector: { flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 8, gap: 2 },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44, fontFamily: fonts.regular, fontSize: 15, color: colors.ink },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  error: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  keypad: { flexDirection: 'row', flexWrap: 'wrap' },
  key: { width: '33.333%', height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  keyText: { fontFamily: fonts.medium, fontSize: 24, color: colors.ink },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.sm },
});
