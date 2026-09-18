import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';

import { FrequencySelect } from '@/components/finance/Pickers';
import { Banner, Button, ChipSelect, DateField, MoneyField, NavHeader, Screen, SelectField, Stack, TagInput, TextField, useOverlay, type SelectOption } from '@/components/ui';
import { ASSET_EMOJI, recurringVisual } from '@/data/visuals';
import { isWarranty, POLICY_KIND_ORDER, POLICY_KINDS } from '@/domain/policies';
import { frequencyLabel } from '@/domain/recurrence';
import { allTags } from '@/domain/search';
import type { ID, Policy, PolicyKind } from '@/domain/types';
import { goBackOr } from '@/lib/navigation';
import { useData, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { spacing } from '@/theme/tokens';

type Draft = Omit<Policy, 'id' | 'createdAt' | 'updatedAt'> & { id?: ID };

const NONE = 'none';

const KIND_HINT: Record<PolicyKind, string> = {
  auto: 'Cover on a car or other vehicle.',
  home: 'Homeowners cover on a place you own.',
  renters: 'Cover on your belongings in a place you rent.',
  health: 'Medical cover: premium, deductible and out-of-pocket limits.',
  dental: 'Dental plan.',
  vision: 'Eye exams, glasses and contacts.',
  life: 'Pays out to the people you name.',
  disability: 'Replaces income if you cannot work.',
  umbrella: 'Extra liability cover on top of your other policies.',
  pet: 'Vet bills for an animal.',
  travel: 'Trip cancellation, medical cover while travelling.',
  phone: 'Cover or a protection plan on a phone.',
  warranty: 'A warranty or protection plan with an expiry date on something you own.',
  other: 'Anything else you pay to be covered for.',
};

export default function PolicyFormScreen() {
  const params = useLocalSearchParams<{ id?: string; kind?: string; assetId?: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const { toast } = useOverlay();
  const existing = params.id ? data.policies.find((p) => p.id === params.id) : undefined;

  const [draft, setDraft] = useState<Draft>(() => {
    if (existing) return { ...existing };
    const kind = (params.kind && POLICY_KIND_ORDER.includes(params.kind as PolicyKind) ? params.kind : 'auto') as PolicyKind;
    return {
      kind,
      name: '',
      premiumFrequency: { unit: 'month', interval: 1 },
      startDate: today,
      linkedAssetId: params.assetId && data.assets.some((a) => a.id === params.assetId) ? params.assetId : undefined,
      documents: [],
      claims: [],
      tags: [],
      archived: false,
    };
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Fixing a field clears its error straight away, as the rest of the app's forms do.
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => {
      // The two dates are validated against each other, so either edit clears both.
      const drop = key === 'startDate' || key === 'renewalDate' ? ['startDate', 'renewalDate', 'form'] : [key as string, 'form'];
      if (!drop.some((k) => e[k])) return e;
      const next = { ...e };
      for (const k of drop) delete next[k];
      return next;
    });
  };

  const warranty = isWarranty(draft.kind);
  const tagSuggestions = useMemo(() => allTags(data).map((t) => t.tag), [data]);

  const assetOptions: SelectOption[] = useMemo(
    () => [
      { value: NONE, label: 'Not linked' },
      ...data.assets
        .filter((a) => !a.archived && !a.soldDate)
        .map((a) => ({ value: a.id, label: a.name, emoji: ASSET_EMOJI[a.type] })),
    ],
    [data.assets],
  );

  const billOptions: SelectOption[] = useMemo(
    () => [
      { value: NONE, label: 'Not linked' },
      ...data.recurring
        .filter((r) => r.kind === 'bill' || r.kind === 'subscription')
        .map((r) => ({ value: r.id, label: r.name, description: frequencyLabel(r.frequency), emoji: recurringVisual(r).emoji })),
    ],
    [data.recurring],
  );

  const save = () => {
    const next: Record<string, string> = {};
    if ((draft.premium ?? 0) < 0) next.premium = 'A premium cannot be negative.';
    if ((draft.deductible ?? 0) < 0) next.deductible = 'A deductible cannot be negative.';
    if ((draft.coverage ?? 0) < 0) next.coverage = 'Coverage cannot be negative.';
    if (draft.startDate && draft.renewalDate && draft.renewalDate <= draft.startDate) {
      next.renewalDate = warranty ? 'The expiry date must be after the start date.' : 'The renewal date must be after the start date.';
    }
    if (Object.keys(next).length > 0) return setErrors(next);

    const result = ledger.savePolicy({
      ...draft,
      provider: draft.provider?.trim() || undefined,
      policyNumber: draft.policyNumber?.trim() || undefined,
      contact: draft.contact?.trim() || undefined,
      notes: draft.notes?.trim() || undefined,
      premiumFrequency: draft.premium === undefined ? undefined : draft.premiumFrequency,
      deductible: warranty ? undefined : draft.deductible,
    });
    if (!result.ok) return setErrors(result.errors);
    toast(existing ? `${draft.name.trim()} updated` : `${draft.name.trim()} added`);
    goBackOr(router, existing ? `/policies/${existing.id}` : '/policies');
  };

  const title = existing ? 'Edit cover' : warranty ? 'New warranty' : 'New policy';

  return (
    <Screen header={<NavHeader title={title} backIcon="x" />} footer={<Button label="Save" size="lg" fullWidth onPress={save} />}>
      <ChipSelect
        label="Kind"
        options={POLICY_KIND_ORDER.map((k) => ({ value: k, label: POLICY_KINDS[k].label }))}
        value={draft.kind}
        onChange={(kind) => {
          setErrors({});
          set('kind', kind);
        }}
        hint={KIND_HINT[draft.kind]}
      />

      {!!errors.form && <Banner tone="negative" icon="alert-triangle" title={errors.form} />}

      <Stack gap={spacing.lg}>
        <TextField
          label="Name"
          value={draft.name}
          onChangeText={(t) => set('name', t)}
          placeholder={warranty ? 'e.g. Laptop protection plan' : 'e.g. Car insurance'}
          error={errors.name}
          autoFocus={!existing}
        />
        <TextField label={warranty ? 'Retailer or maker' : 'Provider'} value={draft.provider ?? ''} onChangeText={(t) => set('provider', t)} optional placeholder={warranty ? 'Who honours it' : 'Who you are insured with'} />
        <TextField label={warranty ? 'Reference' : 'Policy number'} value={draft.policyNumber ?? ''} onChangeText={(t) => set('policyNumber', t)} optional />
      </Stack>

      <Stack gap={spacing.lg}>
        <DateField label="Starts" value={draft.startDate} onChange={(d) => set('startDate', d)} optional clearable error={errors.startDate} />
        <DateField
          label={warranty ? 'Expires' : 'Renews'}
          value={draft.renewalDate}
          onChange={(d) => set('renewalDate', d)}
          optional
          clearable
          error={errors.renewalDate}
          hint={warranty ? 'When the warranty runs out. You are warned 60 days ahead.' : 'When the policy comes up for renewal. You are warned 60 days ahead.'}
        />
      </Stack>

      <Stack gap={spacing.lg}>
        <MoneyField label={warranty ? 'What it cost' : 'Premium'} value={draft.premium} onChange={(c) => set('premium', c ?? undefined)} optional error={errors.premium} />
        {draft.premium !== undefined && <FrequencySelect label={warranty ? 'Charged' : 'Premium is paid'} value={draft.premiumFrequency ?? { unit: 'month', interval: 1 }} onChange={(f) => set('premiumFrequency', f)} />}
        {!warranty && <MoneyField label="Deductible" value={draft.deductible} onChange={(c) => set('deductible', c ?? undefined)} optional error={errors.deductible} hint="What you pay before cover kicks in." />}
        <MoneyField
          label={warranty ? 'Covered value' : 'Coverage limit'}
          value={draft.coverage}
          onChange={(c) => set('coverage', c ?? undefined)}
          optional
          error={errors.coverage}
          hint={warranty ? 'What the covered item is worth.' : 'The most this policy pays out.'}
        />
      </Stack>

      <Stack gap={spacing.lg}>
        <SelectField
          label={warranty ? 'Covered item' : 'Covered asset'}
          value={draft.linkedAssetId ?? NONE}
          onChange={(v) => set('linkedAssetId', v === NONE ? undefined : (v as ID))}
          options={assetOptions}
          error={errors.linkedAssetId}
          hint={data.assets.length === 0 ? 'Add an asset first to link one here.' : 'Shows this cover on that item.'}
        />
        {!warranty && (
          <SelectField
            label="Paid by"
            value={draft.recurringId ?? NONE}
            onChange={(v) => set('recurringId', v === NONE ? undefined : (v as ID))}
            options={billOptions}
            hint={data.recurring.length === 0 ? 'Add a recurring bill first to link one here.' : 'The recurring bill that pays this premium.'}
          />
        )}
      </Stack>

      <Stack gap={spacing.lg}>
        <TextField label="Contact" value={draft.contact ?? ''} onChangeText={(t) => set('contact', t)} optional placeholder="Agent, phone number or claims line" />
        <TagInput value={draft.tags} onChange={(t) => set('tags', t)} suggestions={tagSuggestions} />
        <TextField label="Notes" value={draft.notes ?? ''} onChangeText={(t) => set('notes', t)} multiline optional placeholder="What is covered, what is not, how to claim…" />
      </Stack>

      <Banner tone="muted" icon="info" title="Documents and claims live on the policy" message="Save this first, then attach the policy PDF and record claims from its page." />
    </Screen>
  );
}
