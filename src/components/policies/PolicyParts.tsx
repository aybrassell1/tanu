import { StyleSheet, View } from 'react-native';

import { ListRow, Pill, Text, VisualTile, type PillTone } from '@/components/ui';
import type { IconName } from '@/data/icons';
import { formatDate } from '@/domain/dates';
import { daysUntilRenewal, isWarranty, POLICY_KINDS, policyStatus, yearlyPremium, type PolicyStatus } from '@/domain/policies';
import { frequencySuffix } from '@/domain/recurrence';
import type { ISODate, Policy } from '@/domain/types';
import { useMoney } from '@/store/hooks';
import { colors } from '@/theme/tokens';

/** Status is never colour-only: every pill carries an icon and a word. */
const STATUS_PILL: Record<Exclude<PolicyStatus, 'none'>, { tone: PillTone; icon: IconName; label: string }> = {
  active: { tone: 'positive', icon: 'check-circle', label: 'Active' },
  expiring: { tone: 'warning', icon: 'clock', label: 'Renews soon' },
  expired: { tone: 'negative', icon: 'alert-circle', label: 'Expired' },
};

export function StatusPill({ policy, today, size = 'sm' }: { policy: Policy; today: ISODate; size?: 'sm' | 'md' }) {
  const status = policyStatus(policy, today);
  if (status === 'none') return <Pill tone="muted" size={size} icon="help-circle" label="No date" />;
  const s = STATUS_PILL[status];
  const label = status === 'expiring' && isWarranty(policy.kind) ? 'Expires soon' : s.label;
  return <Pill tone={s.tone} size={size} icon={s.icon} label={label} />;
}

/** "Renews in 42 days", "Expired 12 days ago", or the date when it is far off. */
export function countdownLabel(policy: Policy, today: ISODate): string {
  const days = daysUntilRenewal(policy, today);
  if (days === null) return isWarranty(policy.kind) ? 'No expiry date recorded' : 'No renewal date recorded';
  const verb = isWarranty(policy.kind) ? 'Expires' : 'Renews';
  if (days === 0) return `${verb} today`;
  if (days === 1) return `${verb} tomorrow`;
  if (days > 0) return days <= 60 ? `${verb} in ${days} days` : `${verb} ${formatDate(policy.renewalDate!, 'medium', today)}`;
  const ago = -days;
  return `${isWarranty(policy.kind) ? 'Expired' : 'Lapsed'} ${ago === 1 ? 'yesterday' : `${ago} days ago`} · ${formatDate(policy.renewalDate!, 'medium', today)}`;
}

export function policyEmoji(policy: Pick<Policy, 'kind'>) {
  return POLICY_KINDS[policy.kind].emoji;
}

/** One line in a policy list: what it is, when it ends and what it costs. */
export function PolicyRow({ policy, today, onPress }: { policy: Policy; today: ISODate; onPress: () => void }) {
  const money = useMoney();
  const kind = POLICY_KINDS[policy.kind];
  const yearly = yearlyPremium(policy);
  const subtitle = [kind.label, policy.provider].filter(Boolean).join(' · ');

  return (
    <ListRow
      title={policy.name}
      subtitle={subtitle}
      leading={<VisualTile emoji={kind.emoji} />}
      onPress={onPress}
      accessibilityLabel={`${policy.name}, ${kind.label}, ${countdownLabel(policy, today)}`}
      trailing={
        <View style={styles.trailing}>
          <StatusPill policy={policy} today={today} />
          <Text variant="caption" color={colors.textTertiary} align="right">
            {countdownLabel(policy, today)}
          </Text>
          {!!policy.premium && (
            <Text variant="caption" color={colors.textSecondary} tabular align="right">
              {`${money(policy.premium)}${policy.premiumFrequency ? frequencySuffix(policy.premiumFrequency) : '/yr'}`}
            </Text>
          )}
          {/* Labelled, because this sits where a premium sits on the rows above. */}
          {!policy.premium && yearly === 0 && policy.coverage !== undefined && (
            <Text variant="caption" color={colors.textSecondary} tabular align="right">
              {`${money(policy.coverage)} cover`}
            </Text>
          )}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  trailing: { alignItems: 'flex-end', gap: 3, maxWidth: 180 },
});
