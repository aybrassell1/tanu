import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { GradeBadge } from '@/components/places/Parts';
import { Button, Card, EmptyState, IconButton, Money, NavHeader, Pill, Row, Screen, Section, StatTile, Text } from '@/components/ui';
import { financialSnapshot } from '@/domain/affordability';
import { PLACE_STATUS, checklistProgress, placeHighlights, rankPlaces } from '@/domain/places';
import { useData, useDerived, useMoney } from '@/store/hooks';
import { colors, spacing } from '@/theme/tokens';

/**
 * Everywhere you toured, best grade first. The point of the list is the
 * comparison: same rent can mean a very different monthly cost once parking,
 * pet rent and the utilities you pay are counted.
 */
export default function PlacesScreen() {
  const router = useRouter();
  const data = useData();
  const money = useMoney();
  const snapshot = useDerived(financialSnapshot);
  const ranked = rankPlaces(snapshot, data.places);
  const highlights = placeHighlights(ranked);
  const add = () => router.push('/places/edit');

  return (
    <Screen header={<NavHeader title="Apartment tours" right={<IconButton icon="plus" accessibilityLabel="Add a place" onPress={add} />} />}>
      {ranked.length === 0 ? (
        <EmptyState
          icon="key"
          title="No tours yet"
          message="Add a place before you go and the questions worth asking are in your hand. Costs, answers and ratings save as you tap."
          actionLabel="Add a place"
          onAction={add}
        />
      ) : (
        <>
          <View style={styles.tiles}>
            <StatTile label="Places toured" value={String(ranked.length)} icon="key" />
            <StatTile
              label="Cheapest, all in"
              value={<Money cents={highlights.cheapest?.score.cost.monthly ?? 0} variant="h3" whole />}
              icon="trending-down"
              caption={highlights.spread > 0 ? `${money(highlights.spread, { whole: true })} between cheapest and dearest` : undefined}
            />
          </View>

          {ranked.map(({ place, score }) => {
            const progress = checklistProgress(place);
            return (
              <Card key={place.id} style={{ gap: spacing.sm }} onPress={() => router.push(`/places/${place.id}`)} accessibilityLabel={`${place.name}, grade ${score.grade}`}>
                <Row>
                  <GradeBadge grade={score.grade} size={44} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="h3" numberOfLines={1}>
                      {place.name}
                    </Text>
                    <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
                      {place.address || `${progress.answered} of ${progress.total} questions recorded`}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Money cents={score.cost.monthly} variant="h3" whole />
                    <Text variant="caption" color={colors.textTertiary}>
                      a month
                    </Text>
                  </View>
                </Row>
                <Row>
                  <Pill size="sm" tone={PLACE_STATUS[place.status].tone} label={PLACE_STATUS[place.status].label} />
                  <Pill size="sm" label={`Rent ${money(place.rent, { whole: true })}`} />
                  {score.cost.aboveRent > 0 && <Pill size="sm" icon="plus" label={`${money(score.cost.aboveRent, { whole: true })} of fees`} />}
                </Row>
              </Card>
            );
          })}

          <Section title="Reading the grade">
            <Card variant="muted" style={{ gap: spacing.xs }}>
              <Text variant="small" color={colors.textSecondary}>
                55 points for whether you can carry it, 25 for how you rated the place, 20 for the answers you got. A question you have not asked never counts against a place.
              </Text>
              <Text variant="caption" color={colors.textTertiary}>
                Rules of thumb against your own income and spending, not advice.
              </Text>
            </Card>
          </Section>

          <Button label="Add another place" icon="plus" variant="secondary" fullWidth onPress={add} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing.md },
});
