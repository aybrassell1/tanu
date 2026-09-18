import { StyleSheet, View } from 'react-native';

import { Card, Money, Pill, Text } from '@/components/ui';
import { EmojiIcon } from '@/components/ui/Glyph';
import { ACCOUNT_TYPES } from '@/domain/catalog';
import type { Account, Cents } from '@/domain/types';
import { ACCOUNT_EMOJI } from '@/data/visuals';
import { colors, radius, spacing } from '@/theme/tokens';

/** How far through setup, without making it feel like paperwork. */
export function StepDots({ step, total }: { step: number; total: number }) {
  return (
    <View style={styles.dots} accessibilityLabel={`Step ${step + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.dot, i <= step && styles.dotOn, i === step && styles.dotNow]} />
      ))}
    </View>
  );
}

export function StepTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text variant="h1">{title}</Text>
      {!!subtitle && <Text color={colors.textSecondary}>{subtitle}</Text>}
    </View>
  );
}

/** An account as it was just added, so the list reads back what you typed. */
export function AddedAccount({ account, onPress }: { account: Account; onPress?: () => void }) {
  const info = ACCOUNT_TYPES[account.type];
  return (
    <Card padding={spacing.md} onPress={onPress} accessibilityLabel={`Edit ${account.name}`}>
      <View style={styles.row}>
        <EmojiIcon name={ACCOUNT_EMOJI[account.type]} size={28} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="medium" numberOfLines={1}>
            {account.name}
          </Text>
          <Text variant="caption" color={colors.textTertiary}>
            {info.label}
            {account.dueDay ? ` · due the ${ordinal(account.dueDay)}` : ''}
          </Text>
        </View>
        <Money cents={account.startingBalance} weight="semibold" tone={info.nature === 'liability' ? 'ink' : 'balance'} />
      </View>
    </Card>
  );
}

export function AddedThing({ emoji, name, detail, amount, onPress }: { emoji: string; name: string; detail?: string; amount?: Cents; onPress?: () => void }) {
  return (
    <Card padding={spacing.md} onPress={onPress} accessibilityLabel={`Edit ${name}`}>
      <View style={styles.row}>
        <EmojiIcon name={emoji} size={28} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="medium" numberOfLines={1}>
            {name}
          </Text>
          {!!detail && (
            <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
              {detail}
            </Text>
          )}
        </View>
        {amount !== undefined && <Money cents={amount} weight="semibold" />}
      </View>
    </Card>
  );
}

/** Tappable suggestion, e.g. a bill most people have. */
export function SuggestionChip({ emoji, label, onPress, added }: { emoji: string; label: string; onPress: () => void; added?: boolean }) {
  return (
    <Pill
      label={label}
      emoji={emoji}
      tone={added ? 'positive' : 'light'}
      icon={added ? 'check' : undefined}
      onPress={onPress}
      accessibilityLabel={added ? `${label}, added` : `Add ${label}`}
    />
  );
}

export const ordinal = (day: number) => {
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  return `${day}${suffix}`;
};

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { width: 22, height: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken },
  dotOn: { backgroundColor: colors.primaryMuted },
  dotNow: { backgroundColor: colors.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
