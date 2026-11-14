import React, { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { usePlaylists, useChannels, useChannelPoolSources, Channel, SyncFieldToggles, api, triggerRefresh, applySavedChannel, triggerChannelPoolRefresh } from '../apiClient';
import { useStore, notifyError, notifyInfo } from '../store';

import Checkbox from './Checkbox';
import Dialog from './Dialog';
import ConfirmDialog from './ConfirmDialog';
import SegmentedButtons from './SegmentedButtons';
import BulkEpgAssignDialog from './BulkEpgAssignDialog';
import { ChannelSyncPopover, BulkSyncSettingsDialog } from './ChannelSyncPopover';
import LinkChannelDialog from './LinkChannelDialog';
import SyncLogPanel from './SyncLogPanel';
import ChannelListPdf from './ChannelListPdf';
import StreamHeadersDialog from './StreamHeadersDialog';
import ChannelLogo from './ChannelLogo';
import TvgIdAutocomplete from './TvgIdAutocomplete';
import ChannelEditSheet, { type ChannelChanges } from './ChannelEditSheet';
import OverflowMenu from './OverflowMenu';
import { useIsPhone, canHover } from '../utils/useIsPhone';
import { useLongPress } from '../utils/useLongPress';
import { copyToClipboard } from '../utils/copyToClipboard';
import { formatTime } from '../utils/formatTime';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Icon from './Icon';

/* ── Inline text-field style used for in-row editing ─────────────────────── */
const inlineInputCls = 'border-b-2 border-primary bg-transparent text-body-md text-on-surface px-0.5 py-0 focus:outline-none w-full';

const restrictToVerticalAxis = ({ transform }: any) => ({ ...transform, x: 0 });

/* ── Sortable channel row ─────────────────────────────────────────────────── */
type HealthStatus = 'checking' | 'ok' | 'error' | 'timeout' | 'skipped';
type HealthEntry = { status: HealthStatus; checkedAt: number };

function formatCheckedAt(ts: number, is24Hour: boolean): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
  return `${dateStr}, ${formatTime(d, is24Hour)}`;
}

function HealthDot({ status }: { status: HealthStatus }) {
  const base = 'w-2 h-2 rounded-full shrink-0';
  if (status === 'checking') return <div className={`${base} bg-on-surface-variant/50 animate-pulse`} />;
  if (status === 'ok')       return <div className={`${base} bg-success`} />;
  if (status === 'error')    return <div className={`${base} bg-error`} />;
  if (status === 'timeout')  return <div className={`${base} bg-warning`} />;
  return <div className={`${base} bg-outline-variant`} />;
}

function SortableChannelItem({
  channel, isSelected, toggleSelection,
  onUpdate, onDelete, onToggleHide,
  activeEditId, setActiveEditId, colWidths, isHighlighted, onRightClick, healthSt, tvgIdLabel, isSaving,
  onOpenSync, onEditHeaders, onOpenMenu,
}: {
  key?: string | number;
  channel: Channel;
  isSelected: boolean;
  toggleSelection: (id: string, shiftKey: boolean) => void;
  onUpdate: (id: string, field: string, value: string) => void;
  onDelete: (id: string) => void;
  onToggleHide: (id: string, isHidden: boolean) => void;
  activeEditId: string | null;
  setActiveEditId: (id: string | null) => void;
  colWidths: { name: number };
  isHighlighted: boolean;
  onRightClick: (e: React.MouseEvent) => void;
  healthSt?: HealthEntry;
  tvgIdLabel?: { displayName: string; sourceName: string };
  isSaving?: boolean;
  // Opens the sync popover (linked channel) or the Link to Source dialog (unlinked channel),
  // anchored to the element that was clicked.
  onOpenSync: (channelId: string, anchor: DOMRect) => void;
  onEditHeaders: (channelId: string) => void;
  // The row's ⋮: opens the same menu as a right-click, below the button.
  onOpenMenu: (channelId: string, anchor: DOMRect) => void;
}) {
  const { logoBgColor, hideUrls, is24Hour } = useStore();
  const hasPendingSync = !!channel.link && Object.keys(channel.link.pending).length > 0;
  // stopPropagation on mousedown keeps the popover's "click outside closes it" listener from
  // firing for its own trigger, so clicking the trigger again toggles it closed.
  const syncTriggerProps = {
    onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => onOpenSync(channel.id, e.currentTarget.getBoundingClientRect()),
  };
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: channel.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    if (activeEditId !== channel.id && editingField) setEditingField(null);
  }, [activeEditId, channel.id, editingField]);

  const startEdit = (field: string, value: string) => {
    setEditingField(field);
    setEditValue(value);
    setActiveEditId(channel.id);
  };

  // Takes the value to save instead of reading editValue, so the TVG-ID dropdown can save the
  // channel it just picked; editValue would still hold the typed text until the next render.
  const commitEdit = (value: string) => {
    if (editingField && value !== (channel[editingField as keyof Channel] || '')) {
      onUpdate(channel.id, editingField, value);
    }
    setEditingField(null);
    if (activeEditId === channel.id) setActiveEditId(null);
  };
  const saveEdit = () => commitEdit(editValue);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') { setEditingField(null); if (activeEditId === channel.id) setActiveEditId(null); }
  };

  // A search jump flashes the row; a selected row uses the selection colour; otherwise a
  // light wash on hover. No zebra stripes: the hairlines between rows are enough.
  const rowBg = isHighlighted
    ? 'bg-tertiary-container'
    : isSelected
      ? 'bg-secondary-container'
      : 'hover:bg-on-surface/[0.06]';
  // With a mouse, the drag handle and the eye/delete buttons appear when the row is hovered
  // (or focused from the keyboard); touch screens show them all the time.
  const reveal = canHover ? 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100' : '';
  // Hidden channels (left out of the playlist file) are dimmed instead of coloured.
  const dim = channel.isHidden ? 'opacity-50' : '';

  return (
    <div
      id={`ch-${channel.id}`}
      ref={setNodeRef}
      style={style}
      // Touch screens get taller rows, to fit the 44px buttons with room around them.
      className={`relative flex items-center h-14 no-hover:h-16 pl-2 border-b border-outline-variant/60 group transition-colors ${rowBg}`}
      onContextMenu={onRightClick}
    >

      {/* Drag handle */}
      <div
        {...attributes} {...listeners}
        className={`w-6 no-hover:w-10 shrink-0 self-stretch flex items-center justify-center touch-none cursor-grab active:cursor-grabbing text-on-surface-variant ${reveal}`}
      >
        <Icon name="drag_indicator" className="text-[20px]" />
      </div>

      <button
        onClick={e => toggleSelection(channel.id, e.shiftKey)}
        className="md-btn icon-btn w-10 h-10"
        aria-label={isSelected ? 'Deselect channel' : 'Select channel'}
      >
        <Checkbox checked={isSelected} />
      </button>

      {/* Logo — NOTE: no overflow:hidden here so the popup isn't clipped */}
      <div className="relative w-16 shrink-0 flex items-center justify-center">
        <div
          className={`cursor-pointer ${dim}`}
          onClick={e => { e.stopPropagation(); startEdit('logo', channel.logo || ''); }}
          title="Click to change the logo"
        >
          <ChannelLogo
            logo={channel.logo}
            name={channel.name}
            logoBgColor={logoBgColor}
            className="w-12 h-8 rounded-md hover:ring-2 hover:ring-outline-variant"
          />
        </div>

        {/* Logo URL popover */}
        {editingField === 'logo' && (
          <div
            className="md-menu menu absolute top-10 left-1 z-30 w-72 p-4"
            onClick={e => e.stopPropagation()}
          >
            <label className="field-label">Logo URL</label>
            <input
              autoFocus
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onKeyDown={handleKey}
              placeholder="https://…"
              className="field h-10 font-mono text-body-sm mb-3"
            />
            {editValue ? (
              <div className="w-12 h-8 mb-3 overflow-hidden rounded-md flex items-center justify-center" style={{ backgroundColor: logoBgColor === 'transparent' ? undefined : logoBgColor }}>
                <img src={editValue} alt="Preview" className="w-full h-full object-contain" onError={e => (e.currentTarget.style.display = 'none')} />
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditingField(null)} className="md-btn btn btn-text h-9">Cancel</button>
              <button onClick={saveEdit} className="md-btn btn btn-text h-9">Save</button>
            </div>
          </div>
        )}
      </div>

      {/* Name + URL */}
      <div className={`shrink-0 pl-3 pr-4 flex flex-col justify-center overflow-hidden ${dim}`} style={{ width: colWidths.name }}>
        {editingField === 'name'
          ? <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={saveEdit} onKeyDown={handleKey} className={inlineInputCls} onClick={e => e.stopPropagation()} placeholder="Channel name" />
          : <div className="flex items-center gap-1.5 min-w-0">
              <p onClick={() => startEdit('name', channel.name)} className="min-w-0 text-label-lg text-on-surface truncate cursor-text hover:underline decoration-dashed underline-offset-2" title="Click to edit">{channel.name || 'Unnamed'}</p>
              {(channel.httpReferrer || channel.httpUserAgent) && (
                <button
                  onClick={() => onEditHeaders(channel.id)}
                  className={`md-btn tag ${isSelected ? 'tag-on-selected' : ''}`}
                  title={[
                    'This channel sends extra headers so its stream plays.',
                    channel.httpReferrer ? `Referrer: ${channel.httpReferrer}` : '',
                    channel.httpUserAgent ? `User-agent: ${channel.httpUserAgent}` : '',
                    'Click to edit',
                  ].filter(Boolean).join('\n')}
                >
                  {[channel.httpReferrer && 'Referrer', channel.httpUserAgent && 'UA'].filter(Boolean).join(' · ')}
                </button>
              )}
              {channel.link?.lost && (
                <button
                  {...syncTriggerProps}
                  className={`md-btn tag ${isSelected ? 'tag-on-selected' : ''}`}
                  title="This channel disappeared from its source. Click for details."
                >
                  Source lost
                </button>
              )}
              {/* Deliberately small and quiet: a suggestion is the user's call, not an alarm. */}
              {hasPendingSync && (
                <button
                  {...syncTriggerProps}
                  className="shrink-0 p-1 rounded-full"
                  title="The source changed this channel. Click to review."
                  aria-label="Review changes from source"
                >
                  <span className="block w-2 h-2 rounded-full bg-primary" />
                </button>
              )}
            </div>
        }
        {!hideUrls && (editingField === 'url'
          ? <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={saveEdit} onKeyDown={handleKey} className={`${inlineInputCls} font-mono text-body-sm`} onClick={e => e.stopPropagation()} placeholder="https://…" />
          : <p onClick={() => startEdit('url', channel.url || '')} className="text-body-sm font-mono text-on-surface-variant truncate cursor-text hover:underline decoration-dashed underline-offset-2" title="Click to edit">{channel.url || '— no url —'}</p>
        )}
      </div>

      {/* TV guide (TVG ID) — fills remaining space */}
      <div className={`flex-1 pr-4 hidden md:flex items-center overflow-hidden relative ${dim}`}>
        {editingField === 'tvgId'
          ? <TvgIdAutocomplete
              value={editValue}
              onChange={setEditValue}
              onSave={commitEdit}
              onCancel={() => { setEditingField(null); if (activeEditId === channel.id) setActiveEditId(null); }}
            />
          : channel.tvgId && tvgIdLabel
            ? <button
                onClick={() => startEdit('tvgId', channel.tvgId || '')}
                // On a selected row the border takes a stronger colour, or it would vanish
                // into the selection's background.
                className={`md-btn inline-flex items-center gap-1.5 h-[26px] max-w-full min-w-0 px-2.5 rounded-lg border text-label-md text-on-surface ${isSelected ? 'border-outline' : 'border-outline-variant'}`}
                title={`${channel.tvgId}\nClick to edit`}
              >
                {/* Only the guide's channel name gives way when space runs out, so the short
                    source name after it stays readable. */}
                <span className="truncate min-w-0">{tvgIdLabel.displayName}</span>
                <span className="shrink-0 font-normal text-on-surface-variant">· {tvgIdLabel.sourceName}</span>
              </button>
            : <span onClick={() => startEdit('tvgId', channel.tvgId || '')} className={`font-mono text-body-sm truncate cursor-text hover:underline decoration-dashed underline-offset-2 ${channel.tvgId ? 'text-on-surface-variant' : 'text-outline'}`} title="Click to edit">{channel.tvgId || '—'}</span>
        }
      </div>

      {/* Health status */}
      {healthSt && (
        <div className="hidden md:flex items-center gap-1.5 shrink-0 pr-4" title={healthSt.status !== 'checking' ? `Checked ${formatCheckedAt(healthSt.checkedAt, is24Hour)}` : undefined}>
          <HealthDot status={healthSt.status} />
          {healthSt.status !== 'checking' && (
            <>
              <span className={`text-label-md ${
                healthSt.status === 'ok'      ? 'text-success' :
                healthSt.status === 'error'   ? 'text-error' :
                healthSt.status === 'timeout' ? 'text-warning' :
                'text-on-surface-variant'
              }`}>
                {healthSt.status === 'ok' ? 'Online' : healthSt.status === 'error' ? 'Offline' : healthSt.status === 'timeout' ? 'Timeout' : 'Skipped'}
              </span>
              {/* Time only: a whole category is usually checked in one go. The full date and
                  time are in the tooltip above. */}
              <span className="text-label-sm font-mono font-normal text-on-surface-variant">
                {formatTime(healthSt.checkedAt, is24Hour)}
              </span>
            </>
          )}
        </div>
      )}

      {/* Row actions. The link button always shows on a linked channel and the eye on a hidden
          one, because they say something about the channel; the rest appear on hover. The ⋮
          opens the right-click menu (insert, stream headers, delete), so nothing in it needs a
          right-click: touch screens can't do one, and many mouse users never try. Touch screens
          find Delete in that menu instead of as a fourth always-visible button. */}
      <div className="w-[9.75rem] no-hover:w-[9.5rem] shrink-0 flex items-center justify-end pr-2.5">
        <button
          {...syncTriggerProps}
          className={`md-btn icon-btn w-9 h-9 ${channel.link ? 'text-primary' : reveal}`}
          title={channel.link ? 'Sync settings' : 'Link to source'}
        >
          <Icon name="link" className="text-[20px]" />
        </button>
        <button
          onClick={() => onToggleHide(channel.id, !!channel.isHidden)}
          className={`md-btn icon-btn w-9 h-9 ${channel.isHidden ? '' : reveal}`}
          title={channel.isHidden ? 'Include in export' : 'Exclude from export'}
        >
          {channel.isHidden ? <Icon name="visibility_off" className="text-[20px]" /> : <Icon name="visibility" className="text-[20px]" />}
        </button>
        {canHover && (
          <button
            onClick={() => onDelete(channel.id)}
            className={`md-btn icon-btn w-9 h-9 hover:text-error ${reveal}`}
            title="Delete channel"
          >
            <Icon name="delete" className="text-[20px]" />
          </button>
        )}
        <button
          // Same trick as the sync button: the menu's "click outside closes it" listener mustn't
          // see this click, so clicking ⋮ again closes the menu instead of reopening it.
          onMouseDown={e => e.stopPropagation()}
          onClick={e => onOpenMenu(channel.id, e.currentTarget.getBoundingClientRect())}
          className={`md-btn icon-btn w-9 h-9 ${reveal}`}
          title="More: insert a channel, stream headers, delete"
          aria-label="More channel actions"
        >
          <Icon name="more_vert" className="text-[20px]" />
        </button>
      </div>

      {/* Saving indicator — a save (rename, hide toggle, URL/TVG-ID edit) round-trips to
          the backend and then waits on a full channels refetch before the row shows the
          new value, which used to read as a stall. This indeterminate bar covers the row
          for that stretch instead. */}
      {isSaving && <div className="md-progress text-primary bg-primary/15" />}
    </div>
  );
}

/* ── Phone channel row ────────────────────────────────────────────────────── */
/**
 * A channel row on phones (below 768px), used instead of SortableChannelItem. The desktop
 * row's click-to-edit fields don't fit, so this one just shows the channel (logo, name,
 * link, small status icons) and the whole row is one big target:
 *
 * - tap: opens the channel editor sheet (ChannelEditSheet)
 * - long-press: selects it; while anything is selected, a tap selects/deselects instead
 * - Reorder mode (toolbar ⋮): a grip appears on the right to drag with
 *
 * It's still a dnd-kit sortable item, so reordering works the same as on desktop.
 */
function PhoneChannelRow({
  channel, isSelected, selectionMode, reorderMode, isHighlighted, healthSt, isSaving,
  onOpen, onToggleSelect,
}: {
  key?: string | number;
  channel: Channel;
  isSelected: boolean;
  selectionMode: boolean;
  reorderMode: boolean;
  isHighlighted: boolean;
  healthSt?: HealthEntry;
  isSaving?: boolean;
  onOpen: (id: string) => void;
  onToggleSelect: (id: string) => void;
}) {
  const { logoBgColor, hideUrls } = useStore();
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: channel.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const longPress = useLongPress(() => { if (!reorderMode) onToggleSelect(channel.id); });
  const hasPendingSync = !!channel.link && Object.keys(channel.link.pending).length > 0;
  const hasHeaders = !!(channel.httpReferrer || channel.httpUserAgent);

  const handleTap = () => {
    if (reorderMode) return;
    if (selectionMode) onToggleSelect(channel.id);
    else onOpen(channel.id);
  };

  const rowBg = isHighlighted ? 'bg-tertiary-container' : isSelected ? 'bg-secondary-container' : '';
  const dim = channel.isHidden ? 'opacity-50' : '';

  return (
    <div
      id={`ch-${channel.id}`}
      ref={setNodeRef}
      style={style}
      // select-none and no callout: a long-press selects the row instead of selecting text or
      // opening the phone's own link/image menu. preventDefault stops Android's long-press
      // from also opening the desktop right-click menu.
      className={`relative flex items-center h-16 pl-4 border-b border-outline-variant/60 select-none [-webkit-touch-callout:none] ${reorderMode ? '' : 'cursor-pointer active:bg-on-surface/[0.08]'} ${rowBg}`}
      onContextMenu={e => e.preventDefault()}
      onClick={handleTap}
      {...(reorderMode ? {} : longPress)}
    >
      {selectionMode && (
        <span className="shrink-0 mr-3.5 flex">
          <Checkbox checked={isSelected} className="w-5 h-5" />
        </span>
      )}

      <ChannelLogo
        logo={channel.logo}
        name={channel.name}
        logoBgColor={logoBgColor}
        className={`shrink-0 w-12 h-8 rounded-md ${dim}`}
      />

      <div className={`flex-1 min-w-0 ml-3.5 pr-2 flex flex-col justify-center ${dim}`}>
        <p className="text-[15px] leading-5 font-medium text-on-surface truncate">
          {channel.name || 'Unnamed'}
        </p>
        {!hideUrls && (
          <p className="text-body-sm font-mono text-on-surface-variant truncate">{channel.url || '— no url —'}</p>
        )}
      </div>

      {/* Small status icons: what the desktop row shows as chips and buttons. */}
      <div className="shrink-0 flex items-center gap-2.5 pr-3.5 text-on-surface-variant">
        {healthSt && <HealthDot status={healthSt.status} />}
        {hasHeaders && <Icon name="tune" className="text-[20px]" aria-label="Has stream headers" />}
        {channel.isHidden && <Icon name="visibility_off" className="text-[20px]" aria-label="Hidden" />}
        {channel.link?.lost && <span className={`tag ${isSelected ? 'tag-on-selected' : ''}`}>Lost</span>}
        {channel.link && <Icon name="link" className="text-[20px] text-primary" aria-label="Kept in sync" />}
        {hasPendingSync && (
          <span className="block w-2 h-2 rounded-full bg-primary" aria-label="Changes from the source are waiting" />
        )}
      </div>

      {reorderMode && (
        // touch-none lets a finger drag the grip instead of scrolling the list.
        <div
          {...attributes} {...listeners}
          onClick={e => e.stopPropagation()}
          className="shrink-0 self-stretch w-12 flex items-center justify-center touch-none cursor-grab active:cursor-grabbing text-on-surface-variant"
          aria-label="Drag to reorder"
        >
          <Icon name="drag_indicator" className="text-[24px]" />
        </div>
      )}

      {isSaving && <div className="md-progress text-primary bg-primary/15" />}
    </div>
  );
}

/* ── Main editor ──────────────────────────────────────────────────────────── */
/**
 * `phoneMenuSlot`: the spot in Dashboard's phone top bar where this editor puts its ⋮ menu.
 * On phones there's no toolbar of its own; every playlist action lives in that one menu.
 */
export default function PlaylistEditor({ playlistId, phoneMenuSlot }: { playlistId: string; phoneMenuSlot?: HTMLElement | null }) {
  const { playlists } = usePlaylists();
  const playlist = playlists.find(p => p.id === playlistId);
  const { channels, loading, error: channelsError, refetch: refetchChannels } = useChannels(playlistId);

  const [showExportDialog, setShowExportDialog] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedEpg, setCopiedEpg] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [bulkCategory, setBulkCategory] = useState('');
  const [showCategoryPrompt, setShowCategoryPrompt] = useState(false);
  const [newBulkCategoryName, setNewBulkCategoryName] = useState('');
  const [activeEditId, setActiveEditId] = useState<string | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  // The name column's width while its divider is being dragged; saved to the store on release.
  const [draggedNameWidth, setDraggedNameWidth] = useState<number | null>(null);
  const resizing = useRef<{ startX: number; startW: number } | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const pendingScrollId = useRef<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ channelId: string; x: number; y: number } | null>(null);
  // The channel whose Stream headers dialog is open (from its chip or the right-click menu).
  const [headersChannelId, setHeadersChannelId] = useState<string | null>(null);
  const headersChannel = headersChannelId ? channels.find(c => c.id === headersChannelId) : undefined;
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const pendingInsert = useRef<{ newId: string; insertAfterIndex: number } | null>(null);
  // Channel ids with an in-flight single-field save (rename, hide toggle, URL/TVG-ID edit),
  // so their row can show a "saving" indicator instead of just sitting on stale data.
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const markSaving = (id: string) => setSavingIds(prev => new Set(prev).add(id));
  const clearSaving = (id: string) => setSavingIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  const [healthStatus, setHealthStatus] = useState<Map<string, HealthEntry>>(new Map());
  const [healthProgress, setHealthProgress] = useState<{ done: number; total: number } | null>(null);
  const [showHealthMenu, setShowHealthMenu] = useState(false);
  const cancelHealthRef = useRef(false);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [frSearch, setFrSearch] = useState('');
  const [frReplace, setFrReplace] = useState('');
  const [frScope, setFrScope] = useState<'playlist' | 'category' | 'selected'>('category');
  const [frField, setFrField] = useState<'url' | 'name'>('url');
  const [frResult, setFrResult] = useState<{ modified: number } | null>(null);
  const [frRunning, setFrRunning] = useState(false);
  const [showBulkEpg, setShowBulkEpg] = useState(false);

  // Channel sync UI
  const { sources: poolSources } = useChannelPoolSources();
  const [syncPopover, setSyncPopover] = useState<{ channelId: string; anchor: DOMRect } | null>(null);
  const [linkDialogChannelId, setLinkDialogChannelId] = useState<string | null>(null);
  const [showSyncLog, setShowSyncLog] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  const [showBulkSyncSettings, setShowBulkSyncSettings] = useState(false);

  // Phones: the channel editor sheet (tap a row) and Reorder mode (toolbar ⋮). See PhoneChannelRow.
  const isPhone = useIsPhone();
  const [editSheetChannelId, setEditSheetChannelId] = useState<string | null>(null);
  // A channel being added on a phone. It only exists in this form until Add is pressed, so
  // Cancel leaves nothing behind. `insert` is set when it came from "Insert above/below".
  const [newChannelDraft, setNewChannelDraft] = useState<{ insert?: { anchorId: string; position: 'above' | 'below' } } | null>(null);
  const [reorderMode, setReorderMode] = useState(false);

  // Resolved tvg-id labels: maps tvgId -> { displayName, sourceName }
  const [tvgIdLabels, setTvgIdLabels] = useState<Record<string, { displayName: string; sourceName: string }>>({});

  useEffect(() => {
    const tvgIds = channels.map(c => c.tvgId).filter(Boolean) as string[];
    if (tvgIds.length === 0) {
      // Avoid a setState (and the render it schedules) when there's nothing to clear —
      // `channels` can otherwise change reference on every render while a fetch is in
      // flight (see useChannels in apiClient.ts), which would re-fire this effect and
      // set a brand-new (but equally empty) object every time, forever, until the fetch
      // resolves.
      setTvgIdLabels(prev => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    // Deduplicate
    const unique = [...new Set(tvgIds)];
    api.resolveTvgIds(unique).then(setTvgIdLabels).catch(e => { console.error(e); notifyError(e, 'Failed to resolve EPG channel names.'); });
  }, [channels]);

  const { activeCategory, setActiveCategory, nameColumnWidth, setNameColumnWidth, setUndoEntry, scrollTarget, setScrollTarget, syncLogOpenFor, setSyncLogOpenFor, hideUrls, setHideUrls } = useStore();

  // Sync panels belong to one playlist, so switching playlists closes them. This runs before the
  // effect below, so a sync log requested for the playlist being opened still opens.
  useEffect(() => {
    setShowSyncLog(false);
    setSyncPopover(null);
    setLinkDialogChannelId(null);
    setEditSheetChannelId(null);
    setNewChannelDraft(null);
    setReorderMode(false);
  }, [playlistId]);

  // The phone channel editor follows its channel in the live list, and closes once the
  // channel is gone (deleted).
  const editSheetChannel = editSheetChannelId ? channels.find(c => c.id === editSheetChannelId) : undefined;
  useEffect(() => {
    if (editSheetChannelId && !editSheetChannel) setEditSheetChannelId(null);
  }, [editSheetChannelId, editSheetChannel]);

  // Growing past phone size (a tablet rotated, a window widened) ends the phone-only modes.
  useEffect(() => {
    if (!isPhone) { setEditSheetChannelId(null); setNewChannelDraft(null); setReorderMode(false); }
  }, [isPhone]);

  // Home's "Sync updates waiting" card asks for this playlist's sync log.
  useEffect(() => {
    if (syncLogOpenFor !== playlistId) return;
    setShowSyncLog(true);
    setSyncLogOpenFor(null);
  }, [syncLogOpenFor, playlistId, setSyncLogOpenFor]);
  const scrollToChannelId = scrollTarget?.kind === 'playlist' ? scrollTarget.id : null;

  const categories = useMemo(() => playlist?.categories || [], [playlist?.categories]);

  // Optimistic local order: updated immediately on drag so the drop animation
  // sees the item in its new slot instead of snapping back to the original.
  const [localOrder, setLocalOrder] = useState<Channel[] | null>(null);
  const baseChannels = useMemo(() => channels.filter(c => c.category === activeCategory), [channels, activeCategory]);
  // Whenever the server-fetched channels change, discard any stale optimistic order.
  useEffect(() => { setLocalOrder(null); }, [channels]);
  const displayedChannels = localOrder ?? baseChannels;

  const [currentPage, setCurrentPage] = useState(1);
  const [pageInputValue, setPageInputValue] = useState('1');
  const pageSize = 100;
  const listScrollRef = useRef<HTMLDivElement>(null);

  // ── Column widths ──
  // The list's own width is measured (it changes with the window, the list pane beside it
  // and the sync log), so the columns can share it sensibly instead of guessing from the
  // window's width.
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  const [listWidth, setListWidth] = useState(0);
  const attachList = useCallback((el: HTMLDivElement | null) => {
    listScrollRef.current = el;
    setListEl(el);
  }, []);
  useEffect(() => {
    if (!listEl) return;
    const measure = () => setListWidth(listEl.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(listEl);
    return () => observer.disconnect();
  }, [listEl]);
  // What the name and TV guide columns have to share: the row minus its fixed parts (handle,
  // checkbox and logo on the left ≈ 136px, the four buttons on the right = 156px; on touch
  // screens, with their bigger targets, 152px each: three buttons there, Delete is under ⋮).
  const sharedWidth = Math.max(0, listWidth - (canHover ? 292 : 304));
  // Left alone, the TV guide column gets about 38% (between 200 and 380px, enough for a
  // guide name) and the name and stream link get the rest, so no column is left half empty.
  const autoNameWidth = sharedWidth - Math.max(200, Math.min(380, sharedWidth * 0.38));
  // A width set by dragging the divider is remembered (nameColumnWidth in the store, kept
  // across screens and reloads). Either way the TV guide column keeps at least 120px.
  const nameWidth = Math.round(Math.max(140, Math.min(draggedNameWidth ?? nameColumnWidth ?? autoNameWidth, sharedWidth - 120)));
  const colWidths = { name: nameWidth };

  useEffect(() => {
    setCurrentPage(1);
  }, [activeCategory, playlistId, frSearch]);

  useEffect(() => {
    setPageInputValue(String(currentPage));
  }, [currentPage]);

  const handlePageChange = (p: number) => {
    setCurrentPage(p);
    listScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const totalPages = Math.max(1, Math.ceil(displayedChannels.length / pageSize));
  const paginatedChannels = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return displayedChannels.slice(start, start + pageSize);
  }, [displayedChannels, currentPage]);

  // Jump to a specific channel requested externally (e.g. Spotlight search). The channel
  // may be on any page, so first flip to the page it actually lives on...
  useEffect(() => {
    if (!scrollToChannelId) return;
    const idx = baseChannels.findIndex(c => c.id === scrollToChannelId);
    if (idx === -1) return;
    const targetPage = Math.floor(idx / pageSize) + 1;
    if (targetPage !== currentPage) setCurrentPage(targetPage);
  }, [scrollToChannelId, baseChannels, currentPage]);

  // ...then, once that page has actually rendered the row, scroll to it and highlight it.
  // Instant rather than smooth: a `behavior: 'smooth'` scroll isn't guaranteed to actually
  // animate (observed stalling outright in some environments), which would leave the row
  // scrolled nowhere near view.
  useEffect(() => {
    if (!scrollToChannelId) return;
    const el = document.getElementById(`ch-${scrollToChannelId}`);
    if (!el) return;
    setScrollTarget(null);
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    setHighlightedId(scrollToChannelId);
    const t = setTimeout(() => setHighlightedId(null), 2000);
    return () => clearTimeout(t);
  }, [scrollToChannelId, paginatedChannels, setScrollTarget]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Whether most of the selection is hidden. Counted across the whole playlist, because the
  // selection survives switching category; the phone selection bar's eye icon and what it
  // does both come from this, so they can't disagree.
  const selectedChannels = channels.filter(c => selectedIds.has(c.id));
  const selectionMostlyHidden = selectedChannels.length > 0
    && selectedChannels.filter(c => c.isHidden).length >= selectedChannels.length / 2;

  // Hides every selected channel, or shows them again if most are already hidden. Used by the
  // Space shortcut and by the phone selection bar's eye button.
  const toggleSelectedHidden = async () => {
    try {
      await api.bulkUpdateChannels(playlistId, Array.from(selectedIds), { isHidden: !selectionMostlyHidden });
      triggerRefresh();
    } catch (e) { console.error(e); notifyError(e, 'Failed to update channels.'); }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const typing = document.activeElement instanceof HTMLInputElement
        || document.activeElement instanceof HTMLTextAreaElement;
      // While a sync dialog, popover or the phone channel editor is open, Space/Delete/Escape
      // belong to it (e.g. Space toggles a focused checkbox there), not to the selected channels behind it.
      if (typing || contextMenu || syncPopover || linkDialogChannelId || showBulkSyncSettings || headersChannelId || editSheetChannelId || newChannelDraft) return;
      if (e.key === 'Escape' && selectedIds.size > 0) {
        setSelectedIds(new Set()); setLastSelectedId(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault(); setShowBulkDeleteConfirm(true);
      } else if (e.key === ' ' && selectedIds.size > 0) {
        e.preventDefault();
        toggleSelectedHidden();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        setSelectedIds(new Set(displayedChannels.map(c => c.id)));
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedIds, channels, displayedChannels, playlistId, contextMenu, syncPopover, linkDialogChannelId, showBulkSyncSettings, headersChannelId, editSheetChannelId, newChannelDraft]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const el = contextMenuRef.current;
    const margin = 8;
    const rect = el.getBoundingClientRect();
    const top = Math.max(margin, Math.min(contextMenu.y, window.innerHeight - rect.height - margin));
    const left = Math.max(margin, Math.min(contextMenu.x, window.innerWidth - rect.width - margin));
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }, [contextMenu]);

  useEffect(() => {
    const pending = pendingInsert.current;
    if (!pending) return;
    const newCh = displayedChannels.find(c => c.id === pending.newId);
    if (!newCh) return;
    pendingInsert.current = null;

    const withoutNew = displayedChannels.filter(c => c.id !== pending.newId);
    const insertAt = Math.max(0, Math.min(pending.insertAfterIndex + 1, withoutNew.length));
    const reordered = [...withoutNew.slice(0, insertAt), newCh, ...withoutNew.slice(insertAt)];

    const orders: Record<string, number> = {};
    reordered.forEach((ch, i) => {
      if (ch.order !== displayedChannels[i].order) orders[ch.id] = displayedChannels[i].order;
    });

    if (Object.keys(orders).length > 0) {
      api.reorderChannels(playlistId, orders)
        .then(() => { pendingScrollId.current = pending.newId; triggerRefresh(); })
        .catch(e => { console.error(e); notifyError(e, 'Failed to reorder channels.'); });
    } else {
      pendingScrollId.current = pending.newId;
    }
  }, [displayedChannels]);

  useEffect(() => {
    const id = pendingScrollId.current;
    if (!id) return;
    const el = document.getElementById(`ch-${id}`);
    if (!el) return;
    pendingScrollId.current = null;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setHighlightedId(id);
    const t = setTimeout(() => setHighlightedId(null), 2000);
    return () => clearTimeout(t);
  }, [displayedChannels]);

  if (!playlist) return null;

  const exportUrl = `${window.location.protocol}//${window.location.host}/${playlist.shortId}`;
  const epgUrl = `${window.location.protocol}//${window.location.host}/${playlist.shortId}/epg`;

  /* ── Handlers ──────────────────────────────────────────────────────────── */

  const copyText = async (text: string, setFlag: (v: boolean) => void) => {
    if (!(await copyToClipboard(text))) { notifyError(null, 'Failed to copy to clipboard.'); return; }
    setFlag(true);
    setTimeout(() => setFlag(false), 2000);
  };

  const copyPlaylistUrl = () => copyText(exportUrl, setCopied);
  const copyEpgUrl = () => copyText(epgUrl, setCopiedEpg);

  const toggleSelection = (id: string, shiftKey: boolean) => {
    const next = new Set(selectedIds);
    if (shiftKey && lastSelectedId) {
      const a = displayedChannels.findIndex(c => c.id === lastSelectedId);
      const b = displayedChannels.findIndex(c => c.id === id);
      if (a !== -1 && b !== -1) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(displayedChannels[i].id);
    } else {
      next.has(id) ? next.delete(id) : next.add(id);
    }
    setSelectedIds(next);
    setLastSelectedId(id);
  };

  const selectAll = () => {
    setSelectedIds(selectedIds.size === displayedChannels.length && displayedChannels.length > 0
      ? new Set()
      : new Set(displayedChannels.map(c => c.id)));
  };

  // Saves changed fields of one channel. Shared by the desktop row's click-to-edit fields,
  // the Stream headers dialog and the phone channel editor. Throws if the save failed, so
  // each caller can show its own message and keep its form open.
  const handleChannelSave = async (id: string, changes: Record<string, unknown>) => {
    markSaving(id);
    try {
      // The server answers with the saved channel, which goes straight into the list, so the
      // row shows the new value as soon as the save is done and nothing is downloaded again.
      applySavedChannel(await api.updateChannel(playlistId, id, changes));
    } finally { clearSaving(id); }
  };

  const handleChannelUpdate = async (id: string, field: string, value: string) => {
    try { await handleChannelSave(id, { [field]: value.trim() || null }); }
    catch (e) { console.error(e); notifyError(e, 'Failed to save channel.'); }
  };

  // Save in the phone channel editor: the channel's own fields, then its sync settings if
  // those checkboxes changed too.
  const handleSheetSave = async (id: string, changes: ChannelChanges, syncFields?: SyncFieldToggles) => {
    try {
      if (Object.keys(changes).length > 0) await handleChannelSave(id, changes);
      if (syncFields) {
        await api.updateChannelLink(playlistId, id, syncFields);
        triggerRefresh();
      }
    } catch (e) { console.error(e); notifyError(e, 'Failed to save channel.'); throw e; }
  };

  const handleToggleHide = async (id: string, current: boolean) => {
    markSaving(id);
    try {
      applySavedChannel(await api.updateChannel(playlistId, id, { isHidden: !current }));
    } catch (e) { console.error(e); notifyError(e, 'Failed to update channel.'); }
    finally { clearSaving(id); }
  };

  const handleSingleDelete = async (id: string) => {
    const channel = channels.find(c => c.id === id);
    if (!channel) return;
    try {
      await api.deleteChannel(playlistId, id);
      triggerRefresh();
      const { id: _id, playlistId: _pid, createdAt: _c, updatedAt: _u, ...rest } = channel;
      setUndoEntry({
        description: `Deleted "${channel.name}"`,
        restore: async () => { await api.bulkAddChannels(playlistId, [rest]); triggerRefresh(); },
      });
    } catch (e) { console.error(e); notifyError(e, 'Failed to delete channel.'); }
  };

  const openSync = (channelId: string, anchor: DOMRect) => {
    setContextMenu(null);
    const channel = channels.find(c => c.id === channelId);
    if (!channel) return;
    if (!channel.link) {
      setSyncPopover(null);
      setLinkDialogChannelId(channelId);
      return;
    }
    setSyncPopover(prev => prev?.channelId === channelId ? null : { channelId, anchor });
  };

  const selectedLinkedChannels = channels.filter(c => c.link && selectedIds.has(c.id));

  const handleBulkUnlink = async () => {
    try {
      const result = await api.bulkUnlinkChannels(playlistId, selectedLinkedChannels.map(c => c.id));
      triggerRefresh();
      triggerChannelPoolRefresh();
      notifyInfo(`Unlinked ${result.unlinked} channel${result.unlinked !== 1 ? 's' : ''}. ${result.unlinked !== 1 ? 'They stay' : 'It stays'} in your playlist but won't sync anymore.`);
    } catch (e) { console.error(e); notifyError(e, "Couldn't unlink the channels. Try again."); }
  };

  // From the sync log: show the channel's category and let the existing scroll-to-row flow
  // (the same one Spotlight uses) find its page, scroll to it and highlight it.
  const jumpToChannel = (channel: Channel) => {
    // On a phone the log covers the list, so get it out of the way.
    if (isPhone) setShowSyncLog(false);
    setActiveCategory(channel.category);
    setScrollTarget({ kind: 'playlist', id: channel.id });
  };

  const syncPopoverChannel = syncPopover ? channels.find(c => c.id === syncPopover.channelId && c.link) : undefined;
  const linkDialogChannel = linkDialogChannelId ? channels.find(c => c.id === linkDialogChannelId) : undefined;
  const unreadSyncLogCount = playlist.unreadSyncLogCount || 0;

  const executeBulkMove = async (targetCategory: string) => {
    if (!targetCategory) return;
    try {
      await api.bulkUpdateChannels(playlistId, Array.from(selectedIds), { category: targetCategory });
      triggerRefresh();
      setBulkCategory(''); setSelectedIds(new Set()); setLastSelectedId(null);
    } catch (e) { console.error(e); notifyError(e, 'Failed to move channels.'); }
  };

  const handleBulkMove = async (val: string) => {
    if (val === 'NEW_CATEGORY') { setNewBulkCategoryName(''); setShowCategoryPrompt(true); }
    else if (val) await executeBulkMove(val);
  };

  const confirmBulkDelete = async () => {
    const toDelete = channels.filter(c => selectedIds.has(c.id));
    try {
      await api.bulkDeleteChannels(playlistId, Array.from(selectedIds));
      triggerRefresh(); setSelectedIds(new Set()); setLastSelectedId(null);
      const restoreData = toDelete.map(({ id: _id, playlistId: _pid, createdAt: _c, updatedAt: _u, ...rest }) => rest);
      setUndoEntry({
        description: `Deleted ${toDelete.length} channel${toDelete.length !== 1 ? 's' : ''}`,
        restore: async () => { await api.bulkAddChannels(playlistId, restoreData); triggerRefresh(); },
      });
    } catch (e) { console.error(e); notifyError(e, 'Failed to delete channels.'); }
    finally { setShowBulkDeleteConfirm(false); }
  };

  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = displayedChannels.findIndex(c => c.id === active.id);
      const newIndex = displayedChannels.findIndex(c => c.id === over.id);
      const reordered = arrayMove(displayedChannels, oldIndex, newIndex) as Channel[];
      // Optimistically update local order immediately so dnd-kit's drop animation
      // sees the item already at the new position and does not snap it back.
      setLocalOrder(reordered);
      const start = Math.min(oldIndex, newIndex);
      const end = Math.max(oldIndex, newIndex);
      const orders: Record<string, number> = {};
      for (let i = start; i <= end; i++) orders[reordered[i].id] = displayedChannels[i].order;
      try { await api.reorderChannels(playlistId, orders); triggerRefresh(); }
      catch (e) { console.error(e); notifyError(e, 'Failed to reorder channels.'); setLocalOrder(null); }
    }
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = { startX: e.clientX, startW: colWidths.name };
    let width = colWidths.name;
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      width = Math.max(140, resizing.current.startW + ev.clientX - resizing.current.startX);
      setDraggedNameWidth(width);
    };
    const onUp = () => {
      resizing.current = null;
      setNameColumnWidth(width);
      setDraggedNameWidth(null);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleInsertChannel = async (channelId: string, position: 'above' | 'below') => {
    setContextMenu(null);
    const targetIndex = displayedChannels.findIndex(c => c.id === channelId);
    if (targetIndex === -1) return;
    try {
      const resp = await api.bulkAddChannels(playlistId, [{
        name: 'New Channel', url: '', logo: '', tvgId: '',
        category: activeCategory || 'General',
        order: channels.length,
      }]);
      const data = await resp.json();
      if (data.ids?.[0]) {
        pendingInsert.current = {
          newId: data.ids[0],
          insertAfterIndex: position === 'above' ? targetIndex - 1 : targetIndex,
        };
      }
      triggerRefresh();
    } catch (e) { console.error(e); notifyError(e, 'Failed to insert channel.'); }
  };

  const handleAddChannel = async () => {
    try {
      const resp = await api.bulkAddChannels(playlistId, [{
        name: 'New Channel', url: '', logo: '', tvgId: '',
        category: activeCategory || 'General',
        order: channels.length,
      }]);
      const data = await resp.json();
      if (data.ids?.[0]) pendingScrollId.current = data.ids[0];
      triggerRefresh();
    } catch (e) { console.error(e); notifyError(e, 'Failed to add channel.'); }
  };

  // Phones: adds the channel typed into the new-channel sheet. Nothing is created before this,
  // so cancelling the sheet leaves the playlist untouched. Positioned like "Insert above/below"
  // on a computer, as long as it stays in the category being viewed.
  const handleCreateChannel = async (values: ChannelChanges, insert?: { anchorId: string; position: 'above' | 'below' }) => {
    const category = values.category || activeCategory || 'General';
    const targetIndex = insert ? displayedChannels.findIndex(c => c.id === insert.anchorId) : -1;
    try {
      const resp = await api.bulkAddChannels(playlistId, [{
        name: values.name || 'New Channel',
        url: values.url || '',
        logo: values.logo || '',
        tvgId: values.tvgId || '',
        // Stream headers are only stored when set (see "Stream headers" in CLAUDE.md).
        ...(values.httpReferrer ? { httpReferrer: values.httpReferrer } : {}),
        ...(values.httpUserAgent ? { httpUserAgent: values.httpUserAgent } : {}),
        category,
        order: channels.length,
      }]);
      const data = await resp.json();
      const newId: string | undefined = data.ids?.[0];
      if (newId) {
        if (insert && targetIndex !== -1 && category === activeCategory) {
          pendingInsert.current = { newId, insertAfterIndex: insert.position === 'above' ? targetIndex - 1 : targetIndex };
        } else {
          pendingScrollId.current = newId;
        }
      }
      triggerRefresh();
    } catch (e) {
      console.error(e);
      notifyError(e, 'Failed to add channel.');
      throw e;
    }
  };

  const openFindReplace = () => {
    setShowFindReplace(true); setFrSearch(''); setFrReplace(''); setFrResult(null);
    setFrScope(selectedIds.size > 0 ? 'selected' : 'category');
  };

  const runHealthCheck = async (toCheck: Channel[]) => {
    if (healthProgress) return;
    setShowHealthMenu(false);
    cancelHealthRef.current = false;
    const BATCH = 8;
    setHealthStatus(prev => {
      const next = new Map(prev);
      toCheck.forEach(c => next.set(c.id, { status: 'checking', checkedAt: 0 }));
      return next;
    });
    setHealthProgress({ done: 0, total: toCheck.length });
    let batchFailures = 0;
    for (let i = 0; i < toCheck.length; i += BATCH) {
      if (cancelHealthRef.current) break;
      const batch = toCheck.slice(i, i + BATCH);
      try {
        const { results } = await api.healthCheck(batch.map(c => ({ id: c.id, url: c.url, referrer: c.httpReferrer, userAgent: c.httpUserAgent })));
        setHealthStatus(prev => {
          const next = new Map(prev);
          const now = Date.now();
          results.forEach((r: any) => {
            const status: HealthStatus = r.skipped ? 'skipped' : r.timeout ? 'timeout' : r.ok ? 'ok' : 'error';
            next.set(r.id, { status, checkedAt: now });
          });
          return next;
        });
      } catch (e) {
        console.error(e);
        batchFailures++;
        // Mark this batch's channels as errored instead of leaving them stuck on "checking".
        setHealthStatus(prev => {
          const next = new Map(prev);
          batch.forEach(c => next.set(c.id, { status: 'error', checkedAt: Date.now() }));
          return next;
        });
      }
      setHealthProgress({ done: Math.min(i + BATCH, toCheck.length), total: toCheck.length });
    }
    setHealthProgress(null);
    if (batchFailures > 0) {
      notifyError(null, `Health check failed for ${batchFailures} batch${batchFailures !== 1 ? 'es' : ''} of channels due to a network error.`);
    }
  };

  const cancelHealthCheck = () => {
    cancelHealthRef.current = true;
    setHealthProgress(null);
    setHealthStatus((prev: Map<string, HealthEntry>) => {
      const next = new Map(prev);
      next.forEach((entry, id) => { if (entry.status === 'checking') next.delete(id); });
      return next;
    });
  };

  /* ── Render ────────────────────────────────────────────────────────────── */

  const allShownSelected = displayedChannels.length > 0 && selectedIds.size === displayedChannels.length;
  const headerIcon = 'text-[20px]';

  return (
    // `@container`: the header buttons show their labels once the pane is wide enough. It's a
    // container query, so it follows the pane itself, whether or not the list beside it is open.
    <div className="@container flex flex-col h-full relative">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      {/* Tablets and computers only: on phones these actions are in the top bar's ⋮ menu (see
          the phone menu below). While channels are selected it turns into the selection bar. */}
      <header className="shrink-0 hidden md:flex items-center gap-1 min-h-[4.875rem] pl-6 pr-4 py-3">
        {selectedIds.size > 0 ? (
          // The keys make React build the two sets of buttons separately. Without them it reused
          // the filled "Link & download" button as Delete, whose background then visibly faded out.
          <React.Fragment key="selection">
            <button
              onClick={() => { setSelectedIds(new Set()); setLastSelectedId(null); }}
              className="md-btn icon-btn -ml-3 text-on-surface"
              aria-label="Clear selection"
              title="Clear selection (Esc)"
            >
              <Icon name="close" className="text-[24px]" />
            </button>
            <h2 className="flex-1 min-w-0 truncate pl-1 text-title-lg text-on-surface">{selectedIds.size} selected</h2>
            <select
              value={bulkCategory}
              onChange={e => handleBulkMove(e.target.value)}
              className="h-10 pl-4 pr-2 mr-1 rounded-full border border-outline bg-pane text-label-lg text-on-surface-variant cursor-pointer focus:outline-none focus:border-primary"
              aria-label="Move to category"
            >
              <option value="">Move to…</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
              <option value="NEW_CATEGORY">+ New category…</option>
            </select>
            {selectedLinkedChannels.length > 0 && (
              <>
                <button
                  onClick={() => setShowBulkSyncSettings(true)}
                  className="md-btn btn btn-text text-on-surface-variant"
                  title={`Sync settings for ${selectedLinkedChannels.length} linked channel${selectedLinkedChannels.length !== 1 ? 's' : ''}`}
                >
                  <Icon name="link" className={headerIcon} /><span className="hidden @3xl:inline">Sync</span>
                </button>
                <button
                  onClick={handleBulkUnlink}
                  className="md-btn btn btn-text text-on-surface-variant"
                  title={`Stop syncing ${selectedLinkedChannels.length} linked channel${selectedLinkedChannels.length !== 1 ? 's' : ''}`}
                >
                  <Icon name="link_off" className={headerIcon} /><span className="hidden @3xl:inline">Unlink</span>
                </button>
              </>
            )}
            <button
              onClick={() => runHealthCheck(channels.filter(c => selectedIds.has(c.id)))}
              disabled={!!healthProgress}
              className="md-btn btn btn-text text-on-surface-variant"
              title="Check the selected streams"
            >
              <Icon name="monitor_heart" className={headerIcon} /><span className="hidden @3xl:inline">Check</span>
            </button>
            <button onClick={() => setShowBulkDeleteConfirm(true)} className="md-btn btn btn-text text-error" title="Delete the selected channels">
              <Icon name="delete" className={headerIcon} /><span className="hidden @3xl:inline">Delete</span>
            </button>
          </React.Fragment>
        ) : (
          <React.Fragment key="actions">
            <div className="flex-1 min-w-0">
              {activeCategory && <p className="text-label-md text-on-surface-variant truncate">{playlist.name}</p>}
              <div className="flex items-baseline gap-2.5 min-w-0">
                <h2 className="min-w-0 truncate text-headline-sm tracking-[-0.01em] text-on-surface">{activeCategory || playlist.name}</h2>
                <span className="shrink-0 text-body-md text-on-surface-variant">
                  {displayedChannels.length} channel{displayedChannels.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>

            <button
              onClick={() => setShowSyncLog(s => !s)}
              className={`md-btn btn btn-text ${showSyncLog ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant'}`}
              title={unreadSyncLogCount > 0 ? `Sync log (${unreadSyncLogCount} new)` : 'Sync log'}
            >
              <Icon name="history" className={headerIcon} />
              <span className="hidden @4xl:inline">Sync log</span>
              {unreadSyncLogCount > 0 && <span className="badge">{unreadSyncLogCount > 99 ? '99+' : unreadSyncLogCount}</span>}
            </button>

            {/* Stream checks: a small menu, or the progress while a check runs. */}
            <div className="relative">
              {healthProgress ? (
                <div className="flex items-center gap-2 h-10 pl-3 pr-1 text-on-surface-variant">
                  <Icon name="monitor_heart" className={`${headerIcon} animate-pulse text-primary`} />
                  <span className="text-label-lg tabular-nums">{healthProgress.done}/{healthProgress.total}</span>
                  <button onClick={cancelHealthCheck} className="md-btn icon-btn w-8 h-8" title="Stop checking">
                    <Icon name="close" className="text-[20px]" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowHealthMenu(s => !s)}
                  disabled={channels.length === 0}
                  className="md-btn btn btn-text text-on-surface-variant"
                  title="Check streams"
                >
                  <Icon name="monitor_heart" className={headerIcon} />
                  <span className="hidden @4xl:inline">Check streams</span>
                  <Icon name="keyboard_arrow_down" className="text-[20px] -ml-1" />
                </button>
              )}
              {showHealthMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowHealthMenu(false)} />
                  <div className="md-menu menu absolute right-0 top-full mt-1 w-64 z-40">
                    <button onClick={() => runHealthCheck(displayedChannels)} className="md-btn menu-item">
                      <Icon name="monitor_heart" />
                      <span className="flex-1">Check this category</span>
                      <span className="text-label-md text-on-surface-variant">{displayedChannels.length}</span>
                    </button>
                    <button onClick={() => runHealthCheck(channels)} className="md-btn menu-item">
                      <Icon name="monitor_heart" />
                      <span className="flex-1">Check the whole playlist</span>
                      <span className="text-label-md text-on-surface-variant">{channels.length}</span>
                    </button>
                    {healthStatus.size > 0 && (
                      <>
                        <div className="menu-divider" />
                        <button onClick={() => { setHealthStatus(new Map()); setShowHealthMenu(false); }} className="md-btn menu-item">
                          <Icon name="close" />
                          Clear results
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => setShowBulkEpg(true)}
              disabled={channels.length === 0}
              className="md-btn btn btn-text text-on-surface-variant"
              title="Assign EPG automatically"
            >
              <Icon name="auto_fix_high" className={headerIcon} /><span className="hidden @4xl:inline">Assign EPG</span>
            </button>

            <OverflowMenu
              label="More playlist actions"
              items={[
                channels.length > 0 && { label: 'Find & Replace', icon: <Icon name="find_replace" className="text-[24px]" />, onClick: openFindReplace },
                channels.some(c => !c.isHidden) && { label: 'Channel list PDF', icon: <Icon name="picture_as_pdf" className="text-[24px]" />, onClick: () => setShowPdf(true) },
                {
                  label: hideUrls ? 'Show stream links' : 'Hide stream links',
                  icon: hideUrls ? <Icon name="visibility" className="text-[24px]" /> : <Icon name="visibility_off" className="text-[24px]" />,
                  onClick: () => setHideUrls(!hideUrls),
                },
              ]}
            />

            <button
              onClick={() => setShowExportDialog(true)}
              disabled={channels.length === 0}
              className="md-btn btn btn-filled ml-2"
              title="The playlist's link for your player, and downloads"
            >
              <Icon name="download" className={headerIcon} />
              <span className="hidden @2xl:inline">Link &amp; download</span>
            </button>
          </React.Fragment>
        )}
      </header>

      {/* ── Phones: every playlist action, in the top bar's ⋮ ─────────────── */}
      {isPhone && phoneMenuSlot && createPortal(
        <OverflowMenu
          label="Playlist actions"
          showDot={unreadSyncLogCount > 0}
          buttonClassName="w-12 h-12 text-on-surface"
          items={[
            channels.length > 0 && { label: 'Playlist link & download', icon: <Icon name="download" className="text-[24px]" />, onClick: () => setShowExportDialog(true) },
            {
              label: 'Sync log', icon: <Icon name="history" className="text-[24px]" />,
              hint: unreadSyncLogCount > 0 ? `${unreadSyncLogCount > 99 ? '99+' : unreadSyncLogCount} new` : undefined,
              onClick: () => setShowSyncLog(true),
            },
            displayedChannels.length > 0 && {
              label: 'Select channels', icon: <Icon name="checklist" className="text-[24px]" />,
              onClick: () => { setReorderMode(false); setSelectedIds(new Set(displayedChannels.map(c => c.id))); },
            },
            displayedChannels.length > 1 && {
              label: 'Reorder channels', icon: <Icon name="swap_vert" className="text-[24px]" />,
              onClick: () => { setSelectedIds(new Set()); setReorderMode(true); },
            },
            channels.length > 0 && { label: 'Find & Replace', icon: <Icon name="find_replace" className="text-[24px]" />, onClick: openFindReplace },
            channels.length > 0 && { label: 'Assign EPG automatically', icon: <Icon name="auto_fix_high" className="text-[24px]" />, onClick: () => setShowBulkEpg(true) },
            !healthProgress && displayedChannels.length > 0 && {
              label: 'Check streams in this category', icon: <Icon name="monitor_heart" className="text-[24px]" />,
              hint: String(displayedChannels.length), onClick: () => runHealthCheck(displayedChannels),
            },
            !healthProgress && channels.length > 0 && {
              label: 'Check the whole playlist', icon: <Icon name="monitor_heart" className="text-[24px]" />,
              hint: String(channels.length), onClick: () => runHealthCheck(channels),
            },
            !healthProgress && healthStatus.size > 0 && { label: 'Clear check results', icon: <Icon name="close" className="text-[24px]" />, onClick: () => setHealthStatus(new Map()) },
            channels.some(c => !c.isHidden) && { label: 'Channel list PDF', icon: <Icon name="picture_as_pdf" className="text-[24px]" />, onClick: () => setShowPdf(true) },
            {
              label: hideUrls ? 'Show stream links' : 'Hide stream links',
              icon: hideUrls ? <Icon name="visibility" className="text-[24px]" /> : <Icon name="visibility_off" className="text-[24px]" />,
              onClick: () => setHideUrls(!hideUrls),
            },
          ]}
        />,
        phoneMenuSlot,
      )}

      {/* ── Phones: stream check progress (on bigger screens it's in the header) ── */}
      {healthProgress && (
        <div className="md:hidden shrink-0 flex items-center gap-3 h-12 pl-4 pr-1 bg-secondary-container text-on-secondary-container">
          <Icon name="monitor_heart" className="text-[24px] shrink-0 animate-pulse" />
          <span className="flex-1 min-w-0 text-body-md tabular-nums">
            Checking streams… {healthProgress.done}/{healthProgress.total}
          </span>
          <button onClick={cancelHealthCheck} className="md-btn btn btn-text text-on-secondary-container">
            Stop
          </button>
        </div>
      )}

      {/* ── Phone Reorder mode ───────────────────────────────────────────── */}
      {reorderMode && (
        <div className="md:hidden shrink-0 flex items-center gap-3 h-14 pl-4 pr-2 bg-secondary-container text-on-secondary-container">
          <Icon name="swap_vert" className="text-[24px] shrink-0" />
          <span className="flex-1 min-w-0 text-body-md">Drag the handles to reorder</span>
          <button onClick={() => setReorderMode(false)} className="md-btn btn btn-filled">
            Done
          </button>
        </div>
      )}

      {/* ── Channel list ─────────────────────────────────────────────────── */}
      {/* pb-24 keeps the last row clear of the round + button. */}
      <div ref={attachList} className="flex-1 overflow-y-auto pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-body-md text-on-surface-variant animate-pulse">
            Loading channels…
          </div>
        ) : channels.length === 0 && channelsError ? (
          <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
            <p className="text-body-lg text-error">{channelsError}</p>
            <button onClick={() => refetchChannels()} className="md-btn btn btn-filled mt-5">
              Retry
            </button>
          </div>
        ) : channels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-5 bg-secondary-container text-on-secondary-container">
              <Icon name="stacks" className="text-[28px]" />
            </div>
            <p className="text-title-md text-on-surface">No channels yet</p>
            <p className="mt-1 text-body-md text-on-surface-variant max-w-xs">Add channels yourself, or bring them in from the Sources tab.</p>
            <button onClick={isPhone ? () => setNewChannelDraft({}) : handleAddChannel} className="md-btn btn btn-filled mt-6">
              <Icon name="add" className="text-[20px]" />
              Add channel
            </button>
          </div>
        ) : (
          <div>

            {/* Column header */}
            <div className="sticky top-0 z-10 hidden md:flex items-center h-10 pl-2 bg-pane border-b border-outline-variant select-none text-label-md text-on-surface-variant">
              <div className="w-6 no-hover:w-10 shrink-0" />
              <button onClick={selectAll} className="md-btn icon-btn w-10 h-10" aria-label={allShownSelected ? 'Deselect all' : 'Select all in this category'}>
                <Checkbox checked={allShownSelected} mixed={!allShownSelected && selectedIds.size > 0} />
              </button>
              <div className="w-16 shrink-0" />
              {/* Name column — resizable */}
              <div className="relative shrink-0 pl-3" style={{ width: colWidths.name }}>
                Channel
                <div
                  onMouseDown={startResize}
                  onDoubleClick={() => setNameColumnWidth(null)}
                  title="Drag to resize. Double-click to go back to the automatic width."
                  className="absolute right-0 top-0 bottom-0 w-3 flex items-center justify-center cursor-col-resize"
                >
                  <div className="w-px h-4 bg-outline-variant rounded-full" />
                </div>
              </div>
              <div className="flex-1 pr-4">TV guide</div>
              <div className="w-[9.75rem] no-hover:w-[9.5rem] shrink-0" />
            </div>

            {/* Rows */}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
              <SortableContext items={paginatedChannels.map(c => c.id)} strategy={verticalListSortingStrategy}>
                {paginatedChannels.map((channel) => isPhone ? (
                  <PhoneChannelRow
                    key={channel.id}
                    channel={channel}
                    isSelected={selectedIds.has(channel.id)}
                    selectionMode={selectedIds.size > 0}
                    reorderMode={reorderMode}
                    isHighlighted={channel.id === highlightedId}
                    healthSt={healthStatus.get(channel.id)}
                    isSaving={savingIds.has(channel.id)}
                    onOpen={setEditSheetChannelId}
                    onToggleSelect={id => toggleSelection(id, false)}
                  />
                ) : (
                  <SortableChannelItem
                    key={channel.id}
                    channel={channel}
                    isSelected={selectedIds.has(channel.id)}
                    toggleSelection={toggleSelection}
                    onUpdate={handleChannelUpdate}
                    onDelete={handleSingleDelete}
                    onToggleHide={handleToggleHide}
                    activeEditId={activeEditId}
                    setActiveEditId={setActiveEditId}
                    colWidths={colWidths}
                    isHighlighted={channel.id === highlightedId}
                    onRightClick={e => { e.preventDefault(); setContextMenu({ channelId: channel.id, x: e.clientX, y: e.clientY }); }}
                    healthSt={healthStatus.get(channel.id)}
                    tvgIdLabel={channel.tvgId ? tvgIdLabels[channel.tvgId] : undefined}
                    isSaving={savingIds.has(channel.id)}
                    onOpenSync={openSync}
                    onEditHeaders={setHeadersChannelId}
                    onOpenMenu={(id, rect) => setContextMenu(current =>
                      current?.channelId === id ? null : { channelId: id, x: rect.right - 220, y: rect.bottom + 4 })}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        )}
      </div>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="shrink-0 flex items-center justify-between h-12 pl-6 pr-3 max-md:pl-4 max-md:pr-1 border-t border-outline-variant">
          <span className="text-body-sm text-on-surface-variant">
            {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, displayedChannels.length)} of {displayedChannels.length} channels
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="md-btn icon-btn w-9 h-9 max-md:w-11 max-md:h-11"
              title="Previous page"
            >
              <Icon name="chevron_left" className="text-[24px]" />
            </button>
            <div className="flex items-center gap-1 mx-0.5">
              <input
                type="number"
                min={1}
                max={totalPages}
                value={pageInputValue}
                onChange={e => setPageInputValue(e.target.value)}
                className="w-10 text-center bg-transparent border-b-2 border-transparent hover:border-outline-variant focus:border-primary py-0 text-label-lg text-on-surface focus:outline-none transition-colors"
                onBlur={() => {
                  const p = parseInt(pageInputValue, 10);
                  if (!isNaN(p) && p >= 1 && p <= totalPages) handlePageChange(p);
                  else setPageInputValue(String(currentPage));
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const p = parseInt(pageInputValue, 10);
                    if (!isNaN(p) && p >= 1 && p <= totalPages) handlePageChange(p);
                    else setPageInputValue(String(currentPage));
                  }
                }}
              />
              <span className="text-label-lg text-on-surface-variant">/ {totalPages}</span>
            </div>
            <button
              onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="md-btn icon-btn w-9 h-9 max-md:w-11 max-md:h-11"
              title="Next page"
            >
              <Icon name="chevron_right" className="text-[24px]" />
            </button>
          </div>
        </div>
      )}

      {/* ── The "add a channel" button (Material's floating action button) ──
          Bottom-right of the list on every screen size. On phones it's round and opens an empty
          channel editor (nothing is created until Add is pressed there); on bigger screens it
          says "Add channel" and adds a "New Channel" row straight away for editing in place.
          Hidden while selecting or reordering, and lifted above the page buttons when there
          are pages. */}
      {channels.length > 0 && selectedIds.size === 0 && !reorderMode && (
        <button
          onClick={isPhone ? () => setNewChannelDraft({}) : handleAddChannel}
          className={`md-btn fab absolute right-5 max-md:right-4 ${totalPages > 1 ? 'bottom-16' : 'bottom-5 max-md:bottom-4'} z-20 max-md:w-14 max-md:px-0`}
          aria-label="Add channel"
          title="Add channel"
        >
          <Icon name="add" className="text-[24px]" />
          <span className="hidden md:inline">Add channel</span>
        </button>
      )}

      {/* ── Context menu ─────────────────────────────────────────────────── */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="md-menu menu fixed z-50 min-w-[220px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button onClick={() => handleInsertChannel(contextMenu.channelId, 'above')} className="md-btn menu-item">
            <Icon name="arrow_upward" />
            Insert channel above
          </button>
          <button onClick={() => handleInsertChannel(contextMenu.channelId, 'below')} className="md-btn menu-item">
            <Icon name="arrow_downward" />
            Insert channel below
          </button>
          <div className="menu-divider" />
          <button
            onClick={() => openSync(contextMenu.channelId, new DOMRect(contextMenu.x, contextMenu.y, 0, 0))}
            className="md-btn menu-item"
          >
            <Icon name="link" />
            {channels.find(c => c.id === contextMenu.channelId)?.link ? 'Sync settings…' : 'Link to source…'}
          </button>
          <button onClick={() => { setHeadersChannelId(contextMenu.channelId); setContextMenu(null); }} className="md-btn menu-item">
            <Icon name="tune" />
            Stream headers…
          </button>
          <div className="menu-divider" />
          <button onClick={() => { handleSingleDelete(contextMenu.channelId); setContextMenu(null); }} className="md-btn menu-item text-error">
            <Icon name="delete" />
            Delete channel
          </button>
        </div>
      )}

      {/* ── Dialog: Bulk move to new category ────────────────────────────── */}
      {showCategoryPrompt && (
        <Dialog onClose={() => { setShowCategoryPrompt(false); setBulkCategory(''); }}>
          <h2 className="text-headline-sm text-on-surface px-6 pt-6 pb-4">New category</h2>
          <div className="px-6 pb-2">
            <input
              autoFocus
              value={newBulkCategoryName}
              onChange={e => setNewBulkCategoryName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newBulkCategoryName.trim()) { executeBulkMove(newBulkCategoryName.trim()); setShowCategoryPrompt(false); }
                if (e.key === 'Escape') { setShowCategoryPrompt(false); setBulkCategory(''); }
              }}
              placeholder="Category name"
              className="field max-md:text-base"
            />
          </div>
          <div className="flex justify-end gap-2 px-6 pt-4 pb-6">
            <button onClick={() => { setShowCategoryPrompt(false); setBulkCategory(''); }} className="md-btn btn btn-text">Cancel</button>
            <button
              onClick={() => { executeBulkMove(newBulkCategoryName.trim()); setShowCategoryPrompt(false); }}
              disabled={!newBulkCategoryName.trim()}
              className="md-btn btn btn-text"
            >
              Move
            </button>
          </div>
        </Dialog>
      )}

      {/* ── Dialog: Link & download ──────────────────────────────────────── */}
      {showExportDialog && (
        <Dialog onClose={() => setShowExportDialog(false)} maxWidth="max-w-lg">
          <div className="flex items-center justify-between pl-6 pr-3 pt-4 pb-1">
            <h2 className="text-headline-sm text-on-surface">Link &amp; download</h2>
            <button onClick={() => setShowExportDialog(false)} className="md-btn icon-btn" aria-label="Close">
              <Icon name="close" className="text-[24px]" />
            </button>
          </div>
          <p className="px-6 pb-5 text-body-md text-on-surface-variant">Paste these links into your IPTV player, or download the files.</p>
          <div className="px-6 pb-6 space-y-4">
            {[
              { label: 'Playlist (M3U)', url: exportUrl, isCopied: copied, onCopy: copyPlaylistUrl, file: `${playlist.name}.m3u`, what: 'playlist' },
              { label: 'TV guide (XMLTV)', url: epgUrl, isCopied: copiedEpg, onCopy: copyEpgUrl, file: `${playlist.name}.xml`, what: 'EPG' },
            ].map(link => (
              <div key={link.label}>
                <p className="field-label">{link.label}</p>
                <div className="flex items-center gap-0.5 h-12 pl-4 pr-1 rounded-xl bg-surface-container-highest">
                  <span className="flex-1 min-w-0 text-body-md font-mono text-on-surface truncate" title={link.url}>
                    {link.url}
                  </span>
                  <button onClick={link.onCopy} className="md-btn icon-btn" title={`Copy ${link.what} link`}>
                    {link.isCopied ? <Icon name="check" className="text-[24px] text-primary" /> : <Icon name="content_copy" className="text-[24px]" />}
                  </button>
                  <a href={link.url} download={link.file} className="md-btn icon-btn" title={`Download ${link.what}`}>
                    <Icon name="download" className="text-[24px]" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </Dialog>
      )}

      {showBulkDeleteConfirm && (
        <ConfirmDialog title="Delete channels" confirmLabel="Delete" danger onConfirm={confirmBulkDelete} onClose={() => setShowBulkDeleteConfirm(false)}>
          Delete {selectedIds.size} selected channel{selectedIds.size !== 1 ? 's' : ''}? You can undo this right after.
        </ConfirmDialog>
      )}

      {showPdf && (
        <ChannelListPdf
          playlist={playlist}
          channels={channels}
          tvgIdLabels={tvgIdLabels}
          onClose={() => setShowPdf(false)}
        />
      )}

      {/* ── Channel sync ─────────────────────────────────────────────────── */}
      {showSyncLog && (
        <SyncLogPanel
          playlistId={playlistId}
          channels={channels}
          onClose={() => setShowSyncLog(false)}
          onJumpToChannel={jumpToChannel}
        />
      )}

      {syncPopover && syncPopoverChannel && (
        <ChannelSyncPopover
          playlistId={playlistId}
          channel={syncPopoverChannel}
          sourceName={poolSources.find(s => s.id === syncPopoverChannel.link!.sourceId)?.name || 'its source'}
          anchor={syncPopover.anchor}
          onClose={() => setSyncPopover(null)}
          onRelink={() => { setSyncPopover(null); setLinkDialogChannelId(syncPopoverChannel.id); }}
        />
      )}

      {/* Phones: while channels are selected (long-press a row), this bar covers the tab bar
          with what to do with them; the rest is under ⋮. The desktop bar above doesn't fit. */}
      {isPhone && selectedIds.size > 0 && (() => {
        const selected = selectedChannels;
        const mostlyHidden = selectionMostlyHidden;
        const iconBtn = 'md-btn icon-btn relative w-12 h-12';
        return (
          <div className="md:hidden fixed inset-x-0 bottom-0 z-40 pb-safe bg-surface-container text-on-surface shadow-level-2">
            <div className="h-16 flex items-center gap-0.5 px-1">
              <button onClick={() => { setSelectedIds(new Set()); setLastSelectedId(null); }} className={`${iconBtn} text-on-surface`} aria-label="Clear selection">
                <Icon name="close" className="text-[24px]" />
              </button>
              <span className="flex-1 min-w-0 truncate px-1 text-title-md">
                {selectedIds.size} selected
              </span>
              {/* An invisible native picker laid over the icon, so the phone shows its own list. */}
              <label className={iconBtn} title="Move to category">
                <Icon name="drive_file_move" className="text-[24px]" />
                <select
                  value={bulkCategory}
                  onChange={e => handleBulkMove(e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0"
                  aria-label="Move to category"
                >
                  <option value="">Move to…</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  <option value="NEW_CATEGORY">+ New category…</option>
                </select>
              </label>
              <button
                onClick={toggleSelectedHidden}
                className={iconBtn}
                aria-label={mostlyHidden ? 'Show in playlist' : 'Hide from playlist'}
                title={mostlyHidden ? 'Show in playlist' : 'Hide from playlist'}
              >
                {mostlyHidden ? <Icon name="visibility" className="text-[24px]" /> : <Icon name="visibility_off" className="text-[24px]" />}
              </button>
              <button onClick={() => setShowBulkDeleteConfirm(true)} className={`${iconBtn} text-error`} aria-label="Delete" title="Delete">
                <Icon name="delete" className="text-[24px]" />
              </button>
              <OverflowMenu
                openUp
                buttonClassName="w-12 h-12"
                items={[
                  {
                    label: selectedIds.size === displayedChannels.length ? 'Deselect all' : 'Select all in this category',
                    icon: <Icon name="checklist" className="text-[24px]" />, onClick: selectAll,
                  },
                  !healthProgress && { label: 'Check streams', icon: <Icon name="monitor_heart" className="text-[24px]" />, hint: String(selected.length), onClick: () => runHealthCheck(selected) },
                  selectedLinkedChannels.length > 0 && { label: 'Sync settings…', icon: <Icon name="link" className="text-[24px]" />, onClick: () => setShowBulkSyncSettings(true) },
                  selectedLinkedChannels.length > 0 && { label: 'Unlink', icon: <Icon name="link_off" className="text-[24px]" />, onClick: handleBulkUnlink },
                  { label: 'Find & Replace in selection', icon: <Icon name="find_replace" className="text-[24px]" />, onClick: openFindReplace },
                ]}
              />
            </div>
          </div>
        );
      })()}

      {/* Phones: the channel editor. Before the dialogs below so that, at the same z-50, the
          Stream headers and Link to Source dialogs it opens appear on top of it. Keyed by
          channel so a newly inserted channel starts with a fresh form. */}
      {newChannelDraft && (
        <ChannelEditSheet
          isNew
          playlistId={playlistId}
          channel={{
            id: '', playlistId, name: '', url: '', logo: null, tvgId: null,
            category: activeCategory || categories[0] || 'General',
            order: 0, createdAt: 0, updatedAt: 0,
          }}
          categories={categories}
          onSave={values => handleCreateChannel(values, newChannelDraft.insert)}
          onClose={() => setNewChannelDraft(null)}
        />
      )}

      {editSheetChannel && !newChannelDraft && (
        <React.Fragment key={editSheetChannel.id}>
          <ChannelEditSheet
            playlistId={playlistId}
            channel={editSheetChannel}
            categories={categories}
            tvgIdLabel={editSheetChannel.tvgId ? tvgIdLabels[editSheetChannel.tvgId] : undefined}
            sourceName={poolSources.find(s => s.id === editSheetChannel.link?.sourceId)?.name || 'its source'}
            onSave={(changes, syncFields) => handleSheetSave(editSheetChannel.id, changes, syncFields)}
            onLinkToSource={() => setLinkDialogChannelId(editSheetChannel.id)}
            onInsert={position => { setEditSheetChannelId(null); setNewChannelDraft({ insert: { anchorId: editSheetChannel.id, position } }); }}
            onDelete={() => { setEditSheetChannelId(null); handleSingleDelete(editSheetChannel.id); }}
            onClose={() => setEditSheetChannelId(null)}
          />
        </React.Fragment>
      )}

      {headersChannel && (
        <StreamHeadersDialog
          channel={headersChannel}
          onClose={() => setHeadersChannelId(null)}
          onSave={async headers => {
            try {
              await handleChannelSave(headersChannel.id, headers);
            } catch (e) {
              console.error(e);
              notifyError(e, 'Failed to save the stream headers.');
              throw e;
            }
          }}
        />
      )}

      {linkDialogChannel && (
        <LinkChannelDialog
          playlistId={playlistId}
          channel={linkDialogChannel}
          onClose={() => setLinkDialogChannelId(null)}
        />
      )}

      {showBulkSyncSettings && selectedLinkedChannels.length > 0 && (
        <BulkSyncSettingsDialog
          playlistId={playlistId}
          channels={selectedLinkedChannels}
          onClose={() => setShowBulkSyncSettings(false)}
        />
      )}

      {/* ── Dialog: Bulk EPG Assignment ─────────────────────────────────── */}
      <BulkEpgAssignDialog
        open={showBulkEpg}
        onClose={() => {
          setShowBulkEpg(false);
          // Re-resolve labels since assignments may have changed
          const tvgIds = channels.map(c => c.tvgId).filter(Boolean) as string[];
          if (tvgIds.length > 0) api.resolveTvgIds([...new Set(tvgIds)]).then(setTvgIdLabels).catch(e => { console.error(e); notifyError(e, 'Failed to resolve EPG channel names.'); });
          triggerRefresh();
        }}
        playlistId={playlistId}
        channels={channels}
        activeCategory={activeCategory}
      />

      {/* ── Dialog: Find & Replace ──────────────────────────────────────── */}
      {showFindReplace && (() => {
        // Compute scope channel IDs for preview
        const scopeChannels: Channel[] = frScope === 'playlist'
          ? channels
          : frScope === 'category'
            ? channels.filter(c => c.category === activeCategory)
            : frScope === 'selected'
              ? channels.filter(c => selectedIds.has(c.id))
              : [];
        const matchCount = frSearch
          ? scopeChannels.filter(c => c[frField]?.includes(frSearch)).length
          : 0;


        const handleExecuteReplace = async () => {
          if (!frSearch) return;
          setFrRunning(true);
          try {
            let ids: string[] | undefined;
            if (frScope === 'category') ids = channels.filter(c => c.category === activeCategory).map(c => c.id);
            else if (frScope === 'selected') ids = Array.from(selectedIds);
            // frScope === 'playlist' → ids = undefined (server replaces all)
            const result = await api.bulkReplace(playlistId, frSearch, frReplace, frField, ids);
            setFrResult({ modified: result.modified });
            if (result.modified > 0) triggerRefresh();
          } catch (e) { console.error(e); notifyError(e, 'Failed to replace text.'); }
          finally { setFrRunning(false); }
        };

        // One row of the "Which channels" choice.
        const scopeOption = (value: typeof frScope, label: string, hint: React.ReactNode, disabled = false) => (
          <label className={`flex items-center gap-3 h-11 px-3 rounded-xl ${disabled ? 'opacity-50 cursor-default' : 'md-btn cursor-pointer'}`}>
            <input
              type="radio"
              name="fr-scope"
              value={value}
              checked={frScope === value}
              disabled={disabled}
              onChange={() => { if (!disabled) { setFrScope(value); setFrResult(null); } }}
              className="w-4 h-4 accent-primary"
            />
            <span className="flex-1 text-body-md text-on-surface">{label}</span>
            <span className="text-label-md text-on-surface-variant tabular-nums">{hint}</span>
          </label>
        );

        return (
          <Dialog onClose={() => setShowFindReplace(false)} dismissible={!frRunning} maxWidth="max-w-md">
            <h2 className="text-headline-sm text-on-surface px-6 pt-6 pb-4">Find and replace</h2>

            <div className="px-6 space-y-4">
              <div>
                <label className="field-label">Find</label>
                <input
                  autoFocus
                  value={frSearch}
                  onChange={e => { setFrSearch(e.target.value); setFrResult(null); }}
                  placeholder={`Text to find in ${frField === 'url' ? 'stream links' : 'names'}`}
                  className="field font-mono max-md:text-base"
                />
              </div>

              <div>
                <label className="field-label">Replace with</label>
                <input
                  value={frReplace}
                  onChange={e => { setFrReplace(e.target.value); setFrResult(null); }}
                  placeholder="Replacement text"
                  className="field font-mono max-md:text-base"
                />
              </div>

              {/* Which field: two segmented buttons. */}
              <div>
                <p className="field-label">Look in</p>
                <SegmentedButtons
                  options={[{ value: 'url', label: 'Stream links' }, { value: 'name', label: 'Channel names' }]}
                  value={frField}
                  onChange={v => { setFrField(v); setFrResult(null); }}
                />
              </div>

              <div>
                <p className="field-label">Which channels</p>
                <div className="space-y-0.5 -mx-3">
                  {scopeOption('playlist', 'All channels in playlist', channels.length)}
                  {scopeOption('category', 'All in this category', activeCategory ?? '—')}
                  {scopeOption('selected', 'Selected channels only', selectedIds.size > 0 ? selectedIds.size : 'Select channels first', selectedIds.size === 0)}
                </div>
              </div>

              {/* Match preview */}
              {frSearch && (
                <div className="flex items-center gap-2 px-4 h-11 rounded-xl bg-surface-container-highest">
                  <Icon name="search" className="text-[20px] text-on-surface-variant shrink-0" />
                  <span className={`text-label-lg tabular-nums ${matchCount > 0 ? 'text-primary' : 'text-on-surface-variant'}`}>
                    {matchCount} of {scopeChannels.length} channel{scopeChannels.length !== 1 ? 's' : ''} match
                  </span>
                </div>
              )}

              {/* Result message */}
              {frResult && (
                <div className={`flex items-center gap-2 px-4 h-11 rounded-xl ${
                  frResult.modified > 0 ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container-highest text-on-surface-variant'
                }`}>
                  <Icon name="check" className="text-[20px] shrink-0" />
                  <span className="text-label-lg">
                    {frResult.modified > 0
                      ? `Replaced in ${frResult.modified} channel${frResult.modified !== 1 ? 's' : ''}`
                      : 'No channels were changed'
                    }
                  </span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 px-6 py-6">
              <button onClick={() => setShowFindReplace(false)} className="md-btn btn btn-text">
                {frResult ? 'Done' : 'Cancel'}
              </button>
              <button
                onClick={handleExecuteReplace}
                disabled={!frSearch || matchCount === 0 || frRunning}
                className="md-btn btn btn-filled"
              >
                {frRunning ? 'Replacing…' : 'Replace all'}
              </button>
            </div>
          </Dialog>
        );
      })()}

    </div>
  );
}
