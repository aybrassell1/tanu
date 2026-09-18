import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

/**
 * Motion is quick and quiet: it should make a tap feel answered, not make
 * anyone wait. Everything here is short enough to stay out of the way, and
 * every animation collapses to nothing when the device asks for reduced
 * motion.
 */
export const motion = {
  /** A press answering under the finger. */
  press: 90,
  /** A press releasing. */
  release: 160,
  /** Content arriving on screen. */
  enter: 220,
  /** Content leaving. */
  exit: 160,
  /** Screen-sized moves. */
  screen: 260,
} as const;

/** Decelerating curve for things arriving; standard curve for everything else. */
export const easing = {
  out: Easing.bezier(0.22, 1, 0.36, 1),
  inOut: Easing.bezier(0.4, 0, 0.2, 1),
} as const;

/** How far content rises as it fades in. */
export const RISE = 10;

/** Scale a surface shrinks to while held. */
export const PRESS_SCALE = 0.975;

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => alive && setReduced(value))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/**
 * Shrinks a surface slightly while it is held. Returns the animated style and
 * the handlers to spread onto a Pressable.
 */
export function usePressScale(scale = PRESS_SCALE) {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(1)).current;
  const to = (toValue: number, duration: number) =>
    Animated.timing(value, { toValue, duration, easing: easing.out, useNativeDriver: true }).start();
  return {
    style: { transform: [{ scale: reduced ? 1 : value }] },
    handlers: {
      onPressIn: () => !reduced && to(scale, motion.press),
      onPressOut: () => !reduced && to(1, motion.release),
    },
  };
}

/** Fades (and optionally rises) content in once, on mount. */
export function useEnter({ delay = 0, rise = RISE }: { delay?: number; rise?: number } = {}) {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      value.setValue(1);
      return;
    }
    const animation = Animated.timing(value, { toValue: 1, duration: motion.enter, delay, easing: easing.out, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [delay, reduced, value]);
  return {
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) }],
  };
}
