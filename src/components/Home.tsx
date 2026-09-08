import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStats, usePlaylists, SearchResult } from '../apiClient';
import { useStore, accentAlpha, notifyError } from '../store';
import { useVersionInfo } from './AppInfo';
import { Logo } from './Logo';
import Spotlight from './Spotlight';
import Toast from './Toast';
import { formatTime } from '../utils/formatTime';
import { FileAudio, Layers, Radio, Download, Sparkles, Settings, ArrowUpCircle, Search, Keyboard, Copy, Check } from 'lucide-react';

const NAV_TABS: { key: string; label: string; path: string }[] = [
  { key: 'playlists', label: 'My Playlists', path: '/playlists' },
  { key: 'channels', label: 'Sources', path: '/sources' },
  { key: 'epg', label: 'EPG', path: '/epg' },
];

/** Shared glass surface for every card on this screen — translucent + blurred so the
 * animated background reads through softly instead of being hidden behind flat panels. */
const GLASS = 'backdrop-blur-xl bg-white/60 dark:bg-white/[0.06] amoled:dark:bg-white/[0.03] border border-white/60 dark:border-white/10 amoled:dark:border-white/5 shadow-xl';

/** "Today at 14:32" for a timestamp from today, "03.09.2026 at 14:32" otherwise — same
 * shape as the channel-pool update log's timestamps, so the two read consistently. */
function formatDateTime(ts: number, is24Hour: boolean): string {
  const date = new Date(ts);
  const isToday = new Date().toDateString() === date.toDateString();
  const timeStr = formatTime(date, is24Hour);
  return isToday ? `Today at ${timeStr}` : `${date.toLocaleDateString()} at ${timeStr}`;
}

/** Animates a number counting up from whatever it last settled on to `target` — purely a
 * bit of polish for the stat tiles. Re-triggers any time `target` changes (including the
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

/** Decorative background: two slow-drifting accent-colored "aurora" blobs, a tilted "floor"
 * of the user's own channel logos scrolling past as if shot from above at an angle, and a
 * gradient scrim so the glass cards in front stay legible either way. Purely decorative —
 * aria-hidden, and every logo silently drops itself if its URL 404s. */
function HomeBackground({ logos, accentColor }: { logos: string[]; accentColor: string }) {
  const rowCount = 5;
  // Split into two alternating pools so adjacent rows read as visually distinct sets instead
  // of the same full list just phase-shifted — even rows draw only from pool A, odd rows only
  // from pool B (each still offset a bit row-to-row so same-parity rows vary too). Logos
  // already arrive pre-shuffled from the server, so this split is itself a random partition
  // on every load, not a fixed one.
  const rows = (() => {
    if (logos.length === 0) return [];
    const mid = Math.ceil(logos.length / 2);
    const pools = [logos.slice(0, mid), logos.slice(mid)];
    return Array.from({ length: rowCount }, (_, i) => {
      const pool = pools[i % 2].length > 0 ? pools[i % 2] : logos;
      const offset = Math.floor(i / 2) * 5;
      return pool.map((_, idx) => pool[(idx + offset) % pool.length]);
    });
  })();

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none" aria-hidden="true">
      <div
        className="home-aurora absolute -top-32 -left-24 w-[36rem] h-[36rem] rounded-full blur-3xl opacity-30 dark:opacity-20"
        style={{ backgroundColor: accentColor }}
      />
      <div
        className="home-aurora absolute -bottom-40 -right-16 w-[40rem] h-[40rem] rounded-full blur-3xl opacity-20 dark:opacity-15"
        style={{ backgroundColor: accentColor, animationDelay: '-8s', animationDirection: 'alternate-reverse' }}
      />

      {rows.length > 0 && (
        // A tilted "floor" of logos, as if shot from above at an angle — perspective on this
        // outer box, the actual rotation on the inner plane. The plane is oversized (wider/
        // taller than the box it's tilted inside) because rotateX foreshortens it and a
        // perspective tilt trapezoids a rectangle; without the extra size and the recentering
        // translate, the corners of the box would show gaps past the plane's tilted edges.
        <div className="absolute inset-0" style={{ perspective: '1200px', perspectiveOrigin: '50% 20%' }}>
          <div
            className="absolute left-1/2 bottom-0 flex flex-col justify-around gap-6 opacity-[0.18] dark:opacity-[0.24]"
            style={{
              width: '170%',
              height: '170%',
              transform: 'translateX(-50%) rotateX(58deg) rotateZ(-6deg) scale(1.15)',
              transformOrigin: 'bottom center',
            }}
          >
            {rows.map((row, i) => (
              <div
                key={i}
                className="home-logo-row flex w-max shrink-0"
                style={{ animation: `home-scroll-${i % 2 === 0 ? 'l' : 'r'} ${46 + i * 8}s linear infinite` }}
              >
                {/* Tile spacing is a margin on each tile, not a `gap` on this row, so the
                    loop below is exactly seamless. The row is [...row, ...row] and the
                    animation slides it left/right by -50%/50% to loop; with a container
                    `gap`, the doubled content has one MORE gap (2N-1) than "two copies
                    side by side" (2N-2 gaps), and dividing that odd count by 2 comes up
                    half a gap short of a true one-copy-width — a small but visible snap
                    every time the animation resets. A trailing margin on every tile
                    (including the last) makes each tile+margin a fixed-width unit, so
                    2N of them split evenly in half — no seam, no snap. */}
                {[...row, ...row].map((logo, j) => (
                  <img
                    key={j}
                    src={logo}
                    alt=""
                    loading="lazy"
                    className="h-28 w-28 shrink-0 rounded-3xl object-contain bg-white/50 dark:bg-white/10 p-3 grayscale shadow-lg mr-10"
                    onError={e => { e.currentTarget.style.opacity = '0'; }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-b from-gray-100/45 via-gray-100/35 to-gray-100/55 dark:from-[#121212]/55 dark:via-[#121212]/40 dark:to-[#121212]/65 amoled:dark:from-black/60 amoled:dark:via-black/45 amoled:dark:to-black/70" />
    </div>
  );
}

function StatCard({ icon, count, label, secondary, accentColor, onClick }: {
  icon: React.ReactNode;
  count: number;
  label: string;
  secondary: string;
  accentColor: string;
  onClick: () => void;
}) {
  const animated = useCountUp(count);
  return (
    <button
      onClick={onClick}
      className={`md-btn text-left rounded-2xl px-6 py-6 flex flex-col gap-3 transition-transform duration-200 hover:-translate-y-1 ${GLASS}`}
    >
      <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ backgroundColor: accentAlpha(accentColor, '20') }}>
        {icon}
      </div>
      <div>
        <div className="text-4xl font-bold text-gray-900 dark:text-white leading-tight tabular-nums">{animated.toLocaleString()}</div>
        <div className="text-sm font-medium text-gray-700 dark:text-gray-200 mt-1">{label}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{secondary}</div>
      </div>
    </button>
  );
}

/** Icon-only quick-download row per playlist — copy its M3U link or download the file directly
 * without leaving the homescreen. Playlists only, deliberately: sources and EPG sources don't
 * have a single "download this" URL the way a playlist's short link does. Uses its own
 * usePlaylists() (not /api/stats) since stats only carries aggregate counts, not the actual
 * list. */
function PlaylistDownloadsCard({ accentColor }: { accentColor: string }) {
  const { playlists, loading } = usePlaylists();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Same copy-with-fallback as PlaylistEditor's export dialog — kept in sync by hand, same as
  // the Spotlight handler above (see CLAUDE.md on frontend/backend type duplication; this is
  // the same story one layer up, for a UI pattern instead of a data shape). The execCommand
  // fallback covers non-HTTPS/non-secure contexts, where navigator.clipboard doesn't exist.
  const copyLink = (url: string, id: string) => {
    const flash = () => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(current => current === id ? null : current), 2000);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(flash).catch(fallback);
    } else {
      fallback();
    }
    function fallback() {
      const el = document.createElement('textarea');
      el.value = url;
      el.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
      document.body.appendChild(el);
      el.select();
      try { document.execCommand('copy'); flash(); } catch (e) { console.error(e); notifyError(e, 'Failed to copy to clipboard.'); }
      document.body.removeChild(el);
    }
  };

  return (
    <div className={`rounded-2xl px-5 py-4 ${GLASS}`}>
      <div className="flex items-center gap-2 mb-3">
        <Download className="h-4 w-4" style={{ color: accentColor }} />
        <h2 className="text-sm font-medium text-gray-900 dark:text-white">Download Playlists</h2>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1].map(i => <div key={i} className="h-9 rounded-lg bg-gray-300/40 dark:bg-white/5 animate-pulse" />)}
        </div>
      ) : playlists.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">You haven't created a playlist yet.</p>
      ) : (
        <div className="space-y-1">
          {playlists.map(p => {
            const url = `${window.location.protocol}//${window.location.host}/${p.shortId}`;
            return (
              <div key={p.id} className="flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors">
                <span className="flex-1 min-w-0 text-sm text-gray-700 dark:text-gray-300 truncate">{p.name}</span>
                <button
                  onClick={() => copyLink(url, p.id)}
                  className="md-btn shrink-0 p-1.5 rounded-full text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white transition-colors"
                  title="Copy playlist link"
                >
                  {copiedId === p.id ? <Check className="h-4 w-4" style={{ color: accentColor }} /> : <Copy className="h-4 w-4" />}
                </button>
                <a
                  href={url}
                  download={`${p.name}.m3u`}
                  className="md-btn shrink-0 p-1.5 rounded-full text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white transition-colors"
                  title="Download playlist"
                >
                  <Download className="h-4 w-4" />
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The homescreen — where the app lands unless a specific page is entered directly. Gives an
 * at-a-glance overview of everything m3u4me is managing (see /api/stats in server.ts), and
 * doubles as quick navigation into the three main tabs. */
export default function Home() {
  const navigate = useNavigate();
  const {
    accentColor, is24Hour,
    setActivePlaylistId, setActiveCategory,
    setActiveEpgSourceId, setActiveChannelPoolSourceId,
    setScrollTarget,
  } = useStore();
  const { stats, loading, error, refetch } = useStats();
  const versionInfo = useVersionInfo();
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const mod = /mac/i.test(navigator.platform) ? 'Cmd' : 'Ctrl';

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

  return (
    <div className="md-page-in relative flex flex-col h-screen overflow-hidden bg-gray-100 dark:bg-[#121212] amoled:dark:bg-black font-sans">
      <HomeBackground logos={stats?.sampleLogos ?? []} accentColor={accentColor} />

      <div className="relative z-10 flex flex-col h-full">
        {/* ── Update Banner ───────────────────────────────────────────────── */}
        {versionInfo.updateAvailable && !updateDismissed && versionInfo.releaseUrl && (
          <div className="shrink-0 z-30 flex items-center justify-center gap-3 px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: accentColor }}>
            <ArrowUpCircle className="h-4 w-4 shrink-0" />
            <span>A new version of m3u4me is available: <strong>v{versionInfo.latest}</strong></span>
            <a
              href={versionInfo.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:opacity-80 transition-opacity"
            >
              View release
            </a>
            <button onClick={() => setUpdateDismissed(true)} className="ml-auto p-0.5 rounded hover:bg-white/20 transition-colors" aria-label="Dismiss">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        )}

        {/* ── Top App Bar ─────────────────────────────────────────────────── */}
        {/* Grid + button set/order/classes deliberately mirror Dashboard.tsx's nav bar exactly
            (same 1fr_auto_1fr, same class strings) so nothing shifts position when you move
            between Home and the main app — verified pixel-for-pixel against Dashboard's own
            tabs/Search/Shortcuts/Settings at normal widths. The two things Home doesn't have
            are the sidebar toggle (there's no sidebar here) and the Hide URLs button (page-
            specific to the playlist/channel editors) — Dashboard itself already omits that
            second one on its own EPG tab. Search and Keyboard Shortcuts are fully wired up
            (Spotlight + the shortcuts dialog below), not just decorative.
            Below ~640px this overlaps the same way Dashboard's own nav does — confirmed by
            testing Dashboard itself at that width, not just inferred — so it's a pre-existing
            issue shared with the main app, not something introduced here; not fixed in either
            place for now. */}
        <nav className="h-16 shrink-0 z-30 backdrop-blur-xl bg-white/70 dark:bg-[#1e1e1e]/60 amoled:dark:bg-black/60 border-b border-white/40 dark:border-white/10 grid grid-cols-[1fr_auto_1fr] items-center px-2 gap-1">
          <div className="flex items-center min-w-0">
            <button
              onClick={() => navigate('/')}
              className="md-btn flex items-center shrink-0 p-1 -m-1 rounded"
              aria-label="Home"
              title="Home"
            >
              <Logo className="h-6 w-auto text-gray-900 dark:text-white shrink-0" />
            </button>
          </div>

          <div className="relative flex items-center gap-1 justify-self-center">
            {NAV_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => navigate(tab.path)}
                className="md-btn relative h-10 px-5 rounded-lg text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 justify-self-end min-w-0">
            <button
              onClick={() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true })); }}
              className="md-btn hidden sm:flex items-center gap-2 h-9 px-3 lg:px-4 rounded text-xs font-medium border border-gray-300 dark:border-white/15 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              title={`Search (${mod}+K)`}
            >
              <Search className="h-4 w-4" />
              <span className="hidden lg:inline text-gray-400 dark:text-gray-500">Search…</span>
              <kbd className="hidden lg:inline ml-1 font-mono text-[10px] text-gray-400 dark:text-gray-500">{mod}+K</kbd>
            </button>

            <button
              onClick={() => setShowShortcuts(true)}
              className="md-btn p-2 rounded-full text-gray-600 dark:text-gray-400"
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts"
            >
              <Keyboard className="h-5 w-5" />
            </button>

            <button
              onClick={() => navigate('/settings')}
              className="md-btn p-2 rounded-full text-gray-600 dark:text-gray-400 ml-1"
              aria-label="Settings"
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </nav>

        {/* ── Content ─────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          <div className="min-h-full flex flex-col justify-center px-4 py-10">
            <div className="max-w-4xl w-full mx-auto space-y-5">

              {loading ? (
                <div className="space-y-5">
                  <div className="flex justify-center py-4 sm:py-6">
                    <div className="h-20 w-64 rounded-2xl bg-gray-300/50 dark:bg-white/10 animate-pulse" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                    {[0, 1, 2].map(i => <div key={i} className={`h-36 rounded-2xl animate-pulse ${GLASS}`} />)}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    {[0, 1].map(i => <div key={i} className={`h-28 rounded-2xl animate-pulse ${GLASS}`} />)}
                  </div>
                  <div className={`h-24 rounded-2xl animate-pulse ${GLASS}`} />
                </div>
              ) : error ? (
                <div className={`rounded-2xl px-5 py-6 text-center ${GLASS}`}>
                  <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
                  <button onClick={refetch} className="md-btn mt-2 text-xs font-medium underline text-gray-600 dark:text-gray-300">Retry</button>
                </div>
              ) : stats && (
                <>
                  {/* ── Hero ──────────────────────────────────────────────────── */}
                  {/* Deliberately not a card — just the number, floating over the animated
                      background. The gradient fill + drop-shadow give it depth/"shading"
                      instead of a flat color, and the shadow doubles as legibility insurance
                      against whatever's scrolling behind it (no glass scrim here to help). */}
                  <div className="text-center py-4 sm:py-6">
                    <div
                      className="text-7xl sm:text-8xl font-black leading-none tracking-tight tabular-nums bg-clip-text text-transparent bg-gradient-to-b from-gray-900 to-gray-500 dark:from-white dark:to-gray-400 drop-shadow-[0_8px_30px_rgba(0,0,0,0.25)] dark:drop-shadow-[0_0_45px_rgba(255,255,255,0.12)]"
                    >
                      {totalChannelsAnimated.toLocaleString()}
                    </div>
                    <p className="mt-3 text-base sm:text-lg font-medium text-gray-600 dark:text-gray-300">channels across your playlists, sources &amp; guides</p>
                  </div>

                  {/* ── Counts ────────────────────────────────────────────────── */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                    <StatCard
                      icon={<FileAudio className="h-5 w-5" style={{ color: accentColor }} />}
                      count={stats.playlistCount}
                      label="My Playlists"
                      secondary={`${stats.playlistChannelCount} channel${stats.playlistChannelCount === 1 ? '' : 's'} total`}
                      accentColor={accentColor}
                      onClick={() => navigate('/playlists')}
                    />
                    <StatCard
                      icon={<Layers className="h-5 w-5" style={{ color: accentColor }} />}
                      count={stats.channelPoolSourceCount}
                      label="Sources"
                      secondary={`${stats.channelPoolChannelCount.toLocaleString()} channel${stats.channelPoolChannelCount === 1 ? '' : 's'} available`}
                      accentColor={accentColor}
                      onClick={() => navigate('/sources')}
                    />
                    <StatCard
                      icon={<Radio className="h-5 w-5" style={{ color: accentColor }} />}
                      count={stats.epgSourceCount}
                      label="EPG Sources"
                      secondary={`${stats.epgChannelCount.toLocaleString()} channel${stats.epgChannelCount === 1 ? '' : 's'} with guide data`}
                      accentColor={accentColor}
                      onClick={() => navigate('/epg')}
                    />
                  </div>

                  {/* ── Activity ──────────────────────────────────────────────── */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div className={`rounded-2xl px-5 py-4 ${GLASS}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <Download className="h-4 w-4" style={{ color: accentColor }} />
                        <h2 className="text-sm font-medium text-gray-900 dark:text-white">Last Playlist Download</h2>
                      </div>
                      {stats.lastPlaylistDownload ? (
                        <p className="text-sm text-gray-600 dark:text-gray-400">{formatDateTime(stats.lastPlaylistDownload, is24Hour)}</p>
                      ) : (
                        <p className="text-sm text-gray-400 dark:text-gray-500">No playlist has been downloaded yet.</p>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        if (!additions) return;
                        setActiveChannelPoolSourceId(additions.sourceId);
                        navigate('/sources');
                      }}
                      disabled={!additions}
                      className={`md-btn text-left rounded-2xl px-5 py-4 transition-transform duration-200 ${additions ? 'hover:-translate-y-1' : 'cursor-default'} ${GLASS}`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="h-4 w-4" style={{ color: accentColor }} />
                        <h2 className="text-sm font-medium text-gray-900 dark:text-white">Latest New Channels from Sources</h2>
                      </div>
                      {additions ? (
                        <>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            <span className="font-medium text-gray-800 dark:text-gray-200">{additions.added.length}</span> new channel{additions.added.length === 1 ? '' : 's'} in <span className="font-medium text-gray-800 dark:text-gray-200">{additions.sourceName}</span>
                          </p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{formatDateTime(additions.timestamp, is24Hour)}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 truncate">
                            {additions.added.slice(0, 5).map(c => c.name).join(', ')}
                            {additions.added.length > 5 ? ` +${additions.added.length - 5} more` : ''}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-gray-400 dark:text-gray-500">No new channels found yet.</p>
                      )}
                    </button>
                  </div>

                  {/* ── Quick downloads ──────────────────────────────────────────── */}
                  <PlaylistDownloadsCard accentColor={accentColor} />
                </>
              )}

            </div>
          </div>
        </div>
      </div>

      {/* Same dialog as Dashboard's — verbatim, so the reference stays one list instead of
          drifting into two. It's a static, app-wide list rather than a per-page one (Dashboard
          shows it unchanged across all three of its own tabs too, including ones where a given
          shortcut doesn't apply), so reusing it here isn't inconsistent with how it behaves
          today. */}
      {showShortcuts && (
        <div className="md-scrim fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setShowShortcuts(false)}>
          <div className="md-dialog w-full max-w-sm bg-white dark:bg-[#272727] amoled:dark:bg-[#1a1a1a] rounded elev-24" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 dark:border-white/10">
              <h2 className="text-xl font-medium text-gray-900 dark:text-white">Keyboard Shortcuts</h2>
              <button onClick={() => setShowShortcuts(false)} className="md-btn p-1.5 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-1">
              {([
                [[mod, 'K'], 'Open search'],
                [[mod, 'A'], 'Select all channels in category'],
                [['Esc'], 'Clear selection'],
                [['Del'], 'Delete selected channels'],
                [['Space'], 'Toggle visibility of selected channels'],
                [[mod, 'Z'], 'Undo last destructive action'],
              ] as [string[], string][]).map(([keys, label]) => (
                <div key={label} className="flex items-center justify-between py-2.5 border-b border-gray-100 dark:border-white/8 last:border-0">
                  <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
                  <div className="flex items-center gap-1 shrink-0 ml-4">
                    {keys.map((k, i) => (
                      <React.Fragment key={k}>
                        {i > 0 && <span className="text-xs text-gray-400">+</span>}
                        <kbd className="inline-flex items-center px-2 py-1 rounded text-[11px] font-medium font-mono bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-white/15 shadow-sm">
                          {k}
                        </kbd>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-6 pb-5 pt-1">
              <p className="text-xs text-gray-400 dark:text-gray-500">Shortcuts are active when no text field is focused.</p>
            </div>
          </div>
        </div>
      )}

      <Spotlight onNavigate={handleSpotlightNavigate} />
      <Toast />
    </div>
  );
}
