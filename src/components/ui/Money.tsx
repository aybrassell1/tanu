import type { Cents } from '@/domain/types';
import { useMoney } from '@/store/hooks';
import { colors } from '@/theme/tokens';

import { Text, type TextProps } from './Text';

type MoneyProps = Omit<TextProps, 'children'> & {
  cents: Cents;
  signed?: boolean;
  compact?: boolean;
  whole?: boolean;
  /**
   * `flow` colors money in green and leaves money out in ink (spending is
   * normal, not an error). `ink` never colors.
   */
  tone?: 'ink' | 'flow' | 'balance';
};

/** Currency amount that respects the user's currency and privacy mode. */
export function Money({ cents, signed, compact, whole, tone = 'ink', color, tabular = true, ...rest }: MoneyProps) {
  const money = useMoney();
  let resolved = color;
  if (!resolved) {
    if (tone === 'flow' && cents > 0) resolved = colors.positive;
    else if (tone === 'balance' && cents < 0) resolved = colors.negative;
    else resolved = colors.ink;
  }
  return (
    <Text {...rest} color={resolved} tabular={tabular}>
      {money(cents, { signed, compact, whole })}
    </Text>
  );
}
