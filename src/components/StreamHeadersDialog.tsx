import { useState } from 'react';
import { X } from 'lucide-react';
import { Channel } from '../apiClient';
import { useStore } from '../store';
import Dialog from './Dialog';

/**
 * Edits a playlist channel's stream headers: the Referrer and User-agent some providers need
 * before they'll serve a stream. They usually come from the source's playlist; this is for
 * fixing or adding them by hand. Leaving both empty removes them.
 */
export default function StreamHeadersDialog({
  channel,
  onSave,
  onClose,
}: {
  channel: Channel;
  onSave: (headers: { httpReferrer: string | null; httpUserAgent: string | null }) => Promise<void>;
  onClose: () => void;
}) {
  const { accentColor } = useStore();
  const [referrer, setReferrer] = useState(channel.httpReferrer || '');
  const [userAgent, setUserAgent] = useState(channel.httpUserAgent || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await onSave({ httpReferrer: referrer.trim() || null, httpUserAgent: userAgent.trim() || null });
      onClose();
    } catch {
      // The caller already showed the error; the dialog stays open so nothing typed is lost.
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-xs font-mono focus:outline-none bg-transparent text-gray-900 dark:text-white placeholder-gray-400';

  return (
    <Dialog onClose={onClose} dismissible={!saving} maxWidth="max-w-md">
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 dark:border-white/10">
        <h2 className="text-base font-medium text-gray-900 dark:text-white truncate">Stream headers</h2>
        <button onClick={onClose} className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-6 py-4 flex flex-col gap-4">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Some channels only play when the player says it came from a certain website (Referrer) or is a certain app (User-agent). These are written into your playlist for <span className="font-medium text-gray-700 dark:text-gray-200">{channel.name || 'this channel'}</span>. Leave both empty if it plays without them.
        </p>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">Referrer</label>
          <input
            autoFocus
            value={referrer}
            onChange={e => setReferrer(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); }}
            placeholder="https://…"
            className={inputCls}
            onFocus={e => (e.target.style.borderColor = accentColor)}
            onBlur={e => (e.target.style.borderColor = '')}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">User-agent</label>
          <textarea
            value={userAgent}
            onChange={e => setUserAgent(e.target.value)}
            // Enter saves rather than adding a line: a user-agent is always one line.
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
            placeholder="Mozilla/5.0 …"
            rows={3}
            className={`${inputCls} resize-none`}
            onFocus={e => (e.target.style.borderColor = accentColor)}
            onBlur={e => (e.target.style.borderColor = '')}
          />
        </div>
      </div>

      <div className="flex justify-end gap-1 px-4 pb-4">
        <button
          onClick={onClose}
          disabled={saving}
          className="md-btn h-9 px-4 rounded text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-300"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="md-btn h-9 px-4 rounded text-xs font-medium uppercase tracking-wider disabled:opacity-50"
          style={{ color: accentColor }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Dialog>
  );
}
