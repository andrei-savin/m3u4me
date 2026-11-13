import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useStore, notifyError } from '../store';
import { api, ChannelPoolChangeLog, channelPoolEvents, useChannelPoolSources } from '../apiClient';
import { formatTime } from '../utils/formatTime';
import { useIsPhone } from '../utils/useIsPhone';
import BottomSheet from './BottomSheet';
import Icon from './Icon';


export default function ChannelPoolUpdateLog() {
  const { activeChannelPoolSourceId, is24Hour, channelPoolLogOpen, setChannelPoolLogOpen } = useStore();
  const isPhone = useIsPhone();
  // Leaving the Sources tab closes the phone sheet, so it doesn't pop up again on return.
  useEffect(() => () => setChannelPoolLogOpen(false), [setChannelPoolLogOpen]);
  const { sources } = useChannelPoolSources();
  const activeSource = sources.find(s => s.id === activeChannelPoolSourceId);
  const [logs, setLogs] = useState<ChannelPoolChangeLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  // Starts collapsed on narrower screens (tablet and below) — at those widths
  // the fixed-width source list + this 320px drawer leave almost no room for
  // the actual channel table in between. Desktop still opens expanded as before.
  const [isExpanded, setIsExpanded] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1024);
  
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());


  const fetchLogs = useCallback(async (pageNum: number, reset = false) => {
    try {
      setLoading(true);
      const data = await api.getChannelPoolChangelog(pageNum);
      setLogs(prev => reset ? data.logs : [...prev, ...data.logs]);
      setHasMore(data.hasMore);
      setError(null);
    } catch (e) {
      console.error(e);
      setError(reset ? 'Failed to load update log.' : 'Failed to load more entries.');
      notifyError(e, 'Failed to load update log.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
    fetchLogs(1, true);
  }, [fetchLogs]);
  
  useEffect(() => {
    const handleRefresh = () => {
      setPage(1);
      fetchLogs(1, true);
    };
    channelPoolEvents.addEventListener('refresh', handleRefresh);
    return () => channelPoolEvents.removeEventListener('refresh', handleRefresh);
  }, [fetchLogs]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (loading || !hasMore) return;
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight * 1.5) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchLogs(nextPage);
    }
  };
  
  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (activeSource?.type === 'playlist-file') return null;

  // The list of refreshes, shared by the desktop side panel and the phone sheet.
  const logBody = (
    <div 
      ref={containerRef}
      onScroll={handleScroll}
      className={`${isPhone ? 'h-full' : 'flex-1'} overflow-y-auto p-4 space-y-6`}
    >
      {logs.length === 0 && !loading && error ? (
        <div className="text-center mt-10">
          <p className="text-body-md text-error">{error}</p>
          <button
            onClick={() => { setPage(1); fetchLogs(1, true); }}
            className="md-btn btn btn-text mt-2"
          >
            Retry
          </button>
        </div>
      ) : logs.length === 0 && !loading ? (
        <div className="text-center text-body-md text-on-surface-variant mt-10">
          No logs available.
        </div>
      ) : (
        logs.map(log => {
          const hasChanges = log.added.length > 0 || log.removed.length > 0 || log.renamed.length > 0;
          const date = new Date(log.timestamp);
          const isToday = new Date().toDateString() === date.toDateString();
          const timeStr = formatTime(date, is24Hour);
          const dateStr = isToday ? `Today at ${timeStr}` : `${date.toLocaleDateString()} at ${timeStr}`;

          return (
            <div key={log.id} className="flex flex-col gap-2">
              <div>
                <div className="text-label-md text-on-surface-variant">{dateStr}</div>
                <div className="text-label-lg text-on-surface">{log.sourceName}</div>
              </div>

              {!hasChanges ? (
                <div className="text-body-md text-on-surface-variant bg-surface-container-highest p-3 rounded-lg">
                  No changes detected
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {log.added.length > 0 && (
                    <div className="bg-primary-container/60 rounded-lg overflow-hidden">
                      <button 
                        onClick={() => toggleExpand(`${log.id}-added`)}
                        className="w-full flex items-center justify-between p-2 text-left md-btn"
                      >
                        <span className="text-label-md text-on-primary-container flex items-center gap-1.5">
                          <Icon name="add" className="text-[18px]" />
                          {log.added.length} new
                        </span>
                      </button>
                      {expandedIds.has(`${log.id}-added`) && (
                        <div className="md-list-in p-2 pt-0 border-t border-on-primary-container/10 max-h-40 overflow-y-auto">
                          {log.added.map((c, i) => (
                            <div key={i} className="text-body-sm text-on-surface py-1 truncate" title={c.name}>
                              {c.name} <span className="text-on-surface-variant">({c.category})</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {log.removed.length > 0 && (
                    <div className="bg-error-container/60 rounded-lg overflow-hidden">
                      <button 
                        onClick={() => toggleExpand(`${log.id}-removed`)}
                        className="w-full flex items-center justify-between p-2 text-left md-btn"
                      >
                        <span className="text-label-md text-on-error-container flex items-center gap-1.5">
                          <Icon name="remove" className="text-[18px]" />
                          {log.removed.length} removed
                        </span>
                      </button>
                      {expandedIds.has(`${log.id}-removed`) && (
                        <div className="md-list-in p-2 pt-0 border-t border-on-error-container/10 max-h-40 overflow-y-auto">
                          {log.removed.map((c, i) => (
                            <div key={i} className="text-body-sm text-on-surface py-1 truncate" title={c.name}>
                              {c.name} <span className="text-on-surface-variant">({c.category})</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {log.renamed.length > 0 && (
                    <div className="bg-tertiary-container/60 rounded-lg overflow-hidden">
                      <button 
                        onClick={() => toggleExpand(`${log.id}-renamed`)}
                        className="w-full flex items-center justify-between p-2 text-left md-btn"
                      >
                        <span className="text-label-md text-on-tertiary-container flex items-center gap-1.5">
                          <Icon name="edit" className="text-[18px]" />
                          {log.renamed.length} renamed
                        </span>
                      </button>
                      {expandedIds.has(`${log.id}-renamed`) && (
                        <div className="md-list-in p-2 pt-0 border-t border-on-tertiary-container/10 max-h-40 overflow-y-auto">
                          {log.renamed.map((c, i) => (
                            <div key={i} className="text-body-sm text-on-surface py-1 truncate" title={`${c.oldName} → ${c.newName}`}>
                              <span className="line-through opacity-70">{c.oldName}</span> → {c.newName}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    
      {loading && (
        <div className="flex justify-center py-4">
          <Icon name="progress_activity" className="text-[24px] animate-spin text-on-surface-variant" />
        </div>
      )}

      {!loading && error && logs.length > 0 && (
        <div className="text-center py-2">
          <p className="text-body-sm text-error">{error}</p>
          <button
            onClick={() => fetchLogs(page)}
            className="md-btn btn btn-text h-8 mt-1"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );

  // Phones: no side strip (there's no room). The log opens in a sheet from the top bar's
  // ⋮ menu, which sets channelPoolLogOpen.
  if (isPhone) {
    if (!channelPoolLogOpen) return null;
    return (
      <BottomSheet
        onClose={() => setChannelPoolLogOpen(false)}
        fullHeight
        title="Update log"
      >
        {logBody}
      </BottomSheet>
    );
  }

  // Collapsed state — narrow vertical strip
  if (!isExpanded) {
    return (
      <div className="md-list-in shrink-0 w-12 bg-surface-container-low flex flex-col border-l border-outline-variant relative z-10">
        <button
          onClick={() => setIsExpanded(true)}
          className="md-btn icon-btn mx-auto mt-3 shrink-0"
          title="Show the update log"
        >
          <Icon name="chevron_left" className="text-[24px]" />
        </button>
        {/* Vertical label */}
        <div className="flex-1 flex items-center justify-center py-4">
          <span
            className="text-title-sm text-on-surface-variant select-none"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
          >
            Update log
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="md-list-in shrink-0 w-80 bg-surface-container-low flex flex-col border-l border-outline-variant relative z-10">
      <div className="shrink-0 h-16 flex items-center justify-between pl-5 pr-2">
        <h2 className="text-title-md text-on-surface">Update log</h2>
        <button
          onClick={() => setIsExpanded(false)}
          className="md-btn icon-btn"
          title="Hide the update log"
        >
          <Icon name="chevron_right" className="text-[24px]" />
        </button>
      </div>

      {logBody}
    </div>
  );
}
