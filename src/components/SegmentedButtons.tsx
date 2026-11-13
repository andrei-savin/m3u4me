import type { CSSProperties, ReactNode } from 'react';
import Icon from './Icon';

/**
 * Material 3 segmented buttons: a row of 2–4 choices joined into one outlined pill, the chosen
 * one filled and ticked. Used for small either/or settings (theme, font, Find and Replace's
 * field, importing from a link or a file).
 */
export default function SegmentedButtons<T extends string>({
  options,
  value,
  onChange,
  className = '',
}: {
  options: { value: T; label: ReactNode; style?: CSSProperties }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`flex h-10 rounded-full border border-outline overflow-hidden ${className}`} role="radiogroup">
      {options.map(option => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`md-btn flex-1 min-w-0 flex items-center justify-center gap-1.5 px-3 text-label-lg border-r border-outline last:border-r-0 ${
              selected ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface'
            }`}
            style={option.style}
          >
            {selected && <Icon name="check" className="text-[18px]" />}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
