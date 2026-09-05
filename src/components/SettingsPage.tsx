import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { api, clearSessionToken } from '../apiClient';
import { ArrowLeft, Shield, Palette, Eye, EyeOff, Copy, Check, KeyRound, Lock, Unlock, Github, ArrowUpCircle, Info, Coffee } from 'lucide-react';
import { Logo } from './Logo';
import { useVersionInfo } from './AppInfo';
import { contrastText } from '../store';

const ACCENT_PRESETS = [
  '#FF2960', '#FF5D29', '#22D5A7', '#29CBFF',
  '#5D29FF', '#607083',
];

export default function SettingsPage() {
  const navigate = useNavigate();
  const {
    isDarkMode, setDarkMode,
    isAmoledMode, setAmoledMode,
    logoBgColor, setLogoBgColor,
    accentColor, setAccentColor,
    is24Hour, set24Hour,
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
        setRecoveryKey(res.recoveryKey);
        setAuthEnabled(true);
        setSecuritySuccess(authEnabled ? 'Password changed successfully' : 'Password protection enabled');
        setPassword('');
        setConfirmPassword('');
        setCurrentPassword('');
      } else {
        setSecurityError(res.error || 'Failed to set password');
      }
    } catch {
      setSecurityError('Connection error');
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
    } catch {
      setSecurityError('Connection error');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleCopyKey = async () => {
    if (!recoveryKey) return;
    await navigator.clipboard.writeText(recoveryKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="md-page-in flex flex-col h-screen overflow-hidden bg-gray-100 dark:bg-[#121212] amoled:dark:bg-black font-sans">
      {/* Top bar */}
      <nav className="h-16 shrink-0 z-30 bg-white dark:bg-[#1e1e1e] amoled:dark:bg-[#0a0a0a] elev-4 flex items-center px-2 gap-2">
        <button
          onClick={() => navigate(-1)}
          className="md-btn p-2 rounded-full text-gray-600 dark:text-gray-300"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="text-lg font-medium text-gray-900 dark:text-white">Settings</h1>
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">

          {/* ── Appearance ────────────────────────────────────────────────── */}
          <section className="bg-white dark:bg-[#1e1e1e] amoled:dark:bg-[#0a0a0a] rounded-lg elev-1 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-white/8">
              <Palette className="h-5 w-5" style={{ color: accentColor }} />
              <h2 className="text-base font-medium text-gray-900 dark:text-white">Appearance</h2>
            </div>
            <div className="px-5 py-4 space-y-5">

              {/* Dark mode */}
              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-800 dark:text-gray-200">Dark Mode</label>
                <button
                  role="switch" aria-checked={isDarkMode}
                  onClick={() => { const v = !isDarkMode; setDarkMode(v); if (!v) setAmoledMode(false); }}
                  className={`w-11 h-6 rounded-full relative transition-colors ${isDarkMode ? '' : 'bg-gray-300 dark:bg-gray-600'}`}
                  style={isDarkMode ? { backgroundColor: accentColor } : undefined}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isDarkMode ? 'translate-x-5' : ''}`} />
                </button>
              </div>

              {/* AMOLED */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm text-gray-800 dark:text-gray-200">AMOLED Dark</label>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Pure black for OLED displays</p>
                </div>
                <button
                  role="switch" aria-checked={isAmoledMode}
                  onClick={() => { const v = !isAmoledMode; setAmoledMode(v); if (v) setDarkMode(true); }}
                  className={`w-11 h-6 rounded-full relative transition-colors ${isAmoledMode ? '' : 'bg-gray-300 dark:bg-gray-600'}`}
                  style={isAmoledMode ? { backgroundColor: accentColor } : undefined}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isAmoledMode ? 'translate-x-5' : ''}`} />
                </button>
              </div>

              {/* Logo background */}
              <div>
                <label className="text-sm text-gray-800 dark:text-gray-200 block mb-2">Logo Background</label>
                <div className="flex gap-2">
                  {['#f1f5f9', '#ffffff', '#000000', 'transparent'].map(color => (
                    <button
                      key={color}
                      onClick={() => setLogoBgColor(color)}
                      className={`md-btn w-8 h-8 rounded border-2 transition-all ${logoBgColor === color ? 'scale-110' : 'border-gray-300 dark:border-gray-600'}`}
                      style={{
                        backgroundColor: color === 'transparent' ? undefined : color,
                        borderColor: logoBgColor === color ? accentColor : undefined,
                        backgroundImage: color === 'transparent' ? 'linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%),linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%)' : undefined,
                        backgroundSize: '8px 8px',
                        backgroundPosition: '0 0,4px 4px',
                      }}
                      title={color}
                    />
                  ))}
                </div>
              </div>

              {/* Accent color */}
              <div>
                <label className="text-sm text-gray-800 dark:text-gray-200 block mb-2">Accent Color</label>
                <div className="flex gap-2 flex-wrap">
                  {ACCENT_PRESETS.map(color => (
                    <button
                      key={color}
                      onClick={() => setAccentColor(color)}
                      className="md-btn w-8 h-8 rounded-full border-2 transition-all"
                      style={{
                        backgroundColor: color,
                        borderColor: accentColor === color ? 'white' : 'transparent',
                        boxShadow: accentColor === color ? `0 0 0 2px ${color}` : undefined,
                        transform: accentColor === color ? 'scale(1.15)' : undefined,
                      }}
                      title={color}
                    />
                  ))}
                  <label
                    className="w-8 h-8 rounded-full border-2 border-dashed border-gray-400 dark:border-gray-500 flex items-center justify-center cursor-pointer relative overflow-hidden"
                    title="Custom color"
                  >
                    <span className="text-gray-400 dark:text-gray-500 text-xs leading-none select-none">+</span>
                    <input
                      type="color"
                      value={accentColor}
                      onChange={e => setAccentColor(e.target.value)}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                  </label>
                </div>
              </div>

              {/* 24-Hour Time */}
              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-800 dark:text-gray-200">24-Hour Time</label>
                <button
                  role="switch" aria-checked={is24Hour}
                  onClick={() => set24Hour(!is24Hour)}
                  className={`w-11 h-6 rounded-full relative transition-colors ${is24Hour ? '' : 'bg-gray-300 dark:bg-gray-600'}`}
                  style={is24Hour ? { backgroundColor: accentColor } : undefined}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${is24Hour ? 'translate-x-5' : ''}`} />
                </button>
              </div>

            </div>
          </section>

          {/* ── Security ──────────────────────────────────────────────────── */}
          <section className="bg-white dark:bg-[#1e1e1e] amoled:dark:bg-[#0a0a0a] rounded-lg elev-1 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-white/8">
              <Shield className="h-5 w-5" style={{ color: accentColor }} />
              <h2 className="text-base font-medium text-gray-900 dark:text-white">Security</h2>
            </div>
            <div className="px-5 py-4 space-y-4">

              {authLoading ? (
                <p className="text-sm text-gray-400">Loading…</p>
              ) : authStatusError ? (
                <div>
                  <p className="text-sm text-red-500 dark:text-red-400">Couldn't load security status. Check your connection.</p>
                  <button
                    onClick={checkAuthStatus}
                    className="md-btn mt-2 text-xs font-medium underline text-gray-600 dark:text-gray-300"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  {/* Status */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {authEnabled
                        ? <Lock className="h-4 w-4 text-green-500" />
                        : <Unlock className="h-4 w-4 text-gray-400" />
                      }
                      <span className="text-sm text-gray-800 dark:text-gray-200">
                        Password protection {authEnabled ? 'enabled' : 'disabled'}
                      </span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  {securityAction === 'none' && (
                    <div className="flex flex-wrap gap-2">
                      {!authEnabled && (
                        <button
                          onClick={() => { resetSecurityForm(); setSecurityAction('enable'); }}
                          className="md-btn h-9 px-4 rounded-lg text-sm font-medium text-white"
                          style={{ backgroundColor: accentColor }}
                        >
                          Enable Password
                        </button>
                      )}
                      {authEnabled && (
                        <>
                          <button
                            onClick={() => { resetSecurityForm(); setSecurityAction('change'); }}
                            className="md-btn h-9 px-4 rounded-lg text-sm font-medium text-white"
                            style={{ backgroundColor: accentColor }}
                          >
                            Change Password
                          </button>
                          <button
                            onClick={() => { resetSecurityForm(); setSecurityAction('remove'); }}
                            className="md-btn h-9 px-4 rounded-lg text-sm font-medium text-red-600 dark:text-red-400 border border-red-300 dark:border-red-500/30"
                          >
                            Remove Password
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* Recovery key display */}
                  {recoveryKey && (
                    <div className="rounded-lg border-2 p-4 space-y-3" style={{ borderColor: accentColor + '40', backgroundColor: accentColor + '08' }}>
                      <div className="flex items-center gap-2">
                        <KeyRound className="h-4 w-4" style={{ color: accentColor }} />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">Your Recovery Key</span>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Save this key in a safe place. You'll need it if you forget your password. It won't be shown again.</p>
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10">
                        <code className="flex-1 text-center text-sm font-mono font-medium text-gray-900 dark:text-white tracking-wider">
                          {recoveryKey}
                        </code>
                        <button
                          onClick={handleCopyKey}
                          className="md-btn p-1.5 rounded-full text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white"
                          title="Copy"
                        >
                          {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Success message */}
                  {securitySuccess && !recoveryKey && (
                    <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1.5">
                      <Check className="h-4 w-4" />
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
                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none bg-transparent text-gray-900 dark:text-white placeholder-gray-400"
                            onFocus={e => (e.target.style.borderColor = accentColor)}
                            onBlur={e => (e.target.style.borderColor = '')}
                          />
                          <button type="button" onClick={() => setShowPasswordVis(p => !p)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400" tabIndex={-1}>
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      )}
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          placeholder={securityAction === 'change' ? 'New password' : 'Password'}
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none bg-transparent text-gray-900 dark:text-white placeholder-gray-400"
                          onFocus={e => (e.target.style.borderColor = accentColor)}
                          onBlur={e => (e.target.style.borderColor = '')}
                          autoFocus
                        />
                        {securityAction === 'enable' && (
                          <button type="button" onClick={() => setShowPasswordVis(p => !p)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400" tabIndex={-1}>
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSetPassword()}
                        placeholder="Confirm password"
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none bg-transparent text-gray-900 dark:text-white placeholder-gray-400"
                        onFocus={e => (e.target.style.borderColor = accentColor)}
                        onBlur={e => (e.target.style.borderColor = '')}
                      />
                      {securityError && <p className="text-xs text-red-500 dark:text-red-400">{securityError}</p>}
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={handleSetPassword}
                          disabled={savingPassword}
                          className="md-btn h-9 px-4 rounded-lg text-sm font-medium text-white disabled:opacity-40"
                          style={{ backgroundColor: accentColor }}
                        >
                          {savingPassword ? 'Saving…' : securityAction === 'change' ? 'Change Password' : 'Set Password'}
                        </button>
                        <button
                          onClick={resetSecurityForm}
                          className="md-btn h-9 px-4 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Remove password form */}
                  {securityAction === 'remove' && (
                    <div className="space-y-3 pt-1">
                      <p className="text-sm text-gray-600 dark:text-gray-400">Enter your current password to remove password protection.</p>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={currentPassword}
                          onChange={e => setCurrentPassword(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleRemovePassword()}
                          placeholder="Current password"
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none bg-transparent text-gray-900 dark:text-white placeholder-gray-400"
                          onFocus={e => (e.target.style.borderColor = accentColor)}
                          onBlur={e => (e.target.style.borderColor = '')}
                          autoFocus
                        />
                        <button type="button" onClick={() => setShowPasswordVis(p => !p)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400" tabIndex={-1}>
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {securityError && <p className="text-xs text-red-500 dark:text-red-400">{securityError}</p>}
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={handleRemovePassword}
                          disabled={savingPassword}
                          className="md-btn h-9 px-4 rounded-lg text-sm font-medium text-white bg-red-600 disabled:opacity-40"
                        >
                          {savingPassword ? 'Removing…' : 'Remove Password'}
                        </button>
                        <button
                          onClick={resetSecurityForm}
                          className="md-btn h-9 px-4 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          {/* ── About ─────────────────────────────────────────────────────── */}
          <section className="bg-white dark:bg-[#1e1e1e] amoled:dark:bg-[#0a0a0a] rounded-lg elev-1 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-white/8">
              <Info className="h-5 w-5" style={{ color: accentColor }} />
              <h2 className="text-base font-medium text-gray-900 dark:text-white">About</h2>
            </div>
            <div className="px-5 py-6 flex flex-col items-center text-center">
              {/* Logo */}
              <div className="mb-4">
                <Logo className="h-10 w-auto text-gray-900 dark:text-white" />
              </div>

              {/* Description */}
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed max-w-sm">
                Your new favourite IPTV playlist manager!
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1.5 leading-relaxed max-w-sm">
                This app is AI-generated. Nothing ever leaves your device, no data is being collected.
              </p>

              {/* GitHub & Buy Me a Coffee buttons */}
              <div className="mt-5 mb-5 flex items-center gap-3">
                <a
                  href={GITHUB_REPO}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 h-9 px-5 rounded-full text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: accentColor,
                    color: contrastText(accentColor),
                  }}
                >
                  <Github className="h-4 w-4" />
                  View on GitHub
                </a>
                <a
                  href={BMC_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 h-9 px-5 rounded-full text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: BMC_YELLOW,
                    color: contrastText(BMC_YELLOW),
                  }}
                >
                  <Coffee className="h-4 w-4" />
                  Buy me a coffee
                </a>
              </div>

              {/* Version & Update */}
              <div className="flex flex-col items-center gap-2">
                <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">
                  {versionInfo.versionCheckFailed ? 'Couldn\'t determine app version' : `v${versionInfo.current}`}
                </span>
                {versionInfo.updateCheckFailed && !versionInfo.versionCheckFailed && (
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    Couldn't check for updates
                  </span>
                )}
                {versionInfo.updateAvailable && versionInfo.releaseUrl && (
                  <a
                    href={versionInfo.releaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors mt-2"
                    style={{ backgroundColor: accentColor + '18', color: accentColor }}
                  >
                    <ArrowUpCircle className="h-3.5 w-3.5" />
                    Update available: v{versionInfo.latest}
                  </a>
                )}
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
