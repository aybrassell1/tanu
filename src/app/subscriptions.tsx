import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { USAGE_BADGE } from '@/components/bills/helpers';
import { RecurringRow } from '@/components/bills/RecurringRow';
import { Banner, Button, Card, EmptyState, HBarList, IconButton, ListCard, ListRow, Money, NavHeader, Pill, Screen, Section, StatTile, StatusBadge, Text, useOverlay } from '@/components/ui';
import { addDays, formatDate, relativePhrase } from '@/domain/dates';
import { sum } from '@/domain/money';
import { detectPriceChanges, priceChangePhrase, type PriceChange } from '@/domain/priceChanges';
import { annualEquivalent, frequencySuffix, monthlyEquivalent } from '@/domain/recurrence';
import type { RecurringItem } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

const STALE_DAYS = 60;

export default function SubscriptionsScreen() {
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { confirm, toast } = useOverlay();

  // Price creep is measured from real charges, so it also catches things that
  // aren't tracked as subscriptions yet (a payee that quietly raised its rate).
  const prices = useMemo(() => detectPriceChanges(data, today), [data, today]);

  const model = useMemo(() => {
    // What each item is really charged today, where that was measured. Totals
    // use it, so a saved amount nobody updated can't quietly understate them.
    const charged = new Map<string, number>();
    for (const change of [...prices.increases, ...prices.decreases]) {
      if (change.sourceId && !change.variable) charged.set(change.sourceId, change.current);
    }
    const amountOf = (r: RecurringItem) => charged.get(r.id) ?? r.amount;
    const monthly = (r: RecurringItem) => monthlyEquivalent(amountOf(r), r.frequency);
    const all = data.recurring.filter((r) => r.kind === 'subscription');
    const active = all.filter((r) => r.active).sort((a, b) => monthly(b) - monthly(a));
    const staleBefore = addDays(today, -STALE_DAYS);
    const review = active.filter((r) => r.usage === 'rarely' || r.usage === 'never' || (!!r.lastUsed && r.lastUsed < staleBefore));
    return {
      all,
      active,
      inactive: all.filter((r) => !r.active),
      review,
      charged,
      amountOf,
      outdated: active.filter((r) => charged.has(r.id) && charged.get(r.id) !== r.amount),
      monthly: sum(active.map(monthly)),
      yearly: sum(active.map((r) => annualEquivalent(amountOf(r), r.frequency))),
      reviewYearly: sum(review.map((r) => annualEquivalent(amountOf(r), r.frequency))),
      staleBefore,
    };
  }, [data, today, prices]);

  /** The recurring item behind a price change, when its saved amount is wrong. */
  const outdatedItem = (change: PriceChange) => {
    if (!change.sourceId || change.variable) return undefined;
    const item = data.recurring.find((r) => r.id === change.sourceId);
    return item && item.active && item.amount !== change.current ? item : undefined;
  };

  const add = () => router.push({ pathname: '/bills/edit', params: { kind: 'subscription' } });

  const cancel = async (item: RecurringItem) => {
    const ok = await confirm({
      title: `Cancel ${item.name}?`,
      message: `This stops tracking future charges and saves ${money(annualEquivalent(item.amount, item.frequency))} a year. Remember to cancel with the provider too. Past payments stay in your history.`,
      confirmLabel: 'Mark cancelled',
      destructive: true,
    });
    if (!ok) return;
    const result = ledger.saveRecurring({ ...item, active: false });
    if (!result.ok) return toast({ message: Object.values(result.errors)[0] ?? 'Could not update.', tone: 'error' });
    toast({ message: 'Marked as cancelled', actionLabel: 'Undo', onAction: () => ledger.saveRecurring({ ...item, active: true }) });
  };

  /** Bring the saved amount into line with what the charges actually say. */
  const updateAmount = async (item: RecurringItem, next: number) => {
    const ok = await confirm({
      title: `Update ${item.name} to ${money(next)}?`,
      message: `It is saved as ${money(item.amount)}${frequencySuffix(item.frequency)}, but ${money(next)} is what you have been charged. Past transactions are left alone — only the amount expected from now on changes.`,
      confirmLabel: 'Update amount',
    });
    if (!ok) return;
    const previous = item.amount;
    const result = ledger.saveRecurring({ ...item, amount: next });
    if (!result.ok) return toast({ message: Object.values(result.errors)[0] ?? 'Could not update.', tone: 'error' });
    toast({ message: `${item.name} is now ${money(next)}`, actionLabel: 'Undo', onAction: () => ledger.saveRecurring({ ...item, amount: previous }) });
  };

  const reason = (r: RecurringItem) => {
    if (r.usage === 'never') return 'You said you never use it';
    if (r.usage === 'rarely') return 'You said you rarely use it';
    return r.lastUsed ? `Last used ${relativePhrase(r.lastUsed, today)}` : '';
  };

  return (
    <Screen header={<NavHeader title="Subscriptions" right={<IconButton icon="plus" accessibilityLabel="Add subscription" onPress={add} />} />}>
      {model.all.length === 0 ? (
        <EmptyState icon="refresh-cw" title="No subscriptions yet" message="Add streaming, apps and memberships to see what they really cost per year." actionLabel="Add subscription" onAction={add} />
      ) : (
        <>
          <View style={styles.tiles}>
            <StatTile label="Monthly cost" icon="calendar" value={<Money cents={model.monthly} variant="h3" />} caption="Average per month" />
            <StatTile label="Yearly cost" icon="repeat" value={<Money cents={model.yearly} variant="h3" whole />} />
            <StatTile label="Active" icon="check-circle" value={String(model.active.length)} caption={model.inactive.length ? `${model.inactive.length} cancelled` : undefined} />
          </View>
          {model.outdated.length > 0 && (
            <Text variant="caption" color={colors.textTertiary}>
              {`These totals use what you are actually charged. ${model.outdated.length === 1 ? `The saved amount for ${model.outdated[0].name} is out of date` : `${model.outdated.length} saved amounts are out of date`} — you can fix ${model.outdated.length === 1 ? 'it' : 'them'} under Price changes.`}
            </Text>
          )}

          <Section title="Price changes" subtitle="What you actually paid, now against 6 and 12 months ago">
            {prices.increases.length === 0 && prices.decreases.length === 0 ? (
              <EmptyState
                compact
                icon="check-circle"
                title="No price rises found"
                message={
                  prices.watched > 0
                    ? `Checked ${prices.watched} recurring ${prices.watched === 1 ? 'charge' : 'charges'} against their own history. Seasonal bills are compared season for season.`
                    : 'Once a charge has been recorded a few times, its price history shows up here.'
                }
                actionLabel="Add subscription"
                onAction={add}
              />
            ) : (
              <>
                {prices.yearlyIncrease > 0 && (
                  <Banner
                    tone="warning"
                    icon="trending-up"
                    title={`Price rises add ${money(prices.yearlyIncrease)} a year`}
                    message={
                      prices.lowUsage.length
                        ? `${prices.lowUsage.length} of them went up on something you said you rarely use.`
                        : 'Measured from the charges on your ledger, not the amount you entered.'
                    }
                  />
                )}
                {prices.increases.length > 0 && (
                  <ListCard>
                    {prices.increases.map((change) => (
                      <PriceRow key={change.key} change={change} today={today} outdated={outdatedItem(change)} onUpdate={updateAmount} onOpen={change.sourceId ? () => router.push(`/bills/${change.sourceId}`) : undefined} />
                    ))}
                  </ListCard>
                )}
                {prices.decreases.length > 0 && (
                  <>
                    <Text variant="caption" color={colors.textTertiary}>
                      {`GOOD NEWS · ${money(prices.yearlyDecrease)} A YEAR CHEAPER`}
                    </Text>
                    <ListCard>
                      {prices.decreases.map((change) => (
                        <PriceRow key={change.key} change={change} today={today} outdated={outdatedItem(change)} onUpdate={updateAmount} onOpen={change.sourceId ? () => router.push(`/bills/${change.sourceId}`) : undefined} />
                      ))}
                    </ListCard>
                  </>
                )}
              </>
            )}
          </Section>

          {model.review.length > 0 && (
            <Section title="Might not be worth it" subtitle={`Rarely used, or not used in ${STALE_DAYS}+ days`}>
              <Banner tone="warning" icon="scissors" title={`Cancelling these would save ${money(model.reviewYearly)}/year`} message="Based on the usage you've logged." />
              <ListCard>
                {model.review.map((r) => (
                  <View key={r.id} style={styles.reviewRow}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text weight="medium" numberOfLines={1} onPress={() => router.push(`/bills/${r.id}`)} suppressHighlighting>
                        {r.name}
                      </Text>
                      <Text variant="small" color={colors.textTertiary} numberOfLines={1}>
                        {[`${money(r.amount)}${frequencySuffix(r.frequency)}`, reason(r)].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <Button label="Cancel" size="sm" variant="danger" onPress={() => cancel(r)} />
                  </View>
                ))}
              </ListCard>
            </Section>
          )}

          {model.active.length > 0 && (
            <Section title="Where does it go?" subtitle="Monthly equivalent per subscription">
              <Card>
                <HBarList
                  items={model.active.slice(0, 8).map((r) => {
                    const m = monthlyEquivalent(model.amountOf(r), r.frequency);
                    return { key: r.id, label: r.name, value: m, valueLabel: `${money(m)}/mo`, onPress: () => router.push(`/bills/${r.id}`) };
                  })}
                />
              </Card>
            </Section>
          )}

          <Section title="All subscriptions" subtitle={model.active.length ? 'Most expensive first' : undefined}>
            {model.active.length === 0 ? (
              <EmptyState compact icon="refresh-cw" title="No active subscriptions" message="Everything here is cancelled or paused." actionLabel="Add subscription" onAction={add} />
            ) : (
              <ListCard>
                {model.active.map((r) => {
                  const stale = !!r.lastUsed && r.lastUsed < model.staleBefore;
                  const badge = r.usage ? USAGE_BADGE[r.usage] : stale ? { tone: 'warning' as const, label: 'Not used lately' } : null;
                  // The row shows the saved amount; say so when it is no
                  // longer what the charges on file actually add up to.
                  const now = model.charged.get(r.id);
                  const priceBadge = now !== undefined && now !== r.amount ? <StatusBadge tone={now > r.amount ? 'warning' : 'positive'} label={`Charged ${money(now)}`} /> : null;
                  return (
                    <RecurringRow
                      key={r.id}
                      item={r}
                      phrasing="renews"
                      badge={
                        priceBadge || badge ? (
                          <>
                            {priceBadge}
                            {badge && <StatusBadge tone={badge.tone} label={badge.label} />}
                          </>
                        ) : undefined
                      }
                    />
                  );
                })}
              </ListCard>
            )}
          </Section>

          {model.inactive.length > 0 && (
            <Section title="Cancelled / paused" subtitle="Not counted in totals">
              <ListCard>
                {model.inactive.map((r) => (
                  <RecurringRow key={r.id} item={r} />
                ))}
              </ListCard>
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}

type PriceRowProps = {
  change: PriceChange;
  today: string;
  /** Set when this item's saved amount no longer matches the real charges. */
  outdated?: RecurringItem;
  onUpdate?: (item: RecurringItem, next: number) => void;
  onOpen?: () => void;
};

/** One detected price change: what it was, what it is, and what that costs a year. */
function PriceRow({ change, today, outdated, onUpdate, onOpen }: PriceRowProps) {
  const money = useMoney();
  const up = change.direction === 'up';
  const when = change.changedOn
    ? `since ${formatDate(change.changedOn, 'short', today)}`
    : change.variable
      ? 'typical bill, season for season'
      : '';
  return (
    <View>
      <ListRow
        icon={up ? 'trending-up' : 'trending-down'}
        iconColor={up ? colors.warning : colors.positive}
        title={change.name}
        subtitle={[priceChangePhrase(change, money), when].filter(Boolean).join(' · ')}
        trailing={
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Money cents={change.yearlyImpact} signed weight="semibold" />
            {change.lowUsage ? <StatusBadge tone="warning" label="Rarely used" /> : <Pill label="Per year" tone="muted" size="sm" />}
          </View>
        }
        onPress={onOpen}
        chevron={!!onOpen}
        accessibilityLabel={`${change.name}: ${priceChangePhrase(change, money)}, ${money(Math.abs(change.yearlyImpact))} ${up ? 'more' : 'less'} a year`}
      />
      {outdated && onUpdate && (
        <View style={styles.updateRow}>
          <Text variant="small" color={colors.textTertiary} style={{ flex: 1 }}>
            {`Saved as ${money(outdated.amount)}${frequencySuffix(outdated.frequency)}`}
          </Text>
          <Button label={`Update to ${money(change.current)}`} size="sm" variant="secondary" onPress={() => onUpdate(outdated, change.current)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing.sm },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 12 },
  updateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', paddingBottom: 12, marginTop: -4 },
});
