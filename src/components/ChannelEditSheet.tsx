import { useState } from 'react';
import { ArrowUp, ArrowDown, Trash2, Link2, ChevronRight } from 'lucide-react';
import { Channel, SyncFieldToggles as Toggles } from '../apiClient';
import { useStore } from '../store';
import BottomSheet from './BottomSheet';
import ChannelLogo from './ChannelLogo';
import TvgIdAutocomplete from './TvgIdAutocomplete';
import { ChannelSyncDetails } from './ChannelSyncPopover';

/** The channel's text fields in the form. */
type TextField = 'name' | 'url' | 'logo' | 'tvgId' | 'category' | 'httpReferrer' | 'httpUserAgent';
const TEXT_FIELDS: TextField[] = ['name', 'url', 'logo', 'tvgId', 'category', 'httpReferrer', 'httpUserAgent'];

/** What Save sends for the channel itself: only the fields that changed. */
export type ChannelChanges = Partial<Record<TextField, string | null>> & { isHidden?: boolean };

const labelCls = 'block text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5';
// text-base (16px) on purpose: iPhones zoom the whole page in on any smaller input.
const inputCls = 'w-full h-11 px-3 rounded border border-gray-300 dark:border-gray-600 bg-transparent text-base text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none';
const monoInputProps = { inputMode: 'url' as const, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false };
const actionRowCls = 'md-btn w-full h-12 flex items-center gap-3 px-5 text-left text-sm';

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
  const { accentColor, logoBgColor } = useStore();
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
        <div className="flex justify-end gap-2 px-4 py-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="md-btn h-11 px-5 rounded-full text-sm font-medium text-gray-600 dark:text-gray-300 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!canSave || saving}
            className="md-btn h-11 px-6 rounded-full text-sm font-medium text-white disabled:opacity-40"
            style={{ backgroundColor: accentColor }}
          >
            {isNew ? (saving ? 'Adding…' : 'Add') : (saving ? 'Saving…' : 'Save')}
          </button>
        </div>
      }
    >
      <div className="px-5 py-4 space-y-4">
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
              className="shrink-0 w-12 h-9 rounded border border-gray-200 dark:border-white/10"
            />
            <input id="sheet-logo" value={valueOf('logo')} onChange={e => setField('logo', e.target.value)} className={`${inputCls} font-mono`} placeholder="https://…" {...monoInputProps} />
          </div>
        </div>

        <div>
          <label className={labelCls}>TVG-ID (TV guide)</label>
          <TvgIdAutocomplete mode="field" value={valueOf('tvgId')} onChange={v => setField('tvgId', v)} />
          {showingSavedTvgId && tvgIdLabel && (
            <span
              className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full text-xs font-medium max-w-full"
              style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
            >
              <span className="truncate">{tvgIdLabel.displayName}</span>
              <span className="shrink-0 opacity-50">•</span>
              <span className="shrink-0 opacity-80">{tvgIdLabel.sourceName}</span>
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
              <p className="text-sm text-gray-900 dark:text-white">Show in playlist</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {isHidden ? 'Hidden: players won’t see this channel.' : 'Players see this channel.'}
              </p>
            </div>
            <button
              role="switch"
              aria-checked={!isHidden}
              aria-label="Show in playlist"
              onClick={() => setIsHiddenDraft(!isHidden)}
              className={`shrink-0 w-11 h-6 rounded-full relative transition-colors ${isHidden ? 'bg-gray-300 dark:bg-gray-600' : ''}`}
              style={isHidden ? undefined : { backgroundColor: accentColor }}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isHidden ? '' : 'translate-x-5'}`} />
            </button>
          </div>
        )}
      </div>

      {/* ── Stream headers ─────────────────────────────────────────────── */}
      <div className="border-t border-gray-100 dark:border-white/10 px-5 py-4 space-y-4">
        <div>
          <p className="text-sm text-gray-900 dark:text-white">Stream headers</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
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
        <p className="border-t border-gray-100 dark:border-white/10 px-5 py-4 text-xs text-gray-500 dark:text-gray-400">
          Once it's added, tap the channel to hide it or keep it in sync with a source.
        </p>
      ) : (<>
        {/* ── Sync ───────────────────────────────────────────────────────── */}
        <div className="border-t border-gray-100 dark:border-white/10 py-2">
          {channel.link ? (
            <div className="mx-4 rounded border border-gray-200 dark:border-white/10">
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
            <button onClick={() => onLinkToSource?.()} className={`${actionRowCls} text-gray-700 dark:text-gray-200`}>
              <Link2 className="h-4 w-4 shrink-0 text-gray-400" />
              <span className="flex-1 min-w-0">
                Link to source…
                <span className="block text-xs text-gray-500 dark:text-gray-400">Keep this channel in sync with a channel from your sources.</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
            </button>
          )}
        </div>

        {/* ── Insert and delete ─────────────────────────────────────────── */}
        <div className="border-t border-gray-100 dark:border-white/10 py-1">
          {/* Not while there are unsaved changes: the new channel's form replaces this one. */}
          <button onClick={() => onInsert?.('above')} disabled={isDirty} className={`${actionRowCls} text-gray-700 dark:text-gray-200 disabled:opacity-40`}>
            <ArrowUp className="h-4 w-4 shrink-0 text-gray-400" />
            Insert a new channel above
          </button>
          <button onClick={() => onInsert?.('below')} disabled={isDirty} className={`${actionRowCls} text-gray-700 dark:text-gray-200 disabled:opacity-40`}>
            <ArrowDown className="h-4 w-4 shrink-0 text-gray-400" />
            Insert a new channel below
          </button>
          <button onClick={() => onDelete?.()} className={`${actionRowCls} text-red-600 dark:text-red-400`}>
            <Trash2 className="h-4 w-4 shrink-0" />
            Delete channel
          </button>
        </div>
      </>)}
    </BottomSheet>
  );
}
