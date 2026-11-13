import React, { useState, useEffect, useRef } from 'react';
import { api, ChannelPoolEntry, ChannelPoolSource, usePlaylists, Playlist, channelPoolEvents, triggerRefresh, triggerChannelPoolRefresh, SyncFieldToggles as SyncFieldTogglesValue } from '../apiClient';
import { useStore, notifyError, notifyInfo } from '../store';
import Checkbox from './Checkbox';
import ChannelLogo from './ChannelLogo';
import { useDebouncedValue } from '../utils/useDebouncedValue';
import { formatTime } from '../utils/formatTime';
import Dialog from './Dialog';
import SyncFieldToggles, { describeSyncFields, anySyncFieldOn } from './SyncFieldToggles';
import { useIsPhone, canHover } from '../utils/useIsPhone';
import { copyToClipboard } from '../utils/copyToClipboard';
import Icon from './Icon';
import SourceActions from './SourceActions';

interface ChannelPoolViewerProps {
  sourceId: string;
  // Undefined while the source list is still loading. Sync is only offered once it's known.
  source?: ChannelPoolSource;
  // Re-downloads the source (Dashboard's sidebar refresh), and opens its edit dialog. Both are
  // next to the title (SourceActions) and next to a failed download's reason.
  onRetry: () => void;
  isRetrying: boolean;
  onEdit: () => void;
}

// "Today at 14:32" / "03.09.2026 at 14:32", same shape as the Sources update log.
function formatWhen(ts: number, is24Hour: boolean): string {
  const date = new Date(ts);
  const timeStr = formatTime(date, is24Hour);
  return new Date().toDateString() === date.toDateString() ? `Today at ${timeStr}` : `${date.toLocaleDateString()} at ${timeStr}`;
}

// Why the source's last download failed, with ways to fix it. It stays on screen whenever the
// source is open, until a download works (the server then clears `lastFetchError`).
// `full` = nothing was ever downloaded, so this takes the list's place; otherwise it's a banner
// above the channels saved from the last download that worked.
function DownloadErrorNotice({
  source,
  full,
  is24Hour,
  onRetry,
  isRetrying,
  onEdit,
}: {
  source: ChannelPoolSource;
  full: boolean;
  is24Hour: boolean;
  onRetry: () => void;
  isRetrying: boolean;
  onEdit: () => void;
}) {
  const details = [
    source.lastFetchErrorAt ? `Last tried: ${formatWhen(source.lastFetchErrorAt, is24Hour)}.` : null,
    !full && source.lastFetched ? `Showing the channels from the last download that worked: ${formatWhen(source.lastFetched, is24Hour)}.` : null,
  ].filter(Boolean).join(' ');

  const buttons = (
    <div className={`flex items-center gap-1 ${full ? 'justify-center mt-5' : 'mt-2 -ml-3'}`}>
      <button onClick={onRetry} disabled={isRetrying} className={`md-btn btn btn-text ${full ? '' : 'text-on-error-container'}`}>
        <Icon name="refresh" className={`text-[20px] ${isRetrying ? 'animate-spin' : ''}`} />
        {isRetrying ? 'Trying…' : 'Try again'}
      </button>
      <button onClick={onEdit} className={`md-btn btn btn-text ${full ? '' : 'text-on-error-container'}`}>
        <Icon name="edit" className="text-[20px]" />
        Edit source
      </button>
    </div>
  );

  if (full) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <div className="w-16 h-16 rounded-full flex items-center justify-center bg-error-container text-on-error-container mb-5">
          <Icon name="warning" className="text-[28px]" />
        </div>
        <h3 className="text-title-md text-on-surface">Couldn't download this source</h3>
        <p className="mt-2 max-w-md text-body-md text-on-surface-variant">{source.lastFetchError}</p>
        {details && <p className="mt-2 max-w-md text-body-sm text-on-surface-variant">{details}</p>}
        {buttons}
      </div>
    );
  }

  return (
    <div className="shrink-0 flex gap-3 mx-4 mb-2 px-4 py-3 rounded-xl bg-error-container text-on-error-container">
      <Icon name="warning" className="text-[24px] shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-label-lg">Couldn't download the latest channels</p>
        <p className="mt-0.5 text-body-md">{source.lastFetchError}</p>
        {details && <p className="mt-1 text-body-sm opacity-80">{details}</p>}
        {buttons}
      </div>
    </div>
  );
}

function AddToPlaylistModal({
  channels,
  playlists,
  canSync,
  onClose,
}: {
  channels: ChannelPoolEntry[];
  playlists: Playlist[];
  // False for uploaded-file sources: the file never changes, so there'd be nothing to sync.
  canSync: boolean;
  // `added` is true only after a successful add, so Cancel doesn't report anything.
  onClose: (added?: boolean) => void;
}) {
  const [selectedPlaylist, setSelectedPlaylist] = useState(playlists[0]?.id ?? '');
  const [categoryOverride, setCategoryOverride] = useState('');
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState(false);

  // Sync options apply to every channel in this selection. For different settings per channel,
  // the user adds channels one at a time.
  const [keepInSync, setKeepInSync] = useState(false);
  const [syncMode, setSyncMode] = useState<'default' | 'custom'>('default');
  const [defaultFields, setDefaultFields] = useState<SyncFieldTogglesValue | null>(null);
  const [customFields, setCustomFields] = useState<SyncFieldTogglesValue>({ url: true, name: true, logo: true, tvgId: true });

  useEffect(() => {
    if (!canSync) return;
    api.getSettings()
      .then(s => { setDefaultFields(s.defaultSyncFields); setCustomFields(s.defaultSyncFields); })
      .catch(e => { console.error(e); notifyError(e, "Couldn't load your default sync settings."); });
  }, [canSync]);

  const syncFields = syncMode === 'custom' ? customFields : defaultFields;
  // Covers both modes: the saved defaults can have every field switched off too.
  const nothingToSync = keepInSync && !!syncFields && !anySyncFieldOn(syncFields);

  const handleAdd = async () => {
    if (!selectedPlaylist) return;
    setAdding(true);
    const linking = canSync && keepInSync;
    try {
      await api.bulkAddChannels(
        selectedPlaylist,
        channels.map(c => ({
          name: c.name,
          url: c.url,
          logo: c.logo,
          tvgId: c.tvgId,
          httpReferrer: c.httpReferrer,
          httpUserAgent: c.httpUserAgent,
          category: categoryOverride.trim() || c.category,
          // Without fields (defaults not loaded yet), the server uses the saved defaults.
          ...(linking ? { link: { sourceId: c.sourceId, poolEntryId: c.id, ...(syncFields ? { fields: syncFields } : {}) } } : {}),
        }))
      );
      triggerRefresh();
      // Refetches the source list so the new link icons show up on these channels.
      if (linking) triggerChannelPoolRefresh();
      setDone(true);
      setTimeout(() => onClose(true), 900);
    } catch (e) {
      console.error(e);
      notifyError(e, 'Failed to add channels.');
      setAdding(false);
    }
  };

  return (
    <Dialog onClose={() => onClose()}>
        <div className="flex items-center justify-between pl-6 pr-3 pt-4 pb-2">
          <h2 className="text-headline-sm text-on-surface">
            Add {channels.length} channel{channels.length !== 1 ? 's' : ''} to playlist
          </h2>
          <button onClick={() => onClose()} className="md-btn icon-btn" aria-label="Close">
            <Icon name="close" className="text-[24px]" />
          </button>
        </div>

        <div className="px-6 pt-2 pb-2 flex flex-col gap-4">
          <div>
            <label className="field-label">Playlist</label>
            <select
              value={selectedPlaylist}
              onChange={e => setSelectedPlaylist(e.target.value)}
              className="field bg-dialog max-md:text-base"
            >
              {playlists.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
              {playlists.length === 0 && <option value="">No playlists available</option>}
            </select>
          </div>

          <div>
            <label className="field-label">
              Category override <span className="font-normal">(optional)</span>
            </label>
            <select
              value={categoryOverride}
              onChange={e => setCategoryOverride(e.target.value)}
              className="field bg-dialog max-md:text-base"
            >
              <option value="">Keep original categories</option>
              {playlists.find(p => p.id === selectedPlaylist)?.categories?.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          {canSync && (
            <div className="rounded-xl bg-surface-container-highest p-4 flex flex-col gap-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={keepInSync}
                  onChange={e => setKeepInSync(e.target.checked)}
                  className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer accent-primary"
                />
                <span>
                  <span className="block text-body-lg text-on-surface">Keep in sync with source</span>
                  <span className="block text-body-sm text-on-surface-variant mt-0.5">
                    When the provider changes {channels.length === 1 ? 'this channel' : 'these channels'}, your playlist updates too.
                  </span>
                </span>
              </label>
              {keepInSync && (
                <>
                  <select
                    value={syncMode}
                    onChange={e => setSyncMode(e.target.value as 'default' | 'custom')}
                    className="field bg-dialog max-md:text-base"
                  >
                    <option value="default">Default settings{defaultFields ? ` (${describeSyncFields(defaultFields)})` : ''}</option>
                    <option value="custom">Custom settings</option>
                  </select>
                  {syncMode === 'custom' && (
                    <SyncFieldToggles value={customFields} onChange={setCustomFields} />
                  )}
                  {nothingToSync && (
                    <p className="text-body-sm text-error">
                      {syncMode === 'custom'
                        ? 'Pick at least one thing to sync, or turn off "Keep in sync with source".'
                        : "Your default sync settings don't sync anything. Pick custom settings, or change the defaults in Settings."}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 pt-4 pb-6">
          <button
            onClick={() => onClose()}
            disabled={adding}
            className="md-btn btn btn-text"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={adding || !selectedPlaylist || done || nothingToSync}
            className="md-btn btn btn-filled"
          >
            {done ? 'Added' : adding ? 'Adding…' : 'Add'}
          </button>
        </div>
    </Dialog>
  );
}

// Row height: taller on touch screens, to fit 44px buttons with room around them.
const ROW = canHover ? 56 : 64;

export default function ChannelPoolViewer({ sourceId, source, onRetry, isRetrying, onEdit }: ChannelPoolViewerProps) {
  const { logoBgColor, hideUrls, setHideUrls, scrollTarget, setScrollTarget, is24Hour } = useStore();
  const scrollToChannelPoolEntryId = scrollTarget?.kind === 'channelPool' ? scrollTarget.id : null;
  const [channels, setChannels] = useState<ChannelPoolEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [sortMode, setSortMode] = useState<'name' | 'original'>('name');
  // Keyed by id but stores the full entry (not just the id) so that a selection made
  // under one search query survives switching to a different search/category filter —
  // the channel may no longer be present in the currently-loaded `channels` array once
  // the query changes, so we can't re-derive it by filtering `channels` at add time.
  const [selectedEntries, setSelectedEntries] = useState<Map<string, ChannelPoolEntry>>(new Map());
  const [addedMessage, setAddedMessage] = useState<string | null>(null);
  const [modalChannels, setModalChannels] = useState<ChannelPoolEntry[] | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const isPhone = useIsPhone();
  // The entry whose stream link was just copied; its copy button shows a check for a moment.
  const [copiedEntryId, setCopiedEntryId] = useState<string | null>(null);
  const copyStreamLink = async (channel: ChannelPoolEntry) => {
    if (!(await copyToClipboard(channel.url))) {
      notifyError(null, "Couldn't copy the stream link. Try again.");
      return;
    }
    setCopiedEntryId(channel.id);
    setTimeout(() => setCopiedEntryId(current => (current === channel.id ? null : current)), 1500);
  };
  // Phones show the category and sort pickers on a second row, opened by the filter button.
  const [showPhoneFilters, setShowPhoneFilters] = useState(false);
  const filtersActive = !!selectedCategory || sortMode !== 'name';

  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const listContainerRef = useRef<HTMLDivElement>(null);

  const { playlists } = usePlaylists();

  // Jump to a specific entry requested externally (e.g. Spotlight search). The result
  // doesn't say whether the current search/category filter would hide it, so the simplest
  // guarantee is to just clear both — this re-fetches the full list...
  useEffect(() => {
    if (!scrollToChannelPoolEntryId) return;
    if (searchInput || search || selectedCategory) {
      setSearchInput('');
      setSearch('');
      setSelectedCategory('');
    }
  }, [scrollToChannelPoolEntryId, searchInput, search, selectedCategory]);

  // ...then, once that unfiltered list has loaded, scroll to the entry and highlight it.
  // The list is virtualized (only rows near the viewport actually exist in the DOM), so
  // rather than scrollIntoView-ing a node that may not be rendered yet, this scrolls the
  // container directly — `scrollTop` state (and the virtualized window it drives) then
  // follows along via the existing onScroll handler below. This jumps instantly rather
  // than animating smoothly, since a `behavior: 'smooth'` scroll isn't guaranteed to
  // actually animate (observed stalling outright in some environments) and there's no
  // rendered row to land on until the jump completes, virtualized as this list is.
  useEffect(() => {
    if (!scrollToChannelPoolEntryId || search || selectedCategory) return;
    const idx = channels.findIndex(c => c.id === scrollToChannelPoolEntryId);
    if (idx === -1) return;
    setScrollTarget(null);
    listContainerRef.current?.scrollTo({ top: Math.max(0, idx * ROW - containerHeight / 2 + ROW / 2), behavior: 'instant' });
    setHighlightedId(scrollToChannelPoolEntryId);
    const t = setTimeout(() => setHighlightedId(null), 2000);
    return () => clearTimeout(t);
  }, [scrollToChannelPoolEntryId, channels, search, selectedCategory, containerHeight, setScrollTarget]);

  const debouncedSearchInput = useDebouncedValue(searchInput, 400);
  useEffect(() => { setSearch(debouncedSearchInput); }, [debouncedSearchInput]);

  useEffect(() => {
    const el = listContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      if (entries[0]) setContainerHeight(entries[0].contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!sourceId) { setChannels([]); setCategories([]); setLoadError(null); return; }
    let alive = true;
    const fetchData = () => {
      setLoading(true);
      Promise.all([
        api.getChannelPoolChannels(sourceId, search, selectedCategory, sortMode),
        api.getChannelPoolCategories(sourceId),
      ]).then(([chans, cats]) => {
        if (alive) { setChannels(chans); setCategories(cats); setLoading(false); setLoadError(null); }
      }).catch(err => {
        console.error(err);
        if (alive) {
          setLoading(false);
          setLoadError('Failed to load channels.');
          notifyError(err, 'Failed to load channels.');
        }
      });
    };

    fetchData();

    const handleRefresh = () => {
      if (alive) fetchData();
    };
    channelPoolEvents.addEventListener('refresh', handleRefresh);

    return () => {
      alive = false;
      channelPoolEvents.removeEventListener('refresh', handleRefresh);
    };
  }, [sourceId, search, selectedCategory, sortMode, retryTick]);

  // "Select all" only ever acts on the currently visible/filtered channels — it toggles
  // them in or out of the running cross-search selection without touching entries
  // selected under a different search query.
  const allVisibleSelected = channels.length > 0 && channels.every(c => selectedEntries.has(c.id));

  const toggleSelectAll = () =>
    setSelectedEntries(prev => {
      const next = new Map(prev);
      if (allVisibleSelected) {
        channels.forEach(c => next.delete(c.id));
      } else {
        channels.forEach(c => next.set(c.id, c));
      }
      return next;
    });

  const toggleSelect = (channel: ChannelPoolEntry) => {
    setSelectedEntries(prev => {
      const next = new Map(prev);
      next.has(channel.id) ? next.delete(channel.id) : next.set(channel.id, channel);
      return next;
    });
  };

  const openAddModal = (target: ChannelPoolEntry | null) => {
    const toAdd = target ? [target] : Array.from(selectedEntries.values());
    if (toAdd.length > 0) setModalChannels(toAdd);
  };

  // Only a successful add reports anything and clears the selection. (Cancel used to
  // say "Added N channel(s)" and throw the selection away too.)
  const handleModalClose = (added?: boolean) => {
    if (added && modalChannels) {
      const message = 'Added ' + modalChannels.length + ' channel(s)';
      // The desktop toolbar has a spot for this; on a phone it's a snackbar.
      if (isPhone) notifyInfo(message);
      else {
        setAddedMessage(message);
        setTimeout(() => setAddedMessage(null), 3000);
      }
      setSelectedEntries(new Map());
    }
    setModalChannels(null);
  };

  if (!sourceId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-body-md text-on-surface-variant">
        <p>No channel source selected.</p>
      </div>
    );
  }

  // channelCount only changes when a download works, so it says whether there are saved channels
  // to show under the error or nothing at all.
  const downloadFailed = !!source?.lastFetchError;
  const neverDownloaded = downloadFailed && !source?.channelCount;

  const startIdx = Math.max(0, Math.floor(scrollTop / ROW) - 5);
  const endIdx = Math.min(channels.length, Math.ceil((scrollTop + containerHeight) / ROW) + 10);

  // Outlined pill for the category and sort pickers on bigger screens.
  const pickerCls = 'h-10 pl-4 pr-2 rounded-full border border-outline bg-pane text-label-lg text-on-surface-variant cursor-pointer focus:outline-none focus:border-primary';
  // With a mouse, a row's copy and add buttons appear on hover; touch screens always show them.
  const reveal = canHover ? 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100' : '';

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      {/* ── Header: the source's name, then search, filters and actions ── */}
      <div className="shrink-0 hidden md:flex items-end gap-2 pl-6 pr-4 pt-4 pb-1">
        <div className="flex-1 min-w-0">
          <p className="text-label-md text-on-surface-variant">Channel source</p>
          <div className="flex items-baseline gap-2.5 min-w-0">
            <h2 className="min-w-0 truncate text-headline-sm tracking-[-0.01em] text-on-surface">{source?.name ?? 'Channels'}</h2>
            <span className="shrink-0 text-body-md text-on-surface-variant">{channels.length} channel{channels.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        {/* Uploaded files can't be downloaded again, so they only get Edit. */}
        <SourceActions
          kind="source"
          onRefresh={source?.type === 'playlist-file' ? undefined : onRetry}
          isRefreshing={isRetrying}
          onEdit={onEdit}
        />
      </div>

      <div className="shrink-0 flex items-center gap-2 px-4 max-md:px-2 py-3 max-md:py-2 z-20">
        <div className="relative w-72 max-md:w-auto max-md:flex-1 max-md:min-w-0">
          <Icon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-[24px] text-on-surface-variant" />
          <input
            type="text"
            placeholder="Search channels"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            className="w-full h-10 max-md:h-12 pl-11 pr-4 rounded-full bg-surface-container-highest text-body-md max-md:text-base text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Phones: category and sort live behind this button (second row below). */}
        <button
          onClick={() => setShowPhoneFilters(v => !v)}
          className={`md-btn icon-btn md:hidden relative w-12 h-12 ${showPhoneFilters ? 'bg-secondary-container text-on-secondary-container' : ''}`}
          aria-label="Category and sort"
          title="Category and sort"
        >
          <Icon name="tune" className="text-[24px]" />
          {filtersActive && <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-primary" />}
        </button>

        <select
          value={selectedCategory}
          onChange={e => setSelectedCategory(e.target.value)}
          className={`hidden md:block max-w-xs ${pickerCls}`}
          aria-label="Category"
        >
          <option value="">All categories</option>
          {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
        </select>

        <select
          value={sortMode}
          onChange={e => setSortMode(e.target.value as 'name' | 'original')}
          title="Sort order"
          className={`hidden md:block ${pickerCls}`}
        >
          <option value="name">Sort: A–Z</option>
          <option value="original">Sort: Original order</option>
        </select>

        <div className="flex-1 hidden md:block" />

        <div className="hidden md:flex items-center gap-1">
          {addedMessage && (
            <span className="text-label-md text-success flex items-center gap-1 mr-2">
              <Icon name="check" className="text-[20px]" />{addedMessage}
            </span>
          )}
          <button
            onClick={() => setHideUrls(!hideUrls)}
            className="md-btn icon-btn"
            title={hideUrls ? 'Show stream links' : 'Hide stream links'}
            aria-label={hideUrls ? 'Show stream links' : 'Hide stream links'}
          >
            {hideUrls ? <Icon name="visibility" className="text-[24px]" /> : <Icon name="visibility_off" className="text-[24px]" />}
          </button>
          {selectedEntries.size > 0 && (
            <button onClick={() => openAddModal(null)} className="md-btn btn btn-filled ml-1">
              <Icon name="add" className="text-[20px]" />
              Add {selectedEntries.size} to playlist
            </button>
          )}
        </div>
      </div>

      {/* Phones: the category and sort pickers, full width so they're easy to tap. */}
      {showPhoneFilters && (
        <div className="md:hidden shrink-0 flex gap-2 px-2 pb-2">
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            className="field flex-1 min-w-0 h-12 text-body-lg"
            aria-label="Category"
          >
            <option value="">All categories</option>
            {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>
          <select
            value={sortMode}
            onChange={e => setSortMode(e.target.value as 'name' | 'original')}
            className="field flex-1 min-w-0 h-12 text-body-lg"
            aria-label="Sort order"
          >
            <option value="name">A–Z</option>
            <option value="original">Original order</option>
          </select>
        </div>
      )}

      {downloadFailed && !neverDownloaded && source && (
        <DownloadErrorNotice source={source} full={false} is24Hour={is24Hour} onRetry={onRetry} isRetrying={isRetrying} onEdit={onEdit} />
      )}

      {/* List */}
      <div
        className="flex-1 overflow-y-auto relative"
        ref={listContainerRef}
        onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
      >
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full text-body-md text-on-surface-variant">
            <Icon name="progress_activity" className="text-[32px] animate-spin mb-4 text-primary" /><p>Loading channels…</p>
          </div>
        ) : neverDownloaded && source && channels.length === 0 ? (
          <DownloadErrorNotice source={source} full is24Hour={is24Hour} onRetry={onRetry} isRetrying={isRetrying} onEdit={onEdit} />
        ) : channels.length === 0 && loadError ? (
          <div className="flex flex-col items-center justify-center h-full text-body-md">
            <p className="text-error">{loadError}</p>
            <button onClick={() => setRetryTick(t => t + 1)} className="md-btn btn btn-text mt-2">
              Retry
            </button>
          </div>
        ) : channels.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-body-md text-on-surface-variant"><p>No channels found.</p></div>
        ) : (
          <div className="w-full">
            <div className="flex items-center border-y border-outline-variant bg-pane sticky top-0 z-20 h-10 text-label-md text-on-surface-variant">
              <div className="w-14 shrink-0 flex items-center justify-center pl-2">
                <button
                  onClick={toggleSelectAll}
                  className="md-btn icon-btn w-10 h-10"
                  aria-label={allVisibleSelected ? 'Deselect all' : 'Select all'}
                >
                  <Checkbox checked={allVisibleSelected} />
                </button>
              </div>
              <div className="w-16 max-md:w-14 shrink-0"></div>
              <span className="pl-3">Channel</span>
              {/* The header's channel count isn't shown on a phone, so it moves here. */}
              <span className="md:hidden ml-auto pr-4">{channels.length} channels</span>
            </div>

            <div style={{ height: channels.length * ROW, position: 'relative' }}>
              {channels.slice(startIdx, endIdx).map((channel, idx) => {
                const globalIndex = startIdx + idx;
                const top = globalIndex * ROW;
                const isSelected = selectedEntries.has(channel.id);
                const isHighlighted = channel.id === highlightedId;
                const rowBg = isHighlighted
                  ? 'bg-tertiary-container'
                  : isSelected
                    ? 'bg-secondary-container'
                    : 'hover:bg-on-surface/[0.06]';

                return (
                  <div
                    key={channel.id}
                    // Phones: tapping anywhere on the row selects it (the checkbox alone is a small target).
                    onClick={isPhone ? () => toggleSelect(channel) : undefined}
                    className={`absolute left-0 right-0 flex items-center border-b border-outline-variant/60 group transition-colors max-md:select-none max-md:cursor-pointer ${rowBg}`}
                    style={{ height: ROW, top }}
                  >
                    {/* Checkbox */}
                    <div className="w-14 shrink-0 flex items-center justify-center pl-2 max-md:pl-1">
                      <button
                        onClick={e => { e.stopPropagation(); toggleSelect(channel); }}
                        className="md-btn icon-btn w-10 h-10"
                        aria-label={isSelected ? 'Deselect channel' : 'Select channel'}
                      >
                        <Checkbox checked={isSelected} />
                      </button>
                    </div>

                    {/* Logo — falls back to initials if there's no URL or it fails to load */}
                    <div className="w-16 max-md:w-14 shrink-0 flex items-center justify-center">
                      <ChannelLogo
                        logo={channel.logo}
                        name={channel.name}
                        logoBgColor={logoBgColor}
                        className="w-12 h-8 rounded-md"
                      />
                    </div>

                    {/* Name + URL — flex-1 so it always claims space before the category tag. */}
                    <div className="flex-1 min-w-0 pl-3 pr-4 max-md:pr-2 flex flex-col justify-center overflow-hidden">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="text-label-lg max-md:text-[15px] text-on-surface truncate" title={channel.name}>
                          {channel.name || 'Unnamed'}
                        </p>
                        {channel.linkedPlaylistIds && (
                          <span
                            className="shrink-0 flex items-center text-primary"
                            title={`Kept in sync in: ${channel.linkedPlaylistIds.map(id => playlists.find(p => p.id === id)?.name).filter(Boolean).join(', ')}`}
                          >
                            <Icon name="link" className="text-[20px]" />
                          </span>
                        )}
                      </div>
                      {!hideUrls && (
                        <p className="text-body-sm font-mono text-on-surface-variant truncate" title={channel.url}>
                          {channel.url || '— no url —'}
                        </p>
                      )}
                    </div>

                    {/* Category tag — fixed width, never grows, so it can't steal space from the name. */}
                    <div className="flex-none w-44 min-w-0 pr-4 hidden md:flex items-center justify-end overflow-hidden ml-auto">
                      {channel.category && (
                        <span
                          className={`inline-flex items-center max-w-full h-[26px] px-2.5 rounded-lg border text-label-md text-on-surface-variant truncate ${isSelected ? 'border-outline' : 'border-outline-variant'}`}
                          title={channel.category}
                        >
                          <span className="truncate">{channel.category}</span>
                        </span>
                      )}
                    </div>

                    {/* Copy the stream link. It stays visible while showing its check. */}
                    <div className="w-10 shrink-0 flex items-center justify-center">
                      {channel.url && (
                        <button
                          onClick={e => { e.stopPropagation(); copyStreamLink(channel); }}
                          className={`md-btn icon-btn w-9 h-9 max-md:w-10 max-md:h-10 ${copiedEntryId === channel.id ? 'text-success' : reveal}`}
                          title={copiedEntryId === channel.id ? 'Copied' : 'Copy stream link'}
                          aria-label="Copy stream link"
                        >
                          {copiedEntryId === channel.id ? <Icon name="check" className="text-[20px]" /> : <Icon name="content_copy" className="text-[20px]" />}
                        </button>
                      )}
                    </div>

                    {/* Add to a playlist: a small tonal button. */}
                    <div className="w-14 shrink-0 flex items-center justify-center pr-2">
                      <button
                        onClick={e => { e.stopPropagation(); openAddModal(channel); }}
                        className={`md-btn icon-btn w-9 h-9 max-md:w-10 max-md:h-10 bg-secondary-container text-on-secondary-container ${reveal}`}
                        title="Add to playlist"
                        aria-label="Add to playlist"
                      >
                        <Icon name="add" className="text-[20px]" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Phones: while channels are selected, this bar covers the tab bar (like Android's own
          selection bars) with the one thing to do with them. */}
      {isPhone && selectedEntries.size > 0 && (
        <div className="md:hidden fixed inset-x-0 bottom-0 z-40 pb-safe bg-surface-container text-on-surface shadow-level-2">
          <div className="h-16 flex items-center gap-1 pl-1 pr-3">
            <button
              onClick={() => setSelectedEntries(new Map())}
              className="md-btn icon-btn w-12 h-12 text-on-surface"
              aria-label="Clear selection"
            >
              <Icon name="close" className="text-[24px]" />
            </button>
            <span className="flex-1 min-w-0 truncate text-title-md">
              {selectedEntries.size} selected
            </span>
            <button onClick={() => openAddModal(null)} className="md-btn btn btn-filled">
              <Icon name="add" className="text-[20px]" />
              Add to playlist
            </button>
          </div>
        </div>
      )}

      {modalChannels && (
        <AddToPlaylistModal
          channels={modalChannels}
          playlists={playlists}
          canSync={source?.type === 'xtream' || source?.type === 'playlist-url'}
          onClose={handleModalClose}
        />
      )}
    </div>
  );
}
