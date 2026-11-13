/**
 * Material 3 press ripple. Every clickable surface carries `.md-btn`, whose hover tint is
 * plain CSS; this adds the ripple that spreads from where you pressed. It's one listener on
 * the whole page rather than a component, so nothing has to opt in.
 *
 * How it behaves, as in Material's own components:
 * - It starts at the pointer and grows just far enough to cover the surface (so it never
 *   races across a wide row), with a soft edge, at a calm 450ms.
 * - It stays for as long as the button is held, and only fades out after release (and never
 *   sooner than 225ms after the press, so a quick click still shows it).
 * - Only the innermost `.md-btn` under the pointer ripples: pressing a row's delete button
 *   ripples the button, not the row behind it. The CSS in index.css does the same for the
 *   hover tint.
 * - The ripple is clipped by `.md-btn`'s `overflow: hidden`, so a surface must keep that
 *   class for as long as it can be pressed (a row that becomes "selected" on click keeps it).
 */
const GROW_MS = 450;
const MIN_VISIBLE_MS = 225;
const FADE_MS = 375;

export function initRipples() {
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>('.md-btn');
    if (!target || target.hasAttribute('disabled')) return;

    // Where the press landed inside the surface, and how far its farthest corner is from there.
    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const reach = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y));
    // A bit more than the reach, because the ripple's edge is soft (see .md-ripple).
    const radius = reach * 1.25;

    const ripple = document.createElement('span');
    ripple.className = 'md-ripple';
    ripple.style.width = ripple.style.height = `${radius * 2}px`;
    ripple.style.left = `${x - radius}px`;
    ripple.style.top = `${y - radius}px`;
    ripple.style.animationDuration = `${GROW_MS}ms`;
    target.appendChild(ripple);

    const pressedAt = performance.now();
    const release = () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      const wait = Math.max(0, MIN_VISIBLE_MS - (performance.now() - pressedAt));
      setTimeout(() => {
        ripple.style.transitionDuration = `${FADE_MS}ms`;
        ripple.classList.add('md-ripple-out');
        setTimeout(() => ripple.remove(), FADE_MS + 50);
      }, wait);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  };

  document.addEventListener('pointerdown', onPointerDown);
  return () => document.removeEventListener('pointerdown', onPointerDown);
}
