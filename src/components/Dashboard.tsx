import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlaylists, useEpgSources, useChannelPoolSources, api, triggerRefresh, triggerEpgRefresh, triggerChannelPoolRefresh, SearchResult } from '../apiClient';
import { useStore, notifyError, notifyInfo } from '../store';
import PlaylistEditor from './PlaylistEditor';
import NewPlaylistDialog from './NewPlaylistDialog';
import CategoryList from './CategoryList';
import Spotlight from './Spotlight';
import { Logo } from './Logo';
import EpgViewer from './EpgViewer';
import AddEpgSourceDialog from './AddEpgSourceDialog';
import AssignTvgIdDialog from './AssignTvgIdDialog';
import AddChannelPoolSourceDialog from './AddChannelPoolSourceDialog';
import ChannelPoolViewer from './ChannelPoolViewer';
import ChannelPoolUpdateLog from './ChannelPoolUpdateLog';
import Toast from './Toast';
import MobileTopBar from './MobileTopBar';
import MobileTabBar from './MobileTabBar';
import DesktopTopBar from './DesktopTopBar';
import UpdateBanner from './UpdateBanner';
import KeyboardShortcutsDialog from './KeyboardShortcutsDialog';
import ConfirmDialog from './ConfirmDialog';
import { useIsPhone, useIsNarrow, canHover } from '../utils/useIsPhone';
import SortableNavRow from './SortableNavRow';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import Icon from './Icon';

// Keeps a dragged row moving straight up and down.
const restrictToVerticalAxis = ({ transform }: any) => ({ ...transform, x: 0 });

/* ── List pane pieces ─────────────────────────────────────────────────────── */

/**
 * "Playlists", "Categories", "Channel sources"…: a section title with its + button. On touch
 * screens (`onToggleEdit` given) there's also an Edit / Done button: the rows stay plain names
 * to tap until Edit shows their grips and buttons, the way iPhone and iPad lists work.
 */
export function PaneSectionHeader({ title, addLabel, onAdd, editing = false, onToggleEdit }: {
  title: string;
  addLabel: string;
  onAdd: () => void;
  editing?: boolean;
  onToggleEdit?: () => void;
}) {
  const touch = !!onToggleEdit;
  return (
    <div className={`flex items-center gap-1 ${touch ? 'h-14' : 'h-10'} pl-5 pr-1`}>
      <p className="flex-1 text-title-sm text-on-surface-variant">{title}</p>
      {onToggleEdit && (
        <button
          onClick={onToggleEdit}
          className={`md-btn btn h-10 px-4 ${editing ? 'btn-tonal' : 'btn-text'}`}
          aria-pressed={editing}
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      )}
      <button onClick={onAdd} className={`md-btn icon-btn ${touch ? 'w-12 h-12' : 'w-9 h-9'}`} title={addLabel} aria-label={addLabel}>
        <Icon name="add" className="text-[24px]" />
      </button>
    </div>
  );
}

/** The inline text box that replaces a row's name while it's being renamed. */
function RenameInput({ value, onChange, onConfirm, onCancel }: { value: string; onChange: (v: string) => void; onConfirm: () => void; onCancel: () => void }) {
  return (
    <input
      autoFocus
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onConfirm}
      onKeyDown={e => {
        if (e.key === 'Enter') onConfirm();
        if (e.key === 'Escape') onCancel();
      }}
      className="flex-1 min-w-0 text-label-lg max-md:text-base bg-transparent border-b-2 border-primary focus:outline-none text-on-surface px-0.5"
    />
  );
}

/**
 * One source or guide in the list pane: icon, name, and a small line with its channel count and
 * refresh interval. Edit / refresh / delete appear on hover, or on touch screens (`touch`)
 * in the list's Edit mode (`showActions`), the same way as playlist and category rows.
 */
function SourceRow({
  icon, name, meta, isActive, failedReason, isRenaming, renameValue, onRenameChange, onRenameConfirm, onRenameCancel,
  onPick, onRenameStart, onEdit, onRefresh, isRefreshing, onDelete, touch, showActions, kindLabel,
}: {
  key?: string | number;
  icon: React.ReactNode;
  name: string;
  meta: React.ReactNode;
  isActive: boolean;
  failedReason?: string | null;
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameConfirm: () => void;
  onRenameCancel: () => void;
  onPick: () => void;
  onRenameStart: () => void;
  onEdit: () => void;
  onRefresh?: () => void;
  isRefreshing: boolean;
  onDelete: () => void;
  touch: boolean;
  showActions: boolean;
  kindLabel: string;
}) {
  return (
    <div className={`nav-item md-btn group ${isActive ? 'nav-item-on' : ''}`}>
      {isRenaming ? (
        <div className="flex-1 flex items-center h-14 pl-5 pr-3 gap-3 min-w-0">
          {icon}
          <RenameInput value={renameValue} onChange={onRenameChange} onConfirm={onRenameConfirm} onCancel={onRenameCancel} />
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={onPick}
          onDoubleClick={onRenameStart}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onPick();
            }
          }}
          className={`flex-1 min-w-0 flex items-center gap-3 ${touch ? 'h-16' : 'h-14'} pl-5 ${showActions ? 'pr-36' : touch ? 'pr-4' : 'pr-3 group-hover:pr-28'} cursor-pointer`}
        >
          {/* A failed download swaps the source's icon for a warning sign instead of adding a
              badge, so the row stays as quiet as a working one. */}
          {failedReason ? (
            <span className="shrink-0 flex" title={`Last refresh failed: ${failedReason}`}>
              <Icon name="warning" className="text-[24px] text-error" />
            </span>
          ) : icon}
          <span className="flex-1 min-w-0 flex flex-col">
            <span className={`truncate ${isActive ? 'font-semibold' : 'text-on-surface'}`}>{name}</span>
            <span className="flex items-center gap-1.5 text-label-sm font-normal opacity-80 whitespace-nowrap overflow-hidden">{meta}</span>
          </span>
        </div>
      )}
      {!isRenaming && (showActions || !touch) && (
        <div className={`absolute right-1 items-center ${showActions ? 'flex' : 'hidden group-hover:flex'}`}>
          <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className={`md-btn icon-btn ${touch ? 'w-11 h-11' : 'w-9 h-9'}`} title={`Edit ${kindLabel}`}>
            <Icon name="edit" className="text-[20px]" />
          </button>
          {onRefresh && (
            <button
              onClick={(e) => { e.stopPropagation(); onRefresh(); }}
              className={`md-btn icon-btn ${touch ? 'w-11 h-11' : 'w-9 h-9'} ${isRefreshing ? 'animate-spin' : ''}`}
              title={`Refresh ${kindLabel}`}
              disabled={isRefreshing}
            >
              <Icon name="refresh" className="text-[20px]" />
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className={`md-btn icon-btn ${touch ? 'w-11 h-11' : 'w-9 h-9'} hover:text-error`} title={`Delete ${kindLabel}`}>
            <Icon name="delete" className="text-[20px]" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Shown in the list pane when it has nothing in it, or when loading it failed. */
function PaneEmpty({ error, onRetry, text }: { error: string | null; onRetry: () => void; text: string }) {
  return error ? (
    <div className="px-4 py-4 text-center">
      <p className="text-body-md text-error">{error}</p>
      <button onClick={onRetry} className="md-btn btn btn-text mt-1">Retry</button>
    </div>
  ) : (
    <p className="text-body-md text-on-surface-variant px-4 py-4 text-center">{text}</p>
  );
}

/**
 * The big empty state in the content pane. Dashboard opens the first playlist, source or guide
 * by itself, so this only shows when there are none yet (or the list couldn't be loaded), and
 * its button does the one thing that helps: add one (or try loading again).
 * Nothing shows while the list is still loading, so it never flashes up for a moment.
 */
function NothingSelected({ icon, title, text, buttonLabel, onButton, loading }: { icon: React.ReactNode; title: string; text: string; buttonLabel: string; onButton: () => void; loading: boolean }) {
  if (loading) return <div className="flex-1" />;
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center px-6">
        <div className="mx-auto mb-5 w-16 h-16 rounded-full flex items-center justify-center bg-secondary-container text-on-secondary-container">
          {icon}
        </div>
        <p className="text-title-md text-on-surface">{title}</p>
        <p className="mt-1 text-body-md text-on-surface-variant">{text}</p>
        <button onClick={onButton} className="md-btn btn btn-filled mt-6">
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}

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
    hideUrls, setHideUrls,
    setUndoEntry,
    activeCategory, setActiveCategory,
    setScrollTarget,
    setChannelPoolLogOpen,
  } = useStore();
  const isPhone = useIsPhone();
  // Below 1024px (phones, upright tablets) the list floats over the page as a drawer.
  const isNarrow = useIsNarrow();
  // Touch screens (and the drawer) show each row's buttons all the time; a mouse reveals them on hover.
  const touchRows = isNarrow || !canHover;
  // Touch only: which list in the pane is in Edit mode (showing grips and row buttons).
  // Switching tab or closing the drawer ends it.
  const [editingList, setEditingList] = useState<'playlists' | 'categories' | 'sources' | null>(null);
  useEffect(() => { setEditingList(null); }, [activeView, isSidebarOpen]);
  const toggleEditing = (list: 'playlists' | 'categories' | 'sources') => setEditingList(current => current === list ? null : list);
  // The empty spot in the phone top bar where the playlist editor puts its own ⋮ menu.
  const [phoneMenuSlot, setPhoneMenuSlot] = useState<HTMLDivElement | null>(null);

  // On narrow screens the drawer floats over the page, so it starts closed (also when
  // arriving from another screen) and closes again as soon as anything is picked or created
  // in it: a playlist, a category, a source or a guide. Managing things in it (rename,
  // delete, hide) leaves it open.
  useEffect(() => {
    if (isNarrow) setSidebarOpen(false);
  }, [isNarrow, setSidebarOpen]);
  const closeDrawerIfFloating = () => { if (isNarrow) setSidebarOpen(false); };

  // Something is always open when there's something to open: the playlist, source or guide
  // that was open last (remembered across reloads) if it still exists, otherwise the first one
  // in the list. The "nothing selected" screen only shows while a list is empty. Without this,
  // every tab on a phone or upright tablet opened on an empty screen behind the closed drawer.
  //
  // These run only when a list arrives, not when the selection changes: a newly created
  // playlist is made the active one before the refetched list includes it, and it must not be
  // swapped for the first playlist in that moment. The current id is read straight from the
  // store for the same reason.
  useEffect(() => {
    if (loading || playlistsError) return;
    const current = useStore.getState().activePlaylistId;
    if (current && playlists.some(p => p.id === current)) return;
    const next = playlists[0]?.id ?? null;
    if (next !== current) setActivePlaylistId(next);
  }, [playlists, loading, playlistsError, setActivePlaylistId]);
  useEffect(() => {
    if (channelPoolLoading || channelPoolSourcesError) return;
    const current = useStore.getState().activeChannelPoolSourceId;
    if (current && channelPoolSources.some(s => s.id === current)) return;
    const next = channelPoolSources[0]?.id ?? null;
    if (next !== current) setActiveChannelPoolSourceId(next);
  }, [channelPoolSources, channelPoolLoading, channelPoolSourcesError, setActiveChannelPoolSourceId]);
  useEffect(() => {
    if (epgLoading || epgSourcesError) return;
    const current = useStore.getState().activeEpgSourceId;
    if (current && epgSources.some(s => s.id === current)) return;
    const next = epgSources[0]?.id ?? null;
    if (next !== current) setActiveEpgSourceId(next);
  }, [epgSources, epgLoading, epgSourcesError, setActiveEpgSourceId]);
  const activePlaylist = playlists.find(p => p.id === activePlaylistId);
  const activePoolSource = channelPoolSources.find(s => s.id === activeChannelPoolSourceId);
  const activeEpgSource = epgSources.find(s => s.id === activeEpgSourceId);
  const [isCreating, setIsCreating] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

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

  // Channels with a sync suggestion waiting, across all playlists, for the dot on the My Playlists tab.
  const pendingSyncTotal = playlists.reduce((sum, p) => sum + (p.pendingSyncCount || 0), 0);

  // Shown as a warning in the delete dialog: those channels lose their link.
  const deletingPoolSourceLinkedCount = channelPoolSources.find(s => s.id === deleteChannelPoolSourceId)?.linkedChannelCount || 0;

  const handleRefreshChannelPoolSource = async (id: string) => {
    setRefreshingChannelPoolId(id);
    try {
      const result = await api.refreshChannelPoolSource(id);
      triggerChannelPoolRefresh();
      // A refresh can also update channels linked to this source, in any playlist.
      triggerRefresh();
      if (!result.changed) notifyInfo('No changes found — channel list is already up to date.');
    } catch (e) {
      console.error(e);
      notifyError(e);
      // A failed download is saved on the source too, so refetch the list to show the reason.
      triggerChannelPoolRefresh();
    }
    finally { setRefreshingChannelPoolId(null); }
  };
  // A little wider on touch screens, where rows and buttons are bigger.
  const [sidebarWidth, setSidebarWidth] = useState(canHover ? 272 : 320);
  // The floating drawer is a fixed share of the screen instead of the draggable width.
  const drawerWidth = isNarrow ? 'min(320px, 85vw)' : sidebarWidth;
  const sidebarRef = useRef<HTMLDivElement>(null);
  const sidebarResizing = useRef<{ startX: number; startW: number } | null>(null);
  const startSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    if (sidebarRef.current) sidebarRef.current.style.transition = 'none';
    sidebarResizing.current = { startX: e.clientX, startW: sidebarWidth };
    const onMove = (ev: MouseEvent) => {
      if (!sidebarResizing.current) return;
      const w = Math.max(200, Math.min(480, sidebarResizing.current.startW + ev.clientX - sidebarResizing.current.startX));
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

  // ── Playlist order ──
  // Shown in the new order straight away, while the save and the refetch that follows are
  // still on their way (the same trick as dragging channels and categories).
  const [localPlaylistOrder, setLocalPlaylistOrder] = useState<string[] | null>(null);
  useEffect(() => { setLocalPlaylistOrder(null); }, [playlists]);
  const orderedPlaylists = localPlaylistOrder
    ? localPlaylistOrder.map(id => playlists.find(p => p.id === id)!).filter(Boolean)
    : playlists;
  const sortSensors = useSensors(
    // 5px of movement before a drag starts, so a plain click still selects the row.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handlePlaylistDragEnd = async (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids: string[] = orderedPlaylists.map(p => p.id);
    const newOrder = arrayMove(ids, ids.indexOf(active.id), ids.indexOf(over.id));
    setLocalPlaylistOrder(newOrder);
    try {
      await api.reorderPlaylists(newOrder);
      triggerRefresh();
    } catch (e) {
      console.error(e);
      notifyError(e, 'Failed to save the playlist order.');
      setLocalPlaylistOrder(null);
    }
  };

  const handlePlaylistCreated = (playlistId: string) => {
    setIsCreating(false);
    triggerRefresh();
    setActivePlaylistId(playlistId);
    closeDrawerIfFloating();
  };

  const handleDeletePlaylist = async () => {
    const id = deletePlaylistId;
    if (!id) return;
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
  };

  const handleDeleteChannelPoolSource = async () => {
    const id = deleteChannelPoolSourceId;
    if (!id) return;
    setDeleteChannelPoolSourceId(null);
    try {
      await api.deleteChannelPoolSource(id);
      if (activeChannelPoolSourceId === id) setActiveChannelPoolSourceId(null);
      triggerChannelPoolRefresh();
      // Channels linked to the source were unlinked, so playlists need to refetch.
      triggerRefresh();
    } catch (e) { console.error(e); notifyError(e, 'Failed to delete channel source.'); }
  };

  const handleDeleteEpgSource = async () => {
    const id = deleteEpgSourceId;
    if (!id) return;
    setDeleteEpgSourceId(null);
    try {
      await api.deleteEpgSource(id);
      if (activeEpgSourceId === id) setActiveEpgSourceId(null);
      triggerEpgRefresh();
    } catch (e) { console.error(e); notifyError(e, 'Failed to delete EPG source.'); }
  };

  const listIconClass = 'text-[24px]';

  return (
    <div className="md-page-in flex flex-col h-dvh overflow-hidden bg-page text-on-surface">

      {/* ── Phone top bar (below 768px; the desktop bar further down is hidden there) ── */}
      <MobileTopBar
        {...(activeView === 'playlists' && activePlaylist
          // A playlist: its name as a small line above the category, which is what the list shows.
          ? activeCategory
            ? { overline: activePlaylist.name, title: activeCategory }
            : { title: activePlaylist.name }
          : {
              title: activeView === 'playlists'
                ? 'My Playlists'
                : activeView === 'channels'
                  ? activePoolSource?.name ?? 'Sources'
                  : activeEpgSource?.name ?? 'EPG',
            })}
        onMenu={() => setSidebarOpen(!isSidebarOpen)}
        // An open playlist fills this spot with the editor's own ⋮ menu (Hide stream links included).
        menuSlotRef={setPhoneMenuSlot}
        menuItems={activeView === 'playlists' && activePlaylist ? [] : [
          // The open source's or guide's own actions (bigger screens have them next to its
          // title). Uploaded files never download again, so they get no Refresh and no log.
          activeView === 'channels' && activePoolSource && activePoolSource.type !== 'playlist-file' && {
            label: refreshingChannelPoolId === activePoolSource.id ? 'Downloading…' : 'Refresh source',
            icon: <Icon name="refresh" className="text-[24px]" />,
            onClick: () => { if (!refreshingChannelPoolId) handleRefreshChannelPoolSource(activePoolSource.id); },
          },
          activeView === 'channels' && activePoolSource && {
            label: 'Edit source',
            icon: <Icon name="edit" className="text-[24px]" />,
            onClick: () => { setPoolSourceToEdit(activePoolSource); setIsCreatingChannelPool(true); },
          },
          // Same rule as ChannelPoolUpdateLog: uploaded files never refresh, so they have no log.
          activeView === 'channels' && activePoolSource && activePoolSource.type !== 'playlist-file' && {
            label: 'Update log',
            icon: <Icon name="history" className="text-[24px]" />,
            onClick: () => setChannelPoolLogOpen(true),
          },
          activeView === 'epg' && activeEpgSource && {
            label: refreshingEpgId === activeEpgSource.id ? 'Downloading…' : 'Refresh guide',
            icon: <Icon name="refresh" className="text-[24px]" />,
            onClick: () => { if (!refreshingEpgId) handleRefreshEpgSource(activeEpgSource.id); },
          },
          activeView === 'epg' && activeEpgSource && {
            label: 'Edit guide',
            icon: <Icon name="edit" className="text-[24px]" />,
            onClick: () => { setEpgSourceToEdit(activeEpgSource); setIsCreatingEpg(true); },
          },
          // Last, as in the playlist's own ⋮.
          (activeView === 'playlists' || activeView === 'channels') && {
            label: hideUrls ? 'Show stream links' : 'Hide stream links',
            icon: hideUrls ? <Icon name="visibility" className="text-[24px]" /> : <Icon name="visibility_off" className="text-[24px]" />,
            onClick: () => setHideUrls(!hideUrls),
          },
        ]}
      />

      <UpdateBanner />

      <DesktopTopBar
        active={activeView}
        onMenu={() => setSidebarOpen(!isSidebarOpen)}
        onShortcuts={() => setShowShortcuts(true)}
        pendingSyncCount={pendingSyncTotal}
      />

      <div className="flex flex-1 overflow-hidden">

        {/* ── List pane / drawer ───────────────────────────────────────────── */}
        {/* The outer box's width does the sliding — it's always overflow-hidden, so it clips
            rather than reflows. The inner content below stays a fixed width the whole time, so
            labels never re-wrap mid-animation; they just get covered or uncovered as the box
            widens, and cross-fade a bit faster than the slide. */}
        {/* Below 1024px the list floats over the page (max-lg:fixed below) with this dimmed
            backdrop behind it; tapping the backdrop closes it. It comes first in the page
            so that, at the same z-50, the drawer and every dialog paint on top of it. */}
        {isNarrow && isSidebarOpen && (
          <div className="md-scrim lg:hidden fixed inset-0 z-50 bg-black/40" onClick={() => setSidebarOpen(false)} />
        )}
        <div
          ref={sidebarRef}
          className={`${isSidebarOpen ? 'max-lg:shadow-level-3' : 'w-0'} shrink-0 overflow-hidden z-40 transition-[width] duration-[240ms] ease-[var(--md-standard)] relative max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:pt-safe max-lg:pb-safe max-lg:bg-drawer max-lg:rounded-r-2xl`}
          style={isSidebarOpen ? { width: drawerWidth } : undefined}
        >
          <div
            className={`h-full flex flex-col transition-opacity duration-150 ease-[var(--md-standard)] ${isSidebarOpen ? 'opacity-100' : 'opacity-0'}`}
            style={{ width: drawerWidth }}
          >
          {/* The floating drawer gets the logo on top, like the phone's. */}
          {isNarrow && (
            <div className="shrink-0 px-7 pt-5 pb-2">
              <Logo className="h-5 w-auto text-on-surface" />
            </div>
          )}
          <div className="flex-1 overflow-y-auto py-1 pl-2 pr-3 max-lg:px-3">

            {activeView === 'playlists' ? (
              <>
                <PaneSectionHeader title="Playlists" addLabel="New playlist" onAdd={() => setIsCreating(true)} editing={editingList === 'playlists'} onToggleEdit={touchRows ? () => toggleEditing('playlists') : undefined} />

                <nav className="space-y-0.5">
                  {/* Drag to reorder. The order is only how playlists are listed; a playlist's
                      link keeps its number. */}
                  <DndContext sensors={sortSensors} collisionDetection={closestCenter} onDragEnd={handlePlaylistDragEnd} modifiers={[restrictToVerticalAxis]}>
                    <SortableContext items={orderedPlaylists.map(pl => pl.id)} strategy={verticalListSortingStrategy}>
                      {orderedPlaylists.map((pl) => (
                        <SortableNavRow
                          key={pl.id}
                          id={pl.id}
                          label={pl.name}
                          kind="playlist"
                          isActive={activePlaylistId === pl.id}
                          count={pl.channelCount ?? 0}
                          badge={(pl.unreadSyncLogCount || 0) > 0 && (
                            <span className="badge" title="New entries in this playlist's sync log">
                              {pl.unreadSyncLogCount! > 99 ? '99+' : pl.unreadSyncLogCount}
                            </span>
                          )}
                          onPick={() => { setActivePlaylistId(pl.id); closeDrawerIfFloating(); }}
                          onDelete={() => setDeletePlaylistId(pl.id)}
                          touch={touchRows}
                          showActions={touchRows && editingList === 'playlists'}
                          isRenaming={renamingId === pl.id}
                          renameValue={renameValue}
                          onRenameStart={() => { setRenamingId(pl.id); setRenameValue(pl.name); }}
                          onRenameChange={setRenameValue}
                          onRenameConfirm={confirmRenamePlaylist}
                          onRenameCancel={() => setRenamingId(null)}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                  {playlists.length === 0 && !loading && (
                    <PaneEmpty error={playlistsError} onRetry={refetchPlaylists} text="No playlists yet" />
                  )}
                </nav>

                {/* Section: Categories */}
                {activePlaylistId && <CategoryList
                  playlistId={activePlaylistId}
                  onPick={closeDrawerIfFloating}
                  touch={touchRows}
                  editing={editingList === 'categories'}
                  onToggleEdit={() => toggleEditing('categories')}
                />}
              </>
            ) : activeView === 'channels' ? (
              <>
                <PaneSectionHeader title="Channel sources" addLabel="Add channel source" onAdd={() => { setPoolSourceToEdit(null); setIsCreatingChannelPool(true); }} editing={editingList === 'sources'} onToggleEdit={touchRows ? () => toggleEditing('sources') : undefined} />

                <nav className="space-y-0.5">
                  {channelPoolSources.map((src) => {
                    const isFileType = src.type === 'playlist-file';
                    return (
                      <SourceRow
                        key={src.id}
                        kindLabel="channel source"
                        icon={<Icon name="stacks" className={listIconClass} />}
                        name={src.name}
                        meta={
                          <>
                            <span>{src.channelCount} ch</span>
                            {!isFileType && (
                              <>
                                <span>·</span>
                                <span className="flex items-center gap-0.5" title="Refresh interval">
                                  <Icon name="schedule" className="text-[16px]" />
                                  {src.refreshIntervalHours}h
                                </span>
                              </>
                            )}
                          </>
                        }
                        isActive={activeChannelPoolSourceId === src.id}
                        failedReason={src.lastFetchError}
                        isRenaming={renamingChannelPoolId === src.id}
                        renameValue={renameChannelPoolValue}
                        onRenameChange={setRenameChannelPoolValue}
                        onRenameConfirm={confirmRenameChannelPoolSource}
                        onRenameCancel={() => setRenamingChannelPoolId(null)}
                        onPick={() => { setActiveChannelPoolSourceId(src.id); closeDrawerIfFloating(); }}
                        onRenameStart={() => { setRenamingChannelPoolId(src.id); setRenameChannelPoolValue(src.name); }}
                        onEdit={() => { setPoolSourceToEdit(src); setIsCreatingChannelPool(true); }}
                        onRefresh={isFileType ? undefined : () => handleRefreshChannelPoolSource(src.id)}
                        isRefreshing={refreshingChannelPoolId === src.id}
                        onDelete={() => setDeleteChannelPoolSourceId(src.id)}
                        touch={touchRows}
                        showActions={touchRows && editingList === 'sources'}
                      />
                    );
                  })}
                  {channelPoolSources.length === 0 && !channelPoolLoading && (
                    <PaneEmpty error={channelPoolSourcesError} onRetry={refetchChannelPoolSources} text="No channel sources yet" />
                  )}
                </nav>
              </>
            ) : (
              <>
                <PaneSectionHeader title="EPG sources" addLabel="Add EPG source" onAdd={() => { setEpgSourceToEdit(null); setIsCreatingEpg(true); }} editing={editingList === 'sources'} onToggleEdit={touchRows ? () => toggleEditing('sources') : undefined} />

                <nav className="space-y-0.5">
                  {epgSources.map((src) => (
                    <SourceRow
                      key={src.id}
                      kindLabel="EPG source"
                      icon={<Icon name="live_tv" className={listIconClass} />}
                      name={src.name}
                      meta={
                        <>
                          <span>{src.channelCount} ch</span>
                          <span>·</span>
                          <span className="flex items-center gap-0.5" title="Refresh interval">
                            <Icon name="schedule" className="text-[16px]" />
                            {src.refreshIntervalHours}h
                          </span>
                        </>
                      }
                      isActive={activeEpgSourceId === src.id}
                      failedReason={src.lastFetchError}
                      isRenaming={renamingEpgId === src.id}
                      renameValue={renameEpgValue}
                      onRenameChange={setRenameEpgValue}
                      onRenameConfirm={confirmRenameEpgSource}
                      onRenameCancel={() => setRenamingEpgId(null)}
                      onPick={() => { setActiveEpgSourceId(src.id); closeDrawerIfFloating(); }}
                      onRenameStart={() => { setRenamingEpgId(src.id); setRenameEpgValue(src.name); }}
                      onEdit={() => { setEpgSourceToEdit(src); setIsCreatingEpg(true); }}
                      onRefresh={() => handleRefreshEpgSource(src.id)}
                      isRefreshing={refreshingEpgId === src.id}
                      onDelete={() => setDeleteEpgSourceId(src.id)}
                      touch={touchRows}
                        showActions={touchRows && editingList === 'sources'}
                    />
                  ))}
                  {epgSources.length === 0 && !epgLoading && (
                    <PaneEmpty error={epgSourcesError} onRetry={refetchEpgSources} text="No EPG sources yet" />
                  )}
                </nav>
              </>
            )}
          </div>
          </div>

          {/* Resize handle (mouse only, so not on the floating drawer) */}
          {isSidebarOpen && !isNarrow && (
            <div
              onMouseDown={startSidebarResize}
              className="absolute right-0 top-0 bottom-2 w-1.5 cursor-col-resize rounded-full hover:bg-outline-variant transition-colors z-20"
            />
          )}
        </div>

        {/* ── Content pane ─────────────────────────────────────────────────── */}
        {/* A rounded panel on the tinted page. Next to the open list on wide screens it touches
            the list's edge; otherwise it keeps an 8px margin on both sides. */}
        <div className={`flex-1 flex flex-col min-w-0 mb-2 mr-2 ${isSidebarOpen && !isNarrow ? '' : 'ml-2'} rounded-2xl max-md:rounded-[20px] bg-pane border border-pane-border overflow-hidden`}>
          {activeView === 'playlists' ? (
            activePlaylistId ? (
              <PlaylistEditor playlistId={activePlaylistId} phoneMenuSlot={phoneMenuSlot} />
            ) : (
              <NothingSelected
                loading={loading}
                icon={<Icon name="queue_music" className="text-[28px]" />}
                {...(playlistsError
                  ? { title: "Couldn't load your playlists", text: playlistsError, buttonLabel: 'Try again', onButton: refetchPlaylists }
                  : { title: 'No playlists yet', text: 'Make a playlist, then fill it with channels from your sources.', buttonLabel: 'New playlist', onButton: () => setIsCreating(true) })}
              />
            )
          ) : activeView === 'channels' ? (
            <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 flex flex-col min-w-0">
                {activeChannelPoolSourceId ? (
                  <ChannelPoolViewer
                    sourceId={activeChannelPoolSourceId}
                    source={channelPoolSources.find(s => s.id === activeChannelPoolSourceId)}
                    onRetry={() => handleRefreshChannelPoolSource(activeChannelPoolSourceId)}
                    isRetrying={refreshingChannelPoolId === activeChannelPoolSourceId}
                    onEdit={() => {
                      setPoolSourceToEdit(channelPoolSources.find(s => s.id === activeChannelPoolSourceId) || null);
                      setIsCreatingChannelPool(true);
                    }}
                  />
                ) : (
                  <NothingSelected
                    loading={channelPoolLoading}
                    icon={<Icon name="stacks" className="text-[28px]" />}
                    {...(channelPoolSourcesError
                      ? { title: "Couldn't load your sources", text: channelPoolSourcesError, buttonLabel: 'Try again', onButton: refetchChannelPoolSources }
                      : { title: 'No channel sources yet', text: 'Add your provider’s login or playlist link to browse its channels.', buttonLabel: 'Add channel source', onButton: () => { setPoolSourceToEdit(null); setIsCreatingChannelPool(true); } })}
                  />
                )}
              </div>
              <ChannelPoolUpdateLog />
            </div>
          ) : (
            activeEpgSourceId ? (
              <EpgViewer
                sourceId={activeEpgSourceId}
                onAssignChannel={handleAssignChannel}
                sourceName={activeEpgSource?.name}
                fetchError={activeEpgSource?.lastFetchError}
                onRefresh={() => handleRefreshEpgSource(activeEpgSourceId)}
                isRefreshing={refreshingEpgId === activeEpgSourceId}
                onEdit={() => { setEpgSourceToEdit(activeEpgSource || null); setIsCreatingEpg(true); }}
              />
            ) : (
              <NothingSelected
                loading={epgLoading}
                icon={<Icon name="live_tv" className="text-[28px]" />}
                {...(epgSourcesError
                  ? { title: "Couldn't load your TV guides", text: epgSourcesError, buttonLabel: 'Try again', onButton: refetchEpgSources }
                  : { title: 'No EPG sources yet', text: 'Add a TV guide link to see what’s on and match it to your channels.', buttonLabel: 'Add EPG source', onButton: () => { setEpgSourceToEdit(null); setIsCreatingEpg(true); } })}
              />
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

      {deletePlaylistId && (
        <ConfirmDialog title="Delete playlist" confirmLabel="Delete" danger onConfirm={handleDeletePlaylist} onClose={() => setDeletePlaylistId(null)}>
          All channels in this playlist will be deleted.
        </ConfirmDialog>
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

      {deleteChannelPoolSourceId && (
        <ConfirmDialog title="Delete channel source" confirmLabel="Delete" danger onConfirm={handleDeleteChannelPoolSource} onClose={() => setDeleteChannelPoolSourceId(null)}>
          <p>All cached channel data and logs for this source will be removed.</p>
          {deletingPoolSourceLinkedCount > 0 && (
            <div className="mt-4 flex gap-3 rounded-xl bg-tertiary-container text-on-tertiary-container p-3">
              <Icon name="warning" className="text-[24px] shrink-0" />
              <p>
                {deletingPoolSourceLinkedCount} channel{deletingPoolSourceLinkedCount !== 1 ? 's' : ''} in your playlists {deletingPoolSourceLinkedCount !== 1 ? 'are' : 'is'} kept in sync with this source. {deletingPoolSourceLinkedCount !== 1 ? "They'll" : "It'll"} stay in your playlists but stop syncing. Adding this source again later won't reconnect {deletingPoolSourceLinkedCount !== 1 ? 'them' : 'it'}.
              </p>
            </div>
          )}
        </ConfirmDialog>
      )}

      {deleteEpgSourceId && (
        <ConfirmDialog title="Delete EPG source" confirmLabel="Delete" danger onConfirm={handleDeleteEpgSource} onClose={() => setDeleteEpgSourceId(null)}>
          All cached EPG data for this source will be removed.
        </ConfirmDialog>
      )}

      <KeyboardShortcutsDialog open={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {isPhone && <MobileTabBar active={activeView === 'channels' ? 'sources' : activeView} />}
      <Toast withTabBar />
    </div>
  );
}
