import React, { useEffect, useMemo, useState } from 'react';
import {
  api, Channel, LinkCandidate, SyncField, SYNC_FIELDS, SyncFieldToggles as Toggles,
  triggerRefresh, triggerChannelPoolRefresh,
} from '../apiClient';
import { useStore, notifyError, notifyInfo } from '../store';
import { useDebouncedValue } from '../utils/useDebouncedValue';
import Dialog from './Dialog';
import ChannelLogo from './ChannelLogo';
import SyncFieldToggles, { SYNC_FIELD_LABELS, anySyncFieldOn } from './SyncFieldToggles';
import Icon from './Icon';

const lettersAndDigits = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
// Words of 4+ characters, so short filler like "not", "the" or "hd" doesn't count as the two
// names having something in common.
const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4);

// Loose "do these look like the same channel?" check behind the gentle warning. It only ever
// warns, never blocks: renamed and foreign-language channels are perfectly legitimate links.
function namesLookUnrelated(a: string, b: string): boolean {
  const sa = lettersAndDigits(a);
  const sb = lettersAndDigits(b);
  if (!sa || !sb || sa.includes(sb) || sb.includes(sa)) return false;
  const wordsB = new Set(words(b));
  return !words(a).some(w => wordsB.has(w));
}

/**
 * "Link to source" for a channel that's already in a playlist: pick a pool channel (suggestions
 * first, or search), then decide per differing field whether to take the source's value now or
 * keep the channel's own. A kept value behaves like a manual edit: later provider changes to it
 * arrive as suggestions instead of being applied.
 */
export default function LinkChannelDialog({
  playlistId,
  channel,
  onClose,
}: {
  playlistId: string;
  channel: Channel;
  onClose: () => void;
}) {
  const { logoBgColor } = useStore();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);
  const [candidates, setCandidates] = useState<LinkCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<LinkCandidate | null>(null);
  const [fields, setFields] = useState<Toggles | null>(channel.link?.fields ?? null);
  const [choices, setChoices] = useState<Partial<Record<SyncField, 'source' | 'mine'>>>({});
  const [saving, setSaving] = useState(false);

  // A relink keeps the channel's current sync settings; a first link starts from the defaults.
  useEffect(() => {
    if (channel.link) return;
    api.getSettings()
      .then(s => setFields(prev => prev ?? s.defaultSyncFields))
      .catch(e => { console.error(e); notifyError(e, "Couldn't load your default sync settings."); });
  }, [channel.link]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.getLinkCandidates(playlistId, channel.id, debouncedQuery.trim() || undefined)
      .then(data => { if (alive) setCandidates(data); })
      .catch(e => { console.error(e); if (alive) notifyError(e, "Couldn't load channels from your sources. Try again."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [playlistId, channel.id, debouncedQuery]);

  const differingFields = useMemo(
    () => selected ? SYNC_FIELDS.filter(f => (channel[f] || null) !== (selected[f] || null)) : [],
    [selected, channel],
  );

  // The stream link defaults to the source's value (usually the point of linking); everything
  // else defaults to keeping what the user already has.
  const pick = (candidate: LinkCandidate) => {
    setSelected(candidate);
    const initial: Partial<Record<SyncField, 'source' | 'mine'>> = {};
    for (const f of SYNC_FIELDS) initial[f] = f === 'url' ? 'source' : 'mine';
    setChoices(initial);
  };

  const confirm = async () => {
    if (!selected || !fields) return;
    setSaving(true);
    try {
      await api.linkChannel(playlistId, channel.id, {
        poolEntryId: selected.id,
        fields,
        useSourceValues: differingFields.filter(f => choices[f] === 'source'),
      });
      triggerRefresh();
      triggerChannelPoolRefresh();
      notifyInfo(`"${channel.name}" is now kept in sync with ${selected.sourceName}.`);
      onClose();
    } catch (e) {
      console.error(e);
      notifyError(e, "Couldn't link the channel. Try again.");
      setSaving(false);
    }
  };

  const inputCls = 'field h-12 pl-11 rounded-full bg-surface-container-highest border-transparent max-md:text-base';

  return (
    <Dialog onClose={onClose} dismissible={!saving} maxWidth="max-w-lg" panelClassName="max-h-[85vh]">
      <div className="px-6 pt-6 pb-2">
        <h2 className="text-headline-sm text-on-surface">{channel.link ? 'Link to another channel' : 'Link to source'}</h2>
        <p className="text-body-md text-on-surface-variant mt-1">
          Keep <span className="font-semibold text-on-surface">{channel.name || 'Unnamed'}</span> in sync with a channel from one of your sources.
        </p>
      </div>

      {!selected ? (
        <div className="flex flex-col min-h-0 flex-1">
          <div className="px-6 pt-4 pb-2">
            <div className="relative">
              <Icon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-[24px] text-on-surface-variant" />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search your sources by name or link…"
                className={inputCls}
              />
            </div>
            {!query && (
              <p className="text-body-sm text-on-surface-variant mt-2 px-4">Suggestions: same stream link first, then similar names.</p>
            )}
          </div>
          <div className="flex-1 min-h-[12rem] overflow-y-auto px-3 pb-3">
            {loading ? (
              <div className="flex justify-center py-10"><Icon name="progress_activity" className="text-[24px] animate-spin text-on-surface-variant" /></div>
            ) : candidates.length === 0 ? (
              <p className="text-body-md text-on-surface-variant text-center px-6 py-10">
                {query
                  ? 'No channels match. Uploaded-file sources aren\'t listed, because they never change.'
                  : 'No suggestions for this channel. Search for it by name.'}
              </p>
            ) : (
              candidates.map(c => (
                <button
                  key={c.id}
                  onClick={() => pick(c)}
                  className="md-btn w-full flex items-center gap-3 px-3 h-14 rounded-xl text-left"
                >
                  <ChannelLogo logo={c.logo} name={c.name} logoBgColor={logoBgColor} className="w-12 h-8 shrink-0 rounded-md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-label-lg text-on-surface truncate">{c.name}</p>
                    <p className="text-body-sm text-on-surface-variant truncate">{c.sourceName} · {c.category}</p>
                  </div>
                  {c.match !== 'search' && (
                    <span className="shrink-0 h-6 px-2.5 inline-flex items-center rounded-lg text-label-sm bg-secondary-container text-on-secondary-container">
                      {c.match === 'url' ? 'Same stream link' : 'Similar name'}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          <div className="flex items-center gap-3 rounded-xl bg-surface-container-highest pl-3 pr-1.5 py-2.5">
            <ChannelLogo logo={selected.logo} name={selected.name} logoBgColor={logoBgColor} className="w-12 h-8 shrink-0 rounded-md" />
            <div className="flex-1 min-w-0">
              <p className="text-label-lg text-on-surface truncate">{selected.name}</p>
              <p className="text-body-sm text-on-surface-variant truncate">{selected.sourceName} · {selected.category}</p>
            </div>
            <button
              onClick={() => setSelected(null)}
              disabled={saving}
              className="md-btn btn btn-text"
            >
              <Icon name="chevron_left" className="text-[20px]" /> Change
            </button>
          </div>

          {namesLookUnrelated(channel.name, selected.name) && (
            <div className="flex gap-2.5 rounded-xl bg-tertiary-container text-on-tertiary-container p-3">
              <Icon name="warning" className="text-[20px] shrink-0 mt-0.5" />
              <p className="text-body-sm">These look like different channels. You can still link them if that's what you want.</p>
            </div>
          )}

          <div>
            <p className="field-label mb-2">What to keep in sync</p>
            {fields
              ? <SyncFieldToggles value={fields} onChange={setFields} disabled={saving} />
              : <p className="text-body-md text-on-surface-variant">Loading…</p>}
          </div>

          <div>
            <p className="field-label mb-2">Differences</p>
            {differingFields.length === 0 ? (
              <p className="text-body-md text-on-surface-variant">Your channel already matches this one.</p>
            ) : (
              <div className="space-y-3">
                {differingFields.map(field => (
                  <div key={field}>
                    <p className="text-label-md text-on-surface mb-1.5">{SYNC_FIELD_LABELS[field]}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(['mine', 'source'] as const).map(option => {
                        const active = choices[field] === option;
                        const value = option === 'mine' ? channel[field] : selected[field];
                        return (
                          <button
                            key={option}
                            onClick={() => setChoices(prev => ({ ...prev, [field]: option }))}
                            disabled={saving}
                            className={`md-btn text-left rounded-xl border px-3 py-2 min-w-0 ${active ? 'border-transparent bg-secondary-container text-on-secondary-container' : 'border-outline-variant'}`}
                          >
                            <span className="flex items-center gap-1 text-label-md">
                              {active && <Icon name="check" className="text-[18px] shrink-0" />}
                              {option === 'mine' ? 'Keep mine' : 'Use source value'}
                            </span>
                            <span className="block text-body-sm font-mono opacity-80 truncate" title={value || undefined}>
                              {value || '(empty)'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 px-6 py-5">
        <button onClick={onClose} disabled={saving} className="md-btn btn btn-text">
          Cancel
        </button>
        {selected && (
          <button
            onClick={confirm}
            disabled={saving || !fields || !anySyncFieldOn(fields)}
            className="md-btn btn btn-filled"
          >
            {saving ? 'Linking…' : 'Link'}
          </button>
        )}
      </div>
    </Dialog>
  );
}
