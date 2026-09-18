import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AccountRow } from '@/components/finance/Rows';
import { Button, Card, EmptyState, IconButton, IconTile, ListCard, ListRow, Money, Pill, Screen, ScreenTitle, Section, Text, VisualTile } from '@/components/ui';
import { ASSET_EMOJI } from '@/data/visuals';
import { icon } from '@/data/icons';
import { ACCOUNT_GROUPS, ASSET_TYPES } from '@/domain/catalog';
import { balanceOn, indexLedger } from '@/domain/ledger';
import { sum } from '@/domain/money';
import { assetValueOn, netWorthOn } from '@/domain/position';
import { useData, useToday } from '@/store/hooks';
import { colors, spacing } from '@/theme/tokens';

const LINKS = [
  { label: 'Net worth', icon: 'bar-chart-2', href: '/net-worth' },
  { label: 'Debt', icon: 'trending-down', href: '/debt' },
  { label: 'Savings', icon: 'shield', href: '/savings' },
  { label: 'Investments', icon: 'trending-up', href: '/investments' },
  { label: 'Assets', icon: 'box', href: '/belongings' },
] as const;

export default function MoneyScreen() {
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const [showArchived, setShowArchived] = useState(false);

  const model = useMemo(() => {
    const index = indexLedger(data);
    const nw = netWorthOn(data, today);
    const groups = ACCOUNT_GROUPS.map((g) => {
      const accounts = data.accounts
        .filter((a) => !a.archived && g.types.includes(a.type))
        .map((account) => ({ account, balance: balanceOn(index, account.id, today) }))
        .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
      return { ...g, accounts, total: sum(accounts.map((a) => a.balance)) };
    }).filter((g) => g.accounts.length > 0);
    const archived = data.accounts.filter((a) => a.archived).map((account) => ({ account, balance: balanceOn(index, account.id, today) }));
    const assets = data.assets.filter((a) => !a.archived && !a.soldDate).map((a) => ({ asset: a, value: assetValueOn(a, today) }));
    return { nw, groups, archived, assets };
  }, [data, today]);

  const liability = (group: string) => ['credit', 'loan', 'other_liability'].includes(group);

  return (
    <Screen tabBar>
      <ScreenTitle title="Money" actions={<IconButton icon="plus" variant="dark" accessibilityLabel="Add account" onPress={() => router.push('/accounts/edit')} />} />

      {data.accounts.length === 0 ? (
        <EmptyState
          icon="layers"
          title="Where is your money?"
          message="Add checking, savings, cards, loans and investments. Everything is entered manually; no bank login needed."
          actionLabel="Add account"
          onAction={() => router.push('/accounts/edit')}
        />
      ) : (
        <>
          <Card style={{ gap: spacing.md }} padding={spacing.xl}>
            <View style={styles.split}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="small" color={colors.textSecondary}>
                  You own
                </Text>
                <Money cents={model.nw.assets} variant="h2" />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="small" color={colors.textSecondary}>
                  You owe
                </Text>
                <Money cents={model.nw.liabilities} variant="h2" />
              </View>
            </View>
            <View style={styles.rule} />
            <View style={styles.split}>
              <Text weight="medium" style={{ flex: 1 }}>
                Net worth
              </Text>
              <Money cents={model.nw.netWorth} variant="h3" tone="balance" />
            </View>
          </Card>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {LINKS.map((l) => (
              <Pill key={l.href} label={l.label} icon={l.icon} onPress={() => router.push(l.href)} />
            ))}
          </ScrollView>

          {model.groups.map((g) => (
            <Section
              key={g.group}
              title={g.label}
              accessory={
                <View style={{ alignItems: 'flex-end' }}>
                  <Money cents={g.total} weight="semibold" />
                  {liability(g.group) && (
                    <Text variant="caption" color={colors.textTertiary}>
                      owed
                    </Text>
                  )}
                </View>
              }
            >
              <ListCard>
                {g.accounts.map(({ account, balance }) => (
                  <AccountRow key={account.id} account={account} balance={balance} />
                ))}
              </ListCard>
            </Section>
          ))}

          <Section title="Physical assets" accessory={<Money cents={sum(model.assets.map((a) => a.value))} weight="semibold" />}>
            {model.assets.length === 0 ? (
              <Card variant="muted" style={styles.split}>
                <Text color={colors.textSecondary} style={{ flex: 1 }}>
                  Cars, electronics and valuables count toward net worth.
                </Text>
                <Button label="Add" size="sm" icon="plus" onPress={() => router.push('/belongings/edit')} />
              </Card>
            ) : (
              <ListCard>
                {model.assets.map(({ asset, value }) => (
                  <ListRow key={asset.id} title={asset.name} subtitle={ASSET_TYPES[asset.type].label} leading={<VisualTile emoji={ASSET_EMOJI[asset.type]} />} trailing={<Money cents={value} weight="semibold" />} onPress={() => router.push(`/belongings/${asset.id}`)} />
                ))}
              </ListCard>
            )}
          </Section>

          {model.archived.length > 0 && (
            <View style={{ gap: spacing.md }}>
              <Button label={showArchived ? 'Hide archived accounts' : `Show archived accounts (${model.archived.length})`} variant="ghost" onPress={() => setShowArchived(!showArchived)} style={{ alignSelf: 'center' }} />
              {showArchived && (
                <ListCard>
                  {model.archived.map(({ account, balance }) => (
                    <AccountRow key={account.id} account={account} balance={balance} />
                  ))}
                </ListCard>
              )}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  split: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
