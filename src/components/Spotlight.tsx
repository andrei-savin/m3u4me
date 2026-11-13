import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api, SearchResult } from '../apiClient';
import { useStore, notifyError } from '../store';
import ChannelLogo from './ChannelLogo';
import { useDebouncedValue } from '../utils/useDebouncedValue';
import { foldText } from '../utils/foldText';
import Icon from './Icon';

// The first step of each result path, in the fixed display order groups always use —
// My Playlists, then Sources, then EPG — regardless of which kind has the most hits.
// Icons mirror the ones Dashboard already uses for each tab's empty state/sidebar
// section, so a result's origin is recognizable at a glance.
const KIND_META: Record<SearchResult['kind'], { label: string; icon: string }> = {
  playlist: { label: 'My Playlists', icon: 'queue_music' },
  channelPool: { label: 'Sources', icon: 'stacks' },
  epg: { label: 'EPG', icon: 'live_tv' },
};
const KIND_ORDER: SearchResult['kind'][] = ['playlist', 'channelPool', 'epg'];

// One group per place a result lives in: kind → container → category, shown as a single
// Finder-style path line ("My Playlists › LynkTV › Anglia") instead of three stacked headers.
interface ResultGroup {
  key: string;
  kind: SearchResult['kind'];
  containerName: string;
  category: string | null;
  items: SearchResult[];
}

// "https://" in front of every stream link is noise when skimming, so it's left out —
// unless the match is in that part (a search for "http"), so the bold still has letters to land on.
function displayUrl(url: string, query: string) {
  const short = url.replace(/^https?:\/\//i, '');
  return foldText(short).includes(foldText(query.trim())) ? short : url;
}

// Whether the search found the query in this text, the same way the server does
// (accent-insensitive, ignoring spaces around the query).
function matchesQuery(text: string | null, query: string) {
  const q = foldText(query.trim());
  return !!text && !!q && foldText(text).includes(q);
}

// The search is accent-insensitive ("stiri" finds "Știri"), so the match is looked up in a
// folded copy of the text. Each character is folded on its own and `origin` remembers which
// original character every folded one came from, so the bold part lands on the right letters
// even when folding changes the length.
function highlight(text: string, query: string) {
  const foldedQuery = foldText(query);
  if (!foldedQuery) return <>{text}</>;
  let folded = '';
  const origin: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = foldText(text[i]);
    folded += f;
    for (let j = 0; j < f.length; j++) origin.push(i);
  }
  const idx = folded.indexOf(foldedQuery);
  if (idx === -1) return <>{text}</>;
  const start = origin[idx];
  const end = origin[idx + foldedQuery.length - 1] + 1;
  return (
    <>
      {text.slice(0, start)}
      {/* The match is bold and in the row's main text colour, so it stands out even in
          the quieter grey second line. Inside a highlighted row it follows that row's colour. */}
      <mark className="bg-transparent font-semibold text-[color:var(--match-color,inherit)]">
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </>
  );
}

export default function Spotlight({ onNavigate }: {
  onNavigate: (result: SearchResult) => void;
}) {
  const { logoBgColor } = useStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  // -1 means "nothing highlighted" — results start with no row picked out, rather than
  // defaulting to the first one, so the highlight only ever appears once the user actually
  // does something (hover a row or press an arrow key). Both hover and keyboard nav drive
  // this same index — there's only ever one highlighted row, never a hover highlight and a
  // separate "active" highlight showing at once.
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebouncedValue(query, 180);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setResults([]);
    setActiveIndex(-1);
  }, []);

  // Open on Cmd/Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [close]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  // Clears results immediately when the query is emptied, rather than waiting out the
  // debounce below; otherwise shows the loading spinner right away while it waits.
  useEffect(() => {
    if (!query.trim()) { setResults([]); setLoading(false); }
    else { setLoading(true); }
  }, [query]);

  // Debounced search
  useEffect(() => {
    if (!debouncedQuery.trim()) return;
    api.search(debouncedQuery).then(data => {
      setResults(data);
      setActiveIndex(-1);
    }).catch(e => {
      console.error(e);
      setResults([]);
      notifyError(e, 'Search failed.');
    }).finally(() => setLoading(false));
  }, [debouncedQuery]);

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex === -1) return;
    const el = listRef.current?.querySelector(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const select = (r: SearchResult) => {
    onNavigate(r);
    close();
  };

  // Group results by kind → container → category, in the fixed kind order, then flatten back
  // out in the same order the groups render in. Keyboard nav/activeIndex walk
  // `orderedResults` rather than the raw `results` from the API: the API can interleave items
  // from different playlists/sources (channels are appended to a flat array as they're
  // created), so without this, arrow-key highlighting could jump to a result that isn't
  // actually next on screen.
  const groups: ResultGroup[] = [];
  for (const kind of KIND_ORDER) {
    for (const r of results) {
      if (r.kind !== kind) continue;
      const key = `${kind}|${r.containerId}|${r.category ?? ''}`;
      let group = groups.find(g => g.key === key);
      if (!group) {
        group = { key, kind, containerName: r.containerName, category: r.category || null, items: [] };
        groups.push(group);
      }
      group.items.push(r);
    }
  }
  const orderedResults = groups.flatMap(g => g.items);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => i === -1 ? 0 : Math.min(i + 1, orderedResults.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => i === -1 ? 0 : Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && orderedResults[activeIndex]) select(orderedResults[activeIndex]);
    else if (e.key === 'Escape') close();
  };

  if (!open) return null;

  return (
    <div
      className="md-scrim fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] max-md:pt-[max(0.75rem,env(safe-area-inset-top))] px-4 max-md:px-2"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        // Material 3's search view: one rounded surface with the field on top and results below.
        className="md-dialog-top w-full max-w-xl bg-dialog text-on-surface rounded-[28px] overflow-hidden shadow-level-3"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 h-16 pl-5 pr-4 border-b border-outline-variant">
          <Icon name="search" className="text-[24px] shrink-0 text-on-surface-variant" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search channels, URLs, TVG IDs…"
            className="flex-1 min-w-0 bg-transparent text-body-lg text-on-surface placeholder:text-on-surface-variant focus:outline-none"
          />
          {loading && (
            <svg className="h-4 w-4 shrink-0 animate-spin text-on-surface-variant" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
          <kbd className="hidden sm:inline-flex items-center h-6 px-2 rounded-md text-label-sm font-mono border border-outline-variant text-on-surface-variant">
            Esc
          </kbd>
          {/* Phones have no Esc key, so they get a visible way out. */}
          <button
            onClick={close}
            className="md-btn btn btn-text md:hidden -mr-2"
          >
            Cancel
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[54vh] max-md:max-h-[45dvh] overflow-y-auto overscroll-contain">
          {!query.trim() ? (
            <div className="flex flex-col items-center justify-center py-10 text-body-md text-on-surface-variant gap-2">
              <Icon name="search" className="text-[32px] opacity-40" />
              <span>Type to search across playlists, sources &amp; EPG</span>
            </div>
          ) : results.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center py-10 text-body-md text-on-surface-variant gap-2">
              <span>No results for <strong className="font-semibold text-on-surface">"{query}"</strong></span>
            </div>
          ) : (
            <div className="pb-2">
              {groups.map(group => {
                const { label, icon } = KIND_META[group.kind];
                // EPG sources have no categories, and some pool entries have none either,
                // so the path is two or three steps long.
                const steps = [group.containerName || 'Untitled', ...(group.category ? [group.category] : [])];
                return (
                  // A little air between groups; the first one sits right under the field.
                  <div key={group.key} className="pt-2 first:pt-1">
                    {/* The path, like the bar at the bottom of a Finder window: where these
                        results live, read left to right. The tab name and its icon lead in
                        the accent colour, earlier steps are grey, the last step (the one the
                        rows sit in) is full strength. It pins to the top while its rows
                        scroll past, then the next group's path takes its place. The rows'
                        logos line up under the icon, the names under the text. */}
                    <div className="sticky top-0 z-10 flex items-center gap-1 h-10 px-5 bg-dialog text-label-lg text-on-surface-variant">
                      <Icon name={icon} className="text-[20px] shrink-0 text-primary mr-1" />
                      {/* Phones keep only the icon, so the playlist and category names get the room. */}
                      <span className="shrink-0 text-primary max-md:sr-only">{label}</span>
                      {steps.map((step, i) => (
                        <React.Fragment key={i}>
                          <Icon name="chevron_right" className="text-[18px] shrink-0 opacity-60" />
                          <span className={`truncate ${i === steps.length - 1 ? 'text-on-surface' : 'max-w-[45%]'}`}>{step}</span>
                        </React.Fragment>
                      ))}
                      <span className="ml-auto pl-3 shrink-0 text-label-md tabular-nums">{group.items.length}</span>
                    </div>
                    {group.items.map(r => {
                      const globalIdx = orderedResults.indexOf(r);
                      const isActive = globalIdx === activeIndex;
                      return (
                        <div
                          // Index rather than a data id: EPG sources can legitimately
                          // list the same channel id more than once (seen in practice —
                          // e.g. duplicate <channel id="bbcone.nl"> entries within one
                          // XMLTV source), so id-based keys aren't reliably unique. Rows
                          // are stateless and the whole list is rebuilt on every new
                          // search anyway, so the render-stable position is fine as a key.
                          key={globalIdx}
                          data-idx={globalIdx}
                          onMouseEnter={() => setActiveIndex(globalIdx)}
                          onMouseLeave={() => setActiveIndex(i => (i === globalIdx ? -1 : i))}
                          onClick={() => select(r)}
                          className={`flex items-center gap-3 mx-2 px-3 h-14 rounded-2xl cursor-pointer transition-colors ${isActive ? 'bg-secondary-container text-on-secondary-container [--match-color:var(--md-on-secondary-container)]' : '[--match-color:var(--md-on-surface)]'}`}
                        >
                          {/* Logo — same fallback-to-initials component used in the
                              Sources/EPG list views. Hidden channels are dimmed, like in
                              the playlist editor. */}
                          <ChannelLogo
                            logo={r.logo}
                            name={r.name}
                            logoBgColor={logoBgColor}
                            className={`w-12 h-8 shrink-0 rounded-md ${r.isHidden ? 'opacity-50' : ''}`}
                          />

                          {/* Name on top; underneath, only what the search found besides the
                              name — the TVG ID and/or the stream link — so the second line always
                              explains why a row is here. A row found by its name alone has just
                              the one line. */}
                          {(() => {
                            const tvgIdMatched = matchesQuery(r.tvgId, query);
                            const urlMatched = matchesQuery(r.url, query);
                            return (
                              <div className={`flex-1 min-w-0 ${r.isHidden ? 'opacity-60' : ''}`}>
                                <div className="flex items-center gap-1.5">
                                  <span className={`text-title-sm truncate ${isActive ? '' : 'text-on-surface'}`}>
                                    {highlight(r.name || 'Unnamed', query)}
                                  </span>
                                  {r.isHidden && <Icon name="visibility_off" className="text-[16px] shrink-0" aria-label="Hidden" />}
                                </div>
                                {(tvgIdMatched || urlMatched) && (
                                  <div className={`flex items-center gap-1.5 text-body-sm ${isActive ? 'opacity-80' : 'text-on-surface-variant'}`}>
                                    {tvgIdMatched && (
                                      <span className={`truncate min-w-0 ${urlMatched ? 'shrink max-w-[50%]' : 'flex-1'}`}>{highlight(r.tvgId!, query)}</span>
                                    )}
                                    {tvgIdMatched && urlMatched && <span className="shrink-0 opacity-60" aria-hidden>·</span>}
                                    {urlMatched && (
                                      <span className="flex-1 min-w-0 truncate">{highlight(displayUrl(r.url!, query), query)}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        {results.length > 0 && (
          <div className="flex items-center gap-3 px-5 h-10 border-t border-outline-variant text-label-md text-on-surface-variant">
            {/* Keyboard hints mean nothing on a phone; the result count stays. */}
            <span className="hidden md:inline"><kbd className="font-mono">↑↓</kbd> navigate</span>
            <span className="hidden md:inline"><kbd className="font-mono">↵</kbd> open</span>
            <span className="ml-auto">{results.length} result{results.length !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>
    </div>
  );
}
