import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle, ArrowLeft, ArrowRight, ArchiveRestore, Check, Copy, Eye, EyeOff, FileAudio, KeyRound, Layers,
  Loader2, Lock, Moon, Plus, Radio, ShieldCheck, Sparkles, Sun, X,
} from 'lucide-react';
import {
  api, setSessionToken, useChannelPoolSources, useEpgSources, triggerChannelPoolRefresh,
  triggerEpgRefresh, ChannelPoolSource, Playlist, RestoreResult,
} from '../apiClient';
import { useStore, notifyError, accentAlpha, contrastText, ACCENT_PRESETS, AuthExpiredError } from '../store';
import { HomeBackground, GLASS } from './Home';
import { Logo } from './Logo';
import Toast from './Toast';
import AddChannelPoolSourceDialog from './AddChannelPoolSourceDialog';
import AddEpgSourceDialog from './AddEpgSourceDialog';
import BackupDropZone, { describeRestoredBackup, restoreErrorMessage } from './BackupDropZone';

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

// Same copy-with-fallback as Home's copyLink, SettingsPage's handleCopyKey and LockScreen's,
// kept in sync by hand. The app is usually opened over plain http://<LAN-IP>, which isn't a
// secure context, so navigator.clipboard doesn't exist there and the hidden-textarea
// execCommand path does the work.
function copyText(text: string, onCopied: () => void, onFailed: () => void) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(onCopied).catch(fallback);
  } else {
    fallback();
  }
  function fallback() {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
    document.body.appendChild(el);
    el.select();
    // execCommand returns false (rather than throwing) when the copy is refused, so only a
    // true counts as copied.
    try { if (document.execCommand('copy')) onCopied(); else onFailed(); } catch (e) { console.error(e); onFailed(); }
    document.body.removeChild(el);
  }
}

// ── Building blocks shared by the steps ────────────────────────────────────

function PrimaryButton({ children, onClick, disabled = false, type = 'button' }: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const { accentColor } = useStore();
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="md-btn inline-flex items-center justify-center gap-2 h-11 px-6 rounded-full text-sm font-medium shadow-md transition-opacity disabled:opacity-40 disabled:shadow-none"
      style={{ backgroundColor: accentColor, color: contrastText(accentColor) }}
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
      className="md-btn inline-flex items-center justify-center gap-1.5 h-11 px-5 rounded-full text-sm font-medium text-gray-600 dark:text-gray-300 disabled:opacity-40"
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
          <ArrowLeft className="h-4 w-4" />
          Back
        </GhostButton>
      )}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

function StepHeading({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  const { accentColor } = useStore();
  return (
    <div className="mb-6">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: accentAlpha(accentColor, '20'), color: accentColor }}>
        {icon}
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">{children}</p>
    </div>
  );
}

/** A copyable link on the finished screen, e.g. the playlist's address for a TV app. */
function LinkRow({ label, url }: { label: string; url: string }) {
  const { accentColor } = useStore();
  const [copied, setCopied] = useState(false);
  const copy = () => copyText(
    url,
    () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
    () => notifyError(null, "Couldn't copy the link. Select it and copy it yourself."),
  );
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-white/10 bg-white/70 dark:bg-black/20 pl-4 pr-1.5 py-1.5">
      <span className="w-16 shrink-0 text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</span>
      <code className="flex-1 min-w-0 truncate text-sm font-mono text-gray-900 dark:text-white select-all">{url}</code>
      <button onClick={copy} className="md-btn shrink-0 p-2 rounded-full text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white" title="Copy link" aria-label={`Copy ${label.toLowerCase()} link`}>
        {copied ? <Check className="h-4 w-4" style={{ color: accentColor }} /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

const inputClasses = "w-full rounded-xl border border-gray-300 dark:border-white/15 bg-white/70 dark:bg-black/20 px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none";

// ── Steps ──────────────────────────────────────────────────────────────────

function WelcomeStep({ onStartFresh, onRestore }: { onStartFresh: () => void; onRestore: () => void }) {
  const { accentColor, setAccentColor, isDarkMode, setDarkMode, setAmoledMode } = useStore();

  return (
    <>
      <div className="text-center">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-900 dark:text-white">Welcome to m3u4me</h1>
        <p className="mt-3 text-base leading-relaxed text-gray-600 dark:text-gray-300 max-w-md mx-auto">
          Build your own IPTV playlists from your providers' channels, and play them on every TV in your home. Setting up takes a couple of minutes.
        </p>
      </div>

      {/* Make it yours: the same accent colours and light/dark choice as in Settings, applied
          right away so the rest of the setup already looks the way the user picked. */}
      <div className="mt-8 flex flex-col items-center gap-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Make it yours</span>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            {ACCENT_PRESETS.map(color => (
              <button
                key={color}
                onClick={() => setAccentColor(color)}
                className="md-btn w-7 h-7 rounded-full border-2 transition-transform"
                style={{
                  backgroundColor: color,
                  borderColor: accentColor === color ? 'white' : 'transparent',
                  boxShadow: accentColor === color ? `0 0 0 2px ${color}` : undefined,
                  transform: accentColor === color ? 'scale(1.15)' : undefined,
                }}
                aria-label={`Accent colour ${color}`}
                aria-pressed={accentColor === color}
              />
            ))}
          </div>
          <div className="inline-flex rounded-full p-1 bg-black/[0.05] dark:bg-white/[0.08]">
            {([
              { dark: false, label: 'Light', icon: <Sun className="h-3.5 w-3.5" /> },
              { dark: true, label: 'Dark', icon: <Moon className="h-3.5 w-3.5" /> },
            ]).map(option => (
              <button
                key={option.label}
                // Leaving dark mode turns AMOLED off too, like the switches in Settings do.
                onClick={() => { setDarkMode(option.dark); if (!option.dark) setAmoledMode(false); }}
                className={`md-btn inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-xs font-medium transition-colors ${
                  isDarkMode === option.dark ? 'bg-white dark:bg-white/15 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'
                }`}
                aria-pressed={isDarkMode === option.dark}
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
          className="md-btn group text-left rounded-2xl border-2 p-5 transition-transform duration-200 hover:-translate-y-0.5"
          style={{ borderColor: accentColor, backgroundColor: accentAlpha(accentColor, '12') }}
        >
          <Sparkles className="h-6 w-6" style={{ color: accentColor }} />
          <div className="mt-3 flex items-center gap-1.5 text-base font-semibold text-gray-900 dark:text-white">
            Start fresh
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </div>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Add your provider and make your first playlist.</p>
        </button>
        <button
          onClick={onRestore}
          className="md-btn group text-left rounded-2xl border-2 border-gray-200 dark:border-white/10 bg-white/50 dark:bg-white/[0.03] p-5 transition-transform duration-200 hover:-translate-y-0.5"
        >
          <ArchiveRestore className="h-6 w-6 text-gray-500 dark:text-gray-400" />
          <div className="mt-3 flex items-center gap-1.5 text-base font-semibold text-gray-900 dark:text-white">
            Restore a backup
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </div>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Moving from another m3u4me? Bring everything with you.</p>
        </button>
      </div>
    </>
  );
}

/** One source in a SourceCard's list: its name and how its last fetch went. */
function SourceRow({ name, status, failed, onRemove }: { name: string; status: string; failed: boolean; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/70 dark:bg-black/20 border border-gray-200 dark:border-white/10 pl-3.5 pr-1.5 py-2">
      {failed
        ? <AlertCircle className="h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
        : <Check className="h-4 w-4 shrink-0 text-green-500" />}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{name}</div>
        <div className={`text-xs truncate ${failed ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>{status}</div>
      </div>
      <button onClick={onRemove} className="md-btn shrink-0 p-1.5 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-white" title="Remove" aria-label={`Remove ${name}`}>
        <X className="h-4 w-4" />
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
  const { accentColor } = useStore();
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white/50 dark:bg-white/[0.03] p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0" style={{ color: accentColor }}>{icon}</div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{description}</p>
        </div>
      </div>
      {children && <div className="mt-3 space-y-2">{children}</div>}
      <button
        onClick={onAdd}
        className="md-btn mt-3 w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-xl border-2 border-dashed text-sm font-medium transition-colors"
        style={{ borderColor: accentAlpha(accentColor, '55'), color: accentColor }}
      >
        <Plus className="h-4 w-4" />
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
  const { accentColor } = useStore();
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
      <StepHeading icon={<Layers className="h-6 w-6" />} title="Add your sources">
        Sources are where your channels and TV guide come from, usually your IPTV provider. You'll pick channels from them for your playlists. You can add more, or change these, at any time.
      </StepHeading>

      <div className="space-y-3">
        <SourceCard
          icon={<Layers className="h-5 w-5" />}
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
          icon={<Radio className="h-5 w-5" />}
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
                <div key={s.id} className="flex items-center gap-3 rounded-xl px-3.5 py-2" style={{ backgroundColor: accentAlpha(accentColor, '14') }}>
                  <Sparkles className="h-4 w-4 shrink-0" style={{ color: accentColor }} />
                  <span className="flex-1 min-w-0 text-sm text-gray-700 dark:text-gray-200">
                    Use the TV guide from <span className="font-medium">{s.name}</span>
                  </span>
                  <button
                    onClick={() => addGuideFrom(s)}
                    disabled={addingGuideFor !== null}
                    className="md-btn shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium disabled:opacity-60"
                    style={{ backgroundColor: accentColor, color: contrastText(accentColor) }}
                  >
                    {addingGuideFor === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
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
            <ArrowRight className="h-4 w-4" />
          </PrimaryButton>
        ) : (
          <GhostButton onClick={onNext}>Skip for now</GhostButton>
        )}
      </StepFooter>
    </>
  );
}

function RestoreStep({ onBack, onRestored }: { onBack: () => void; onRestored: (result: RestoreResult) => void }) {
  const { accentColor } = useStore();
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
      <StepHeading icon={<ArchiveRestore className="h-6 w-6" />} title="Restore a backup">
        Bring over everything from your old m3u4me: playlists, sources, TV guides and settings.
      </StepHeading>

      <BackupDropZone file={file} onFileChange={f => { setFile(f); setError(''); }} accentColor={accentColor} disabled={restoring} />

      <div className="mt-4 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] px-4 py-3 space-y-2 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
        <p>
          <span className="font-medium text-gray-800 dark:text-gray-200">Where's my backup?</span>{' '}
          In your old m3u4me, open Settings, then Backup, then Download backup.
        </p>
        <p>
          Older version without that button? Use the <code className="font-mono">db.json</code> file from its data folder instead: <code className="font-mono">/opt/m3u4me/data</code> for the one-line install, or the <code className="font-mono">data</code> folder inside your m3u4me folder for Docker and manual installs.
        </p>
        <p>Your password isn't part of the backup. You can set one in the next step.</p>
      </div>

      {(channelSources.length > 0 || guideSources.length > 0) && (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
          The sources you added a moment ago will be replaced by the ones in the backup.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-500 dark:text-red-400">{error}</p>}

      <StepFooter onBack={restoring ? undefined : onBack}>
        <PrimaryButton onClick={restore} disabled={!file || restoring}>
          {restoring && <Loader2 className="h-4 w-4 animate-spin" />}
          {restoring ? 'Restoring…' : 'Restore'}
        </PrimaryButton>
      </StepFooter>
    </>
  );
}

function PasswordStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { accentColor } = useStore();
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
    if (password.length < 4) { setError('Password must be at least 4 characters'); return; }
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
      <StepHeading icon={<Lock className="h-6 w-6" />} title="Lock m3u4me with a password?">
        Anyone on your home network can open m3u4me in a browser. A password keeps them out. Your TV apps keep loading your playlists without it.
      </StepHeading>

      {status === 'checking' ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
      ) : recoveryKey ? (
        <div className="rounded-xl border-2 p-4 space-y-3" style={{ borderColor: accentAlpha(accentColor, '40'), backgroundColor: accentAlpha(accentColor, '08') }}>
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" style={{ color: accentColor }} />
            <span className="text-sm font-medium text-gray-900 dark:text-white">Save your recovery key</span>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400">If you ever forget your password, this key is the only way back in. Keep it somewhere safe. It won't be shown again.</p>
          <div className="flex items-center gap-2 p-3 rounded-lg bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10">
            <code className="flex-1 text-center text-sm font-mono font-medium text-gray-900 dark:text-white tracking-wider break-all">{recoveryKey}</code>
            <button onClick={copyKey} className="md-btn p-1.5 rounded-full text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white" title="Copy recovery key">
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          {copyFailed && (
            <p className="text-xs text-red-500 dark:text-red-400">Couldn't copy the recovery key. Select the key and copy it yourself, then keep it somewhere safe.</p>
          )}
        </div>
      ) : status === 'on' ? (
        <div className="flex items-center gap-3 rounded-xl bg-green-500/10 px-4 py-3">
          <ShieldCheck className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
          <span className="text-sm text-gray-800 dark:text-gray-200">Password protection is on.</span>
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
              onFocus={e => (e.target.style.borderColor = accentColor)}
              onBlur={e => (e.target.style.borderColor = '')}
            />
            <button type="button" onClick={() => setShowPassword(p => !p)} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" tabIndex={-1} aria-label={showPassword ? 'Hide password' : 'Show password'}>
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <input
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Confirm password"
            autoComplete="new-password"
            className={inputClasses}
            onFocus={e => (e.target.style.borderColor = accentColor)}
            onBlur={e => (e.target.style.borderColor = '')}
          />
          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
          {/* Lets Enter in either field submit the form; the visible button is in the footer. */}
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>
      )}

      <StepFooter onBack={saving ? undefined : onBack}>
        {status === 'off' && !recoveryKey ? (
          <>
            <GhostButton onClick={onNext} disabled={saving}>Skip</GhostButton>
            <PrimaryButton onClick={handleSetPassword} disabled={saving || !password || !confirmPassword}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Set password
            </PrimaryButton>
          </>
        ) : (
          <PrimaryButton onClick={onNext} disabled={status === 'checking'}>
            Continue
            <ArrowRight className="h-4 w-4" />
          </PrimaryButton>
        )}
      </StepFooter>
    </>
  );
}

function PlaylistStep({ onBack, onCreated }: { onBack: () => void; onCreated: (playlist: Playlist) => void }) {
  const { accentColor } = useStore();
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
      <StepHeading icon={<FileAudio className="h-6 w-6" />} title="Name your first playlist">
        A playlist is the list of channels your TV app loads. Next, you'll fill it with the channels you want. You can make more playlists later, like one per room or per person.
      </StepHeading>

      <label htmlFor="onboarding-playlist-name" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Playlist name</label>
      <input
        id="onboarding-playlist-name"
        autoFocus
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="e.g. Living Room"
        className={inputClasses + ' text-base'}
        onFocus={e => (e.target.style.borderColor = accentColor)}
        onBlur={e => (e.target.style.borderColor = '')}
      />

      <StepFooter onBack={creating ? undefined : onBack}>
        <PrimaryButton type="submit" disabled={!name.trim() || creating}>
          {creating && <Loader2 className="h-4 w-4 animate-spin" />}
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
  const { accentColor, setActivePlaylistId, setActiveChannelPoolSourceId } = useStore();
  const { sources: channelSources } = useChannelPoolSources();
  const { sources: guideSources } = useEpgSources();

  const checkMark = (
    <div className="onboarding-pop mx-auto w-16 h-16 rounded-full flex items-center justify-center shadow-lg" style={{ backgroundColor: accentColor }}>
      <Check className="h-8 w-8" strokeWidth={3} style={{ color: contrastText(accentColor) }} />
    </div>
  );

  // Restored a backup that already had playlists.
  if (!playlist && restored) {
    return (
      <div className="text-center">
        {checkMark}
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Welcome back</h1>
        <p className="mt-3 text-base text-gray-600 dark:text-gray-300">Your backup is restored: {describeRestoredBackup(restored)}.</p>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Your sources are refreshing in the background, so their channels and TV guide can take a few minutes to show up.</p>
        <div className="mt-8 flex justify-center">
          <PrimaryButton onClick={() => onFinish('/')}>
            Open m3u4me
            <ArrowRight className="h-4 w-4" />
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
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">You're all set</h1>
        <p className="mt-3 text-base text-gray-600 dark:text-gray-300">
          <span className="font-medium text-gray-900 dark:text-white">{playlist.name}</span> is ready. Add this link to your TV app to watch it:
        </p>
      </div>

      <div className="mt-6 space-y-2">
        <LinkRow label="Playlist" url={base} />
        {guideSources.length > 0 && <LinkRow label="TV guide" url={`${base}/epg`} />}
      </div>
      <p className="mt-4 text-center text-xs text-gray-500 dark:text-gray-400">
        It's empty for now. Add channels to it{channelSources.length > 0 ? ' from your sources' : ''}, and your TV app picks them up the next time it loads the playlist.
      </p>

      <div className="mt-8 flex flex-col-reverse sm:flex-row items-center justify-center gap-2">
        <GhostButton onClick={() => onFinish('/')}>Go to Home</GhostButton>
        <PrimaryButton onClick={addChannels}>
          Add channels
          <ArrowRight className="h-4 w-4" />
        </PrimaryButton>
      </div>
    </>
  );
}

// ── The setup itself ───────────────────────────────────────────────────────

export default function Onboarding({ onFinish }: { onFinish: () => void }) {
  const navigate = useNavigate();
  const { accentColor } = useStore();
  const [path, setPath] = useState<Path>('fresh');
  const [step, setStep] = useState<Step>('welcome');
  // Which way the last move went, so the next step slides in from the matching side.
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [restored, setRestored] = useState<RestoreResult | null>(null);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  // The source dialogs are opened from the Sources step but rendered out here, outside the glass
  // card: the card's backdrop blur (and the step's slide-in transform) would otherwise make the
  // dialogs' position: fixed relative to the card instead of the window.
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
    <div className="md-page-in relative h-screen overflow-hidden bg-gray-100 dark:bg-[#121212] amoled:dark:bg-black font-sans">
      <HomeBackground logos={[]} accentColor={accentColor} />

      <div ref={scrollRef} className="relative z-10 h-full overflow-y-auto">
        <div className="min-h-full flex flex-col items-center justify-center px-4 py-10">
          <Logo className="h-7 w-auto text-gray-900 dark:text-white mb-8 shrink-0" />

          <div className={`w-full max-w-xl rounded-3xl overflow-hidden ${GLASS}`}>
            {index !== -1 && (
              <div className="px-6 sm:px-10 pt-7">
                <div className="flex gap-1.5" aria-hidden="true">
                  {sequence.map((s, i) => (
                    <div key={s} className="h-1 flex-1 rounded-full bg-gray-300/60 dark:bg-white/10 overflow-hidden">
                      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: i <= index ? '100%' : '0%', backgroundColor: accentColor }} />
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs font-medium text-gray-500 dark:text-gray-400">
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
