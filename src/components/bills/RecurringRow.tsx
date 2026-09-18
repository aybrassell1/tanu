import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { ListRow, Money, Text, VisualTile } from '@/components/ui';
import { recurringVisual } from '@/data/visuals';
import { RECURRING_KINDS } from '@/domain/catalog';
import { relativeDay, relativePhrase } from '@/domain/dates';
import { frequencyLabel, frequencySuffix } from '@/domain/recurrence';
import type { RecurringItem } from '@/domain/types';
import { useData, useToday } from '@/store/hooks';
import { colors } from '@/theme/tokens';

import { nextDueDate } from './helpers';

type Props = {
  item: RecurringItem;
  /** "next" → "Due in 3 days"; "renews" → "renews in 3 days". */
  phrasing?: 'next' | 'renews';
  badge?: ReactNode;
  onPress?: () => void;
};

export function RecurringRow({ item, phrasing = 'next', badge, onPress }: Props) {
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const account = data.accounts.find((a) => a.id === item.accountId);
  const next = item.active ? nextDueDate(data, item, today) : null;
  const when = next ? (phrasing === 'renews' ? `renews ${relativePhrase(next, today)}` : `Due ${relativePhrase(next, today)}`) : item.active ? 'Ended' : 'Paused';
  const subtitle = [frequencyLabel(item.frequency), when, account?.name].filter(Boolean).join(' · ');
  const kind = RECURRING_KINDS[item.kind];

  return (
    <ListRow
      title={item.name}
      subtitle={subtitle}
      leading={<VisualTile {...recurringVisual(item)} />}
      onPress={onPress ?? (() => router.push(`/bills/${item.id}`))}
      accessibilityLabel={`${item.name}, ${kind.label}, ${next ? relativeDay(next, today) : when}`}
      trailing={
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
            <Money cents={item.amount} weight="semibold" color={item.active ? colors.ink : colors.textTertiary} />
            <Text variant="caption" color={colors.textTertiary}>
              {frequencySuffix(item.frequency)}
            </Text>
          </View>
          {item.variable && (
            <Text variant="caption" color={colors.textTertiary}>
              estimate
            </Text>
          )}
          {badge}
        </View>
      }
    />
  );
}
