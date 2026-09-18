import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AccountSelect } from '@/components/finance/Pickers';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  ListCard,
  ListRow,
  Money,
  NavHeader,
  Pill,
  Screen,
  Section,
  Segmented,
  SelectField,
  Stack,
  SwitchRow,
  Text,
  useOverlay,
  type SelectOption,
} from '@/components/ui';
import { ACCOUNT_TYPES } from '@/domain/catalog';
import { categoryPath } from '@/domain/categories';
import {
  draftToTransaction,
  EMPTY_MAPPING,
  guessMapping,
  parseCsv,
  parseRows,
  summarize,
  type ColumnMapping,
  type CsvTable,
  type DateFormat,
  type DraftTransaction,
  type MappedField,
  type SignConvention,
} from '@/domain/csvImport';
import { formatDate } from '@/domain/dates';
import { indexLedger } from '@/domain/ledger';
import type { ID } from '@/domain/types';
import { pickTextFile } from '@/store/fileIO';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

const PREVIEW_ROWS = 12;
const MAX_ERRORS = 6;

const DATE_FORMATS: { value: DateFormat; label: string }[] = [
  { value: 'mdy', label: 'M/D/Y' },
  { value: 'dmy', label: 'D/M/Y' },
  { value: 'iso', label: 'Y-M-D' },
];

const NONE = '';

export default function ImportScreen() {
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { toast } = useOverlay();

  const [file, setFile] = useState<{ name: string; table: CsvTable } | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);
  const [accountId, setAccountId] = useState<ID | undefined>(() => data.accounts.find((a) => !a.archived)?.id);
  const [autoCategorize, setAutoCategorize] = useState(true);
  /** Rows the user has overridden; anything else follows the duplicate flag. */
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});
  const [showAll, setShowAll] = useState(false);
  const [result, setResult] = useState<{ added: number; errors: { row: number; message: string }[] } | null>(null);

  const account = data.accounts.find((a) => a.id === accountId);
  const categories = useMemo(() => indexLedger(data).categories, [data]);

  const parsed = useMemo(
    () => (file && accountId ? parseRows(file.table.rows, mapping, { accountId, data, autoCategorize }) : null),
    [file, mapping, accountId, data, autoCategorize],
  );

  const included = (d: DraftTransaction) => overrides[d.row] ?? !d.duplicateOf;
  const stats = useMemo(() => summarize(parsed?.drafts ?? [], included), [parsed, overrides]);

  const openFile = async () => {
    try {
      const picked = await pickTextFile();
      if (!picked) return;
      const table = parseCsv(picked.text);
      if (table.rows.length === 0) {
        toast({ message: 'That file has no rows in it.', tone: 'error' });
        return;
      }
      setFile({ name: picked.name, table });
      setMapping(guessMapping(table.headers, table.rows));
      setOverrides({});
      setShowAll(false);
      setResult(null);
    } catch (e) {
      toast({ message: `Couldn't read that file: ${e instanceof Error ? e.message : 'unknown error'}`, tone: 'error' });
    }
  };

  const runImport = () => {
    if (!parsed || !accountId) return;
    const chosen = parsed.drafts.filter(included);
    const outcome = ledger.importTransactions(chosen.map(draftToTransaction));
    setResult({
      added: outcome.added,
      // The store reports the position in what we sent; show the file's row number.
      errors: outcome.errors.map((e) => ({ row: chosen[e.row]?.row ?? e.row + 1, message: e.message })),
    });
    setFile(null);
    setOverrides({});
    if (outcome.added > 0) toast({ message: `Imported ${outcome.added} ${outcome.added === 1 ? 'transaction' : 'transactions'}`, actionLabel: 'Undo', onAction: ledger.undo });
    else toast({ message: 'Nothing was imported.', tone: 'error' });
  };

  // ── No accounts yet ──
  if (data.accounts.length === 0) {
    return (
      <Screen header={<NavHeader title="Import CSV" />}>
        <EmptyState
          icon="upload"
          title="Add an account first"
          message="Imported transactions need somewhere to live. Add the checking account or card the statement comes from, then come back."
          actionLabel="Add an account"
          onAction={() => router.push('/accounts/edit')}
        />
      </Screen>
    );
  }

  const columnOptions = (field: MappedField): SelectOption[] => {
    const headers = file?.table.headers ?? [];
    return [
      { value: NONE, label: field === 'date' || field === 'description' ? 'Choose a column' : 'Not in this file' },
      ...headers.map((h, i) => ({
        value: String(i),
        label: h.trim() || `Column ${i + 1}`,
        description: sampleOf(file?.table, i),
      })),
    ];
  };

  const setColumn = (field: MappedField) => (value: string) => setMapping((m) => ({ ...m, [field]: value === NONE ? null : Number(value) }));
  const columnValue = (field: MappedField) => (mapping[field] === null ? NONE : String(mapping[field]));

  const first = parsed?.drafts[0];
  const liability = account ? ACCOUNT_TYPES[account.type].nature === 'liability' : false;

  return (
    <Screen
      header={<NavHeader title="Import CSV" />}
      footer={
        file ? (
          <Button
            label={stats.selected === 1 ? 'Import 1 transaction' : `Import ${stats.selected} transactions`}
            size="lg"
            fullWidth
            disabled={stats.selected === 0}
            onPress={runImport}
          />
        ) : undefined
      }
    >
      <Banner
        tone="positive"
        icon="lock"
        title="Nothing leaves this device"
        message="The file is read on your phone and matched against what you already have. No bank login, no upload."
      />

      {result && (
        <Banner
          tone={result.added > 0 ? 'positive' : 'warning'}
          icon={result.added > 0 ? 'check-circle' : 'alert-triangle'}
          title={result.added > 0 ? `${result.added} ${result.added === 1 ? 'transaction' : 'transactions'} imported` : 'Nothing was imported'}
          message={result.errors.length ? `${result.errors.length} ${result.errors.length === 1 ? 'row was' : 'rows were'} rejected: ${result.errors.slice(0, 3).map((e) => `row ${e.row} — ${e.message}`).join(' ')}` : undefined}
          action={<Button label="View transactions" variant="secondary" size="sm" onPress={() => router.push('/transactions')} />}
        />
      )}

      {!file ? (
        <EmptyState
          icon="file-text"
          title="Choose a statement"
          message="Download a CSV from your bank or card, then pick it here. Chase, Amex and Capital One exports are recognised automatically."
          actionLabel="Choose a CSV file"
          onAction={openFile}
        />
      ) : (
        <>
          <Section title="File" subtitle={`${file.table.rows.length} ${file.table.rows.length === 1 ? 'row' : 'rows'}${file.table.headerless ? ' · no header line' : ''}`} action="Change" onAction={openFile}>
            <ListCard>
              <ListRow title={file.name} subtitle={file.table.headers.join(', ')} icon="file-text" />
            </ListCard>
          </Section>

          <Section title="Where do these go?" subtitle="Every row is imported into this one account.">
            <AccountSelect label="Account" value={accountId} onChange={setAccountId} />
          </Section>

          <Section title="Columns" subtitle="We guessed these from the headers. Fix anything that looks wrong.">
            <Stack gap={spacing.lg}>
              <SelectField label="Date" value={columnValue('date')} onChange={setColumn('date')} options={columnOptions('date')} error={mapping.date === null ? 'Pick the column with the date.' : undefined} />
              <Field label="Date format" hint="Only matters for dates like 01/02/2026.">
                <Segmented items={DATE_FORMATS} value={mapping.dateFormat} onChange={(dateFormat) => setMapping((m) => ({ ...m, dateFormat }))} />
              </Field>
              <SelectField label="Description" value={columnValue('description')} onChange={setColumn('description')} options={columnOptions('description')} error={mapping.description === null ? 'Pick the column with the payee or description.' : undefined} />
              <Field label="Amounts" hint="Some banks use one signed column, others split money out and money in.">
                <Segmented
                  items={[
                    { value: 'single', label: 'One column' },
                    { value: 'debitCredit', label: 'Debit & credit' },
                  ]}
                  value={mapping.amountMode}
                  onChange={(amountMode) => setMapping((m) => ({ ...m, amountMode }))}
                />
              </Field>
              {mapping.amountMode === 'single' ? (
                <SelectField label="Amount" value={columnValue('amount')} onChange={setColumn('amount')} options={columnOptions('amount')} error={mapping.amount === null ? 'Pick the column with the amount.' : undefined} />
              ) : (
                <>
                  <SelectField label="Money out (debit)" value={columnValue('debit')} onChange={setColumn('debit')} options={columnOptions('debit')} />
                  <SelectField label="Money in (credit)" value={columnValue('credit')} onChange={setColumn('credit')} options={columnOptions('credit')} />
                </>
              )}
              <SelectField label="Category" value={columnValue('category')} onChange={setColumn('category')} options={columnOptions('category')} optional hint="Used when the name matches one of your categories." />
              <SelectField label="Notes" value={columnValue('notes')} onChange={setColumn('notes')} options={columnOptions('notes')} optional />
              <SelectField label="Running balance" value={columnValue('balance')} onChange={setColumn('balance')} options={columnOptions('balance')} optional hint="Ignored on import. Setting it keeps it from being read as the amount." />
            </Stack>
          </Section>

          {mapping.amountMode === 'single' && (
            <Section title="Which sign means spending?" subtitle={liability ? 'Card exports differ: check the sentence below.' : undefined}>
              <Stack gap={spacing.md}>
                <Segmented
                  items={[
                    { value: 'negativeIsSpending', label: '−42.10 is spending' },
                    { value: 'positiveIsSpending', label: '42.10 is spending' },
                  ]}
                  value={mapping.signConvention}
                  onChange={(signConvention: SignConvention) => setMapping((m) => ({ ...m, signConvention }))}
                />
                <Card variant="muted">
                  {first ? (
                    <Text>
                      <Money cents={first.amount} /> at <Text weight="semibold">{first.description}</Text>
                      {` will be recorded as ${OUTCOME[first.type]}.`}
                    </Text>
                  ) : (
                    <Text color={colors.textTertiary}>No readable rows yet, so there is nothing to preview.</Text>
                  )}
                </Card>
              </Stack>
            </Section>
          )}

          <Section title="What will be added" subtitle={stats.from ? `${formatDate(stats.from, 'short', today)} – ${formatDate(stats.to!, 'short', today)}` : undefined}>
            <Stack gap={spacing.md}>
              <Card variant="muted">
                <View style={styles.counts}>
                  <Count label="Ready" value={String(stats.selected)} />
                  <Count label="Spending" value={money(stats.spending)} />
                  <Count label="Money in" value={money(stats.income)} />
                </View>
              </Card>
              <Card>
                <SwitchRow
                  label="Guess categories"
                  description="Reuses the category you normally give that merchant, when you have used it at least twice."
                  icon="tag"
                  value={autoCategorize}
                  onChange={setAutoCategorize}
                />
              </Card>
              {stats.duplicates > 0 && (
                <Banner
                  tone="warning"
                  icon="copy"
                  title={`${stats.duplicates} ${stats.duplicates === 1 ? 'row looks' : 'rows look'} like duplicates`}
                  message="Same account, amount and description within a day of something you already have. They are switched off — tap a row to include it anyway."
                />
              )}
            </Stack>
          </Section>

          <Section
            title="Preview"
            subtitle="Tap a row to include or skip it."
            action={parsed && parsed.drafts.length > PREVIEW_ROWS ? (showAll ? 'Show less' : `Show all ${parsed.drafts.length}`) : undefined}
            onAction={() => setShowAll((v) => !v)}
          >
            {parsed && parsed.drafts.length > 0 ? (
              <ListCard>
                {(showAll ? parsed.drafts : parsed.drafts.slice(0, PREVIEW_ROWS)).map((d) => {
                  const on = included(d);
                  const category = d.categoryId ? categoryPath(categories, d.categoryId) : undefined;
                  return (
                    <ListRow
                      key={d.row}
                      title={d.description}
                      subtitle={[formatDate(d.date, 'short', today), category ?? 'No category', d.duplicateOf ? (d.duplicateScope === 'file' ? 'Repeated in this file' : 'Already in your ledger') : null].filter(Boolean).join(' · ')}
                      leading={<Feather name={on ? 'check-square' : 'square'} size={20} color={on ? colors.primary : colors.textTertiary} />}
                      accessibilityLabel={`${on ? 'Skip' : 'Include'} ${d.description}`}
                      onPress={() => setOverrides((o) => ({ ...o, [d.row]: !on }))}
                      trailing={
                        <View style={styles.trailing}>
                          <Money cents={d.type === 'expense' ? -d.amount : d.amount} signed tone="flow" weight="semibold" style={{ opacity: on ? 1 : 0.4 }} />
                          {d.duplicateOf ? <Pill label="Duplicate" tone="warning" size="sm" icon="copy" /> : d.categorySource === 'learned' ? <Pill label="Guessed" tone="muted" size="sm" icon="tag" /> : null}
                        </View>
                      }
                    />
                  );
                })}
              </ListCard>
            ) : (
              <EmptyState
                icon="search"
                title="No rows could be read"
                message="Check the column mapping above — most often the date or amount column is pointing at the wrong thing."
                actionLabel="Choose another file"
                onAction={openFile}
                compact
              />
            )}
          </Section>

          {parsed && (parsed.errors.length > 0 || parsed.skipped > 0) && (
            <Section title="Rows left out" subtitle={parsed.skipped > 0 ? `${parsed.skipped} blank, repeated-header or zero-amount ${parsed.skipped === 1 ? 'row' : 'rows'} ignored.` : undefined}>
              {parsed.errors.length > 0 && (
                <ListCard>
                  {parsed.errors.slice(0, MAX_ERRORS).map((e) => (
                    <ListRow key={e.row} title={`Row ${e.row}`} subtitle={e.message} icon="alert-circle" iconColor={colors.warning} />
                  ))}
                  {parsed.errors.length > MAX_ERRORS ? <ListRow key="more" title={`${parsed.errors.length - MAX_ERRORS} more rows with problems`} icon="more-horizontal" /> : null}
                </ListCard>
              )}
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}

const OUTCOME: Record<DraftTransaction['type'], string> = {
  expense: 'spending',
  income: 'income',
  refund: 'a credit against what you owe',
};

function Count({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text variant="caption" color={colors.textTertiary}>
        {label}
      </Text>
      <Text variant="h3" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** First non-empty value in a column, shown under the column's name. */
function sampleOf(table: CsvTable | undefined, index: number): string | undefined {
  const value = table?.rows.map((r) => (r[index] ?? '').trim()).find((v) => v !== '');
  return value ? (value.length > 40 ? `${value.slice(0, 40)}…` : value) : undefined;
}

const styles = StyleSheet.create({
  counts: { flexDirection: 'row', gap: spacing.md },
  trailing: { alignItems: 'flex-end', gap: 4 },
});
