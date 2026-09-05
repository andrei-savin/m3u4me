import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlaylists, useEpgSources, useChannelPoolSources, api, triggerRefresh, triggerEpgRefresh, triggerChannelPoolRefresh, SearchResult } from '../apiClient';
import { useStore, accentAlpha, notifyError, notifyInfo } from '../store';
import { Plus, Settings, FileAudio, Menu, Trash2, Eye, EyeOff, Keyboard, Search, ArrowUpCircle, Radio, RefreshCw, Clock, Layers, Pencil, AlertTriangle } from 'lucide-react';
import PlaylistEditor from './PlaylistEditor';
import NewPlaylistDialog from './NewPlaylistDialog';
import CategoryList from './CategoryList';
import Spotlight from './Spotlight';
import { useVersionInfo } from './AppInfo';
import { Logo } from './Logo';
import EpgViewer from './EpgViewer';
import AddEpgSourceDialog from './AddEpgSourceDialog';
import AssignTvgIdDialog from './AssignTvgIdDialog';
import AddChannelPoolSourceDialog from './AddChannelPoolSourceDialog';
import ChannelPoolViewer from './ChannelPoolViewer';
import ChannelPoolUpdateLog from './ChannelPoolUpdateLog';
import Toast from './Toast';

export default function Dashboard({ activeView }: { activeView: 'playlists' | 'channels' | 'epg' }) {
  const navigate = useNavigate();
  const { playlists, loading, error: playlistsError, refetch: refetchPlaylists } = usePlaylists();
  const { sources: epgSources, loading: epgLoading, error: epgSourcesError, refetch: refetchEpgSources } = useEpgSources();
  const { sources: channelPoolSources, loading: channelPoolLoading, error: channelPoolSourcesError, refetch: refetchChannelPoolSources } = useChannelPoolSources();
  const {
    activePlaylistId, setActivePlaylistId,
    activeEpgSourceId, setActiveEpgSourceId,
    activeChannelPoolSourceId, setActiveChannelPoolSourceId,
    isSidebarOpen, setSidebarOpen,
    accentColor,
    hideUrls, setHideUrls,
    setUndoEntry,
    setActiveCategory,
    setScrollTarget,
  } = useStore();
  const [isCreating, setIsCreating] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const versionInfo = useVersionInfo();
  const mod = /mac/i.test(navigator.platform) ? 'Cmd' : 'Ctrl';

  // Sliding nav-tab indicator: measures the active tab button and animates the
  // underline to it, instead of each tab mounting/unmounting its own static bar.
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [tabIndicator, setTabIndicator] = useState({ left: 0, width: 0 });
  useLayoutEffect(() => {
    const updateIndicator = () => {
      const el = tabRefs.current[activeView];
      if (el) setTabIndicator({ left: el.offsetLeft + 12, width: el.offsetWidth - 24 });
    };
    updateIndicator();
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [activeView]);

  // EPG-specific state
  const [isCreatingEpg, setIsCreatingEpg] = useState(false);
  const [epgSourceToEdit, setEpgSourceToEdit] = useState<any>(null);
  const [deleteEpgSourceId, setDeleteEpgSourceId] = useState<string | null>(null);
  const [renamingEpgId, setRenamingEpgId] = useState<string | null>(null);
  const [renameEpgValue, setRenameEpgValue] = useState('');
  const [refreshingEpgId, setRefreshingEpgId] = useState<string | null>(null);
  // Assign dialog state
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignEpgChannelId, setAssignEpgChannelId] = useState('');
  const [assignEpgDisplayName, setAssignEpgDisplayName] = useState('');

  // Channel Pool state
  const [isCreatingChannelPool, setIsCreatingChannelPool] = useState(false);
  const [poolSourceToEdit, setPoolSourceToEdit] = useState<any>(null);
  const [deleteChannelPoolSourceId, setDeleteChannelPoolSourceId] = useState<string | null>(null);
  const [renamingChannelPoolId, setRenamingChannelPoolId] = useState<string | null>(null);
  const [renameChannelPoolValue, setRenameChannelPoolValue] = useState('');
  const [refreshingChannelPoolId, setRefreshingChannelPoolId] = useState<string | null>(null);

  const handleSpotlightNavigate = (result: SearchResult) => {
    if (result.kind === 'playlist') {
      navigate('/playlists');
      setActivePlaylistId(result.containerId);
      setActiveCategory(result.category);
    } else if (result.kind === 'channelPool') {
      navigate('/sources');
      setActiveChannelPoolSourceId(result.containerId);
    } else {
      navigate('/epg');
      setActiveEpgSourceId(result.containerId);
    }
    // The matching view (PlaylistEditor / ChannelPoolViewer / EpgViewer) picks this up
    // once its list is ready, clears any filter/pagination that would hide the target,
    // then scrolls to and highlights it.
    setScrollTarget({ kind: result.kind, id: result.id });
  };
  const [deletePlaylistId, setDeletePlaylistId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const confirmRenameEpgSource = async () => {
    const newName = renameEpgValue.trim();
    const id = renamingEpgId;
    setRenamingEpgId(null);
    if (!id || !newName) return;
    try {
      await api.updateEpgSource(id, { name: newName });
      triggerEpgRefresh();
    } catch (e) { console.error(e); notifyError(e); }
  };

  const handleRefreshEpgSource = async (id: string) => {
    setRefreshingEpgId(id);
    try {
      await api.refreshEpgSource(id);
      triggerEpgRefresh();
    } catch (e) { console.error(e); notifyError(e); }
    finally { setRefreshingEpgId(null); }
  };

  const handleAssignChannel = (epgChannelId: string, epgDisplayName: string) => {
    setAssignEpgChannelId(epgChannelId);
    setAssignEpgDisplayName(epgDisplayName);
    setAssignDialogOpen(true);
  };

  const confirmRenameChannelPoolSource = async () => {
    const newName = renameChannelPoolValue.trim();
    const id = renamingChannelPoolId;
    setRenamingChannelPoolId(null);
    if (!id || !newName) return;
    try {
      await api.updateChannelPoolSource(id, { name: newName });
      triggerChannelPoolRefresh();
    } catch (e) { console.error(e); notifyError(e); }
  };

  const handleRefreshChannelPoolSource = async (id: string) => {
    setRefreshingChannelPoolId(id);
    try {
      const result = await api.refreshChannelPoolSource(id);
      triggerChannelPoolRefresh();
      if (!result.changed) notifyInfo('No changes found — channel list is already up to date.');
    } catch (e) { console.error(e); notifyError(e); }
    finally { setRefreshingChannelPoolId(null); }
  };
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const sidebarResizing = useRef<{ startX: number; startW: number } | null>(null);
  const startSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    if (sidebarRef.current) sidebarRef.current.style.transition = 'none';
    sidebarResizing.current = { startX: e.clientX, startW: sidebarWidth };
    const onMove = (ev: MouseEvent) => {
      if (!sidebarResizing.current) return;
      const w = Math.max(160, Math.min(480, sidebarResizing.current.startW + ev.clientX - sidebarResizing.current.startX));
      setSidebarWidth(w);
    };
    const onUp = () => {
      if (sidebarRef.current) sidebarRef.current.style.transition = '';
      sidebarResizing.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const confirmRenamePlaylist = async () => {
    const newName = renameValue.trim();
    const id = renamingId;
    setRenamingId(null);
    if (!id || !newName) return;
    try {
      await api.updatePlaylist(id, { name: newName });
      triggerRefresh();
    } catch (e) { console.error(e); notifyError(e); }
  };

  const handlePlaylistCreated = (playlistId: string) => {
    setIsCreating(false);
    triggerRefresh();
    setActivePlaylistId(playlistId);
  };

  return (
    <div className="md-page-in flex flex-col h-screen overflow-hidden bg-gray-100 dark:bg-[#121212] amoled:dark:bg-black font-sans">

      {/* ── Top App Bar ─────────────────────────────────────────────────── */}
      {/* ── Update Banner ───────────────────────────────────────────────── */}
      {versionInfo.updateAvailable && !updateDismissed && versionInfo.releaseUrl && (
        <div className="shrink-0 z-30 flex items-center justify-center gap-3 px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: accentColor }}>
          <ArrowUpCircle className="h-4 w-4 shrink-0" />
          <span>A new version of m3u4me is available: <strong>v{versionInfo.latest}</strong></span>
          <a
            href={versionInfo.releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:opacity-80 transition-opacity"
          >
            View release
          </a>
          <button onClick={() => setUpdateDismissed(true)} className="ml-auto p-0.5 rounded hover:bg-white/20 transition-colors" aria-label="Dismiss">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      <nav className="h-16 shrink-0 z-50 bg-white dark:bg-[#1e1e1e] amoled:dark:bg-[#0a0a0a] elev-4 grid grid-cols-[1fr_auto_1fr] items-center px-2 gap-1 relative">
        {/* Left group and right group are both `1fr` tracks, so the grid keeps
            them equal width and the middle (tabs) track dead-centered on the
            bar's full width — regardless of which right-side buttons the
            current tab shows. A plain flex-1 sandwiched between the two used
            to recenter itself in whatever's left over, so the tabs visibly
            slid sideways ("waddled") each time a tab with a different set of
            right-side buttons was selected. */}
        <div className="flex items-center min-w-0">
          <button
            onClick={() => setSidebarOpen(!isSidebarOpen)}
            className="md-btn p-2 rounded-full text-gray-600 dark:text-gray-300"
            aria-label="Toggle navigation drawer"
          >
            <Menu className="h-6 w-6" />
          </button>

          <div className="flex items-center ml-2 shrink-0">
            <Logo className="h-6 w-auto text-gray-900 dark:text-white shrink-0" />
          </div>
        </div>

        {/* ── Centered navigation tabs ──────────────────────────────── */}
        <div className="relative flex items-center gap-1 justify-self-center">
          <button
            ref={el => { tabRefs.current.playlists = el; }}
            onClick={() => navigate('/playlists')}
            className={`md-btn relative h-10 px-5 rounded-lg text-sm font-medium transition-colors ${
              activeView === 'playlists'
                ? 'text-gray-900 dark:text-white'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            My Playlists
          </button>
          <button
            ref={el => { tabRefs.current.channels = el; }}
            onClick={() => navigate('/sources')}
            className={`md-btn relative h-10 px-5 rounded-lg text-sm font-medium transition-colors ${
              activeView === 'channels'
                ? 'text-gray-900 dark:text-white'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            Sources
          </button>
          <button
            ref={el => { tabRefs.current.epg = el; }}
            onClick={() => navigate('/epg')}
            className={`md-btn relative h-10 px-5 rounded-lg text-sm font-medium transition-colors ${
              activeView === 'epg'
                ? 'text-gray-900 dark:text-white'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            EPG
          </button>
          {/* Single indicator that slides/resizes to the active tab instead of each tab
              popping its own underline in and out. */}
          <div
            className="absolute bottom-0 h-0.5 rounded-full transition-[left,width] duration-[250ms] ease-[var(--md-standard)]"
            style={{ backgroundColor: accentColor, left: tabIndicator.left, width: tabIndicator.width }}
          />
        </div>

        {/* ── Right side buttons ──────────────────────────────────── */}
        <div className="flex items-center gap-1 justify-self-end min-w-0">
        {/* Shown on every tab — Spotlight indexes playlists, sources, and EPG alike. */}
        <button
          onClick={() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true })); }}
          className="md-btn hidden sm:flex items-center gap-2 h-9 px-3 lg:px-4 rounded text-xs font-medium border border-gray-300 dark:border-white/15 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          title={`Search (${mod}+K)`}
        >
          <Search className="h-4 w-4" />
          {/* Text/shortcut hint collapses first at tablet widths so this button
              doesn't compete for space with the centered nav tabs — the icon
              plus title tooltip still make it discoverable and usable. */}
          <span className="hidden lg:inline text-gray-400 dark:text-gray-500">Search…</span>
          <kbd className="hidden lg:inline ml-1 font-mono text-[10px] text-gray-400 dark:text-gray-500">{mod}+K</kbd>
        </button>

        {(activeView === 'playlists' || activeView === 'channels') && (
          <button
            onClick={() => setHideUrls(!hideUrls)}
            className="md-btn hidden sm:flex items-center gap-2 h-9 px-3 lg:px-4 rounded text-xs font-medium uppercase tracking-wider border border-gray-300 dark:border-white/15 text-gray-600 dark:text-gray-300"
            title={hideUrls ? 'Show stream URLs' : 'Hide stream URLs'}
          >
            {hideUrls ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            <span className="hidden lg:inline">{hideUrls ? 'Show URLs' : 'Hide URLs'}</span>
          </button>
        )}

        {/* Keyboard shortcuts */}
        <button
          onClick={() => setShowShortcuts(true)}
          className="md-btn p-2 rounded-full text-gray-600 dark:text-gray-400"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
        >
          <Keyboard className="h-5 w-5" />
        </button>


        {/* Settings */}
        <button
          onClick={() => navigate('/settings')}
          className="md-btn p-2 rounded-full text-gray-600 dark:text-gray-400 ml-1"
          aria-label="Settings"
        >
          <Settings className="h-5 w-5" />
        </button>
        </div>
      </nav>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Navigation Drawer ────────────────────────────────────────────── */}
        {/* The outer box's width does the sliding — it's always overflow-hidden, so it clips
            rather than reflows. The inner content below stays a fixed sidebarWidth the whole
            time, so labels never re-wrap or re-truncate mid-animation; they just get covered
            or uncovered as the box widens, and cross-fade in/out a bit faster than the slide
            so nothing looks squeezed into a paper-thin sliver right at the edges. */}
        <div
          ref={sidebarRef}
          className={`${isSidebarOpen ? '' : 'w-0'} shrink-0 overflow-hidden bg-white dark:bg-[#1e1e1e] amoled:dark:bg-black elev-1 z-40 transition-[width] duration-[240ms] ease-[var(--md-standard)] relative`}
          style={isSidebarOpen ? { width: sidebarWidth } : undefined}
        >
          <div
            className={`h-full flex flex-col transition-opacity duration-150 ease-[var(--md-standard)] ${isSidebarOpen ? 'opacity-100' : 'opacity-0'}`}
            style={{ width: sidebarWidth }}
          >
          <div className="flex-1 overflow-y-auto py-2">

            {activeView === 'playlists' ? (
              <>
                {/* Section: Playlists */}
                <div className="flex items-center px-4 pt-3 pb-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-gray-500 dark:text-gray-400 flex-1">
                    Playlists
                  </p>
                  <button
                    onClick={() => setIsCreating(true)}
                    className="md-btn p-1 rounded-full text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                    title="New playlist"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>

                <nav className="space-y-0.5 px-2">
                  {playlists.map((pl) => {
                    const isActive = activePlaylistId === pl.id;
                    return (
                      <div key={pl.id} className="relative group flex items-center rounded hover:bg-gray-100 dark:hover:bg-white/6" style={isActive ? { backgroundColor: accentAlpha(accentColor, '18') } : undefined}>
                        {isActive && (
                          <div
                            className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r"
                            style={{ backgroundColor: accentColor }}
                          />
                        )}
                        {renamingId === pl.id ? (
                          <div className="flex-1 flex items-center h-12 pl-4 pr-10 gap-3">
                            <svg className="w-4 h-4 shrink-0 opacity-60 text-gray-700 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                            </svg>
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={e => setRenameValue(e.target.value)}
                              onBlur={confirmRenamePlaylist}
                              onKeyDown={e => {
                                if (e.key === 'Enter') confirmRenamePlaylist();
                                if (e.key === 'Escape') setRenamingId(null);
                              }}
                              className="flex-1 min-w-0 text-sm font-medium bg-transparent border-b-2 focus:outline-none text-gray-900 dark:text-white px-0.5"
                              style={{ borderColor: accentColor }}
                            />
                          </div>
                        ) : (
                          <button
                            onClick={() => setActivePlaylistId(pl.id)}
                            onDoubleClick={() => { setRenamingId(pl.id); setRenameValue(pl.name); }}
                            className="flex-1 flex items-center h-12 pl-4 pr-10 gap-3 rounded text-sm font-medium text-left truncate transition-colors text-gray-700 dark:text-gray-300"
                            style={isActive ? { color: accentColor } : undefined}
                          >
                            <svg className="w-4 h-4 shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                            </svg>
                            <span className="truncate">{pl.name}</span>
                          </button>
                        )}
                        <button
                          onClick={() => setDeletePlaylistId(pl.id)}
                          className="md-btn absolute right-1 p-1.5 rounded-full text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-all"
                          title="Delete playlist"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  {playlists.length === 0 && !loading && (
                    playlistsError ? (
                      <div className="px-2 py-4 text-center">
                        <p className="text-sm text-red-500 dark:text-red-400">{playlistsError}</p>
                        <button onClick={() => refetchPlaylists()} className="md-btn mt-1 text-xs font-medium underline" style={{ color: accentColor }}>
                          Retry
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 dark:text-gray-500 px-2 py-4 text-center">
                        No playlists yet
                      </p>
                    )
                  )}
                </nav>

                {/* Section: Categories */}
                {activePlaylistId && <CategoryList playlistId={activePlaylistId} />}
              </>
            ) : activeView === 'channels' ? (
              <>
                {/* Section: Channel Pool Sources */}
                <div className="flex items-center px-4 pt-3 pb-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-gray-500 dark:text-gray-400 flex-1">
                    Channel Sources
                  </p>
                  <button
                    onClick={() => { setPoolSourceToEdit(null); setIsCreatingChannelPool(true); }}
                    className="md-btn p-1 rounded-full text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                    title="Add channel source"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>

                <nav className="space-y-0.5 px-2">
                  {channelPoolSources.map((src) => {
                    const isActive = activeChannelPoolSourceId === src.id;
                    const isFileType = src.type === 'playlist-file';
                    return (
                      <div key={src.id} className="relative group flex items-center rounded hover:bg-gray-100 dark:hover:bg-white/6" style={isActive ? { backgroundColor: accentAlpha(accentColor, '18') } : undefined}>
                        {isActive && (
                          <div
                            className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r"
                            style={{ backgroundColor: accentColor }}
                          />
                        )}
                        {renamingChannelPoolId === src.id ? (
                          <div className="flex-1 flex items-center h-12 pl-4 pr-10 gap-3">
                            <Layers className="w-4 h-4 shrink-0 opacity-60 text-gray-700 dark:text-gray-300" />
                            <input
                              autoFocus
                              value={renameChannelPoolValue}
                              onChange={e => setRenameChannelPoolValue(e.target.value)}
                              onBlur={confirmRenameChannelPoolSource}
                              onKeyDown={e => {
                                if (e.key === 'Enter') confirmRenameChannelPoolSource();
                                if (e.key === 'Escape') setRenamingChannelPoolId(null);
                              }}
                              className="flex-1 min-w-0 text-sm font-medium bg-transparent border-b-2 focus:outline-none text-gray-900 dark:text-white px-0.5"
                              style={{ borderColor: accentColor }}
                            />
                          </div>
                        ) : (
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => setActiveChannelPoolSourceId(src.id)}
                            onDoubleClick={() => { setRenamingChannelPoolId(src.id); setRenameChannelPoolValue(src.name); }}
                            onKeyDown={(e) => {
                              if (e.target !== e.currentTarget) return;
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setActiveChannelPoolSourceId(src.id);
                              }
                            }}
                            className="flex-1 flex flex-col justify-center h-14 pl-4 pr-20 gap-0 rounded text-sm font-medium text-left truncate transition-colors text-gray-700 dark:text-gray-300 cursor-pointer"
                            style={isActive ? { color: accentColor } : undefined}
                          >
                            <span className="flex items-center gap-2 truncate">
                              <Layers className="w-3.5 h-3.5 shrink-0 opacity-60" />
                              <span className="truncate">{src.name}</span>
                            </span>
                            <span className="flex items-center gap-1.5 text-[10px] text-gray-400 dark:text-gray-500 ml-5.5 font-normal">
                              <span>{src.channelCount} ch</span>
                              {!isFileType && (
                                <>
                                  <span>·</span>
                                  <span className="flex items-center gap-0.5" title="Refresh interval">
                                    <Clock className="w-2.5 h-2.5" />
                                    {src.refreshIntervalHours}h
                                  </span>
                                </>
                              )}
                              {src.lastFetchError && (
                                <span
                                  className="flex items-center gap-0.5 text-red-500 dark:text-red-400"
                                  title={`Last refresh failed: ${src.lastFetchError}`}
                                >
                                  <AlertTriangle className="w-2.5 h-2.5" />
                                  Refresh failed
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                        <div className="absolute right-1 flex items-center gap-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); setPoolSourceToEdit(src); setIsCreatingChannelPool(true); }}
                            className="md-btn p-1.5 rounded-full text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 transition-all"
                            title="Edit channel source"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          {!isFileType && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRefreshChannelPoolSource(src.id); }}
                              className={`md-btn p-1.5 rounded-full text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 transition-all ${refreshingChannelPoolId === src.id ? 'animate-spin' : ''}`}
                              title="Refresh channel data"
                              disabled={refreshingChannelPoolId === src.id}
                            >
                              <RefreshCw className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={() => setDeleteChannelPoolSourceId(src.id)}
                            className="md-btn p-1.5 rounded-full text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-all"
                            title="Delete channel source"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {channelPoolSources.length === 0 && !channelPoolLoading && (
                    channelPoolSourcesError ? (
                      <div className="px-2 py-4 text-center">
                        <p className="text-sm text-red-500 dark:text-red-400">{channelPoolSourcesError}</p>
                        <button onClick={() => refetchChannelPoolSources()} className="md-btn mt-1 text-xs font-medium underline" style={{ color: accentColor }}>
                          Retry
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 dark:text-gray-500 px-2 py-4 text-center">
                        No channel sources yet
                      </p>
                    )
                  )}
                </nav>
              </>
            ) : (
              <>
                {/* Section: EPG Sources */}
                <div className="flex items-center px-4 pt-3 pb-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-gray-500 dark:text-gray-400 flex-1">
                    EPG Sources
                  </p>
                  <button
                    onClick={() => { setEpgSourceToEdit(null); setIsCreatingEpg(true); }}
                    className="md-btn p-1 rounded-full text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                    title="Add EPG source"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>

                <nav className="space-y-0.5 px-2">
                  {epgSources.map((src) => {
                    const isActive = activeEpgSourceId === src.id;
                    return (
                      <div key={src.id} className="relative group flex items-center rounded hover:bg-gray-100 dark:hover:bg-white/6" style={isActive ? { backgroundColor: accentAlpha(accentColor, '18') } : undefined}>
                        {isActive && (
                          <div
                            className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r"
                            style={{ backgroundColor: accentColor }}
                          />
                        )}
                        {renamingEpgId === src.id ? (
                          <div className="flex-1 flex items-center h-12 pl-4 pr-10 gap-3">
                            <Radio className="w-4 h-4 shrink-0 opacity-60 text-gray-700 dark:text-gray-300" />
                            <input
                              autoFocus
                              value={renameEpgValue}
                              onChange={e => setRenameEpgValue(e.target.value)}
                              onBlur={confirmRenameEpgSource}
                              onKeyDown={e => {
                                if (e.key === 'Enter') confirmRenameEpgSource();
                                if (e.key === 'Escape') setRenamingEpgId(null);
                              }}
                              className="flex-1 min-w-0 text-sm font-medium bg-transparent border-b-2 focus:outline-none text-gray-900 dark:text-white px-0.5"
                              style={{ borderColor: accentColor }}
                            />
                          </div>
                        ) : (
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => setActiveEpgSourceId(src.id)}
                            onDoubleClick={() => { setRenamingEpgId(src.id); setRenameEpgValue(src.name); }}
                            onKeyDown={(e) => {
                              if (e.target !== e.currentTarget) return;
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setActiveEpgSourceId(src.id);
                              }
                            }}
                            className="flex-1 flex flex-col justify-center h-14 pl-4 pr-20 gap-0 rounded text-sm font-medium text-left truncate transition-colors text-gray-700 dark:text-gray-300 cursor-pointer"
                            style={isActive ? { color: accentColor } : undefined}
                          >
                            <span className="flex items-center gap-2 truncate">
                              <Radio className="w-3.5 h-3.5 shrink-0 opacity-60" />
                              <span className="truncate">{src.name}</span>
                            </span>
                            <span className="flex items-center gap-1.5 text-[10px] text-gray-400 dark:text-gray-500 ml-5.5 font-normal">
                              <span>{src.channelCount} ch</span>
                              <span>·</span>
                              <span className="flex items-center gap-0.5" title="Refresh interval">
                                <Clock className="w-2.5 h-2.5" />
                                {src.refreshIntervalHours}h
                              </span>
                              {src.lastFetchError && (
                                <span
                                  className="flex items-center gap-0.5 text-red-500 dark:text-red-400"
                                  title={`Last refresh failed: ${src.lastFetchError}`}
                                >
                                  <AlertTriangle className="w-2.5 h-2.5" />
                                  Refresh failed
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                        <div className="absolute right-1 flex items-center gap-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); setEpgSourceToEdit(src); setIsCreatingEpg(true); }}
                            className="md-btn p-1.5 rounded-full text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 transition-all"
                            title="Edit EPG source"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRefreshEpgSource(src.id); }}
                            className={`md-btn p-1.5 rounded-full text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 transition-all ${refreshingEpgId === src.id ? 'animate-spin' : ''}`}
                            title="Refresh EPG data"
                            disabled={refreshingEpgId === src.id}
                          >
                            <RefreshCw className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => setDeleteEpgSourceId(src.id)}
                            className="md-btn p-1.5 rounded-full text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-all"
                            title="Delete EPG source"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {epgSources.length === 0 && !epgLoading && (
                    epgSourcesError ? (
                      <div className="px-2 py-4 text-center">
                        <p className="text-sm text-red-500 dark:text-red-400">{epgSourcesError}</p>
                        <button onClick={() => refetchEpgSources()} className="md-btn mt-1 text-xs font-medium underline" style={{ color: accentColor }}>
                          Retry
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 dark:text-gray-500 px-2 py-4 text-center">
                        No EPG sources yet
                      </p>
                    )
                  )}
                </nav>
              </>
            )}
          </div>
          </div>

          {/* Resize handle */}
          {isSidebarOpen && (
            <div
              onMouseDown={startSidebarResize}
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-gray-300 dark:hover:bg-white/15 transition-colors z-20"
            />
          )}
        </div>

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {activeView === 'playlists' ? (
            activePlaylistId ? (
              <PlaylistEditor playlistId={activePlaylistId} />
            ) : (
              <div className="flex-1 flex items-center justify-center bg-gray-100 dark:bg-[#121212] amoled:dark:bg-black">
                <div className="text-center">
                  <FileAudio className="mx-auto h-16 w-16 text-gray-300 dark:text-gray-700 mb-4" />
                  <p className="text-base font-medium text-gray-500 dark:text-gray-400">No playlist selected</p>
                  <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">Choose a playlist from the drawer to start editing.</p>
                </div>
              </div>
            )
          ) : activeView === 'channels' ? (
            <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 flex flex-col min-w-0">
                {activeChannelPoolSourceId ? (
                  <ChannelPoolViewer sourceId={activeChannelPoolSourceId} />
                ) : (
                  <div className="flex-1 flex items-center justify-center bg-gray-100 dark:bg-[#121212] amoled:dark:bg-black">
                    <div className="text-center">
                      <Layers className="mx-auto h-16 w-16 text-gray-300 dark:text-gray-700 mb-4" />
                      <p className="text-base font-medium text-gray-500 dark:text-gray-400">No channel source selected</p>
                      <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">Choose a source from the drawer or add a new one.</p>
                    </div>
                  </div>
                )}
              </div>
              <ChannelPoolUpdateLog />
            </div>
          ) : (
            activeEpgSourceId ? (
              <EpgViewer sourceId={activeEpgSourceId} onAssignChannel={handleAssignChannel} />
            ) : (
              <div className="flex-1 flex items-center justify-center bg-gray-100 dark:bg-[#121212] amoled:dark:bg-black">
                <div className="text-center">
                  <Radio className="mx-auto h-16 w-16 text-gray-300 dark:text-gray-700 mb-4" />
                  <p className="text-base font-medium text-gray-500 dark:text-gray-400">No EPG source selected</p>
                  <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">Choose an EPG source from the drawer or add a new one.</p>
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {/* ── Dialog: New Playlist ─────────────────────────────────────────── */}
      <NewPlaylistDialog
        open={isCreating}
        onClose={() => setIsCreating(false)}
        onCreated={handlePlaylistCreated}
      />

      {/* ── Dialog: Delete Playlist ──────────────────────────────────────── */}
      {deletePlaylistId && (
        <div className="md-scrim fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="md-dialog w-full max-w-sm bg-white dark:bg-[#272727] amoled:dark:bg-[#1a1a1a] rounded elev-24">
            <h2 className="text-xl font-medium text-gray-900 dark:text-white px-6 pt-6 pb-2">
              Delete Playlist
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 px-6 pb-6">
              Are you sure? All channels in this playlist will be permanently deleted.
            </p>
            <div className="flex justify-end gap-1 px-4 pb-4">
              <button
                onClick={() => setDeletePlaylistId(null)}
                className="md-btn h-9 px-4 rounded text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const id = deletePlaylistId;
                  const pl = playlists.find(p => p.id === id);
                  setDeletePlaylistId(null);
                  try {
                    const channels = await api.getChannels(id);
                    await api.deletePlaylist(id);
                    if (activePlaylistId === id) setActivePlaylistId(null);
                    triggerRefresh();
                    setUndoEntry({
                      description: `Deleted playlist "${pl?.name}"`,
                      restore: async () => {
                        const newPl = await api.createPlaylist(pl?.name || 'Restored Playlist');
                        if (channels.length > 0) {
                          const restoreData = channels.map(({ id: _id, playlistId: _pid, createdAt: _c, updatedAt: _u, ...rest }: any) => rest);
                          await api.bulkAddChannels(newPl.id, restoreData);
                        }
                        if (pl?.categories?.length) await api.updatePlaylist(newPl.id, { categories: pl.categories });
                        triggerRefresh();
                        setActivePlaylistId(newPl.id);
                      },
                    });
                  } catch (e) { console.error(e); notifyError(e, 'Failed to delete playlist.'); }
                }}
                className="md-btn h-9 px-4 rounded text-xs font-medium uppercase tracking-wider text-red-600 dark:text-red-400"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <Spotlight onNavigate={handleSpotlightNavigate} />

      {/* ── Add Channel Pool Source Dialog ───────────────────────────────── */}
      <AddChannelPoolSourceDialog open={isCreatingChannelPool} onClose={() => { setIsCreatingChannelPool(false); setPoolSourceToEdit(null); }} editingSource={poolSourceToEdit} />

      {/* ── Add EPG Source Dialog ────────────────────────────────────────── */}
      <AddEpgSourceDialog open={isCreatingEpg} onClose={() => { setIsCreatingEpg(false); setEpgSourceToEdit(null); }} editingSource={epgSourceToEdit} />

      {/* ── Assign TVG-ID Dialog ─────────────────────────────────────────── */}
      <AssignTvgIdDialog
        open={assignDialogOpen}
        onClose={() => setAssignDialogOpen(false)}
        epgChannelId={assignEpgChannelId}
        epgDisplayName={assignEpgDisplayName}
      />

      {/* ── Dialog: Delete Channel Pool Source ───────────────────────────── */}
      {deleteChannelPoolSourceId && (
        <div className="md-scrim fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="md-dialog w-full max-w-sm bg-white dark:bg-[#272727] amoled:dark:bg-[#1a1a1a] rounded elev-24">
            <h2 className="text-xl font-medium text-gray-900 dark:text-white px-6 pt-6 pb-2">
              Delete Channel Source
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 px-6 pb-6">
              Are you sure? All cached channel data and logs for this source will be removed.
            </p>
            <div className="flex justify-end gap-1 px-4 pb-4">
              <button
                onClick={() => setDeleteChannelPoolSourceId(null)}
                className="md-btn h-9 px-4 rounded text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const id = deleteChannelPoolSourceId;
                  setDeleteChannelPoolSourceId(null);
                  try {
                    await api.deleteChannelPoolSource(id);
                    if (activeChannelPoolSourceId === id) setActiveChannelPoolSourceId(null);
                    triggerChannelPoolRefresh();
                  } catch (e) { console.error(e); notifyError(e, 'Failed to delete channel source.'); }
                }}
                className="md-btn h-9 px-4 rounded text-xs font-medium uppercase tracking-wider text-red-600 dark:text-red-400"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Dialog: Delete EPG Source ─────────────────────────────────────── */}
      {deleteEpgSourceId && (
        <div className="md-scrim fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="md-dialog w-full max-w-sm bg-white dark:bg-[#272727] amoled:dark:bg-[#1a1a1a] rounded elev-24">
            <h2 className="text-xl font-medium text-gray-900 dark:text-white px-6 pt-6 pb-2">
              Delete EPG Source
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 px-6 pb-6">
              Are you sure? All cached EPG data for this source will be removed.
            </p>
            <div className="flex justify-end gap-1 px-4 pb-4">
              <button
                onClick={() => setDeleteEpgSourceId(null)}
                className="md-btn h-9 px-4 rounded text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const id = deleteEpgSourceId;
                  setDeleteEpgSourceId(null);
                  try {
                    await api.deleteEpgSource(id);
                    if (activeEpgSourceId === id) setActiveEpgSourceId(null);
                    triggerEpgRefresh();
                  } catch (e) { console.error(e); notifyError(e, 'Failed to delete EPG source.'); }
                }}
                className="md-btn h-9 px-4 rounded text-xs font-medium uppercase tracking-wider text-red-600 dark:text-red-400"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Dialog: Keyboard Shortcuts ──────────────────────────────────── */}
      {showShortcuts && (
        <div className="md-scrim fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setShowShortcuts(false)}>
          <div className="md-dialog w-full max-w-sm bg-white dark:bg-[#272727] amoled:dark:bg-[#1a1a1a] rounded elev-24" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 dark:border-white/10">
              <h2 className="text-xl font-medium text-gray-900 dark:text-white">Keyboard Shortcuts</h2>
              <button onClick={() => setShowShortcuts(false)} className="md-btn p-1.5 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-1">
              {([
                [[mod, 'K'], 'Open search'],
                [[mod, 'A'], 'Select all channels in category'],
                [['Esc'], 'Clear selection'],
                [['Del'], 'Delete selected channels'],
                [['Space'], 'Toggle visibility of selected channels'],
                [[mod, 'Z'], 'Undo last destructive action'],
              ] as [string[], string][]).map(([keys, label]) => (
                <div key={label} className="flex items-center justify-between py-2.5 border-b border-gray-100 dark:border-white/8 last:border-0">
                  <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
                  <div className="flex items-center gap-1 shrink-0 ml-4">
                    {keys.map((k, i) => (
                      <React.Fragment key={k}>
                        {i > 0 && <span className="text-xs text-gray-400">+</span>}
                        <kbd className="inline-flex items-center px-2 py-1 rounded text-[11px] font-medium font-mono bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-white/15 shadow-sm">
                          {k}
                        </kbd>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-6 pb-5 pt-1">
              <p className="text-xs text-gray-400 dark:text-gray-500">Shortcuts are active when no text field is focused.</p>
            </div>
          </div>
        </div>
      )}

      <Toast />
    </div>
  );
}
