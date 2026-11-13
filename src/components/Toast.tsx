import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import Icon from './Icon';

const DISPLAY_MS = 5000;

// The snackbar is dark in every theme (see --app-snackbar in index.css), so the icons use
// the colours made to read on it.
const TOAST_ICON = {
  error: { icon: 'error', className: 'text-[#ffb4ab]' },
  warning: { icon: 'warning', className: 'text-snackbar-accent' },
  info: { icon: 'info', className: 'text-snackbar-accent' },
} as const;

/**
 * Shared Material 3 snackbar surface. Every notification — error/warning/info toasts and the undo
 * snackbar — renders on this exact surface (color, shape, elevation, type scale) so the app
 * has one consistent notification design instead of a different treatment per kind. Only the
 * leading icon (for toasts) or action button (for undo) varies.
 */
const SNACKBAR = 'md-snackbar-in pointer-events-auto flex items-center gap-3 w-full max-w-md min-h-12 pl-4 pr-2 py-1.5 rounded-sm bg-snackbar text-on-snackbar shadow-level-3 text-body-md';

/**
 * Renders the app's single notification stack: the global error/warning/info toast (`toast` in
 * the store, set via `notifyError`/`notifyWarning`/`notifyInfo`) and the undo snackbar
 * (`undoEntry`). Both are bottom-anchored and share the same Material Design snackbar surface —
 * per MD guidelines, at most one of each is shown at a time (a new toast replaces the last).
 */
export default function Toast({ withTabBar = false }: { withTabBar?: boolean }) {
  const { toast, setToast, undoEntry, setUndoEntry } = useStore();
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (toast) {
      toastTimerRef.current = setTimeout(() => setToast(null), DISPLAY_MS);
    }
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, [toast, setToast]);

  useEffect(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    if (undoEntry) {
      undoTimerRef.current = setTimeout(() => setUndoEntry(null), DISPLAY_MS);
    }
    return () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current); };
  }, [undoEntry, setUndoEntry]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Inside a text field, Cmd/Ctrl+Z should undo typing, not restore something deleted
      // earlier — e.g. a password field on Settings while a carried-over undo snackbar shows.
      const target = e.target as HTMLElement | null;
      const isTextField = !!target && (
        target.isContentEditable ||
        target.tagName === 'TEXTAREA' ||
        (target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'color'].includes(target.type))
      );
      if (isTextField) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && undoEntry) {
        e.preventDefault();
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        undoEntry.restore();
        setUndoEntry(null);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [undoEntry, setUndoEntry]);

  if (!toast && !undoEntry) return null;

  return (
    // On phones, screens with the bottom tab bar (`withTabBar`) lift the snackbar above it
    // (the bar is 4rem plus the home-bar inset). Computers keep bottom-6 either way.
    <div className={`fixed ${withTabBar ? 'bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6' : 'bottom-[calc(1.5rem+env(safe-area-inset-bottom))] md:bottom-6'} inset-x-0 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none`}>
      {toast && (() => {
        const { icon, className } = TOAST_ICON[toast.type];
        return (
          <div key={toast.id} className={SNACKBAR}>
            <Icon name={icon} className={`text-[20px] ${className}`} />
            <span className="flex-1 py-2">{toast.message}</span>
            <button
              onClick={() => {
                if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
                setToast(null);
              }}
              className="md-btn icon-btn text-on-snackbar"
              aria-label="Dismiss"
            >
              <Icon name="close" className="text-[20px]" />
            </button>
          </div>
        );
      })()}

      {undoEntry && (
        <div key={undoEntry.description} className={SNACKBAR}>
          <span className="flex-1 py-2">{undoEntry.description}</span>
          <button
            onClick={() => {
              if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
              undoEntry.restore();
              setUndoEntry(null);
            }}
            className="md-btn btn btn-text text-snackbar-accent"
          >
            Undo
          </button>
          <button
            onClick={() => {
              if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
              setUndoEntry(null);
            }}
            className="md-btn icon-btn text-on-snackbar"
            aria-label="Dismiss"
          >
            <Icon name="close" className="text-[20px]" />
          </button>
        </div>
      )}
    </div>
  );
}
