import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { api, EpgChannel, EpgProgramme, epgEvents } from '../apiClient';
import { useStore, notifyError } from '../store';
import EpgProgramDialog, { parseXmltvTime } from './EpgProgramDialog';
import ChannelLogo from './ChannelLogo';
import { formatTime } from '../utils/formatTime';
import { foldText } from '../utils/foldText';
import { useIsPhone } from '../utils/useIsPhone';
import { useDebouncedValue } from '../utils/useDebouncedValue';
import Icon from './Icon';
import SourceActions from './SourceActions';

export interface EpgViewerProps {
  sourceId: string;
  onAssignChannel: (epgChannelId: string, epgDisplayName: string) => void;
  /** Shown as the pane's title. */
  sourceName?: string;
  /** Downloads the guide again (the header's Refresh button, and the empty state's). */
  onRefresh: () => void;
  isRefreshing: boolean;
  /** Opens the guide's settings (link, refresh interval). */
  onEdit: () => void;
  /** Why the last download failed, if it did: shown when there's no data to show. */
  fetchError?: string | null;
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

/**
 * The horizontal scroll position that puts `timelineOffset` (pixels from the start of the
 * timeline) in the middle of the part of the screen where programmes show. The pinned
 * channel column covers the left `channelColWidth` pixels, so the middle is there, not
 * the middle of the whole grid. (Centring on the whole grid put "now" at the right edge
 * of a phone screen.)
 */
function scrollLeftToCenter(timelineOffset: number, clientWidth: number, channelColWidth: number): number {
  return timelineOffset - (clientWidth - channelColWidth) / 2;
}

interface ProgrammeWithTimes {
  prog: EpgProgramme;
  startMs: number;
  endMs: number;
}

export default function EpgViewer({ sourceId, onAssignChannel, sourceName, onRefresh, isRefreshing, onEdit, fetchError }: EpgViewerProps) {
  const { logoBgColor, is24Hour, scrollTarget, setScrollTarget } = useStore();
  const scrollToEpgChannelId = scrollTarget?.kind === 'epg' ? scrollTarget.id : null;
  // The guide's channel list. Programmes aren't part of it: they're loaded for the rows on
  // screen only (see programmesByChannel below), because a big guide has millions of them.
  const [data, setData] = useState<{ channels: EpgChannel[] } | null>(null);
  // The programmes loaded so far, per channel, with their times already worked out.
  const [programmesByChannel, setProgrammesByChannel] = useState<{ [channelId: string]: ProgrammeWithTimes[] }>({});
  // Channels whose programmes were already asked for, so scrolling back doesn't ask again.
  const requestedChannelsRef = useRef(new Set<string>());
  // Goes up every time the guide is (re)loaded, so an answer that arrives late for the
  // previous guide, or from before a refresh, is ignored.
  const guideLoadRef = useRef(0);
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
  // On a phone the channel column is a fixed narrow strip (small logo + name), so most of
  // the screen is left for the timeline. Everything below uses channelColWidth.
  const isPhone = useIsPhone();
  const channelColWidth = isPhone ? 104 : sidebarWidth;
  // Read by the "centre on now" scroll below, which runs from a fetch callback that would
  // otherwise only ever see the column width from when the source was opened.
  const channelColWidthRef = useRef(channelColWidth);
  channelColWidthRef.current = channelColWidth;

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
      api.getEpgChannels(sourceId)
        .then(channels => {
          if (isMounted) {
            // Sort channels alphabetically
            channels.sort((a: EpgChannel, b: EpgChannel) => a.displayName.localeCompare(b.displayName));
            // Start again with no programmes loaded: this is a different guide, or the same
            // one after a fresh download.
            guideLoadRef.current++;
            requestedChannelsRef.current = new Set();
            setProgrammesByChannel({});
            setData({ channels });
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
                scrollRef.current.scrollLeft = scrollLeftToCenter(currentOffset, scrollRef.current.clientWidth, channelColWidthRef.current);
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

  // Parse each programme's XMLTV timestamps once, when a channel's programmes arrive,
  // instead of on every scroll-triggered re-render — this used to run for every visible
  // program, on every single scroll event, which was a real source of the
  // mobile scroll jank (string parsing + regex on the hot scroll path).
  const withTimes = (list: EpgProgramme[]): ProgrammeWithTimes[] => {
    // XMLTV doesn't guarantee <programme> elements appear in chronological order
    // (and the server doesn't sort them), so "next in the array" isn't necessarily
    // "next in time" until sorted here — the capping loop below assumes it is.
    const result: ProgrammeWithTimes[] = list.map(prog => ({
      prog,
      startMs: parseXmltvTime(prog.start).getTime(),
      endMs: parseXmltvTime(prog.stop).getTime(),
    })).sort((a, b) => a.startMs - b.startMs);
    // Cap each program's end time to the next program's start time, to
    // prevent visual overlap.
    for (let i = 0; i < result.length; i++) {
      const next = result[i + 1];
      if (next && result[i].endMs > next.startMs) {
        result[i] = { ...result[i], endMs: next.startMs };
      }
    }
    return result;
  };

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
        left: scrollLeftToCenter(currentOffset, scrollRef.current.clientWidth, channelColWidth),
        behavior: 'smooth'
      });
    }
  };

  // Calculate visible range for virtual scrolling. Rows live below the sticky
  // header (offset by HEADER_HEIGHT) in the shared scroll container's content.
  const startIndex = Math.max(0, Math.floor((scrollTop - HEADER_HEIGHT) / ROW_HEIGHT) - ROW_OVERSCAN);
  const endIndex = Math.min(filteredChannels.length, Math.ceil((scrollTop + containerHeight - HEADER_HEIGHT) / ROW_HEIGHT) + ROW_OVERSCAN);
  const visibleChannels = filteredChannels.slice(startIndex, endIndex);

  // Load the programmes of the rows on screen that haven't been loaded yet. The short wait
  // means that scrolling quickly through a long guide asks once, for where the scrolling
  // stopped, not for every row that flew past. Until the answer is in, a row's timeline is
  // simply empty.
  const loadFrom = useDebouncedValue(startIndex, 120);
  const loadTo = useDebouncedValue(endIndex, 120);
  useEffect(() => {
    if (!sourceId || !data) return;
    const wanted = filteredChannels.slice(loadFrom, loadTo).map(c => c.id).filter(id => !requestedChannelsRef.current.has(id));
    if (wanted.length === 0) return;
    for (const id of wanted) requestedChannelsRef.current.add(id);
    const guideLoad = guideLoadRef.current;
    api.getEpgNow(sourceId, wanted)
      .then(res => {
        if (guideLoad !== guideLoadRef.current) return;
        setProgrammesByChannel(loaded => {
          const next = { ...loaded };
          for (const id of wanted) next[id] = withTimes(res.programmes[id] || []);
          return next;
        });
      })
      .catch(err => {
        console.error(err);
        if (guideLoad !== guideLoadRef.current) return;
        // Forget that they were asked for, so scrolling to them again tries again.
        for (const id of wanted) requestedChannelsRef.current.delete(id);
        notifyError(err, 'Failed to load EPG data.');
      });
  }, [sourceId, data, filteredChannels, loadFrom, loadTo]);

  // Time markers
  const markers = [];
  for (let i = 0; i <= TIMELINE_TOTAL_HOURS * 2; i++) {
    const markerTime = new Date(windowStart + i * 30 * 60000);
    const offsetPx = (i * 30 * 60000) / MS_PER_HOUR * pixelsPerHour;
    const label = (i % 2 === 0) ? formatTime(markerTime, is24Hour) : '';
    markers.push({ offsetPx, label, key: i });
  }

  const nowOffsetPx = (now.getTime() - windowStart) / MS_PER_HOUR * pixelsPerHour;

  // The source's title and its Refresh / Edit buttons (bigger screens; phones show the title
  // in the top bar and these actions in its ⋮). Shown above every state, including the empty
  // and failed ones, because that's exactly when Refresh and Edit are needed.
  const channelCount = data?.channels.length ?? 0;
  const header = (
    <div className="shrink-0 hidden md:flex items-end gap-2 pl-6 pr-4 pt-4 pb-1">
      <div className="flex-1 min-w-0">
        <p className="text-label-md text-on-surface-variant">EPG source</p>
        <div className="flex items-baseline gap-2.5 min-w-0">
          <h2 className="min-w-0 truncate text-headline-sm tracking-[-0.01em] text-on-surface">{sourceName ?? 'TV guide'}</h2>
          {channelCount > 0 && <span className="shrink-0 text-body-md text-on-surface-variant">{channelCount} channel{channelCount !== 1 ? 's' : ''}</span>}
        </div>
      </div>
      <SourceActions onRefresh={onRefresh} isRefreshing={isRefreshing} onEdit={onEdit} kind="guide" />
    </div>
  );

  // Loading, failed and empty states: the header, then a message in the middle.
  const emptyState = (body: React.ReactNode) => (
    <div className="flex flex-col h-full overflow-hidden">
      {header}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center text-body-md text-on-surface-variant">
        {body}
      </div>
    </div>
  );

  if (loading) {
    return emptyState(
      <>
        <Icon name="progress_activity" className="text-[32px] animate-spin mb-4 text-primary" />
        <p>Loading EPG data…</p>
      </>
    );
  }

  if (error && (!data || data.channels.length === 0)) {
    return emptyState(
      <>
        <p className="text-error">{error}</p>
        <button onClick={() => setRetryTick(t => t + 1)} className="md-btn btn btn-text mt-3">
          Retry
        </button>
      </>
    );
  }

  if (!data || data.channels.length === 0) {
    return emptyState(
      <>
        <p className="text-title-md text-on-surface">No TV guide data yet</p>
        <p className="mt-1 max-w-sm">
          {fetchError
            ? `The last download failed: ${fetchError}`
            : 'This guide hasn’t been downloaded yet, or it has no channels in it.'}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button onClick={onEdit} className="md-btn btn btn-outlined">
            <Icon name="edit" className="text-[20px]" />
            Edit guide
          </button>
          <button onClick={onRefresh} disabled={isRefreshing} className="md-btn btn btn-filled">
            <Icon name="refresh" className={`text-[20px] ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Downloading…' : 'Download again'}
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden relative">

      {header}

      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between gap-2 px-4 max-md:px-2 py-3 max-md:py-2 z-20">
        <div className="relative w-72 max-md:w-auto max-md:flex-1 max-md:min-w-0">
          <Icon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-[24px] text-on-surface-variant" />
          <input
            type="text"
            placeholder="Search channels"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 max-md:h-12 pl-11 pr-4 rounded-full bg-surface-container-highest text-body-md max-md:text-base text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setPixelsPerHour(p => Math.min(p + 100, 600))}
            className="md-btn icon-btn max-md:w-12 max-md:h-12"
            title="Zoom in"
          >
            <Icon name="zoom_in" className="text-[24px]" />
          </button>
          <button
            onClick={() => setPixelsPerHour(p => Math.max(p - 100, 100))}
            className="md-btn icon-btn max-md:w-12 max-md:h-12"
            title="Zoom out"
          >
            <Icon name="zoom_out" className="text-[24px]" />
          </button>
          <button
            onClick={scrollToNow}
            className="md-btn btn btn-tonal ml-1 max-md:px-3"
            title="Jump to now"
          >
            <Icon name="my_location" className="text-[20px]" />
            <span className="hidden md:inline">Now</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative">
        {/* Sidebar resize handle — lives outside the scroll container so it
            stays at a fixed screen position (not part of scrolled content). */}
        {!isPhone && (
          <div
            onMouseDown={startSidebarResize}
            className="absolute top-0 bottom-0 w-1 cursor-col-resize hover:bg-on-surface/[0.12] transition-colors z-50"
            style={{ left: sidebarWidth }}
          />
        )}

        {/* Single scroll container for the whole grid. The header row and
            channel sidebar are `position: sticky` children of this element,
            so they're pinned by the browser's native compositor — perfectly
            in sync with the body scroll, with zero JS-driven lag. */}
        <div
          ref={scrollRef}
          className="w-full h-full overflow-auto overscroll-contain"
          onScroll={handleScroll}
        >
          <div style={{ width: channelColWidth + timelineWidth }}>
            {/* Header bar: pinned to the top while scrolling vertically, and
                scrolls horizontally in lockstep with the grid since it's the
                same scroll container. */}
            <div
              className="sticky top-0 z-40 flex border-y border-outline-variant bg-pane"
              style={{ height: HEADER_HEIGHT }}
            >
              {/* Corner cell: additionally pinned to the left so it stays put
                  on both axes. */}
              <div
                className="sticky left-0 z-10 shrink-0 flex items-center px-4 max-md:px-3 border-r border-outline-variant bg-pane"
                style={{ width: channelColWidth, height: HEADER_HEIGHT }}
              >
                <span className="text-label-md text-on-surface-variant">Channel</span>
              </div>
              <div className="relative shrink-0" style={{ width: timelineWidth, height: HEADER_HEIGHT }}>
                {markers.map(m => (
                  <div
                    key={m.key}
                    className="absolute top-0 bottom-0 border-l border-outline-variant flex items-center pl-1"
                    style={{ left: m.offsetPx }}
                  >
                    {m.label && <span className="text-label-md text-on-surface-variant">{m.label}</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Body row */}
            <div className="flex" style={{ height: filteredChannels.length * ROW_HEIGHT }}>
              {/* Channel sidebar: pinned to the left while scrolling horizontally. */}
              <div
                className="sticky left-0 z-30 shrink-0 relative border-r border-outline-variant bg-pane"
                style={{ width: channelColWidth }}
              >
                {visibleChannels.map((channel, idx) => {
                  const globalIndex = startIndex + idx;
                  // A search jump flashes the row; otherwise a light wash on hover. No zebra stripes.
                  const rowBg = channel.id === highlightedChannelId
                    ? 'bg-tertiary-container'
                    : 'bg-pane hover:bg-on-surface/[0.06]';

                  return (
                    isPhone ? (
                      // Phone: small logo and a two-line name, no id. The whole cell is the
                      // "assign this guide channel" button, since there's no hover to reveal one.
                      <button
                        key={globalIndex}
                        onClick={() => onAssignChannel(channel.id, channel.displayName)}
                        className={`absolute left-0 right-0 flex items-center gap-2 px-2 text-left border-b border-outline-variant/60 ${rowBg}`}
                        style={{ top: globalIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
                      >
                        <ChannelLogo
                          logo={channel.icon}
                          name={channel.displayName}
                          logoBgColor={logoBgColor}
                          className="shrink-0 w-8 h-6 rounded"
                        />
                        <span className="flex-1 min-w-0 text-label-md leading-tight text-on-surface line-clamp-2 break-words">
                          {channel.displayName}
                        </span>
                      </button>
                    ) : (
                    <div
                      key={globalIndex}
                      className={`absolute left-0 right-0 flex items-center px-3 border-b border-outline-variant/60 group transition-colors ${rowBg}`}
                      style={{ top: globalIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
                    >
                      <div className="shrink-0 mr-3">
                        <ChannelLogo
                          logo={channel.icon}
                          name={channel.displayName}
                          logoBgColor={logoBgColor}
                          className="w-12 h-8 rounded-md"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-label-lg text-on-surface truncate" title={channel.displayName}>
                          {channel.displayName}
                        </p>
                        <p className="text-body-sm font-mono text-on-surface-variant truncate" title={channel.id}>
                          {channel.id}
                        </p>
                      </div>
                      <button
                        onClick={() => onAssignChannel(channel.id, channel.displayName)}
                        className="md-btn icon-btn w-9 h-9 ml-1 bg-secondary-container text-on-secondary-container opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 no-hover:opacity-100 transition-opacity"
                        title="Assign this guide channel to playlist channels"
                      >
                        <Icon name="link" className="text-[20px]" />
                      </button>
                    </div>
                    )
                  );
                })}
              </div>

              {/* Grid: programs, scrolls both directions natively with the container. */}
              <div className="relative shrink-0 bg-pane" style={{ width: timelineWidth }}>

                {/* Programs */}
                {visibleChannels.map((channel, idx) => {
                  const globalIndex = startIndex + idx;
                  const programs = programmesByChannel[channel.id] || [];
                  const rowBg = channel.id === highlightedChannelId ? 'bg-tertiary-container' : '';

                  return (
                    <div
                      key={globalIndex}
                      className={`absolute left-0 right-0 border-b border-outline-variant/60 ${rowBg}`}
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
                        const isOn = progressPercent > 0 && progressPercent < 100;

                        return (
                          <div
                            key={`${channel.id}-${pIdx}`}
                            onClick={() => setSelectedProgramme(prog)}
                            // What's on now stands out in the selection colour; what's over is quieter.
                            // The other blocks are washes of the text colour rather than fixed surface
                            // tones, so they show on the pane in every theme (a fixed tone matched the
                            // pane exactly in dark mode).
                            className={`absolute top-1 bottom-1 rounded-lg cursor-pointer overflow-hidden transition-shadow group z-10 hover:z-20 hover:ring-2 hover:ring-outline
                              ${isOn ? 'bg-secondary-container text-on-secondary-container' : isPast ? 'bg-on-surface/[0.08] text-on-surface-variant' : 'bg-on-surface/[0.14] text-on-surface'}
                            `}
                            // A pixel of space on each side, so neighbouring programmes don't merge.
                            style={{ left: leftPx + 1, width: Math.max(1, widthPx - 2) }}
                            title={`${prog.title}\n${formatTime(start, is24Hour)} - ${formatTime(end, is24Hour)}`}
                          >
                            {/* Progress fill */}
                            {isOn && (
                              <div
                                className="absolute top-0 bottom-0 left-0 pointer-events-none bg-primary/15"
                                style={{ width: `${progressPercent}%` }}
                              />
                            )}
                            <div className="px-2.5 py-1 h-full relative flex flex-col justify-center min-w-0">
                              <span className="text-label-md truncate block">
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
                    className="absolute top-0 bottom-0 border-l border-outline-variant pointer-events-none"
                    style={{ left: m.offsetPx, width: 1 }}
                  />
                ))}

                {/* Current time red line — glides to its new spot each minute instead of jumping */}
                {nowOffsetPx >= 0 && nowOffsetPx <= timelineWidth && (
                  <div
                    className="absolute top-0 bottom-0 z-20 pointer-events-none bg-primary transition-[left] duration-700 ease-[var(--md-standard)]"
                    style={{ left: nowOffsetPx, width: 2 }}
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
