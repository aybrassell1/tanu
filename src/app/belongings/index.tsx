import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ChangeLabel, isOwned, latestValuation } from '@/components/assets/Change';
import { EmptyState, IconButton, IconTile, ListCard, ListRow, Money, NavHeader, Screen, Section, StatTile, Text, VisualTile } from '@/components/ui';
import { ASSET_EMOJI } from '@/data/visuals';
import { icon } from '@/data/icons';
import { ASSET_TYPES } from '@/domain/catalog';
import { formatDate } from '@/domain/dates';
import { balanceOn, indexLedger } from '@/domain/ledger';
import { sum } from '@/domain/money';
import { assetValueOn } from '@/domain/position';
import type { Asset, Cents } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { colors, spacing } from '@/theme/tokens';

export default function AssetsScreen() {
  const router = useRouter();
  const data = useData();
  const today = useToday();

  const model = useMemo(() => {
    const index = indexLedger(data);
    const owned = data.assets.filter((a) => isOwned(a, today)).sort((a, b) => assetValueOn(b, today) - assetValueOn(a, today));
    const past = data.assets.filter((a) => !isOwned(a, today)).sort((a, b) => (b.soldDate ?? '').localeCompare(a.soldDate ?? ''));
    const value = sum(owned.map((a) => assetValueOn(a, today)));
    const priced = owned.filter((a) => a.purchasePrice !== undefined);
    const paid = sum(priced.map((a) => a.purchasePrice ?? 0));
    const pricedValue = sum(priced.map((a) => assetValueOn(a, today)));
    const loanBalance = (a: Asset): Cents | null => (a.linkedLiabilityId && index.accounts.has(a.linkedLiabilityId) ? balanceOn(index, a.linkedLiabilityId, today) : null);
    return { owned, past, value, paid, change: pricedValue - paid, pricedCount: priced.length, loanBalance };
  }, [data, today]);

  const add = () => router.push('/belongings/edit');
  const header = <NavHeader title="Assets" right={<IconButton icon="plus" accessibilityLabel="Add asset" onPress={add} />} />;

  if (data.assets.length === 0) {
    return (
      <Screen header={header}>
        <EmptyState icon="box" title="No assets yet" message="Track things like your car, computer or jewelry. They count toward net worth." actionLabel="Add an asset" onAction={add} />
      </Screen>
    );
  }

  return (
    <Screen header={header}>
      <View style={styles.tiles}>
        <StatTile label="Value" icon="box" value={<Money cents={model.value} variant="h3" compact />} caption={`${model.owned.length} owned`} />
        <StatTile label="Paid" icon="shopping-bag" value={<Money cents={model.paid} variant="h3" compact />} caption={model.pricedCount < model.owned.length ? `${model.pricedCount} with a price` : undefined} />
        <StatTile label="Change" icon="activity" value={<ChangeLabel cents={model.change} pct={model.paid > 0 ? model.change / model.paid : null} variant="body" muted />} caption="vs what you paid" />
      </View>

      <Section title="What you own">
        {model.owned.length === 0 ? (
          <EmptyState compact icon="box" title="Nothing owned right now" message="Everything here is sold or archived." actionLabel="Add an asset" onAction={add} />
        ) : (
          <ListCard>
            {model.owned.map((a) => (
              <AssetRow key={a.id} asset={a} loanBalance={model.loanBalance(a)} onPress={() => router.push(`/belongings/${a.id}`)} />
            ))}
          </ListCard>
        )}
      </Section>

      {model.past.length > 0 && (
        <Section title="Sold or archived">
          <ListCard>
            {model.past.map((a) => (
              <AssetRow key={a.id} asset={a} loanBalance={null} past onPress={() => router.push(`/belongings/${a.id}`)} />
            ))}
          </ListCard>
        </Section>
      )}
    </Screen>
  );
}

function AssetRow({ asset, loanBalance, past, onPress }: { asset: Asset; loanBalance: Cents | null; past?: boolean; onPress: () => void }) {
  const today = useToday();
  const money = useMoney();
  const type = ASSET_TYPES[asset.type];
  const value = past ? (latestValuation(asset, asset.soldDate ?? today)?.value ?? 0) : assetValueOn(asset, today);
  const subtitle = [type.label, past ? (asset.soldDate ? `sold ${formatDate(asset.soldDate, 'short', today)}` : 'archived') : asset.purchaseDate ? `bought ${formatDate(asset.purchaseDate, 'short', today)}` : null]
    .filter(Boolean)
    .join(' · ');
  const change = asset.purchasePrice !== undefined ? value - asset.purchasePrice : null;

  return (
    <ListRow
      title={asset.name}
      subtitle={subtitle}
      leading={<VisualTile emoji={ASSET_EMOJI[asset.type]} />}
      onPress={onPress}
      accessibilityLabel={`${asset.name}, ${money(value)}`}
      trailing={
        <View style={styles.trailing}>
          <Money cents={value} weight="semibold" color={past ? colors.textSecondary : undefined} />
          {change !== null && !past && <ChangeLabel cents={change} pct={asset.purchasePrice ? change / asset.purchasePrice : null} variant="caption" />}
          {loanBalance !== null && (
            <Text variant="caption" color={colors.textTertiary} tabular>
              Equity {money(value - loanBalance)}
            </Text>
          )}
          {past && (
            <Text variant="caption" color={colors.textTertiary}>
              Last value
            </Text>
          )}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  trailing: { alignItems: 'flex-end', gap: 2, maxWidth: 170 },
});
