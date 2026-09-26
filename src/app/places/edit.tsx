import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { FeeEditor } from '@/components/places/FeeEditor';
import { Banner, Button, ChipSelect, DateField, MoneyField, NavHeader, NumberField, Screen, Section, Stack, SwitchRow, TextField, useOverlay } from '@/components/ui';
import { UTILITIES, newPlace, placeCost } from '@/domain/places';
import type { Place, PlaceFee } from '@/domain/types';
import { goBackOr } from '@/lib/navigation';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';

type Draft = Omit<Place, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

/**
 * The numbers a listing does not advertise. Everything is optional except a
 * name: a place added in the car park with just a rent is still worth having,
 * and every cost beyond the rent is named, so next week you still know what
 * the $35 was for.
 */
export default function PlaceEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { toast } = useOverlay();
  const existing = id ? data.places.find((p) => p.id === id) : undefined;

  const [draft, setDraft] = useState<Draft>(() => (existing ? { ...existing } : { ...newPlace(), touredOn: today }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setFees = (fees: PlaceFee[]) => set('fees', fees);

  const cost = placeCost({ ...draft, id: 'draft', createdAt: '', updatedAt: '' } as Place);

  const save = () => {
    const result = ledger.savePlace(draft);
    if (!result.ok) return setErrors(result.errors);
    toast({ message: existing ? 'Place updated' : `${draft.name} saved` });
    if (existing) goBackOr(router, '/places');
    else router.replace(`/places/${result.id}`);
  };

  return (
    <Screen
      header={<NavHeader title={existing ? 'Edit place' : 'New place'} backIcon="x" />}
      footer={<Button label={existing ? 'Save' : 'Save and open checklist'} size="lg" fullWidth onPress={save} />}
    >
      <Stack>
        <TextField label="Name" value={draft.name} onChangeText={(v) => set('name', v)} placeholder="Maple Court, unit 3B" error={errors.name} />
        <TextField label="Address" value={draft.address ?? ''} onChangeText={(v) => set('address', v)} placeholder="Where it is" optional />
        <DateField label="Toured on" value={draft.touredOn} onChange={(v) => set('touredOn', v)} clearable />
      </Stack>

      <Section title="Rent">
        <Stack>
          <MoneyField label="Rent" value={draft.rent || undefined} onChange={(v) => set('rent', v ?? 0)} />
          <ChipSelect
            label="Included in the rent"
            options={UTILITIES.map((u) => ({ value: u.id, label: u.label }))}
            value={draft.included}
            onChange={(v) => set('included', draft.included.includes(v) ? draft.included.filter((x) => x !== v) : [...draft.included, v])}
            hint="Tap what the rent covers. Anything left is yours to pay — add it below."
          />
        </Stack>
      </Section>

      <Section title="Every month, on top of rent" subtitle="Name each one, so a number still means something next week">
        <FeeEditor when="monthly" fees={draft.fees} onChange={setFees} emptyHint="Tap a fee to add it, or add your own. Utilities count toward the 30% rule; the rest are just costs." />
      </Section>

      <Section title="Due at signing">
        <Stack>
          <FeeEditor when="upfront" fees={draft.fees} onChange={setFees} emptyHint="Deposit, admin and application fees — anything they want before the keys." />
          <SwitchRow label="First month's rent due at signing" value={draft.firstMonthUpfront} onChange={(v) => set('firstMonthUpfront', v)} />
        </Stack>
      </Section>

      {cost.monthly > 0 && (
        <Banner
          tone="primary"
          icon="dollar-sign"
          title={`${money(cost.monthly)} a month, all in`}
          message={
            cost.aboveRent > 0
              ? `${money(cost.aboveRent)} on top of the rent, and ${money(cost.upfront)} before you get the keys.`
              : 'Rent only so far. Add the fees and utilities to see the real number.'
          }
        />
      )}

      <Section title="The lease">
        <Stack>
          <NumberField label="Lease length, months" value={draft.leaseMonths} onChange={(v) => set('leaseMonths', v)} optional />
          <DateField label="Available from" value={draft.availableOn} onChange={(v) => set('availableOn', v)} optional clearable />
          <NumberField label="Income they require, × rent" value={draft.incomeMultiple} onChange={(v) => set('incomeMultiple', v)} hint="Commonly 2.5 or 3 times the monthly rent, gross." optional />
          <NumberField label="Commute, minutes" value={draft.commuteMinutes} onChange={(v) => set('commuteMinutes', v)} optional />
        </Stack>
      </Section>

      <Banner
        tone="muted"
        icon="info"
        title="Nothing here touches your accounts"
        message="A place you are considering is a note, not a transaction. Only moving in and recording the rent changes your money."
      />
    </Screen>
  );
}
