import type { ReactNode } from 'react';
import Dialog from './Dialog';

/**
 * A Material 3 "are you sure?" dialog: a title, a message, and Cancel plus one confirm button
 * on the right. `danger` colours the confirm button red, for deleting things. Render it only
 * while it should be open, like Dialog.
 */
export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
  danger = false,
  confirmDisabled = false,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  danger?: boolean;
  confirmDisabled?: boolean;
}) {
  return (
    <Dialog onClose={onClose}>
      <h2 className="text-headline-sm text-on-surface px-6 pt-6 pb-4">{title}</h2>
      <div className="text-body-md text-on-surface-variant px-6 pb-6">{children}</div>
      <div className="flex justify-end gap-2 px-6 pb-6">
        <button onClick={onClose} className="md-btn btn btn-text">Cancel</button>
        <button
          onClick={onConfirm}
          disabled={confirmDisabled}
          className={`md-btn btn btn-text ${danger ? 'text-error' : ''}`}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
