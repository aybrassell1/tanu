import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { countdownLabel, StatusPill } from '@/components/policies/PolicyParts';
import {
  Banner,
  Button,
  Card,
  ChipSelect,
  DateField,
  EmptyState,
  IconButton,
  KeyValue,
  ListCard,
  Money,
  MoneyField,
  NavHeader,
  Pill,
  Row,
  Screen,
  Section,
  Sheet,
  Stack,
  Text,
  TextField,
  useOverlay,
  VisualTile,
} from '@/components/ui';
import { formatDate } from '@/domain/dates';
import { createId } from '@/domain/factory';
import { claimTotals, isWarranty, POLICY_KINDS, policyStatus, yearlyPremium } from '@/domain/policies';
import { annualEquivalent, frequencyLabel } from '@/domain/recurrence';
import type { Attachment, Cents, ISODate, Policy, PolicyClaim } from '@/domain/types';
import { goBackOr } from '@/lib/navigation';
import { openAttachment, pickAttachment } from '@/store/fileIO';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

const CLAIM_STATUS: { value: PolicyClaim['status']; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'paid', label: 'Paid' },
  { value: 'denied', label: 'Denied' },
];

const CLAIM_PILL = {
  open: { tone: 'projected', icon: 'clock', label: 'Open' },
  paid: { tone: 'positive', icon: 'check-circle', label: 'Paid' },
  denied: { tone: 'muted', icon: 'x-circle', label: 'Denied' },
} as const;

/** Re-saves a policy with a patch, keeping everything else exactly as it is. */
function savePatch(policy: Policy, patch: Partial<Policy>) {
  const { createdAt: _c, updatedAt: _u, ...rest } = policy;
  return ledger.savePolicy({ ...rest, ...patch });
}

export default function PolicyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { confirm, toast } = useOverlay();
  const [editing, setEditing] = useState<PolicyClaim | 'new' | null>(null);

  const live = data.policies.find((p) => p.id === id);
  // Keep the last known policy on screen while it closes after a delete.
  const last = useRef(live);
  const leaving = useRef(false);
  if (live) last.current = live;
  const policy = live ?? (leaving.current ? last.current : undefined);

  if (!policy) {
    return (
      <Screen header={<NavHeader title="Cover" />}>
        <EmptyState icon="search" title="Policy not found" message="It may have been deleted." actionLabel="All cover" onAction={() => router.replace('/policies')} />
      </Screen>
    );
  }

  const kind = POLICY_KINDS[policy.kind];
  const warranty = isWarranty(policy.kind);
  const status = policyStatus(policy, today);
  const totals = claimTotals(policy);
  const yearly = yearlyPremium(policy);
  const asset = policy.linkedAssetId ? data.assets.find((a) => a.id === policy.linkedAssetId) : undefined;
  const recurring = policy.recurringId ? data.recurring.find((r) => r.id === policy.recurringId) : undefined;
  const claims = [...policy.claims].sort((a, b) => b.date.localeCompare(a.date));

  const attach = async () => {
    try {
      const file = await pickAttachment();
      if (!file) return;
      const result = savePatch(policy, { documents: [...policy.documents, { id: createId('att'), ...file } as Attachment] });
      if (!result.ok) toast({ message: Object.values(result.errors)[0] ?? 'Could not attach the file.', tone: 'error' });
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'Could not attach the file.', tone: 'error' });
    }
  };

  const removeDocument = async (doc: Attachment) => {
    const ok = await confirm({ title: `Remove ${doc.name}?`, message: 'The copy stored with this policy is removed.', confirmLabel: 'Remove', destructive: true });
    if (!ok) return;
    savePatch(policy, { documents: policy.documents.filter((d) => d.id !== doc.id) });
    toast({ message: 'Document removed', actionLabel: 'Undo', onAction: ledger.undo });
  };

  const removeClaim = async (claim: PolicyClaim) => {
    const ok = await confirm({ title: 'Delete this claim?', message: `"${claim.description}" is removed from this policy.`, confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    ledger.deletePolicyClaim(policy.id, claim.id);
    toast({ message: 'Claim removed', actionLabel: 'Undo', onAction: ledger.undo });
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${policy.name}?`,
      message: 'Its claims and attached documents are removed too.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    leaving.current = true;
    goBackOr(router, '/policies');
    ledger.deletePolicy(policy.id);
    toast({ message: 'Policy deleted', actionLabel: 'Undo', onAction: ledger.undo });
  };

  return (
    <Screen
      header={
        <NavHeader
          title={policy.name}
          right={<IconButton icon="edit-2" accessibilityLabel="Edit cover" onPress={() => router.push({ pathname: '/policies/edit', params: { id: policy.id } })} />}
        />
      }
    >
      <Card variant="muted" padding={spacing.xl} style={styles.hero}>
        <VisualTile emoji={kind.emoji} size={60} />
        {policy.coverage !== undefined ? (
          <>
            <Money cents={policy.coverage} variant="display" color={status === 'expired' ? colors.textSecondary : colors.ink} />
            <Text color={colors.textSecondary}>{warranty ? 'What it covers' : 'Coverage limit'}</Text>
          </>
        ) : (
          <Text variant="h2" color={colors.textSecondary}>
            {kind.label}
          </Text>
        )}
        <Row gap={spacing.sm} style={styles.pills}>
          <Pill tone="primary" emoji={kind.emoji} label={kind.label} />
          <StatusPill policy={policy} today={today} size="md" />
        </Row>
        {/* With no date the banner below already says so; don't repeat it here. */}
        {status !== 'none' && (
          <Text variant="caption" color={colors.textTertiary}>
            {countdownLabel(policy, today)}
          </Text>
        )}
      </Card>

      {status === 'expired' && (
        <Banner tone="warning" icon="alert-circle" title={warranty ? 'This warranty has run out' : 'This policy has lapsed'} message={`It ended ${formatDate(policy.renewalDate!, 'medium', today)}. Update the date if it was renewed.`} />
      )}
      {status === 'none' && <Banner tone="muted" icon="calendar" title={warranty ? 'No expiry date recorded' : 'No renewal date recorded'} message="Add one so this shows up before it runs out." />}

      <ListCard>
        {!!policy.provider && <KeyValue label="Provider" value={policy.provider} />}
        {!!policy.policyNumber && <KeyValue label={warranty ? 'Reference' : 'Policy number'} value={policy.policyNumber} />}
        {policy.premium !== undefined && (
          <KeyValue label="Premium" hint={policy.premiumFrequency ? frequencyLabel(policy.premiumFrequency) : 'Per year'}>
            <Money cents={policy.premium} weight="medium" />
          </KeyValue>
        )}
        {yearly > 0 && (
          <KeyValue label="Yearly cost">
            <Money cents={yearly} weight="medium" />
          </KeyValue>
        )}
        {policy.deductible !== undefined && (
          <KeyValue label="Deductible" hint="What you pay before cover starts">
            <Money cents={policy.deductible} weight="medium" />
          </KeyValue>
        )}
        {policy.coverage !== undefined && (
          <KeyValue label={warranty ? 'Covered value' : 'Coverage limit'}>
            <Money cents={policy.coverage} weight="medium" />
          </KeyValue>
        )}
        <KeyValue label="Starts" value={policy.startDate ? formatDate(policy.startDate, 'medium', today) : 'Not set'} />
        <KeyValue label={warranty ? 'Expires' : 'Renews'} value={policy.renewalDate ? formatDate(policy.renewalDate, 'medium', today) : 'Not set'} />
        {!!policy.contact && <KeyValue label="Contact" value={policy.contact} />}
      </ListCard>

      {(asset || recurring) && (
        <ListCard>
          {asset && (
            <KeyValue label={warranty ? 'Covers' : 'Covered item'}>
              <Text weight="medium" color={colors.primary} align="right" onPress={() => router.push(`/belongings/${asset.id}`)} accessibilityRole="link">
                {asset.name}
              </Text>
            </KeyValue>
          )}
          {recurring && (
            <KeyValue label="Paid by" hint={`${money(recurring.amount)} · ${frequencyLabel(recurring.frequency)}`}>
              <Text weight="medium" color={colors.primary} align="right" onPress={() => router.push(`/bills/${recurring.id}`)} accessibilityRole="link">
                {recurring.name}
              </Text>
            </KeyValue>
          )}
        </ListCard>
      )}

      {recurring && policy.premium !== undefined && annualEquivalent(recurring.amount, recurring.frequency) !== yearly && yearly > 0 && (
        <Banner
          tone="muted"
          icon="info"
          title="The bill and the premium differ"
          message={`This policy says ${money(yearly)} a year; the linked bill works out to ${money(annualEquivalent(recurring.amount, recurring.frequency))}.`}
        />
      )}

      {policy.tags.length > 0 && (
        <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
          {policy.tags.map((t) => (
            <Pill key={t} tone="primary" label={`#${t}`} onPress={() => router.push({ pathname: '/search', params: { q: `#${t}` } })} />
          ))}
        </Row>
      )}

      {!!policy.notes && (
        <Card variant="muted">
          <Text color={colors.textSecondary}>{policy.notes}</Text>
        </Card>
      )}

      <Section title="Documents" subtitle="Stored on this device only">
        {policy.documents.length === 0 ? (
          <EmptyState compact icon="paperclip" title="Nothing attached" message="Keep the policy PDF or receipt with it." actionLabel="Attach a file" onAction={attach} />
        ) : (
          <Stack gap={spacing.sm}>
            {policy.documents.map((d) => (
              <View key={d.id} style={styles.docRow}>
                <Button
                  label={d.name}
                  icon="paperclip"
                  variant="secondary"
                  style={{ flex: 1 }}
                  onPress={() => openAttachment(d.uri, d.mimeType).catch((e) => toast({ message: e instanceof Error ? e.message : 'Could not open the file.', tone: 'error' }))}
                />
                <IconButton icon="trash-2" size={36} variant="plain" accessibilityLabel={`Remove ${d.name}`} onPress={() => removeDocument(d)} />
              </View>
            ))}
            <Button label="Attach a file" icon="upload" variant="ghost" fullWidth onPress={attach} />
          </Stack>
        )}
      </Section>

      <Section title="Claims" subtitle={claims.length ? `${money(totals.reimbursed)} reimbursed of ${money(totals.claimed)} claimed` : undefined}>
        {claims.length === 0 ? (
          <EmptyState compact icon="file-text" title="No claims recorded" message="Record what you claimed and what came back, so you know what this cover is worth." actionLabel="Add a claim" onAction={() => setEditing('new')} />
        ) : (
          <Stack gap={spacing.sm}>
            <Card variant="muted" style={styles.totals}>
              <View style={{ flex: 1 }}>
                <Text variant="caption" color={colors.textSecondary}>
                  Claimed
                </Text>
                <Money cents={totals.claimed} weight="semibold" />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="caption" color={colors.textSecondary}>
                  Reimbursed
                </Text>
                <Money cents={totals.reimbursed} weight="semibold" color={colors.positive} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="caption" color={colors.textSecondary}>
                  Outstanding
                </Text>
                <Money cents={totals.outstanding} weight="semibold" />
              </View>
            </Card>
            <ListCard>
              {claims.map((c) => (
                <View key={c.id} style={styles.claimRow}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text weight="medium">{c.description}</Text>
                    <Text variant="caption" color={colors.textTertiary}>
                      {formatDate(c.date, 'medium', today)}
                      {c.amount !== undefined ? ` · claimed ${money(c.amount)}` : ''}
                      {c.reimbursed ? ` · back ${money(c.reimbursed)}` : ''}
                    </Text>
                    <Row gap={spacing.xs}>
                      <Pill tone={CLAIM_PILL[c.status].tone} size="sm" icon={CLAIM_PILL[c.status].icon} label={CLAIM_PILL[c.status].label} />
                    </Row>
                  </View>
                  <IconButton icon="edit-2" size={32} variant="plain" accessibilityLabel={`Edit claim ${c.description}`} onPress={() => setEditing(c)} />
                  <IconButton icon="trash-2" size={32} variant="plain" accessibilityLabel={`Delete claim ${c.description}`} onPress={() => removeClaim(c)} />
                </View>
              ))}
            </ListCard>
            <Button label="Add a claim" icon="plus" variant="secondary" fullWidth onPress={() => setEditing('new')} />
          </Stack>
        )}
      </Section>

      <Button label="Delete cover" icon="trash-2" variant="danger" fullWidth onPress={remove} />

      {/* Remounting per claim resets the form without touching state during render. */}
      <ClaimSheet key={editing === 'new' ? 'new' : (editing?.id ?? 'none')} policy={policy} claim={editing} onClose={() => setEditing(null)} />
    </Screen>
  );
}

type ClaimDraft = { date: ISODate; description: string; amount?: Cents; reimbursed?: Cents; status: PolicyClaim['status']; note: string };

function ClaimSheet({ policy, claim, onClose }: { policy: Policy; claim: PolicyClaim | 'new' | null; onClose: () => void }) {
  const today = useToday();
  const { toast } = useOverlay();
  const existing = claim && claim !== 'new' ? claim : undefined;
  const [draft, setDraft] = useState<ClaimDraft>(() =>
    existing
      ? { date: existing.date, description: existing.description, amount: existing.amount, reimbursed: existing.reimbursed, status: existing.status, note: existing.note ?? '' }
      : { date: today, description: '', status: 'open', note: '' },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fixing a field clears its error straight away, as the rest of the app's forms do.
  const set = <K extends keyof ClaimDraft>(k: K, v: ClaimDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setErrors((e) => {
      // The two money fields are validated against each other, so either edit clears both.
      const drop = k === 'amount' || k === 'reimbursed' ? ['amount', 'reimbursed', 'form'] : [k as string, 'form'];
      if (!drop.some((key) => e[key])) return e;
      const next = { ...e };
      for (const key of drop) delete next[key];
      return next;
    });
  };

  const save = () => {
    const result = ledger.savePolicyClaim(policy.id, {
      id: existing?.id,
      date: draft.date,
      description: draft.description,
      amount: draft.amount,
      reimbursed: draft.reimbursed,
      status: draft.status,
      note: draft.note.trim() || undefined,
    });
    if (!result.ok) return setErrors(result.errors);
    toast(existing ? 'Claim updated' : 'Claim saved');
    onClose();
  };

  return (
    <Sheet
      visible={claim !== null}
      onClose={onClose}
      title={existing ? 'Edit claim' : 'Add a claim'}
      subtitle={policy.name}
      footer={<Button label="Save claim" size="lg" fullWidth onPress={save} />}
    >
      {!!errors.form && <Banner tone="negative" icon="alert-triangle" title={errors.form} />}
      <TextField label="What happened" value={draft.description} onChangeText={(t) => set('description', t)} placeholder="e.g. Windscreen replacement" error={errors.description} autoFocus={!existing} />
      <DateField label="Date" value={draft.date} onChange={(d) => set('date', d ?? today)} shortcuts />
      <MoneyField label="Amount claimed" value={draft.amount} onChange={(c) => set('amount', c ?? undefined)} optional error={errors.amount} />
      <MoneyField label="Reimbursed" value={draft.reimbursed} onChange={(c) => set('reimbursed', c ?? undefined)} optional error={errors.reimbursed} hint="What actually came back to you." />
      <ChipSelect label="Status" options={CLAIM_STATUS} value={draft.status} onChange={(s) => set('status', s)} />
      <TextField label="Note" value={draft.note} onChangeText={(t) => set('note', t)} optional multiline />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm },
  pills: { flexWrap: 'wrap', justifyContent: 'center', marginTop: spacing.xs },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  claimRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 10 },
  totals: { flexDirection: 'row', gap: spacing.md },
});
