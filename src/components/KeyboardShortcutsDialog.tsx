import React from 'react';
import Dialog from './Dialog';
import Icon from './Icon';

/** The keyboard shortcuts list, opened from the keyboard button in the desktop top bar. */
export default function KeyboardShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  const mod = /mac/i.test(navigator.platform) ? 'Cmd' : 'Ctrl';
  const shortcuts: [string[], string][] = [
    [[mod, 'K'], 'Open search'],
    [[mod, 'A'], 'Select all channels in category'],
    [['Esc'], 'Clear selection'],
    [['Del'], 'Delete selected channels'],
    [['Space'], 'Toggle visibility of selected channels'],
    [[mod, 'Z'], 'Undo last destructive action'],
  ];

  return (
    <Dialog onClose={onClose} maxWidth="max-w-md">
      <div className="flex items-center justify-between pl-6 pr-3 pt-4 pb-2">
        <h2 className="text-headline-sm text-on-surface">Keyboard shortcuts</h2>
        <button onClick={onClose} className="md-btn icon-btn" aria-label="Close">
          <Icon name="close" className="text-[24px]" />
        </button>
      </div>
      <div className="px-6">
        {shortcuts.map(([keys, label]) => (
          <div key={label} className="flex items-center justify-between py-3 border-b border-outline-variant last:border-0">
            <span className="text-body-md text-on-surface">{label}</span>
            <div className="flex items-center gap-1 shrink-0 ml-4">
              {keys.map((k, i) => (
                <React.Fragment key={k}>
                  {i > 0 && <span className="text-label-md text-on-surface-variant">+</span>}
                  <kbd className="inline-flex items-center min-w-7 justify-center h-7 px-2 rounded-lg font-mono text-label-md bg-surface-container-highest text-on-surface-variant">
                    {k}
                  </kbd>
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="px-6 pt-3 pb-6 text-body-sm text-on-surface-variant">Shortcuts work when no text field is focused.</p>
    </Dialog>
  );
}
