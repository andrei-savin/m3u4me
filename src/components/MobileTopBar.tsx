import type { ReactNode } from 'react';
import OverflowMenu, { type OverflowMenuItem } from './OverflowMenu';
import Icon from './Icon';

/** Opens Spotlight search, the same way the desktop Search button does (Spotlight listens for Cmd/Ctrl+K). */
export function openSpotlight() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
}

/**
 * The top bar on phones (below 768px), shared by Dashboard, Home and Settings. The
 * desktop top bar doesn't fit a phone, so those screens hide theirs with
 * `hidden md:grid` and show this one instead; the tabs move to MobileTabBar at the
 * bottom of the screen.
 *
 * It's the only bar at the top of a phone screen, and every button has one job:
 * ☰ opens the drawer (the one way to switch playlist, category, source or guide),
 * the title only says where you are (`overline` is a small line above it, e.g. the
 * playlist above its category), Search searches, and ⋮ holds this screen's actions.
 *
 * The ⋮ menu comes either from `menuItems`, or from the screen below the bar: the
 * playlist editor puts its own ⋮ menu into the empty spot `menuSlotRef` points to
 * (a React portal), because the editor is what knows those actions.
 */
export default function MobileTopBar({
  title,
  overline,
  leading,
  onMenu,
  menuItems = [],
  menuSlotRef,
  showSearch = true,
  surfaceClassName = 'bg-page',
}: {
  title?: string;
  overline?: string;
  leading?: ReactNode;
  onMenu?: () => void;
  menuItems?: (OverflowMenuItem | false | null | undefined)[];
  menuSlotRef?: (el: HTMLDivElement | null) => void;
  showSearch?: boolean;
  /** Background of the bar. Home passes its frosted-glass look instead. */
  surfaceClassName?: string;
}) {
  // z-40: above panels that open over the page below it (the sync log is z-30), so the ⋮
  // menu drops down over them instead of behind. Still under the drawer, sheets and dialogs (z-50).
  return (
    <header className={`md:hidden shrink-0 z-40 pt-safe ${surfaceClassName}`}>
      <div className="h-16 flex items-center gap-0.5 px-1">
        {onMenu && (
          <button
            onClick={onMenu}
            className="md-btn icon-btn w-12 h-12 text-on-surface"
            aria-label="Open the list"
          >
            <Icon name="menu" className="text-[24px]" />
          </button>
        )}
        <div className={`flex-1 min-w-0 flex flex-col justify-center ${onMenu ? '' : 'pl-3'}`}>
          {leading ?? (
            <>
              {overline && <p className="text-label-md text-on-surface-variant truncate">{overline}</p>}
              <h1 className={`${overline ? 'text-xl leading-[26px] font-medium' : 'text-title-lg'} tracking-[-0.01em] text-on-surface truncate`}>{title}</h1>
            </>
          )}
        </div>
        {showSearch && (
          <button
            onClick={openSpotlight}
            className="md-btn icon-btn w-12 h-12 text-on-surface"
            aria-label="Search"
          >
            <Icon name="search" className="text-[24px]" />
          </button>
        )}
        <OverflowMenu items={menuItems} buttonClassName="w-12 h-12 text-on-surface" />
        {menuSlotRef && <div ref={menuSlotRef} className="flex shrink-0" />}
      </div>
    </header>
  );
}
