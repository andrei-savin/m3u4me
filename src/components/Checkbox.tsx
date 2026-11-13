import Icon from './Icon';

/**
 * The Material 3 checkbox look (a small rounded square, filled with the primary colour when
 * ticked). It's only the picture: put it inside the button or label that handles the click,
 * which keeps every existing click and keyboard behaviour exactly as it was.
 * `mixed` shows a dash, for "some of these are selected".
 */
export default function Checkbox({ checked, mixed = false, className = '' }: { checked: boolean; mixed?: boolean; className?: string }) {
  const on = checked || mixed;
  return (
    <span className={`checkbox ${on ? 'checkbox-on' : ''} ${className}`} aria-hidden="true">
      {mixed ? <Icon name="remove" className="text-[16px] font-bold" /> : checked ? <Icon name="check" className="text-[16px] font-bold" /> : null}
    </span>
  );
}
