import { useNavigate } from 'react-router-dom';
import { Home, FileAudio, Layers, Radio, Settings } from 'lucide-react';
import { usePlaylists } from '../apiClient';
import { useStore, accentAlpha } from '../store';

export type MobileTab = 'home' | 'playlists' | 'sources' | 'epg' | 'settings';

const TABS: { id: MobileTab; label: string; path: string; Icon: typeof Home }[] = [
  { id: 'home', label: 'Home', path: '/', Icon: Home },
  { id: 'playlists', label: 'Playlists', path: '/playlists', Icon: FileAudio },
  { id: 'sources', label: 'Sources', path: '/sources', Icon: Layers },
  { id: 'epg', label: 'EPG', path: '/epg', Icon: Radio },
  { id: 'settings', label: 'Settings', path: '/settings', Icon: Settings },
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
  surfaceClassName = 'bg-white dark:bg-[#1e1e1e] amoled:dark:bg-[#0a0a0a] border-t border-gray-200 dark:border-white/8',
}: {
  active: MobileTab;
  /** Background of the bar. Home passes its frosted-glass look instead. */
  surfaceClassName?: string;
}) {
  const navigate = useNavigate();
  const { accentColor } = useStore();
  const { playlists } = usePlaylists();
  // Same dot as the desktop My Playlists tab: a channel has a change from its source waiting.
  const pendingSyncTotal = playlists.reduce((sum, p) => sum + (p.pendingSyncCount || 0), 0);

  return (
    <nav className={`md:hidden shrink-0 z-30 pb-safe ${surfaceClassName}`}>
      <div className="h-16 grid grid-cols-5">
        {TABS.map(({ id, label, path, Icon }) => {
          const isActive = id === active;
          return (
            <button
              key={id}
              onClick={() => { if (!isActive) navigate(path); }}
              className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${isActive ? '' : 'text-gray-500 dark:text-gray-400'}`}
              style={isActive ? { color: accentColor } : undefined}
              aria-current={isActive ? 'page' : undefined}
            >
              {/* The active tab's icon sits in a tinted pill, Android style. */}
              <span
                className="relative flex items-center justify-center w-14 h-8 rounded-full transition-colors"
                style={isActive ? { backgroundColor: accentAlpha(accentColor, '1f') } : undefined}
              >
                <Icon className="h-5 w-5" />
                {id === 'playlists' && pendingSyncTotal > 0 && (
                  <span
                    className="absolute top-1 right-3 w-2 h-2 rounded-full"
                    style={{ backgroundColor: accentColor }}
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
