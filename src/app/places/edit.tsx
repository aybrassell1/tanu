import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { Banner, Button, ChipSelect, DateField, MoneyField, NavHeader, NumberField, Screen, Section, Stack, SwitchRow, TextField, useOverlay } from '@/components/ui';
import { UTILITIES, newPlace, placeCost } from '@/domain/places';
import type { Cents, Place } from '@/domain/types';
import { goBackOr } from '@/lib/navigation';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors } from '@/theme/tokens';

type Draft = Omit<Place, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

/**
 * The numbers a listing does not advertise. Everything here is optional except
 * a name: a place added in the car park with just a rent is still worth having.
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
        <DateField label="Toured on" value={draft.touredOn ?? today} onChange={(v) => set('touredOn', v)} />
      </Stack>

      <Section title="Every month" subtitle="What you would actually pay">
        <Stack>
          <MoneyField label="Rent" value={draft.rent} onChange={(v) => set('rent', v ?? 0)} />
          <ChipSelect
            label="Included in the rent"
            options={UTILITIES.map((u) => ({ value: u.id, label: u.label }))}
            value={draft.included}
            onChange={(v) => set('included', draft.included.includes(v) ? draft.included.filter((x) => x !== v) : [...draft.included, v])}
            hint="Tap what the rent covers. Anything left is yours to pay."
          />
          <MoneyField label="Utilities you would pay" value={draft.utilitiesEstimate} onChange={(v) => set('utilitiesEstimate', v ?? 0)} hint="Ask them for a summer and a winter average." optional />
          <MoneyField label="Parking" value={draft.parking} onChange={(v) => set('parking', v ?? 0)} optional />
          <MoneyField label="Pet rent" value={draft.petRent} onChange={(v) => set('petRent', v ?? 0)} optional />
          <MoneyField label="Other monthly fees" value={draft.otherMonthly} onChange={(v) => set('otherMonthly', v ?? 0)} hint="Amenity, trash, valet, pest, package locker." optional />
          <MoneyField label="Renter's insurance" value={draft.insurance} onChange={(v) => set('insurance', v ?? 0)} hint="Usually required. Often $10–25 a month." optional />
        </Stack>
        {cost.monthly > 0 && (
          <Banner
            tone={cost.aboveRent > 0 ? 'primary' : 'muted'}
            icon="dollar-sign"
            title={`${money(cost.monthly)} a month, all in`}
            message={cost.aboveRent > 0 ? `${money(cost.aboveRent)} a month on top of the rent.` : 'Add utilities and fees to see the real number.'}
          />
        )}
      </Section>

      <Section title="Before you get the keys">
        <Stack>
          <MoneyField label="Security deposit" value={draft.deposit} onChange={(v) => set('deposit', v ?? 0)} optional />
          <MoneyField label="Admin or move-in fee" value={draft.adminFee} onChange={(v) => set('adminFee', v ?? 0)} optional />
          <MoneyField label="Application fee" value={draft.applicationFee} onChange={(v) => set('applicationFee', v ?? 0)} optional />
          <MoneyField label="Pet deposit" value={draft.petDeposit} onChange={(v) => set('petDeposit', v ?? 0)} optional />
          <SwitchRow label="First month's rent due at signing" value={draft.firstMonthUpfront} onChange={(v) => set('firstMonthUpfront', v)} />
        </Stack>
      </Section>

      <Section title="The lease">
        <Stack>
          <NumberField label="Lease length, months" value={draft.leaseMonths} onChange={(v) => set('leaseMonths', v)} optional />
          <DateField label="Available from" value={draft.availableOn ?? ''} onChange={(v) => set('availableOn', v)} optional />
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
