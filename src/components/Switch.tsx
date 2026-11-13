import Icon from './Icon';

/**
 * Material 3 switch: a 52×32 track whose handle grows and shows a tick when it's on.
 * A real <button role="switch">, so keyboard and screen readers work; `label` is what
 * a screen reader announces (the visible text next to it is usually the same words).
 */
export default function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex items-center w-[52px] h-8 shrink-0 rounded-full border-2 cursor-pointer transition-colors duration-200 disabled:opacity-40 disabled:cursor-default focus-visible:outline-3 focus-visible:outline-secondary focus-visible:outline-offset-2 ${
        checked ? 'bg-primary border-primary' : 'bg-surface-container-highest border-outline'
      }`}
    >
      <span
        className={`absolute flex items-center justify-center rounded-full transition-all duration-200 ease-[var(--md-standard)] ${
          checked ? 'left-[22px] w-6 h-6 bg-on-primary text-primary' : 'left-[6px] w-4 h-4 bg-outline'
        }`}
      >
        {checked && <Icon name="check" className="text-[16px] font-bold" />}
      </span>
    </button>
  );
}
