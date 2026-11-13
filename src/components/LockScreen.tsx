import React, { useState } from 'react';
import { api, setSessionToken } from '../apiClient';
import { Logo } from './Logo';
import { copyToClipboard } from '../utils/copyToClipboard';
import Icon from './Icon';

interface LockScreenProps {
  onUnlock: () => void;
}

export default function LockScreen({ onUnlock }: LockScreenProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Recovery state
  const [isRecovery, setIsRecovery] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRecoveryKey, setNewRecoveryKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const handleLogin = async () => {
    if (!password.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.login(password);
      if (res.ok && res.token) {
        setSessionToken(res.token);
        onUnlock();
      } else {
        setError(res.error || 'Incorrect password');
      }
    } catch (e) {
      // api.login/api.recover return wrong-password errors as res.error above, so landing here
      // means the server couldn't be reached at all.
      console.error(e);
      setError("Couldn't reach m3u4me. Check that it's still running, then try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRecover = async () => {
    if (!recoveryKey.trim() || !newPassword.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.recover(recoveryKey, newPassword);
      if (res.ok && res.token) {
        setSessionToken(res.token);
        setNewRecoveryKey(res.recoveryKey);
      } else {
        setError(res.error || 'Invalid recovery key');
      }
    } catch (e) {
      // api.login/api.recover return wrong-password errors as res.error above, so landing here
      // means the server couldn't be reached at all.
      console.error(e);
      setError("Couldn't reach m3u4me. Check that it's still running, then try again.");
    } finally {
      setLoading(false);
    }
  };

  // Only a real copy shows the checkmark: a false "copied" here could cost someone their
  // recovery key. A failure is shown inline, because <Toast /> isn't mounted on the lock screen.
  const handleCopyKey = async () => {
    if (!newRecoveryKey) return;
    if (await copyToClipboard(newRecoveryKey)) {
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopyFailed(true);
    }
  };

  // After recovery: show new recovery key
  if (newRecoveryKey) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-page px-4">
        <div className="md-dialog w-full max-w-sm bg-dialog rounded-[28px] shadow-level-3 overflow-hidden">
          <div className="px-6 pt-8 pb-4 text-center">
            <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4 bg-secondary-container text-on-secondary-container">
              <Icon name="key" className="text-[24px]" />
            </div>
            <h2 className="text-headline-sm text-on-surface mb-2">Password reset</h2>
            <p className="text-body-md text-on-surface-variant">Save your new recovery key. You won't be able to see it again.</p>
          </div>
          <div className="px-6 pb-4">
            <div className="flex items-center gap-2 pl-4 pr-1 py-1.5 rounded-xl bg-surface-container-highest">
              <code className="flex-1 text-center text-body-md font-mono font-medium text-on-surface">
                {newRecoveryKey}
              </code>
              <button
                onClick={handleCopyKey}
                className="md-btn icon-btn"
                title="Copy recovery key"
              >
                {copied ? <Icon name="check" className="text-[24px] text-success" /> : <Icon name="content_copy" className="text-[24px]" />}
              </button>
            </div>
            {copyFailed && (
              <p className="text-body-sm text-error text-center mt-2">
                Couldn't copy the recovery key. Select the key and copy it yourself, then keep it somewhere safe.
              </p>
            )}
          </div>
          <div className="px-6 pb-8 pt-2">
            <button
              onClick={onUnlock}
              className="md-btn btn btn-filled w-full"
            >
              Continue to the app
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Recovery mode
  if (isRecovery) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-page px-4">
        <div className="md-dialog w-full max-w-sm bg-dialog rounded-[28px] shadow-level-3 overflow-hidden">
          <div className="px-6 pt-8 pb-4 text-center">
            <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4 bg-secondary-container text-on-secondary-container">
              <Icon name="key" className="text-[24px]" />
            </div>
            <h2 className="text-headline-sm text-on-surface mb-1">Account recovery</h2>
            <p className="text-body-md text-on-surface-variant">Enter your recovery key and a new password</p>
          </div>
          <div className="px-6 pb-2 space-y-3">
            <input
              type="text"
              value={recoveryKey}
              onChange={e => setRecoveryKey(e.target.value)}
              placeholder="Recovery key (XXXX-XXXX-...)"
              className="field h-12 font-mono max-md:text-base"
              autoFocus
            />
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleRecover()}
                placeholder="New password"
                className="field h-12 pr-12 max-md:text-base"
              />
              <button
                type="button"
                onClick={() => setShowPassword(p => !p)}
                className="md-btn icon-btn absolute right-1 top-1/2 -translate-y-1/2"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <Icon name="visibility_off" className="text-[24px]" /> : <Icon name="visibility" className="text-[24px]" />}
              </button>
            </div>
            {error && <p className="text-body-sm text-error text-center">{error}</p>}
          </div>
          <div className="px-6 pb-4 pt-3 space-y-2">
            <button
              onClick={handleRecover}
              disabled={loading || !recoveryKey.trim() || !newPassword.trim()}
              className="md-btn btn btn-filled w-full"
            >
              {loading ? 'Recovering…' : 'Reset password'}
            </button>
            <button
              onClick={() => { setIsRecovery(false); setError(''); setRecoveryKey(''); setNewPassword(''); }}
              className="md-btn btn btn-text w-full"
            >
              <span className="flex items-center justify-center gap-1.5">
                <Icon name="arrow_back" className="text-[20px]" />
                Back to login
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Login mode
  return (
    <div className="min-h-dvh flex items-center justify-center bg-page px-4">
      <div className="md-dialog w-full max-w-sm bg-dialog rounded-[28px] shadow-level-3 overflow-hidden">
        <div className="px-6 pt-8 pb-4 flex flex-col items-center">
          <div className="px-5 py-3 rounded-lg mb-5">
            <Logo className="h-7 w-auto text-on-surface" />
          </div>
          <div className="mx-auto w-10 h-10 rounded-full flex items-center justify-center mb-3 bg-secondary-container text-on-secondary-container">
            <Icon name="lock" className="text-[24px]" />
          </div>
          <p className="text-body-md text-on-surface-variant">Enter your password to continue</p>
        </div>
        <div className="px-6 pb-2">
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="Password"
              className="field h-12 pr-12 max-md:text-base"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword(p => !p)}
              className="md-btn icon-btn absolute right-1 top-1/2 -translate-y-1/2"
              tabIndex={-1}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <Icon name="visibility_off" className="text-[24px]" /> : <Icon name="visibility" className="text-[24px]" />}
            </button>
          </div>
          {error && <p className="text-body-sm text-error text-center mt-2">{error}</p>}
        </div>
        <div className="px-6 pb-6 pt-3 space-y-2">
          <button
            onClick={handleLogin}
            disabled={loading || !password.trim()}
            className="md-btn btn btn-filled w-full"
          >
            {loading ? 'Signing in…' : 'Unlock'}
          </button>
          <button
            onClick={() => { setIsRecovery(true); setError(''); setPassword(''); }}
            className="md-btn btn btn-text w-full"
          >
            Forgot password?
          </button>
        </div>
      </div>
    </div>
  );
}
