import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTaxYear, YearSwitch } from '@/components/taxes/TaxParts';
import { Button, Card, EmptyState, ListCard, ListRow, NavHeader, Pill, ProgressRing, Screen, Section, Segmented, Sheet, Text, TextField, useOverlay } from '@/components/ui';
import { EmojiIcon } from '@/components/ui/Glyph';
import { createId } from '@/domain/factory';
import { documentChecklist, estimateTaxes, taxPacketCsv } from '@/domain/taxes';
import type { TaxDocument, TaxDocumentStatus } from '@/domain/types';
import { useData, useDerived, useToday } from '@/store/hooks';
import { exportTextFile, openAttachment, pickAttachment } from '@/store/fileIO';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

type Doc = TaxDocument & { why?: string; arrives?: string };

const STATUS: Record<TaxDocumentStatus, { label: string; emoji: string; tone: 'positive' | 'warning' | 'muted' }> = {
  expected: { label: 'Waiting', emoji: 'hourglass-not-done', tone: 'warning' },
  received: { label: 'Have it', emoji: 'check-mark-button', tone: 'positive' },
  not_needed: { label: 'Not needed', emoji: 'page-facing-up', tone: 'muted' },
};

export default function TaxDocumentsScreen() {
  const data = useData();
  const today = useToday();
  const { toast } = useOverlay();
  const { year, years } = useTaxYear();
  const docs = useDerived((d) => documentChecklist(d, year), [year]);
  const [editing, setEditing] = useState<Doc | null>(null);
  const done = docs.filter((d) => d.status !== 'expected').length;

  const exportPacket = async () => {
    try {
      await exportTextFile(`tax-summary-${year}.csv`, taxPacketCsv(data, year, today, estimateTaxes(data, year, today, 'ytd')), 'text/csv');
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'Export failed.', tone: 'error' });
    }
  };

  const groups: { status: TaxDocumentStatus; title: string }[] = [
    { status: 'expected', title: 'Waiting for' },
    { status: 'received', title: 'In hand' },
    { status: 'not_needed', title: 'Not needed' },
  ];

  return (
    <Screen header={<NavHeader title="Tax documents" right={<YearSwitch year={year} years={years} />} />}>
      <Card style={styles.summary} padding={spacing.xl}>
        <ProgressRing value={docs.length ? done / docs.length : 0} size={64} stroke={6} color={colors.positive}>
          <Text variant="small" weight="semibold" tabular>
            {done}/{docs.length}
          </Text>
        </ProgressRing>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="h3">{docs.length === 0 ? 'No forms expected yet' : done === docs.length ? 'All set' : `${docs.length - done} to collect`}</Text>
          <Text variant="small" color={colors.textSecondary}>
            Suggested from your income and accounts
          </Text>
        </View>
      </Card>

      {docs.length === 0 && <EmptyState icon="file-text" title="Nothing suggested" message="Record paychecks, interest or loan activity and matching forms appear here." compact />}

      {groups.map((g) => {
        const items = docs.filter((d) => d.status === g.status);
        if (items.length === 0) return null;
        return (
          <Section key={g.status} title={g.title}>
            <ListCard>
              {items.map((d) => (
                <ListRow
                  key={d.key}
                  title={`${d.form} · ${d.issuer}`}
                  subtitle={[d.why, d.arrives, d.attachments.length ? `📎 ${d.attachments.length}` : null].filter(Boolean).join(' · ')}
                  leading={<EmojiIcon name={d.custom ? 'clipboard' : 'file-folder'} size={28} />}
                  trailing={<Pill label={STATUS[d.status].label} tone={STATUS[d.status].tone} size="sm" />}
                  onPress={() => setEditing(d)}
                />
              ))}
            </ListCard>
          </Section>
        );
      })}

      <View style={{ gap: spacing.sm }}>
        <Button label="Add a document" icon="plus" variant="secondary" fullWidth onPress={() => setEditing({ key: createId('doc'), form: '', issuer: '', status: 'expected', attachments: [], custom: true })} />
        <Button label="Export tax summary (CSV)" icon="download" variant="secondary" fullWidth onPress={exportPacket} />
      </View>

      <DocumentSheet doc={editing} year={year} onClose={() => setEditing(null)} />
    </Screen>
  );
}

function DocumentSheet({ doc, year, onClose }: { doc: Doc | null; year: number; onClose: () => void }) {
  const data = useData();
  const { toast, confirm } = useOverlay();
  const [draft, setDraft] = useState<Doc | null>(null);
  const [openedFor, setOpenedFor] = useState<Doc | null>(null);
  const [error, setError] = useState<string>();
  if (doc !== openedFor) {
    setOpenedFor(doc);
    setDraft(doc);
    setError(undefined);
  }
  if (!draft) return <Sheet visible={false} onClose={onClose} title="">{null}</Sheet>;
  const saved = !draft.custom || data.taxYears.some((r) => r.year === year && r.documents.some((d) => d.key === draft.key));

  const save = (next: Doc = draft) => {
    const { why: _w, arrives: _a, ...stored } = next;
    const r = ledger.saveTaxDocument(year, { ...stored, issuer: stored.issuer.trim(), note: stored.note?.trim() || undefined });
    if (!r.ok) {
      setError(Object.values(r.errors)[0]);
      return false;
    }
    return true;
  };

  const attach = async () => {
    try {
      const file = await pickAttachment();
      if (!file) return;
      const next = { ...draft, attachments: [...draft.attachments, { id: createId('att'), ...file }] };
      setDraft(next);
      if (!draft.custom || draft.form.trim()) save(next);
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'Could not attach the file.', tone: 'error' });
    }
  };

  return (
    <Sheet
      visible={doc !== null}
      onClose={onClose}
      title={saved ? openedFor?.form || 'Document' : 'Add a document'}
      subtitle={draft.custom ? undefined : draft.issuer}
      footer={
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {draft.custom && saved && (
            <Button
              label="Delete"
              variant="secondary"
              onPress={async () => {
                if (await confirm({ title: 'Delete this document?', confirmLabel: 'Delete', destructive: true })) {
                  ledger.deleteTaxDocument(year, draft.key);
                  onClose();
                  toast({ message: 'Document deleted', actionLabel: 'Undo', onAction: () => ledger.undo() });
                }
              }}
            />
          )}
          <Button label="Done" style={{ flex: 1 }} onPress={() => save() && onClose()} />
        </View>
      }
    >
      <Segmented
        items={(Object.keys(STATUS) as TaxDocumentStatus[]).map((s) => ({ value: s, label: STATUS[s].label }))}
        value={draft.status}
        onChange={(status) => setDraft({ ...draft, status })}
      />
      {draft.custom && (
        <>
          <TextField label="Form" value={draft.form} onChangeText={(form) => setDraft({ ...draft, form })} placeholder="e.g. K-1, 1099-K, 1095-A" error={error} />
          <TextField label="From" value={draft.issuer} onChangeText={(issuer) => setDraft({ ...draft, issuer })} placeholder="Who sends it" />
        </>
      )}
      {draft.why && (
        <Text variant="small" color={colors.textSecondary}>
          {draft.why} · {draft.arrives}
        </Text>
      )}
      <TextField label="Note" optional value={draft.note ?? ''} onChangeText={(note) => setDraft({ ...draft, note })} />
      <View style={{ gap: spacing.sm }}>
        {draft.attachments.map((a) => (
          <Button key={a.id} label={a.name} icon="paperclip" variant="secondary" fullWidth onPress={() => openAttachment(a.uri, a.mimeType).catch((e) => toast({ message: e instanceof Error ? e.message : 'Could not open the file.', tone: 'error' }))} />
        ))}
        <Button label="Attach a copy" icon="upload" variant="ghost" fullWidth onPress={attach} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
});
