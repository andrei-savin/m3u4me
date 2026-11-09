import { useEffect, useRef } from 'react';
import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useStore } from '../store';

const DISPLAY_MS = 5000;

const TOAST_ICON = {
  error: { Icon: AlertCircle, className: 'text-red-400' },
  warning: { Icon: AlertTriangle, className: 'text-amber-400' },
  info: { Icon: Info, className: 'text-sky-400' },
} as const;

/**
 * Shared MD2 snackbar surface. Every notification — error/warning/info toasts and the undo
 * snackbar — renders on this exact surface (color, shape, elevation, type scale) so the app
 * has one consistent notification design instead of a different treatment per kind. Only the
 * leading icon (for toasts) or action button (for undo) varies.
 */
const SNACKBAR = 'md-snackbar-in pointer-events-auto flex items-center gap-3 w-full max-w-md px-4 py-3 rounded bg-gray-800 dark:bg-[#2f2f2f] text-white shadow-xl elev-8 text-sm';

/**
 * Renders the app's single notification stack: the global error/warning/info toast (`toast` in
 * the store, set via `notifyError`/`notifyWarning`/`notifyInfo`) and the undo snackbar
 * (`undoEntry`). Both are bottom-anchored and share the same Material Design snackbar surface —
 * per MD guidelines, at most one of each is shown at a time (a new toast replaces the last).
 */
export default function Toast({ withTabBar = false }: { withTabBar?: boolean }) {
  const { toast, setToast, undoEntry, setUndoEntry, accentColor } = useStore();
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
        const { Icon, className } = TOAST_ICON[toast.type];
        return (
          <div key={toast.id} className={SNACKBAR}>
            <Icon className={`shrink-0 ${className}`} size={18} />
            <span className="flex-1">{toast.message}</span>
            <button
              onClick={() => {
                if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
                setToast(null);
              }}
              className="text-white/70 hover:text-white transition-colors shrink-0"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        );
      })()}

      {undoEntry && (
        <div key={undoEntry.description} className={SNACKBAR}>
          <span className="flex-1">{undoEntry.description}</span>
          <button
            onClick={() => {
              if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
              undoEntry.restore();
              setUndoEntry(null);
            }}
            className="font-medium uppercase text-xs tracking-wider px-2 py-1 rounded hover:bg-white/10 transition-colors shrink-0"
            style={{ color: accentColor }}
          >
            Undo
          </button>
          <button
            onClick={() => {
              if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
              setUndoEntry(null);
            }}
            className="text-white/70 hover:text-white transition-colors shrink-0"
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
