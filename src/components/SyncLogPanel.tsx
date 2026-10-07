import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Loader2, RefreshCw, CircleDot, Check, EyeOff, Eye, AlertTriangle, Link2, Unlink } from 'lucide-react';
import { api, Channel, SyncField, SyncLogEntry, dbEvents, triggerRefresh } from '../apiClient';
import { useStore, notifyError } from '../store';
import { formatTime } from '../utils/formatTime';
import { SYNC_FIELD_LABELS } from './SyncFieldToggles';

// "Today at 14:32" / "03.09.2026 at 14:32", same shape as the Sources update log.
function formatWhen(ts: number, is24Hour: boolean): string {
  const date = new Date(ts);
  const timeStr = formatTime(date, is24Hour);
  return new Date().toDateString() === date.toDateString() ? `Today at ${timeStr}` : `${date.toLocaleDateString()} at ${timeStr}`;
}

// Only what sync did on its own is marked new; the user's own actions (apply, dismiss, link,
// unlink) aren't news to them. Mirrors the unread count in GET /api/playlists (server.ts).
const NEWS_TYPES = new Set<SyncLogEntry['type']>(['updated', 'suggested', 'lost', 'returned', 'held']);

function describe(entry: SyncLogEntry, stillPending: boolean): { Icon: typeof RefreshCw; text: string } {
  const field = entry.field ? SYNC_FIELD_LABELS[entry.field].toLowerCase() : '';
  const source = entry.sourceName;
  switch (entry.type) {
    case 'updated': return { Icon: RefreshCw, text: `New ${field} from ${source}, updated automatically.` };
    case 'suggested': return {
      Icon: CircleDot,
      text: stillPending
        ? `New ${field} from ${source}. You changed it yourself, so it's waiting for you.`
        : `New ${field} from ${source}.`,
    };
    case 'applied': return { Icon: Check, text: `You used the new ${field}.` };
    case 'dismissed': return { Icon: X, text: `You kept your own ${field}.` };
    case 'lost': return { Icon: EyeOff, text: `Disappeared from ${source}.` };
    case 'returned': return { Icon: Eye, text: `Back in ${source}.` };
    case 'held': {
      const n = entry.count || 0;
      return {
        Icon: AlertTriangle,
        text: `${n} linked channel${n !== 1 ? 's' : ''} disappeared from ${source} in one go. ${n !== 1 ? "They weren't" : "It wasn't"} hidden in case it's a temporary glitch. The next refresh will decide.`,
      };
    }
    case 'linked': return { Icon: Link2, text: `Linked to ${source}.` };
    case 'unlinked': return {
      Icon: Unlink,
      text: entry.reason === 'source-deleted' ? `Unlinked because ${source} was deleted.` : `Unlinked from ${source}.`,
    };
  }
}

/**
 * A playlist's sync log: everything channel sync did or is waiting on. Opening it marks the log
 * as read (clearing the badges), while entries that were new keep a dot until it's closed.
 * Suggestions that are still waiting can be applied or dismissed right here.
 */
export default function SyncLogPanel({
  playlistId,
  channels,
  onClose,
  onJumpToChannel,
}: {
  playlistId: string;
  channels: Channel[];
  onClose: () => void;
  onJumpToChannel: (channel: Channel) => void;
}) {
  const { accentColor, is24Hour } = useStore();
  const [entries, setEntries] = useState<SyncLogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The read time from before this opening. undefined until the first load returns.
  const [previousReadAt, setPreviousReadAt] = useState<number | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const channelsById = useMemo(() => new Map(channels.map(c => [c.id, c])), [channels]);

  const load = useCallback(async (pageNum: number) => {
    setLoading(true);
    try {
      const data = await api.getSyncLog(playlistId, pageNum);
      setEntries(prev => pageNum === 1 ? data.entries : [...prev, ...data.entries]);
      setHasMore(data.hasMore);
      setPage(pageNum);
      setError(null);
      return data;
    } catch (e) {
      console.error(e);
      setError("Couldn't load the sync log.");
      notifyError(e, "Couldn't load the sync log. Try again.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [playlistId]);

  // The first load captures the old read time before marking the log read, so new entries can
  // still be told apart while the panel is open.
  useEffect(() => {
    let alive = true;
    load(1).then(data => {
      if (!alive || !data) return;
      setPreviousReadAt(data.readAt);
      api.markSyncLogRead(playlistId)
        .then(() => triggerRefresh())
        .catch(e => console.error(e));
    });
    return () => { alive = false; };
  }, [load, playlistId]);

  // Apply/Dismiss here or in a row popover, or a refresh finishing, all fire the refresh event.
  useEffect(() => {
    const onRefresh = () => { load(1); };
    dbEvents.addEventListener('refresh', onRefresh);
    return () => dbEvents.removeEventListener('refresh', onRefresh);
  }, [load]);

  const handleSuggestion = async (channel: Channel, field: SyncField, action: 'apply' | 'dismiss') => {
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

  return (
    <div className="md-list-in absolute top-14 right-0 bottom-0 w-96 max-w-full z-30 bg-white dark:bg-[#272727] amoled:dark:bg-[#1a1a1a] shadow-[-4px_0_24px_rgba(0,0,0,0.15)] border-l border-gray-200 dark:border-white/10 flex flex-col">
      <div className="shrink-0 h-12 flex items-center justify-between px-4 border-b border-gray-200 dark:border-white/10">
        <h2 className="text-sm font-medium text-gray-900 dark:text-white">Sync Log</h2>
        <button onClick={onClose} className="md-btn p-1.5 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="Close sync log">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 && loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        ) : entries.length === 0 && error ? (
          <div className="text-center py-10">
            <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
            <button onClick={() => load(1)} className="md-btn mt-2 text-sm font-medium underline text-gray-600 dark:text-gray-300">Retry</button>
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center px-8 py-10">
            Nothing here yet. Channels you keep in sync with a source will log their updates here.
          </p>
        ) : (
          <>
            {entries.map(entry => {
              const channel = entry.channelId ? channelsById.get(entry.channelId) : undefined;
              const field = entry.field;
              const pending = channel?.link?.pending;
              const stillPending = entry.type === 'suggested' && !!field && !!pending && field in pending
                && (pending[field] ?? null) === (entry.newValue ?? null);
              const isNew = NEWS_TYPES.has(entry.type) && previousReadAt !== undefined && entry.timestamp > (previousReadAt || 0);
              const { Icon, text } = describe(entry, stillPending);
              const showValues = !!field && ['updated', 'suggested', 'applied', 'dismissed'].includes(entry.type);
              const [oldLabel, newLabel] = entry.type === 'suggested' || entry.type === 'dismissed' ? ['Yours', 'Source'] : ['Before', 'After'];

              return (
                <div key={entry.id} className="flex gap-3 px-4 py-3 border-b border-gray-100 dark:border-white/6">
                  <Icon className="h-4 w-4 shrink-0 mt-0.5 text-gray-400 dark:text-gray-500" style={stillPending ? { color: accentColor } : undefined} />
                  <div className="flex-1 min-w-0">
                    {entry.channelId && (
                      <div className="flex items-center gap-1.5 min-w-0">
                        {channel ? (
                          <button
                            onClick={() => onJumpToChannel(channel)}
                            className="text-sm font-medium text-gray-900 dark:text-white truncate text-left hover:underline"
                            title="Show this channel"
                          >
                            {entry.channelName || 'Unnamed'}
                          </button>
                        ) : (
                          <span className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate" title="This channel has been deleted">
                            {entry.channelName || 'Unnamed'} (deleted)
                          </span>
                        )}
                        {isNew && <span className="shrink-0 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accentColor }} title="New" />}
                      </div>
                    )}
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 flex items-start gap-1.5">
                      {!entry.channelId && isNew && <span className="shrink-0 w-1.5 h-1.5 mt-1 rounded-full" style={{ backgroundColor: accentColor }} title="New" />}
                      <span>{text}</span>
                    </p>
                    {showValues && (
                      <div className="mt-1 space-y-0.5">
                        {[[oldLabel, entry.oldValue], [newLabel, entry.newValue]].map(([label, value]) => (
                          <div key={label as string} className="flex gap-2 text-[11px] min-w-0">
                            <span className="w-10 shrink-0 text-gray-400 dark:text-gray-500">{label}</span>
                            <span className="font-mono text-gray-600 dark:text-gray-300 truncate" title={(value as string) || undefined}>{(value as string) || '(empty)'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {stillPending && channel && field && (
                      <div className="flex gap-1 mt-1.5 -ml-2.5">
                        <button disabled={busy} onClick={() => handleSuggestion(channel, field, 'dismiss')} className="md-btn h-7 px-2.5 rounded text-[11px] font-medium uppercase tracking-wider text-gray-600 dark:text-gray-300 disabled:opacity-40">
                          Keep mine
                        </button>
                        <button disabled={busy} onClick={() => handleSuggestion(channel, field, 'apply')} className="md-btn h-7 px-2.5 rounded text-[11px] font-medium uppercase tracking-wider disabled:opacity-40" style={{ color: accentColor }}>
                          Use new
                        </button>
                      </div>
                    )}
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">{formatWhen(entry.timestamp, is24Hour)}</p>
                  </div>
                </div>
              );
            })}
            {hasMore && (
              <div className="flex justify-center py-3">
                <button
                  onClick={() => load(page + 1)}
                  disabled={loading}
                  className="md-btn h-8 px-3 rounded text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-300 disabled:opacity-40"
                >
                  {loading ? 'Loading…' : 'Show older'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
