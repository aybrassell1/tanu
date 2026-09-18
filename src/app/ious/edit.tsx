import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AccountSelect, CategorySelect } from '@/components/finance/Pickers';
import {
  Banner,
  Button,
  ChipSelect,
  DateField,
  MoneyField,
  NavHeader,
  Screen,
  Stack,
  SwitchRow,
  TagInput,
  Text,
  TextField,
  useOverlay,
} from '@/components/ui';
import { accountNature } from '@/domain/catalog';
import { IOU_TAG, moneyMovePlan, moneyMoveTransaction, personKey, type IouDirection } from '@/domain/ious';
import { allTags } from '@/domain/search';
import { goBackOr } from '@/lib/navigation';
import type { Account, Cents, ID, ISODate, Iou } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

type Draft = Omit<Iou, 'id' | 'entries' | 'createdAt' | 'updatedAt'> & { id?: ID };

const DIRECTIONS: { value: IouDirection; label: string; icon: 'arrow-down-left' | 'arrow-up-right' }[] = [
  { value: 'owed_to_me', label: 'They owe me', icon: 'arrow-down-left' },
  { value: 'i_owe', label: 'I owe them', icon: 'arrow-up-right' },
];

const assetFilter = (a: Account) => accountNature(a.type) === 'asset';

export default function IouFormScreen() {
  const params = useLocalSearchParams<{ id?: string; person?: string; direction?: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { toast } = useOverlay();
  const existing = params.id ? data.ious.find((x) => x.id === params.id) : undefined;

  const [draft, setDraft] = useState<Draft>(() =>
    existing
      ? { ...existing }
      : {
          person: params.person ?? '',
          direction: params.direction === 'i_owe' ? 'i_owe' : 'owed_to_me',
          amount: 0,
          date: today,
          tags: [],
          archived: false,
        },
  );
  const [record, setRecord] = useState(false);
  const [accountId, setAccountId] = useState<ID | undefined>(() => data.accounts.find((a) => !a.archived && a.spendable && assetFilter(a))?.id ?? data.accounts.find((a) => !a.archived && assetFilter(a))?.id);
  const [categoryId, setCategoryId] = useState<ID | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const tagSuggestions = useMemo(() => allTags(data).map((t) => t.tag).filter((t) => t !== IOU_TAG), [data]);
  const people = useMemo(() => {
    const seen = new Map<string, string>();
    for (const i of data.ious) if (!seen.has(personKey(i.person))) seen.set(personKey(i.person), i.person.trim());
    return [...seen.values()].filter((p) => p && personKey(p) !== personKey(draft.person)).slice(0, 6);
  }, [data.ious, draft.person]);

  const plan = moneyMovePlan(draft.direction, 'principal');
  const incoming = draft.direction === 'owed_to_me';

  const save = () => {
    if (record && !accountId) return setErrors({ accountId: 'Choose the account the money moved through.' });

    const result = ledger.saveIou({
      ...draft,
      person: draft.person.trim(),
      reason: draft.reason?.trim() || undefined,
      notes: draft.notes?.trim() || undefined,
    });
    if (!result.ok) return setErrors(result.errors);

    if (!existing && record && accountId) {
      const tx = ledger.saveTransaction(
        moneyMoveTransaction({
          direction: draft.direction,
          kind: 'principal',
          amount: draft.amount,
          date: draft.date,
          accountId,
          person: draft.person,
          reason: draft.reason,
          categoryId: plan.category ? categoryId : undefined,
          tags: draft.tags,
        }),
      );
      if (!tx.ok) toast({ message: `IOU saved, but the money movement wasn't recorded: ${Object.values(tx.errors)[0] ?? 'unknown error'}`, tone: 'error' });
      else toast(`IOU saved and ${money(draft.amount)} recorded`);
    } else {
      toast(existing ? 'IOU updated' : 'IOU saved');
    }

    if (existing) goBackOr(router, `/ious/${existing.id}`);
    else router.replace(`/ious/${result.id}`);
  };

  return (
    <Screen header={<NavHeader title={existing ? 'Edit IOU' : 'New IOU'} backIcon="x" />} footer={<Button label="Save" size="lg" fullWidth onPress={save} />}>
      {!!errors.form && <Banner tone="negative" icon="alert-triangle" title={errors.form} />}

      <Stack gap={spacing.lg}>
        <View style={{ gap: spacing.sm }}>
          <TextField
            label="Person"
            value={draft.person}
            onChangeText={(t) => set('person', t)}
            error={errors.person}
            placeholder="e.g. Sam"
            autoFocus={!existing}
            autoCapitalize="words"
          />
          {people.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {people.map((p) => (
                <Button key={p} label={p} size="sm" variant="secondary" onPress={() => set('person', p)} />
              ))}
            </View>
          )}
        </View>

        <ChipSelect
          label="Which way?"
          options={DIRECTIONS}
          value={draft.direction}
          onChange={(direction) => {
            set('direction', direction);
            setCategoryId(undefined);
            setErrors({});
          }}
          hint={incoming ? 'You are waiting to be paid back.' : 'You owe this person.'}
        />

        <MoneyField label="Amount" value={draft.amount || undefined} onChange={(c) => set('amount', (c ?? 0) as Cents)} error={errors.amount} />
        <DateField label={incoming ? 'Lent on' : 'Borrowed on'} value={draft.date} onChange={(d) => set('date', (d ?? today) as ISODate)} shortcuts error={errors.date} />
        <DateField label="Due by" value={draft.dueDate} onChange={(d) => set('dueDate', d)} optional clearable hint="Used to flag it as overdue. Nothing is charged." />
        <TextField label="What for" value={draft.reason ?? ''} onChangeText={(t) => set('reason', t)} optional placeholder={incoming ? 'e.g. Covered their concert ticket' : 'e.g. They covered dinner'} />
      </Stack>

      {!existing && (
        <Stack gap={spacing.md}>
          <SwitchRow label={plan.title} description={plan.explain} value={record} onChange={setRecord} icon="link" />
          {record ? (
            <>
              <AccountSelect
                label={plan.flow === 'in' ? 'Money arrived in' : 'Money left'}
                value={accountId}
                onChange={(id) => {
                  setAccountId(id);
                  setErrors(({ accountId: _a, ...rest }) => rest);
                }}
                filter={assetFilter}
                error={errors.accountId}
              />
              {plan.category && <CategorySelect label="Category" kind="expense" value={categoryId} onChange={setCategoryId} optional hint="Where the money went. Repayments come back as reimbursements in the same place." />}
            </>
          ) : (
            <Text variant="caption" color={colors.textTertiary}>
              Leave this off and the IOU is just a note to yourself — no account balance changes.
            </Text>
          )}
        </Stack>
      )}

      <Stack gap={spacing.lg}>
        <TagInput value={draft.tags} onChange={(t) => set('tags', t)} suggestions={tagSuggestions} />
        <TextField label="Notes" value={draft.notes ?? ''} onChangeText={(t) => set('notes', t)} multiline optional />
      </Stack>
    </Screen>
  );
}
