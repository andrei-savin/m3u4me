import { useState } from 'react';
import Switch from './Switch';
import { Channel, SyncFieldToggles as Toggles } from '../apiClient';
import { useStore } from '../store';
import BottomSheet from './BottomSheet';
import ChannelLogo from './ChannelLogo';
import TvgIdAutocomplete from './TvgIdAutocomplete';
import { ChannelSyncDetails } from './ChannelSyncPopover';
import Icon from './Icon';

/** The channel's text fields in the form. */
type TextField = 'name' | 'url' | 'logo' | 'tvgId' | 'category' | 'httpReferrer' | 'httpUserAgent';
const TEXT_FIELDS: TextField[] = ['name', 'url', 'logo', 'tvgId', 'category', 'httpReferrer', 'httpUserAgent'];

/** What Save sends for the channel itself: only the fields that changed. */
export type ChannelChanges = Partial<Record<TextField, string | null>> & { isHidden?: boolean };

const labelCls = 'field-label';
// text-body-lg (16px) on purpose: iPhones zoom the whole page in on any smaller input.
const inputCls = 'field h-12 text-body-lg';
const monoInputProps = { inputMode: 'url' as const, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false };
const actionRowCls = 'md-btn w-full h-14 flex items-center gap-4 px-6 text-left text-body-lg';

/**
 * The channel editor on phones: tapping a channel in PlaylistEditor opens this sheet with
 * everything about it in one place, since the desktop row's click-to-edit fields don't fit
 * on a phone.
 *
 * It's one form. Every setting in it (the text fields, "Show in playlist", the stream
 * headers and the sync checkboxes) is only a draft until Save; ✕ and Cancel throw the draft
 * away. Tapping outside the sheet does nothing while there are unsaved changes, so they
 * can't be lost by accident. (An early version saved the switch and checkboxes the moment
 * they were touched, which left Save greyed out and made ✕ look like it saved.)
 *
 * Only what changed is sent: the server treats some fields as "the user decided this" just
 * by being present (see afterManualChannelEdit in server.ts: any `isHidden` takes hiding
 * away from sync), so sending unchanged values would have side effects.
 *
 * Buttons that *do* something (Use new / Keep mine on a sync suggestion, Link, Unlink,
 * Insert, Delete) act straight away, like buttons anywhere else.
 *
 * With `isNew` it's the form for adding a channel (the phone's + button, or "Insert a new
 * channel above/below"). The channel doesn't exist until Add is pressed, so Cancel really
 * cancels; `channel` is just the empty starting values, and `onSave` gets every text field.
 */
export default function ChannelEditSheet({
  isNew = false,
  playlistId,
  channel,
  categories,
  tvgIdLabel,
  sourceName,
  onSave,
  onLinkToSource,
  onInsert,
  onDelete,
  onClose,
}: {
  isNew?: boolean;
  playlistId: string;
  channel: Channel;
  categories: string[];
  tvgIdLabel?: { displayName: string; sourceName: string };
  // Name of the source a linked channel follows.
  sourceName?: string;
  // `syncFields` is only passed when the sync checkboxes changed. Rejects if the save failed
  // (the error is already shown); the sheet then stays open.
  onSave: (changes: ChannelChanges, syncFields?: Toggles) => Promise<void>;
  onClose: () => void;
  // The rest are only used for a channel that already exists (not `isNew`).
  onLinkToSource?: () => void;
  onInsert?: (position: 'above' | 'below') => void;
  onDelete?: () => void;
}) {
  const { logoBgColor } = useStore();
  const [text, setText] = useState<Partial<Record<TextField, string>>>({});
  const [isHiddenDraft, setIsHiddenDraft] = useState<boolean | null>(null);
  const [syncFieldsDraft, setSyncFieldsDraft] = useState<Toggles | null>(null);
  const [saving, setSaving] = useState(false);

  // What the form shows: your unsaved edit if there is one, otherwise the saved value. Fields
  // you haven't touched keep following the channel (e.g. after "Use new" on a suggestion).
  const valueOf = (field: TextField) => text[field] ?? channel[field] ?? '';
  const setField = (field: TextField, value: string) => setText(prev => ({ ...prev, [field]: value }));
  const isHidden = isHiddenDraft ?? !!channel.isHidden;
  const syncFields = syncFieldsDraft ?? channel.link?.fields;

  // ── What Save would send ──
  const changes: ChannelChanges = {};
  for (const field of TEXT_FIELDS) {
    const value = text[field];
    if (value === undefined || value.trim() === (channel[field] ?? '')) continue;
    // A channel always needs a category, so an empty one isn't a change.
    if (field === 'category' && !value.trim()) continue;
    changes[field] = value.trim() || null;
  }
  if (isHiddenDraft !== null && isHiddenDraft !== !!channel.isHidden) changes.isHidden = isHiddenDraft;
  const savedSyncFields = channel.link?.fields;
  // Only while the channel is still linked (it can be unlinked from inside the sheet).
  const syncFieldsChanged = !!savedSyncFields && !!syncFieldsDraft
    && (Object.keys(savedSyncFields) as (keyof Toggles)[]).some(f => savedSyncFields[f] !== syncFieldsDraft[f]);

  const hasChanges = Object.keys(changes).length > 0 || syncFieldsChanged;
  // A new channel needs at least a name, and counts as changed as soon as anything is typed.
  const canSave = isNew ? valueOf('name').trim() !== '' : hasChanges;
  const isDirty = isNew ? (Object.values(text) as string[]).some(v => !!v.trim()) : hasChanges;

  const save = async () => {
    setSaving(true);
    try {
      if (isNew) {
        // Every field, not just changes: there's nothing saved yet to compare against.
        await onSave(Object.fromEntries(TEXT_FIELDS.map(f => [f, valueOf(f).trim()])));
      } else {
        await onSave(changes, syncFieldsChanged ? syncFieldsDraft! : undefined);
      }
      onClose();
    } catch {
      // The error was already shown; stay open so nothing typed is lost.
      setSaving(false);
    }
  };

  const showingSavedTvgId = valueOf('tvgId') === (channel.tvgId ?? '');

  return (
    <BottomSheet
      onClose={onClose}
      // Tapping outside or Escape: only when there's nothing to lose. ✕ always closes,
      // without saving, the same as Cancel.
      dismissible={!isDirty && !saving}
      canClose={!saving}
      title={isNew ? 'New channel' : channel.name || 'Unnamed'}
      footer={
        <div className="flex justify-end gap-2 px-4 py-4">
          <button
            onClick={onClose}
            disabled={saving}
            className="md-btn btn btn-text"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!canSave || saving}
            className="md-btn btn btn-filled"
          >
            {isNew ? (saving ? 'Adding…' : 'Add') : (saving ? 'Saving…' : 'Save')}
          </button>
        </div>
      }
    >
      <div className="px-6 py-4 space-y-5">
        <div>
          <label className={labelCls} htmlFor="sheet-name">Name</label>
          <input id="sheet-name" value={valueOf('name')} onChange={e => setField('name', e.target.value)} className={inputCls} placeholder="Channel name" autoFocus={isNew} />
        </div>

        <div>
          <label className={labelCls} htmlFor="sheet-url">Stream link</label>
          <input id="sheet-url" value={valueOf('url')} onChange={e => setField('url', e.target.value)} className={`${inputCls} font-mono`} placeholder="https://…" {...monoInputProps} />
        </div>

        <div>
          <label className={labelCls} htmlFor="sheet-logo">Logo link</label>
          <div className="flex items-center gap-3">
            <ChannelLogo
              logo={valueOf('logo') || null}
              name={valueOf('name')}
              logoBgColor={logoBgColor}
              className="shrink-0 w-14 h-10 rounded-md"
            />
            <input id="sheet-logo" value={valueOf('logo')} onChange={e => setField('logo', e.target.value)} className={`${inputCls} font-mono`} placeholder="https://…" {...monoInputProps} />
          </div>
        </div>

        <div>
          <label className={labelCls}>TVG-ID (TV guide)</label>
          <TvgIdAutocomplete mode="field" value={valueOf('tvgId')} onChange={v => setField('tvgId', v)} />
          {showingSavedTvgId && tvgIdLabel && (
            <span
              className="inline-flex items-center gap-1.5 mt-2 h-7 px-2.5 rounded-lg border border-outline-variant text-label-md text-on-surface max-w-full"
            >
              <span className="truncate">{tvgIdLabel.displayName}</span>
              <span className="shrink-0 font-normal text-on-surface-variant">· {tvgIdLabel.sourceName}</span>
            </span>
          )}
        </div>

        <div>
          <label className={labelCls} htmlFor="sheet-category">Category</label>
          <select id="sheet-category" value={valueOf('category')} onChange={e => setField('category', e.target.value)} className={inputCls}>
            {/* Keeps the current category listed even if it's missing from the playlist's list. */}
            {!categories.includes(channel.category) && <option value={channel.category}>{channel.category}</option>}
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {!isNew && (
          <div className="flex items-center gap-3 pt-1">
            <div className="flex-1 min-w-0">
              <p className="text-body-lg text-on-surface">Show in playlist</p>
              <p className="text-body-sm text-on-surface-variant">
                {isHidden ? 'Hidden: players won’t see this channel.' : 'Players see this channel.'}
              </p>
            </div>
            <Switch checked={!isHidden} onChange={show => setIsHiddenDraft(!show)} label="Show in playlist" />
          </div>
        )}
      </div>

      {/* ── Stream headers ─────────────────────────────────────────────── */}
      <div className="border-t border-outline-variant px-6 py-5 space-y-5">
        <div>
          <p className="text-title-md text-on-surface">Stream headers</p>
          <p className="text-body-sm text-on-surface-variant">
            Only for channels that won't play without them. Leave both empty otherwise.
          </p>
        </div>
        <div>
          <label className={labelCls} htmlFor="sheet-referrer">Referrer</label>
          <input id="sheet-referrer" value={valueOf('httpReferrer')} onChange={e => setField('httpReferrer', e.target.value)} className={`${inputCls} font-mono`} placeholder="https://…" {...monoInputProps} />
        </div>
        <div>
          <label className={labelCls} htmlFor="sheet-user-agent">User-agent</label>
          <input id="sheet-user-agent" value={valueOf('httpUserAgent')} onChange={e => setField('httpUserAgent', e.target.value)} className={`${inputCls} font-mono`} placeholder="Mozilla/5.0 …" {...monoInputProps} inputMode="text" />
        </div>
      </div>

      {isNew ? (
        <p className="border-t border-outline-variant px-6 py-4 text-body-sm text-on-surface-variant">
          Once it's added, tap the channel to hide it or keep it in sync with a source.
        </p>
      ) : (<>
        {/* ── Sync ───────────────────────────────────────────────────────── */}
        <div className="border-t border-outline-variant py-2">
          {channel.link ? (
            <div className="mx-4 rounded-xl bg-surface-container-high">
              <ChannelSyncDetails
                playlistId={playlistId}
                channel={channel}
                sourceName={sourceName || 'its source'}
                onRelink={() => onLinkToSource?.()}
                onUnlinked={() => setSyncFieldsDraft(null)}
                fields={syncFields}
                onFieldsChange={setSyncFieldsDraft}
              />
            </div>
          ) : (
            <button onClick={() => onLinkToSource?.()} className={`${actionRowCls} text-on-surface`}>
              <Icon name="link" className="text-[24px] shrink-0 text-on-surface-variant" />
              <span className="flex-1 min-w-0">
                Link to source…
                <span className="block text-body-sm text-on-surface-variant">Keep this channel in sync with a channel from your sources.</span>
              </span>
              <Icon name="chevron_right" className="text-[20px] shrink-0 text-on-surface-variant" />
            </button>
          )}
        </div>

        {/* ── Insert and delete ─────────────────────────────────────────── */}
        <div className="border-t border-outline-variant py-1">
          {/* Not while there are unsaved changes: the new channel's form replaces this one. */}
          <button onClick={() => onInsert?.('above')} disabled={isDirty} className={`${actionRowCls} text-on-surface disabled:opacity-40`}>
            <Icon name="arrow_upward" className="text-[24px] shrink-0 text-on-surface-variant" />
            Insert a new channel above
          </button>
          <button onClick={() => onInsert?.('below')} disabled={isDirty} className={`${actionRowCls} text-on-surface disabled:opacity-40`}>
            <Icon name="arrow_downward" className="text-[24px] shrink-0 text-on-surface-variant" />
            Insert a new channel below
          </button>
          <button onClick={() => onDelete?.()} className={`${actionRowCls} text-error`}>
            <Icon name="delete" className="text-[24px] shrink-0" />
            Delete channel
          </button>
        </div>
      </>)}
    </BottomSheet>
  );
}
