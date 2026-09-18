import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { TransactionRow } from '@/components/finance/Rows';
import { Button, EmptyState, IconButton, IconTile, ListCard, ListRow, Money, Pill, Screen, Section, Text } from '@/components/ui';
import type { IconName } from '@/data/icons';
import { indexLedger } from '@/domain/ledger';
import { allTags, searchLedger, type SearchKind, type SearchResult } from '@/domain/search';
import { goBackOr } from '@/lib/navigation';
import { useData } from '@/store/hooks';
import { colors, fonts, radius, spacing } from '@/theme/tokens';

const KIND: Record<SearchKind, { label: string; icon: IconName }> = {
  transaction: { label: 'Transactions', icon: 'list' },
  account: { label: 'Accounts', icon: 'credit-card' },
  debt: { label: 'Debts', icon: 'trending-down' },
  bill: { label: 'Bills & recurring', icon: 'file-text' },
  subscription: { label: 'Subscriptions', icon: 'refresh-cw' },
  income: { label: 'Income sources', icon: 'briefcase' },
  goal: { label: 'Goals', icon: 'flag' },
  asset: { label: 'Assets', icon: 'box' },
  category: { label: 'Categories', icon: 'tag' },
  scenario: { label: 'Scenarios', icon: 'git-branch' },
};

const ORDER: SearchKind[] = ['account', 'debt', 'bill', 'subscription', 'income', 'goal', 'asset', 'category', 'scenario', 'transaction'];

export default function SearchScreen() {
  const params = useLocalSearchParams<{ q?: string }>();
  const router = useRouter();
  const data = useData();
  const [query, setQuery] = useState(params.q ?? '');
  const index = indexLedger(data);

  const results = useMemo(() => searchLedger(data, query), [data, query]);
  const tags = useMemo(() => allTags(data).slice(0, 24), [data]);
  const grouped = ORDER.map((kind) => ({ kind, items: results.filter((r) => r.kind === kind) })).filter((g) => g.items.length);

  const open = (r: SearchResult) => router.push(r.href as never);

  return (
    <Screen
      header={
        <View style={styles.header}>
          <IconButton icon="chevron-left" accessibilityLabel="Back" onPress={() => goBackOr(router, '/')} />
          <View style={styles.search}>
            <Feather name="search" size={17} color={colors.textTertiary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              autoFocus
              placeholder="Search everything, or #tag"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search everything"
            />
            {!!query && (
              <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
                <Feather name="x" size={16} color={colors.textTertiary} />
              </Pressable>
            )}
          </View>
        </View>
      }
    >
      {!query.trim() ? (
        <Section title="Browse by tag" subtitle="Tags connect transactions, bills, goals and assets.">
          {tags.length === 0 ? (
            <Text color={colors.textSecondary}>No tags yet. Add tags like #car, #moving or #tax to transactions and bills.</Text>
          ) : (
            <View style={styles.wrap}>
              {tags.map((t) => (
                <Pill key={t.tag} label={`#${t.tag} · ${t.count}`} tone="primary" onPress={() => setQuery(`#${t.tag}`)} />
              ))}
            </View>
          )}
        </Section>
      ) : results.length === 0 ? (
        <EmptyState icon="search" title="Nothing found" message="Try another word, an amount like 42.50, or a #tag." />
      ) : (
        grouped.map((g) => (
          <Section key={g.kind} title={`${KIND[g.kind].label} (${g.items.length}${g.items.length >= 50 ? '+' : ''})`}>
            <ListCard>
              {g.kind === 'transaction'
                ? g.items.slice(0, 25).map((r) => {
                    const tx = index.transactions.get(r.id);
                    return tx ? <TransactionRow key={r.id} tx={tx} showDate /> : null;
                  })
                : g.items.map((r) => (
                    <ListRow
                      key={`${r.kind}:${r.id}`}
                      title={r.title}
                      subtitle={[r.subtitle, r.matched && r.matched !== 'name' ? `matched ${r.matched}` : null].filter(Boolean).join(' · ')}
                      leading={<IconTile icon={KIND[r.kind].icon} size={36} />}
                      trailing={r.amount !== undefined ? <Money cents={r.amount} weight="semibold" /> : undefined}
                      chevron
                      onPress={() => open(r)}
                    />
                  ))}
            </ListCard>
            {g.kind === 'transaction' && g.items.length > 25 && (
              <Button label="See all in Activity" variant="secondary" fullWidth onPress={() => router.push({ pathname: '/transactions', params: { q: query } })} />
            )}
          </Section>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.ink, height: '100%', outlineStyle: 'none' } as never,
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
