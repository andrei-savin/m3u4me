import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { api, clearSessionToken, setSessionToken, triggerRefresh, triggerEpgRefresh, triggerChannelPoolRefresh, SyncFieldToggles as SyncFieldTogglesValue } from '../apiClient';
import Switch from './Switch';
import { COLOR_STYLES, previewColorStyle } from '../utils/materialTheme';
import SegmentedButtons from './SegmentedButtons';
import { Logo } from './Logo';
import { useVersionInfo } from './AppInfo';
import { contrastText, notifyError, notifyInfo, ACCENT_PRESETS, AuthExpiredError } from '../store';
import Toast from './Toast';
import { copyToClipboard } from '../utils/copyToClipboard';
import MobileTopBar from './MobileTopBar';
import MobileTabBar from './MobileTabBar';
import { useIsPhone } from '../utils/useIsPhone';
import SyncFieldToggles from './SyncFieldToggles';
import Dialog from './Dialog';
import BackupDropZone, { describeRestoredBackup, restoreErrorMessage } from './BackupDropZone';
import Icon from './Icon';

export default function SettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isPhone = useIsPhone();
  const {
    themeMode, setThemeMode, isDarkMode,
    isAmoledMode, setAmoledMode,
    logoBgColor, setLogoBgColor,
    accentColor, setAccentColor,
    is24Hour, set24Hour,
    fontFamily, setFontFamily,
    colorStyle, setColorStyle,
    setActivePlaylistId, setActiveChannelPoolSourceId, setActiveEpgSourceId, setUndoEntry,
  } = useStore();

  // Security state
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [showPassword, setShowPasswordVis] = useState(false);
  const [securityError, setSecurityError] = useState('');
  const [securitySuccess, setSecuritySuccess] = useState('');
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [securityAction, setSecurityAction] = useState<'none' | 'enable' | 'change' | 'remove'>('none');
  const [savingPassword, setSavingPassword] = useState(false);
  const [authStatusError, setAuthStatusError] = useState(false);
  
  const versionInfo = useVersionInfo();
  const GITHUB_REPO = 'https://github.com/andrei-savin/m3u4me';
  const BMC_URL = 'https://www.buymeacoffee.com/savinandrei';
  const BMC_YELLOW = '#FFDD00';

  const checkAuthStatus = () => {
    setAuthLoading(true);
    api.getAuthStatus().then((res: any) => {
      setAuthEnabled(res.enabled);
      setAuthLoading(false);
      setAuthStatusError(false);
    }).catch((e) => {
      console.error(e);
      setAuthLoading(false);
      setAuthStatusError(true);
    });
  };

  useEffect(() => {
    checkAuthStatus();
  }, []);

  // Channel sync defaults live in db.json (not localStorage like the appearance settings), so
  // they're the same on every device the app is opened from.
  const [syncDefaults, setSyncDefaults] = useState<SyncFieldTogglesValue | null>(null);
  useEffect(() => {
    api.getSettings()
      .then(s => setSyncDefaults(s.defaultSyncFields))
      .catch(e => { console.error(e); notifyError(e, "Couldn't load your channel sync settings. Reload the page to try again."); });
  }, []);

  const handleSyncDefaultsChange = async (next: SyncFieldTogglesValue) => {
    const previous = syncDefaults;
    setSyncDefaults(next);
    try {
      await api.updateSettings({ defaultSyncFields: next });
    } catch (e) {
      console.error(e);
      setSyncDefaults(previous);
      notifyError(e, "Couldn't save your channel sync settings. Try again.");
    }
  };

  // Backup
  const [downloadingBackup, setDownloadingBackup] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState('');

  // The backup sits behind the password, so it can't be a plain <a href download> link (that
  // can't send the session token). It's fetched first, then saved through a temporary link.
  const handleDownloadBackup = async () => {
    setDownloadingBackup(true);
    try {
      const blob = await api.downloadBackup();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `m3u4me-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Some browsers start the download only after click() returns, so the file's address is
      // released a moment later rather than right away.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      console.error(e);
      notifyError(e, "Couldn't download the backup. Try again.");
    } finally {
      setDownloadingBackup(false);
    }
  };

  const closeRestore = () => {
    setRestoreOpen(false);
    setRestoreFile(null);
    setRestoreError('');
  };

  const handleRestore = async () => {
    if (!restoreFile) return;
    setRestoring(true);
    setRestoreError('');
    try {
      const result = await api.restoreBackup(restoreFile);
      // Whatever was selected, or could still be undone, belonged to the data that was replaced.
      setActivePlaylistId(null);
      setActiveChannelPoolSourceId(null);
      setActiveEpgSourceId(null);
      setUndoEntry(null);
      triggerRefresh();
      triggerEpgRefresh();
      triggerChannelPoolRefresh();
      api.getSettings().then(s => setSyncDefaults(s.defaultSyncFields)).catch(console.error);
      closeRestore();
      notifyInfo(`Backup restored: ${describeRestoredBackup(result)}. Your sources are refreshing in the background.`);
    } catch (e) {
      if (e instanceof AuthExpiredError) return; // the lock screen takes over
      console.error(e);
      setRestoreError(restoreErrorMessage(e));
    } finally {
      setRestoring(false);
    }
  };

  const resetSecurityForm = () => {
    setPassword('');
    setConfirmPassword('');
    setCurrentPassword('');
    setSecurityError('');
    setSecuritySuccess('');
    setRecoveryKey(null);
    setSecurityAction('none');
    setShowPasswordVis(false);
  };

  const handleSetPassword = async () => {
    if (password.length < 4) { setSecurityError('Password must be at least 4 characters'); return; }
    if (password !== confirmPassword) { setSecurityError('Passwords do not match'); return; }
    setSavingPassword(true);
    setSecurityError('');
    try {
      const res = await api.setPassword(password, authEnabled ? currentPassword : undefined);
      if (res.ok) {
        // The server signs this browser in along with setting the password. Without the new
        // session, turning a password on would lock this page on the very next request.
        if (res.token) setSessionToken(res.token);
        setRecoveryKey(res.recoveryKey);
        setAuthEnabled(true);
        setSecuritySuccess(authEnabled ? 'Password changed successfully' : 'Password protection enabled');
        setPassword('');
        setConfirmPassword('');
        setCurrentPassword('');
      } else {
        setSecurityError(res.error || 'Failed to set password');
      }
    } catch (e) {
      // authFetch doesn't throw for /api/auth/* responses (wrong password etc. come back as
      // res.error above), so landing here means the server couldn't be reached at all.
      console.error(e);
      setSecurityError("Couldn't reach m3u4me. Check that it's still running, then try again.");
    } finally {
      setSavingPassword(false);
    }
  };

  const handleRemovePassword = async () => {
    if (!currentPassword) { setSecurityError('Enter your current password'); return; }
    setSavingPassword(true);
    setSecurityError('');
    try {
      const res = await api.removePassword(currentPassword);
      if (res.ok) {
        setAuthEnabled(false);
        setSecuritySuccess('Password protection removed');
        resetSecurityForm();
        clearSessionToken();
      } else {
        setSecurityError(res.error || 'Failed to remove password');
      }
    } catch (e) {
      // authFetch doesn't throw for /api/auth/* responses (wrong password etc. come back as
      // res.error above), so landing here means the server couldn't be reached at all.
      console.error(e);
      setSecurityError("Couldn't reach m3u4me. Check that it's still running, then try again.");
    } finally {
      setSavingPassword(false);
    }
  };

  // Only a real copy shows the checkmark: a false "copied" here could cost someone their
  // recovery key. The browser's own copy error is technical, so the message is plain and,
  // since the key is still on screen, points at copying it by hand.
  const handleCopyKey = async () => {
    if (!recoveryKey) return;
    if (await copyToClipboard(recoveryKey)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      notifyError(null, "Couldn't copy the recovery key. Select the key and copy it yourself, then keep it somewhere safe.");
    }
  };

  const passwordInputCls = 'field h-12 pr-12 max-md:text-base';
  const eyeButton = (
    <button type="button" onClick={() => setShowPasswordVis(p => !p)} className="md-btn icon-btn absolute right-1 top-1/2 -translate-y-1/2" tabIndex={-1} aria-label={showPassword ? 'Hide password' : 'Show password'}>
      {showPassword ? <Icon name="visibility_off" className="text-[24px]" /> : <Icon name="visibility" className="text-[24px]" />}
    </button>
  );

  return (
    <div className="md-page-in flex flex-col h-dvh overflow-hidden bg-page text-on-surface">
      {/* Phones get the shared phone bars instead (Settings is one of the tabs there, so no Back button). */}
      <MobileTopBar title="Settings" showSearch={false} />
      {/* Top bar */}
      <nav className="h-16 shrink-0 z-30 hidden md:flex items-center pl-2 pr-4 gap-2">
        <button
          // Back to wherever Settings was opened from. Opened directly (a bookmark, a new tab)
          // there's nothing in this app to go back to, so it goes Home instead of leaving the app.
          onClick={() => (location.key === 'default' ? navigate('/') : navigate(-1))}
          className="md-btn icon-btn w-12 h-12 text-on-surface"
          aria-label="Back to dashboard"
        >
          <Icon name="arrow_back" className="text-[24px]" />
        </button>
        <h1 className="text-title-lg text-on-surface">Settings</h1>
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 max-md:px-2 pt-2 pb-8 space-y-4">

          {/* ── Appearance ────────────────────────────────────────────────── */}
          <SettingsSection icon={<Icon name="palette" className="text-[24px]" />} title="Appearance">
            <SettingsRow title="Theme" description="Auto follows your device's light or dark setting.">
              <SegmentedButtons
                className="w-full sm:w-80"
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
                value={themeMode}
                onChange={setThemeMode}
              />
            </SettingsRow>

            {/* An add-on to dark mode rather than a theme of its own: it stays on (and usable)
                while the theme is Light, and kicks in whenever the app is dark. */}
            <SettingsRow title="AMOLED black" description="Pure black background whenever the app is dark, for OLED screens." inline>
              <Switch checked={isAmoledMode} onChange={setAmoledMode} label="AMOLED black" />
            </SettingsRow>

            <SettingsRow title="Font" description="Geist is the app's own font. System uses your device's font.">
              <SegmentedButtons
                className="w-full sm:w-80"
                options={[
                  { value: 'geist', label: 'Geist', style: { fontFamily: "'Geist Variable', sans-serif" } },
                  { value: 'system', label: 'System', style: { fontFamily: 'system-ui, -apple-system, sans-serif' } },
                ]}
                value={fontFamily}
                onChange={setFontFamily}
              />
            </SettingsRow>

            <SettingsRow title="Accent color" description="The whole app's colours are made from this one.">
              <div className="flex gap-2.5 flex-wrap">
                {ACCENT_PRESETS.map(color => (
                  <button
                    key={color}
                    onClick={() => setAccentColor(color)}
                    className="md-btn w-10 h-10 rounded-full flex items-center justify-center transition-transform"
                    style={{
                      backgroundColor: color,
                      color: contrastText(color),
                      boxShadow: accentColor.toLowerCase() === color.toLowerCase() ? `0 0 0 3px var(--app-pane), 0 0 0 5px ${color}` : undefined,
                    }}
                    title={color}
                    aria-label={`Accent colour ${color}`}
                  >
                    {accentColor.toLowerCase() === color.toLowerCase() && <Icon name="check" className="text-[24px]" />}
                  </button>
                ))}
                {/* Any colour: the colour picker sits invisibly over this round button. */}
                <label
                  className="md-btn w-10 h-10 rounded-full border-2 border-dashed border-outline flex items-center justify-center cursor-pointer relative overflow-hidden text-on-surface-variant"
                  title="Custom colour"
                >
                  <Icon name="add" className="text-[24px]" />
                  <input
                    type="color"
                    value={accentColor}
                    onChange={e => setAccentColor(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                </label>
              </div>
            </SettingsRow>

            <SettingsRow title="Color style" description={COLOR_STYLES.find(s => s.id === colorStyle)?.description}>
              {/* Each style shows three colours it makes from the current accent. */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {COLOR_STYLES.map(style => {
                  const selected = style.id === colorStyle;
                  const [primary, container, tertiary] = previewColorStyle(accentColor, style.id, isDarkMode);
                  return (
                    <button
                      key={style.id}
                      onClick={() => setColorStyle(style.id)}
                      role="radio"
                      aria-checked={selected}
                      className={`md-btn flex items-center gap-2.5 h-12 pl-2.5 pr-3 rounded-xl border text-left text-label-lg ${
                        selected ? 'border-transparent bg-secondary-container text-on-secondary-container' : 'border-outline-variant text-on-surface'
                      }`}
                    >
                      <span className="flex shrink-0 w-9 h-6 rounded-full overflow-hidden ring-1 ring-outline-variant" aria-hidden="true">
                        <span className="flex-1" style={{ backgroundColor: primary }} />
                        <span className="flex-1" style={{ backgroundColor: container }} />
                        <span className="flex-1" style={{ backgroundColor: tertiary }} />
                      </span>
                      <span className="truncate">{style.label}</span>
                    </button>
                  );
                })}
              </div>
            </SettingsRow>

            <SettingsRow title="Logo background" description="Behind channel logos, so dark and light logos both stay visible.">
              <div className="flex gap-2.5">
                {['#f1f5f9', '#ffffff', '#000000', 'transparent'].map(color => (
                  <button
                    key={color}
                    onClick={() => setLogoBgColor(color)}
                    className={`md-btn w-12 h-10 rounded-lg border ${logoBgColor === color ? 'border-transparent ring-2 ring-primary ring-offset-2 ring-offset-pane' : 'border-outline-variant'}`}
                    style={{
                      backgroundColor: color === 'transparent' ? undefined : color,
                      backgroundImage: color === 'transparent' ? 'linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%),linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%)' : undefined,
                      backgroundSize: '8px 8px',
                      backgroundPosition: '0 0,4px 4px',
                    }}
                    title={color === 'transparent' ? 'None' : color}
                  />
                ))}
              </div>
            </SettingsRow>

            <SettingsRow title="24-hour time" inline>
              <Switch checked={is24Hour} onChange={set24Hour} label="24-hour time" />
            </SettingsRow>
          </SettingsSection>

          {/* ── Channel sync ──────────────────────────────────────────────── */}
          <SettingsSection icon={<Icon name="link" className="text-[24px]" />} title="Channel sync">
            <SettingsRow
              title="Default sync settings"
              description={`What gets updated in your playlists when you add channels from a source with "Keep in sync with source" turned on, unless you pick custom settings. Changing this doesn't affect channels you've already linked.`}
            >
              {syncDefaults ? (
                <SyncFieldToggles value={syncDefaults} onChange={handleSyncDefaultsChange} />
              ) : (
                <p className="text-body-md text-on-surface-variant">Loading…</p>
              )}
            </SettingsRow>
          </SettingsSection>

          {/* ── Security ──────────────────────────────────────────────────── */}
          <SettingsSection icon={<Icon name="shield" className="text-[24px]" />} title="Security">
            <div className="px-6 py-4 space-y-4">

              {authLoading ? (
                <p className="text-body-md text-on-surface-variant">Loading…</p>
              ) : authStatusError ? (
                <div>
                  <p className="text-body-md text-error">Couldn't load security status. Check your connection.</p>
                  <button onClick={checkAuthStatus} className="md-btn btn btn-text mt-2 -ml-3">
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  {/* Status */}
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${authEnabled ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container-highest text-on-surface-variant'}`}>
                      {authEnabled ? <Icon name="lock" className="text-[24px]" /> : <Icon name="lock_open" className="text-[24px]" />}
                    </div>
                    <div>
                      <p className="text-body-lg text-on-surface">Password protection {authEnabled ? 'is on' : 'is off'}</p>
                      <p className="text-body-sm text-on-surface-variant">
                        {authEnabled ? 'Opening m3u4me asks for your password.' : 'Anyone on your network can open m3u4me.'}
                      </p>
                    </div>
                  </div>

                  {/* Action buttons */}
                  {securityAction === 'none' && (
                    <div className="flex flex-wrap gap-2">
                      {!authEnabled && (
                        <button onClick={() => { resetSecurityForm(); setSecurityAction('enable'); }} className="md-btn btn btn-filled">
                          Turn on password
                        </button>
                      )}
                      {authEnabled && (
                        <>
                          <button onClick={() => { resetSecurityForm(); setSecurityAction('change'); }} className="md-btn btn btn-tonal">
                            Change password
                          </button>
                          <button onClick={() => { resetSecurityForm(); setSecurityAction('remove'); }} className="md-btn btn btn-outlined text-error">
                            Remove password
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* Recovery key display */}
                  {recoveryKey && (
                    <div className="rounded-xl bg-primary-container text-on-primary-container p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Icon name="key" className="text-[24px]" />
                        <span className="text-title-sm">Your recovery key</span>
                      </div>
                      <p className="text-body-sm">Save this key in a safe place. You'll need it if you forget your password. It won't be shown again.</p>
                      <div className="flex items-center gap-2 pl-4 pr-1 h-12 rounded-lg bg-pane text-on-surface">
                        <code className="flex-1 text-center text-body-md font-mono font-semibold tracking-wider">
                          {recoveryKey}
                        </code>
                        <button onClick={handleCopyKey} className="md-btn icon-btn" title="Copy">
                          {copied ? <Icon name="check" className="text-[24px] text-success" /> : <Icon name="content_copy" className="text-[24px]" />}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Success message */}
                  {securitySuccess && !recoveryKey && (
                    <p className="text-body-md text-success flex items-center gap-1.5">
                      <Icon name="check" className="text-[24px]" />
                      {securitySuccess}
                    </p>
                  )}

                  {/* Enable / Change password form */}
                  {(securityAction === 'enable' || securityAction === 'change') && !recoveryKey && (
                    <div className="space-y-3 pt-1">
                      {securityAction === 'change' && (
                        <div className="relative">
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={currentPassword}
                            onChange={e => setCurrentPassword(e.target.value)}
                            placeholder="Current password"
                            className={passwordInputCls}
                          />
                          {eyeButton}
                        </div>
                      )}
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          placeholder={securityAction === 'change' ? 'New password' : 'Password'}
                          className={passwordInputCls}
                          autoFocus
                        />
                        {securityAction === 'enable' && eyeButton}
                      </div>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSetPassword()}
                        placeholder="Confirm password"
                        className="field h-12 max-md:text-base"
                      />
                      {securityError && <p className="text-body-sm text-error">{securityError}</p>}
                      <div className="flex gap-2 pt-1">
                        <button onClick={handleSetPassword} disabled={savingPassword} className="md-btn btn btn-filled">
                          {savingPassword ? 'Saving…' : securityAction === 'change' ? 'Change password' : 'Set password'}
                        </button>
                        <button onClick={resetSecurityForm} className="md-btn btn btn-text">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Remove password form */}
                  {securityAction === 'remove' && (
                    <div className="space-y-3 pt-1">
                      <p className="text-body-md text-on-surface-variant">Enter your current password to remove password protection.</p>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={currentPassword}
                          onChange={e => setCurrentPassword(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleRemovePassword()}
                          placeholder="Current password"
                          className={passwordInputCls}
                          autoFocus
                        />
                        {eyeButton}
                      </div>
                      {securityError && <p className="text-body-sm text-error">{securityError}</p>}
                      <div className="flex gap-2 pt-1">
                        <button onClick={handleRemovePassword} disabled={savingPassword} className="md-btn btn bg-error text-on-error">
                          {savingPassword ? 'Removing…' : 'Remove password'}
                        </button>
                        <button onClick={resetSecurityForm} className="md-btn btn btn-text">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </SettingsSection>

          {/* ── Backup ────────────────────────────────────────────────────── */}
          <SettingsSection icon={<Icon name="database" className="text-[24px]" />} title="Backup">
            <SettingsRow
              title="Save everything in one file"
              description="Your playlists, sources, TV guides and settings. Use it to move m3u4me to a new server, or to go back to how things were. It contains your providers' logins, so keep it somewhere private. Your m3u4me password isn't included."
            >
              <div className="flex flex-wrap gap-2">
                <button onClick={handleDownloadBackup} disabled={downloadingBackup} className="md-btn btn btn-filled">
                  {downloadingBackup ? <Icon name="progress_activity" className="text-[20px] animate-spin" /> : <Icon name="download" className="text-[20px]" />}
                  Download backup
                </button>
                <button onClick={() => setRestoreOpen(true)} className="md-btn btn btn-outlined">
                  <Icon name="settings_backup_restore" className="text-[20px]" />
                  Restore from backup…
                </button>
              </div>
            </SettingsRow>
          </SettingsSection>

          {/* ── About ─────────────────────────────────────────────────────── */}
          <SettingsSection icon={<Icon name="info" className="text-[24px]" />} title="About">
            <div className="px-6 pt-4 pb-6 flex flex-col items-center text-center">
              <div className="mb-4">
                <Logo className="h-10 w-auto text-on-surface" />
              </div>

              <p className="text-body-md text-on-surface-variant max-w-sm">
                Your new favourite IPTV playlist manager!
              </p>
              <p className="text-body-sm text-on-surface-variant mt-1.5 max-w-sm">
                This app is AI-generated. Nothing ever leaves your device, no data is being collected.
              </p>

              {/* GitHub & Buy Me a Coffee buttons */}
              <div className="mt-5 mb-5 flex flex-wrap justify-center items-center gap-2">
                <a href={GITHUB_REPO} target="_blank" rel="noopener noreferrer" className="md-btn btn btn-tonal">
                  <Icon name="code" className="text-[20px]" />
                  View on GitHub
                </a>
                <a
                  href={BMC_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="md-btn btn"
                  style={{ backgroundColor: BMC_YELLOW, color: contrastText(BMC_YELLOW) }}
                >
                  <Icon name="coffee" className="text-[20px]" />
                  Buy me a coffee
                </a>
              </div>

              {/* Version & Update */}
              <div className="flex flex-col items-center gap-2">
                <span className="text-body-sm text-on-surface-variant font-mono">
                  {versionInfo.versionCheckFailed ? 'Couldn\'t determine app version' : `v${versionInfo.current}`}
                </span>
                {versionInfo.updateCheckFailed && !versionInfo.versionCheckFailed && (
                  <span className="text-body-sm text-on-surface-variant">
                    Couldn't check for updates
                  </span>
                )}
                {versionInfo.updateAvailable && versionInfo.releaseUrl && (
                  <a
                    href={versionInfo.releaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="md-btn inline-flex items-center gap-1.5 h-8 px-3 rounded-lg mt-2 text-label-lg bg-primary-container text-on-primary-container"
                  >
                    <Icon name="arrow_circle_up" className="text-[20px]" />
                    Update available: v{versionInfo.latest}
                  </a>
                )}
              </div>
            </div>
          </SettingsSection>

        </div>
      </div>

      {restoreOpen && (
        <Dialog onClose={closeRestore} dismissible={!restoring} maxWidth="max-w-md">
          <h2 className="text-headline-sm text-on-surface px-6 pt-6 pb-4">Restore from backup</h2>
          <div className="px-6 space-y-4">
            <p className="text-body-md text-on-surface-variant">
              This replaces all your playlists, sources, TV guides and settings with the ones in the backup. A copy of what you have now is kept in m3u4me's data folder on the server, just in case.
            </p>
            <BackupDropZone file={restoreFile} onFileChange={f => { setRestoreFile(f); setRestoreError(''); }} disabled={restoring} />
            {restoreError && <p className="text-body-sm text-error">{restoreError}</p>}
          </div>
          <div className="flex justify-end gap-2 px-6 py-6">
            <button onClick={closeRestore} disabled={restoring} className="md-btn btn btn-text">
              Cancel
            </button>
            <button onClick={handleRestore} disabled={!restoreFile || restoring} className="md-btn btn btn-text text-error">
              {restoring && <Icon name="progress_activity" className="text-[20px] animate-spin" />}
              Replace everything
            </button>
          </div>
        </Dialog>
      )}

      {isPhone && <MobileTabBar active="settings" />}
      {/* Error/info snackbar, same as Dashboard and Home, so failures here aren't silent */}
      <Toast withTabBar />
    </div>
  );
}

/** One card on the Settings screen: an icon and title, then its rows. */
function SettingsSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-pane border border-pane-border rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-6 pt-5 pb-1">
        <span className="text-primary flex">{icon}</span>
        <h2 className="text-title-md text-on-surface">{title}</h2>
      </div>
      <div className="divide-y divide-outline-variant/60">{children}</div>
    </section>
  );
}

/**
 * One setting: its name and an optional explanation, with the control below (or on the right
 * with `inline`, for a single switch).
 */
function SettingsRow({ title, description, inline = false, children }: { title: string; description?: string; inline?: boolean; children: React.ReactNode }) {
  return (
    <div className={`px-6 py-4 ${inline ? 'flex items-center justify-between gap-4' : 'space-y-3'}`}>
      <div className="min-w-0">
        <p className="text-body-lg text-on-surface">{title}</p>
        {description && <p className="text-body-sm text-on-surface-variant mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}
