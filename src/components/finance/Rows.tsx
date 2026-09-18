import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { Button, IconTile, ListRow, Money, Pill, StatusBadge, Text } from '@/components/ui';
import { icon } from '@/data/icons';
import { ACCOUNT_EMOJI, brandFor, categoryEmoji } from '@/data/visuals';
import { VisualTile } from '@/components/ui/Glyph';
import { ACCOUNT_TYPES, isCreditCard, RECURRING_KINDS, TRANSACTION_TYPES } from '@/domain/catalog';
import { categoryPath } from '@/domain/categories';
import { formatDate, parseISODate, relativeDay, WEEKDAYS, dayOfWeek } from '@/domain/dates';
import { creditInfo, indexLedger } from '@/domain/ledger';
import type { ScheduledEvent } from '@/domain/schedule';
import type { Account, Cents, Transaction } from '@/domain/types';
import { useData, useMoney, useSettings, useToday } from '@/store/hooks';
import { isDark } from '@/theme/applyTheme';
import { DARK, LIGHT } from '@/theme/palette';
import { colors, nativePalette, radius, spacing, tintOf } from '@/theme/tokens';

import { ProgressBar } from '../ui/Progress';

// ─── Colours saved with the data ─────────────────────────────────────────────

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
const relLuminance = (hex: string) => {
  const step = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : Math.pow((v / 255 + 0.055) / 1.055, 2.4));
  return 0.2126 * step(channel(hex, 0)) + 0.7152 * step(channel(hex, 1)) + 0.0722 * step(channel(hex, 2));
};
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const blend = (hex: string, toward: string, amount: number) =>
  `#${[0, 1, 2].map((i) => Math.round(channel(hex, i) + (channel(toward, i) - channel(hex, i)) * amount).toString(16).padStart(2, '0')).join('')}`;

/**
 * An account, category or goal colour is a fixed hex saved with the user's
 * data, so one picked in the light theme (the near-black card default) can be
 * invisible as a line or bar on a dark surface — and the other way round. Lift
 * it toward the theme's ink until it reads as a mark again; a colour that
 * already contrasts comes back untouched.
 */
export function useMarkColor(): (hex: string) => string {
  const choice = useSettings().theme ?? 'system';
  // Native resolves its palette once at launch; only the web follows the choice.
  const palette = Platform.OS === 'web' ? (isDark(choice) ? DARK : LIGHT) : nativePalette;
  return (hex: string) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
    const surface = relLuminance(palette.surface);
    if (contrast(relLuminance(hex), surface) >= 2) return hex;
    for (let amount = 0.2; amount <= 0.8; amount += 0.1) {
      const lifted = blend(hex, palette.ink, amount);
      if (contrast(relLuminance(lifted), surface) >= 3) return lifted;
    }
    return colors.primary;
  };
}

/** Signed amount as it affects the user: + income, − spending, neutral moves. */
export function transactionDisplay(tx: Transaction): { cents: Cents; signed: boolean; color: string; prefix?: string } {
  switch (tx.type) {
    case 'income':
    case 'refund':
    case 'reimbursement':
      return { cents: tx.amount, signed: true, color: colors.positive };
    case 'expense':
    case 'interest':
      return { cents: -tx.amount, signed: true, color: colors.ink };
    case 'adjustment':
      return { cents: tx.amount, signed: true, color: colors.textSecondary };
    default:
      return { cents: tx.amount, signed: false, color: colors.textSecondary };
  }
}

export function TransactionRow({ tx, showDate, onPress }: { tx: Transaction; showDate?: boolean; onPress?: () => void }) {
  const data = useData();
  const today = useToday();
  const router = useRouter();
  const markColor = useMarkColor();
  const index = indexLedger(data);
  const info = TRANSACTION_TYPES[tx.type];
  const account = index.accounts.get(tx.accountId);
  const to = tx.toAccountId ? index.accounts.get(tx.toAccountId) : undefined;
  const category = tx.categoryId ? index.categories.get(tx.categoryId) : undefined;
  const display = transactionDisplay(tx);

  const splitCount = tx.splits?.length ?? 0;
  const categoryLabel = splitCount > 1 ? `Split · ${splitCount} categories` : categoryPath(index.categories, tx.categoryId);
  const subtitleParts = [
    info.twoAccounts ? `${account?.name ?? '?'} → ${to?.name ?? '?'}` : tx.type === 'adjustment' ? `${info.label} · ${account?.name ?? ''}` : `${categoryLabel} · ${account?.name ?? ''}`,
  ];
  if (showDate) subtitleParts.unshift(formatDate(tx.date, 'short', today));

  const tileIcon = info.twoAccounts || tx.type === 'adjustment' || !category ? icon(info.icon) : icon(category.icon);
  const tileColor = info.twoAccounts || tx.type === 'adjustment' ? colors.textSecondary : tx.type === 'income' ? colors.positive : category ? markColor(category.color) : colors.primary;
  const brand = info.twoAccounts || tx.type === 'adjustment' ? null : brandFor(tx.payee, tx.description);
  const emoji = info.twoAccounts || tx.type === 'adjustment' ? null : categoryEmoji(tx.categoryId);
  const leading = brand || emoji ? <VisualTile brand={brand} emoji={emoji} /> : <IconTile icon={tileIcon} color={tileColor} />;

  return (
    <ListRow
      title={tx.payee || tx.description || info.label}
      subtitle={subtitleParts.join(' · ')}
      leading={leading}
      onPress={onPress ?? (() => router.push(`/transactions/${tx.id}`))}
      accessibilityLabel={`${tx.payee || tx.description}, ${info.label}`}
      trailing={
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Money cents={display.cents} signed={display.signed} color={display.color} weight="semibold" />
          <View style={styles.flags}>
            {tx.date > today && <Pill label="Scheduled" size="sm" tone="projected" />}
            {!!tx.recurringId && <Feather name="repeat" size={11} color={colors.textTertiary} />}
            {tx.attachments.length > 0 && <Feather name="paperclip" size={11} color={colors.textTertiary} />}
            {(tx.taxRelated || tx.splits?.some((s) => s.taxCategory)) && <Text variant="caption" color={colors.textTertiary}>TAX</Text>}
          </View>
        </View>
      }
    />
  );
}

const KIND_COLOR: Record<ScheduledEvent['kind'], string> = {
  income: colors.positive,
  bill: colors.ink,
  subscription: colors.ink,
  debt_payment: colors.negative,
  transfer: colors.primary,
  savings: colors.primary,
  investment: colors.primary,
};

export const eventKindColor = (kind: ScheduledEvent['kind']) => KIND_COLOR[kind];

/** Date chip used by timelines: "SEP / 18". */
export function DateBadge({ date, muted }: { date: string; muted?: boolean }) {
  const { day } = parseISODate(date);
  return (
    <View style={[styles.dateBadge, muted && { backgroundColor: colors.surfaceMuted }]}>
      {/* The tertiary step is under 4.5:1 on the tinted badge in both themes. */}
      <Text variant="caption" color={colors.textSecondary}>
        {WEEKDAYS[dayOfWeek(date)].toUpperCase()}
      </Text>
      <Text variant="h3" style={{ lineHeight: 20 }}>
        {day}
      </Text>
    </View>
  );
}

type EventRowProps = {
  event: ScheduledEvent;
  onPress?: () => void;
  /** Quick action, e.g. "Pay" or "Record". */
  onAction?: () => void;
  actionLabel?: string;
  compact?: boolean;
};

/** An expected obligation or paycheck. Always marked as expected vs recorded. */
export function EventRow({ event, onPress, onAction, actionLabel, compact }: EventRowProps) {
  const today = useToday();
  const money = useMoney();
  const inflow = event.kind === 'income';
  const statusBadge =
    event.status === 'paid' ? (
      <StatusBadge tone="positive" label={inflow ? 'Received' : 'Paid'} />
    ) : event.status === 'overdue' ? (
      inflow ? <StatusBadge tone="warning" label="Not recorded" /> : event.autopay && event.source === 'recurring' ? <StatusBadge tone="warning" label="Autopay · confirm" /> : <StatusBadge tone="negative" label="Past due" />
    ) : event.status === 'skipped' ? (
      <StatusBadge tone="muted" label="Skipped" />
    ) : null;

  const meta = [
    event.status === 'upcoming' ? relativeDay(event.date, today) : formatDate(event.date, 'short', today),
    event.source === 'transaction' ? 'Scheduled' : event.source === 'income' ? 'Income' : inflow ? 'Money in' : RECURRING_KINDS[event.kind as keyof typeof RECURRING_KINDS]?.label,
    event.autopay && !inflow && event.source !== 'transaction' ? 'Autopay' : null,
    event.paidAmount ? `${money(event.paidAmount)} paid, rest due` : null,
    event.estimate && event.status !== 'paid' && !event.paidAmount ? 'Estimate' : null,
  ].filter(Boolean);

  return (
    <View style={styles.eventRow}>
      {!compact && <DateBadge date={event.date} muted={event.status === 'paid' || event.status === 'skipped'} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="medium" numberOfLines={1} onPress={onPress} suppressHighlighting>
          {event.name}
        </Text>
        <Text variant="small" color={colors.textTertiary} numberOfLines={1}>
          {meta.join(' · ')}
        </Text>
        {statusBadge && <View style={{ marginTop: 2 }}>{statusBadge}</View>}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Text weight="semibold" tabular color={inflow ? colors.positive : colors.ink}>
          {`${inflow ? '+' : ''}${money(event.amount)}`}
        </Text>
        {onAction && event.status !== 'paid' && event.status !== 'skipped' && <Button label={actionLabel ?? (inflow ? 'Record' : 'Pay')} size="sm" variant="secondary" onPress={onAction} />}
      </View>
    </View>
  );
}

export function AccountRow({ account, balance, onPress, showType = true }: { account: Account; balance: Cents; onPress?: () => void; showType?: boolean }) {
  const router = useRouter();
  const info = ACCOUNT_TYPES[account.type];
  const credit = creditInfo(account, balance);
  const liability = info.nature === 'liability';
  return (
    <View>
      <ListRow
        title={account.name}
        subtitle={[showType ? info.label : null, account.institution].filter(Boolean).join(' · ')}
        leading={<VisualTile emoji={ACCOUNT_EMOJI[account.type]} tint={tintOf(account.color)} />}
        onPress={onPress ?? (() => router.push(`/accounts/${account.id}`))}
        trailing={<Money cents={balance} weight="semibold" tone={liability ? 'ink' : 'balance'} />}
        trailingCaption={liability ? (balance > 0 ? 'owed' : balance < 0 ? 'credit' : 'paid off') : undefined}
      />
      {credit && isCreditCard(account.type) && (
        <View style={styles.utilization}>
          {/* The bar fills the row; the label keeps its own column so it never overflows. */}
          <View style={{ flex: 1 }}>
            <ProgressBar value={credit.utilization} height={4} color={credit.utilization >= 0.7 ? colors.negative : credit.utilization >= 0.3 ? colors.warning : colors.primary} accessibilityLabel={`${Math.round(credit.utilization * 100)}% utilization`} />
          </View>
          <Text variant="caption" color={colors.textTertiary} tabular numberOfLines={1} style={styles.utilizationLabel}>
            {Math.round(credit.utilization * 100)}% used
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flags: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dateBadge: { width: 44, alignItems: 'center', paddingVertical: 4, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 12 },
  utilization: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginLeft: 52, marginTop: -6, marginBottom: 10 },
  utilizationLabel: { minWidth: 62, textAlign: 'right' },
});
