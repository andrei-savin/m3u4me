import React, { useEffect, useMemo, useState } from 'react';
import { Search, Loader2, AlertTriangle, ChevronLeft } from 'lucide-react';
import {
  api, Channel, LinkCandidate, SyncField, SYNC_FIELDS, SyncFieldToggles as Toggles,
  triggerRefresh, triggerChannelPoolRefresh,
} from '../apiClient';
import { useStore, notifyError, notifyInfo } from '../store';
import { useDebouncedValue } from '../utils/useDebouncedValue';
import Dialog from './Dialog';
import ChannelLogo from './ChannelLogo';
import SyncFieldToggles, { SYNC_FIELD_LABELS, anySyncFieldOn } from './SyncFieldToggles';

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
  const { accentColor, logoBgColor } = useStore();
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

  const inputCls = 'w-full pl-9 pr-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-transparent text-gray-900 dark:text-white focus:outline-none';

  return (
    <Dialog onClose={onClose} dismissible={!saving} maxWidth="max-w-lg" panelClassName="rounded max-h-[85vh]">
      <div className="px-6 pt-5 pb-3 border-b border-gray-100 dark:border-white/10">
        <h2 className="text-lg font-medium text-gray-900 dark:text-white">{channel.link ? 'Link to Another Channel' : 'Link to Source'}</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
          Keep <span className="font-medium text-gray-700 dark:text-gray-300">{channel.name || 'Unnamed'}</span> in sync with a channel from one of your sources.
        </p>
      </div>

      {!selected ? (
        <div className="flex flex-col min-h-0 flex-1">
          <div className="px-6 pt-4 pb-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search your sources by name or link…"
                className={inputCls}
                onFocus={e => (e.target.style.borderColor = accentColor)}
                onBlur={e => (e.target.style.borderColor = '')}
              />
            </div>
            {!query && (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5">Suggestions: same stream link first, then similar names.</p>
            )}
          </div>
          <div className="flex-1 min-h-[12rem] overflow-y-auto px-3 pb-3">
            {loading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center px-6 py-10">
                {query
                  ? 'No channels match. Uploaded-file sources aren\'t listed, because they never change.'
                  : 'No suggestions for this channel. Search for it by name.'}
              </p>
            ) : (
              candidates.map(c => (
                <button
                  key={c.id}
                  onClick={() => pick(c)}
                  className="md-btn w-full flex items-center gap-3 px-3 py-2 rounded text-left hover:bg-gray-50 dark:hover:bg-white/5"
                >
                  <ChannelLogo logo={c.logo} name={c.name} logoBgColor={logoBgColor} className="w-10 h-7 shrink-0 rounded border border-gray-200 dark:border-white/10" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{c.name}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{c.sourceName} · {c.category}</p>
                  </div>
                  {c.match !== 'search' && (
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: `${accentColor}20`, color: accentColor }}>
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
          <div className="flex items-center gap-3 rounded border border-gray-200 dark:border-white/10 p-3">
            <ChannelLogo logo={selected.logo} name={selected.name} logoBgColor={logoBgColor} className="w-10 h-7 shrink-0 rounded border border-gray-200 dark:border-white/10" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{selected.name}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{selected.sourceName} · {selected.category}</p>
            </div>
            <button
              onClick={() => setSelected(null)}
              disabled={saving}
              className="md-btn shrink-0 flex items-center gap-0.5 h-7 px-2 rounded text-[11px] font-medium uppercase tracking-wider text-gray-600 dark:text-gray-300"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Change
            </button>
          </div>

          {namesLookUnrelated(channel.name, selected.name) && (
            <div className="flex gap-2 rounded border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-2.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">These look like different channels. You can still link them if that's what you want.</p>
            </div>
          )}

          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400 mb-1.5">What to keep in sync</p>
            {fields
              ? <SyncFieldToggles value={fields} onChange={setFields} accentColor={accentColor} disabled={saving} />
              : <p className="text-sm text-gray-400">Loading…</p>}
          </div>

          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400 mb-1.5">Differences</p>
            {differingFields.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Your channel already matches this one.</p>
            ) : (
              <div className="space-y-3">
                {differingFields.map(field => (
                  <div key={field}>
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{SYNC_FIELD_LABELS[field]}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(['mine', 'source'] as const).map(option => {
                        const active = choices[field] === option;
                        const value = option === 'mine' ? channel[field] : selected[field];
                        return (
                          <button
                            key={option}
                            onClick={() => setChoices(prev => ({ ...prev, [field]: option }))}
                            disabled={saving}
                            className={`md-btn text-left rounded border p-2 min-w-0 ${active ? '' : 'border-gray-200 dark:border-white/10'}`}
                            style={active ? { borderColor: accentColor, backgroundColor: `${accentColor}0d` } : undefined}
                          >
                            <span className="block text-[11px] font-medium" style={active ? { color: accentColor } : undefined}>
                              {option === 'mine' ? 'Keep mine' : 'Use source value'}
                            </span>
                            <span className="block text-[11px] font-mono text-gray-500 dark:text-gray-400 truncate" title={value || undefined}>
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

      <div className="flex justify-end gap-1 px-4 py-3 border-t border-gray-100 dark:border-white/10">
        <button onClick={onClose} disabled={saving} className="md-btn h-9 px-4 rounded text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-300">
          Cancel
        </button>
        {selected && (
          <button
            onClick={confirm}
            disabled={saving || !fields || !anySyncFieldOn(fields)}
            className="md-btn h-9 px-4 rounded text-xs font-medium uppercase tracking-wider disabled:opacity-40"
            style={{ color: accentColor }}
          >
            {saving ? 'Linking…' : 'Link'}
          </button>
        )}
      </div>
    </Dialog>
  );
}
