import Feather from '@expo/vector-icons/Feather';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, Field, IconButton, IconTile, NavHeader, Pill, Screen, Segmented, SelectField, Sheet, StatusBadge, SwitchRow, Text, TextField, useOverlay, VisualTile, InfoButton } from '@/components/ui';
import { categoryEmoji } from '@/data/visuals';
import { icon, type IconName } from '@/data/icons';
import { ENTITY_COLORS } from '@/domain/catalog';
import { childrenOf, isCategoryUsed, rootCategories } from '@/domain/categories';
import { TRANSFER_LABEL_CATEGORIES } from '@/domain/defaultCategories';
import type { Category, CategoryKind, ID } from '@/domain/types';
import { useData, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, radius, spacing } from '@/theme/tokens';

const ICONS: IconName[] = ['home', 'truck', 'coffee', 'heart', 'film', 'shopping-bag', 'refresh-cw', 'percent', 'book-open', 'gift', 'briefcase', 'smartphone', 'zap', 'droplet', 'wifi', 'map', 'music', 'scissors', 'tool', 'users', 'award', 'globe', 'package', 'more-horizontal'];

type Draft = { id?: ID; name: string; parentId: ID | null; kind: CategoryKind; icon: string; color: string; essential: boolean; archived: boolean };

export default function CategoriesScreen() {
  const data = useData();
  const today = useToday();
  const { confirm, toast } = useOverlay();
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<Set<ID>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | undefined>();

  const usage = useMemo(() => {
    const counts = new Map<ID, number>();
    const year = today.slice(0, 4);
    for (const t of data.transactions) if (t.categoryId && t.date.startsWith(year)) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
    return counts;
  }, [data.transactions, today]);

  const roots = rootCategories(data, kind, showArchived);

  const openNew = (parent?: Category) =>
    setDraft({ name: '', parentId: parent?.id ?? null, kind, icon: parent?.icon ?? 'tag', color: parent?.color ?? ENTITY_COLORS[0], essential: parent?.essential ?? false, archived: false });
  const openEdit = (c: Category) => setDraft({ ...c });

  const save = () => {
    if (!draft) return;
    const existing = draft.id ? data.categories.find((c) => c.id === draft.id) : undefined;
    const result = ledger.saveCategory({ ...draft, order: existing?.order });
    if (!result.ok) return setError(Object.values(result.errors)[0]);
    toast(existing ? 'Category updated' : 'Category added');
    setDraft(null);
    setError(undefined);
  };

  /** A category (or any of its subcategories) with history can only be archived. */
  const inUse = (id: ID) => [id, ...data.categories.filter((c) => c.parentId === id).map((c) => c.id)].some((c) => isCategoryUsed(data, c));

  const remove = async () => {
    if (!draft?.id) return;
    const target = draft;
    const hasSubs = data.categories.some((c) => c.parentId === target.id);
    // Close the sheet first: iOS can't show a dialog over a modal that is still open.
    setDraft(null);
    setError(undefined);
    await new Promise((r) => setTimeout(r, 350));
    if (inUse(target.id!)) {
      const archiveInstead = await confirm({
        title: `${target.name} can't be deleted`,
        message: `${hasSubs ? 'It or one of its subcategories' : 'It'} is used by transactions, bills, income, budgets or favorites. Archive it instead: it's hidden from pickers and past reports stay correct.`,
        confirmLabel: target.archived ? 'OK' : 'Archive instead',
        cancelLabel: target.archived ? 'Close' : 'Keep',
      });
      if (archiveInstead && !target.archived) {
        ledger.archiveCategory(target.id!, true);
        toast({ message: `${target.name} archived`, actionLabel: 'Undo', onAction: ledger.undo });
      }
      return;
    }
    const ok = await confirm({
      title: `Delete ${target.name}?`,
      message: hasSubs ? 'Its subcategories are deleted too. None of them have been used.' : "It hasn't been used anywhere.",
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const result = ledger.deleteCategory(target.id!);
    if (!result.ok) return toast({ message: result.errors.form ?? 'Could not delete this category.', tone: 'error' });
    toast({ message: `${target.name} deleted`, actionLabel: 'Undo', onAction: ledger.undo });
  };

  const archive = () => {
    if (!draft?.id) return;
    ledger.archiveCategory(draft.id, !draft.archived);
    toast(draft.archived ? 'Category restored' : 'Category archived. Past transactions keep it.');
    setDraft(null);
  };

  const parentOptions = [{ value: '', label: 'None (top-level)' }, ...rootCategories(data, draft?.kind ?? kind).filter((c) => c.id !== draft?.id).map((c) => ({ value: c.id, label: c.name, icon: icon(c.icon), color: c.color }))];

  return (
    <Screen header={<NavHeader title="Categories" right={
            <>
              <InfoButton title="How categories work">
                Essential or discretionary is the default for new transactions in a category. Card payments, loan payments, savings and investing are recorded as transfers, so their categories never count as spending.
              </InfoButton>
              <IconButton icon="plus" accessibilityLabel="Add category" onPress={() => openNew()} />
            </>
          }
        />
      }
    >
      <Segmented items={[{ value: 'expense', label: 'Spending' }, { value: 'income', label: 'Income' }]} value={kind} onChange={setKind} />

      {roots.map((root) => {
        const subs = childrenOf(data, root.id, showArchived);
        const open = expanded.has(root.id);
        return (
          <Card key={root.id} padding={spacing.md} style={{ gap: 2, opacity: root.archived ? 0.6 : 1 }}>
            <View style={styles.row}>
              <Pressable style={styles.rowMain} onPress={() => setExpanded((s) => { const n = new Set(s); if (n.has(root.id)) n.delete(root.id); else n.add(root.id); return n; })} accessibilityRole="button" accessibilityState={{ expanded: open }}>
                <VisualTile emoji={categoryEmoji(root.id) ?? 'package'} tint={`${root.color}1A`} size={36} />
                <View style={{ flex: 1 }}>
                  <Text weight="semibold">{root.name}</Text>
                  <Text variant="caption" color={colors.textTertiary}>
                    {subs.length === 1 ? '1 subcategory' : `${subs.length} subcategories`}
                  </Text>
                </View>
                <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
              </Pressable>
              <IconButton icon="edit-2" size={32} variant="plain" accessibilityLabel={`Edit ${root.name}`} onPress={() => openEdit(root)} />
            </View>
            {open && (
              <View style={styles.subs}>
                {subs.map((c) => (
                  <Pressable key={c.id} style={[styles.sub, c.archived && { opacity: 0.5 }]} onPress={() => openEdit(c)} accessibilityRole="button">
                    <Text style={{ flex: 1 }}>{c.name}</Text>
                    {TRANSFER_LABEL_CATEGORIES.includes(c.id) ? <StatusBadge tone="muted" label="Transfer label" /> : c.essential ? <StatusBadge tone="primary" label="Essential" /> : null}
                    {c.archived && <StatusBadge tone="muted" label="Archived" />}
                    <Text variant="caption" color={colors.textTertiary}>
                      {usage.get(c.id) ?? 0}
                    </Text>
                  </Pressable>
                ))}
                <Button label={`Add to ${root.name}`} icon="plus" size="sm" variant="ghost" onPress={() => openNew(root)} />
              </View>
            )}
          </Card>
        );
      })}

      <Button label={showArchived ? 'Hide archived' : 'Show archived'} variant="ghost" onPress={() => setShowArchived(!showArchived)} style={{ alignSelf: 'center' }} />

      <Sheet
        visible={!!draft}
        onClose={() => { setDraft(null); setError(undefined); }}
        title={draft?.id ? 'Edit category' : 'New category'}
        footer={<Button label="Save" size="lg" fullWidth onPress={save} />}
      >
        {draft && (
          <>
            <TextField label="Name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} error={error} autoFocus={!draft.id} />
            {!(draft.id && data.categories.some((c) => c.parentId === draft.id)) && (
              <SelectField label="Parent category" value={draft.parentId ?? ''} onChange={(v) => setDraft({ ...draft, parentId: v || null })} options={parentOptions} />
            )}
            {draft.kind === 'expense' && <SwitchRow label="Essential by default" description="Rent, groceries and insurance are essential; dining out usually isn't." value={draft.essential} onChange={(essential) => setDraft({ ...draft, essential })} />}
            <Field label="Icon">
              <View style={styles.wrap}>
                {ICONS.map((i) => (
                  <Pressable key={i} onPress={() => setDraft({ ...draft, icon: i })} accessibilityRole="radio" accessibilityState={{ checked: draft.icon === i }} accessibilityLabel={i} style={[styles.iconChoice, draft.icon === i && { borderColor: colors.primary, backgroundColor: colors.primarySoft }]}>
                    <Feather name={i} size={18} color={draft.icon === i ? colors.primary : colors.textSecondary} />
                  </Pressable>
                ))}
              </View>
            </Field>
            <Field label="Color">
              <View style={styles.wrap}>
                {ENTITY_COLORS.map((c) => (
                  <Pressable key={c} onPress={() => setDraft({ ...draft, color: c })} accessibilityRole="radio" accessibilityState={{ checked: draft.color === c }} accessibilityLabel={`Color ${c}`} style={[styles.swatch, { backgroundColor: c }, draft.color === c && styles.swatchActive]} />
                ))}
              </View>
            </Field>
            {draft.id && (
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button label={draft.archived ? 'Restore' : 'Archive'} icon="archive" variant="secondary" style={{ flex: 1 }} onPress={archive} />
                <Button label="Delete" icon="trash-2" variant="danger" style={{ flex: 1 }} onPress={remove} />
              </View>
            )}
            {draft.id && <Pill tone="muted" label={usedLabel(usage.get(draft.id) ?? 0)} />}
            {draft.id && inUse(draft.id) && (
              <Text variant="caption" color={colors.textSecondary}>
                This category has history, so it can be archived but not deleted.
              </Text>
            )}
          </>
        )}
      </Sheet>
    </Screen>
  );
}

const usedLabel = (n: number) => (n === 0 ? 'Not used this year' : n === 1 ? 'Used once this year' : `Used ${n} times this year`);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  subs: { marginTop: spacing.sm, marginLeft: 48, gap: 2 },
  sub: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  iconChoice: { width: 40, height: 40, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 32, height: 32, borderRadius: radius.pill, borderWidth: 3, borderColor: colors.surface },
  swatchActive: { boxShadow: `0px 0px 0px 2px ${colors.primary}` },
});
