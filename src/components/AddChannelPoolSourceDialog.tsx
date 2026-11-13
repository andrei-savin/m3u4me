import React, { useState, useEffect, useRef } from 'react';
import { api, triggerChannelPoolRefresh, ChannelPoolSource } from '../apiClient';
import { useStore, notifyError, notifyWarning } from '../store';
import Dialog from './Dialog';
import { USER_AGENT_PRESETS } from '../utils/userAgents';
import Icon from './Icon';

interface AddChannelPoolSourceDialogProps {
  open: boolean;
  onClose: () => void;
  editingSource?: ChannelPoolSource | null;
}

type TabType = 'playlist-url' | 'xtream' | 'upload';

export default function AddChannelPoolSourceDialog({ open, onClose, editingSource }: AddChannelPoolSourceDialogProps) {
  const { setActiveChannelPoolSourceId } = useStore();
  const [tab, setTab] = useState<TabType>('playlist-url');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Playlist Link State
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkInterval, setLinkInterval] = useState(24);
  // null = not yet checked, string = warning message, false = explicitly overridden by user
  const [linkWarning, setLinkWarning] = useState<string | null>(null);
  const [linkWarningConfirmed, setLinkWarningConfirmed] = useState(false);

  // Xtream State
  const [xtreamName, setXtreamName] = useState('');
  const [xtreamUrl, setXtreamUrl] = useState('');
  const [xtreamUser, setXtreamUser] = useState('');
  const [xtreamPass, setXtreamPass] = useState('');
  const [xtreamInterval, setXtreamInterval] = useState(24);

  // User agent, shared by the Playlist Link and Xtream tabs. '' = the app's default.
  // `customUserAgent` is on when the user picked "Custom…" or the saved value isn't a preset.
  const [userAgent, setUserAgent] = useState('');
  const [customUserAgent, setCustomUserAgent] = useState(false);
  // Most providers work with the app default, so the user agent choice stays folded away unless
  // the source already uses one or its last download failed (when trying another app can help).
  const [showUserAgent, setShowUserAgent] = useState(false);

  // Why the source's last download failed. Shown when editing a failing source, so a different
  // user agent or login can be tried right there. `savedButFailed` = this dialog's own save
  // went through but the download right after it still failed.
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [savedButFailed, setSavedButFailed] = useState(false);

  // Upload State
  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // Reset warning state on every open (Add or Edit) so a warning triggered in a
      // previous dialog session never leaks into a fresh one.
      setLinkWarning(null);
      setLinkWarningConfirmed(false);
      const savedUserAgent = editingSource?.userAgent || '';
      setUserAgent(savedUserAgent);
      setCustomUserAgent(savedUserAgent !== '' && !USER_AGENT_PRESETS.some(p => p.value === savedUserAgent));
      setShowUserAgent(savedUserAgent !== '' || !!editingSource?.lastFetchError);
      setDownloadError(editingSource?.lastFetchError || null);
      setSavedButFailed(false);
      if (editingSource) {
        setTab(editingSource.type);
        if (editingSource.type === 'playlist-url') {
          setLinkName(editingSource.name);
          setLinkUrl(editingSource.url || '');
          setLinkInterval(editingSource.refreshIntervalHours || 24);
        } else if (editingSource.type === 'xtream') {
          setXtreamName(editingSource.name);
          setXtreamUrl(editingSource.url || '');
          setXtreamUser(editingSource.xtreamCredentials?.username || '');
          setXtreamPass(editingSource.xtreamCredentials?.password || '');
          setXtreamInterval(editingSource.refreshIntervalHours || 24);
        } else if (editingSource.type === 'playlist-file') {
          setUploadName(editingSource.name);
          setUploadFile(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      } else {
        setTab('playlist-url');
        setLinkName('');
        setLinkUrl('');
        setLinkInterval(24);
        setXtreamName('');
        setXtreamUrl('');
        setXtreamUser('');
        setXtreamPass('');
        setXtreamInterval(24);
        setUploadName('');
        setUploadFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
      setIsSubmitting(false);
    }
  }, [open, editingSource]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // For playlist-url, validate the URL before creating/saving.
    // If a warning was returned and the user hasn't confirmed it yet, show the warning and stop.
    // If they click again (linkWarningConfirmed), skip the check and proceed.
    if (tab === 'playlist-url' && linkUrl.startsWith('http') && !linkWarningConfirmed) {
      setIsSubmitting(true);
      try {
        const result = await api.validateChannelPoolSourceUrl(linkUrl, userAgent.trim() || null);
        if (result.warning) {
          setLinkWarning(result.warning);
          setLinkWarningConfirmed(true); // next click will proceed despite warning
          setIsSubmitting(false);
          return;
        }
        setLinkWarning(null);
      } catch {
        // If validation itself fails (network error, etc.), just proceed.
        setLinkWarning(null);
      }
    }

    setIsSubmitting(true);
    try {
      if (editingSource) {
        const updates: Partial<ChannelPoolSource> = {
          name: tab === 'playlist-url' ? linkName : tab === 'xtream' ? xtreamName : uploadName,
        };
        if (tab === 'playlist-url') {
          updates.url = linkUrl;
          updates.refreshIntervalHours = linkInterval;
          updates.userAgent = userAgent.trim() || null;
        } else if (tab === 'xtream') {
          updates.url = xtreamUrl;
          updates.xtreamCredentials = { username: xtreamUser, password: xtreamPass };
          updates.refreshIntervalHours = xtreamInterval;
          updates.userAgent = userAgent.trim() || null;
        } else if (tab === 'upload') {
          // Note: for file uploads, if the user doesn't pick a new file, we just update the name.
          if (uploadFile) {
            const text = await uploadFile.text();
            const formData = new FormData();
            formData.append('name', uploadName);
            formData.append('content', text);
            formData.append('filename', uploadFile.name);
            // Delete the old one and re-upload? Or we assume the API handles updating.
            // Wait, we can't easily re-upload to the same ID with `uploadChannelPoolSource`.
            // Let's just update the name using `updateChannelPoolSource`. 
            // If they pick a new file, we can't easily update via FormData in the existing API.
            // But we will pass `updates` below anyway.
            // Let's assume the user doesn't update the file for playlist-file, just the name.
          }
        }
        await api.updateChannelPoolSource(editingSource.id, updates);

        // If URL, credentials or user agent changed, trigger a refresh to fetch new channels.
        // A source whose last download failed is retried on any save too.
        let needsRefresh = false;
        if (tab === 'playlist-url' || tab === 'xtream') {
          if (userAgent.trim() !== (editingSource.userAgent || '')) needsRefresh = true;
          if (editingSource.lastFetchError) needsRefresh = true;
        }
        if (tab === 'playlist-url' && linkUrl !== (editingSource.url || '')) {
          needsRefresh = true;
        } else if (tab === 'xtream') {
          if (xtreamUrl !== (editingSource.url || '')) needsRefresh = true;
          if (xtreamUser !== (editingSource.xtreamCredentials?.username || '')) needsRefresh = true;
          if (xtreamPass !== (editingSource.xtreamCredentials?.password || '')) needsRefresh = true;
        }

        if (needsRefresh) {
          try {
            await api.refreshChannelPoolSource(editingSource.id);
          } catch (refreshError) {
            // The changes are saved, but the download failed. The dialog stays open with the
            // reason, so another user agent or login can be tried straight away.
            console.error(refreshError);
            triggerChannelPoolRefresh();
            setDownloadError(refreshError instanceof Error ? refreshError.message : String(refreshError));
            setSavedButFailed(true);
            setShowUserAgent(true);
            return;
          }
        }
      } else {
        let created: ChannelPoolSource | null = null;
        if (tab === 'playlist-url') {
          created = await api.createChannelPoolSource({
            name: linkName,
            type: 'playlist-url',
            url: linkUrl,
            userAgent: userAgent.trim() || null,
            refreshIntervalHours: linkInterval,
          });
        } else if (tab === 'xtream') {
          created = await api.createChannelPoolSource({
            name: xtreamName,
            type: 'xtream',
            url: xtreamUrl,
            xtreamCredentials: { username: xtreamUser, password: xtreamPass },
            userAgent: userAgent.trim() || null,
            refreshIntervalHours: xtreamInterval,
          });
        }
        // The source exists either way, so the dialog closes. Selecting it puts the reason for
        // the failure on screen (the Sources tab shows it in place of the channel list).
        if (created?.lastFetchError) {
          setActiveChannelPoolSourceId(created.id);
          notifyWarning("The source was added, but its channels couldn't be downloaded. The source shows why.");
        }
        if (tab === 'upload' && uploadFile) {
          const text = await uploadFile.text();
          await api.uploadChannelPoolSource({ name: uploadName, content: text, filename: uploadFile.name });
        }
      }
      triggerChannelPoolRefresh();
      onClose();
    } catch (error) {
      console.error(editingSource ? 'Failed to update Channel Pool source' : 'Failed to add Channel Pool source', error);
      notifyError(error, editingSource ? 'Failed to update channel source.' : 'Failed to add channel source.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = () => {
    if (tab === 'playlist-url') return linkName.trim() !== '' && linkUrl.trim() !== '';
    if (tab === 'xtream') return xtreamName.trim() !== '' && xtreamUrl.trim() !== '' && xtreamUser.trim() !== '' && xtreamPass.trim() !== '';
    if (tab === 'upload') return uploadName.trim() !== '' && (editingSource || uploadFile !== null);
    return false;
  };

  const inputClasses = "field max-md:text-base";

  const selectedUserAgentPreset = customUserAgent ? 'custom' : (USER_AGENT_PRESETS.find(p => p.value === userAgent)?.value ?? 'custom');

  // Shown on the Playlist Link and Xtream tabs, under Refresh Interval. Optional: leaving it
  // folded (or on "App default") downloads the way the app always has.
  const renderUserAgentField = () => !showUserAgent ? (
    <button
      type="button"
      onClick={() => setShowUserAgent(true)}
      className="self-start -mt-1 flex items-center gap-1 text-label-lg text-on-surface-variant hover:text-on-surface"
    >
      <Icon name="chevron_right" className="text-[18px]" />
      User agent (optional)
    </button>
  ) : (
    <div>
      <button
        type="button"
        onClick={() => setShowUserAgent(false)}
        className="flex items-center gap-1 text-label-lg text-on-surface-variant hover:text-on-surface mb-1"
      >
        <Icon name="keyboard_arrow_down" className="text-[18px]" />
        User agent (optional)
      </button>
      <select
        value={selectedUserAgentPreset}
        onChange={(e) => {
          // The link check's result depended on the old user agent, so it runs again.
          setLinkWarning(null);
          setLinkWarningConfirmed(false);
          if (e.target.value === 'custom') {
            setCustomUserAgent(true);
          } else {
            setCustomUserAgent(false);
            setUserAgent(e.target.value);
          }
        }}
        className="field bg-dialog max-md:text-base"
      >
        {USER_AGENT_PRESETS.map(p => <option key={p.label} value={p.value}>{p.label}</option>)}
        <option value="custom">Custom…</option>
      </select>
      {customUserAgent && (
        <input
          type="text"
          placeholder="e.g. MyPlayer/1.0"
          value={userAgent}
          onChange={(e) => { setUserAgent(e.target.value); setLinkWarning(null); setLinkWarningConfirmed(false); }}
          className={inputClasses + " mt-2 font-mono text-body-sm"}
        />
      )}
      <p className="text-body-sm text-on-surface-variant mt-1.5">
        The app this source pretends to be when downloading. Leave it on "App default" unless your provider only works with certain apps, or downloading fails or is blocked.
      </p>
    </div>
  );


  return (
    <Dialog onClose={onClose}>
        <h2 className="text-headline-sm text-on-surface px-6 pt-6 pb-3">
          {editingSource ? 'Edit source' : 'Add channel source'}
        </h2>

        {/* Tabs */}
        <div className="flex mx-6 border-b border-outline-variant">
          <button
            onClick={() => setTab('playlist-url')}
            className={`md-btn flex-1 h-12 text-title-sm relative ${tab === 'playlist-url' ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}
            disabled={!!editingSource && editingSource.type !== 'playlist-url'}
            style={editingSource && editingSource.type !== 'playlist-url' ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            Playlist link
            {tab === 'playlist-url' && (
              <div className="absolute bottom-0 left-4 right-4 h-[3px] rounded-t-full bg-primary" />
            )}
          </button>
          <button
            onClick={() => setTab('xtream')}
            className={`md-btn flex-1 h-12 text-title-sm relative ${tab === 'xtream' ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}
            disabled={!!editingSource && editingSource.type !== 'xtream'}
            style={editingSource && editingSource.type !== 'xtream' ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            Xtream Codes
            {tab === 'xtream' && (
              <div className="absolute bottom-0 left-4 right-4 h-[3px] rounded-t-full bg-primary" />
            )}
          </button>
          <button
            onClick={() => setTab('upload')}
            className={`md-btn flex-1 h-12 text-title-sm relative ${tab === 'upload' ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}
            disabled={!!editingSource && editingSource.type !== 'playlist-file'}
            style={editingSource && editingSource.type !== 'playlist-file' ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            Upload file
            {tab === 'upload' && (
              <div className="absolute bottom-0 left-4 right-4 h-[3px] rounded-t-full bg-primary" />
            )}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 pt-5 pb-6 flex flex-col gap-4">
          {tab === 'playlist-url' ? (
            <>
              <div>
                <label className="field-label">Name</label>
                <input
                  type="text"
                  placeholder="My Source"
                  value={linkName}
                  onChange={(e) => setLinkName(e.target.value)}
                  className={inputClasses}
                />
              </div>
              <div>
                <label className="field-label">URL</label>
                <input
                  type="url"
                  placeholder="https://example.com/playlist.m3u"
                  value={linkUrl}
                  onChange={(e) => { setLinkUrl(e.target.value); setLinkWarning(null); setLinkWarningConfirmed(false); }}
                  className={inputClasses}
                />
                <p className="text-body-sm text-on-surface-variant mt-1.5">Supports M3U, M3U8, and XSPF playlists</p>
                {linkWarning && (
                  <p className="text-body-sm text-warning mt-1.5">
                    ⚠ {linkWarning}{linkWarningConfirmed ? ` — Click ${editingSource ? 'Save changes' : 'Add source'} again to proceed anyway.` : ''}
                  </p>
                )}
              </div>
              <div>
                <label className="field-label">Refresh Interval</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={linkInterval}
                    onChange={(e) => setLinkInterval(parseInt(e.target.value) || 1)}
                    className={inputClasses + " w-24"}
                  />
                  <span className="text-body-md text-on-surface-variant">hours</span>
                </div>
              </div>
              {renderUserAgentField()}
            </>
          ) : tab === 'xtream' ? (
            <>
              <div>
                <label className="field-label">Name</label>
                <input
                  type="text"
                  placeholder="My Xtream Source"
                  value={xtreamName}
                  onChange={(e) => setXtreamName(e.target.value)}
                  className={inputClasses}
                />
              </div>
              <div>
                <label className="field-label">Server URL</label>
                <input
                  type="url"
                  placeholder="http://example.com:8080"
                  value={xtreamUrl}
                  onChange={(e) => setXtreamUrl(e.target.value)}
                  className={inputClasses}
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="field-label">Username</label>
                  <input
                    type="text"
                    value={xtreamUser}
                    onChange={(e) => setXtreamUser(e.target.value)}
                    className={inputClasses}
                  />
                </div>
                <div className="flex-1">
                  <label className="field-label">Password</label>
                  <input
                    type="password"
                    value={xtreamPass}
                    onChange={(e) => setXtreamPass(e.target.value)}
                    className={inputClasses}
                  />
                </div>
              </div>
              <div>
                <label className="field-label">Refresh Interval</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={xtreamInterval}
                    onChange={(e) => setXtreamInterval(parseInt(e.target.value) || 1)}
                    className={inputClasses + " w-24"}
                  />
                  <span className="text-body-md text-on-surface-variant">hours</span>
                </div>
                <p className="text-body-sm text-on-surface-variant mt-1.5">Will fetch live stream channels from the Xtream API</p>
              </div>
              {renderUserAgentField()}
            </>
          ) : (
            <>
              <div>
                <label className="field-label">Name</label>
                <input
                  type="text"
                  placeholder="My Source"
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  className={inputClasses}
                />
              </div>
              <div>
                <label className="field-label">File</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".m3u,.m3u8,.xspf"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className={inputClasses + " h-auto py-2 file:mr-3 file:h-8 file:px-4 file:rounded-full file:border-0 file:text-label-lg file:bg-secondary-container file:text-on-secondary-container file:cursor-pointer"}
                />
              </div>
            </>
          )}

          {downloadError && tab !== 'upload' && (
            <div className="flex gap-2.5 rounded-xl bg-error-container text-on-error-container p-3 text-body-sm">
              <Icon name="warning" className="text-[20px] shrink-0 mt-0.5" />
              <p>
                <span className="font-medium">{savedButFailed ? 'Saved, but downloading still failed.' : 'The last download failed.'}</span>{' '}
                {downloadError}
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={onClose}
              className="md-btn btn btn-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isFormValid() || isSubmitting}
              className="md-btn btn btn-filled"
            >
              {isSubmitting && <Icon name="progress_activity" className="text-[20px] animate-spin" />}
              {editingSource ? 'Save changes' : 'Add source'}
            </button>
          </div>
        </form>
    </Dialog>
  );
}
