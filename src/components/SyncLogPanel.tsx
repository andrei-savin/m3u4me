import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, Channel, SyncField, SyncLogEntry, dbEvents, triggerRefresh } from '../apiClient';
import { useStore, notifyError } from '../store';
import { formatTime } from '../utils/formatTime';
import { SYNC_FIELD_LABELS } from './SyncFieldToggles';
import Icon from './Icon';

// "Today at 14:32" / "03.09.2026 at 14:32", same shape as the Sources update log.
function formatWhen(ts: number, is24Hour: boolean): string {
  const date = new Date(ts);
  const timeStr = formatTime(date, is24Hour);
  return new Date().toDateString() === date.toDateString() ? `Today at ${timeStr}` : `${date.toLocaleDateString()} at ${timeStr}`;
}

// Only what sync did on its own is marked new; the user's own actions (apply, dismiss, link,
// unlink) aren't news to them. Mirrors the unread count in GET /api/playlists (server.ts).
const NEWS_TYPES = new Set<SyncLogEntry['type']>(['updated', 'suggested', 'lost', 'returned', 'held']);

function describe(entry: SyncLogEntry, stillPending: boolean): { icon: string; text: string } {
  const field = entry.field ? SYNC_FIELD_LABELS[entry.field].toLowerCase() : '';
  const source = entry.sourceName;
  switch (entry.type) {
    case 'updated': return { icon: 'refresh', text: `New ${field} from ${source}, updated automatically.` };
    case 'suggested': return {
      icon: 'radio_button_checked',
      text: stillPending
        ? `New ${field} from ${source}. You changed it yourself, so it's waiting for you.`
        : `New ${field} from ${source}.`,
    };
    case 'applied': return { icon: 'check', text: `You used the new ${field}.` };
    case 'dismissed': return { icon: 'close', text: `You kept your own ${field}.` };
    case 'lost': return { icon: 'visibility_off', text: `Disappeared from ${source}.` };
    case 'returned': return { icon: 'visibility', text: `Back in ${source}.` };
    case 'held': {
      const n = entry.count || 0;
      return {
        icon: 'warning',
        text: `${n} linked channel${n !== 1 ? 's' : ''} disappeared from ${source} in one go. ${n !== 1 ? "They weren't" : "It wasn't"} hidden in case it's a temporary glitch. The next refresh will decide.`,
      };
    }
    case 'linked': return { icon: 'link', text: `Linked to ${source}.` };
    case 'unlinked': return {
      icon: 'link_off',
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
  const { is24Hour } = useStore();
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

  // top-14 sits below the playlist toolbar; phones have no toolbar there, so it starts at the top.
  return (
    // A side sheet over the right edge of the channel list (the whole list on phones).
    <div className="md-list-in absolute top-0 right-0 bottom-0 w-96 max-w-full z-30 bg-drawer text-on-surface shadow-level-3 rounded-l-2xl max-md:rounded-none flex flex-col">
      <div className="shrink-0 h-16 flex items-center justify-between pl-6 pr-2">
        <h2 className="text-title-lg text-on-surface">Sync log</h2>
        <button onClick={onClose} className="md-btn icon-btn max-md:w-12 max-md:h-12" title="Close sync log">
          <Icon name="close" className="text-[24px]" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 && loading ? (
          <div className="flex justify-center py-10"><Icon name="progress_activity" className="text-[24px] animate-spin text-on-surface-variant" /></div>
        ) : entries.length === 0 && error ? (
          <div className="text-center py-10">
            <p className="text-body-md text-error">{error}</p>
            <button onClick={() => load(1)} className="md-btn btn btn-text mt-2">Retry</button>
          </div>
        ) : entries.length === 0 ? (
          <p className="text-body-md text-on-surface-variant text-center px-8 py-10">
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
              const { icon, text } = describe(entry, stillPending);
              const showValues = !!field && ['updated', 'suggested', 'applied', 'dismissed'].includes(entry.type);
              const [oldLabel, newLabel] = entry.type === 'suggested' || entry.type === 'dismissed' ? ['Yours', 'Source'] : ['Before', 'After'];

              return (
                <div key={entry.id} className="flex gap-3 px-6 py-3 border-t border-outline-variant">
                  <Icon name={icon} className={`mt-0.5 ${stillPending ? 'text-primary' : 'text-on-surface-variant'}`} />
                  <div className="flex-1 min-w-0">
                    {entry.channelId && (
                      <div className="flex items-center gap-1.5 min-w-0">
                        {channel ? (
                          <button
                            onClick={() => onJumpToChannel(channel)}
                            className="text-label-lg text-on-surface truncate text-left hover:underline"
                            title="Show this channel"
                          >
                            {entry.channelName || 'Unnamed'}
                          </button>
                        ) : (
                          <span className="text-label-lg text-on-surface-variant truncate" title="This channel has been deleted">
                            {entry.channelName || 'Unnamed'} (deleted)
                          </span>
                        )}
                        {isNew && <span className="shrink-0 w-2 h-2 rounded-full bg-primary" title="New" />}
                      </div>
                    )}
                    <p className="text-body-sm text-on-surface-variant mt-0.5 flex items-start gap-1.5">
                      {!entry.channelId && isNew && <span className="shrink-0 w-2 h-2 mt-1 rounded-full bg-primary" title="New" />}
                      <span>{text}</span>
                    </p>
                    {showValues && (
                      <div className="mt-1 space-y-0.5">
                        {[[oldLabel, entry.oldValue], [newLabel, entry.newValue]].map(([label, value]) => (
                          <div key={label as string} className="flex gap-2 text-body-sm min-w-0">
                            <span className="w-10 shrink-0 text-on-surface-variant">{label}</span>
                            <span className="font-mono text-on-surface-variant truncate" title={(value as string) || undefined}>{(value as string) || '(empty)'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {stillPending && channel && field && (
                      <div className="flex gap-1 mt-1.5 -ml-2.5">
                        <button disabled={busy} onClick={() => handleSuggestion(channel, field, 'dismiss')} className="md-btn btn btn-text h-8 px-3 text-on-surface-variant">
                          Keep mine
                        </button>
                        <button disabled={busy} onClick={() => handleSuggestion(channel, field, 'apply')} className="md-btn btn btn-text h-8 px-3">
                          Use new
                        </button>
                      </div>
                    )}
                    <p className="text-label-sm font-normal text-on-surface-variant mt-1">{formatWhen(entry.timestamp, is24Hour)}</p>
                  </div>
                </div>
              );
            })}
            {hasMore && (
              <div className="flex justify-center py-3">
                <button
                  onClick={() => load(page + 1)}
                  disabled={loading}
                  className="md-btn btn btn-text"
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
