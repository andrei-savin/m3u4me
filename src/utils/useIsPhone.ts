import { useEffect, useState } from 'react';

/**
 * "Phone" means a screen narrower than 768px: the width where Tailwind's `md:` classes
 * stop applying. Keep the two in step, or a screen could get the phone layout from this
 * hook and the desktop layout from the CSS (or the other way round).
 *
 * Most phone differences are plain CSS (`md:hidden`, `hidden md:flex`, `max-md:…`).
 * Use this hook only where the phone needs *different components or behaviour*: the
 * drawer that floats over the page, the channel editor sheet, long-press to select,
 * the bottom tab bar, and so on.
 */
export const PHONE_QUERY = '(max-width: 767.98px)';

/** One-off check, for places that can't use a hook (the store's starting values). */
export function isPhoneNow(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches;
}

/** True while the window is phone-sized. Updates when the window is resized or rotated. */
export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(isPhoneNow);

  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setIsPhone(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return isPhone;
}
