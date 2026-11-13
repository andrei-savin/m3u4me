import { useState } from 'react';
import { Channel } from '../apiClient';
import Dialog from './Dialog';
import Icon from './Icon';

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

  const inputCls = 'field font-mono max-md:text-base';

  return (
    <Dialog onClose={onClose} dismissible={!saving} maxWidth="max-w-md">
      <div className="flex items-center justify-between pl-6 pr-3 pt-4 pb-2">
        <h2 className="text-headline-sm text-on-surface truncate">Stream headers</h2>
        <button onClick={onClose} className="md-btn icon-btn" aria-label="Close">
          <Icon name="close" className="text-[24px]" />
        </button>
      </div>

      <div className="px-6 pb-2 flex flex-col gap-4">
        <p className="text-body-md text-on-surface-variant">
          Some channels only play when the player says it came from a certain website (Referrer) or is a certain app (User-agent). These are written into your playlist for <span className="font-semibold text-on-surface">{channel.name || 'this channel'}</span>. Leave both empty if it plays without them.
        </p>
        <div>
          <label className="field-label">Referrer</label>
          <input
            autoFocus
            value={referrer}
            onChange={e => setReferrer(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); }}
            placeholder="https://…"
            className={inputCls}
          />
        </div>
        <div>
          <label className="field-label">User-agent</label>
          <textarea
            value={userAgent}
            onChange={e => setUserAgent(e.target.value)}
            // Enter saves rather than adding a line: a user-agent is always one line.
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
            placeholder="Mozilla/5.0 …"
            rows={3}
            className={`${inputCls} resize-none text-body-sm`}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 px-6 pt-4 pb-6">
        <button
          onClick={onClose}
          disabled={saving}
          className="md-btn btn btn-text"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="md-btn btn btn-text"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Dialog>
  );
}
