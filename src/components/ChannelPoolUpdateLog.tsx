import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Loader2, Plus, Minus, Edit2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useStore, notifyError } from '../store';
import { api, ChannelPoolChangeLog, channelPoolEvents, useChannelPoolSources } from '../apiClient';
import { formatTime } from '../utils/formatTime';
import { useIsPhone } from '../utils/useIsPhone';
import BottomSheet from './BottomSheet';


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
          <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
          <button
            onClick={() => { setPage(1); fetchLogs(1, true); }}
            className="md-btn mt-2 text-sm font-medium underline text-gray-600 dark:text-gray-300"
          >
            Retry
          </button>
        </div>
      ) : logs.length === 0 && !loading ? (
        <div className="text-center text-sm text-gray-500 dark:text-gray-400 mt-10">
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
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{dateStr}</div>
                <div className="text-sm font-medium text-gray-900 dark:text-white">{log.sourceName}</div>
              </div>

              {!hasChanges ? (
                <div className="text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-black/20 p-2 rounded border border-gray-100 dark:border-white/5">
                  No changes detected
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {log.added.length > 0 && (
                    <div className="bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-900/30 rounded overflow-hidden">
                      <button 
                        onClick={() => toggleExpand(`${log.id}-added`)}
                        className="w-full flex items-center justify-between p-2 text-left hover:bg-green-100 dark:hover:bg-green-900/20 transition-colors"
                      >
                        <span className="text-xs font-medium text-green-700 dark:text-green-400 flex items-center gap-1.5">
                          <Plus className="h-3.5 w-3.5" />
                          {log.added.length} new
                        </span>
                      </button>
                      {expandedIds.has(`${log.id}-added`) && (
                        <div className="md-list-in p-2 pt-0 border-t border-green-100 dark:border-green-900/20 max-h-40 overflow-y-auto">
                          {log.added.map((c, i) => (
                            <div key={i} className="text-xs text-gray-700 dark:text-gray-300 py-1 truncate" title={c.name}>
                              {c.name} <span className="text-gray-400">({c.category})</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {log.removed.length > 0 && (
                    <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded overflow-hidden">
                      <button 
                        onClick={() => toggleExpand(`${log.id}-removed`)}
                        className="w-full flex items-center justify-between p-2 text-left hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <span className="text-xs font-medium text-red-700 dark:text-red-400 flex items-center gap-1.5">
                          <Minus className="h-3.5 w-3.5" />
                          {log.removed.length} removed
                        </span>
                      </button>
                      {expandedIds.has(`${log.id}-removed`) && (
                        <div className="md-list-in p-2 pt-0 border-t border-red-100 dark:border-red-900/20 max-h-40 overflow-y-auto">
                          {log.removed.map((c, i) => (
                            <div key={i} className="text-xs text-gray-700 dark:text-gray-300 py-1 truncate" title={c.name}>
                              {c.name} <span className="text-gray-400">({c.category})</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {log.renamed.length > 0 && (
                    <div className="bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-900/30 rounded overflow-hidden">
                      <button 
                        onClick={() => toggleExpand(`${log.id}-renamed`)}
                        className="w-full flex items-center justify-between p-2 text-left hover:bg-yellow-100 dark:hover:bg-yellow-900/20 transition-colors"
                      >
                        <span className="text-xs font-medium text-yellow-700 dark:text-yellow-400 flex items-center gap-1.5">
                          <Edit2 className="h-3.5 w-3.5" />
                          {log.renamed.length} renamed
                        </span>
                      </button>
                      {expandedIds.has(`${log.id}-renamed`) && (
                        <div className="md-list-in p-2 pt-0 border-t border-yellow-100 dark:border-yellow-900/20 max-h-40 overflow-y-auto">
                          {log.renamed.map((c, i) => (
                            <div key={i} className="text-xs text-gray-700 dark:text-gray-300 py-1 truncate" title={`${c.oldName} → ${c.newName}`}>
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
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      )}

      {!loading && error && logs.length > 0 && (
        <div className="text-center py-2">
          <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
          <button
            onClick={() => fetchLogs(page)}
            className="md-btn mt-1 text-xs font-medium underline text-gray-600 dark:text-gray-300"
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
        title="Update Log"
      >
        {logBody}
      </BottomSheet>
    );
  }

  // Collapsed state — narrow vertical strip
  if (!isExpanded) {
    return (
      <div className="md-list-in shrink-0 w-10 bg-white dark:bg-[#272727] amoled:dark:bg-[#1a1a1a] shadow-[-4px_0_24px_rgba(0,0,0,0.1)] flex flex-col border-l border-gray-200 dark:border-white/10 relative z-10">
        {/* Expand button — same h-12 height as toolbar */}
        <button
          onClick={() => setIsExpanded(true)}
          className="md-btn shrink-0 h-12 w-full flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border-b border-gray-200 dark:border-white/10 transition-colors"
          title="Expand Update Log"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {/* Vertical label */}
        <div className="flex-1 flex items-center justify-center py-4">
          <span
            className="text-[10px] font-medium uppercase tracking-[0.15em] text-gray-400 dark:text-gray-500 select-none"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
          >
            Update Log
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="md-list-in shrink-0 w-80 bg-white dark:bg-[#272727] amoled:dark:bg-[#1a1a1a] shadow-[-4px_0_24px_rgba(0,0,0,0.1)] flex flex-col border-l border-gray-200 dark:border-white/10 relative z-10">
      {/* Header — h-12 matches the ChannelPoolViewer toolbar height */}
      <div className="shrink-0 h-12 flex items-center justify-between px-4 border-b border-gray-200 dark:border-white/10">
        <h2 className="text-sm font-medium text-gray-900 dark:text-white">Update Log</h2>
        <button
          onClick={() => setIsExpanded(false)}
          className="md-btn p-1.5 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          title="Collapse Update Log"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {logBody}
    </div>
  );
}
