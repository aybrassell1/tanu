import Feather from '@expo/vector-icons/Feather';
import { useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/theme/tokens';
import { Text } from './Text';

/** How far the row slides, and how wide the panel behind it is. */
const REVEAL = 104;
/** Sideways movement before the drag counts as a swipe rather than a scroll. */
const CLAIM = 12;
/** Let go past this and it stays open. */
const OPEN_AT = 44;

/**
 * A row you can push aside to reveal a delete button.
 *
 * Deliberately two moves, not one: a swipe that deletes on release is a swipe
 * that deletes when the bus goes over a bump. The gesture only uncovers the
 * button — tapping it is what asks.
 *
 * The swipe is never the only way through. Whatever this wraps has to keep its
 * own delete somewhere a finger can find without knowing the trick.
 */
export function SwipeToDelete({ children, onDelete, label }: { children: ReactNode; onDelete: () => void; label: string }) {
  const x = useRef(new Animated.Value(0)).current;
  const opened = useRef(false);
  const [showing, setShowing] = useState(false);

  const slide = (to: number) => {
    opened.current = to !== 0;
    setShowing(opened.current);
    Animated.spring(x, { toValue: to, useNativeDriver: true, bounciness: 0, speed: 18 }).start();
  };

  const pan = useRef(
    PanResponder.create({
      // A press starts on the card, not here, or a tap would stop opening it.
      onStartShouldSetPanResponderCapture: () => false,
      // Taken on capture, because by the time a finger moves the card's own
      // press handler is already the responder and would never hand it back.
      // The threshold is what keeps a tap a tap and a scroll a scroll: only a
      // deliberate sideways drag is ours.
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) > CLAIM && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_e, g) => {
        const from = opened.current ? -REVEAL : 0;
        x.setValue(Math.min(0, Math.max(-REVEAL, from + g.dx)));
      },
      onPanResponderRelease: (_e, g) => {
        const from = opened.current ? -REVEAL : 0;
        slide(from + g.dx < -OPEN_AT ? -REVEAL : 0);
      },
      onPanResponderTerminate: () => slide(0),
    }),
  ).current;

  return (
    <View style={styles.wrap}>
      <View style={styles.behind}>
        <Pressable
          onPress={onDelete}
          disabled={!showing}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${label}`}
          hitSlop={6}
          style={({ pressed }) => [styles.action, pressed && { opacity: 0.75 }]}
        >
          <Feather name="trash-2" size={18} color={colors.onInk} />
          <Text variant="caption" weight="medium" color={colors.onInk}>
            Delete
          </Text>
        </Pressable>
      </View>
      <Animated.View style={{ transform: [{ translateX: x }] }} {...pan.panHandlers}>
        {children}
        {/* While it is open, a tap puts the row back instead of opening it. */}
        {showing && <Pressable onPress={() => slide(0)} accessibilityRole="button" accessibilityLabel="Close" style={StyleSheet.absoluteFill} />}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Clipped, so the row slides under the edge of the list instead of out past it.
  wrap: { position: 'relative', overflow: 'hidden', borderRadius: radius.lg },
  behind: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
    backgroundColor: colors.negative,
    borderRadius: radius.lg,
  },
  action: { width: REVEAL, height: '100%', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: spacing.md },
});
