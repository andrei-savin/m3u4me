import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  activePlaylistId: string | null;
  setActivePlaylistId: (id: string | null) => void;
  activeCategory: string | null;
  setActiveCategory: (cat: string | null) => void;
  /**
   * Set by Spotlight search (or anything else jumping straight to a result) after the
   * matching active-container id (activePlaylistId / activeChannelPoolSourceId /
   * activeEpgSourceId) is updated. `kind` matches SearchResult['kind'] in apiClient.ts —
   * the consuming view (PlaylistEditor / ChannelPoolViewer / EpgViewer, one per kind)
   * picks this up once its list is ready, clears any filter/pagination that would hide
   * the target, scrolls to it, highlights it, and clears this back to null. A single
   * discriminated field (rather than one nullable id per kind) guarantees only one
   * pending scroll target ever exists at a time.
   */
  scrollTarget: { kind: 'playlist' | 'channelPool' | 'epg'; id: string } | null;
  setScrollTarget: (target: { kind: 'playlist' | 'channelPool' | 'epg'; id: string } | null) => void;
  activeEpgSourceId: string | null;
  setActiveEpgSourceId: (id: string | null) => void;
  activeChannelPoolSourceId: string | null;
  setActiveChannelPoolSourceId: (id: string | null) => void;
  channelPoolLogOpen: boolean;
  setChannelPoolLogOpen: (open: boolean) => void;
  isSidebarOpen: boolean;
  setSidebarOpen: (isOpen: boolean) => void;
  logoBgColor: string;
  setLogoBgColor: (color: string) => void;
  accentColor: string;
  setAccentColor: (color: string) => void;
  isDarkMode: boolean;
  setDarkMode: (isDark: boolean) => void;
  isAmoledMode: boolean;
  setAmoledMode: (isAmoled: boolean) => void;
  hideUrls: boolean;
  setHideUrls: (hide: boolean) => void;
  is24Hour: boolean;
  set24Hour: (is24Hour: boolean) => void;
  undoEntry: { description: string; restore: () => Promise<void> } | null;
  setUndoEntry: (entry: { description: string; restore: () => Promise<void> } | null) => void;
  /**
   * The single active notification snackbar (rendered in Dashboard.tsx). Material Design
   * shows one snackbar at a time — a new toast replaces whatever is currently showing rather
   * than stacking alongside it. `type` drives the leading icon/color only; the surface, shape,
   * and layout stay identical across error/warning/info so all toasts read as one design.
   */
  toast: { id: number; type: 'error' | 'warning' | 'info'; message: string } | null;
  setToast: (toast: { id: number; type: 'error' | 'warning' | 'info'; message: string } | null) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      activePlaylistId: null,
      setActivePlaylistId: (id) => set({ activePlaylistId: id, activeCategory: null }),
      activeCategory: null,
      setActiveCategory: (cat) => set({ activeCategory: cat }),
      scrollTarget: null,
      setScrollTarget: (target) => set({ scrollTarget: target }),
      activeEpgSourceId: null,
      setActiveEpgSourceId: (id) => set({ activeEpgSourceId: id }),
      activeChannelPoolSourceId: null,
      setActiveChannelPoolSourceId: (id) => set({ activeChannelPoolSourceId: id }),
      channelPoolLogOpen: false,
      setChannelPoolLogOpen: (open) => set({ channelPoolLogOpen: open }),
      isSidebarOpen: true,
      setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
      logoBgColor: '#f1f5f9',
      setLogoBgColor: (color) => set({ logoBgColor: color }),
      accentColor: '#FF2960',
      setAccentColor: (color) => set({ accentColor: color }),
      isDarkMode: false,
      setDarkMode: (isDark) => set({ isDarkMode: isDark }),
      isAmoledMode: false,
      setAmoledMode: (isAmoled) => set({ isAmoledMode: isAmoled }),
      hideUrls: false,
      setHideUrls: (hide) => set({ hideUrls: hide }),
      is24Hour: false,
      set24Hour: (is24Hour) => set({ is24Hour }),
      undoEntry: null,
      setUndoEntry: (entry) => set({ undoEntry: entry }),
      toast: null,
      setToast: (toast) => set({ toast }),
    }),
    {
      name: 'm3u-manager-storage',
      partialize: (state) => ({
        logoBgColor: state.logoBgColor,
        accentColor: state.accentColor,
        isDarkMode: state.isDarkMode,
        isAmoledMode: state.isAmoledMode,
        is24Hour: state.is24Hour,
      }),
    }
  )
);

let nextToastId = 0;

/**
 * Thrown by apiClient's authFetch when a request comes back 401. Kept distinguishable from a
 * normal request failure so notifyError can ignore it below — the LockScreen that the matching
 * `auth-expired` event brings up already tells the user they need to log in again, and because
 * Toast only lives inside Dashboard (unmounted while locked), a toast set here would otherwise
 * sit in the store and reappear stale the moment the user logs back in and Dashboard remounts.
 */
export class AuthExpiredError extends Error {}

/**
 * Shows a message in the global notification snackbar (rendered in Dashboard.tsx). Call this
 * from a catch block — alongside the existing console.error — whenever a user-triggered save,
 * delete, reorder, or assignment fails, so the failure is visible instead of silently no-op-ing.
 */
export function notifyError(e: unknown, fallback = 'Something went wrong. Please try again.') {
  if (e instanceof AuthExpiredError) return;
  const message = e instanceof Error && e.message ? e.message : fallback;
  useStore.getState().setToast({ id: nextToastId++, type: 'error', message });
}

/**
 * Shows a message in the global notification snackbar, styled as a non-fatal warning — e.g. a
 * request that partially succeeded. Less alarming than `notifyError`, more pointed than `notifyInfo`.
 */
export function notifyWarning(message: string) {
  useStore.getState().setToast({ id: nextToastId++, type: 'warning', message });
}

/**
 * Shows a message in the global notification snackbar, styled as a neutral confirmation. Use
 * this for non-error, non-urgent confirmations — e.g. "no changes found" — that don't warrant
 * the error toast's alarm styling.
 */
export function notifyInfo(message: string) {
  useStore.getState().setToast({ id: nextToastId++, type: 'info', message });
}

/** Returns '#ffffff' or '#000000' depending on which gives better contrast. */
export function contrastText(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 145 ? '#000000' : '#ffffff';
}

/** Appends a two-hex-digit alpha to a #RRGGBB string (e.g. 0x18 ≈ 9 %). */
export function accentAlpha(hex: string, alpha: string): string {
  return `${hex}${alpha}`;
}
