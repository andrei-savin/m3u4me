import { useNavigate } from 'react-router-dom';
import { usePlaylists } from '../apiClient';
import Icon from './Icon';

export type MobileTab = 'home' | 'playlists' | 'sources' | 'epg' | 'settings';

const TABS: { id: MobileTab; label: string; path: string; icon: string }[] = [
  { id: 'home', label: 'Home', path: '/', icon: 'home' },
  { id: 'playlists', label: 'Playlists', path: '/playlists', icon: 'queue_music' },
  { id: 'sources', label: 'Sources', path: '/sources', icon: 'stacks' },
  { id: 'epg', label: 'EPG', path: '/epg', icon: 'live_tv' },
  { id: 'settings', label: 'Settings', path: '/settings', icon: 'settings' },
];

/**
 * The tab bar along the bottom of the screen on phones, in thumb reach. It replaces the
 * desktop top bar's tabs and Settings button. Only rendered on phones (callers check
 * useIsPhone), so computers don't fetch the playlist list a second time for the dot.
 *
 * It sits in the page's normal flow as the last row of the screen, not `fixed`, so the
 * content above simply ends where it starts. The bars that appear while something is
 * selected are `fixed` and cover it on purpose, like Android's own selection bars.
 */
export default function MobileTabBar({
  active,
  surfaceClassName = 'bg-page',
}: {
  active: MobileTab;
  /** Background of the bar. Home passes its frosted-glass look instead. */
  surfaceClassName?: string;
}) {
  const navigate = useNavigate();
  const { playlists } = usePlaylists();
  // Same dot as the desktop My Playlists tab: a channel has a change from its source waiting.
  const pendingSyncTotal = playlists.reduce((sum, p) => sum + (p.pendingSyncCount || 0), 0);

  return (
    <nav className={`md:hidden shrink-0 z-30 pb-safe ${surfaceClassName}`}>
      <div className="h-16 grid grid-cols-5">
        {TABS.map(({ id, label, path, icon }) => {
          const isActive = id === active;
          return (
            <button
              key={id}
              onClick={() => { if (!isActive) navigate(path); }}
              className={`flex flex-col items-center justify-center gap-1 text-label-md ${isActive ? 'text-on-surface font-semibold' : 'text-on-surface-variant'}`}
              aria-current={isActive ? 'page' : undefined}
            >
              {/* The active tab's icon sits in a pill, Material 3 style. */}
              <span
                className={`relative flex items-center justify-center w-14 h-8 rounded-full transition-colors ${isActive ? 'bg-secondary-container text-on-secondary-container' : ''}`}
              >
                <Icon name={icon} filled={isActive} />
                {id === 'playlists' && pendingSyncTotal > 0 && (
                  <span
                    className="absolute top-1 right-3 w-1.5 h-1.5 rounded-full bg-primary"
                    aria-label="Changes from a source are waiting"
                  />
                )}
              </span>
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
