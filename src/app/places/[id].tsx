import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { GradeBadge, RatingRow, StatusPicker } from '@/components/places/Parts';
import { Banner, Button, Card, Disclosure, EmptyState, IconButton, KeyValue, Money, NavHeader, Pill, ProgressBar, Row, Screen, Section, Sheet, Text, TextField, useOverlay } from '@/components/ui';
import { financialSnapshot } from '@/domain/affordability';
import { formatDate } from '@/domain/dates';
import { CUSTOM_GROUP, RATINGS, checklistProgress, scorePlace, tourQuestions, unanswered } from '@/domain/places';
import type { Place, PlaceAnswer } from '@/domain/types';
import { useData, useDerived, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

const ANSWERS = [
  { value: 'yes', label: 'Yes', icon: 'check' },
  { value: 'no', label: 'No', icon: 'x' },
  { value: 'unsure', label: 'Ask', icon: 'help-circle' },
] as const;

/**
 * One place, and the screen you actually hold on the tour: every answer and
 * rating saves the moment you tap it, so nothing is lost when you walk out.
 */
export default function PlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const { confirm, toast } = useOverlay();
  const money = useMoney();
  const snapshot = useDerived(financialSnapshot);
  const place = data.places.find((p) => p.id === id);
  const [notes, setNotes] = useState(place?.notes ?? '');

  if (!place) {
    return (
      <Screen header={<NavHeader title="Place" />}>
        <EmptyState icon="search" title="Place not found" message="It may have been deleted." actionLabel="Back to tours" onAction={() => router.push('/places')} />
      </Screen>
    );
  }

  const custom = data.tourQuestions ?? [];
  const questions = tourQuestions(custom);
  const scored = scorePlace(snapshot, place, custom);
  const progress = checklistProgress(place, custom);
  const left = unanswered(place, custom);
  const answerFor = (questionId: string): PlaceAnswer | undefined => place.answers.find((a) => a.id === questionId);

  const remove = async () => {
    if (!(await confirm({ title: `Delete ${place.name}?`, message: 'The tour notes go with it.', confirmLabel: 'Delete', destructive: true }))) return;
    ledger.deletePlace(place.id);
    toast({ message: 'Place deleted', actionLabel: 'Undo', onAction: ledger.undo });
    router.back();
  };

  const groups = [...new Set(questions.map((q) => q.group))];

  return (
    <Screen
      header={
        <NavHeader
          title={place.name}
          right={<IconButton icon="edit-2" accessibilityLabel="Edit costs" onPress={() => router.push({ pathname: '/places/edit', params: { id: place.id } })} />}
        />
      }
    >
      <Card style={{ gap: spacing.md }}>
        <Row>
          <GradeBadge grade={scored.grade} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="small" color={colors.textSecondary}>
              All in, every month
            </Text>
            <Money cents={scored.cost.monthly} variant="h2" />
            <Text variant="caption" color={colors.textTertiary}>
              {scored.cost.aboveRent > 0 ? `Rent plus ${money(scored.cost.aboveRent)} of utilities and fees` : 'Rent only — add the fees to see the real number'}
            </Text>
          </View>
        </Row>
        {scored.grade && <ProgressBar value={scored.score / 100} color={GRADE_COLOR(scored.grade)} accessibilityLabel={`Score ${scored.score} out of 100`} />}
        <View style={styles.pills}>
          {scored.basis === 'full' && <Pill size="sm" icon="home" label={`${Math.round(scored.rentShare * 100)}% of gross pay`} />}
          <Pill size="sm" icon="credit-card" label={`${money(scored.cost.upfront)} up front`} />
          {place.touredOn && <Pill size="sm" icon="calendar" label={`Toured ${formatDate(place.touredOn, 'short', today)}`} />}
        </View>
        {scored.basis === 'no_income' ? (
          <Text variant="small" color={colors.textSecondary}>
            No income recorded yet, so there is nothing to weigh this rent against. Add your pay and spending and the grade appears.
          </Text>
        ) : (
          scored.weakest && (
            <Text variant="small" color={colors.textSecondary}>
              {WEAKEST_NOTE[scored.weakest]}
            </Text>
          )
        )}
      </Card>

      <StatusPicker value={place.status} onChange={(status) => ledger.setPlaceStatus(place.id, status)} />

      <Section title="What it costs" subtitle="Everything, not just the rent">
        <Card>
          {scored.cost.breakdown.map((b) => (
            <KeyValue key={b.key} label={b.label} value={money(b.amount)} />
          ))}
          <KeyValue label="Every month" value={money(scored.cost.monthly)} />
          <KeyValue label="Due at signing" value={money(scored.cost.upfront)} hint={scored.cost.upfrontBreakdown.map((b) => b.label).join(' · ')} />
          <KeyValue label="First year, all in" value={money(scored.cost.firstYear)} />
        </Card>
      </Section>

      {scored.basis === 'full' && (
      <Section title="Against your money" subtitle="Same rules as the rent calculator">
        <Card style={{ gap: spacing.sm }}>
          {scored.result.checks.map((c) => (
            <Row key={c.key}>
              <Text style={{ flex: 1 }}>{c.label}</Text>
              <Pill
                size="sm"
                tone={c.status === 'good' ? 'positive' : c.status === 'stretch' ? 'warning' : 'negative'}
                icon={c.status === 'good' ? 'check' : c.status === 'stretch' ? 'alert-circle' : 'alert-triangle'}
                label={c.unit === 'months' ? `${c.value === Infinity ? '∞' : c.value.toFixed(1)} mo` : `${Math.round(c.value * 100)}%`}
              />
            </Row>
          ))}
          <Text variant="caption" color={colors.textTertiary}>
            Compared with what you pay for housing now. Rules of thumb, not advice.
          </Text>
        </Card>
        <Button
          label="Open in the rent calculator"
          icon="sliders"
          variant="secondary"
          fullWidth
          onPress={() =>
            router.push({
              pathname: '/afford/rent',
              params: { rent: String(place.rent), utilities: String(scored.cost.utilities), insurance: '0', other: String(scored.cost.aboveRent - scored.cost.utilities), moveIn: String(scored.cost.upfront) },
            })
          }
        />
      </Section>
      )}

      <Section title="How it felt" subtitle="Rate it while you remember">
        <Card style={{ gap: spacing.sm }}>
          {RATINGS.map((r) => (
            <RatingRow key={r.id} label={r.label} score={place.ratings.find((x) => x.id === r.id)?.score ?? 0} onChange={(score) => ledger.ratePlace(place.id, r.id, score)} />
          ))}
        </Card>
      </Section>

      <Section title="Ask on the tour" subtitle={`${progress.answered} of ${progress.total} recorded`}>
        {left.length > 0 && (
          <Banner
            tone="muted"
            icon="help-circle"
            title={`${left.length} still to ask`}
            message={left.slice(0, 3).map((q) => q.label).join('  ·  ')}
          />
        )}
        {groups.map((group) => (
          <Disclosure key={group} label={group} initiallyOpen={group === 'Money' || group === CUSTOM_GROUP}>
            <View style={{ gap: spacing.lg }}>
              {questions.filter((q) => q.group === group).map((q) => {
                const a = answerFor(q.id);
                return (
                  <View key={q.id} style={{ gap: spacing.xs }}>
                    <Text weight="medium">{q.label}</Text>
                    {!!q.hint && (
                      <Text variant="caption" color={colors.textTertiary}>
                        {q.hint}
                      </Text>
                    )}
                    {q.kind === 'yesno' && (
                      <View style={styles.answers}>
                        {ANSWERS.map((o) => (
                          <Pill
                            key={o.value}
                            size="sm"
                            icon={o.icon}
                            label={o.label}
                            selected={a?.answer === o.value}
                            onPress={() => ledger.answerPlaceQuestion(place.id, q.id, { answer: a?.answer === o.value ? undefined : o.value })}
                          />
                        ))}
                      </View>
                    )}
                    <NoteField place={place} questionId={q.id} value={a?.note ?? ''} placeholder={q.kind === 'note' ? 'What did they say?' : 'Add a note'} />
                  </View>
                );
              })}
            </View>
          </Disclosure>
        ))}
        <AddQuestion />
      </Section>

      <Section title="Anything else">
        <PlaceNotes placeId={place.id} value={place.notes ?? ''} notes={notes} setNotes={setNotes} />
      </Section>

      <Button label="Delete this place" icon="trash-2" variant="danger" fullWidth onPress={remove} />
    </Screen>
  );
}

function NoteField({ place, questionId, value, placeholder }: { place: Place; questionId: string; value: string; placeholder: string }) {
  const [text, setText] = useState(value);
  const save = () => {
    if (text !== value) ledger.answerPlaceQuestion(place.id, questionId, { note: text });
  };
  // Saved while you type as well as on blur: a tour ends when someone walks
  // away, not when a field politely loses focus.
  useAutoSave(text, value, save);
  return <TextField value={text} onChangeText={setText} onBlur={save} placeholder={placeholder} />;
}

/** Writes a pause in typing through to the ledger, about half a second later. */
function useAutoSave(text: string, saved: string, save: () => void) {
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => {
    if (text === saved) return;
    const timer = setTimeout(() => latest.current(), 600);
    return () => clearTimeout(timer);
  }, [text, saved]);
}

/** A question you thought of here shows up on every place from now on. */
function AddQuestion() {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'note' | 'yesno'>('note');
  const add = () => {
    const text = label.trim();
    if (!text) return;
    ledger.addTourQuestion(text, kind);
    setLabel('');
    setOpen(false);
  };
  return (
    <>
      <Button label="Add your own question" icon="plus" variant="secondary" fullWidth onPress={() => setOpen(true)} />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Add a question">
        <View style={{ gap: spacing.md }}>
          <TextField label="What do you want to ask?" value={label} onChangeText={setLabel} placeholder="Is the water heater shared?" autoFocus onSubmitEditing={add} />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Pill size="sm" label="Just a note" selected={kind === 'note'} onPress={() => setKind('note')} />
            <Pill size="sm" label="Yes or no" selected={kind === 'yesno'} onPress={() => setKind('yesno')} />
          </View>
          <Text variant="caption" color={colors.textTertiary}>
            A yes/no question counts toward the grade, the same as the built-in ones. It will appear on every place you tour.
          </Text>
          <Button label="Add it" size="lg" fullWidth onPress={add} />
        </View>
      </Sheet>
    </>
  );
}

function PlaceNotes({ placeId, value, notes, setNotes }: { placeId: string; value: string; notes: string; setNotes: (v: string) => void }) {
  const save = () => {
    if (notes !== value) ledger.setPlaceNotes(placeId, notes);
  };
  useAutoSave(notes, value, save);
  return (
    <TextField
      label="Notes"
      value={notes}
      onChangeText={setNotes}
      onBlur={save}
      placeholder="The stairwell smelled of paint; neighbour was friendly."
      multiline
    />
  );
}

const GRADE_COLOR = (grade: string) => (grade === 'A' || grade === 'B' ? colors.positive : grade === 'C' ? colors.warning : colors.negative);

const WEAKEST_NOTE: Record<'affordability' | 'condition' | 'fit', string> = {
  affordability: 'The grade is held down by the cost against your income, not by the place itself.',
  condition: 'The numbers work; your own ratings are what is holding this one back.',
  fit: 'Cost and condition are fine — some of what you asked came back as a no.',
};

const styles = StyleSheet.create({
  answers: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  pills: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
});
