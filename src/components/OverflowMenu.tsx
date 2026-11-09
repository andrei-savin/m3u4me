import { useState, type ReactNode, type CSSProperties } from 'react';
import { MoreVertical } from 'lucide-react';

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
  buttonClassName = 'text-gray-600 dark:text-gray-300',
  buttonStyle,
  dotColor,
}: {
  items: (OverflowMenuItem | false | null | undefined)[];
  openUp?: boolean;
  label?: string;
  buttonClassName?: string;
  // For a color that has to be inline (e.g. readable text on the accent-colored toolbar).
  buttonStyle?: CSSProperties;
  // Shows a small dot on the ⋮ button in this color, e.g. when the sync log has news.
  dotColor?: string;
}) {
  const [open, setOpen] = useState(false);
  // Callers can leave out items with `cond && {…}`, so drop the gaps here.
  const visibleItems = items.filter((item): item is OverflowMenuItem => !!item);
  if (visibleItems.length === 0) return null;

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className={`md-btn w-10 h-10 flex items-center justify-center rounded-full ${buttonClassName}`}
        style={buttonStyle}
        aria-label={label}
        title={label}
      >
        <MoreVertical className="h-5 w-5" />
        {dotColor && <span className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ backgroundColor: dotColor }} />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`md-menu absolute right-0 ${openUp ? 'bottom-full mb-1 origin-bottom' : 'top-full mt-1'} z-50 min-w-56 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-6rem)] overflow-y-auto py-1 rounded bg-white dark:bg-[#272727] amoled:dark:bg-[#1a1a1a] elev-8 text-sm`}
          >
            {visibleItems.map(item => (
              <button
                key={item.label}
                onClick={() => { setOpen(false); item.onClick(); }}
                className={`md-btn w-full h-12 flex items-center gap-3 px-4 text-left ${item.danger ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'}`}
              >
                {item.icon && <span className={`shrink-0 flex ${item.danger ? '' : 'text-gray-400 dark:text-gray-500'}`}>{item.icon}</span>}
                <span className="flex-1 truncate">{item.label}</span>
                {item.hint && <span className="shrink-0 text-xs text-gray-400">{item.hint}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
