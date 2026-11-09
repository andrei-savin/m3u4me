import { useRef } from 'react';
import type React from 'react';

/**
 * Press-and-hold on a touchscreen, for "long-press a channel to start selecting".
 * Spread the returned handlers onto the element:
 *
 *   const longPress = useLongPress(() => select(channel.id));
 *   <div {...longPress} onClick={open}>
 *
 * It fires after `delay` ms of holding still. Moving the finger more than a few pixels
 * (a scroll) cancels it, so scrolling a list never selects anything. The tap that ends a
 * long press is swallowed, so the element's own onClick doesn't run as well.
 */
export function useLongPress(onLongPress: () => void, delay = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  // Always call the latest callback, not the one from the render the press started in.
  const callback = useRef(onLongPress);
  callback.current = onLongPress;

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    startPoint.current = null;
  };

  return {
    onPointerDown: (e: React.PointerEvent) => {
      // Only a plain press: not a right-click, not a second finger.
      if (e.button !== 0 || !e.isPrimary) return;
      fired.current = false;
      cancel();
      startPoint.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        // A short buzz on phones that support it (Android), so the hold feels registered.
        navigator.vibrate?.(10);
        callback.current();
      }, delay);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const start = startPoint.current;
      if (!start || !timer.current) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (e: React.MouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
