import React, { useState, useEffect, useRef } from 'react';
import { api, ChannelPoolEntry, ChannelPoolSource, usePlaylists, Playlist, channelPoolEvents, triggerRefresh, triggerChannelPoolRefresh, SyncFieldToggles as SyncFieldTogglesValue } from '../apiClient';
import { useStore, notifyError } from '../store';
import { Search, Loader2, Plus, Check, X, CheckSquare, Square, Link2 } from 'lucide-react';
import ChannelLogo from './ChannelLogo';
import { useDebouncedValue } from '../utils/useDebouncedValue';
import Dialog from './Dialog';
import SyncFieldToggles, { describeSyncFields, anySyncFieldOn } from './SyncFieldToggles';

interface ChannelPoolViewerProps {
  sourceId: string;
  // Undefined while the source list is still loading. Sync is only offered once it's known.
  sourceType?: ChannelPoolSource['type'];
}

function AddToPlaylistModal({
  channels,
  playlists,
  accentColor,
  canSync,
  onClose,
}: {
  channels: ChannelPoolEntry[];
  playlists: Playlist[];
  accentColor: string;
  // False for uploaded-file sources: the file never changes, so there'd be nothing to sync.
  canSync: boolean;
  onClose: () => void;
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
          category: categoryOverride.trim() || c.category,
          // Without fields (defaults not loaded yet), the server uses the saved defaults.
          ...(linking ? { link: { sourceId: c.sourceId, poolEntryId: c.id, ...(syncFields ? { fields: syncFields } : {}) } } : {}),
        }))
      );
      triggerRefresh();
      // Refetches the source list so the new link icons show up on these channels.
      if (linking) triggerChannelPoolRefresh();
      setDone(true);
      setTimeout(onClose, 900);
    } catch (e) {
      console.error(e);
      notifyError(e, 'Failed to add channels.');
      setAdding(false);
    }
  };

  return (
    <Dialog onClose={onClose}>
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 dark:border-white/10">
          <h2 className="text-base font-medium text-gray-900 dark:text-white">
            Add {channels.length} channel{channels.length !== 1 ? 's' : ''} to playlist
          </h2>
          <button onClick={onClose} className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-4 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">Playlist</label>
            <select
              value={selectedPlaylist}
              onChange={e => setSelectedPlaylist(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#333] text-gray-900 dark:text-white focus:outline-none"
            >
              {playlists.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
              {playlists.length === 0 && <option value="">No playlists available</option>}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
              Category override <span className="normal-case font-normal">(optional)</span>
            </label>
            <select
              value={categoryOverride}
              onChange={e => setCategoryOverride(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#333] text-gray-900 dark:text-white focus:outline-none"
            >
              <option value="">Keep original categories</option>
              {playlists.find(p => p.id === selectedPlaylist)?.categories?.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          {canSync && (
            <div className="rounded border border-gray-200 dark:border-white/10 p-3 flex flex-col gap-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={keepInSync}
                  onChange={e => setKeepInSync(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
                  style={{ accentColor }}
                />
                <span>
                  <span className="block text-sm text-gray-900 dark:text-white">Keep in sync with source</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    When the provider changes {channels.length === 1 ? 'this channel' : 'these channels'}, your playlist updates too.
                  </span>
                </span>
              </label>
              {keepInSync && (
                <>
                  <select
                    value={syncMode}
                    onChange={e => setSyncMode(e.target.value as 'default' | 'custom')}
                    className="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#333] text-gray-900 dark:text-white focus:outline-none"
                  >
                    <option value="default">Default settings{defaultFields ? ` (${describeSyncFields(defaultFields)})` : ''}</option>
                    <option value="custom">Custom settings</option>
                  </select>
                  {syncMode === 'custom' && (
                    <SyncFieldToggles value={customFields} onChange={setCustomFields} accentColor={accentColor} />
                  )}
                  {nothingToSync && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
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

        <div className="flex justify-end gap-1 px-4 pb-4">
          <button
            onClick={onClose}
            disabled={adding}
            className="md-btn h-9 px-4 rounded text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={adding || !selectedPlaylist || done || nothingToSync}
            className="md-btn h-9 px-4 rounded text-xs font-medium uppercase tracking-wider text-white disabled:opacity-50 flex items-center gap-2"
            style={{ backgroundColor: accentColor }}
          >
            {done ? 'Added!' : adding ? 'Adding...' : 'Add'}
          </button>
        </div>
    </Dialog>
  );
}

const ROW = 56;

export default function ChannelPoolViewer({ sourceId, sourceType }: ChannelPoolViewerProps) {
  const { accentColor, logoBgColor, hideUrls, scrollTarget, setScrollTarget } = useStore();
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

  const handleModalClose = () => {
    if (modalChannels) {
      setAddedMessage('Added ' + modalChannels.length + ' channel(s)');
      setTimeout(() => setAddedMessage(null), 3000);
      setSelectedEntries(new Map());
    }
    setModalChannels(null);
  };

  if (!sourceId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 dark:bg-[#121212] amoled:dark:bg-black text-gray-500 dark:text-gray-400">
        <p>No Channel Pool source selected.</p>
      </div>
    );
  }

  const startIdx = Math.max(0, Math.floor(scrollTop / ROW) - 5);
  const endIdx = Math.min(channels.length, Math.ceil((scrollTop + containerHeight) / ROW) + 10);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#1e1e1e] amoled:dark:bg-black overflow-hidden relative">
      {/* Toolbar */}
      <div className="shrink-0 h-12 flex items-center justify-between px-4 border-b border-gray-200 dark:border-white/10 z-20 bg-white dark:bg-[#1e1e1e] amoled:dark:bg-black gap-4">
        <div className="flex items-center gap-4 flex-1">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search channels..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-transparent text-gray-900 dark:text-white focus:outline-none"
              onFocus={e => (e.target.style.borderColor = accentColor)}
              onBlur={e => (e.target.style.borderColor = '')}
            />
          </div>

          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-transparent text-gray-900 dark:text-white focus:outline-none max-w-xs"
          >
            <option value="">All Categories</option>
            {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>

          <select
            value={sortMode}
            onChange={e => setSortMode(e.target.value as 'name' | 'original')}
            title="Sort order"
            className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-transparent text-gray-900 dark:text-white focus:outline-none"
          >
            <option value="name">Sort: A–Z</option>
            <option value="original">Sort: Original order</option>
          </select>

          <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">{channels.length} channels</span>
        </div>

        <div className="flex items-center gap-2">
          {addedMessage && (
            <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <Check className="h-3 w-3" />{addedMessage}
            </span>
          )}
          {selectedEntries.size > 0 && (
            <button
              onClick={() => openAddModal(null)}
              className="md-btn flex items-center gap-2 h-9 px-3 rounded text-xs font-medium uppercase tracking-wider text-white"
              style={{ backgroundColor: accentColor }}
            >
              <Plus className="h-4 w-4" />
              Add Selected ({selectedEntries.size})
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div
        className="flex-1 overflow-y-auto relative"
        ref={listContainerRef}
        onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
      >
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
            <Loader2 className="h-8 w-8 animate-spin mb-4" style={{ color: accentColor }} /><p>Loading channels...</p>
          </div>
        ) : channels.length === 0 && loadError ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
            <p className="text-red-500 dark:text-red-400">{loadError}</p>
            <button onClick={() => setRetryTick(t => t + 1)} className="md-btn mt-2 text-sm font-medium underline" style={{ color: accentColor }}>
              Retry
            </button>
          </div>
        ) : channels.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400"><p>No channels found.</p></div>
        ) : (
          <div className="w-full">
            <div className="flex items-center border-b border-gray-200 dark:border-white/5 bg-gray-50 dark:bg-[#1a1a1a] amoled:dark:bg-[#0a0a0a] sticky top-0 z-20 h-10">
              <div className="w-12 shrink-0 flex items-center justify-center pl-2">
                <button
                  onClick={toggleSelectAll}
                  className="md-btn p-1 rounded-full text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-200"
                  style={allVisibleSelected ? { color: accentColor } : undefined}
                >
                  {allVisibleSelected
                    ? <CheckSquare className="h-4 w-4" />
                    : <Square className="h-4 w-4" />}
                </button>
              </div>
              <div className="w-14 mr-3 shrink-0"></div>
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Channel</span>
            </div>

            <div style={{ height: channels.length * ROW, position: 'relative' }}>
              {channels.slice(startIdx, endIdx).map((channel, idx) => {
                const globalIndex = startIdx + idx;
                const top = globalIndex * ROW;
                const isEven = globalIndex % 2 === 0;
                const isSelected = selectedEntries.has(channel.id);
                const isHighlighted = channel.id === highlightedId;
                const rowBg = isHighlighted
                  ? 'bg-amber-50 dark:bg-amber-900/20 amoled:dark:bg-amber-900/25'
                  : isEven
                    ? 'bg-white dark:bg-[#1e1e1e] amoled:dark:bg-black hover:bg-gray-50 dark:hover:bg-white/3 amoled:dark:hover:bg-white/4'
                    : 'bg-gray-50/70 dark:bg-[#222222] amoled:dark:bg-[#0d0d0d] hover:bg-gray-100/70 dark:hover:bg-white/5 amoled:dark:hover:bg-white/5';

                return (
                  <div
                    key={channel.id}
                    className={`absolute left-0 right-0 flex items-center border-b border-gray-100 dark:border-white/6 group transition-colors ${rowBg}`}
                    style={{ height: ROW, top, ...(isSelected && !isHighlighted ? { backgroundColor: `${accentColor}18` } : {}) }}
                  >
                    {/* Checkbox */}
                    <div className="w-12 shrink-0 flex items-center justify-center pl-2">
                      <button
                        onClick={() => toggleSelect(channel)}
                        className="md-btn p-1 rounded-full text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-200"
                        style={isSelected ? { color: accentColor } : undefined}
                      >
                        {isSelected
                          ? <CheckSquare className="h-4 w-4" />
                          : <Square className="h-4 w-4" />}
                      </button>
                    </div>

                    {/* Logo — falls back to initials if there's no URL or it fails to load */}
                    <div className="w-14 mr-3 shrink-0 flex items-center justify-center">
                      <ChannelLogo
                        logo={channel.logo}
                        name={channel.name}
                        logoBgColor={logoBgColor}
                        className="w-10 h-7 rounded border border-gray-200 dark:border-white/10"
                      />
                    </div>

                    {/* Name + URL — flex-1 so it always claims space before the
                        category pill; previously flex-initial let the pill's
                        flex-auto (grow) outcompete it and collapse the name to
                        zero width on narrower screens. */}
                    <div className="flex-1 min-w-0 pr-4 flex flex-col justify-center gap-0.5 overflow-hidden">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className={`text-sm font-medium truncate ${isSelected ? '' : 'text-gray-900 dark:text-white'}`} style={isSelected ? { color: accentColor } : undefined} title={channel.name}>
                          {channel.name || 'Unnamed'}
                        </p>
                        {channel.linkedPlaylistIds && (
                          <span
                            className="shrink-0 flex items-center"
                            style={{ color: accentColor }}
                            title={`Kept in sync in: ${channel.linkedPlaylistIds.map(id => playlists.find(p => p.id === id)?.name).filter(Boolean).join(', ')}`}
                          >
                            <Link2 className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </div>
                      {!hideUrls && (
                        <p className="text-[11px] font-mono text-gray-400 dark:text-gray-500 truncate" title={channel.url}>
                          {channel.url || '— no url —'}
                        </p>
                      )}
                    </div>

                    {/* Category pill (styled like TVG ID in Playlists) — fixed
                        width, never grows, so it can't steal space from the name. */}
                    <div className="flex-none w-40 min-w-0 pr-4 hidden md:flex items-center justify-end overflow-hidden ml-auto">
                      {channel.category && (
                        <span 
                          className="inline-flex items-center max-w-full gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium truncate"
                          style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
                          title={channel.category}
                        >
                          {channel.category}
                        </span>
                      )}
                    </div>

                    {/* Add action */}
                    <div className="w-12 shrink-0 flex items-center justify-center pr-2">
                      <button
                        onClick={() => openAddModal(channel)}
                        className="md-btn p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity bg-white border border-gray-200 shadow-sm dark:bg-[#2a2a2a] dark:border-white/10"
                        title="Add to playlist"
                        style={{ color: accentColor }}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {modalChannels && (
        <AddToPlaylistModal
          channels={modalChannels}
          playlists={playlists}
          accentColor={accentColor}
          canSync={sourceType === 'xtream' || sourceType === 'playlist-url'}
          onClose={handleModalClose}
        />
      )}
    </div>
  );
}
