import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, Channel, SyncField, SYNC_FIELDS, SyncFieldToggles as Toggles, triggerRefresh, triggerChannelPoolRefresh } from '../apiClient';
import { useStore, notifyError, notifyInfo } from '../store';
import SyncFieldToggles, { SYNC_FIELD_LABELS, anySyncFieldOn } from './SyncFieldToggles';
import Dialog from './Dialog';
import Icon from './Icon';

function ValueLine({ label, value, strong = false }: { label: string; value: string | null | undefined; strong?: boolean }) {
  return (
    <div className="flex gap-2 text-body-sm min-w-0">
      <span className="w-10 shrink-0 text-on-surface-variant">{label}</span>
      <span
        className={`truncate font-mono ${strong ? 'text-on-surface' : 'text-on-surface-variant'}`}
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
  const ref = useRef<HTMLDivElement>(null);

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

  return createPortal(
    <div
      ref={ref}
      className="md-menu fixed z-50 w-80 bg-menu rounded-xl shadow-level-2 text-on-surface text-left"
      onMouseDown={e => e.stopPropagation()}
      onContextMenu={e => e.stopPropagation()}
    >
      <ChannelSyncDetails
        playlistId={playlistId}
        channel={channel}
        sourceName={sourceName}
        onRelink={onRelink}
        onUnlinked={onClose}
      />
    </div>,
    document.body
  );
}

/**
 * The inside of the sync popover: header, the "Source lost" note, suggestions waiting for
 * Keep mine / Use new, the fields to sync, and Link to another channel / Unlink. Shared by
 * the desktop popover above and the phone channel editor (ChannelEditSheet), which shows it
 * inline instead of floating next to the row.
 *
 * The "What to keep in sync" checkboxes save straight away in the popover. The phone editor
 * passes `fields` and `onFieldsChange` instead, so they become part of its form and are saved
 * with its Save button like everything else there.
 */
export function ChannelSyncDetails({
  playlistId,
  channel,
  sourceName,
  onRelink,
  onUnlinked,
  fields: fieldsFromForm,
  onFieldsChange,
}: {
  playlistId: string;
  channel: Channel;
  sourceName: string;
  onRelink: () => void;
  // Called after Unlink worked; the popover closes itself here.
  onUnlinked: () => void;
  fields?: Toggles;
  onFieldsChange?: (fields: Toggles) => void;
}) {
  const link = channel.link!;
  const [fields, setFields] = useState<Toggles>(link.fields);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setFields(link.fields); }, [link.fields]);

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
      onUnlinked();
    } catch (e) {
      console.error(e);
      notifyError(e, "Couldn't unlink the channel. Try again.");
      setBusy(false);
    }
  };

  const pendingFields = SYNC_FIELDS.filter(f => f in link.pending);
  const shownFields = onFieldsChange && fieldsFromForm ? fieldsFromForm : fields;
  // Taller on phones, where these are tapped with a finger (in the channel editor sheet).
  const smallBtn = 'md-btn btn h-8 max-md:h-10 px-3 disabled:opacity-40';

  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <Icon name="link" className="text-[24px] shrink-0 text-primary" />
        <p className="text-body-md text-on-surface min-w-0 truncate">
          Kept in sync with <span className="font-semibold">{sourceName}</span>
        </p>
      </div>

      <div className="px-4 pb-3 space-y-3">
        {link.lost && (
          <div className="flex gap-2.5 rounded-lg bg-surface-container-highest p-3">
            <Icon name="warning" className="text-[20px] shrink-0 mt-0.5 text-on-surface-variant" />
            <p className="text-body-sm text-on-surface-variant">
              This channel disappeared from its source{channel.hiddenBySync ? ', so it was hidden' : ''}. If the provider brings it back, it syncs again{channel.hiddenBySync ? ' and shows up in your playlist' : ''} automatically.
            </p>
          </div>
        )}

        {pendingFields.map(field => (
          <div key={field} className="rounded-lg bg-primary-container/60 p-3">
            <p className="text-label-md text-on-primary-container mb-1.5">New {SYNC_FIELD_LABELS[field].toLowerCase()} from source</p>
            <ValueLine label="Yours" value={channel[field]} />
            <ValueLine label="New" value={link.pending[field]} strong />
            <div className="flex justify-end gap-1 mt-2">
              <button disabled={busy} onClick={() => handleSuggestion(field, 'dismiss')} className={`${smallBtn} text-on-surface-variant`}>
                Keep mine
              </button>
              <button disabled={busy} onClick={() => handleSuggestion(field, 'apply')} className={`${smallBtn} text-primary`}>
                Use new
              </button>
            </div>
          </div>
        ))}

        <div>
          <p className="text-label-md text-on-surface-variant mb-2">What to keep in sync</p>
          <SyncFieldToggles value={shownFields} onChange={onFieldsChange ?? saveFields} disabled={busy} />
          {!anySyncFieldOn(shownFields) && (
            <p className="text-body-sm text-on-surface-variant mt-2">Nothing is synced right now. You can unlink this channel instead.</p>
          )}
        </div>
      </div>

      <div className="flex justify-between gap-1 px-2 pb-2 pt-1 border-t border-outline-variant">
        <button disabled={busy} onClick={onRelink} className={`${smallBtn} text-on-surface-variant`}>
          Link to another channel
        </button>
        <button disabled={busy} onClick={unlink} className={`${smallBtn} text-error`}>
          Unlink
        </button>
      </div>
    </>
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
      <h2 className="text-headline-sm text-on-surface px-6 pt-6 pb-4">Sync settings</h2>
      <div className="px-6 pb-2 space-y-4">
        <p className="text-body-md text-on-surface-variant">
          These replace the current settings on the {count} linked channel{count !== 1 ? 's' : ''} in your selection. Unlinked channels are left alone.
        </p>
        <SyncFieldToggles value={fields} onChange={setFields} disabled={saving} />
      </div>
      <div className="flex justify-end gap-2 px-6 pt-4 pb-6">
        <button onClick={onClose} disabled={saving} className="md-btn btn btn-text">
          Cancel
        </button>
        <button onClick={save} disabled={saving} className="md-btn btn btn-text">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Dialog>
  );
}
