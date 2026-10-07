import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { api, EpgChannel, EpgProgramme, epgEvents } from '../apiClient';
import { useStore, notifyError } from '../store';
import { Search, Loader2, Link as LinkIcon, Crosshair, ZoomIn, ZoomOut } from 'lucide-react';
import EpgProgramDialog, { parseXmltvTime } from './EpgProgramDialog';
import ChannelLogo from './ChannelLogo';
import { formatTime } from '../utils/formatTime';
import { foldText } from '../utils/foldText';

export interface EpgViewerProps {
  sourceId: string;
  onAssignChannel: (epgChannelId: string, epgDisplayName: string) => void;
}

const ROW_HEIGHT = 56;
const HEADER_HEIGHT = 40;
const MS_PER_HOUR = 3600000;
const TIMELINE_PAST_HOURS = 3;
const TIMELINE_FUTURE_HOURS = 6;
const TIMELINE_TOTAL_HOURS = TIMELINE_PAST_HOURS + TIMELINE_FUTURE_HOURS;
// Extra rows rendered above/below the visible window so a fast flick-scroll
// on touch devices never outruns virtualization and reveals blank rows.
const ROW_OVERSCAN = 8;

interface ProgrammeWithTimes {
  prog: EpgProgramme;
  startMs: number;
  endMs: number;
}

export default function EpgViewer({ sourceId, onAssignChannel }: EpgViewerProps) {
  const { accentColor, logoBgColor, is24Hour, scrollTarget, setScrollTarget } = useStore();
  const scrollToEpgChannelId = scrollTarget?.kind === 'epg' ? scrollTarget.id : null;
  const [data, setData] = useState<{ channels: EpgChannel[], programmes: { [channelId: string]: EpgProgramme[] } } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(new Date());
  const [highlightedChannelId, setHighlightedChannelId] = useState<string | null>(null);

  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  const [selectedProgramme, setSelectedProgramme] = useState<EpgProgramme | null>(null);

  // Single scrollable element for the whole grid — the timeline header and
  // channel sidebar are pinned via CSS `position: sticky` inside it, so they
  // track the native scroll natively instead of being repositioned from JS
  // on a lag (which used to make the header visibly drift from the grid).
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);

  const [sidebarWidth, setSidebarWidth] = useState(200);
  const sidebarResizing = useRef<{ startX: number; startW: number } | null>(null);

  const [pixelsPerHour, setPixelsPerHour] = useState(200);
  const timelineWidth = TIMELINE_TOTAL_HOURS * pixelsPerHour;

  // Time window state based on 'now' at the time of mounting/fetching
  const [windowStart, setWindowStart] = useState<number>(0);

  useEffect(() => {
    // Reset scroll position when switching source
    setScrollTop(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;

    if (!sourceId) {
      setData(null);
      setError(null);
      return;
    }

    let isMounted = true;

    const fetchData = () => {
      if (!isMounted) return;
      setLoading(true);
      api.getEpgNow(sourceId)
        .then(res => {
          if (isMounted) {
            // Sort channels alphabetically
            res.channels.sort((a: EpgChannel, b: EpgChannel) => a.displayName.localeCompare(b.displayName));
            setData(res);
            setLoading(false);
            setError(null);

            const currentTime = new Date();
            setNow(currentTime);

            const currentHourStart = new Date(currentTime);
            currentHourStart.setMinutes(0, 0, 0);
            const newWindowStart = currentHourStart.getTime() - TIMELINE_PAST_HOURS * MS_PER_HOUR;
            setWindowStart(newWindowStart);

            // Auto-scroll to center current time
            setTimeout(() => {
              if (scrollRef.current) {
                const currentOffset = (currentTime.getTime() - newWindowStart) / MS_PER_HOUR * pixelsPerHour;
                scrollRef.current.scrollLeft = currentOffset - (scrollRef.current.clientWidth / 2);
              }
            }, 100);
          }
        })
        .catch(err => {
          console.error(err);
          if (isMounted) {
            setLoading(false);
            setError('Failed to load EPG data.');
            notifyError(err, 'Failed to load EPG data.');
          }
        });
    };

    fetchData();

    const handleRefresh = () => {
      fetchData();
    };
    epgEvents.addEventListener('refresh', handleRefresh);

    return () => {
      isMounted = false;
      epgEvents.removeEventListener('refresh', handleRefresh);
    };
  }, [sourceId, retryTick]);

  // Update current time line every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  const filteredChannels = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data.channels;
    // Accent-insensitive, so "T"/"S" also find "Ț"/"Ș".
    const foldedSearch = foldText(search);
    return data.channels.filter(c => foldText(c.displayName).includes(foldedSearch));
  }, [data, search]);

  // Jump to a specific channel requested externally (e.g. Spotlight search). Clear the
  // search filter first since it might hide the target channel — unlike ChannelPoolViewer,
  // this filters client-side (see filteredChannels above), so clearing it takes effect
  // immediately rather than waiting on a refetch.
  useEffect(() => {
    if (!scrollToEpgChannelId) return;
    if (search) setSearch('');
  }, [scrollToEpgChannelId, search]);

  // ...then, once the unfiltered channel list is in hand, scroll to its row and highlight
  // it. The grid is virtualized off `scrollTop`, so — same as ChannelPoolViewer — this
  // scrolls the shared container directly rather than scrollIntoView-ing a node that may
  // not be rendered yet; `left` is omitted so the horizontal "now" centering is untouched.
  // Unlike ChannelPoolViewer, this jumps instantly rather than animating smoothly: this
  // container scrolls both axes and has several compounding sticky-positioned children
  // (the header row, the channel sidebar, and their shared corner cell) — that combination
  // doesn't reliably animate a `behavior: 'smooth'` scroll in every browser, so a page-sized
  // source can be left scrolled nowhere near the target row.
  useEffect(() => {
    if (!scrollToEpgChannelId || search) return;
    const idx = filteredChannels.findIndex(c => c.id === scrollToEpgChannelId);
    if (idx === -1) return;
    setScrollTarget(null);
    const targetTop = HEADER_HEIGHT + idx * ROW_HEIGHT;
    scrollRef.current?.scrollTo({ top: Math.max(0, targetTop - containerHeight / 2 + ROW_HEIGHT / 2), behavior: 'instant' });
    setHighlightedChannelId(scrollToEpgChannelId);
    const t = setTimeout(() => setHighlightedChannelId(null), 2000);
    return () => clearTimeout(t);
  }, [scrollToEpgChannelId, filteredChannels, search, containerHeight, setScrollTarget]);

  // Parse each programme's XMLTV timestamps once per data fetch instead of on
  // every scroll-triggered re-render — this used to run for every visible
  // program, on every single scroll event, which was a real source of the
  // mobile scroll jank (string parsing + regex on the hot scroll path).
  const programmesByChannel = useMemo(() => {
    const result: { [channelId: string]: ProgrammeWithTimes[] } = {};
    if (!data) return result;
    for (const channelId of Object.keys(data.programmes)) {
      const list = data.programmes[channelId];
      // XMLTV doesn't guarantee <programme> elements appear in chronological order
      // (and the server doesn't sort them), so "next in the array" isn't necessarily
      // "next in time" until sorted here — the capping loop below assumes it is.
      const withTimes: ProgrammeWithTimes[] = list.map(prog => ({
        prog,
        startMs: parseXmltvTime(prog.start).getTime(),
        endMs: parseXmltvTime(prog.stop).getTime(),
      })).sort((a, b) => a.startMs - b.startMs);
      // Cap each program's end time to the next program's start time, to
      // prevent visual overlap.
      for (let i = 0; i < withTimes.length; i++) {
        const next = withTimes[i + 1];
        if (next && withTimes[i].endMs > next.startMs) {
          withTimes[i] = { ...withTimes[i], endMs: next.startMs };
        }
      }
      result[channelId] = withTimes;
    }
    return result;
  }, [data]);

  const startSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    sidebarResizing.current = { startX: e.clientX, startW: sidebarWidth };
    const onMove = (ev: MouseEvent) => {
      if (!sidebarResizing.current) return;
      const delta = ev.clientX - sidebarResizing.current.startX;
      const newW = Math.max(100, Math.min(600, sidebarResizing.current.startW + delta));
      setSidebarWidth(newW);
    };
    const onUp = () => {
      sidebarResizing.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Coalesce scroll updates to at most once per animation frame. Native
  // touch/momentum scrolling can fire many 'scroll' events per frame; running
  // a full virtualization re-render for each one is what made flick-scrolling
  // feel like it needed several small swipes instead of one smooth gesture.
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  // Resize observer to track container height
  useEffect(() => {
    if (!scrollRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (let entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, [data]);

  const scrollToNow = () => {
    if (scrollRef.current) {
      const currentOffset = (now.getTime() - windowStart) / MS_PER_HOUR * pixelsPerHour;
      scrollRef.current.scrollTo({
        left: currentOffset - (scrollRef.current.clientWidth / 2),
        behavior: 'smooth'
      });
    }
  };

  // Calculate visible range for virtual scrolling. Rows live below the sticky
  // header (offset by HEADER_HEIGHT) in the shared scroll container's content.
  const startIndex = Math.max(0, Math.floor((scrollTop - HEADER_HEIGHT) / ROW_HEIGHT) - ROW_OVERSCAN);
  const endIndex = Math.min(filteredChannels.length, Math.ceil((scrollTop + containerHeight - HEADER_HEIGHT) / ROW_HEIGHT) + ROW_OVERSCAN);
  const visibleChannels = filteredChannels.slice(startIndex, endIndex);

  // Time markers
  const markers = [];
  for (let i = 0; i <= TIMELINE_TOTAL_HOURS * 2; i++) {
    const markerTime = new Date(windowStart + i * 30 * 60000);
    const offsetPx = (i * 30 * 60000) / MS_PER_HOUR * pixelsPerHour;
    const label = (i % 2 === 0) ? formatTime(markerTime, is24Hour) : '';
    markers.push({ offsetPx, label, key: i });
  }

  const nowOffsetPx = (now.getTime() - windowStart) / MS_PER_HOUR * pixelsPerHour;

  if (!sourceId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 dark:bg-[#121212] amoled:dark:bg-black text-gray-500 dark:text-gray-400">
        <p>No EPG source selected.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 dark:bg-[#121212] amoled:dark:bg-black text-gray-500 dark:text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin mb-4" style={{ color: accentColor }} />
        <p>Loading EPG data...</p>
      </div>
    );
  }

  if (error && (!data || data.channels.length === 0)) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 dark:bg-[#121212] amoled:dark:bg-black text-gray-500 dark:text-gray-400">
        <p className="text-red-500 dark:text-red-400">{error}</p>
        <button
          onClick={() => setRetryTick(t => t + 1)}
          className="md-btn mt-3 text-sm font-medium underline"
          style={{ color: accentColor }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data || data.channels.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 dark:bg-[#121212] amoled:dark:bg-black text-gray-500 dark:text-gray-400">
        <p>No EPG data found for this source.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#1e1e1e] amoled:dark:bg-black overflow-hidden relative font-sans">

      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-white/10 z-20 bg-white dark:bg-[#1e1e1e] amoled:dark:bg-black">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search channels..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-transparent text-gray-900 dark:text-white focus:outline-none"
            onFocus={e => (e.target.style.borderColor = accentColor)}
            onBlur={e => (e.target.style.borderColor = '')}
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPixelsPerHour(p => Math.min(p + 100, 600))}
            className="md-btn flex items-center justify-center w-8 h-8 rounded text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600"
            title="Zoom In"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={() => setPixelsPerHour(p => Math.max(p - 100, 100))}
            className="md-btn flex items-center justify-center w-8 h-8 rounded text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600"
            title="Zoom Out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            onClick={scrollToNow}
            className="md-btn flex items-center gap-2 h-8 px-3 rounded text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 ml-2"
          >
            <Crosshair className="h-4 w-4" />
            Now
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative">
        {/* Sidebar resize handle — lives outside the scroll container so it
            stays at a fixed screen position (not part of scrolled content). */}
        <div
          onMouseDown={startSidebarResize}
          className="absolute top-0 bottom-0 w-1 cursor-col-resize hover:bg-gray-300 dark:hover:bg-white/15 transition-colors z-50"
          style={{ left: sidebarWidth }}
        />

        {/* Single scroll container for the whole grid. The header row and
            channel sidebar are `position: sticky` children of this element,
            so they're pinned by the browser's native compositor — perfectly
            in sync with the body scroll, with zero JS-driven lag. */}
        <div
          ref={scrollRef}
          className="w-full h-full overflow-auto overscroll-contain"
          onScroll={handleScroll}
        >
          <div style={{ width: sidebarWidth + timelineWidth }}>
            {/* Header bar: pinned to the top while scrolling vertically, and
                scrolls horizontally in lockstep with the grid since it's the
                same scroll container. */}
            <div
              className="sticky top-0 z-40 flex border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#1a1a1a] amoled:dark:bg-[#0a0a0a]"
              style={{ height: HEADER_HEIGHT }}
            >
              {/* Corner cell: additionally pinned to the left so it stays put
                  on both axes. */}
              <div
                className="sticky left-0 z-10 shrink-0 flex items-center px-4 border-r border-gray-200 dark:border-white/10"
                style={{ width: sidebarWidth, height: HEADER_HEIGHT }}
              >
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Channel</span>
              </div>
              <div className="relative shrink-0" style={{ width: timelineWidth, height: HEADER_HEIGHT }}>
                {markers.map(m => (
                  <div
                    key={m.key}
                    className="absolute top-0 bottom-0 border-l border-gray-300 dark:border-white/10 flex items-center pl-1"
                    style={{ left: m.offsetPx }}
                  >
                    {m.label && <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{m.label}</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Body row */}
            <div className="flex" style={{ height: filteredChannels.length * ROW_HEIGHT }}>
              {/* Channel sidebar: pinned to the left while scrolling horizontally. */}
              <div
                className="sticky left-0 z-30 shrink-0 relative border-r border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#1a1a1a] amoled:dark:bg-[#0a0a0a] shadow-[8px_0_24px_-8px_rgba(0,0,0,0.15)] dark:shadow-[8px_0_24px_-8px_rgba(0,0,0,0.6)]"
                style={{ width: sidebarWidth }}
              >
                {visibleChannels.map((channel, idx) => {
                  const globalIndex = startIndex + idx;
                  const isEven = globalIndex % 2 === 0;
                  const rowBg = channel.id === highlightedChannelId
                    ? 'bg-amber-50 dark:bg-amber-900/20 amoled:dark:bg-amber-900/25'
                    : isEven
                      ? 'bg-white dark:bg-[#1e1e1e] amoled:dark:bg-black hover:bg-gray-50 dark:hover:bg-white/3 amoled:dark:hover:bg-white/4'
                      : 'bg-gray-50/70 dark:bg-[#222222] amoled:dark:bg-[#0d0d0d] hover:bg-gray-100/70 dark:hover:bg-white/5 amoled:dark:hover:bg-white/5';

                  return (
                    <div
                      key={globalIndex}
                      className={`absolute left-0 right-0 flex items-center px-3 border-b border-gray-200 dark:border-white/5 group transition-colors ${rowBg}`}
                      style={{ top: globalIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
                    >
                      <div className="shrink-0 mr-3">
                        <ChannelLogo
                          logo={channel.icon}
                          name={channel.displayName}
                          logoBgColor={logoBgColor}
                          className="w-10 h-7 rounded border border-gray-200 dark:border-white/10"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate" title={channel.displayName}>
                          {channel.displayName}
                        </p>
                        <p className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate" title={channel.id}>
                          {channel.id}
                        </p>
                      </div>
                      <button
                        onClick={() => onAssignChannel(channel.id, channel.displayName)}
                        className="md-btn p-1.5 rounded-full opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 no-hover:opacity-100 transition-opacity ml-1 bg-white/80 dark:bg-black/50"
                        title="Assign EPG to current channel"
                        style={{ color: accentColor }}
                      >
                        <LinkIcon className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Grid: programs, scrolls both directions natively with the container. */}
              <div className="relative shrink-0 bg-white dark:bg-[#1e1e1e] amoled:dark:bg-black" style={{ width: timelineWidth }}>

                {/* Programs */}
                {visibleChannels.map((channel, idx) => {
                  const globalIndex = startIndex + idx;
                  const programs = programmesByChannel[channel.id] || [];
                  const isEven = globalIndex % 2 === 0;
                  const rowBg = channel.id === highlightedChannelId
                    ? 'bg-amber-50 dark:bg-amber-900/20 amoled:dark:bg-amber-900/25'
                    : isEven
                      ? 'bg-white dark:bg-[#1e1e1e] amoled:dark:bg-black'
                      : 'bg-gray-50/70 dark:bg-[#222222] amoled:dark:bg-[#0d0d0d]';

                  return (
                    <div
                      key={globalIndex}
                      className={`absolute left-0 right-0 border-b border-gray-200 dark:border-white/5 ${rowBg}`}
                      style={{ top: globalIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
                    >
                      {programs.map(({ prog, startMs: start, endMs: end }, pIdx) => {
                        // Filter programs outside window
                        if (end <= windowStart || start >= windowStart + TIMELINE_TOTAL_HOURS * MS_PER_HOUR) return null;

                        const leftPx = Math.max(0, (start - windowStart) / MS_PER_HOUR * pixelsPerHour);
                        const rightPx = Math.min(timelineWidth, (end - windowStart) / MS_PER_HOUR * pixelsPerHour);
                        const widthPx = rightPx - leftPx;

                        if (widthPx < 2) return null; // Too narrow

                        // Progress logic
                        const nowTime = now.getTime();
                        let progressPercent = 0;
                        if (nowTime >= end) progressPercent = 100;
                        else if (nowTime > start) {
                          progressPercent = ((nowTime - start) / (end - start)) * 100;
                        }

                        const isPast = nowTime >= end;

                        return (
                          <div
                            key={`${channel.id}-${pIdx}`}
                            onClick={() => setSelectedProgramme(prog)}
                            className={`absolute top-1 bottom-1 rounded-sm border cursor-pointer overflow-hidden transition-colors group z-10 hover:z-20
                              ${isPast ? 'bg-gray-100 dark:bg-[#2a2a2a] amoled:dark:bg-[#111]' : 'bg-white dark:bg-[#333] amoled:dark:bg-[#1a1a1a]'}
                              border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-400
                            `}
                            style={{ left: leftPx, width: widthPx }}
                            title={`${prog.title}\n${formatTime(start, is24Hour)} - ${formatTime(end, is24Hour)}`}
                          >
                            {/* Progress fill */}
                            {progressPercent > 0 && progressPercent < 100 && (
                              <div
                                className="absolute top-0 bottom-0 left-0 pointer-events-none"
                                style={{ width: `${progressPercent}%`, backgroundColor: accentColor, opacity: 0.2 }}
                              />
                            )}
                            <div className="px-2 py-1 h-full relative flex flex-col justify-center min-w-0">
                              <span className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate block">
                                {prog.title}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {/* Background vertical grid lines */}
                {markers.map(m => (
                  <div
                    key={`bg-${m.key}`}
                    className="absolute top-0 bottom-0 border-l border-gray-100 dark:border-white/5 pointer-events-none"
                    style={{ left: m.offsetPx, width: 1 }}
                  />
                ))}

                {/* Current time red line — glides to its new spot each minute instead of jumping */}
                {nowOffsetPx >= 0 && nowOffsetPx <= timelineWidth && (
                  <div
                    className="absolute top-0 bottom-0 z-20 pointer-events-none transition-[left] duration-700 ease-[var(--md-standard)]"
                    style={{ left: nowOffsetPx, width: 2, backgroundColor: accentColor }}
                  />
                )}

              </div>
            </div>
          </div>
        </div>
      </div>

      <EpgProgramDialog
        programme={selectedProgramme}
        onClose={() => setSelectedProgramme(null)}
        onAssignChannel={(channelId) => {
          const channel = data?.channels.find(c => c.id === channelId);
          onAssignChannel(channelId, channel?.displayName || '');
        }}
      />
    </div>
  );
}
