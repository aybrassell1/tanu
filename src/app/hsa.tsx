import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Banner,
  Button,
  Card,
  ChipSelect,
  DateField,
  EmptyState,
  GradientCard,
  ListCard,
  Money,
  NavHeader,
  Pill,
  Row,
  Screen,
  Section,
  Segmented,
  Sheet,
  SplitBar,
  Stack,
  Text,
  useOverlay,
} from '@/components/ui';
import { EmojiIcon } from '@/components/ui/Glyph';
import { formatDate } from '@/domain/dates';
import { formatPercent } from '@/domain/money';
import { eligibleIds, reimbursementLedger, type ReimbursableItem } from '@/domain/reimbursements';
import type { ID, ISODate } from '@/domain/types';
import { useDerived, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

type Tab = 'open' | 'flagged' | 'reimbursed' | 'all';

const TABS: { value: Tab; label: string }[] = [
  { value: 'open', label: 'To claim' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'reimbursed', label: 'Done' },
  { value: 'all', label: 'All' },
];

const SOURCE_LABEL = { hsa: 'HSA', fsa: 'FSA' } as const;

export default function HsaScreen() {
  const router = useRouter();
  const today = useToday();
  const money = useMoney();
  const { toast, confirm } = useOverlay();
  const summary = useDerived((d, t) => reimbursementLedger(d, t));
  const [tab, setTab] = useState<Tab>('open');
  const [selected, setSelected] = useState<ID[]>([]);
  const [claiming, setClaiming] = useState(false);

  const list = useMemo(() => (tab === 'all' ? summary.items : summary[tab]), [summary, tab]);
  const selectedSet = new Set(selected);
  const chosen = summary.items.filter((i) => selectedSet.has(i.id));
  const chosenTotal = chosen.reduce((s, i) => s + i.amount, 0);

  const toggle = (id: ID) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const addExpense = () => router.push({ pathname: '/transactions/edit', params: { type: 'expense' } });

  const flag = (ids: ID[], source: 'hsa' | 'fsa', label: string) => {
    if (!ids.length) return;
    ledger.setReimbursable(ids, source);
    setSelected([]);
    toast({ message: `${ids.length} ${ids.length === 1 ? 'cost' : 'costs'} flagged for ${label}`, actionLabel: 'Undo', onAction: ledger.undo });
  };

  const unflag = async (ids: ID[]) => {
    if (!ids.length) return;
    const ok = await confirm({
      title: ids.length === 1 ? 'Remove this flag?' : `Remove ${ids.length} flags?`,
      message: 'The spending stays in your ledger — it just stops being tracked as something to claim back.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    ledger.setReimbursable(ids, undefined);
    setSelected([]);
    toast({ message: 'Flag removed', actionLabel: 'Undo', onAction: ledger.undo });
  };

  const flagAllEligible = () => flag(eligibleIds(summary), 'hsa', 'HSA');

  // Every tab says what is missing from *that* tab, not from the screen as a whole.
  const empty = (() => {
    if (summary.items.length === 0)
      return { title: 'No medical costs found', message: 'Costs in medical categories show up here automatically once you record them.', actionLabel: 'Add expense', onAction: addExpense };
    if (tab === 'open')
      return { title: 'Nothing left to claim', message: 'Every medical cost here is already flagged or reimbursed.', actionLabel: 'See flagged', onAction: () => setTab('flagged') };
    if (tab === 'flagged')
      return { title: 'Nothing flagged yet', message: 'Flag a cost as an HSA or FSA claim and it shows up here.', actionLabel: 'See what to claim', onAction: () => setTab('open') };
    return { title: 'Nothing reimbursed yet', message: 'Mark a claim reimbursed once the money has come back to you.', actionLabel: 'See what to claim', onAction: () => setTab('open') };
  })();

  // The selection bar lives in the screen footer so it stays reachable however long the list is.
  const selectionBar =
    selected.length > 0 ? (
      <Stack gap={spacing.sm}>
        <Row gap={spacing.sm}>
          <Text variant="small" weight="semibold" style={{ flex: 1 }}>
            {`${selected.length} selected`}
          </Text>
          <Money cents={chosenTotal} variant="h3" />
        </Row>
        <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
          <Button label="Flag HSA" size="sm" icon="flag" onPress={() => flag(selected, 'hsa', 'HSA')} />
          <Button label="Flag FSA" size="sm" variant="secondary" icon="flag" onPress={() => flag(selected, 'fsa', 'FSA')} />
          <Button label="Reimbursed" size="sm" variant="secondary" icon="check" onPress={() => setClaiming(true)} />
          <Button label="Clear flag" size="sm" variant="secondary" icon="x" onPress={() => unflag(selected)} />
          <Button label="Deselect" size="sm" variant="ghost" onPress={() => setSelected([])} />
        </Row>
      </Stack>
    ) : undefined;

  return (
    <Screen header={<NavHeader title="HSA & FSA claims" />} footer={selectionBar}>
      <GradientCard style={{ gap: spacing.md }}>
        <Row gap={spacing.sm}>
          <EmojiIcon name="medical-symbol" size={28} />
          <Text variant="small" weight="medium" color={colors.onPrimary} style={{ flex: 1 }}>
            Money you can still claim back
          </Text>
        </Row>
        <Money cents={summary.totals.outstanding} variant="display" color={colors.onPrimary} />
        <Text variant="small" color={colors.onPrimary}>
          {summary.counts.open + summary.counts.flagged === 0
            ? 'No out-of-pocket medical costs waiting.'
            : `${summary.counts.open + summary.counts.flagged} medical ${summary.counts.open + summary.counts.flagged === 1 ? 'cost' : 'costs'} paid out of pocket · ${money(summary.totals.reimbursed)} already reimbursed`}
        </Text>
        {summary.hsaAccounts.length > 0 && (
          <>
            <SplitBar
              segments={[
                { key: 'covered', value: Math.min(summary.hsaBalance, summary.totals.outstanding), color: colors.onPrimary },
                { key: 'short', value: Math.max(0, summary.totals.outstanding - summary.hsaBalance), color: colors.glassBorder },
              ]}
              height={10}
            />
            <Row gap={spacing.sm}>
              <Text variant="caption" color={colors.onPrimary} style={{ flex: 1 }}>
                {`HSA balance ${money(summary.hsaBalance)}`}
              </Text>
              <Text variant="caption" color={colors.onPrimary}>
                {`covers ${formatPercent(summary.coverage)} of the claims`}
              </Text>
            </Row>
          </>
        )}
      </GradientCard>

      {summary.hsaAccounts.length === 0 && summary.items.length > 0 && (
        <Banner tone="muted" icon="info" title="No HSA account yet" message="Add your HSA as an account to see what is available to pay yourself back with." />
      )}

      {summary.missingReceipts > 0 && (
        <Banner
          tone="warning"
          icon="paperclip"
          title={summary.missingReceipts === 1 ? '1 claim has no receipt' : `${summary.missingReceipts} claims have no receipt`}
          message={`${money(summary.missingReceiptTotal)} of claims you'd struggle to prove years later. Attach a photo on the transaction.`}
        />
      )}

      {summary.counts.open > 0 && (
        <Button
          label={summary.counts.open === 1 ? 'Flag 1 cost for HSA' : `Flag all ${summary.counts.open} costs for HSA`}
          icon="check-square"
          size="lg"
          fullWidth
          onPress={flagAllEligible}
        />
      )}

      <Section
        title="Medical spending"
        subtitle="Paid from your own pocket — HSA-paid costs are left out"
        accessory={<Pill size="sm" tone="muted" label={`${list.length}`} />}
      >
        <Segmented items={TABS} value={tab} onChange={setTab} size="sm" />
        {list.length === 0 ? (
          <EmptyState compact icon="heart" title={empty.title} message={empty.message} actionLabel={empty.actionLabel} onAction={empty.onAction} />
        ) : (
          <ListCard>
            {list.map((item) => (
              <ClaimRow key={item.id} item={item} selected={selectedSet.has(item.id)} onToggle={() => toggle(item.id)} today={today} />
            ))}
          </ListCard>
        )}
        <Text variant="caption" color={colors.textTertiary}>
          Tap a cost to select it. HSA claims have no deadline; FSA claims usually run out at the end of the plan year.
        </Text>
      </Section>

      {claiming && (
        <ReimburseSheet
          ids={selected}
          total={chosenTotal}
          defaultSource={chosen.find((i) => i.source)?.source ?? 'hsa'}
          onClose={() => setClaiming(false)}
          onDone={() => {
            setClaiming(false);
            setSelected([]);
          }}
        />
      )}
    </Screen>
  );
}

function ClaimRow({ item, selected, onToggle, today }: { item: ReimbursableItem; selected: boolean; onToggle: () => void; today: ISODate }) {
  const statusPill =
    item.status === 'reimbursed'
      ? { tone: 'positive' as const, label: `Paid back ${item.reimbursedOn ? formatDate(item.reimbursedOn, 'short', today) : ''}`.trim(), icon: 'check' as const }
      : item.status === 'flagged'
        ? { tone: 'primary' as const, label: `${SOURCE_LABEL[item.source ?? 'hsa']} claim`, icon: 'flag' as const }
        : { tone: 'muted' as const, label: 'Not claimed', icon: 'circle' as const };

  // Merchant, date and amount own the first two lines; the pills wrap onto their
  // own line so a name like "CVS Pharmacy" is never squeezed to "CVS P…".
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={`${item.description}, ${statusPill.label}${selected ? ', selected' : ''}`}
      style={({ pressed }) => [styles.claimRow, pressed && { opacity: 0.6 }]}
    >
      <View style={{ width: 32, alignItems: 'center', justifyContent: 'center' }}>
        {selected ? <EmojiIcon name="check-mark-button" size={26} /> : <EmojiIcon name={item.tags.includes('hsa_eligible') ? 'pill' : 'stethoscope'} size={26} />}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Row gap={spacing.sm}>
          <Text weight="medium" numberOfLines={1} style={{ flex: 1 }}>
            {item.payee || item.description}
          </Text>
          <Money cents={item.amount} weight="semibold" />
        </Row>
        <Text variant="small" color={colors.textTertiary} numberOfLines={1}>
          {`${formatDate(item.date, 'short', today)} · ${item.categoryName ?? 'Medical'} · ${item.accountName}`}
        </Text>
        <Row gap={4} style={{ flexWrap: 'wrap' }}>
          <Pill size="sm" tone={statusPill.tone} icon={statusPill.icon} label={statusPill.label} />
          {!item.hasReceipt && item.status !== 'reimbursed' && <Pill size="sm" tone="warning" icon="paperclip" label="No receipt" />}
        </Row>
      </View>
    </Pressable>
  );
}

function ReimburseSheet({
  ids,
  total,
  defaultSource,
  onClose,
  onDone,
}: {
  ids: ID[];
  total: number;
  defaultSource: 'hsa' | 'fsa';
  onClose: () => void;
  onDone: () => void;
}) {
  const today = useToday();
  const money = useMoney();
  const { toast } = useOverlay();
  const [source, setSource] = useState<'hsa' | 'fsa'>(defaultSource);
  const [date, setDate] = useState<ISODate>(today);

  const save = () => {
    ledger.setReimbursable(ids, source, date);
    onDone();
    toast({ message: `${money(total)} marked reimbursed`, actionLabel: 'Undo', onAction: ledger.undo });
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Mark reimbursed"
      subtitle={`${ids.length} ${ids.length === 1 ? 'cost' : 'costs'} · ${money(total)}`}
      footer={<Button label="Mark reimbursed" size="lg" fullWidth onPress={save} />}
    >
      <Stack>
        <ChipSelect
          label="Paid back from"
          value={source}
          onChange={(v) => setSource(v)}
          options={[
            { value: 'hsa', label: 'HSA' },
            { value: 'fsa', label: 'FSA' },
          ]}
        />
        <DateField label="Money arrived" value={date} onChange={(d) => setDate(d ?? today)} shortcuts />
        <Card variant="muted">
          <Text variant="small" color={colors.textSecondary}>
            This records the claim against the spending. It does not move money — record the deposit as a transfer from your {SOURCE_LABEL[source]} account when it lands.
          </Text>
        </Card>
      </Stack>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  claimRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10 },
});
