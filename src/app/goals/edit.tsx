import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AccountSelect, accountOptions } from '@/components/finance/Pickers';
import { defaultGoalAccount } from '@/components/goals/ContributionSheet';
import {
  Banner,
  Button,
  DateField,
  Field,
  MoneyField,
  NavHeader,
  PickerButton,
  Pill,
  Screen,
  SelectField,
  SelectSheet,
  Stack,
  TagInput,
  Text,
  TextField,
  useOverlay,
  type SelectOption,
} from '@/components/ui';
import { icon } from '@/data/icons';
import { accountNature, ENTITY_COLORS, GOAL_KINDS, GOAL_TEMPLATES, isInvestment } from '@/domain/catalog';
import { allocationsByAccount, debtGoalStart } from '@/domain/goals';
import { balanceOn, indexLedger } from '@/domain/ledger';
import { allTags } from '@/domain/search';
import { validateContribution } from '@/domain/validation';
import { goBackOr } from '@/lib/navigation';
import type { Account, Cents, Goal, GoalKind, GoalTemplate, ID } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, radius, spacing } from '@/theme/tokens';

type Draft = Omit<Goal, 'id' | 'createdAt' | 'updatedAt'> & { id?: ID };

type Preset = { key: string; label: string; kind: GoalKind; template: GoalTemplate; icon: string; name: string };

const SAVINGS_TEMPLATES: GoalTemplate[] = ['emergency', 'move_out', 'vacation', 'car', 'purchase', 'general'];

const PRESETS: Preset[] = [
  ...SAVINGS_TEMPLATES.map((t) => ({ key: t, label: GOAL_TEMPLATES[t].label, kind: GOAL_TEMPLATES[t].kind, template: t, icon: GOAL_TEMPLATES[t].icon, name: GOAL_TEMPLATES[t].label })),
  { key: 'debt_payoff', label: 'Pay off debt', kind: 'debt_payoff', template: 'custom', icon: 'trending-down', name: 'Pay off debt' },
  { key: 'investment', label: 'Invest', kind: 'investment', template: 'custom', icon: 'trending-up', name: 'Invest' },
  { key: 'net_worth', label: 'Reach a net worth', kind: 'net_worth', template: 'custom', icon: 'bar-chart-2', name: 'Reach a net worth' },
  { key: 'custom', label: 'Custom', kind: 'custom', template: 'custom', icon: 'flag', name: '' },
];

const KIND_ICON: Record<GoalKind, string> = { savings: 'shield', debt_payoff: 'trending-down', net_worth: 'bar-chart-2', investment: 'trending-up', custom: 'flag' };
const KIND_OPTIONS: SelectOption<GoalKind>[] = (Object.keys(GOAL_KINDS) as GoalKind[]).map((k) => ({ value: k, label: GOAL_KINDS[k].label, description: GOAL_KINDS[k].description, icon: icon(KIND_ICON[k]) }));

const liabilityFilter = (a: Account) => accountNature(a.type) === 'liability';
const investmentFilter = (a: Account) => isInvestment(a.type);
const assetFilter = (a: Account) => accountNature(a.type) === 'asset';

const presetFor = (key: string | undefined) => PRESETS.find((p) => p.key === key);

export default function GoalFormScreen() {
  const params = useLocalSearchParams<{ id?: string; template?: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { toast } = useOverlay();
  const existing = params.id ? data.goals.find((g) => g.id === params.id) : undefined;

  const [presetKey, setPresetKey] = useState<string | undefined>(() => (existing ? undefined : presetFor(params.template)?.key));
  const [draft, setDraft] = useState<Draft>(() => {
    if (existing) return { ...existing };
    const preset = presetFor(params.template);
    return {
      name: preset?.name ?? '',
      kind: preset?.kind ?? 'savings',
      template: preset?.template ?? 'general',
      target: 0,
      linkedAccountIds: [],
      startDate: today,
      icon: preset?.icon ?? 'shield',
      color: ENTITY_COLORS[0],
      tags: [],
      archived: false,
    };
  });
  const [targetTouched, setTargetTouched] = useState(!!existing);
  const [alreadySaved, setAlreadySaved] = useState<Cents | undefined>();
  const [heldIn, setHeldIn] = useState<ID | undefined>(() => defaultGoalAccount(data.accounts, [], undefined));
  const [linkOpen, setLinkOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const tagSuggestions = useMemo(() => allTags(data).map((t) => t.tag), [data]);

  const linkable = draft.kind === 'debt_payoff' || draft.kind === 'investment';
  const linkOptions = useMemo(() => (linkable ? accountOptions(data, today, draft.kind === 'debt_payoff' ? liabilityFilter : investmentFilter) : []), [data, today, draft.kind, linkable]);
  const index = indexLedger(data);

  const unassignedInHeldIn = useMemo(() => {
    if (!heldIn) return null;
    // Same basis as validateContribution: future-dated allocations already claim money.
    const alloc = allocationsByAccount(data, today, true).get(heldIn);
    return alloc ? alloc.unallocated : balanceOn(indexLedger(data), heldIn, today);
  }, [data, today, heldIn]);

  const choosePreset = (p: Preset) => {
    const d = draft;
    const previousDefault = presetFor(presetKey)?.name ?? '';
    const keepName = d.name.trim() !== '' && d.name !== previousDefault;
    const next: Draft = { ...d, kind: p.kind, template: p.template, icon: p.icon, name: keepName ? d.name : p.name };
    if (d.kind !== p.kind) {
      next.linkedAccountIds = [];
      if (p.kind === 'debt_payoff' || d.kind === 'debt_payoff') {
        next.target = 0;
        setTargetTouched(false);
      }
    }
    setPresetKey(p.key);
    setErrors({});
    setDraft(next);
  };

  const changeKind = (kind: GoalKind) => {
    const d = draft;
    if (d.kind === kind) return;
    const next: Draft = { ...d, kind, linkedAccountIds: [], icon: kind === 'savings' && d.template !== 'custom' ? d.icon : KIND_ICON[kind] };
    if (kind !== 'savings' && d.template !== 'custom') next.template = 'custom';
    if (kind === 'debt_payoff' || d.kind === 'debt_payoff') {
      next.target = 0;
      setTargetTouched(false);
    }
    setPresetKey(undefined);
    setErrors({});
    setDraft(next);
  };

  const toggleLinked = (accountId: ID) => {
    setDraft((d) => {
      const linkedAccountIds = d.linkedAccountIds.includes(accountId) ? d.linkedAccountIds.filter((x) => x !== accountId) : [...d.linkedAccountIds, accountId];
      const next = { ...d, linkedAccountIds };
      if (d.kind === 'debt_payoff' && !targetTouched) next.target = debtGoalStart(data, linkedAccountIds, today);
      return next;
    });
  };

  const linkedSummary = (() => {
    const names = draft.linkedAccountIds.map((x) => index.accounts.get(x)?.name).filter((n): n is string => !!n);
    if (names.length === 0) return undefined;
    return names.length <= 2 ? names.join(', ') : `${names.length} accounts`;
  })();

  const isNewSavings = !existing && draft.kind === 'savings';

  /** Checks the starting amount with the same rules as a real contribution, before anything is saved. */
  const startingAmountError = (): string | undefined => {
    if (!isNewSavings || !alreadySaved || alreadySaved <= 0 || !heldIn) return undefined;
    const probeId = '__new_goal__';
    const probe = { ...data, goals: [...data.goals, { ...draft, id: probeId, kind: 'savings' as const, createdAt: '', updatedAt: '' }] };
    const e = validateContribution(probe, { id: 'probe', goalId: probeId, date: today, amount: alreadySaved, accountId: heldIn, createdAt: '' }, today);
    return e.amount ?? e.accountId ?? e.form;
  };

  const save = () => {
    if (isNewSavings && alreadySaved && alreadySaved > 0 && !heldIn) {
      setErrors({ heldIn: 'Choose the account holding this money.' });
      return;
    }
    const startError = startingAmountError();
    if (startError) {
      setErrors({ alreadySaved: startError });
      return;
    }
    const input: Draft = {
      ...draft,
      notes: draft.notes?.trim() || undefined,
      // Payoff progress is measured from this amount.
      startValue: draft.kind === 'debt_payoff' ? draft.target : draft.startValue,
    };
    const result = ledger.saveGoal(input);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }

    if (isNewSavings && alreadySaved && alreadySaved > 0 && heldIn) {
      const c = ledger.addContribution({ goalId: result.id, date: today, amount: alreadySaved, accountId: heldIn, note: 'Already saved' });
      if (!c.ok) toast({ message: `Goal saved, but the starting amount wasn't added: ${Object.values(c.errors)[0] ?? 'unknown error'}`, tone: 'error' });
      else toast(`Goal created with ${money(alreadySaved)} assigned`);
    } else {
      toast(existing ? 'Goal updated' : 'Goal created');
    }

    if (existing) goBackOr(router, `/goals/${existing.id}`);
    else router.replace(`/goals/${result.id}`);
  };

  const targetLabel = draft.kind === 'debt_payoff' ? 'Debt to pay off' : draft.kind === 'net_worth' ? 'Target net worth' : draft.kind === 'investment' ? 'Target value' : 'Target amount';

  return (
    <Screen header={<NavHeader title={existing ? 'Edit goal' : 'New goal'} backIcon="x" />} footer={<Button label="Save" size="lg" fullWidth onPress={save} />}>
      {!existing && (
        <Stack gap={spacing.sm}>
          <Text variant="small" weight="medium" color={colors.textSecondary}>
            Start from
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {PRESETS.map((p) => (
              <Pill key={p.key} label={p.label} icon={icon(p.icon)} selected={presetKey === p.key} onPress={() => choosePreset(p)} />
            ))}
          </ScrollView>
        </Stack>
      )}

      {!!errors.form && <Banner tone="negative" icon="alert-triangle" title={errors.form} />}

      <Stack gap={spacing.lg}>
        <TextField label="Name" value={draft.name} onChangeText={(t) => set('name', t)} error={errors.name} placeholder="e.g. Trip to Japan" autoFocus={!existing && !presetKey} />
        <SelectField label="Kind" value={draft.kind} onChange={changeKind} options={KIND_OPTIONS} hint={GOAL_KINDS[draft.kind].description} />

        {linkable && (
          <>
            <PickerButton
              label={draft.kind === 'debt_payoff' ? 'Debts to pay off' : 'Investment accounts'}
              valueLabel={linkedSummary}
              placeholder={linkOptions.length ? 'Choose accounts' : draft.kind === 'debt_payoff' ? 'Add a card or loan first' : 'Add an investment account first'}
              icon="link"
              onPress={() => setLinkOpen(true)}
              error={errors.linkedAccountIds}
              hint={draft.kind === 'debt_payoff' ? 'Progress follows what you still owe on these.' : 'Progress follows the value of these accounts.'}
            />
            <SelectSheet
              visible={linkOpen}
              onClose={() => setLinkOpen(false)}
              title={draft.kind === 'debt_payoff' ? 'Debts to pay off' : 'Investment accounts'}
              options={linkOptions}
              value={draft.linkedAccountIds}
              onSelect={toggleLinked}
              multiple
            />
          </>
        )}

        <MoneyField
          label={targetLabel}
          value={draft.target || undefined}
          onChange={(c) => {
            setTargetTouched(true);
            set('target', (c ?? 0) as Cents);
          }}
          error={errors.target}
          hint={
            draft.kind === 'debt_payoff'
              ? 'Starts from the linked debts’ original or current balance, whichever is higher. Progress is this amount minus what you still owe.'
              : draft.kind === 'savings'
                ? 'Money is assigned from balances you already have, so it is never counted twice.'
                : undefined
          }
        />
        <DateField label="Target date" value={draft.targetDate} onChange={(d) => set('targetDate', d)} optional clearable hint="Used to work out how much you need each month." />
      </Stack>

      {isNewSavings && (
        <Stack gap={spacing.lg}>
          <MoneyField
            label="Already saved"
            value={alreadySaved}
            onChange={(c) => {
              setAlreadySaved(c);
              setErrors(({ alreadySaved: _a, ...rest }) => rest);
            }}
            error={errors.alreadySaved}
            optional
            hint="Assign money you've already set aside for this goal."
          />
          {!!alreadySaved && alreadySaved > 0 && (
            <View style={{ gap: 6 }}>
              <AccountSelect
                label="Held in"
                value={heldIn}
                onChange={(id) => {
                  setHeldIn(id);
                  setErrors(({ heldIn: _h, alreadySaved: _a, ...rest }) => rest);
                }}
                filter={assetFilter}
                error={errors.heldIn}
              />
              {unassignedInHeldIn !== null && (
                <Text variant="caption" color={colors.textSecondary} tabular>
                  {`Unassigned in this account: ${money(Math.max(0, unassignedInHeldIn))}`}
                </Text>
              )}
            </View>
          )}
        </Stack>
      )}

      <Stack gap={spacing.lg}>
        <Field label="Color">
          <View style={styles.colors}>
            {ENTITY_COLORS.map((c, i) => {
              const selected = draft.color === c;
              return (
                <Pressable
                  key={c}
                  onPress={() => set('color', c)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={`Color ${i + 1}`}
                  hitSlop={4}
                  style={[styles.swatch, { backgroundColor: c }, selected && styles.swatchSelected]}
                >
                  {selected && <Feather name="check" size={16} color={colors.onPrimary} />}
                </Pressable>
              );
            })}
          </View>
        </Field>
        <TagInput value={draft.tags} onChange={(t) => set('tags', t)} suggestions={tagSuggestions} />
        <TextField label="Notes" value={draft.notes ?? ''} onChangeText={(t) => set('notes', t)} multiline optional />
      </Stack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  swatchSelected: { borderWidth: 3, borderColor: colors.primaryMuted },
});
