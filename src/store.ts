import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isNarrowNow } from './utils/useIsPhone';
import type { ColorStyle } from './utils/materialTheme';

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
  /**
   * Set by Home's "Sync updates waiting" card to a playlist id. PlaylistEditor opens that
   * playlist's sync log once it's showing, then clears this back to null.
   */
  syncLogOpenFor: string | null;
  setSyncLogOpenFor: (playlistId: string | null) => void;
  isSidebarOpen: boolean;
  setSidebarOpen: (isOpen: boolean) => void;
  logoBgColor: string;
  setLogoBgColor: (color: string) => void;
  accentColor: string;
  setAccentColor: (color: string) => void;
  /** The theme picked in Settings: 'auto' follows the device's light/dark setting. */
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  /**
   * Whether the app is dark right now. Not a setting of its own: it's worked out from
   * themeMode (and, in 'auto', the device), and kept current when the device switches.
   */
  isDarkMode: boolean;
  /**
   * AMOLED black: an add-on to dark mode. While it's on, the app is pure black every time it's
   * dark (picked Dark, or Auto on a dark device). Only its own switch turns it off.
   */
  isAmoledMode: boolean;
  setAmoledMode: (isAmoled: boolean) => void;
  hideUrls: boolean;
  setHideUrls: (hide: boolean) => void;
  is24Hour: boolean;
  set24Hour: (is24Hour: boolean) => void;
  /** 'geist' (Geist + Geist Mono, the default) or 'system' (the device's own fonts). */
  fontFamily: FontFamily;
  setFontFamily: (font: FontFamily) => void;
  /** How the palette is built from the accent colour (see COLOR_STYLES in materialTheme.ts). */
  colorStyle: ColorStyle;
  setColorStyle: (style: ColorStyle) => void;
  /**
   * Width in pixels of the channel name column in a playlist, once its divider has been
   * dragged. null = automatic (PlaylistEditor shares the row between name and TV guide).
   */
  nameColumnWidth: number | null;
  setNameColumnWidth: (width: number | null) => void;
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

export type FontFamily = 'geist' | 'system';

export type ThemeMode = 'auto' | 'light' | 'dark';

// The browser reports the device's light/dark setting through this media query, and fires a
// `change` event on it when the device switches (by hand, or automatically at sunset).
const DARK_QUERY = '(prefers-color-scheme: dark)';
const systemPrefersDark = () => typeof window !== 'undefined' && window.matchMedia(DARK_QUERY).matches;
const resolveDark = (mode: ThemeMode) => mode === 'dark' || (mode === 'auto' && systemPrefersDark());

/** The accent colour swatches offered in Settings and on the first-run setup's welcome screen.
 * The first one is the default accentColor below. */
export const ACCENT_PRESETS = [
  '#FF2960', '#FF5D29', '#22D5A7', '#29CBFF',
  '#5D29FF', '#607083',
];

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
      syncLogOpenFor: null,
      setSyncLogOpenFor: (playlistId) => set({ syncLogOpenFor: playlistId }),
      // Starts closed on phones and upright tablets, where the drawer floats over the page.
      isSidebarOpen: !isNarrowNow(),
      setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
      logoBgColor: '#f1f5f9',
      setLogoBgColor: (color) => set({ logoBgColor: color }),
      accentColor: '#FF2960',
      setAccentColor: (color) => set({ accentColor: color }),
      themeMode: 'auto',
      setThemeMode: (mode) => set({ themeMode: mode, isDarkMode: resolveDark(mode) }),
      isDarkMode: resolveDark('auto'),
      isAmoledMode: false,
      setAmoledMode: (isAmoled) => set({ isAmoledMode: isAmoled }),
      hideUrls: false,
      setHideUrls: (hide) => set({ hideUrls: hide }),
      is24Hour: false,
      set24Hour: (is24Hour) => set({ is24Hour }),
      fontFamily: 'geist',
      setFontFamily: (fontFamily) => set({ fontFamily }),
      colorStyle: 'tonalSpot',
      setColorStyle: (colorStyle) => set({ colorStyle }),
      nameColumnWidth: null,
      setNameColumnWidth: (nameColumnWidth) => set({ nameColumnWidth }),
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
        themeMode: state.themeMode,
        isAmoledMode: state.isAmoledMode,
        is24Hour: state.is24Hour,
        fontFamily: state.fontFamily,
        colorStyle: state.colorStyle,
        nameColumnWidth: state.nameColumnWidth,
        // What was open last, so a reload (or a phone browser that dropped the tab) comes back
        // to the same playlist, category, source and guide instead of an empty screen. Dashboard
        // falls back to the first one when a remembered one has since been deleted.
        activePlaylistId: state.activePlaylistId,
        activeCategory: state.activeCategory,
        activeEpgSourceId: state.activeEpgSourceId,
        activeChannelPoolSourceId: state.activeChannelPoolSourceId,
      }),
      // Version 1 replaced the saved Light/Dark choice (`isDarkMode`) with `themeMode`. Everyone
      // who had the old setting starts on Auto; AMOLED stays on for whoever had it.
      version: 1,
      migrate: (saved, version) => {
        const state = { ...(saved as Record<string, unknown>) };
        if (version < 1) {
          delete state.isDarkMode;
          state.themeMode = 'auto';
        }
        return state as unknown as AppState;
      },
      // isDarkMode isn't saved, so work it out again from the saved themeMode as the settings load.
      merge: (saved, current) => {
        const merged = { ...current, ...(saved as Partial<AppState>) };
        return { ...merged, isDarkMode: resolveDark(merged.themeMode) };
      },
    }
  )
);

// Follow the device live: when it switches between light and dark while the app is open,
// update isDarkMode (it only changes anything while themeMode is 'auto').
if (typeof window !== 'undefined') {
  window.matchMedia(DARK_QUERY).addEventListener('change', () => {
    useStore.setState({ isDarkMode: resolveDark(useStore.getState().themeMode) });
  });
}

let nextToastId = 0;

/**
 * Thrown by apiClient's authFetch when a request comes back 401. Kept distinguishable from a
 * normal request failure so notifyError can ignore it below — the LockScreen that the matching
 * `auth-expired` event brings up already tells the user they need to log in again, and because
 * Toast only lives inside Dashboard/Home/Settings (unmounted while locked), a toast set here would otherwise
 * sit in the store and reappear stale the moment the user logs back in and Dashboard remounts.
 */
export class AuthExpiredError extends Error {}

/**
 * Shows a message in the global notification snackbar (<Toast />, mounted in Dashboard, Home and Settings). Call this
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
