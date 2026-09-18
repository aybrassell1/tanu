import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { colors, fonts, typography, type FontWeight, type TypographyVariant } from '@/theme/tokens';

export type TextProps = RNTextProps & {
  variant?: TypographyVariant;
  weight?: FontWeight;
  color?: string;
  align?: 'left' | 'center' | 'right';
  /** Fixed-width digits for columns of numbers. */
  tabular?: boolean;
};

export function Text({ variant = 'body', weight, color = colors.ink, align, tabular, style, ...rest }: TextProps) {
  const t = typography[variant];
  return (
    <RNText
      {...rest}
      style={[
        {
          // Custom fonts ignore fontWeight on Android, so weight selects the family.
          fontFamily: fonts[weight ?? t.weight],
          fontSize: t.fontSize,
          lineHeight: t.lineHeight,
          letterSpacing: t.letterSpacing,
          color,
          textAlign: align,
          fontVariant: tabular ? ['tabular-nums'] : undefined,
        },
        style,
      ]}
    />
  );
}
