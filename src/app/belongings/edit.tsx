import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';

import { accountOptions } from '@/components/finance/Pickers';
import { Banner, Button, ChipSelect, DateField, MoneyField, NavHeader, Screen, SelectField, Stack, TagInput, TextField, useOverlay, type SelectOption } from '@/components/ui';
import { icon } from '@/data/icons';
import { accountNature, ASSET_TYPES } from '@/domain/catalog';
import { createId } from '@/domain/factory';
import { allTags, normalizeTag } from '@/domain/search';
import type { AssetType, Cents, ID, ISODate } from '@/domain/types';
import { goBackOr } from '@/lib/navigation';
import { useData, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { spacing } from '@/theme/tokens';

const TYPE_OPTIONS = (Object.keys(ASSET_TYPES) as AssetType[]).map((value) => ({ value, label: ASSET_TYPES[value].label, icon: icon(ASSET_TYPES[value].icon) }));

export default function AssetFormScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const { toast } = useOverlay();
  const existing = params.id ? data.assets.find((a) => a.id === params.id) : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<AssetType>(existing?.type ?? 'vehicle');
  const [purchasePrice, setPurchasePrice] = useState<Cents | undefined>(existing?.purchasePrice);
  const [purchaseDate, setPurchaseDate] = useState<ISODate | undefined>(existing?.purchaseDate);
  const [currentValue, setCurrentValue] = useState<Cents | undefined>(undefined);
  const [linkedLiabilityId, setLinkedLiabilityId] = useState<ID>(existing?.linkedLiabilityId ?? '');
  const [expenseTag, setExpenseTag] = useState(existing?.expenseTag ?? '');
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const loanOptions = useMemo<SelectOption<ID>[]>(
    () => [
      { value: '', label: 'None', description: 'No loan is secured by this asset' },
      ...accountOptions(data, today, (a) => accountNature(a.type) === 'liability' && (!a.archived || a.id === existing?.linkedLiabilityId), true),
    ],
    [data, today, existing?.linkedLiabilityId],
  );
  const tagSuggestions = useMemo(() => allTags(data).map((t) => t.tag), [data]);
  const normalizedTag = normalizeTag(expenseTag);

  if (params.id && !existing) {
    return (
      <Screen header={<NavHeader title="Edit asset" backIcon="x" />}>
        <Banner tone="negative" icon="alert-triangle" title="Asset not found" message="It may have been deleted." />
      </Screen>
    );
  }

  const save = () => {
    const result = ledger.saveAsset({
      id: existing?.id,
      name,
      type,
      purchasePrice,
      purchaseDate,
      valuations: existing ? existing.valuations : currentValue !== undefined ? [{ id: createId('val'), date: today, value: currentValue }] : [],
      linkedLiabilityId: linkedLiabilityId || undefined,
      expenseTag: normalizedTag || undefined,
      notes: notes.trim() || undefined,
      tags,
      archived: existing?.archived ?? false,
      soldDate: existing?.soldDate,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    toast(existing ? 'Asset updated' : 'Asset added');
    if (existing) goBackOr(router, `/belongings/${existing.id}`);
    else router.replace(`/belongings/${result.id}`);
  };

  return (
    <Screen header={<NavHeader title={existing ? 'Edit asset' : 'New asset'} backIcon="x" />} footer={<Button label="Save" size="lg" fullWidth onPress={save} />}>
      {!!errors.form && <Banner tone="negative" icon="alert-triangle" title={errors.form} />}

      <Stack gap={spacing.lg}>
        <TextField
          label="Name"
          value={name}
          onChangeText={(t) => {
            setName(t);
            if (errors.name) setErrors((e) => ({ ...e, name: '' }));
          }}
          placeholder="e.g. 2019 Honda Civic"
          error={errors.name || undefined}
          autoFocus={!existing}
        />
        <ChipSelect label="Type" options={TYPE_OPTIONS} value={type} onChange={setType} />
      </Stack>

      <Stack gap={spacing.lg}>
        {existing ? (
          <Banner tone="muted" icon="info" title="Update the value from the asset page to keep history" />
        ) : (
          <MoneyField
            label="Current estimated value"
            value={currentValue}
            onChange={(c) => {
              setCurrentValue(c);
              if (errors.valuations) setErrors((e) => ({ ...e, valuations: '' }));
            }}
            error={errors.valuations || undefined}
            hint="What you could sell it for today. This counts toward your net worth."
          />
        )}
        <MoneyField label="Purchase price" value={purchasePrice} onChange={setPurchasePrice} optional />
        <DateField
          label="Purchase date"
          value={purchaseDate}
          onChange={setPurchaseDate}
          optional
          clearable
          hint={purchaseDate && purchaseDate > today ? 'Future purchase: it counts toward net worth from this date.' : undefined}
        />
      </Stack>

      <Stack gap={spacing.lg}>
        <SelectField
          label="Loan for this asset"
          value={linkedLiabilityId}
          onChange={setLinkedLiabilityId}
          options={loanOptions}
          optional
          placeholder="None"
          hint={loanOptions.length === 1 ? 'Add an auto loan or mortgage account to track equity.' : 'Shows your equity: value minus what you still owe.'}
        />
        <TextField
          label="Expense tag"
          value={expenseTag}
          onChangeText={setExpenseTag}
          onBlur={() => setExpenseTag(normalizedTag)}
          optional
          autoCapitalize="none"
          autoCorrect={false}
          prefix="#"
          placeholder="car"
          hint={`Transactions tagged #${normalizedTag || 'car'} show up as costs of this asset`}
        />
        <TagInput value={tags} onChange={setTags} suggestions={tagSuggestions} />
        <TextField label="Notes" value={notes} onChangeText={setNotes} multiline optional placeholder="VIN, serial number, warranty…" />
      </Stack>
    </Screen>
  );
}
