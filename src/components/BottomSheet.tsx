import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * A panel that slides up from the bottom of the screen, for phones: the channel
 * editor, the Sources update log and similar. It's the phone counterpart of
 * Dialog.tsx and works the same way (dimmed backdrop, Escape or a tap on the
 * backdrop closes it, `dismissible={false}` turns both off while there's
 * something unsaved or a save is running). The title row's ✕ follows
 * `canClose` instead (default: same as `dismissible`), so a form can keep
 * its ✕ working as "close without saving" while still ignoring stray taps
 * outside it.
 *
 * Layout: a small grab bar, then a `title` row with a ✕ (or a custom `header`), then the scrolling `children`, then
 * `footer` pinned at the bottom (with room for the phone's home bar). It's at
 * most 90% of the screen tall, or always that tall with `fullHeight`.
 *
 * Like the other overlays it's z-50 and gets no CSS transform once it has slid
 * in (see .md-sheet-in in index.css), so dialogs opened from inside it, and
 * autocomplete lists positioned against the screen, still land in the right place.
 */
export default function BottomSheet({
  onClose,
  title,
  header,
  footer,
  children,
  dismissible = true,
  canClose = dismissible,
  fullHeight = false,
}: {
  onClose: () => void;
  title?: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  dismissible?: boolean;
  canClose?: boolean;
  fullHeight?: boolean;
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
      className="md-scrim fixed inset-0 z-50 flex items-end bg-black/50"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        className={`md-sheet-in w-full ${fullHeight ? 'h-[90dvh]' : 'max-h-[90dvh]'} flex flex-col rounded-t-2xl bg-white dark:bg-[#272727] amoled:dark:bg-[#1a1a1a] elev-24`}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Grab bar: just a visual cue that this is a sheet. */}
        <div className="shrink-0 flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-white/20" />
        </div>
        {title && (
          <div className="shrink-0 flex items-center gap-2 pl-5 pr-2 pb-2 border-b border-gray-100 dark:border-white/10">
            <h2 className="flex-1 min-w-0 truncate text-lg font-medium text-gray-900 dark:text-white">{title}</h2>
            <button
              onClick={onClose}
              disabled={!canClose}
              className="md-btn w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-gray-500 dark:text-gray-400 disabled:opacity-40"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        {header && <div className="shrink-0">{header}</div>}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {children}
        </div>
        <div className={`shrink-0 ${footer ? 'border-t border-gray-100 dark:border-white/10' : ''} pb-safe`}>
          {footer}
        </div>
      </div>
    </div>
  );
}
