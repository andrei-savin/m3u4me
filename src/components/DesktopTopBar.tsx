import { useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from './Logo';
import { openSpotlight } from './MobileTopBar';
import Icon from './Icon';

const TABS = [
  { key: 'playlists', label: 'My Playlists', path: '/playlists' },
  { key: 'channels', label: 'Sources', path: '/sources' },
  { key: 'epg', label: 'EPG', path: '/epg' },
] as const;

export type DesktopTab = typeof TABS[number]['key'];

/**
 * The top bar on tablets and computers (768px and wider), shared by Dashboard and Home so it
 * sits in exactly the same place on both and nothing jumps when you move between them.
 * Phones hide it and use MobileTopBar + MobileTabBar instead.
 *
 * Left: ☰ (only where there's a list to open, i.e. not on Home) and the logo, which goes Home.
 * Middle: the three tabs, Material 3 style (the current one in the primary colour with a short
 * underline that slides between tabs). Right: search, keyboard shortcuts (not on touch
 * screens) and Settings.
 *
 * The middle column is an `auto` track between two equal `1fr` tracks, so the tabs stay
 * centred on the whole bar whatever the sides hold.
 */
export default function DesktopTopBar({
  active,
  onMenu,
  onShortcuts,
  pendingSyncCount = 0,
  surfaceClassName = 'bg-page',
}: {
  /** The current tab; Home passes nothing, so no tab is underlined. */
  active?: DesktopTab;
  onMenu?: () => void;
  onShortcuts: () => void;
  /** Channels with a change from their source waiting: shown as a dot on My Playlists. */
  pendingSyncCount?: number;
  /** Background of the bar. Home passes its frosted-glass look instead. */
  surfaceClassName?: string;
}) {
  const navigate = useNavigate();
  const isMac = /mac/i.test(navigator.platform);

  // The underline is one element that slides and resizes to the current tab's label,
  // instead of each tab popping its own in and out.
  const tabsRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const update = () => {
      const label = active ? labelRefs.current[active] : null;
      const container = tabsRef.current;
      if (!label || !container) { setIndicator(null); return; }
      const labelBox = label.getBoundingClientRect();
      const containerBox = container.getBoundingClientRect();
      setIndicator({ left: labelBox.left - containerBox.left, width: labelBox.width });
    };
    update();
    // The labels change width once the web font has loaded.
    document.fonts?.ready.then(update);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [active]);

  return (
    <nav className={`h-16 shrink-0 z-40 hidden md:grid grid-cols-[1fr_auto_1fr] items-center pl-2 pr-3 gap-2 ${surfaceClassName}`}>
      <div className="flex items-center gap-1 min-w-0">
        {onMenu && (
          <button onClick={onMenu} className="md-btn icon-btn w-12 h-12 text-on-surface" aria-label="Show or hide the list">
            <Icon name="menu" className="text-[24px]" />
          </button>
        )}
        <button
          onClick={() => navigate('/')}
          className={`md-btn flex items-center shrink-0 h-10 px-2 rounded-full ${onMenu ? '' : 'ml-2'}`}
          aria-label="Home"
          title="Home"
        >
          <Logo className="h-[22px] w-auto text-on-surface shrink-0" />
        </button>
      </div>

      <div ref={tabsRef} className="relative flex items-center justify-self-center">
        {TABS.map(tab => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              onClick={() => { if (!isActive) navigate(tab.path); }}
              className={`md-btn relative h-16 px-4 lg:px-5 text-title-sm transition-colors ${isActive ? 'text-primary font-semibold' : 'text-on-surface-variant hover:text-on-surface'}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <span ref={el => { labelRefs.current[tab.key] = el; }}>{tab.label}</span>
              {tab.key === 'playlists' && pendingSyncCount > 0 && (
                <span
                  className="absolute top-4 right-1.5 lg:right-2 w-1.5 h-1.5 rounded-full bg-primary"
                  title={`${pendingSyncCount} channel${pendingSyncCount !== 1 ? 's have' : ' has'} changes from a source waiting for you`}
                />
              )}
            </button>
          );
        })}
        {indicator && (
          <div
            className="absolute bottom-0 h-[3px] rounded-t-full bg-primary transition-[left,width] duration-[250ms] ease-[var(--md-standard)]"
            style={{ left: indicator.left, width: indicator.width }}
          />
        )}
      </div>

      <div className="flex items-center justify-self-end gap-0.5 min-w-0">
        {/* A full search field on wide screens; just the magnifying glass on tablets. */}
        <button
          onClick={openSpotlight}
          className="md-btn hidden lg:flex items-center gap-2.5 h-10 w-60 xl:w-72 pl-3.5 pr-2.5 mr-1.5 rounded-full bg-search text-on-surface-variant"
          title={`Search (${isMac ? 'Cmd' : 'Ctrl'}+K)`}
        >
          <Icon name="search" className="text-[20px] shrink-0" />
          <span className="flex-1 text-left text-body-md">Search</span>
          <kbd className="font-mono text-label-sm px-1.5 rounded-md border border-outline-variant">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
        <button onClick={openSpotlight} className="md-btn icon-btn lg:hidden" aria-label="Search" title={`Search (${isMac ? 'Cmd' : 'Ctrl'}+K)`}>
          <Icon name="search" className="text-[24px]" />
        </button>
        {/* Not on touch screens (an iPad without a keyboard), where it would be a button for
            something that can't be used. */}
        <button onClick={onShortcuts} className="md-btn icon-btn no-hover:hidden" aria-label="Keyboard shortcuts" title="Keyboard shortcuts">
          <Icon name="keyboard" className="text-[24px]" />
        </button>
        <button onClick={() => navigate('/settings')} className="md-btn icon-btn" aria-label="Settings" title="Settings">
          <Icon name="settings" className="text-[24px]" />
        </button>
      </div>
    </nav>
  );
}
