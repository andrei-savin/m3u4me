import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStats, usePlaylists, triggerRefresh, Playlist, SearchResult } from '../apiClient';
import { useStore, notifyError } from '../store';
import DesktopTopBar from './DesktopTopBar';
import UpdateBanner from './UpdateBanner';
import KeyboardShortcutsDialog from './KeyboardShortcutsDialog';
import NewPlaylistDialog from './NewPlaylistDialog';
import { Logo } from './Logo';
import Spotlight from './Spotlight';
import Toast from './Toast';
import MobileTopBar from './MobileTopBar';
import MobileTabBar from './MobileTabBar';
import { useIsPhone } from '../utils/useIsPhone';
import { formatTime } from '../utils/formatTime';
import { copyToClipboard } from '../utils/copyToClipboard';
import Icon from './Icon';

/** "Today at 14:32" for a timestamp from today, "03.09.2026 at 14:32" otherwise — same
 * shape as the channel-pool update log's timestamps, so the two read consistently. */
function formatDateTime(ts: number, is24Hour: boolean): string {
  const date = new Date(ts);
  const isToday = new Date().toDateString() === date.toDateString();
  const timeStr = formatTime(date, is24Hour);
  return isToday ? `Today at ${timeStr}` : `${date.toLocaleDateString()} at ${timeStr}`;
}

/** Animates a number counting up from whatever it last settled on to `target` — purely a
 * bit of polish for the numbers. Re-triggers any time `target` changes (including the
 * very first render, from 0), not just on mount. */
function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const to = target;
    fromRef.current = to;
    if (from === to) { setValue(to); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setValue(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

/** The same flat card every block on this screen sits on: a pane on the tinted page. */
const CARD = 'bg-pane border border-pane-border rounded-2xl';

/** A section's title, with an optional button on the right. */
function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 min-h-10 mb-3 pl-1">
      <h2 className="text-title-lg text-on-surface">{children}</h2>
      {action}
    </div>
  );
}

/**
 * One playlist: its name, how big it is and when a TV app last fetched it, the link to give
 * to a TV app (with copy and download), and a way into it. If its sources changed channels
 * that the user had edited, a chip says so and opens the playlist's sync log.
 */
function PlaylistCard({ playlist, is24Hour, onOpen, onOpenSyncLog }: {
  key?: string | number;
  playlist: Playlist;
  is24Hour: boolean;
  onOpen: () => void;
  onOpenSyncLog: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.protocol}//${window.location.host}/${playlist.shortId}`;
  const channelCount = playlist.channelCount ?? 0;
  const pending = playlist.pendingSyncCount || 0;

  const copyLink = async () => {
    if (!(await copyToClipboard(url))) { notifyError(null, "Couldn't copy the link. Select it and copy it yourself."); return; }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`${CARD} flex flex-col p-5 min-w-0`}>
      <div className="flex items-start gap-2 min-w-0">
        <h3 className="flex-1 min-w-0 truncate text-title-md text-on-surface" title={playlist.name}>{playlist.name}</h3>
        {pending > 0 && (
          <button
            onClick={onOpenSyncLog}
            className="md-btn shrink-0 inline-flex items-center gap-1 h-6 pl-1.5 pr-2.5 rounded-lg bg-tertiary-container text-on-tertiary-container text-label-md"
            title="Sources changed channels you had edited yourself. Review them and pick what to keep."
          >
            <Icon name="sync" className="text-[16px]" />
            {pending} to review
          </button>
        )}
      </div>
      {/* Wraps instead of cutting off the date on phones and in the two-column layout. */}
      <p className="mt-0.5 text-body-md text-on-surface-variant">
        {channelCount.toLocaleString()} channel{channelCount === 1 ? '' : 's'}
        {playlist.lastDownloadedAt ? ` · Last fetched ${formatDateTime(playlist.lastDownloadedAt, is24Hour).replace(/^Today/, 'today')}` : ''}
      </p>

      {/* The link a TV app needs. */}
      <div className="mt-4 flex items-center h-12 pl-4 pr-1 rounded-xl bg-surface-container-highest">
        <span className="flex-1 min-w-0 truncate text-body-md font-mono text-on-surface select-all" title={url}>{url}</span>
        <button onClick={copyLink} className="md-btn icon-btn" title="Copy playlist link" aria-label="Copy playlist link">
          {copied ? <Icon name="check" className="text-primary" /> : <Icon name="content_copy" />}
        </button>
        <a href={url} download={`${playlist.name}.m3u`} className="md-btn icon-btn" title="Download playlist" aria-label="Download playlist">
          <Icon name="download" />
        </a>
      </div>

      <div className="mt-4 flex justify-end">
        <button onClick={onOpen} className="md-btn btn btn-tonal">
          Open
          <Icon name="arrow_forward" className="text-[20px] -mr-1.5" />
        </button>
      </div>
    </div>
  );
}

/** One count in the overview: playlists, sources or EPG sources. Clicking it goes there. */
function CountTile({ icon, count, label, secondary, onClick }: {
  icon: string;
  count: number;
  label: string;
  secondary: string;
  onClick: () => void;
}) {
  const animated = useCountUp(count);
  return (
    // Phones (below sm) fit all three tiles in one row, so each is smaller there and drops
    // its second line.
    <button onClick={onClick} className={`md-btn ${CARD} text-left p-5 max-sm:p-3.5 flex flex-col gap-3 max-sm:gap-2 min-w-0`}>
      <span className="w-10 h-10 max-sm:w-9 max-sm:h-9 rounded-full flex items-center justify-center bg-secondary-container text-on-secondary-container">
        <Icon name={icon} className="max-sm:text-[20px]" />
      </span>
      <span className="min-w-0 block">
        <span className="block text-[32px] leading-10 max-sm:text-2xl max-sm:leading-8 font-medium tracking-tight text-on-surface tabular-nums">{animated.toLocaleString()}</span>
        {/* Wraps rather than cuts off ("EPG sour…") on the narrowest phones. */}
        <span className="block text-label-lg max-sm:text-label-md text-on-surface break-words">{label}</span>
        <span className="block text-body-sm text-on-surface-variant mt-0.5 truncate max-sm:hidden">{secondary}</span>
      </span>
    </button>
  );
}

/**
 * The homescreen — where the app lands unless a specific page is entered directly. It's laid
 * out like the rest of the app: flat cards on the tinted page, no decoration.
 *
 * 1. Your playlists: a card each, with the link for a TV app.
 * 2. Overview: the total number of channels m3u4me knows about (the one accent-coloured
 *    card), then playlists / sources / EPG sources (see /api/stats in server.ts).
 * 3. Recent activity: the last time a TV app fetched a playlist, and the newest channels
 *    a source brought in.
 */
export default function Home() {
  const navigate = useNavigate();
  const {
    is24Hour,
    setActivePlaylistId, setActiveCategory,
    setActiveEpgSourceId, setActiveChannelPoolSourceId,
    setScrollTarget, setSyncLogOpenFor,
  } = useStore();
  const { stats, loading, error, refetch } = useStats();
  const { playlists, loading: playlistsLoading } = usePlaylists();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const isPhone = useIsPhone();

  const additions = stats?.latestChannelPoolAdditions ?? null;
  const totalChannels = stats ? stats.playlistChannelCount + stats.channelPoolChannelCount + stats.epgChannelCount : 0;
  const totalChannelsAnimated = useCountUp(totalChannels, 1200);

  // Identical to Dashboard's handler — same three destinations, same "scroll to it once
  // loaded" handoff via scrollTarget. Kept in sync by hand since there's no shared module
  // for it (see CLAUDE.md on the frontend/backend type duplication convention).
  const handleSpotlightNavigate = (result: SearchResult) => {
    if (result.kind === 'playlist') {
      navigate('/playlists');
      setActivePlaylistId(result.containerId);
      setActiveCategory(result.category);
    } else if (result.kind === 'channelPool') {
      navigate('/sources');
      setActiveChannelPoolSourceId(result.containerId);
    } else {
      navigate('/epg');
      setActiveEpgSourceId(result.containerId);
    }
    setScrollTarget({ kind: result.kind, id: result.id });
  };

  const openPlaylist = (id: string) => {
    setActivePlaylistId(id);
    navigate('/playlists');
  };

  return (
    <div className="md-page-in flex flex-col h-dvh overflow-hidden bg-page text-on-surface">
      <UpdateBanner />

      {/* Both bars are shared with Dashboard (DesktopTopBar on tablets and computers,
          MobileTopBar on phones), so nothing shifts when moving between screens. */}
      <MobileTopBar leading={<Logo className="h-6 w-auto text-on-surface shrink-0" />} />
      <DesktopTopBar onShortcuts={() => setShowShortcuts(true)} pendingSyncCount={stats?.pendingSyncCount || 0} />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 max-md:px-2 pt-2 pb-10 space-y-8">

          {/* ── Your playlists ───────────────────────────────────────────── */}
          <section>
            <SectionTitle
              action={
                <button onClick={() => setIsCreating(true)} className="md-btn btn btn-text">
                  <Icon name="add" className="text-[20px]" />
                  New playlist
                </button>
              }
            >
              Your playlists
            </SectionTitle>
            {playlistsLoading && playlists.length === 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[0, 1].map(i => <div key={i} className={`${CARD} h-[13.5rem] animate-pulse`} />)}
              </div>
            ) : playlists.length === 0 ? (
              <div className={`${CARD} flex flex-col items-center text-center px-6 py-10`}>
                <span className="w-14 h-14 rounded-full flex items-center justify-center bg-secondary-container text-on-secondary-container mb-4">
                  <Icon name="queue_music" className="text-[28px]" />
                </span>
                <p className="text-title-md text-on-surface">No playlists yet</p>
                <p className="mt-1 text-body-md text-on-surface-variant max-w-sm">A playlist is the channel list your TV app loads. Make one, then fill it from your sources.</p>
                <button onClick={() => setIsCreating(true)} className="md-btn btn btn-filled mt-5">
                  <Icon name="add" className="text-[20px]" />
                  New playlist
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {playlists.map(playlist => (
                  <PlaylistCard
                    key={playlist.id}
                    playlist={playlist}
                    is24Hour={is24Hour}
                    onOpen={() => openPlaylist(playlist.id)}
                    onOpenSyncLog={() => { setSyncLogOpenFor(playlist.id); openPlaylist(playlist.id); }}
                  />
                ))}
              </div>
            )}
          </section>

          {loading && !stats ? (
            <div className="grid grid-cols-3 lg:grid-cols-[1.5fr_1fr_1fr_1fr] gap-3">
              <div className={`${CARD} h-36 animate-pulse col-span-3 lg:col-span-1`} />
              {[0, 1, 2].map(i => <div key={i} className={`${CARD} h-36 animate-pulse`} />)}
            </div>
          ) : error && !stats ? (
            <div className={`${CARD} px-5 py-6 text-center`}>
              <p className="text-body-md text-error">{error}</p>
              <button onClick={refetch} className="md-btn btn btn-text mt-2">Retry</button>
            </div>
          ) : stats && (
            <>
              {/* ── Overview ───────────────────────────────────────────────── */}
              <section>
                <SectionTitle>Overview</SectionTitle>
                <div className="grid grid-cols-3 lg:grid-cols-[1.5fr_1fr_1fr_1fr] gap-3">
                  {/* The one accent-coloured card: everything m3u4me knows about, in one number. */}
                  <div className="col-span-3 lg:col-span-1 rounded-2xl bg-primary-container text-on-primary-container p-5 flex flex-col justify-between gap-3 min-w-0">
                    <span className="text-label-lg">In total</span>
                    <span className="block">
                      <span className="block text-[45px] leading-[52px] font-medium tracking-tight tabular-nums">{totalChannelsAnimated.toLocaleString()}</span>
                      <span className="block text-body-md opacity-80">channels across your playlists, sources and guides</span>
                    </span>
                  </div>
                  <CountTile
                    icon="queue_music"
                    count={stats.playlistCount}
                    label={stats.playlistCount === 1 ? 'Playlist' : 'Playlists'}
                    secondary={`${stats.playlistChannelCount.toLocaleString()} channel${stats.playlistChannelCount === 1 ? '' : 's'}`}
                    onClick={() => navigate('/playlists')}
                  />
                  <CountTile
                    icon="stacks"
                    count={stats.channelPoolSourceCount}
                    label={stats.channelPoolSourceCount === 1 ? 'Source' : 'Sources'}
                    secondary={`${stats.channelPoolChannelCount.toLocaleString()} channel${stats.channelPoolChannelCount === 1 ? '' : 's'} available`}
                    onClick={() => navigate('/sources')}
                  />
                  <CountTile
                    icon="live_tv"
                    count={stats.epgSourceCount}
                    label={stats.epgSourceCount === 1 ? 'EPG source' : 'EPG sources'}
                    secondary={`${stats.epgChannelCount.toLocaleString()} channel${stats.epgChannelCount === 1 ? '' : 's'} with a guide`}
                    onClick={() => navigate('/epg')}
                  />
                </div>
              </section>

              {/* ── Recent activity ────────────────────────────────────────── */}
              <section>
                <SectionTitle>Recent activity</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className={`${CARD} flex gap-4 p-5 min-w-0`}>
                    <Icon name="download" className="text-primary mt-0.5" />
                    <div className="min-w-0">
                      <h3 className="text-title-sm text-on-surface">Last playlist fetch</h3>
                      <p className="mt-1 text-body-md text-on-surface-variant">
                        {stats.lastPlaylistDownload
                          ? formatDateTime(stats.lastPlaylistDownload, is24Hour)
                          : 'No TV app has fetched a playlist yet.'}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      if (!additions) return;
                      setActiveChannelPoolSourceId(additions.sourceId);
                      navigate('/sources');
                    }}
                    disabled={!additions}
                    className={`${additions ? 'md-btn' : 'cursor-default'} ${CARD} flex gap-4 p-5 min-w-0 text-left`}
                  >
                    <Icon name="auto_awesome" className="text-primary mt-0.5" />
                    <span className="min-w-0 block">
                      <span className="block text-title-sm text-on-surface">New channels from your sources</span>
                      {additions ? (
                        <>
                          <span className="block mt-1 text-body-md text-on-surface-variant">
                            <span className="font-semibold text-on-surface">{additions.added.length}</span> new in <span className="font-semibold text-on-surface">{additions.sourceName}</span> · {formatDateTime(additions.timestamp, is24Hour)}
                          </span>
                          <span className="block mt-1 text-body-sm text-on-surface-variant truncate">
                            {additions.added.slice(0, 5).map(c => c.name).join(', ')}
                            {additions.added.length > 5 ? ` +${additions.added.length - 5} more` : ''}
                          </span>
                        </>
                      ) : (
                        <span className="block mt-1 text-body-md text-on-surface-variant">No new channels found yet.</span>
                      )}
                    </span>
                  </button>
                </div>
              </section>
            </>
          )}

        </div>
      </div>

      {isPhone && <MobileTabBar active="home" />}

      <NewPlaylistDialog
        open={isCreating}
        onClose={() => setIsCreating(false)}
        onCreated={playlistId => {
          setIsCreating(false);
          triggerRefresh();
          openPlaylist(playlistId);
        }}
      />

      <KeyboardShortcutsDialog open={showShortcuts} onClose={() => setShowShortcuts(false)} />

      <Spotlight onNavigate={handleSpotlightNavigate} />
      <Toast withTabBar />
    </div>
  );
}
