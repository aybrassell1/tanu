import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { GradeBadge, RatingRow, StatusPicker } from '@/components/places/Parts';
import { Banner, Button, Card, Disclosure, EmptyState, IconButton, KeyValue, Money, NavHeader, Pill, ProgressBar, Row, Screen, Section, Sheet, Text, TextField, useOverlay } from '@/components/ui';
import { financialSnapshot } from '@/domain/affordability';
import { formatDate } from '@/domain/dates';
import { RATINGS, TOUR_STAGES, checklistProgress, scorePlace, stageQuestions, stillToDo, tourQuestions } from '@/domain/places';
import type { TourQuestion } from '@/domain/places';
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
  const todo = stillToDo(place, custom);
  const mine = questions.filter((q) => q.mine);
  const cost = scored.cost;
  // A range prints as a span wherever a single figure would have gone; where
  // nothing was quoted as a range the two ends are the same number.
  const span = (low: number, high: number) => (high > low ? `${money(low)} to ${money(high)}` : money(low));
  const answerFor = (questionId: string): PlaceAnswer | undefined => place.answers.find((a) => a.id === questionId);

  const remove = async () => {
    if (!(await confirm({ title: `Delete ${place.name}?`, message: 'The tour notes go with it.', confirmLabel: 'Delete', destructive: true }))) return;
    ledger.deletePlace(place.id);
    toast({ message: 'Place deleted', actionLabel: 'Undo', onAction: ledger.undo });
    router.back();
  };

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
            {cost.ranged ? <Text variant="h2">{span(cost.monthly, cost.monthlyHigh)}</Text> : <Money cents={cost.monthly} variant="h2" />}
            <Text variant="caption" color={colors.textTertiary}>
              {cost.aboveRentHigh > 0
                ? `Rent plus ${span(cost.aboveRent, cost.aboveRentHigh)} of utilities and fees`
                : 'Rent only — add the fees to see the real number'}
            </Text>
          </View>
        </Row>
        {scored.grade && <ProgressBar value={scored.score / 100} color={GRADE_COLOR(scored.grade)} accessibilityLabel={`Score ${scored.score} out of 100`} />}
        <View style={styles.pills}>
          {scored.basis === 'full' && <Pill size="sm" icon="home" label={`${Math.round(scored.rentShare * 100)}% of gross pay`} />}
          <Pill size="sm" icon="credit-card" label={`${span(cost.upfront, cost.upfrontHigh)} up front`} />
          {place.touredOn && <Pill size="sm" icon="calendar" label={`Toured ${formatDate(place.touredOn, 'short', today)}`} />}
        </View>
        {scored.basis !== 'full' ? (
          <Text variant="small" color={colors.textSecondary}>
            {scored.basis === 'no_income'
              ? 'No income recorded yet, so there is nothing to weigh this rent against. Add your pay and spending and the grade appears.'
              : 'No rent entered yet, so there is nothing to grade. Add what they are asking and the letter appears.'}
          </Text>
        ) : (
          <>
            {scored.weakest && (
              <Text variant="small" color={colors.textSecondary}>
                {scored.weakest === 'fit'
                  ? `${scored.answered - Math.round((scored.parts.fit / 20) * scored.answered)} of the ${scored.answered} things you asked came back as a no.`
                  : WEAKEST_NOTE[scored.weakest]}
              </Text>
            )}
            {cost.ranged && (
              <Text variant="caption" color={colors.textTertiary}>
                Graded on the top of the ranges — a month where everything lands high.
              </Text>
            )}
          </>
        )}
      </Card>

      <StatusPicker value={place.status} onChange={(status) => ledger.setPlaceStatus(place.id, status)} />

      {scored.cost.concession && (
        <Banner
          tone="positive"
          icon="tag"
          title={`${money(scored.cost.concession.worth)} off, over ${scored.cost.concession.leaseMonths} months`}
          message={
            scored.cost.concession.freeAtStart > 0
              ? `${scored.cost.concession.freeAtStart} ${scored.cost.concession.freeAtStart === 1 ? 'month' : 'months'} free at the start, then ${money(scored.cost.concession.askingRent)} a month. The figures below are what you pay once it ends.`
              : `Asking rent is ${money(scored.cost.concession.askingRent)}; spread over the lease you pay ${money(scored.cost.concession.payMonth)}. Renewing costs ${money(scored.cost.concession.renewalJump)} a month more.`
          }
        />
      )}

      <Section title="What it costs" subtitle="Everything, not just the rent">
        <Card>
          {cost.breakdown.length === 0 && <KeyValue label="Nothing costed yet" value="—" />}
          {cost.breakdown.map((b) => (
            <KeyValue key={b.key} label={b.label} value={span(b.amount, b.high ?? b.amount)} />
          ))}
          <KeyValue label="Every month" value={span(cost.monthly, cost.monthlyHigh)} />
          <KeyValue label="Due at signing" value={span(cost.upfront, cost.upfrontHigh)} hint={cost.upfrontBreakdown.map((b) => b.label).join(' · ')} />
          <KeyValue label="First year, all in" value={span(cost.firstYear, cost.firstYearHigh)} />
        </Card>
      </Section>

      {scored.basis === 'full' && (
      <Section title="Against your money">
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
              params: { rent: String(scored.cost.rent), utilities: String(scored.cost.utilitiesHigh), insurance: '0', other: String(scored.cost.aboveRentHigh - scored.cost.utilitiesHigh), moveIn: String(scored.cost.upfrontHigh) },
            })
          }
        />
      </Section>
      )}

      <Section title="How it felt">
        <Card style={{ gap: spacing.sm }}>
          {RATINGS.map((r) => (
            <RatingRow key={r.id} label={r.label} score={place.ratings.find((x) => x.id === r.id)?.score ?? 0} onChange={(score) => ledger.ratePlace(place.id, r.id, score)} />
          ))}
        </Card>
      </Section>

      <Section title="Ask on the tour" subtitle={`${progress.answered} of ${progress.total}${progress.extra > 0 ? ` · ${progress.extra} extra` : ''}`}>
        {todo.ask.length + todo.check.length === 0 ? (
          <Banner tone="positive" icon="check" title="You covered the short list" message="Anything else is under each part of the tour." />
        ) : (
          <Banner
            tone="muted"
            icon="help-circle"
            title={[todo.ask.length > 0 && `${todo.ask.length} to ask them`, todo.check.length > 0 && `${todo.check.length} to check yourself`].filter(Boolean).join(', ')}
            message={[...todo.ask, ...todo.check].slice(0, 3).map((q) => q.label).join('  ·  ')}
          />
        )}
      </Section>

      {TOUR_STAGES.map((stage) => {
        const here = stageQuestions(stage.id, custom);
        return (
          <Section key={stage.id} title={stage.label}>
            <Card style={{ gap: spacing.lg }}>
              {here.core.map((q) => (
                <QuestionRow key={q.id} placeId={place.id} question={q} answer={answerFor(q.id)} />
              ))}
            </Card>
            {here.more.length > 0 && (
              <Disclosure label="More questions" count={here.more.length}>
                <Card style={{ gap: spacing.lg }}>
                  {here.more.map((q) => (
                    <QuestionRow key={q.id} placeId={place.id} question={q} answer={answerFor(q.id)} />
                  ))}
                </Card>
              </Disclosure>
            )}
          </Section>
        );
      })}

      <Section title="Your questions">
        {mine.length > 0 && (
          <Card style={{ gap: spacing.lg }}>
            {mine.map((q) => (
              <QuestionRow key={q.id} placeId={place.id} question={q} answer={answerFor(q.id)} />
            ))}
          </Card>
        )}
        <AddQuestion />
      </Section>

      <Section title="Anything else">
        <PlaceNotes placeId={place.id} value={place.notes ?? ''} notes={notes} setNotes={setNotes} />
      </Section>

      <Button label="Delete this place" icon="trash-2" variant="danger" fullWidth onPress={remove} />
    </Screen>
  );
}

/** A question and whatever you have recorded against it, saved as you go. */
function QuestionRow({ placeId, question, answer }: { placeId: string; question: TourQuestion; answer: PlaceAnswer | undefined }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text weight="medium">{question.label}</Text>
      {!!question.hint && (
        <Text variant="caption" color={colors.textTertiary}>
          {question.hint}
        </Text>
      )}
      {question.kind === 'yesno' && (
        <View style={styles.answers}>
          {ANSWERS.map((o) => (
            <Pill
              key={o.value}
              size="sm"
              icon={o.icon}
              label={o.label}
              selected={answer?.answer === o.value}
              onPress={() => ledger.answerPlaceQuestion(placeId, question.id, { answer: answer?.answer === o.value ? undefined : o.value })}
            />
          ))}
        </View>
      )}
      <NoteField placeId={placeId} questionId={question.id} value={answer?.note ?? ''} placeholder={question.kind === 'note' ? 'What did they say?' : 'Add a note'} />
    </View>
  );
}

function NoteField({ placeId, questionId, value, placeholder }: { placeId: string; questionId: string; value: string; placeholder: string }) {
  const [text, setText] = useState(value);
  const save = () => {
    if (text !== value) ledger.answerPlaceQuestion(placeId, questionId, { note: text });
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
