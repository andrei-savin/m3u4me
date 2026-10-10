import React, { useState, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { usePlaylists, useChannels, useChannelPoolSources, Channel, EpgChannel, api, triggerRefresh, triggerChannelPoolRefresh } from '../apiClient';
import { useStore, contrastText, accentAlpha, notifyError, notifyInfo } from '../store';

import {
  Download, Check, Copy,
  GripVertical, CheckSquare, Square, Trash2, Eye, EyeOff, Plus, ArrowUp, ArrowDown, Activity, X,
  Replace, Search, Wand2, ChevronLeft, ChevronRight, Layers, Link2, History, Unlink,
} from 'lucide-react';
import BulkEpgAssignDialog from './BulkEpgAssignDialog';
import { ChannelSyncPopover, BulkSyncSettingsDialog } from './ChannelSyncPopover';
import LinkChannelDialog from './LinkChannelDialog';
import SyncLogPanel from './SyncLogPanel';
import ChannelLogo from './ChannelLogo';
import { useDebouncedValue } from '../utils/useDebouncedValue';
import { formatTime } from '../utils/formatTime';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/* ── Inline text-field style used for in-row editing ─────────────────────── */
const inlineInputCls = 'border-b-2 bg-transparent text-sm text-gray-900 dark:text-white px-0.5 py-0 focus:outline-none w-full';

const restrictToVerticalAxis = ({ transform }: any) => ({ ...transform, x: 0 });

/* ── TVG-ID Autocomplete ──────────────────────────────────────────────── */
function TvgIdAutocomplete({ value, onChange, onSave, onCancel }: {
  value: string;
  onChange: (v: string) => void;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const { accentColor } = useStore();
  const [suggestions, setSuggestions] = useState<EpgChannel[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Set once the edit has been saved or cancelled, so the blur that follows (the field unmounts
  // or loses focus) doesn't save a second time with the typed text.
  const finishedRef = useRef(false);
  const debouncedValue = useDebouncedValue(value, 200);

  // Clears suggestions immediately when the field is emptied, rather than waiting out
  // the debounce below.
  useEffect(() => {
    if (!value.trim()) { setSuggestions([]); setShowDropdown(false); }
  }, [value]);

  useEffect(() => {
    if (!debouncedValue.trim()) return;
    api.searchTvgIds(debouncedValue).then(data => {
      setSuggestions(data);
      // Shown even with no results, so a "No matching EPG channels" line confirms the search ran.
      setShowDropdown(true);
      setActiveIdx(-1);
    }).catch(e => {
      console.error(e);
      setSuggestions([]);
      notifyError(e, 'Failed to search EPG channels.');
    });
  }, [debouncedValue]);

  // The dropdown is portalled to <body> with fixed positioning because the TVG-ID cell clips
  // its overflow, which used to hide the dropdown entirely. Placed below the field when there's
  // room, otherwise above it, and re-placed on scroll/resize so it stays attached to the row.
  useLayoutEffect(() => {
    if (!showDropdown) return;
    const place = () => {
      const input = inputRef.current;
      const menu = dropdownRef.current;
      if (!input || !menu) return;
      const margin = 8;
      const anchor = input.getBoundingClientRect();
      const width = Math.min(Math.max(anchor.width, 280), window.innerWidth - margin * 2);
      const height = menu.offsetHeight;
      let top = anchor.bottom + 4;
      if (top + height > window.innerHeight - margin) top = Math.max(margin, anchor.top - height - 4);
      const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin));
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
      menu.style.width = `${width}px`;
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [showDropdown, suggestions]);

  const finish = (save: boolean, saveValue = value) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setShowDropdown(false);
    if (save) onSave(saveValue); else onCancel();
  };

  const selectSuggestion = (id: string) => {
    onChange(id);
    finish(true, id);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { finish(false); return; }
    if (e.key === 'Enter') {
      if (activeIdx >= 0 && suggestions[activeIdx]) {
        e.preventDefault();
        selectSuggestion(suggestions[activeIdx].id);
      } else {
        finish(true);
      }
      return;
    }
    if (e.key === 'ArrowDown' && showDropdown) {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp' && showDropdown) {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    }
  };

  useEffect(() => {
    if (activeIdx >= 0) {
      dropdownRef.current?.querySelector(`[data-idx="${activeIdx}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIdx]);

  return (
    <div className="w-full relative" onClick={e => e.stopPropagation()}>
      <input
        ref={inputRef}
        autoFocus
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={handleKey}
        className={`${inlineInputCls} font-mono text-[11px]`}
        style={{ borderColor: accentColor }}
        placeholder="Type to search EPG pool…"
      />
      {showDropdown && createPortal(
        <div
          ref={dropdownRef}
          // Keeps focus in the field when clicking the dropdown (e.g. its scrollbar), since
          // blurring the field saves and closes the edit.
          onMouseDown={e => e.preventDefault()}
          className="md-menu fixed z-50 bg-white dark:bg-[#2a2a2a] amoled:dark:bg-[#1a1a1a] rounded elev-8 max-h-48 overflow-y-auto border border-gray-200 dark:border-white/10"
        >
          {suggestions.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-gray-400 dark:text-gray-500">No matching EPG channels</p>
          )}
          {suggestions.map((s, i) => (
            <button
              key={`${s.sourceId}-${s.id}`}
              data-idx={i}
              onMouseDown={e => { e.preventDefault(); selectSuggestion(s.id); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] transition-colors ${
                i === activeIdx ? 'dark:bg-white/10' : 'hover:bg-gray-50 dark:hover:bg-white/5'
              }`}
              style={i === activeIdx ? { backgroundColor: `${accentColor}15` } : undefined}
            >
              {s.icon && <img src={s.icon} className="w-4 h-4 rounded shrink-0" alt="" onError={e => (e.currentTarget.style.display = 'none')} />}
              <span className="truncate text-gray-700 dark:text-gray-200">{s.displayName}</span>
              <span className="ml-auto shrink-0 font-mono text-gray-400 dark:text-gray-500 text-[10px]">{s.id}</span>
              <span className="shrink-0 text-gray-300 dark:text-gray-600 text-[9px]">{s.sourceName}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

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
  if (status === 'checking') return <div className={`${base} bg-gray-400 dark:bg-gray-500 animate-pulse`} />;
  if (status === 'ok')       return <div className={`${base} bg-green-500`} />;
  if (status === 'error')    return <div className={`${base} bg-red-500`} />;
  if (status === 'timeout')  return <div className={`${base} bg-amber-400`} />;
  return <div className={`${base} bg-gray-300 dark:bg-gray-600`} />;
}

function SortableChannelItem({
  channel, isSelected, toggleSelection,
  onUpdate, onDelete, onToggleHide,
  activeEditId, setActiveEditId, colWidths, isHighlighted, rowIndex, onRightClick, healthSt, tvgIdLabel, isSaving,
  onOpenSync,
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
  rowIndex: number;
  onRightClick: (e: React.MouseEvent) => void;
  healthSt?: HealthEntry;
  tvgIdLabel?: { displayName: string; sourceName: string };
  isSaving?: boolean;
  // Opens the sync popover (linked channel) or the Link to Source dialog (unlinked channel),
  // anchored to the element that was clicked.
  onOpenSync: (channelId: string, anchor: DOMRect) => void;
}) {
  const { logoBgColor, hideUrls, accentColor, is24Hour } = useStore();
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

  const rowBase = 'relative flex items-center h-14 border-b border-gray-100 dark:border-white/6 group transition-colors';
  const isEven = rowIndex % 2 === 0;
  const rowBg = channel.isHidden
    ? 'bg-red-50 dark:bg-red-950/25 amoled:dark:bg-red-950/35'
    : isHighlighted
      ? 'bg-amber-50 dark:bg-amber-900/20 amoled:dark:bg-amber-900/25'
      : isSelected
        ? ''  // accent tint applied via inline style below
        : isEven
          ? 'bg-white dark:bg-[#1e1e1e] amoled:dark:bg-black hover:bg-gray-50 dark:hover:bg-white/3 amoled:dark:hover:bg-white/4'
          : 'bg-gray-50/70 dark:bg-[#222222] amoled:dark:bg-[#0d0d0d] hover:bg-gray-100/70 dark:hover:bg-white/5 amoled:dark:hover:bg-white/5';

  return (
    <div
      id={`ch-${channel.id}`}
      ref={setNodeRef}
      style={{ ...style, ...(isSelected ? { backgroundColor: `${accentColor}18` } : {}) }}
      className={`${rowBase} ${rowBg}`}
      onContextMenu={onRightClick}
    >

      {/* Drag handle */}
      <div
        {...attributes} {...listeners}
        className="w-8 shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing text-gray-300 dark:text-gray-700"
      >
        <GripVertical className="h-4 w-4" />
      </div>

      {/* Checkbox */}
      <div className="w-8 shrink-0 flex items-center justify-center">
        <button
          onClick={e => toggleSelection(channel.id, e.shiftKey)}
          className="md-btn p-1 rounded-full text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-200"
          style={isSelected ? { color: accentColor } : undefined}
        >
          {isSelected
            ? <CheckSquare className="h-4 w-4" />
            : <Square className="h-4 w-4" />}
        </button>
      </div>

      {/* Logo — NOTE: no overflow:hidden here so the popup isn't clipped */}
      <div className="relative w-14 mx-3 shrink-0 flex items-center justify-center">
        <div
          className="cursor-pointer"
          onClick={e => { e.stopPropagation(); startEdit('logo', channel.logo || ''); }}
        >
          <ChannelLogo
            logo={channel.logo}
            name={channel.name}
            logoBgColor={logoBgColor}
            className="w-10 h-7 rounded border border-gray-200 dark:border-white/10 hover:border-gray-400"
          />
        </div>

        {/* Logo URL popover */}
        {editingField === 'logo' && (
          <div
            className="md-menu absolute top-9 left-0 z-30 w-64 bg-white dark:bg-[#272727] rounded elev-8 p-4"
            onClick={e => e.stopPropagation()}
          >
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Logo URL</label>
            <input
              autoFocus
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onKeyDown={handleKey}
              placeholder="https://…"
              className="w-full border border-gray-300 dark:border-gray-600 rounded px-2.5 py-1.5 text-xs font-mono focus:outline-none bg-transparent text-gray-900 dark:text-white placeholder-gray-400 mb-3"
              onFocus={e => (e.target.style.borderColor = accentColor)}
              onBlur={e => (e.target.style.borderColor = '')}
            />
            {editValue ? (
              <div className="w-10 h-7 mb-3 overflow-hidden rounded border border-gray-200 dark:border-white/10 flex items-center justify-center" style={{ backgroundColor: logoBgColor === 'transparent' ? undefined : logoBgColor }}>
                <img src={editValue} alt="Preview" className="w-full h-full object-contain" onError={e => (e.currentTarget.style.display = 'none')} />
              </div>
            ) : null}
            <div className="flex justify-end gap-1">
              <button onClick={() => setEditingField(null)} className="md-btn h-8 px-3 rounded text-[11px] font-medium uppercase tracking-wider text-gray-600 dark:text-gray-400">Cancel</button>
              <button onClick={saveEdit} className="md-btn h-8 px-3 rounded text-[11px] font-medium uppercase tracking-wider" style={{ color: accentColor }}>Save</button>
            </div>
          </div>
        )}
      </div>

      {/* Name + URL */}
      <div className="shrink-0 pr-4 flex flex-col justify-center gap-0.5 overflow-hidden" style={{ width: colWidths.name }}>
        {editingField === 'name'
          ? <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={saveEdit} onKeyDown={handleKey} className={inlineInputCls} style={{ borderColor: accentColor }} onClick={e => e.stopPropagation()} placeholder="Channel name" />
          : <div className="flex items-center gap-1.5 min-w-0">
              <p onClick={() => startEdit('name', channel.name)} className={`min-w-0 text-sm font-medium truncate cursor-text hover:underline decoration-dashed underline-offset-2 ${isSelected ? '' : 'text-gray-900 dark:text-white'}`} style={isSelected ? { color: accentColor } : undefined} title="Click to edit">{channel.name || 'Unnamed'}</p>
              {channel.link?.lost && (
                <button
                  {...syncTriggerProps}
                  className="md-btn shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-200 text-gray-600 dark:bg-white/10 dark:text-gray-300"
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
                  <span className="block w-2 h-2 rounded-full" style={{ backgroundColor: accentColor }} />
                </button>
              )}
            </div>
        }
        {!hideUrls && (editingField === 'url'
          ? <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={saveEdit} onKeyDown={handleKey} className={`${inlineInputCls} font-mono text-[11px]`} style={{ borderColor: accentColor }} onClick={e => e.stopPropagation()} placeholder="https://…" />
          : <p onClick={() => startEdit('url', channel.url || '')} className="text-[11px] font-mono text-gray-400 dark:text-gray-500 truncate cursor-text hover:underline decoration-dashed underline-offset-2" title="Click to edit">{channel.url || '— no url —'}</p>
        )}
      </div>

      {/* TVG ID — fills remaining space */}
      <div className="flex-1 pr-4 hidden md:flex items-center overflow-hidden relative">
        {editingField === 'tvgId'
          ? <TvgIdAutocomplete
              value={editValue}
              onChange={setEditValue}
              onSave={commitEdit}
              onCancel={() => { setEditingField(null); if (activeEditId === channel.id) setActiveEditId(null); }}
            />
          : channel.tvgId && tvgIdLabel
            ? <span
                onClick={() => startEdit('tvgId', channel.tvgId || '')}
                className="inline-flex items-center gap-1 max-w-full min-w-0 cursor-pointer group/tag opacity-90 hover:opacity-100 transition-opacity"
                title={`${channel.tvgId}\nClick to edit`}
              >
                {/* `truncate` on a flex container doesn't actually ellipsize its
                    children — browsers just hard-clip at the box edge — so only
                    the displayName span (a plain text run) carries it. The pill
                    and this wrapper stay `min-w-0 overflow-hidden` so displayName
                    is the part that gives way, keeping the short source tag intact. */}
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium min-w-0 overflow-hidden"
                  style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
                >
                  <span className="truncate min-w-0">{tvgIdLabel.displayName}</span>
                  <span className="shrink-0 opacity-50">•</span>
                  <span className="shrink-0 opacity-80">{tvgIdLabel.sourceName}</span>
                </span>
              </span>
            : <span onClick={() => startEdit('tvgId', channel.tvgId || '')} className={`font-mono text-[11px] truncate cursor-text hover:underline decoration-dashed underline-offset-2 ${channel.tvgId ? 'text-gray-500 dark:text-gray-400' : 'text-gray-300 dark:text-gray-600 italic'}`}>{channel.tvgId || '—'}</span>
        }
      </div>

      {/* Health status */}
      {healthSt && (
        <div className="hidden md:flex items-center gap-1.5 shrink-0 pr-4" title={healthSt.status !== 'checking' ? `Checked ${formatCheckedAt(healthSt.checkedAt, is24Hour)}` : undefined}>
          <HealthDot status={healthSt.status} />
          {healthSt.status !== 'checking' && (
            <>
              <span className={`text-[11px] font-medium ${
                healthSt.status === 'ok'      ? 'text-green-600 dark:text-green-400' :
                healthSt.status === 'error'   ? 'text-red-500 dark:text-red-400' :
                healthSt.status === 'timeout' ? 'text-amber-500' :
                'text-gray-400 dark:text-gray-500'
              }`}>
                {healthSt.status === 'ok' ? 'Online' : healthSt.status === 'error' ? 'Offline' : healthSt.status === 'timeout' ? 'Timeout' : 'Skipped'}
              </span>
              {/* Time-only — the full date rarely adds anything here (a whole category is
                  usually checked in one batch) and it was crowding out the TVG/EPG badge
                  next to it. Full date+time still shows via the row's title tooltip above. */}
              <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500">
                {formatTime(healthSt.checkedAt, is24Hour)}
              </span>
            </>
          )}
        </div>
      )}

      {/* Row actions */}
      <div className="w-24 shrink-0 flex items-center justify-end gap-0.5 pr-2">
        <button
          {...syncTriggerProps}
          className={`md-btn p-1.5 rounded-full ${channel.link ? '' : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
          style={channel.link ? { color: accentColor } : undefined}
          title={channel.link ? 'Sync settings' : 'Link to source'}
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onToggleHide(channel.id, !!channel.isHidden)}
          className="md-btn p-1.5 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          title={channel.isHidden ? 'Include in export' : 'Exclude from export'}
        >
          {channel.isHidden ? <EyeOff className="h-3.5 w-3.5 text-amber-500" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={() => onDelete(channel.id)}
          className="md-btn p-1.5 rounded-full text-gray-400 hover:text-red-600 dark:hover:text-red-400"
          title="Delete channel"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Saving indicator — a save (rename, hide toggle, URL/TVG-ID edit) round-trips to
          the backend and then waits on a full channels refetch before the row shows the
          new value, which used to read as a stall. This indeterminate bar (styled after
          Windows Explorer's copy-progress bar) covers the row for that stretch instead. */}
      {isSaving && (
        <div className="md-progress" style={{ color: accentColor, backgroundColor: accentAlpha(accentColor, '20') }} />
      )}
    </div>
  );
}

/* ── Main editor ──────────────────────────────────────────────────────────── */
export default function PlaylistEditor({ playlistId }: { playlistId: string }) {
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
  const [colWidths, setColWidths] = useState(() => {
    // Fixed columns: drag(32) + checkbox(32) + logo+margin(80) + actions(96) + sidebar(256) ≈ 496px
    const available = Math.max(200, window.innerWidth - 496);
    return { name: Math.round(available * 0.7) };
  });
  const resizing = useRef<{ startX: number; startW: number } | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const pendingScrollId = useRef<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ channelId: string; x: number; y: number } | null>(null);
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
  const [showBulkSyncSettings, setShowBulkSyncSettings] = useState(false);

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

  const { activeCategory, setActiveCategory, accentColor, setUndoEntry, scrollTarget, setScrollTarget, syncLogOpenFor, setSyncLogOpenFor } = useStore();

  // Sync panels belong to one playlist, so switching playlists closes them. This runs before the
  // effect below, so a sync log requested for the playlist being opened still opens.
  useEffect(() => {
    setShowSyncLog(false);
    setSyncPopover(null);
    setLinkDialogChannelId(null);
  }, [playlistId]);

  // Home's "Sync updates waiting" card asks for this playlist's sync log.
  useEffect(() => {
    if (syncLogOpenFor !== playlistId) return;
    setShowSyncLog(true);
    setSyncLogOpenFor(null);
  }, [syncLogOpenFor, playlistId, setSyncLogOpenFor]);
  const scrollToChannelId = scrollTarget?.kind === 'playlist' ? scrollTarget.id : null;
  const onAccent = contrastText(accentColor); // '#fff' or '#000' depending on luminance
  const onAccentMuted = onAccent === '#ffffff' ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.60)';

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const typing = document.activeElement instanceof HTMLInputElement
        || document.activeElement instanceof HTMLTextAreaElement;
      // While a sync dialog or popover is open, Space/Delete/Escape belong to it (e.g. Space toggles a
      // focused checkbox there), not to the selected channels behind it.
      if (typing || contextMenu || syncPopover || linkDialogChannelId || showBulkSyncSettings) return;
      if (e.key === 'Escape' && selectedIds.size > 0) {
        setSelectedIds(new Set()); setLastSelectedId(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault(); setShowBulkDeleteConfirm(true);
      } else if (e.key === ' ' && selectedIds.size > 0) {
        e.preventDefault();
        const selected = displayedChannels.filter(c => selectedIds.has(c.id));
        const shouldHide = selected.filter(c => c.isHidden).length < selected.length / 2;
        api.bulkUpdateChannels(playlistId, Array.from(selectedIds), { isHidden: shouldHide }).then(triggerRefresh);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        setSelectedIds(new Set(displayedChannels.map(c => c.id)));
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedIds, displayedChannels, playlistId, contextMenu, syncPopover, linkDialogChannelId, showBulkSyncSettings]);

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

  const copyText = (text: string, setFlag: (v: boolean) => void) => {
    const write = () => { setFlag(true); setTimeout(() => setFlag(false), 2000); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(write).catch(fallback);
    } else { fallback(); }
    function fallback() {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
      document.body.appendChild(el);
      el.select();
      try { document.execCommand('copy'); write(); } catch (e) { console.error(e); notifyError(e, 'Failed to copy to clipboard.'); }
      document.body.removeChild(el);
    }
  };

  const copyToClipboard = () => copyText(exportUrl, setCopied);
  const copyEpgToClipboard = () => copyText(epgUrl, setCopiedEpg);

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

  const handleChannelUpdate = async (id: string, field: string, value: string) => {
    markSaving(id);
    try {
      await api.updateChannel(playlistId, id, { [field]: value.trim() || null });
      // Wait for this component's own channels to actually refetch — not just fire the
      // event and move on — so the saving indicator stays up until the row has the new
      // value to show, rather than clearing early onto stale data.
      await refetchChannels();
      triggerRefresh();
    } catch (e) { console.error(e); notifyError(e, 'Failed to save channel.'); }
    finally { clearSaving(id); }
  };

  const handleToggleHide = async (id: string, current: boolean) => {
    markSaving(id);
    try {
      await api.updateChannel(playlistId, id, { isHidden: !current });
      await refetchChannels();
      triggerRefresh();
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
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const w = Math.max(80, resizing.current.startW + ev.clientX - resizing.current.startX);
      setColWidths({ name: w });
    };
    const onUp = () => {
      resizing.current = null;
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
        const { results } = await api.healthCheck(batch.map(c => ({ id: c.id, url: c.url })));
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

  /* Toolbar button styles — adapt to whatever is readable on the accent bg */
  const toolbarBtn = `md-btn flex items-center gap-1.5 h-9 px-3 rounded text-xs font-medium uppercase tracking-wider`;
  const toolbarBtnOutlined = `${toolbarBtn} border`;

  return (
    <div className="flex flex-col h-full bg-gray-100 dark:bg-[#121212] amoled:dark:bg-black relative">

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <header className="shrink-0 z-20 elev-4" style={{ backgroundColor: accentColor }}>
        <div className="flex items-center h-14 px-6 gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <h2 className="text-base font-medium truncate" style={{ color: onAccent }}>
              {playlist.name}
              {activeCategory && (
                <span className="font-light" style={{ color: onAccentMuted }}> / {activeCategory}</span>
              )}
            </h2>
          </div>

          <div className="flex items-center gap-1 relative">

            <button
              onClick={() => setShowSyncLog(s => !s)}
              className={`${toolbarBtn} relative`}
              style={{ color: onAccent, ...(showSyncLog ? { backgroundColor: 'rgba(0,0,0,0.15)' } : {}) }}
              title={unreadSyncLogCount > 0 ? `Sync log (${unreadSyncLogCount} new)` : 'Sync log'}
            >
              <History className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">Sync log</span>
              {unreadSyncLogCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full text-[10px] font-semibold leading-4 text-center"
                  style={{ backgroundColor: onAccent, color: accentColor }}
                >
                  {unreadSyncLogCount > 99 ? '99+' : unreadSyncLogCount}
                </span>
              )}
            </button>

            <button
              onClick={() => { setShowFindReplace(true); setFrSearch(''); setFrReplace(''); setFrResult(null); if (selectedIds.size > 0) setFrScope('selected'); else setFrScope('category'); }}
              disabled={channels.length === 0}
              className={`${toolbarBtn} disabled:opacity-40`}
              style={{ color: onAccent }}
              title="Find & Replace"
            >
              <Replace className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">Replace</span>
            </button>

            <button
              onClick={() => setShowBulkEpg(true)}
              disabled={channels.length === 0}
              className={`${toolbarBtn} disabled:opacity-40`}
              style={{ color: onAccent }}
              title="Bulk EPG Assignment"
            >
              <Wand2 className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">Assign EPG</span>
            </button>

            <button
              onClick={() => setShowExportDialog(true)}
              disabled={channels.length === 0}
              className={`${toolbarBtnOutlined} disabled:opacity-40`}
              style={{ color: onAccent, borderColor: `${onAccent}55`, backgroundColor: 'rgba(0,0,0,0.15)' }}
              title="Export / Download"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">Export</span>
            </button>

            {/* Health check button */}
            <div className="relative">
              {healthProgress ? (
                <div className="flex items-center gap-2 h-9 px-3" style={{ color: onAccentMuted }}>
                  <Activity className="h-3.5 w-3.5 animate-pulse" />
                  <span className="text-xs font-medium uppercase tracking-wider tabular-nums">
                    {healthProgress.done}/{healthProgress.total}
                  </span>
                  <button onClick={cancelHealthCheck} className="ml-1 opacity-70 hover:opacity-100" title="Cancel">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowHealthMenu(s => !s)}
                  className={toolbarBtn}
                  style={{ color: onAccent }}
                >
                  <Activity className="h-3.5 w-3.5" />
                  <span className="hidden lg:inline">Check</span>
                </button>
              )}
              {showHealthMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowHealthMenu(false)} />
                  <div className="md-menu absolute right-0 top-full mt-1 w-52 bg-white dark:bg-[#272727] rounded elev-8 z-40 py-1 text-sm">
                    <button
                      onClick={() => runHealthCheck(displayedChannels)}
                      className="md-btn w-full flex items-center gap-2.5 px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/8 text-left"
                    >
                      <Activity className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                      Check this category
                      <span className="ml-auto text-xs text-gray-400">{displayedChannels.length}</span>
                    </button>
                    <button
                      onClick={() => runHealthCheck(channels)}
                      className="md-btn w-full flex items-center gap-2.5 px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/8 text-left"
                    >
                      <Activity className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                      Check entire playlist
                      <span className="ml-auto text-xs text-gray-400">{channels.length}</span>
                    </button>
                    {selectedIds.size > 0 && (
                      <button
                        onClick={() => runHealthCheck(channels.filter(c => selectedIds.has(c.id)))}
                        className="md-btn w-full flex items-center gap-2.5 px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/8 text-left"
                      >
                        <Activity className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                        Check selected
                        <span className="ml-auto text-xs text-gray-400">{selectedIds.size}</span>
                      </button>
                    )}
                    {healthStatus.size > 0 && (
                      <>
                        <div className="border-t border-gray-100 dark:border-white/8 my-1" />
                        <button
                          onClick={() => { setHealthStatus(new Map()); setShowHealthMenu(false); }}
                          className="md-btn w-full flex items-center gap-2.5 px-4 py-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/8 text-left"
                        >
                          Clear results
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>


          </div>
        </div>
      </header>

      {/* ── Bulk-selection bar ────────────────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div
          className="shrink-0 h-12 border-b px-6 flex items-center justify-between gap-4 transition-colors"
          style={{ backgroundColor: accentAlpha(accentColor, '15'), borderColor: accentAlpha(accentColor, '30') }}
        >
          <span className="text-sm font-medium" style={{ color: accentColor }}>
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-2">
            <select
              value={bulkCategory}
              onChange={e => handleBulkMove(e.target.value)}
              className="text-xs font-medium border border-gray-300 dark:border-gray-600 rounded h-8 px-2 focus:outline-none bg-white dark:bg-[#1e1e1e] text-gray-700 dark:text-gray-200"
              onFocus={e => (e.target.style.borderColor = accentColor)}
              onBlur={e => (e.target.style.borderColor = '')}
            >
              <option value="">Move to…</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
              <option value="NEW_CATEGORY">+ New category…</option>
            </select>
            {selectedLinkedChannels.length > 0 && (
              <>
                <button
                  onClick={() => setShowBulkSyncSettings(true)}
                  className="md-btn h-8 px-3 rounded text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-300 flex items-center gap-1"
                  title={`Sync settings for ${selectedLinkedChannels.length} linked channel${selectedLinkedChannels.length !== 1 ? 's' : ''}`}
                >
                  <Link2 className="h-3.5 w-3.5" /> Sync
                </button>
                <button
                  onClick={handleBulkUnlink}
                  className="md-btn h-8 px-3 rounded text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-300 flex items-center gap-1"
                  title={`Stop syncing ${selectedLinkedChannels.length} linked channel${selectedLinkedChannels.length !== 1 ? 's' : ''}`}
                >
                  <Unlink className="h-3.5 w-3.5" /> Unlink
                </button>
              </>
            )}
            <button
              onClick={() => runHealthCheck(channels.filter(c => selectedIds.has(c.id)))}
              disabled={!!healthProgress}
              className="md-btn h-8 px-3 rounded text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-300 flex items-center gap-1 disabled:opacity-40"
            >
              <Activity className="h-3.5 w-3.5" /> Check
            </button>
            <button onClick={() => setShowBulkDeleteConfirm(true)} className="md-btn h-8 px-3 rounded text-xs font-medium uppercase tracking-wider text-red-600 dark:text-red-400 flex items-center gap-1">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
            <button onClick={() => { setSelectedIds(new Set()); setLastSelectedId(null); }} className="md-btn h-8 px-3 rounded text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-400">
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ── Channel list ─────────────────────────────────────────────────── */}
      <div ref={listScrollRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-sm text-gray-400 dark:text-gray-500 animate-pulse">
            Loading channels…
          </div>
        ) : channels.length === 0 && channelsError ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-base font-medium text-red-500 dark:text-red-400">{channelsError}</p>
            <button
              onClick={() => refetchChannels()}
              className="mt-5 md-btn flex items-center gap-1.5 h-9 px-4 rounded text-sm font-medium text-white elev-1"
              style={{ backgroundColor: accentColor }}
            >
              Retry
            </button>
          </div>
        ) : channels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: accentAlpha(accentColor, '15') }}>
              <Layers className="w-7 h-7" style={{ color: accentColor }} />
            </div>
            <p className="text-base font-medium text-gray-700 dark:text-gray-300">No channels yet</p>
            <p className="mt-1 text-sm text-gray-400 dark:text-gray-500 max-w-xs">Add channels manually or import them from the Sources tab.</p>
            <button
              onClick={handleAddChannel}
              className="mt-5 md-btn flex items-center gap-1.5 h-9 px-4 rounded text-sm font-medium text-white elev-1"
              style={{ backgroundColor: accentColor }}
            >
              <Plus className="h-4 w-4" />
              Add channel
            </button>
          </div>
        ) : (
          <div className="bg-white dark:bg-[#1e1e1e] amoled:dark:bg-black">

            {/* Column header */}
            <div className="sticky top-0 z-10 flex items-center h-11 bg-gray-50 dark:bg-[#242424] amoled:dark:bg-[#111] border-b border-gray-200 dark:border-white/8 select-none">
              {/* drag + checkbox placeholders */}
              <div className="w-8 shrink-0" />
              <div className="w-8 shrink-0 flex items-center justify-center">
                <button onClick={selectAll} className="md-btn p-1 rounded-full text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400">
                  {selectedIds.size === displayedChannels.length && displayedChannels.length > 0
                    ? <CheckSquare className="h-4 w-4" />
                    : <Square className="h-4 w-4" />}
                </button>
              </div>
              <div className="w-14 mx-3 shrink-0 text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 text-center">Logo</div>
              {/* Name column — resizable */}
              <div className="relative shrink-0 text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400" style={{ width: colWidths.name }}>
                Channel Name
                <div
                  onMouseDown={startResize}
                  className="absolute right-0 top-0 bottom-0 w-3 flex items-center justify-center cursor-col-resize"
                >
                  <div className="w-px h-4 bg-gray-300 dark:bg-white/20 rounded-full" />
                </div>
              </div>
              {/* TVG ID column — fills remaining space */}
              <div className="flex-1 pr-4 text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 hidden md:block">
                TVG / EPG ID
              </div>
              <div className="w-24 shrink-0 flex justify-end">
                <button onClick={handleAddChannel} className="md-btn flex items-center gap-1 h-7 px-3 text-white rounded text-[11px] font-medium uppercase tracking-wider elev-1" style={{ backgroundColor: accentColor }}>
                  <Plus className="h-3 w-3" />
                  <span>Add</span>
                </button>
              </div>
            </div>

            {/* Rows */}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
              <SortableContext items={paginatedChannels.map(c => c.id)} strategy={verticalListSortingStrategy}>
                {paginatedChannels.map((channel, i) => (
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
                    rowIndex={i}
                    onRightClick={e => { e.preventDefault(); setContextMenu({ channelId: channel.id, x: e.clientX, y: e.clientY }); }}
                    healthSt={healthStatus.get(channel.id)}
                    tvgIdLabel={channel.tvgId ? tvgIdLabels[channel.tvgId] : undefined}
                    isSaving={savingIds.has(channel.id)}
                    onOpenSync={openSync}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        )}
      </div>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="shrink-0 flex items-center justify-between px-6 py-1.5 border-t border-gray-200 dark:border-white/8 bg-white dark:bg-[#1e1e1e] amoled:dark:bg-black">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, displayedChannels.length)} of {displayedChannels.length} channels
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="md-btn p-1 rounded-full text-gray-600 dark:text-gray-400 disabled:opacity-30 hover:bg-black/5 dark:hover:bg-white/5 disabled:hover:bg-transparent transition-colors"
              title="Previous Page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1 mx-0.5">
              <input
                type="number"
                min={1}
                max={totalPages}
                value={pageInputValue}
                onChange={e => setPageInputValue(e.target.value)}
                className="w-10 text-center bg-transparent border-b-2 border-transparent hover:border-gray-300 dark:hover:border-gray-600 py-0 text-xs font-medium text-gray-900 dark:text-white focus:outline-none transition-colors"
                onFocus={e => (e.target.style.borderColor = accentColor)}
                onBlur={e => {
                  e.target.style.borderColor = 'transparent';
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
              <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">/ {totalPages}</span>
            </div>
            <button
              onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="md-btn p-1 rounded-full text-gray-600 dark:text-gray-400 disabled:opacity-30 hover:bg-black/5 dark:hover:bg-white/5 disabled:hover:bg-transparent transition-colors"
              title="Next Page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}


      {/* ── Context menu ─────────────────────────────────────────────────── */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-white dark:bg-[#272727] rounded elev-8 py-1 min-w-[200px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            onClick={() => handleInsertChannel(contextMenu.channelId, 'above')}
            className="md-btn w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/8 text-left"
          >
            <ArrowUp className="h-4 w-4 shrink-0 text-gray-400" />
            Insert channel above
          </button>
          <button
            onClick={() => handleInsertChannel(contextMenu.channelId, 'below')}
            className="md-btn w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/8 text-left"
          >
            <ArrowDown className="h-4 w-4 shrink-0 text-gray-400" />
            Insert channel below
          </button>
          <div className="border-t border-gray-100 dark:border-white/8 my-1" />
          <button
            onClick={() => openSync(contextMenu.channelId, new DOMRect(contextMenu.x, contextMenu.y, 0, 0))}
            className="md-btn w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/8 text-left"
          >
            <Link2 className="h-4 w-4 shrink-0 text-gray-400" />
            {channels.find(c => c.id === contextMenu.channelId)?.link ? 'Sync settings…' : 'Link to source…'}
          </button>
        </div>
      )}

      {/* ── Dialog: Bulk move to new category ────────────────────────────── */}
      {showCategoryPrompt && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#272727] amoled:dark:bg-[#1a1a1a] rounded elev-24 max-w-sm w-full">
            <h2 className="text-xl font-medium text-gray-900 dark:text-white px-6 pt-6 pb-5">New Category</h2>
            <div className="px-6 pb-2">
              <input
                autoFocus
                value={newBulkCategoryName}
                onChange={e => setNewBulkCategoryName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { executeBulkMove(newBulkCategoryName.trim()); setShowCategoryPrompt(false); }
                  if (e.key === 'Escape') { setShowCategoryPrompt(false); setBulkCategory(''); }
                }}
                placeholder="Category name"
                className="w-full border border-gray-400 dark:border-gray-500 rounded px-3 py-2.5 text-sm focus:outline-none bg-transparent text-gray-900 dark:text-white placeholder-gray-400"
                onFocus={e => (e.target.style.borderColor = accentColor)}
                onBlur={e => (e.target.style.borderColor = '')}
              />
            </div>
            <div className="flex justify-end gap-1 px-4 py-4">
              <button onClick={() => { setShowCategoryPrompt(false); setBulkCategory(''); }} className="md-btn h-9 px-4 rounded text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-300">Cancel</button>
              <button
                onClick={() => { executeBulkMove(newBulkCategoryName.trim()); setShowCategoryPrompt(false); }}
                disabled={!newBulkCategoryName.trim()}
                className="md-btn h-9 px-4 rounded text-xs font-medium uppercase tracking-wider disabled:opacity-40"
                style={{ color: accentColor }}
              >
                Move
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Dialog: Bulk delete ───────────────────────────────────────────── */}
      {/* ── Dialog: Export / Download ────────────────────────────────────── */}
      {showExportDialog && (
        <div
          className="md-scrim fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={() => setShowExportDialog(false)}
        >
          <div
            className="md-dialog w-full max-w-md bg-white dark:bg-[#272727] amoled:dark:bg-[#1a1a1a] rounded elev-24 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4">
              <h2 className="text-lg font-medium text-gray-900 dark:text-white">Export Playlist</h2>
              <button
                onClick={() => setShowExportDialog(false)}
                className="md-btn p-1.5 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 pb-6 space-y-4">
              {/* M3U Playlist link */}
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400 mb-2">M3U Playlist</p>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-gray-100 dark:bg-white/6 border border-gray-200 dark:border-white/10">
                  <span className="flex-1 min-w-0 text-sm font-mono text-gray-700 dark:text-gray-300 truncate" title={exportUrl}>
                    {exportUrl}
                  </span>
                  <button
                    onClick={copyToClipboard}
                    className="md-btn shrink-0 p-1.5 rounded-full text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white transition-colors"
                    title="Copy playlist link"
                  >
                    {copied ? <Check className="h-4 w-4" style={{ color: accentColor }} /> : <Copy className="h-4 w-4" />}
                  </button>
                  <a
                    href={exportUrl}
                    download={`${playlist.name}.m3u`}
                    className="md-btn shrink-0 p-1.5 rounded-full text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white transition-colors"
                    title="Download playlist"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </div>
              </div>

              {/* EPG / XMLTV link */}
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400 mb-2">EPG / XMLTV</p>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-gray-100 dark:bg-white/6 border border-gray-200 dark:border-white/10">
                  <span className="flex-1 min-w-0 text-sm font-mono text-gray-700 dark:text-gray-300 truncate" title={epgUrl}>
                    {epgUrl}
                  </span>
                  <button
                    onClick={copyEpgToClipboard}
                    className="md-btn shrink-0 p-1.5 rounded-full text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white transition-colors"
                    title="Copy EPG link"
                  >
                    {copiedEpg ? <Check className="h-4 w-4" style={{ color: accentColor }} /> : <Copy className="h-4 w-4" />}
                  </button>
                  <a
                    href={epgUrl}
                    download={`${playlist.name}.xml`}
                    className="md-btn shrink-0 p-1.5 rounded-full text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white transition-colors"
                    title="Download EPG"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBulkDeleteConfirm && (
        <div className="md-scrim fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="md-dialog w-full max-w-sm bg-white dark:bg-[#272727] amoled:dark:bg-[#1a1a1a] rounded elev-24">
            <h2 className="text-xl font-medium text-gray-900 dark:text-white px-6 pt-6 pb-2">Delete Channels</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 px-6 pb-6">
              Delete {selectedIds.size} selected channel{selectedIds.size !== 1 ? 's' : ''}?
            </p>
            <div className="flex justify-end gap-1 px-4 pb-4">
              <button onClick={() => setShowBulkDeleteConfirm(false)} className="md-btn h-9 px-4 rounded text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-300">Cancel</button>
              <button onClick={confirmBulkDelete} className="md-btn h-9 px-4 rounded text-xs font-medium uppercase tracking-wider text-red-600 dark:text-red-400">Delete</button>
            </div>
          </div>
        </div>
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

        return (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#272727] amoled:dark:bg-[#1a1a1a] rounded elev-24 max-w-md w-full">
              <h2 className="text-xl font-medium text-gray-900 dark:text-white px-6 pt-6 pb-4 flex items-center gap-2">
                <Replace className="h-5 w-5" />
                Find & Replace
              </h2>

              <div className="px-6 space-y-4">
                {/* Search input */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Find</label>
                  <input
                    autoFocus
                    value={frSearch}
                    onChange={e => { setFrSearch(e.target.value); setFrResult(null); }}
                    placeholder={`Text to find in ${frField === 'url' ? 'URLs' : 'names'}…`}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2.5 text-sm font-mono focus:outline-none bg-transparent text-gray-900 dark:text-white placeholder-gray-400"
                    onFocus={e => (e.target.style.borderColor = accentColor)}
                    onBlur={e => (e.target.style.borderColor = '')}
                  />
                </div>

                {/* Replace input */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Replace with</label>
                  <input
                    value={frReplace}
                    onChange={e => { setFrReplace(e.target.value); setFrResult(null); }}
                    placeholder="Replacement text…"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2.5 text-sm font-mono focus:outline-none bg-transparent text-gray-900 dark:text-white placeholder-gray-400"
                    onFocus={e => (e.target.style.borderColor = accentColor)}
                    onBlur={e => (e.target.style.borderColor = '')}
                  />
                </div>

                {/* Field selector */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Target Field</label>
                  <select
                    value={frField}
                    onChange={e => { setFrField(e.target.value as 'url' | 'name'); setFrResult(null); }}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2.5 text-sm focus:outline-none bg-transparent text-gray-900 dark:text-white"
                    onFocus={e => (e.target.style.borderColor = accentColor)}
                    onBlur={e => (e.target.style.borderColor = '')}
                  >
                    <option value="url">Stream URL</option>
                    <option value="name">Channel Name</option>
                  </select>
                </div>

                {/* Scope selector */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Scope</label>
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-2.5 px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer">
                      <input type="radio" name="fr-scope" value="playlist" checked={frScope === 'playlist'}
                        onChange={() => { setFrScope('playlist'); setFrResult(null); }}
                         />
                      <span className="text-sm text-gray-700 dark:text-gray-200">All channels in playlist</span>
                      <span className="ml-auto text-xs text-gray-400 tabular-nums">{channels.length}</span>
                    </label>
                    <label className="flex items-center gap-2.5 px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer">
                      <input type="radio" name="fr-scope" value="category" checked={frScope === 'category'}
                        onChange={() => { setFrScope('category'); setFrResult(null); }}
                         />
                      <span className="text-sm text-gray-700 dark:text-gray-200">All in this category</span>
                      <span className="ml-auto text-xs text-gray-400">{activeCategory ?? '—'}</span>
                    </label>
                    <label className={`flex items-center gap-2.5 px-3 py-2 rounded ${selectedIds.size > 0 ? 'hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer' : 'opacity-60 cursor-default'}`}>
                      <input type="radio" name="fr-scope" value="selected" checked={frScope === 'selected'}
                        onChange={() => { if (selectedIds.size > 0) { setFrScope('selected'); setFrResult(null); } }}
                        disabled={selectedIds.size === 0}
                         />
                      <span className="text-sm text-gray-700 dark:text-gray-200">Selected channels only</span>
                      {selectedIds.size > 0 ? (
                        <span className="ml-auto text-xs text-gray-400 tabular-nums">{selectedIds.size}</span>
                      ) : (
                        <span className="ml-auto text-[10px] text-gray-500 italic">Select channels first</span>
                      )}
                    </label>

                  </div>
                </div>

                {/* Match preview */}
                {frSearch && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded bg-gray-50 dark:bg-white/5">
                    <Search className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                    <span className="text-sm font-medium tabular-nums" style={{ color: matchCount > 0 ? accentColor : undefined }}>
                      {matchCount} of {scopeChannels.length} channel{scopeChannels.length !== 1 ? 's' : ''} match
                    </span>
                  </div>
                )}

                {/* Result message */}
                {frResult && (
                  <div className={`flex items-center gap-2 px-3 py-2.5 rounded ${
                    frResult.modified > 0
                      ? 'bg-green-50 dark:bg-green-900/20'
                      : 'bg-gray-50 dark:bg-white/5'
                  }`}>
                    <Check className={`h-3.5 w-3.5 shrink-0 ${
                      frResult.modified > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400'
                    }`} />
                    <span className={`text-sm font-medium ${
                      frResult.modified > 0
                        ? 'text-green-700 dark:text-green-400'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {frResult.modified > 0
                        ? `Replaced in ${frResult.modified} channel${frResult.modified !== 1 ? 's' : ''}`
                        : 'No channels were modified'
                      }
                    </span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-1 px-4 py-4">
                <button
                  onClick={() => setShowFindReplace(false)}
                  className="md-btn h-9 px-4 rounded text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-300"
                >
                  {frResult ? 'Done' : 'Cancel'}
                </button>
                <button
                  onClick={handleExecuteReplace}
                  disabled={!frSearch || matchCount === 0 || frRunning}
                  className="md-btn h-9 px-4 rounded text-xs font-medium uppercase tracking-wider disabled:opacity-40"
                  style={{ color: frSearch && matchCount > 0 ? accentColor : undefined }}
                >
                  {frRunning ? 'Replacing…' : 'Replace All'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
