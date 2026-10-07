import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api, SearchResult } from '../apiClient';
import { useStore, notifyError } from '../store';
import { Search, EyeOff, FileAudio, Layers, Radio } from 'lucide-react';
import ChannelLogo from './ChannelLogo';
import { useDebouncedValue } from '../utils/useDebouncedValue';
import { foldText } from '../utils/foldText';

// Level-1 grouping metadata, in the fixed display order the hierarchy always uses —
// My Playlists, then Sources, then EPG — regardless of which kind has the most hits.
// Icons mirror the ones Dashboard already uses for each tab's empty state/sidebar
// section, so a result's origin is recognizable at a glance.
const KIND_META: Record<SearchResult['kind'], { label: string; icon: typeof Search }> = {
  playlist: { label: 'My Playlists', icon: FileAudio },
  channelPool: { label: 'Sources', icon: Layers },
  epg: { label: 'EPG', icon: Radio },
};
const KIND_ORDER: SearchResult['kind'][] = ['playlist', 'channelPool', 'epg'];

interface CategoryGroup {
  category: string | null;
  items: SearchResult[];
}
interface ContainerGroup {
  containerId: string;
  containerName: string;
  categories: CategoryGroup[];
}
interface KindGroup {
  kind: SearchResult['kind'];
  containers: ContainerGroup[];
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
      <mark className="bg-transparent font-semibold" style={{ color: 'inherit' }}>
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </>
  );
}

export default function Spotlight({ onNavigate }: {
  onNavigate: (result: SearchResult) => void;
}) {
  const { accentColor, logoBgColor } = useStore();
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

  // Group results into a 3-level tree — kind → container → category — in that fixed
  // kind order, then flatten back out in the same order the tree renders in. Keyboard
  // nav/activeIndex walk `orderedResults` rather than the raw `results` from the API:
  // the API can interleave items from different playlists/sources (channels are appended
  // to a flat array as they're created), so without this, arrow-key highlighting could
  // jump to a result that isn't actually next on screen.
  const groups: KindGroup[] = [];
  for (const kind of KIND_ORDER) {
    const containers: ContainerGroup[] = [];
    for (const r of results) {
      if (r.kind !== kind) continue;
      let container = containers.find(c => c.containerId === r.containerId);
      if (!container) {
        container = { containerId: r.containerId, containerName: r.containerName, categories: [] };
        containers.push(container);
      }
      let catGroup = container.categories.find(c => c.category === r.category);
      if (!catGroup) {
        catGroup = { category: r.category, items: [] };
        container.categories.push(catGroup);
      }
      catGroup.items.push(r);
    }
    if (containers.length > 0) groups.push({ kind, containers });
  }
  const orderedResults = groups.flatMap(g => g.containers.flatMap(c => c.categories.flatMap(cat => cat.items)));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => i === -1 ? 0 : Math.min(i + 1, orderedResults.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => i === -1 ? 0 : Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && orderedResults[activeIndex]) select(orderedResults[activeIndex]);
    else if (e.key === 'Escape') close();
  };

  if (!open) return null;

  return (
    <div
      className="md-scrim fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] px-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        className="md-dialog-top w-full max-w-xl bg-white/90 dark:bg-[#1e1e1e]/95 amoled:dark:bg-[#111]/95 rounded-2xl overflow-hidden"
        style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(0,0,0,0.08)' }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200/70 dark:border-white/8">
          <Search className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search channels, URLs, TVG IDs…"
            className="flex-1 bg-transparent text-base text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none"
          />
          {loading && (
            <svg className="h-4 w-4 shrink-0 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium font-mono bg-gray-100 dark:bg-white/10 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-white/10">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[54vh] overflow-y-auto overscroll-contain">
          {!query.trim() ? (
            <div className="flex flex-col items-center justify-center py-10 text-sm text-gray-400 dark:text-gray-500 gap-2">
              <Search className="h-8 w-8 opacity-30" />
              <span>Type to search across playlists, sources &amp; EPG</span>
            </div>
          ) : results.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center py-10 text-sm text-gray-400 dark:text-gray-500 gap-2">
              <span>No results for <strong className="text-gray-600 dark:text-gray-300">"{query}"</strong></span>
            </div>
          ) : (
            <div className="pb-2">
              {groups.map(({ kind, containers }) => {
                const { label, icon: KindIcon } = KIND_META[kind];
                return (
                  <div key={kind}>
                    {/* Level 1: which tab this came from. Sticky headers stack — each
                        level pins directly below the one(s) above it (top-0/top-10/top-18
                        match the h-10/h-8/h-8 heights exactly) — and since every header
                        sits as the first child of the div that also wraps the rest of
                        its own group's content, it naturally scrolls away the moment
                        that group ends and the next one's header takes its place. All
                        three share the same left padding rather than staggering deeper —
                        weight/case/color carry the hierarchy instead of indentation, so
                        they stay easy to read at a glance. */}
                    <div className="sticky top-0 z-30 flex items-center gap-2 h-10 px-5 text-sm font-bold uppercase tracking-wide text-gray-700 dark:text-gray-200 bg-white/90 dark:bg-[#1e1e1e]/95 amoled:dark:bg-[#111]/95 border-b border-gray-200/70 dark:border-white/8">
                      <KindIcon className="h-4 w-4" />
                      {label}
                    </div>
                    {containers.map(container => (
                      <div key={container.containerId}>
                        {/* Level 2: the specific playlist / source / EPG source */}
                        <div className="sticky top-10 z-20 flex items-center h-8 px-5 text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300 bg-white/90 dark:bg-[#1e1e1e]/95 amoled:dark:bg-[#111]/95 border-b border-gray-200/70 dark:border-white/8">
                          {container.containerName}
                        </div>
                        {container.categories.map(catGroup => (
                          <div key={catGroup.category ?? '_none'}>
                            {/* Level 3: category within that playlist/source — EPG
                                sources have no categories, so catGroup.category is
                                always null there and this header is skipped. */}
                            {catGroup.category && (
                              <div className="sticky top-18 z-10 flex items-center h-8 px-5 text-sm font-medium text-gray-500 dark:text-gray-400 bg-white/90 dark:bg-[#1e1e1e]/95 amoled:dark:bg-[#111]/95 border-b border-gray-200/70 dark:border-white/8">
                                {catGroup.category}
                              </div>
                            )}
                            {catGroup.items.map(r => {
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
                                  className="flex items-center gap-3 mx-2 px-3 py-2.5 rounded-xl cursor-pointer transition-colors"
                                  style={isActive ? { backgroundColor: `${accentColor}18` } : undefined}
                                >
                                  {/* Logo — same fallback-to-initials component used in
                                      the Sources/EPG list views, for visual consistency. */}
                                  <ChannelLogo
                                    logo={r.logo}
                                    name={r.name}
                                    logoBgColor={logoBgColor}
                                    className="w-9 h-7 shrink-0 rounded border border-gray-200/60 dark:border-white/8"
                                  />

                                  {/* Text */}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className={`text-sm font-medium truncate ${isActive ? '' : 'text-gray-900 dark:text-white'}`} style={isActive ? { color: accentColor } : undefined}>
                                        {highlight(r.name || 'Unnamed', query)}
                                      </span>
                                      {r.isHidden && <EyeOff className="h-3 w-3 shrink-0 text-amber-500" />}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      {r.url && (
                                        <span className="text-[11px] font-mono text-gray-400 dark:text-gray-500 truncate">
                                          {highlight(r.url, query)}
                                        </span>
                                      )}
                                      {r.tvgId && (
                                        <span className="shrink-0 text-[10px] font-mono px-1.5 py-px rounded bg-gray-100 dark:bg-white/8 text-gray-500 dark:text-gray-400">
                                          {highlight(r.tvgId, query)}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        {results.length > 0 && (
          <div className="flex items-center gap-3 px-5 py-2.5 border-t border-gray-200/70 dark:border-white/8 text-[11px] text-gray-400 dark:text-gray-500">
            <span><kbd className="font-mono">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono">↵</kbd> open</span>
            <span className="ml-auto">{results.length} result{results.length !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>
    </div>
  );
}
