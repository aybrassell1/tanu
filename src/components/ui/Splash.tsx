import { useEffect, useRef, useState } from 'react';
import { Animated, Image, Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import { colors } from '@/theme/tokens';
import { easing, motion, useReducedMotion } from '@/theme/motion';

const MARK = require('../../../assets/brand/tanu-mark-white.png');

/**
 * The blue opening screen. The mark settles in, then the whole panel lifts
 * away to reveal the app underneath. It covers the wait for fonts and the
 * ledger, so the app never flashes an empty frame on a cold start.
 */
/**
 * iOS paints the status-bar area of a home-screen app with the page theme
 * colour, so the opening screen borrows it and hands it back on the way out.
 */
function setStatusBarColor(color: string) {
  if (Platform.OS !== 'web') return;
  const doc = (globalThis as { document?: Document }).document;
  const meta = doc?.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color);
}

export function Splash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const reduced = useReducedMotion();
  const mark = useRef(new Animated.Value(0)).current;
  const cover = useRef(new Animated.Value(1)).current;
  const [shownAt] = useState(() => Date.now());

  useEffect(() => {
    setStatusBarColor(colors.primary);
    return () => setStatusBarColor(colors.background);
  }, []);

  useEffect(() => {
    if (reduced) {
      mark.setValue(1);
      return;
    }
    Animated.timing(mark, { toValue: 1, duration: 420, easing: easing.out, useNativeDriver: true }).start();
  }, [mark, reduced]);

  useEffect(() => {
    if (!ready) return;
    // Let the logo land before leaving, so a fast start still reads as intentional.
    const settle = Math.max(0, 620 - (Date.now() - shownAt));
    const timer = setTimeout(() => {
      if (reduced) {
        onDone();
        return;
      }
      Animated.timing(cover, { toValue: 0, duration: motion.screen, easing: easing.inOut, useNativeDriver: true }).start(() => onDone());
    }, settle);
    // Never leave the app stuck behind the panel if an animation is interrupted.
    const failsafe = setTimeout(onDone, settle + motion.screen + 400);
    return () => {
      clearTimeout(timer);
      clearTimeout(failsafe);
    };
  }, [cover, onDone, ready, reduced, shownAt]);

  const panel: ViewStyle[] = [
    styles.fill,
    {
      opacity: cover,
      transform: [{ scale: cover.interpolate({ inputRange: [0, 1], outputRange: [1.06, 1] }) }],
    } as unknown as ViewStyle,
  ];

  return (
    <Animated.View style={panel} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.center}>
        <Animated.View
          style={{
            opacity: mark,
            transform: [{ scale: mark.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) }],
          }}
        >
          <Image source={MARK} style={styles.mark} resizeMode="contain" accessibilityIgnoresInvertColors />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.primary, zIndex: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mark: { width: 132, height: 132 },
});
