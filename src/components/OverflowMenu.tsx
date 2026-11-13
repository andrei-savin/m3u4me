import { useState, useEffect, type ReactNode, type CSSProperties } from 'react';
import Icon from './Icon';

export interface OverflowMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  /** Shown in red, for actions that remove something. */
  danger?: boolean;
  /** Small grey text on the right, e.g. a count. */
  hint?: string;
}

/**
 * The ⋮ "more" button and its little menu, used on phones where there's no room
 * for every action as its own button (top bar, playlist toolbar, selection bar).
 *
 * Rows are 48px tall so they're easy to hit with a thumb. A transparent layer
 * behind the menu catches the tap that closes it, the same way the stream
 * health-check menu in PlaylistEditor does. `openUp` opens it above the button,
 * for bars that sit at the bottom of the screen.
 */
export default function OverflowMenu({
  items,
  openUp = false,
  label = 'More actions',
  buttonClassName = 'text-on-surface-variant',
  buttonStyle,
  showDot = false,
}: {
  items: (OverflowMenuItem | false | null | undefined)[];
  openUp?: boolean;
  label?: string;
  buttonClassName?: string;
  // For a color that has to be inline (e.g. readable text on the accent-colored toolbar).
  buttonStyle?: CSSProperties;
  // Shows a small dot on the ⋮ button, e.g. when the sync log has news.
  showDot?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Escape closes it, like every other menu and dialog (the ⋮ menus also show with a keyboard,
  // e.g. on tablets and in the playlist header).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  // Callers can leave out items with `cond && {…}`, so drop the gaps here.
  const visibleItems = items.filter((item): item is OverflowMenuItem => !!item);
  if (visibleItems.length === 0) return null;

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className={`md-btn icon-btn ${buttonClassName}`}
        style={buttonStyle}
        aria-label={label}
        title={label}
      >
        <Icon name="more_vert" className="text-[24px]" />
        {showDot && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`md-menu menu absolute right-0 ${openUp ? 'bottom-full mb-1 origin-bottom' : 'top-full mt-1'} z-50 min-w-56 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-6rem)] overflow-y-auto`}
          >
            {visibleItems.map(item => (
              <button
                key={item.label}
                onClick={() => { setOpen(false); item.onClick(); }}
                className={`md-btn menu-item ${item.danger ? 'text-error' : ''}`}
              >
                {item.icon && <span className={`shrink-0 flex ${item.danger ? '' : 'text-on-surface-variant'}`}>{item.icon}</span>}
                <span className="flex-1 truncate">{item.label}</span>
                {item.hint && <span className="shrink-0 text-label-md text-on-surface-variant">{item.hint}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
