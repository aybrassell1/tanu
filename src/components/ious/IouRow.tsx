import { View } from 'react-native';

import { ListRow, Money, Pill, Text, VisualTile } from '@/components/ui';
import { formatDate } from '@/domain/dates';
import { iouBalance, isOverdue, type IouDirection, type IouPerson } from '@/domain/ious';
import type { Iou, ISODate } from '@/domain/types';
import { useMoney } from '@/store/hooks';
import { colors } from '@/theme/tokens';

/** Illustrations for the two sides. Both names exist in the generated emoji set. */
export const IOU_EMOJI: Record<IouDirection, string> = { owed_to_me: 'open-hands', i_owe: 'money-with-wings' };
export const IOU_SETTLED_EMOJI = 'check-mark-button';
export const IOU_PEOPLE_EMOJI = 'people-hugging';

export const DIRECTION_LABEL: Record<IouDirection, string> = { owed_to_me: 'They owe you', i_owe: 'You owe' };
export const DIRECTION_SHORT: Record<IouDirection, string> = { owed_to_me: 'Owed to you', i_owe: 'You owe' };

/** "Lent to Sam" / "Borrowed from Mom" — the plain-words version of a direction. */
export const directionPhrase = (direction: IouDirection, person: string) => (direction === 'owed_to_me' ? `Lent to ${person}` : `Borrowed from ${person}`);

export function IouRow({ iou, today, onPress, showPerson }: { iou: Iou; today: ISODate; onPress?: () => void; showPerson?: boolean }) {
  const money = useMoney();
  const balance = iouBalance(iou);
  const settled = balance.outstanding === 0;
  const overdue = isOverdue(iou, today);

  // Without a reason, say what happened ("Lent to Alex") rather than repeating
  // the direction already shown by the trailing label.
  const title = iou.reason?.trim() || directionPhrase(iou.direction, iou.person);
  const subtitle = [
    showPerson && iou.reason?.trim() ? iou.person : null,
    formatDate(iou.date, 'short', today),
    settled ? 'Settled' : balance.repaid > 0 ? `${money(balance.repaid)} of ${money(balance.amount)} back` : null,
    !settled && iou.dueDate && !overdue ? `due ${formatDate(iou.dueDate, 'short', today)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ListRow
      title={title}
      subtitle={subtitle || undefined}
      leading={<VisualTile emoji={settled ? IOU_SETTLED_EMOJI : IOU_EMOJI[iou.direction]} size={36} />}
      chevron={!!onPress}
      onPress={onPress}
      accessibilityLabel={`${directionPhrase(iou.direction, iou.person)}, ${money(settled ? balance.amount : balance.outstanding)}${overdue ? ', overdue' : ''}`}
      trailing={
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Money cents={settled ? balance.amount : balance.outstanding} weight="semibold" color={settled ? colors.textTertiary : colors.ink} />
          {overdue ? (
            <Pill size="sm" tone="negative" icon="alert-circle" label="Overdue" />
          ) : (
            <Text variant="caption" color={colors.textTertiary}>
              {settled ? 'Settled' : DIRECTION_SHORT[iou.direction]}
            </Text>
          )}
        </View>
      }
    />
  );
}

/** One person's net position across everything still open with them. */
export function PersonRow({ person, onPress }: { person: IouPerson; onPress?: () => void }) {
  const money = useMoney();
  const both = person.owedToMe > 0 && person.iOwe > 0;
  const netLabel = person.net === 0 ? 'Even' : person.net > 0 ? 'Owes you' : 'You owe';
  const detail = both ? `${money(person.owedToMe)} owed to you · ${money(person.iOwe)} you owe` : `${person.ious.length} open ${person.ious.length === 1 ? 'IOU' : 'IOUs'}`;

  return (
    <ListRow
      title={person.person}
      subtitle={detail}
      leading={<VisualTile emoji={IOU_PEOPLE_EMOJI} size={36} />}
      chevron={!!onPress}
      onPress={onPress}
      accessibilityLabel={`${person.person}: ${netLabel} ${money(Math.abs(person.net))}`}
      trailing={
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Money cents={Math.abs(person.net)} weight="semibold" color={person.net === 0 ? colors.textTertiary : colors.ink} />
          {person.overdue > 0 ? (
            <Pill size="sm" tone="negative" icon="alert-circle" label={person.overdue === 1 ? 'Overdue' : `${person.overdue} overdue`} />
          ) : (
            <Text variant="caption" color={colors.textTertiary}>
              {netLabel}
            </Text>
          )}
        </View>
      }
    />
  );
}
