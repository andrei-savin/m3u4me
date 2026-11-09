import { useEffect, type ReactNode } from 'react';

/**
 * Shared modal shell — the scrim, backdrop-click-to-close, Escape-to-close, and the
 * centered panel (background/elevation/flex layout) that every dialog in the app was
 * pasting by hand. Only render this when the dialog should actually be open (callers
 * still do their own `if (!open) return null` before reaching this); it owns just the
 * chrome around whatever header/body/footer content they pass as children.
 *
 * The scrim itself scrolls: a dialog taller than the screen (a phone, or a short laptop
 * window) can be scrolled to its top and bottom instead of being cut off. `my-auto` on
 * the panel keeps a dialog that fits centered exactly as before.
 *
 * `maxWidth` and `panelClassName` (extra classes appended to the panel — rounding,
 * max-height, overflow) are per-dialog since they vary by content. `dismissible`
 * defaults to true; pass false to suspend backdrop-click/Escape while a dialog is mid
 * an operation that shouldn't be casually abandoned (see BulkEpgAssignDialog's
 * 'applying' step, which already blocks tab-close for the same reason).
 */
export default function Dialog({
  onClose,
  children,
  maxWidth = 'max-w-sm',
  panelClassName = 'rounded',
  scrimClassName = 'bg-black/50',
  dismissible = true,
}: {
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
  panelClassName?: string;
  scrimClassName?: string;
  dismissible?: boolean;
}) {
  useEffect(() => {
    if (!dismissible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, dismissible]);

  return (
    <div
      className={`md-scrim fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain px-4 py-4 ${scrimClassName}`}
      onClick={dismissible ? onClose : undefined}
    >
      <div
        className={`md-dialog my-auto w-full ${maxWidth} bg-white dark:bg-[#272727] amoled:dark:bg-[#1a1a1a] elev-24 flex flex-col ${panelClassName}`}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
