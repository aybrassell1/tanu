import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { FeeEditor } from '@/components/places/FeeEditor';
import { Banner, Button, ChipSelect, DateField, MoneyField, NavHeader, NumberField, Row, Screen, Section, Stack, SwitchRow, Text, TextField, useOverlay } from '@/components/ui';
import { UTILITIES, newPlace, placeCost, setUtilityCost, utilityCost } from '@/domain/places';
import { concessionEffect } from '@/domain/places';
import type { Cents, Place, PlaceConcession, PlaceFee } from '@/domain/types';
import { goBackOr } from '@/lib/navigation';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors } from '@/theme/tokens';

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
  const offer = draft.concession;
  const setOffer = (patch: Partial<PlaceConcession>) =>
    set('concession', { freeMonths: offer?.freeMonths ?? 0, applied: offer?.applied ?? 'spread', ...offer, ...patch });
  const effect = concessionEffect({ ...draft, id: 'draft', createdAt: '', updatedAt: '' } as Place);

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
            hint="Tap what the rent covers."
          />
        </Stack>
      </Section>

      <Section title="Utilities you pay" subtitle="A range is fine — winter is not summer">
        <Stack>
          {UTILITIES.filter((u) => !draft.included.includes(u.id)).map((u) => {
            const line = utilityCost(draft.fees, u.id);
            return (
              <Row key={u.id}>
                <Text style={{ flex: 1 }}>{u.label}</Text>
                <View style={{ width: 104 }}>
                  <MoneyField
                    value={line?.amount || undefined}
                    onChange={(v: Cents | undefined) => setFees(setUtilityCost(draft.fees, u.id, u.label, v, line?.high))}
                    accessibilityLabel={`${u.label}, typical or lowest`}
                  />
                </View>
                <Text variant="small" color={colors.textTertiary}>
                  to
                </Text>
                <View style={{ width: 104 }}>
                  <MoneyField
                    value={line?.high || undefined}
                    onChange={(v: Cents | undefined) => setFees(setUtilityCost(draft.fees, u.id, u.label, line?.amount, v))}
                    placeholder="—"
                    accessibilityLabel={`${u.label}, highest`}
                  />
                </View>
              </Row>
            );
          })}
          {draft.included.length === UTILITIES.length && (
            <Text variant="small" color={colors.textSecondary}>
              The rent covers all of them. Nothing to add.
            </Text>
          )}
          <Text variant="caption" color={colors.textTertiary}>
            Leave the second box empty for a fixed amount. Where you give a range, the grade uses the top of it.
          </Text>
        </Stack>
      </Section>

      <Section title="Other monthly fees">
        <FeeEditor when="monthly" fees={draft.fees} onChange={setFees} emptyHint="Parking, amenity, pet rent — anything that arrives every month that is not rent or a utility." />
      </Section>

      <Section title="Any deal on?" subtitle="Free months change the rent by hundreds, depending how they are applied">
        <Stack>
          <NumberField
            label="Months free"
            value={offer?.freeMonths || undefined}
            onChange={(v) => setOffer({ freeMonths: v ?? 0 })}
            hint="Halves are normal. Two months free on a 14-month lease is common."
            optional
          />
          {(offer?.freeMonths ?? 0) > 0 && (
            <ChipSelect
              label="How is it applied?"
              options={[
                { value: 'spread', label: 'Spread over the lease' },
                { value: 'upfront', label: 'First months free' },
              ]}
              value={offer?.applied ?? 'spread'}
              onChange={(v) => setOffer({ applied: v as PlaceConcession['applied'] })}
              hint="Ask them which. Spread lowers every month; up front means full rent once it ends."
            />
          )}
          <MoneyField label="Money off at signing" value={offer?.upfrontCredit || undefined} onChange={(v) => setOffer({ upfrontCredit: v ?? 0 })} optional />
        </Stack>
        {effect && (
          <Banner
            tone="positive"
            icon="tag"
            title={`Worth ${money(effect.worth)} over ${effect.leaseMonths} months`}
            message={
              effect.freeAtStart > 0
                ? `${effect.freeAtStart} ${effect.freeAtStart === 1 ? 'month' : 'months'} at no rent, then ${money(effect.askingRent)} every month. Budget for the full rent — the free part ends.`
                : `${money(effect.payMonth)} a month instead of ${money(effect.askingRent)}. At renewal it goes back up by ${money(effect.renewalJump)}.`
            }
          />
        )}
      </Section>

      <Section title="Due at signing">
        <Stack>
          <FeeEditor when="upfront" fees={draft.fees} onChange={setFees} emptyHint="Deposit, admin and application fees — anything they want before the keys." />
          <SwitchRow label="First month's rent due at signing" value={draft.firstMonthUpfront} onChange={(v) => set('firstMonthUpfront', v)} />
        </Stack>
      </Section>

      {cost.priced && (
        <Banner
          tone="primary"
          icon="dollar-sign"
          title={cost.ranged ? `${money(cost.monthly)} to ${money(cost.monthlyHigh)} a month` : `${money(cost.monthly)} a month, all in`}
          message={
            cost.aboveRentHigh > 0
              ? `${cost.ranged ? `${money(cost.aboveRent)} to ${money(cost.aboveRentHigh)}` : money(cost.aboveRent)} on top of the rent, and ${cost.upfrontHigh > cost.upfront ? `${money(cost.upfront)} to ${money(cost.upfrontHigh)}` : money(cost.upfront)} before you get the keys.`
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
