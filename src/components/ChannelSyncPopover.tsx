import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link2, AlertTriangle } from 'lucide-react';
import { api, Channel, SyncField, SYNC_FIELDS, SyncFieldToggles as Toggles, triggerRefresh, triggerChannelPoolRefresh } from '../apiClient';
import { useStore, notifyError, notifyInfo } from '../store';
import SyncFieldToggles, { SYNC_FIELD_LABELS, anySyncFieldOn } from './SyncFieldToggles';
import Dialog from './Dialog';

function ValueLine({ label, value, strong = false }: { label: string; value: string | null | undefined; strong?: boolean }) {
  return (
    <div className="flex gap-2 text-[11px] min-w-0">
      <span className="w-10 shrink-0 text-gray-400 dark:text-gray-500">{label}</span>
      <span
        className={`truncate font-mono ${strong ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}
        title={value || undefined}
      >
        {value || '(empty)'}
      </span>
    </div>
  );
}

/**
 * Sync details for one linked playlist channel: suggestions waiting for Apply/Dismiss, the
 * "Source lost" explanation, which fields sync, and Unlink. Opened from the row's link button,
 * its suggestion dot or its "Source lost" chip.
 *
 * Rendered into document.body (a portal) so the scrolling channel list can't clip it, and
 * positioned next to whatever opened it. Closes on an outside click, Escape, or when the page
 * scrolls or resizes (the element it's attached to would have moved).
 */
export function ChannelSyncPopover({
  playlistId,
  channel,
  sourceName,
  anchor,
  onClose,
  onRelink,
}: {
  playlistId: string;
  channel: Channel;
  sourceName: string;
  anchor: DOMRect;
  onClose: () => void;
  onRelink: () => void;
}) {
  const { accentColor } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const link = channel.link!;
  const [fields, setFields] = useState<Toggles>(link.fields);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setFields(link.fields); }, [link.fields]);

  // Below the anchor when there's room, otherwise above it. Left-aligned with the anchor unless
  // that would run off the right edge.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const margin = 8;
    const rect = el.getBoundingClientRect();
    let top = anchor.bottom + 4;
    if (top + rect.height > window.innerHeight - margin) top = Math.max(margin, anchor.top - rect.height - 4);
    const preferredLeft = anchor.left + rect.width <= window.innerWidth - margin ? anchor.left : anchor.right - rect.width;
    const left = Math.max(margin, Math.min(preferredLeft, window.innerWidth - rect.width - margin));
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }, [anchor, channel]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const saveFields = async (next: Toggles) => {
    const previous = fields;
    setFields(next);
    setBusy(true);
    try {
      await api.updateChannelLink(playlistId, channel.id, next);
      triggerRefresh();
    } catch (e) {
      console.error(e);
      setFields(previous);
      notifyError(e, "Couldn't save the sync settings. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleSuggestion = async (field: SyncField, action: 'apply' | 'dismiss') => {
    setBusy(true);
    try {
      if (action === 'apply') await api.applySyncSuggestion(playlistId, channel.id, field);
      else await api.dismissSyncSuggestion(playlistId, channel.id, field);
      triggerRefresh();
    } catch (e) {
      console.error(e);
      notifyError(e, "Couldn't save your choice. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    setBusy(true);
    try {
      await api.unlinkChannel(playlistId, channel.id);
      triggerRefresh();
      triggerChannelPoolRefresh();
      notifyInfo(`"${channel.name}" won't sync anymore.`);
      onClose();
    } catch (e) {
      console.error(e);
      notifyError(e, "Couldn't unlink the channel. Try again.");
      setBusy(false);
    }
  };

  const pendingFields = SYNC_FIELDS.filter(f => f in link.pending);
  const smallBtn = 'md-btn h-7 px-2.5 rounded text-[11px] font-medium uppercase tracking-wider disabled:opacity-40';

  return createPortal(
    <div
      ref={ref}
      className="md-menu fixed z-50 w-80 bg-white dark:bg-[#272727] amoled:dark:bg-[#1a1a1a] rounded elev-8 border border-gray-200 dark:border-white/10 text-left"
      onMouseDown={e => e.stopPropagation()}
      onContextMenu={e => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <Link2 className="h-4 w-4 shrink-0" style={{ color: accentColor }} />
        <p className="text-sm text-gray-900 dark:text-white min-w-0 truncate">
          Kept in sync with <span className="font-medium">{sourceName}</span>
        </p>
      </div>

      <div className="px-4 pb-3 space-y-3">
        {link.lost && (
          <div className="flex gap-2 rounded border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 p-2.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-gray-500 dark:text-gray-400" />
            <p className="text-xs text-gray-600 dark:text-gray-300">
              This channel disappeared from its source{channel.hiddenBySync ? ', so it was hidden' : ''}. If the provider brings it back, it syncs again{channel.hiddenBySync ? ' and shows up in your playlist' : ''} automatically.
            </p>
          </div>
        )}

        {pendingFields.map(field => (
          <div key={field} className="rounded border p-2.5" style={{ borderColor: `${accentColor}55`, backgroundColor: `${accentColor}0d` }}>
            <p className="text-xs font-medium text-gray-900 dark:text-white mb-1.5">New {SYNC_FIELD_LABELS[field].toLowerCase()} from source</p>
            <ValueLine label="Yours" value={channel[field]} />
            <ValueLine label="New" value={link.pending[field]} strong />
            <div className="flex justify-end gap-1 mt-2">
              <button disabled={busy} onClick={() => handleSuggestion(field, 'dismiss')} className={`${smallBtn} text-gray-600 dark:text-gray-300`}>
                Keep mine
              </button>
              <button disabled={busy} onClick={() => handleSuggestion(field, 'apply')} className={smallBtn} style={{ color: accentColor }}>
                Use new
              </button>
            </div>
          </div>
        ))}

        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400 mb-1.5">What to keep in sync</p>
          <SyncFieldToggles value={fields} onChange={saveFields} accentColor={accentColor} disabled={busy} />
          {!anySyncFieldOn(fields) && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5">Nothing is synced right now. You can unlink this channel instead.</p>
          )}
        </div>
      </div>

      <div className="flex justify-between gap-1 px-2 pb-2 pt-1 border-t border-gray-100 dark:border-white/8">
        <button disabled={busy} onClick={onRelink} className={`${smallBtn} text-gray-600 dark:text-gray-300`}>
          Link to another channel
        </button>
        <button disabled={busy} onClick={unlink} className={`${smallBtn} text-red-600 dark:text-red-400`}>
          Unlink
        </button>
      </div>
    </div>,
    document.body
  );
}

/** "Sync settings…" from the selection bar: one set of fields for every selected linked channel. */
export function BulkSyncSettingsDialog({
  playlistId,
  channels,
  onClose,
}: {
  playlistId: string;
  // Only the linked channels from the selection.
  channels: Channel[];
  onClose: () => void;
}) {
  const { accentColor } = useStore();
  const [fields, setFields] = useState<Toggles>(channels[0]?.link?.fields ?? { url: true, name: true, logo: true, tvgId: true });
  const [saving, setSaving] = useState(false);
  const count = channels.length;

  const save = async () => {
    setSaving(true);
    try {
      const result = await api.bulkUpdateLinkSettings(playlistId, channels.map(c => c.id), fields);
      triggerRefresh();
      notifyInfo(`Updated sync settings for ${result.updated} channel${result.updated !== 1 ? 's' : ''}.`);
      onClose();
    } catch (e) {
      console.error(e);
      notifyError(e, "Couldn't save the sync settings. Try again.");
      setSaving(false);
    }
  };

  return (
    <Dialog onClose={onClose} dismissible={!saving}>
      <h2 className="text-xl font-medium text-gray-900 dark:text-white px-6 pt-6 pb-2">Sync Settings</h2>
      <div className="px-6 pb-4 space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          These replace the current settings on the {count} linked channel{count !== 1 ? 's' : ''} in your selection. Unlinked channels are left alone.
        </p>
        <SyncFieldToggles value={fields} onChange={setFields} accentColor={accentColor} disabled={saving} />
      </div>
      <div className="flex justify-end gap-1 px-4 pb-4">
        <button onClick={onClose} disabled={saving} className="md-btn h-9 px-4 rounded text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-300">
          Cancel
        </button>
        <button onClick={save} disabled={saving} className="md-btn h-9 px-4 rounded text-xs font-medium uppercase tracking-wider disabled:opacity-40" style={{ color: accentColor }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Dialog>
  );
}
