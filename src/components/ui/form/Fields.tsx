import Feather from '@expo/vector-icons/Feather';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View, type TextInputProps } from 'react-native';

import type { IconName } from '@/data/icons';
import { addDays, formatDate, monthOf, todayISO } from '@/domain/dates';
import { centsToInput, currencySymbol, parseMoney } from '@/domain/money';
import { normalizeTag } from '@/domain/search';
import type { Cents, ISODate } from '@/domain/types';
import { useSettings } from '@/store/hooks';
import { colors, fonts, radius, spacing, tintOf } from '@/theme/tokens';

import { Button } from '../Button';
import { EmojiIcon } from '../Glyph';
import { CalendarGrid } from '../CalendarGrid';
import { Sheet } from '../Overlay';
import { Pill } from '../Pill';
import { Text } from '../Text';

// ─── Field shell ─────────────────────────────────────────────────────────────

type FieldProps = { label?: string; hint?: string; error?: string; children: ReactNode; optional?: boolean };

export function Field({ label, hint, error, children, optional }: FieldProps) {
  return (
    <View style={{ gap: 6 }}>
      {!!label && (
        <Text variant="small" weight="medium" color={colors.textSecondary}>
          {label}
          {optional && <Text variant="small" color={colors.textTertiary}> · optional</Text>}
        </Text>
      )}
      {children}
      {error ? (
        <View style={styles.errorRow} accessibilityLiveRegion="polite">
          <Feather name="alert-circle" size={12} color={colors.negative} />
          <Text variant="caption" color={colors.negative} style={{ flex: 1 }}>
            {error}
          </Text>
        </View>
      ) : (
        !!hint && (
          <Text variant="caption" color={colors.textTertiary}>
            {hint}
          </Text>
        )
      )}
    </View>
  );
}

type TextFieldProps = Omit<TextInputProps, 'style'> & {
  label?: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  prefix?: string;
  suffix?: string;
  multiline?: boolean;
};

export function TextField({ label, hint, error, optional, prefix, suffix, multiline, ...input }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Field label={label} hint={hint} error={error} optional={optional}>
      <View style={[styles.input, multiline && styles.multiline, focused && styles.focused, !!error && styles.invalid]}>
        {!!prefix && <Text color={colors.textTertiary}>{prefix}</Text>}
        <TextInput
          {...input}
          multiline={multiline}
          accessibilityLabel={input.accessibilityLabel ?? label}
          placeholderTextColor={colors.textTertiary}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={[styles.textInput, multiline && { minHeight: 72, textAlignVertical: 'top', paddingTop: 12 }]}
        />
        {!!suffix && <Text color={colors.textTertiary}>{suffix}</Text>}
      </View>
    </Field>
  );
}

// ─── Numbers & money ─────────────────────────────────────────────────────────

type MoneyFieldProps = {
  label?: string;
  value: Cents | undefined;
  onChange: (cents: Cents | undefined) => void;
  hint?: string;
  error?: string;
  optional?: boolean;
  allowNegative?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
};

/** Currency input that stores integer cents and keeps the user's typing intact. */
export function MoneyField({ label, value, onChange, hint, error, optional, allowNegative, placeholder = '0.00', autoFocus, onBlur }: MoneyFieldProps) {
  const [text, setText] = useState(centsToInput(value));
  // The last value this field reported. A different incoming value is an external
  // change (a reset or a preset), so the text follows it; our own echo is ignored
  // so the user's typing ("12.", "0", invalid text) stays intact.
  const emitted = useRef(value);
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    if (value === undefined) setText('');
    else if (parseMoney(text) !== value) setText(centsToInput(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const { currency } = useSettings();
  const symbol = useMemo(() => currencySymbol(currency), [currency]);
  const parsedText = parseMoney(text);
  const invalid = text.trim() !== '' && (parsedText === null || (!allowNegative && parsedText < 0));
  return (
    <TextField
      label={label}
      hint={hint}
      error={error ?? (invalid ? (parsedText !== null && parsedText < 0 ? 'Enter a positive amount.' : 'Use a number like 12.34.') : undefined)}
      onBlur={onBlur}
      optional={optional}
      prefix={symbol}
      value={text}
      autoFocus={autoFocus}
      placeholder={placeholder}
      keyboardType={allowNegative ? 'numbers-and-punctuation' : 'decimal-pad'}
      inputMode="decimal"
      onChangeText={(t) => {
        setText(t);
        const cents = parseMoney(t);
        // Invalid input clears the value so a stale amount can never be saved.
        const next = t.trim() === '' || cents === null || (!allowNegative && cents < 0) ? undefined : cents;
        emitted.current = next;
        onChange(next);
      }}
    />
  );
}

type NumberFieldProps = {
  label?: string;
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  hint?: string;
  error?: string;
  optional?: boolean;
  suffix?: string;
  placeholder?: string;
  integer?: boolean;
  onBlur?: () => void;
};

export function NumberField({ label, value, onChange, hint, error, optional, suffix, placeholder, integer, onBlur }: NumberFieldProps) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    if ((text === '' ? undefined : Number(text)) !== value) setText(value === undefined ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <TextField
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      suffix={suffix}
      value={text}
      placeholder={placeholder}
      keyboardType={integer ? 'number-pad' : 'decimal-pad'}
      inputMode={integer ? 'numeric' : 'decimal'}
      onBlur={onBlur}
      onChangeText={(t) => {
        setText(t);
        const n = Number(t);
        onChange(t.trim() === '' || !Number.isFinite(n) || (integer && !Number.isInteger(n)) ? undefined : n);
      }}
    />
  );
}

// ─── Pickers ─────────────────────────────────────────────────────────────────

type PickerButtonProps = { label?: string; valueLabel?: string; placeholder?: string; icon?: IconName; onPress: () => void; error?: string; hint?: string; optional?: boolean; leading?: ReactNode };

/** Field-looking button that opens a picker sheet. */
export function PickerButton({ label, valueLabel, placeholder = 'Choose', icon, onPress, error, hint, optional, leading }: PickerButtonProps) {
  return (
    <Field label={label} error={error} hint={hint} optional={optional}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label ?? 'Choose'}: ${valueLabel ?? placeholder}`} style={({ pressed }) => [styles.input, !!error && styles.invalid, pressed && { backgroundColor: colors.surfaceMuted }]}>
        {leading ?? (icon && <Feather name={icon} size={16} color={colors.textSecondary} />)}
        <Text numberOfLines={1} style={{ flex: 1 }} color={valueLabel ? colors.ink : colors.textTertiary}>
          {valueLabel ?? placeholder}
        </Text>
        <Feather name="chevron-down" size={16} color={colors.textTertiary} />
      </Pressable>
    </Field>
  );
}

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
  icon?: IconName;
  /** Full-color illustration shown instead of the line icon. */
  emoji?: string | null;
  color?: string;
  /** Group heading for sectioned lists. */
  group?: string;
  indent?: boolean;
  disabled?: boolean;
};

type SelectSheetProps<T extends string> = {
  visible: boolean;
  onClose: () => void;
  title: string;
  options: SelectOption<T>[];
  value?: T | T[];
  onSelect: (value: T) => void;
  searchable?: boolean;
  multiple?: boolean;
  footer?: ReactNode;
};

export function SelectSheet<T extends string>({ visible, onClose, title, options, value, onSelect, searchable, multiple, footer }: SelectSheetProps<T>) {
  const [query, setQuery] = useState('');
  const selected = new Set(Array.isArray(value) ? value : value ? [value] : []);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.group?.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q)) : options;
  }, [options, query]);

  let lastGroup: string | undefined;
  return (
    <Sheet visible={visible} onClose={onClose} title={title} footer={footer ?? (multiple ? <Button label="Done" fullWidth size="lg" onPress={onClose} /> : undefined)}>
      {searchable && (
        <View style={styles.input}>
          <Feather name="search" size={16} color={colors.textTertiary} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search" placeholderTextColor={colors.textTertiary} style={styles.textInput} autoCorrect={false} accessibilityLabel="Search options" />
        </View>
      )}
      <View>
        {filtered.map((o) => {
          const header = o.group && o.group !== lastGroup ? o.group : null;
          lastGroup = o.group;
          const isSelected = selected.has(o.value);
          return (
            <View key={o.value}>
              {header && (
                <Text variant="caption" color={colors.textTertiary} style={styles.group}>
                  {header.toUpperCase()}
                </Text>
              )}
              <Pressable
                disabled={o.disabled}
                accessibilityRole={multiple ? 'checkbox' : 'radio'}
                accessibilityState={{ checked: isSelected, disabled: o.disabled }}
                onPress={() => {
                  onSelect(o.value);
                  if (!multiple) {
                    setQuery('');
                    onClose();
                  }
                }}
                style={({ pressed }) => [styles.option, o.indent && { paddingLeft: 28 }, pressed && { backgroundColor: colors.surfaceMuted }, o.disabled && { opacity: 0.4 }]}
              >
                {o.emoji ? (
                  <View style={[styles.optionIcon, { backgroundColor: colors.surfaceMuted }]}>
                    <EmojiIcon name={o.emoji} size={20} />
                  </View>
                ) : (
                  o.icon && (
                    <View style={[styles.optionIcon, { backgroundColor: tintOf(o.color) }]}>
                      <Feather name={o.icon} size={15} color={o.color ?? colors.primary} />
                    </View>
                  )
                )}
                <View style={{ flex: 1 }}>
                  <Text weight={isSelected ? 'semibold' : 'regular'}>{o.label}</Text>
                  {!!o.description && (
                    <Text variant="caption" color={colors.textTertiary}>
                      {o.description}
                    </Text>
                  )}
                </View>
                {isSelected && <Feather name="check" size={18} color={colors.primary} />}
              </Pressable>
            </View>
          );
        })}
        {filtered.length === 0 && (
          <Text color={colors.textTertiary} align="center" style={{ paddingVertical: spacing.xl }}>
            No matches
          </Text>
        )}
      </View>
    </Sheet>
  );
}

type SelectFieldProps<T extends string> = Omit<SelectSheetProps<T>, 'visible' | 'onClose' | 'title' | 'value' | 'onSelect'> & {
  label: string;
  value: T | undefined;
  onChange: (value: T) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  sheetTitle?: string;
};

export function SelectField<T extends string>({ label, value, onChange, options, placeholder, error, hint, optional, sheetTitle, searchable }: SelectFieldProps<T>) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <PickerButton
        label={label}
        valueLabel={current ? (current.group && current.indent ? `${current.group} › ${current.label}` : current.label) : undefined}
        placeholder={placeholder}
        icon={current?.icon}
        onPress={() => setOpen(true)}
        error={error}
        hint={hint}
        optional={optional}
      />
      <SelectSheet visible={open} onClose={() => setOpen(false)} title={sheetTitle ?? label} options={options} value={value} onSelect={onChange} searchable={searchable ?? options.length > 12} />
    </>
  );
}

// ─── Dates ───────────────────────────────────────────────────────────────────

type DateFieldProps = {
  label?: string;
  value: ISODate | undefined;
  onChange: (date: ISODate | undefined) => void;
  error?: string;
  hint?: string;
  optional?: boolean;
  /** Show Today / Yesterday shortcuts. */
  shortcuts?: boolean;
  clearable?: boolean;
};

export function DateField({ label, value, onChange, error, hint, optional, shortcuts, clearable }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const today = todayISO();
  const { weekStartsOn } = useSettings();
  // An empty string is a date field that has never been filled in, not a date.
  const [month, setMonth] = useState(monthOf(value || today));
  return (
    <>
      <View style={{ gap: 8 }}>
        <PickerButton label={label} valueLabel={value ? formatDate(value, 'weekday', today) : undefined} placeholder="Pick a date" icon="calendar" onPress={() => { setMonth(monthOf(value || today)); setOpen(true); }} error={error} hint={hint} optional={optional} />
        {shortcuts && (
          <View style={styles.chips}>
            <Pill label="Today" size="sm" selected={value === today} onPress={() => onChange(today)} />
            <Pill label="Yesterday" size="sm" selected={value === addDays(today, -1)} onPress={() => onChange(addDays(today, -1))} />
          </View>
        )}
      </View>
      <Sheet visible={open} onClose={() => setOpen(false)} title={label ?? 'Date'} footer={clearable && value ? <Button label="Clear date" variant="secondary" fullWidth onPress={() => { onChange(undefined); setOpen(false); }} /> : undefined}>
        <CalendarGrid
          month={month}
          onMonthChange={setMonth}
          selected={value}
          today={today}
          weekStartsOn={weekStartsOn}
          onSelect={(d) => {
            onChange(d);
            setOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}

// ─── Toggles, chips, tags ────────────────────────────────────────────────────

export function SwitchRow({ label, description, value, onChange, icon }: { label: string; description?: string; value: boolean; onChange: (v: boolean) => void; icon?: IconName }) {
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }} style={styles.switchRow}>
      {icon && <Feather name={icon} size={18} color={colors.textSecondary} />}
      <View style={{ flex: 1 }}>
        <Text weight="medium">{label}</Text>
        {!!description && (
          <Text variant="small" color={colors.textTertiary}>
            {description}
          </Text>
        )}
      </View>
      {/* The row handles presses; the switch is visual only so a tap never toggles twice. */}
      <View style={{ pointerEvents: 'none' }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Switch value={value} trackColor={{ true: colors.primary, false: colors.track }} thumbColor={colors.surface} />
      </View>
    </Pressable>
  );
}

type ChipSelectProps<T extends string> = {
  label?: string;
  options: { value: T; label: string; icon?: IconName }[];
  value: T | T[] | undefined;
  onChange: (value: T) => void;
  error?: string;
  hint?: string;
};

/** Wrapping chip group for short option lists. */
export function ChipSelect<T extends string>({ label, options, value, onChange, error, hint }: ChipSelectProps<T>) {
  const selected = new Set(Array.isArray(value) ? value : value ? [value] : []);
  return (
    <Field label={label} error={error} hint={hint}>
      <View style={styles.chips}>
        {options.map((o) => (
          <Pill key={o.value} label={o.label} icon={o.icon} selected={selected.has(o.value)} onPress={() => onChange(o.value)} />
        ))}
      </View>
    </Field>
  );
}

export function TagInput({ label = 'Tags', value, onChange, suggestions = [] }: { label?: string; value: string[]; onChange: (tags: string[]) => void; suggestions?: string[] }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const tag = normalizeTag(raw);
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setText('');
  };
  const unused = suggestions.filter((s) => !value.includes(s)).slice(0, 8);
  return (
    <Field label={label} optional hint="Use tags like #car, #moving or #tax to group things across the app.">
      <View style={[styles.input, { flexWrap: 'wrap', height: undefined, minHeight: 48, paddingVertical: 8 }]}>
        {value.map((t) => (
          <Pill key={t} label={`#${t}`} size="sm" tone="primary" trailingIcon="x" onPress={() => onChange(value.filter((x) => x !== t))} accessibilityLabel={`Remove tag ${t}`} />
        ))}
        <TextInput
          value={text}
          onChangeText={(t) => (/[\s,]$/.test(t) ? add(t) : setText(t))}
          onSubmitEditing={() => add(text)}
          onBlur={() => text && add(text)}
          placeholder={value.length ? 'Add tag' : '#tag'}
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.textInput, { minWidth: 80 }]}
          accessibilityLabel="Add tag"
        />
      </View>
      {unused.length > 0 && (
        <View style={styles.chips}>
          {unused.map((s) => (
            <Pill key={s} label={`#${s}`} size="sm" onPress={() => add(s)} />
          ))}
        </View>
      )}
    </Field>
  );
}

const styles = StyleSheet.create({
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  multiline: { alignItems: 'flex-start' },
  focused: { borderColor: colors.primary },
  invalid: { borderColor: colors.negative },
  textInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.ink, paddingVertical: 10, outlineStyle: 'none' } as never,
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  group: { marginTop: spacing.md, marginBottom: 4, letterSpacing: 0.6 },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 11, paddingHorizontal: 4, borderRadius: radius.sm },
  optionIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
