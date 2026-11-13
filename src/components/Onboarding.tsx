import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api, setSessionToken, useChannelPoolSources, useEpgSources, triggerChannelPoolRefresh,
  triggerEpgRefresh, ChannelPoolSource, Playlist, RestoreResult,
} from '../apiClient';
import { useStore, notifyError, contrastText, ACCENT_PRESETS, AuthExpiredError } from '../store';
import { Logo } from './Logo';
import Toast from './Toast';
import AddChannelPoolSourceDialog from './AddChannelPoolSourceDialog';
import AddEpgSourceDialog from './AddEpgSourceDialog';
import BackupDropZone, { describeRestoredBackup, restoreErrorMessage } from './BackupDropZone';
import { copyToClipboard } from '../utils/copyToClipboard';
import Icon from './Icon';

// The first-run setup. App.tsx shows it instead of the app until settings.onboardingDone is
// true, which the server sets when the first playlist is made or a backup with playlists is
// restored (see POST /api/playlists and POST /api/backup/restore in server.ts). So naming a
// playlist can't be skipped, and leaving or reloading mid-way brings the setup back.
//
//   Welcome ─┬─ Start fresh      → Sources → Password → Playlist → Done
//            └─ Restore a backup → Backup  → Password → (Playlist, if the backup had none) → Done

type Step = 'welcome' | 'sources' | 'restore' | 'password' | 'playlist' | 'done';
type Path = 'fresh' | 'restore';

const STEP_LABELS: Partial<Record<Step, string>> = {
  sources: 'Sources',
  restore: 'Backup',
  password: 'Password',
  playlist: 'Playlist',
};

// Copies through the shared helper (which works over plain http:// too) and reports back.
function copyText(text: string, onCopied: () => void, onFailed: () => void) {
  copyToClipboard(text).then(ok => (ok ? onCopied() : onFailed()));
}

// ── Building blocks shared by the steps ────────────────────────────────────

function PrimaryButton({ children, onClick, disabled = false, type = 'button' }: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="md-btn btn btn-filled h-12 px-6"
    >
      {children}
    </button>
  );
}

function GhostButton({ children, onClick, disabled = false }: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="md-btn btn btn-text h-12 text-on-surface-variant"
    >
      {children}
    </button>
  );
}

/** Back on the left, the step's own buttons on the right. */
function StepFooter({ onBack, children }: { onBack?: () => void; children: ReactNode }) {
  return (
    <div className="mt-8 flex items-center gap-2">
      {onBack && (
        <GhostButton onClick={onBack}>
          <Icon name="arrow_back" className="text-[20px]" />
          Back
        </GhostButton>
      )}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

function StepHeading({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4 bg-secondary-container text-on-secondary-container">
        {icon}
      </div>
      <h1 className="text-[28px] leading-9 font-semibold tracking-tight text-on-surface">{title}</h1>
      <p className="mt-2 text-body-md text-on-surface-variant">{children}</p>
    </div>
  );
}

/** A copyable link on the finished screen, e.g. the playlist's address for a TV app. */
function LinkRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => copyText(
    url,
    () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
    () => notifyError(null, "Couldn't copy the link. Select it and copy it yourself."),
  );
  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface-container-highest pl-4 pr-1 h-12">
      <span className="w-16 shrink-0 text-label-md text-on-surface-variant">{label}</span>
      <code className="flex-1 min-w-0 truncate text-body-md font-mono text-on-surface select-all">{url}</code>
      <button onClick={copy} className="md-btn icon-btn" title="Copy link" aria-label={`Copy ${label.toLowerCase()} link`}>
        {copied ? <Icon name="check" className="text-[24px] text-primary" /> : <Icon name="content_copy" className="text-[24px]" />}
      </button>
    </div>
  );
}

const inputClasses = "field h-12 max-md:text-base";

// ── Steps ──────────────────────────────────────────────────────────────────

function WelcomeStep({ onStartFresh, onRestore }: { onStartFresh: () => void; onRestore: () => void }) {
  const { accentColor, setAccentColor, themeMode, setThemeMode } = useStore();

  return (
    <>
      <div className="text-center">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-on-surface">Welcome to m3u4me</h1>
        <p className="mt-3 text-body-lg text-on-surface-variant max-w-md mx-auto">
          Build your own IPTV playlists from your providers' channels, and play them on every TV in your home. Setting up takes a couple of minutes.
        </p>
      </div>

      {/* Make it yours: the same accent colours and Auto/Light/Dark choice as in Settings, applied
          right away so the rest of the setup already looks the way the user picked. */}
      <div className="mt-8 flex flex-col items-center gap-3">
        <span className="text-label-lg text-on-surface-variant">Make it yours</span>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            {ACCENT_PRESETS.map(color => (
              <button
                key={color}
                onClick={() => setAccentColor(color)}
                className="md-btn w-9 h-9 rounded-full flex items-center justify-center"
                style={{
                  backgroundColor: color,
                  color: contrastText(color),
                  boxShadow: accentColor === color ? `0 0 0 3px var(--app-pane), 0 0 0 5px ${color}` : undefined,
                }}
                aria-label={`Accent colour ${color}`}
                aria-pressed={accentColor === color}
              >
                {accentColor === color && <Icon name="check" className="text-[20px]" />}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-full p-1 bg-surface-container-highest">
            {([
              { mode: 'auto', label: 'Auto', icon: <Icon name="brightness_auto" className="text-[18px]" /> },
              { mode: 'light', label: 'Light', icon: <Icon name="light_mode" className="text-[18px]" /> },
              { mode: 'dark', label: 'Dark', icon: <Icon name="dark_mode" className="text-[18px]" /> },
            ] as const).map(option => (
              <button
                key={option.label}
                onClick={() => setThemeMode(option.mode)}
                className={`md-btn inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-label-lg transition-colors ${
                  themeMode === option.mode ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant'
                }`}
                aria-pressed={themeMode === option.mode}
              >
                {option.icon}
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={onStartFresh}
          className="md-btn group text-left rounded-2xl p-5 bg-primary-container text-on-primary-container transition-transform duration-200 hover:-translate-y-0.5"
        >
          <Icon name="auto_awesome" className="text-[24px]" />
          <div className="mt-3 flex items-center gap-1.5 text-title-md">
            Start fresh
            <Icon name="arrow_forward" className="text-[20px] transition-transform group-hover:translate-x-0.5" />
          </div>
          <p className="mt-1 text-body-md opacity-80">Add your provider and make your first playlist.</p>
        </button>
        <button
          onClick={onRestore}
          className="md-btn group text-left rounded-2xl p-5 bg-surface-container-highest text-on-surface transition-transform duration-200 hover:-translate-y-0.5"
        >
          <Icon name="settings_backup_restore" className="text-[24px] text-on-surface-variant" />
          <div className="mt-3 flex items-center gap-1.5 text-title-md">
            Restore a backup
            <Icon name="arrow_forward" className="text-[20px] transition-transform group-hover:translate-x-0.5" />
          </div>
          <p className="mt-1 text-body-md text-on-surface-variant">Moving from another m3u4me? Bring everything with you.</p>
        </button>
      </div>
    </>
  );
}

/** One source in a SourceCard's list: its name and how its last fetch went. */
function SourceRow({ name, status, failed, onRemove }: { name: string; status: string; failed: boolean; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface-container-highest pl-4 pr-1 py-2">
      {failed
        ? <Icon name="error" className="text-[24px] shrink-0 text-error" />
        : <Icon name="check" className="text-[24px] shrink-0 text-success" />}
      <div className="flex-1 min-w-0">
        <div className="text-label-lg text-on-surface truncate">{name}</div>
        <div className={`text-body-sm truncate ${failed ? 'text-error' : 'text-on-surface-variant'}`}>{status}</div>
      </div>
      <button onClick={onRemove} className="md-btn icon-btn" title="Remove" aria-label={`Remove ${name}`}>
        <Icon name="close" className="text-[24px]" />
      </button>
    </div>
  );
}

function SourceCard({ icon, title, description, addLabel, onAdd, children }: {
  icon: ReactNode;
  title: string;
  description: string;
  addLabel: string;
  onAdd: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-outline-variant p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 text-primary">{icon}</div>
        <div className="flex-1 min-w-0">
          <h2 className="text-title-sm text-on-surface">{title}</h2>
          <p className="mt-0.5 text-body-sm text-on-surface-variant">{description}</p>
        </div>
      </div>
      {children && <div className="mt-3 space-y-2">{children}</div>}
      <button
        onClick={onAdd}
        className="md-btn btn btn-tonal mt-3 w-full"
      >
        <Icon name="add" className="text-[20px]" />
        {addLabel}
      </button>
    </div>
  );
}

function SourcesStep({ onBack, onNext, onAddChannels, onAddGuide }: {
  onBack: () => void;
  onNext: () => void;
  onAddChannels: () => void;
  onAddGuide: () => void;
}) {
  const { sources: channelSources } = useChannelPoolSources();
  const { sources: guideSources } = useEpgSources();
  const [addingGuideFor, setAddingGuideFor] = useState<string | null>(null);

  // An Xtream Codes login usually comes with its own TV guide, so offer to add it in one click
  // instead of typing the same server and login again in "Add TV guide". Only for logins that
  // aren't a TV guide source already.
  const guideSuggestions = channelSources.filter(s =>
    s.type === 'xtream' && s.url && s.xtreamCredentials &&
    !guideSources.some(g => g.type === 'xtream' && g.url === s.url && g.xtreamCredentials?.username === s.xtreamCredentials?.username)
  );

  const addGuideFrom = async (source: ChannelPoolSource) => {
    setAddingGuideFor(source.id);
    try {
      await api.createEpgSource({ name: source.name, url: source.url!, type: 'xtream', xtreamCredentials: source.xtreamCredentials });
      triggerEpgRefresh();
    } catch (e) {
      console.error(e);
      notifyError(e, "Couldn't add the TV guide. Try again, or add it with Add TV guide.");
    } finally {
      setAddingGuideFor(null);
    }
  };

  const removeChannelSource = async (id: string) => {
    try {
      await api.deleteChannelPoolSource(id);
      triggerChannelPoolRefresh();
    } catch (e) {
      console.error(e);
      notifyError(e, "Couldn't remove the source. Try again.");
    }
  };

  const removeGuideSource = async (id: string) => {
    try {
      await api.deleteEpgSource(id);
      triggerEpgRefresh();
    } catch (e) {
      console.error(e);
      notifyError(e, "Couldn't remove the TV guide. Try again.");
    }
  };

  const addedAnything = channelSources.length > 0 || guideSources.length > 0;

  return (
    <>
      <StepHeading icon={<Icon name="stacks" className="text-[24px]" />} title="Add your sources">
        Sources are where your channels and TV guide come from, usually your IPTV provider. You'll pick channels from them for your playlists. You can add more, or change these, at any time.
      </StepHeading>

      <div className="space-y-3">
        <SourceCard
          icon={<Icon name="stacks" className="text-[24px]" />}
          title="Channels"
          description="Your provider's Xtream Codes login, a playlist link, or a playlist file."
          addLabel="Add channel source"
          onAdd={onAddChannels}
        >
          {channelSources.length > 0 && channelSources.map(s => (
            <React.Fragment key={s.id}>
              <SourceRow
                name={s.name}
                failed={!!s.lastFetchError}
                status={s.lastFetchError ? `Couldn't load channels: ${s.lastFetchError}` : `${s.channelCount.toLocaleString()} channel${s.channelCount === 1 ? '' : 's'}`}
                onRemove={() => removeChannelSource(s.id)}
              />
            </React.Fragment>
          ))}
        </SourceCard>

        <SourceCard
          icon={<Icon name="live_tv" className="text-[24px]" />}
          title="TV guide (EPG)"
          description="What's on, for your channels. Providers usually give you an XMLTV link, or it comes with your Xtream Codes login."
          addLabel="Add TV guide"
          onAdd={onAddGuide}
        >
          {(guideSources.length > 0 || guideSuggestions.length > 0) && (
            <>
              {guideSources.map(s => (
                <React.Fragment key={s.id}>
                  <SourceRow
                    name={s.name}
                    failed={!!s.lastFetchError}
                    status={s.lastFetchError ? `Couldn't load the guide: ${s.lastFetchError}` : `${s.channelCount.toLocaleString()} channel${s.channelCount === 1 ? '' : 's'} with guide data`}
                    onRemove={() => removeGuideSource(s.id)}
                  />
                </React.Fragment>
              ))}
              {guideSuggestions.map(s => (
                <div key={s.id} className="flex items-center gap-3 rounded-xl pl-4 pr-1.5 py-1.5 bg-primary-container text-on-primary-container">
                  <Icon name="auto_awesome" className="text-[24px] shrink-0" />
                  <span className="flex-1 min-w-0 text-body-md">
                    Use the TV guide from <span className="font-semibold">{s.name}</span>
                  </span>
                  <button
                    onClick={() => addGuideFrom(s)}
                    disabled={addingGuideFor !== null}
                    className="md-btn btn btn-filled h-9 px-4"
                  >
                    {addingGuideFor === s.id ? <Icon name="progress_activity" className="text-[20px] animate-spin" /> : <Icon name="add" className="text-[20px]" />}
                    {addingGuideFor === s.id ? 'Adding…' : 'Add'}
                  </button>
                </div>
              ))}
            </>
          )}
        </SourceCard>
      </div>

      <StepFooter onBack={onBack}>
        {addedAnything ? (
          <PrimaryButton onClick={onNext}>
            Continue
            <Icon name="arrow_forward" className="text-[20px]" />
          </PrimaryButton>
        ) : (
          <GhostButton onClick={onNext}>Skip for now</GhostButton>
        )}
      </StepFooter>
    </>
  );
}

function RestoreStep({ onBack, onRestored }: { onBack: () => void; onRestored: (result: RestoreResult) => void }) {
  // Only to warn that a restore replaces sources added earlier in this setup (via Back).
  const { sources: channelSources } = useChannelPoolSources();
  const { sources: guideSources } = useEpgSources();
  const [file, setFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState('');

  const restore = async () => {
    if (!file) return;
    setRestoring(true);
    setError('');
    try {
      onRestored(await api.restoreBackup(file));
    } catch (e) {
      if (e instanceof AuthExpiredError) return; // the lock screen takes over
      console.error(e);
      setError(restoreErrorMessage(e));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      <StepHeading icon={<Icon name="settings_backup_restore" className="text-[24px]" />} title="Restore a backup">
        Bring over everything from your old m3u4me: playlists, sources, TV guides and settings.
      </StepHeading>

      <BackupDropZone file={file} onFileChange={f => { setFile(f); setError(''); }} disabled={restoring} />

      <div className="mt-4 rounded-xl bg-surface-container-highest px-4 py-3 space-y-2 text-body-sm text-on-surface-variant">
        <p>
          <span className="font-medium text-on-surface">Where's my backup?</span>{' '}
          In your old m3u4me, open Settings, then Backup, then Download backup.
        </p>
        <p>
          Older version without that button? Use the <code className="font-mono">db.json</code> file from its data folder instead: <code className="font-mono">/opt/m3u4me/data</code> for the one-line install, or the <code className="font-mono">data</code> folder inside your m3u4me folder for Docker and manual installs.
        </p>
        <p>Your password isn't part of the backup. You can set one in the next step.</p>
      </div>

      {(channelSources.length > 0 || guideSources.length > 0) && (
        <p className="mt-3 text-body-sm text-warning">
          The sources you added a moment ago will be replaced by the ones in the backup.
        </p>
      )}
      {error && <p className="mt-3 text-body-md text-error">{error}</p>}

      <StepFooter onBack={restoring ? undefined : onBack}>
        <PrimaryButton onClick={restore} disabled={!file || restoring}>
          {restoring && <Icon name="progress_activity" className="text-[20px] animate-spin" />}
          {restoring ? 'Restoring…' : 'Restore'}
        </PrimaryButton>
      </StepFooter>
    </>
  );
}

function PasswordStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [status, setStatus] = useState<'checking' | 'off' | 'on'>('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  // Coming back to this step (Back, or the setup starting over after a reload) with a password
  // already set shows that instead of the form.
  useEffect(() => {
    api.getAuthStatus()
      .then((res: { enabled: boolean }) => setStatus(res.enabled ? 'on' : 'off'))
      .catch((e: unknown) => { console.error(e); setStatus('off'); });
  }, []);

  // Same checks and messages as Settings' handleSetPassword.
  const handleSetPassword = async () => {
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await api.setPassword(password);
      if (res.ok) {
        // The server signs this browser in along with setting the password, so the rest of the
        // setup carries on without a trip to the lock screen.
        if (res.token) setSessionToken(res.token);
        setRecoveryKey(res.recoveryKey);
        setStatus('on');
      } else {
        setError(res.error || "Couldn't set the password. Try again.");
      }
    } catch (e) {
      // api.setPassword returns refusals as res.error above, so landing here means the server
      // couldn't be reached at all.
      console.error(e);
      setError("Couldn't reach m3u4me. Check that it's still running, then try again.");
    } finally {
      setSaving(false);
    }
  };

  const copyKey = () => {
    if (!recoveryKey) return;
    copyText(
      recoveryKey,
      () => { setCopyFailed(false); setCopied(true); setTimeout(() => setCopied(false), 2000); },
      // Shown right under the key rather than as a toast: losing this key can lock someone out.
      () => setCopyFailed(true),
    );
  };

  return (
    <>
      <StepHeading icon={<Icon name="lock" className="text-[24px]" />} title="Lock m3u4me with a password?">
        Anyone on your home network can open m3u4me in a browser. A password keeps them out. Your TV apps keep loading your playlists without it.
      </StepHeading>

      {status === 'checking' ? (
        <div className="flex justify-center py-6"><Icon name="progress_activity" className="text-[24px] animate-spin text-on-surface-variant" /></div>
      ) : recoveryKey ? (
        <div className="rounded-xl bg-primary-container text-on-primary-container p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Icon name="key" className="text-[24px]" />
            <span className="text-title-sm">Save your recovery key</span>
          </div>
          <p className="text-body-sm">If you ever forget your password, this key is the only way back in. Keep it somewhere safe. It won't be shown again.</p>
          <div className="flex items-center gap-2 pl-4 pr-1 py-1.5 rounded-lg bg-pane text-on-surface">
            <code className="flex-1 text-center text-body-md font-mono font-semibold break-all">{recoveryKey}</code>
            <button onClick={copyKey} className="md-btn icon-btn" title="Copy recovery key">
              {copied ? <Icon name="check" className="text-[24px] text-success" /> : <Icon name="content_copy" className="text-[24px]" />}
            </button>
          </div>
          {copyFailed && (
            <p className="text-body-sm text-error">Couldn't copy the recovery key. Select the key and copy it yourself, then keep it somewhere safe.</p>
          )}
        </div>
      ) : status === 'on' ? (
        <div className="flex items-center gap-3 rounded-xl bg-primary-container text-on-primary-container px-4 py-3">
          <Icon name="verified_user" className="text-[24px] shrink-0" />
          <span className="text-body-md">Password protection is on.</span>
        </div>
      ) : (
        <form onSubmit={e => { e.preventDefault(); handleSetPassword(); }} className="space-y-3">
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="new-password"
              className={inputClasses + ' pr-11'}
            />
            <button type="button" onClick={() => setShowPassword(p => !p)} className="md-btn icon-btn absolute right-1 top-1/2 -translate-y-1/2" tabIndex={-1} aria-label={showPassword ? 'Hide password' : 'Show password'}>
              {showPassword ? <Icon name="visibility_off" className="text-[20px]" /> : <Icon name="visibility" className="text-[20px]" />}
            </button>
          </div>
          <input
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Confirm password"
            autoComplete="new-password"
            className={inputClasses}
          />
          {error && <p className="text-body-sm text-error">{error}</p>}
          {/* Lets Enter in either field submit the form; the visible button is in the footer. */}
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>
      )}

      <StepFooter onBack={saving ? undefined : onBack}>
        {status === 'off' && !recoveryKey ? (
          <>
            <GhostButton onClick={onNext} disabled={saving}>Skip</GhostButton>
            <PrimaryButton onClick={handleSetPassword} disabled={saving || !password || !confirmPassword}>
              {saving && <Icon name="progress_activity" className="text-[20px] animate-spin" />}
              Set password
            </PrimaryButton>
          </>
        ) : (
          <PrimaryButton onClick={onNext} disabled={status === 'checking'}>
            Continue
            <Icon name="arrow_forward" className="text-[20px]" />
          </PrimaryButton>
        )}
      </StepFooter>
    </>
  );
}

function PlaylistStep({ onBack, onCreated }: { onBack: () => void; onCreated: (playlist: Playlist) => void }) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      onCreated(await api.createPlaylist(name.trim()));
    } catch (err) {
      console.error(err);
      notifyError(err, "Couldn't create the playlist. Try again.");
      setCreating(false);
    }
  };

  return (
    <form onSubmit={create}>
      <StepHeading icon={<Icon name="queue_music" className="text-[24px]" />} title="Name your first playlist">
        A playlist is the list of channels your TV app loads. Next, you'll fill it with the channels you want. You can make more playlists later, like one per room or per person.
      </StepHeading>

      <label htmlFor="onboarding-playlist-name" className="field-label">Playlist name</label>
      <input
        id="onboarding-playlist-name"
        autoFocus
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="e.g. Living Room"
        className={inputClasses + ' text-body-lg'}
      />

      <StepFooter onBack={creating ? undefined : onBack}>
        <PrimaryButton type="submit" disabled={!name.trim() || creating}>
          {creating && <Icon name="progress_activity" className="text-[20px] animate-spin" />}
          Create playlist
        </PrimaryButton>
      </StepFooter>
    </form>
  );
}

function DoneStep({ playlist, restored, onFinish }: {
  playlist: Playlist | null;
  restored: RestoreResult | null;
  onFinish: (path: string) => void;
}) {
  const { setActivePlaylistId, setActiveChannelPoolSourceId } = useStore();
  const { sources: channelSources } = useChannelPoolSources();
  const { sources: guideSources } = useEpgSources();

  const checkMark = (
    <div className="onboarding-pop mx-auto w-16 h-16 rounded-full flex items-center justify-center shadow-level-2 bg-primary text-on-primary">
      <Icon name="check" className="text-[32px]" />
    </div>
  );

  // Restored a backup that already had playlists.
  if (!playlist && restored) {
    return (
      <div className="text-center">
        {checkMark}
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-on-surface">Welcome back</h1>
        <p className="mt-3 text-body-lg text-on-surface-variant">Your backup is restored: {describeRestoredBackup(restored)}.</p>
        <p className="mt-2 text-body-md text-on-surface-variant">Your sources are refreshing in the background, so their channels and TV guide can take a few minutes to show up.</p>
        <div className="mt-8 flex justify-center">
          <PrimaryButton onClick={() => onFinish('/')}>
            Open m3u4me
            <Icon name="arrow_forward" className="text-[20px]" />
          </PrimaryButton>
        </div>
      </div>
    );
  }

  if (!playlist) return null;
  const base = `${window.location.protocol}//${window.location.host}/${playlist.shortId}`;

  // Channels get into a playlist by picking them in Sources, so go there when there's a source
  // to pick from. Without one, the empty playlist itself is the place to start.
  const addChannels = () => {
    setActivePlaylistId(playlist.id);
    if (channelSources.length > 0) {
      setActiveChannelPoolSourceId(channelSources[0].id);
      onFinish('/sources');
    } else {
      onFinish('/playlists');
    }
  };

  return (
    <>
      <div className="text-center">
        {checkMark}
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-on-surface">You're all set</h1>
        <p className="mt-3 text-body-lg text-on-surface-variant">
          <span className="font-medium text-on-surface">{playlist.name}</span> is ready. Add this link to your TV app to watch it:
        </p>
      </div>

      <div className="mt-6 space-y-2">
        <LinkRow label="Playlist" url={base} />
        {guideSources.length > 0 && <LinkRow label="TV guide" url={`${base}/epg`} />}
      </div>
      <p className="mt-4 text-center text-body-sm text-on-surface-variant">
        It's empty for now. Add channels to it{channelSources.length > 0 ? ' from your sources' : ''}, and your TV app picks them up the next time it loads the playlist.
      </p>

      <div className="mt-8 flex flex-col-reverse sm:flex-row items-center justify-center gap-2">
        <GhostButton onClick={() => onFinish('/')}>Go to Home</GhostButton>
        <PrimaryButton onClick={addChannels}>
          Add channels
          <Icon name="arrow_forward" className="text-[20px]" />
        </PrimaryButton>
      </div>
    </>
  );
}

// ── The setup itself ───────────────────────────────────────────────────────

export default function Onboarding({ onFinish }: { onFinish: () => void }) {
  const navigate = useNavigate();
  const [path, setPath] = useState<Path>('fresh');
  const [step, setStep] = useState<Step>('welcome');
  // Which way the last move went, so the next step slides in from the matching side.
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [restored, setRestored] = useState<RestoreResult | null>(null);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  // The source dialogs are opened from the Sources step but rendered out here, outside the
  // card: the step's slide-in transform would otherwise make the dialogs' position: fixed
  // relative to the card instead of the window.
  const [openDialog, setOpenDialog] = useState<'channels' | 'guide' | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // On a phone the card is taller than the screen, and the buttons that move on sit at its
  // bottom. Without this, the next step would open scrolled as far down as the last one was.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [step]);

  // The numbered steps of the chosen path. After a restore, the playlist step is only needed
  // when the backup had no playlist (then the server still has onboardingDone false).
  const sequence: Step[] = path === 'fresh'
    ? ['sources', 'password', 'playlist']
    : ['restore', 'password', ...(restored && !restored.onboardingDone ? ['playlist' as const] : [])];
  const index = sequence.indexOf(step);

  const goTo = (next: Step, dir: 'forward' | 'back') => {
    setDirection(dir);
    setStep(next);
  };
  const next = () => goTo(index + 1 < sequence.length ? sequence[index + 1] : 'done', 'forward');
  const back = () => goTo(index > 0 ? sequence[index - 1] : 'welcome', 'back');

  const finish = (to: string) => {
    navigate(to);
    onFinish();
  };

  return (
    <div className="md-page-in relative h-dvh overflow-hidden bg-page text-on-surface">
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <div className="min-h-full flex flex-col items-center justify-center px-4 py-10">
          <Logo className="h-7 w-auto text-on-surface mb-8 shrink-0" />

          {/* One card on the tinted page, like a dialog that can't be closed. */}
          <div className="w-full max-w-xl rounded-[28px] overflow-hidden bg-pane border border-pane-border">
            {index !== -1 && (
              <div className="px-6 sm:px-10 pt-7">
                <div className="flex gap-1.5" aria-hidden="true">
                  {sequence.map((s, i) => (
                    <div key={s} className="h-1 flex-1 rounded-full bg-secondary-container overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: i <= index ? '100%' : '0%' }} />
                    </div>
                  ))}
                </div>
                {/* Not shown on screen (the bar says it), but read out by screen readers, which skip the bar. */}
                <p className="sr-only">
                  Step {index + 1} of {sequence.length} · {STEP_LABELS[step]}
                </p>
              </div>
            )}

            {/* Keyed by step, so each step mounts fresh and plays its entrance. */}
            <div key={step} className={`${direction === 'back' ? 'onboarding-step-back' : 'onboarding-step-in'} px-6 sm:px-10 ${index !== -1 ? 'pt-6' : 'pt-10'} pb-8`}>
              {step === 'welcome' && (
                <WelcomeStep
                  onStartFresh={() => { setPath('fresh'); goTo('sources', 'forward'); }}
                  onRestore={() => { setPath('restore'); goTo('restore', 'forward'); }}
                />
              )}
              {step === 'sources' && (
                <SourcesStep onBack={back} onNext={next} onAddChannels={() => setOpenDialog('channels')} onAddGuide={() => setOpenDialog('guide')} />
              )}
              {step === 'restore' && (
                <RestoreStep onBack={back} onRestored={result => { setRestored(result); goTo('password', 'forward'); }} />
              )}
              {step === 'password' && <PasswordStep onBack={back} onNext={next} />}
              {step === 'playlist' && (
                <PlaylistStep onBack={back} onCreated={created => { setPlaylist(created); goTo('done', 'forward'); }} />
              )}
              {step === 'done' && <DoneStep playlist={playlist} restored={restored} onFinish={finish} />}
            </div>
          </div>
        </div>
      </div>

      <AddChannelPoolSourceDialog open={openDialog === 'channels'} onClose={() => setOpenDialog(null)} />
      <AddEpgSourceDialog open={openDialog === 'guide'} onClose={() => setOpenDialog(null)} />
      <Toast />
    </div>
  );
}
