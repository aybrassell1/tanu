import type Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';

export type IconName = ComponentProps<typeof Feather>['name'];

/** Domain metadata stores icon names as strings; this narrows them for Feather. */
export const icon = (name: string | undefined, fallback: IconName = 'circle'): IconName =>
  (name as IconName | undefined) ?? fallback;
