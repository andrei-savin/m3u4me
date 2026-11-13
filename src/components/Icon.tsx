import type { CSSProperties } from 'react';

/**
 * One Material Symbols icon (the rounded set), e.g. `<Icon name="delete" />`.
 *
 * The icons are a font: the icon's name is typed as text and the font draws the picture
 * for it (see `.icon` in index.css; the font is bundled, so it works offline). Names are the
 * ones on https://fonts.google.com/icons, in snake_case: "visibility_off", "drag_indicator"…
 *
 * - Size: 24px unless a font-size class says otherwise, e.g. `className="text-[20px]"`
 *   (20px in dense rows and buttons, 24px in 40px+ round buttons).
 * - Colour: the surrounding text colour, or a `text-…` class.
 * - `filled` draws the solid version, for the current tab.
 * - It's decoration by default (hidden from screen readers); pass `aria-label` when the icon
 *   alone carries meaning.
 */
export default function Icon({
  name,
  className = '',
  filled = false,
  title,
  style,
  'aria-label': ariaLabel,
}: {
  key?: string | number;
  name: string;
  className?: string;
  filled?: boolean;
  title?: string;
  style?: CSSProperties;
  'aria-label'?: string;
}) {
  return (
    <span
      className={`icon ${filled ? 'icon-filled' : ''} ${className}`}
      title={title}
      style={style}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      role={ariaLabel ? 'img' : undefined}
      // Browsers' page translation would otherwise "translate" the icon's name and break it.
      translate="no"
    >
      {name}
    </span>
  );
}
