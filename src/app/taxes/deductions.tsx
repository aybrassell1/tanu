import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TransactionRow } from '@/components/finance/Rows';
import { useTaxYear, YearSwitch } from '@/components/taxes/TaxParts';
import { Button, Card, DateField, Disclosure, EmptyState, IconButton, ListCard, ListRow, Money, NavHeader, NumberField, Screen, Section, Segmented, SegmentedTabs, Sheet, Text, TextField, useOverlay } from '@/components/ui';
import { EmojiIcon } from '@/components/ui/Glyph';
import { formatDate } from '@/domain/dates';
import { TAX_TAGS, taxRecord, taxTaggedTransactions } from '@/domain/taxes';
import { mileageRateOn, taxTableFor } from '@/domain/taxTables';
import type { MileageEntry, TaxTag } from '@/domain/types';
import { useData, useDerived, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

const PURPOSES: { value: MileageEntry['purpose']; label: string; emoji: string }[] = [
  { value: 'business', label: 'Business', emoji: 'briefcase' },
  { value: 'medical', label: 'Medical', emoji: 'stethoscope' },
  { value: 'charitable', label: 'Charity', emoji: 'red-heart' },
];

export default function TaxDeductionsScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const { year, years } = useTaxYear();
  const [tab, setTab] = useState<'deductions' | 'mileage'>(params.tab === 'mileage' ? 'mileage' : 'deductions');
  return (
    <Screen header={<NavHeader title="Deductions" right={<YearSwitch year={year} years={years} />} />}>
      <SegmentedTabs
        items={[
          { value: 'deductions', label: 'Tax-tagged' },
          { value: 'mileage', label: 'Mileage' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'deductions' ? <Deductions year={year} /> : <Mileage year={year} />}
    </Screen>
  );
}

function Deductions({ year }: { year: number }) {
  const router = useRouter();
  const money = useMoney();
  const { toast } = useOverlay();
  const { groups, possible } = useDerived((d) => taxTaggedTransactions(d, year), [year]);
  const total = groups.filter((g) => TAX_TAGS[g.tag].group !== 'payment').reduce((s, g) => s + g.total, 0);
  const max = Math.max(1, ...groups.map((g) => g.total));

  if (groups.length === 0) {
    return (
      <EmptyState
        icon="bookmark"
        title="Nothing tax-tagged yet"
        message="Donations, medical bills, business costs and property tax are tagged automatically by category."
        actionLabel="Browse transactions"
        onAction={() => router.push('/transactions')}
      />
    );
  }

  const review = (ids: string[], keep: boolean, tag?: TaxTag) => {
    ledger.setTransactionTax(ids, keep, tag);
    toast({ message: keep ? 'Marked as tax related' : 'Marked as not tax related', actionLabel: 'Undo', onAction: () => ledger.undo() });
  };

  return (
    <>
      <Card style={{ gap: spacing.md }}>
        <View style={styles.between}>
          <Text variant="small" color={colors.textSecondary}>
            Deductible-type spending in {year}
          </Text>
          <Money cents={total} variant="h3" whole />
        </View>
        {groups.map((g) => {
          const meta = TAX_TAGS[g.tag];
          return (
            <View key={g.tag} style={styles.barRow}>
              <EmojiIcon name={meta.emoji} size={22} />
              <View style={{ flex: 1, gap: 4 }}>
                <View style={styles.between}>
                  <Text variant="small">{meta.label}</Text>
                  <Money cents={g.total} variant="small" weight="semibold" whole />
                </View>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.round((g.total / max) * 100)}%` }]} />
                </View>
              </View>
            </View>
          );
        })}
      </Card>

      {possible.length > 0 && (
        <Section title="Review suggestions" subtitle="Tagged by category. Confirm what really counts." accessory={<Button label="Confirm all" size="sm" variant="secondary" onPress={() => review(possible.map((i) => i.tx.id), true)} />}>
          <ListCard>
            {possible.slice(0, 8).map(({ tx: t, amount }) => (
              <View key={t.id} style={styles.reviewRow}>
                <View style={{ flex: 1 }}>
                  <TransactionRow tx={t} showDate />
                  {/* A split purchase only counts for the part in a tax category. */}
                  {amount !== t.amount && (
                    <Text variant="caption" color={colors.textTertiary} style={{ marginLeft: 52, marginTop: -6, marginBottom: 6 }}>
                      {money(amount)} of this counts
                    </Text>
                  )}
                </View>
                <IconButton icon="x" size={34} accessibilityLabel="Not tax related" onPress={() => review([t.id], false)} />
                <IconButton icon="check" size={34} variant="dark" accessibilityLabel="Tax related" onPress={() => review([t.id], true)} />
              </View>
            ))}
          </ListCard>
          {possible.length > 8 && (
            <Text variant="caption" color={colors.textTertiary}>
              +{possible.length - 8} more
            </Text>
          )}
        </Section>
      )}

      {groups.map((g) => {
        const meta = TAX_TAGS[g.tag];
        return (
          <Section key={g.tag} title={meta.label} accessory={<Money cents={g.total} weight="semibold" whole />}>
            <Text variant="caption" color={colors.textTertiary}>
              {meta.hint}
            </Text>
            <Disclosure label="Transactions" count={g.items.length}>
              <ListCard>
                {g.items.map(({ tx: t }) => (
                  <TransactionRow key={t.id} tx={t} showDate />
                ))}
              </ListCard>
            </Disclosure>
          </Section>
        );
      })}
    </>
  );
}

function Mileage({ year }: { year: number }) {
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { confirm, toast } = useOverlay();
  const trips = taxRecord(data, year).mileage;
  const { table } = taxTableFor(year);
  const [editing, setEditing] = useState<Partial<MileageEntry> | null>(null);
  const byPurpose = PURPOSES.map((p) => {
    const items = trips.filter((t) => t.purpose === p.value);
    return { ...p, miles: items.reduce((s, t) => s + t.miles, 0), value$: Math.round(items.reduce((s, t) => s + t.miles * mileageRateOn(table, t.date, p.value), 0)) };
  });

  return (
    <>
      <View style={styles.tiles}>
        {byPurpose.map((p) => (
          <Card key={p.value} style={styles.tile} padding={spacing.md}>
            <EmojiIcon name={p.emoji} size={26} />
            <Text variant="h3" tabular numberOfLines={1}>
              {Number(p.miles.toFixed(1)).toLocaleString()} mi
            </Text>
            {/* Three tiles on a 390px phone: let the caption wrap rather than
                clip the deduction value off the end. */}
            <Text variant="caption" color={colors.textSecondary} numberOfLines={2}>
              {p.label} · {money(p.value$, { whole: true })}
            </Text>
          </Card>
        ))}
      </View>
      <Button label="Log a trip" icon="plus" size="lg" fullWidth onPress={() => setEditing({ purpose: 'business', date: today.startsWith(String(year)) ? today : `${year}-12-31` })} />
      {trips.length === 0 ? (
        <EmptyState icon="map-pin" title="No trips logged" message={`${year} rate: ${mileageRateOn(table, `${year}-12-31`, 'business')}¢ per business mile.`} compact />
      ) : (
        <ListCard>
          {[...trips].reverse().map((t) => (
            <ListRow
              key={t.id}
              title={t.note || PURPOSES.find((p) => p.value === t.purpose)!.label}
              subtitle={`${formatDate(t.date, 'medium')} · ${PURPOSES.find((p) => p.value === t.purpose)!.label}`}
              leading={<EmojiIcon name={PURPOSES.find((p) => p.value === t.purpose)!.emoji} size={24} />}
              trailing={
                <Text variant="small" weight="semibold" tabular>
                  {t.miles} mi
                </Text>
              }
              chevron
              onPress={() => setEditing(t)}
            />
          ))}
        </ListCard>
      )}
      <Text variant="caption" color={colors.textTertiary} align="center">
        Business miles matter if you’re self-employed; employees can’t deduct commuting or work travel.
      </Text>

      <TripSheet
        value={editing}
        onClose={() => setEditing(null)}
        onDelete={async (id) => {
          if (await confirm({ title: 'Delete this trip?', confirmLabel: 'Delete', destructive: true })) {
            ledger.deleteMileage(id);
            setEditing(null);
            toast({ message: 'Trip deleted', actionLabel: 'Undo', onAction: () => ledger.undo() });
          }
        }}
      />
    </>
  );
}

function TripSheet({ value, onClose, onDelete }: { value: Partial<MileageEntry> | null; onClose: () => void; onDelete: (id: string) => void }) {
  const [draft, setDraft] = useState<Partial<MileageEntry>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openedFor, setOpenedFor] = useState<Partial<MileageEntry> | null>(null);
  if (value !== openedFor) {
    setOpenedFor(value);
    setDraft(value ?? {});
    setErrors({});
  }
  const save = () => {
    const r = ledger.saveMileage({ id: draft.id, date: draft.date ?? '', miles: draft.miles ?? 0, purpose: draft.purpose ?? 'business', note: draft.note?.trim() || undefined });
    if (r.ok) onClose();
    else setErrors(r.errors);
  };
  return (
    <Sheet
      visible={value !== null}
      onClose={onClose}
      title={draft.id ? 'Edit trip' : 'Log a trip'}
      footer={
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {draft.id && <Button label="Delete" variant="secondary" onPress={() => onDelete(draft.id!)} />}
          <Button label="Save" onPress={save} style={{ flex: 1 }} />
        </View>
      }
    >
      <Segmented items={PURPOSES.map((p) => ({ value: p.value, label: p.label }))} value={draft.purpose ?? 'business'} onChange={(purpose) => setDraft((d) => ({ ...d, purpose }))} />
      <NumberField label="Miles" value={draft.miles} onChange={(miles) => setDraft((d) => ({ ...d, miles }))} suffix="mi" error={errors.miles} />
      <DateField label="Date" value={draft.date} onChange={(date) => setDraft((d) => ({ ...d, date }))} error={errors.date} />
      <TextField label="Where / why" optional value={draft.note ?? ''} onChangeText={(note) => setDraft((d) => ({ ...d, note }))} placeholder="Client meeting" />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  track: { height: 8, borderRadius: 999, backgroundColor: colors.surfaceSunken, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999, backgroundColor: colors.primary },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tile: { flex: 1, gap: 4, minWidth: 0 },
});
