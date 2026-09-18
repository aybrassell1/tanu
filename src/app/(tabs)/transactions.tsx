import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { accountOptions, categoryOptions } from '@/components/finance/Pickers';
import { TransactionRow } from '@/components/finance/Rows';
import {
  Button,
  DateField,
  EmptyState,
  Field,
  IconButton,
  ListCard,
  Money,
  MoneyField,
  PickerButton,
  Pill,
  Screen,
  ScreenTitle,
  Segmented,
  SelectSheet,
  Sheet,
  SwitchRow,
  Text,
} from '@/components/ui';
import { icon } from '@/data/icons';
import { TRANSACTION_TYPES } from '@/domain/catalog';
import { formatDate, relativeDay } from '@/domain/dates';
import {
  activeFilterCount,
  DATE_PRESETS,
  emptyFilters,
  expandCategoryIds,
  filteredTotals,
  filterTransactions,
  presetRange,
  type TransactionFilters,
  type TransactionSort,
} from '@/domain/filters';
import { allTags } from '@/domain/search';
import type { Transaction, TransactionType } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { colors, fonts, radius, spacing } from '@/theme/tokens';

const PAGE = 120;

const SORTS: { value: TransactionSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'largest', label: 'Largest' },
  { value: 'smallest', label: 'Smallest' },
];

const TYPE_GROUPS: { label: string; types: TransactionType[] }[] = [
  { label: 'Spending', types: ['expense', 'interest', 'refund', 'reimbursement'] },
  { label: 'Income', types: ['income'] },
  { label: 'Transfers', types: ['transfer', 'debt_payment', 'investment_contribution', 'investment_withdrawal'] },
];

export default function ActivityScreen() {
  const params = useLocalSearchParams<{ category?: string; accountId?: string; type?: TransactionType; from?: string; to?: string; q?: string; tag?: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();

  const [filters, setFilters] = useState<TransactionFilters>(emptyFilters);
  const [sort, setSort] = useState<TransactionSort>('newest');
  const [limit, setLimit] = useState(PAGE);
  const [sheet, setSheet] = useState(false);

  // Deep links from reports, accounts and search. Opening the tab again without
  // those params drops the filters they applied.
  const paramFiltered = useRef(false);
  useEffect(() => {
    if (!params.category && !params.accountId && !params.type && !params.from && !params.to && !params.q && !params.tag) {
      if (paramFiltered.current) {
        paramFiltered.current = false;
        setFilters(emptyFilters());
        setLimit(PAGE);
      }
      return;
    }
    paramFiltered.current = true;
    setFilters({
      ...emptyFilters(),
      categoryIds: params.category ? [params.category] : [],
      accountIds: params.accountId ? [params.accountId] : [],
      types: params.type ? [params.type] : [],
      preset: params.from || params.to ? 'custom' : 'all',
      from: params.from,
      to: params.to,
      query: params.q ?? (params.tag ? `#${params.tag}` : ''),
    });
    setLimit(PAGE);
  }, [params.category, params.accountId, params.type, params.from, params.to, params.q, params.tag]);

  const results = useMemo(() => filterTransactions(data, filters, today, sort), [data, filters, today, sort]);
  const totals = useMemo(() => filteredTotals(results.filter((t) => t.date <= today), expandCategoryIds(data, filters.categoryIds)), [data, filters.categoryIds, results, today]);
  const scheduled = sort === 'newest' ? results.filter((t) => t.date > today) : [];
  const past = sort === 'newest' ? results.filter((t) => t.date <= today) : results;
  const shown = past.slice(0, limit);
  const filterCount = activeFilterCount(filters);

  const groups = useMemo(() => {
    if (sort !== 'newest' && sort !== 'oldest') return [{ key: 'all', label: '', items: shown }];
    const out: { key: string; label: string; items: Transaction[] }[] = [];
    for (const t of shown) {
      const last = out[out.length - 1];
      if (last && last.key === t.date) last.items.push(t);
      else {
        const rel = relativeDay(t.date, today);
        const label = rel === 'Today' || rel === 'Yesterday' ? `${rel} · ${formatDate(t.date, 'short', today)}` : formatDate(t.date, 'weekday', today);
        out.push({ key: t.date, label, items: [t] });
      }
    }
    return out;
  }, [shown, sort, today]);

  const update = (patch: Partial<TransactionFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setLimit(PAGE);
  };
  const typeGroupActive = (types: TransactionType[]) => filters.types.length === types.length && types.every((t) => filters.types.includes(t));
  const hasAny = data.transactions.length > 0;

  return (
    <Screen tabBar>
      <ScreenTitle
        title="Activity"
        actions={
          <>
            <IconButton icon="calendar" accessibilityLabel="Calendar" onPress={() => router.push('/calendar')} />
            <IconButton icon="plus" variant="dark" accessibilityLabel="New transaction" onPress={() => router.push('/transactions/edit')} />
          </>
        }
      />

      <View style={{ gap: spacing.md }}>
        <View style={styles.searchRow}>
          <View style={styles.search}>
            <Feather name="search" size={17} color={colors.textTertiary} />
            <TextInput
              value={filters.query}
              onChangeText={(query) => update({ query })}
              placeholder="Search payee, note, #tag or amount"
              placeholderTextColor={colors.textTertiary}
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
              accessibilityLabel="Search transactions"
            />
            {!!filters.query && (
              <Pressable onPress={() => update({ query: '' })} accessibilityLabel="Clear search" hitSlop={8}>
                <Feather name="x" size={16} color={colors.textTertiary} />
              </Pressable>
            )}
          </View>
          <Pressable onPress={() => setSheet(true)} style={[styles.filterButton, filterCount > 0 && styles.filterActive]} accessibilityRole="button" accessibilityLabel={`Filters${filterCount ? `, ${filterCount} active` : ''}`}>
            <Feather name="sliders" size={17} color={filterCount ? colors.onPrimary : colors.ink} />
            {filterCount > 0 && (
              <Text variant="caption" weight="semibold" color={colors.onPrimary}>
                {filterCount}
              </Text>
            )}
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {DATE_PRESETS.filter((p) => p.value !== 'custom').map((p) => (
            <Pill key={p.value} label={p.label} size="sm" selected={filters.preset === p.value} onPress={() => update({ preset: p.value })} />
          ))}
          {filters.preset === 'custom' && <Pill label={`${filters.from ? formatDate(filters.from, 'short', today) : '…'} – ${filters.to ? formatDate(filters.to, 'short', today) : '…'}`} size="sm" selected onPress={() => setSheet(true)} />}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Pill label="All types" size="sm" tone="muted" selected={filters.types.length === 0} onPress={() => update({ types: [] })} />
          {TYPE_GROUPS.map((g) => (
            <Pill key={g.label} label={g.label} size="sm" tone="muted" selected={typeGroupActive(g.types)} onPress={() => update({ types: typeGroupActive(g.types) ? [] : g.types })} />
          ))}
          <Pill label={`Sort: ${SORTS.find((s) => s.value === sort)?.label}`} icon="bar-chart" size="sm" tone="muted" onPress={() => setSort(SORTS[(SORTS.findIndex((s) => s.value === sort) + 1) % SORTS.length].value)} />
        </ScrollView>
      </View>

      {hasAny && (
        <View style={styles.summary}>
          <SummaryStat label={totals.count === 1 ? '1 transaction' : `${totals.count} transactions`} />
          <SummaryStat label="In" cents={totals.income} color={colors.positive} />
          <SummaryStat label="Spent" cents={totals.spending} />
          {totals.moved > 0 && <SummaryStat label="Moved" cents={totals.moved} color={colors.textSecondary} />}
        </View>
      )}

      {!hasAny ? (
        <EmptyState
          icon="list"
          title="No transactions yet"
          message="Record purchases in seconds with the + button, or add a detailed transaction."
          actionLabel="Quick add"
          onAction={() => router.push('/quick-add')}
          secondaryLabel="Full form"
          onSecondary={() => router.push('/transactions/edit')}
        />
      ) : results.length === 0 ? (
        <EmptyState icon="search" title="No matches" message="Try a wider date range or fewer filters." actionLabel="Clear filters" actionIcon="x" onAction={() => setFilters(emptyFilters())} />
      ) : (
        <>
          {scheduled.length > 0 && (
            <View style={{ gap: spacing.sm }}>
              <Text variant="small" weight="medium" color={colors.projected}>
                Scheduled · not yet in balances
              </Text>
              <ListCard>
                {scheduled.map((t) => (
                  <TransactionRow key={t.id} tx={t} showDate />
                ))}
              </ListCard>
            </View>
          )}
          {groups.map((g) => (
            <View key={g.key} style={{ gap: spacing.sm }}>
              {!!g.label && (
                <Text variant="small" weight="medium" color={colors.textTertiary}>
                  {g.label}
                </Text>
              )}
              <ListCard>
                {g.items.map((t) => (
                  <TransactionRow key={t.id} tx={t} showDate={!g.label} />
                ))}
              </ListCard>
            </View>
          ))}
          {past.length > limit && <Button label={`Show more (${past.length - limit} left)`} variant="secondary" fullWidth onPress={() => setLimit((l) => l + PAGE)} />}
        </>
      )}

      <FilterSheet visible={sheet} onClose={() => setSheet(false)} filters={filters} onChange={update} />
    </Screen>
  );
}

function SummaryStat({ label, cents, color }: { label: string; cents?: number; color?: string }) {
  return (
    <View style={{ gap: 1 }}>
      <Text variant="caption" color={colors.textTertiary}>
        {label}
      </Text>
      {cents !== undefined && <Money cents={cents} weight="semibold" color={color} compact />}
    </View>
  );
}

function FilterSheet({ visible, onClose, filters, onChange }: { visible: boolean; onClose: () => void; filters: TransactionFilters; onChange: (p: Partial<TransactionFilters>) => void }) {
  const data = useData();
  const money = useMoney();
  const today = useToday();
  const [picker, setPicker] = useState<'types' | 'accounts' | 'categories' | 'tags' | null>(null);
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  const range = presetRange(filters.preset, today, filters);
  const tags = useMemo(() => allTags(data), [data]);
  const summarize = (n: number, one: string) => (n === 0 ? undefined : n === 1 ? one : `${n} selected`);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Filters"
      footer={
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button label="Reset" variant="secondary" size="lg" style={{ flex: 1 }} onPress={() => onChange({ ...emptyFilters(), query: filters.query })} />
          <Button label="Show results" size="lg" style={{ flex: 1 }} onPress={onClose} />
        </View>
      }
    >
      <Field label="Date range">
        <View style={styles.wrap}>
          {DATE_PRESETS.map((p) => (
            <Pill key={p.value} label={p.label} size="sm" selected={filters.preset === p.value} onPress={() => onChange({ preset: p.value, ...(p.value === 'custom' ? { from: range.from ?? today, to: range.to ?? today } : {}) })} />
          ))}
        </View>
      </Field>
      {filters.preset === 'custom' && (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <DateField label="From" value={filters.from} onChange={(from) => onChange({ from })} clearable />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label="To" value={filters.to} onChange={(to) => onChange({ to })} clearable />
          </View>
        </View>
      )}
      <PickerButton label="Transaction types" valueLabel={summarize(filters.types.length, TRANSACTION_TYPES[filters.types[0]]?.label)} placeholder="All types" icon="layers" onPress={() => setPicker('types')} />
      <PickerButton label="Accounts" valueLabel={summarize(filters.accountIds.length, data.accounts.find((a) => a.id === filters.accountIds[0])?.name ?? '')} placeholder="All accounts" icon="credit-card" onPress={() => setPicker('accounts')} />
      <PickerButton label="Categories" valueLabel={summarize(filters.categoryIds.length, data.categories.find((c) => c.id === filters.categoryIds[0])?.name ?? '')} placeholder="All categories" icon="tag" onPress={() => setPicker('categories')} />
      <PickerButton label="Tags" valueLabel={filters.tags.length ? filters.tags.map((t) => `#${t}`).join(' ') : undefined} placeholder="Any tags" icon="hash" onPress={() => setPicker('tags')} />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <MoneyField label="Min amount" value={filters.min} onChange={(min) => onChange({ min })} optional />
        </View>
        <View style={{ flex: 1 }}>
          <MoneyField label="Max amount" value={filters.max} onChange={(max) => onChange({ max })} optional />
        </View>
      </View>
      <Field label="Recurring">
        <Segmented items={[{ value: 'any', label: 'Any' }, { value: 'yes', label: 'Recurring' }, { value: 'no', label: 'One-time' }]} value={filters.recurring} onChange={(recurring) => onChange({ recurring })} />
      </Field>
      <Field label="Spending type">
        <Segmented items={[{ value: 'any', label: 'Any' }, { value: 'essential', label: 'Essential' }, { value: 'discretionary', label: 'Discretionary' }]} value={filters.essential} onChange={(essential) => onChange({ essential })} />
      </Field>
      <SwitchRow label="Tax related only" value={filters.taxOnly} onChange={(taxOnly) => onChange({ taxOnly })} icon="file-text" />
      <SwitchRow label="With receipts only" value={filters.receiptsOnly} onChange={(receiptsOnly) => onChange({ receiptsOnly })} icon="paperclip" />

      <SelectSheet
        visible={picker === 'types'}
        onClose={() => setPicker(null)}
        title="Transaction types"
        multiple
        options={(Object.keys(TRANSACTION_TYPES) as TransactionType[]).map((t) => ({ value: t, label: TRANSACTION_TYPES[t].label, icon: icon(TRANSACTION_TYPES[t].icon) }))}
        value={filters.types}
        onSelect={(t) => onChange({ types: toggle(filters.types, t) })}
      />
      <SelectSheet visible={picker === 'accounts'} onClose={() => setPicker(null)} title="Accounts" multiple options={accountOptions(data, today, undefined, true, money)} value={filters.accountIds} onSelect={(id) => onChange({ accountIds: toggle(filters.accountIds, id) })} />
      <SelectSheet visible={picker === 'categories'} onClose={() => setPicker(null)} title="Categories" multiple searchable options={categoryOptions(data, 'all')} value={filters.categoryIds} onSelect={(id) => onChange({ categoryIds: toggle(filters.categoryIds, id) })} />
      <SelectSheet
        visible={picker === 'tags'}
        onClose={() => setPicker(null)}
        title="Tags"
        multiple
        searchable
        options={tags.map((t) => ({ value: t.tag, label: `#${t.tag}`, description: t.count === 1 ? '1 item' : `${t.count} items` }))}
        value={filters.tags}
        onSelect={(tag) => onChange({ tags: toggle(filters.tags, tag) })}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', gap: spacing.sm },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 46, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.ink, height: '100%', outlineStyle: 'none' } as never,
  filterButton: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 46, minWidth: 46, paddingHorizontal: 13, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, justifyContent: 'center' },
  filterActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chips: { gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  summary: { flexDirection: 'row', gap: spacing.xl, paddingHorizontal: spacing.xs, flexWrap: 'wrap' },
});
