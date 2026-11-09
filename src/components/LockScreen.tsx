import React, { useState } from 'react';
import { api, setSessionToken } from '../apiClient';
import { useStore } from '../store';
import { Logo } from './Logo';
import { Lock, KeyRound, ArrowLeft, Eye, EyeOff, Copy, Check } from 'lucide-react';
import { copyToClipboard } from '../utils/copyToClipboard';

interface LockScreenProps {
  onUnlock: () => void;
}

export default function LockScreen({ onUnlock }: LockScreenProps) {
  const { accentColor } = useStore();
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
      <div className="min-h-dvh flex items-center justify-center bg-gray-100 dark:bg-[#121212] amoled:dark:bg-black px-4">
        <div className="md-dialog w-full max-w-sm bg-white dark:bg-[#272727] amoled:dark:bg-[#1a1a1a] rounded-lg elev-24 overflow-hidden">
          <div className="px-6 pt-8 pb-4 text-center">
            <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: accentColor + '18' }}>
              <KeyRound className="h-6 w-6" style={{ color: accentColor }} />
            </div>
            <h2 className="text-xl font-medium text-gray-900 dark:text-white mb-2">Password Reset Successful</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">Save your new recovery key. You won't be able to see it again.</p>
          </div>
          <div className="px-6 pb-4">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10">
              <code className="flex-1 text-center text-sm font-mono font-medium text-gray-900 dark:text-white tracking-wider">
                {newRecoveryKey}
              </code>
              <button
                onClick={handleCopyKey}
                className="md-btn p-1.5 rounded-full text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white"
                title="Copy recovery key"
              >
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            {copyFailed && (
              <p className="text-xs text-red-500 dark:text-red-400 text-center mt-2">
                Couldn't copy the recovery key. Select the key and copy it yourself, then keep it somewhere safe.
              </p>
            )}
          </div>
          <div className="px-6 pb-8 pt-2">
            <button
              onClick={onUnlock}
              className="md-btn w-full h-10 rounded-lg text-sm font-medium text-white transition-colors"
              style={{ backgroundColor: accentColor }}
            >
              Continue to App
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Recovery mode
  if (isRecovery) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-gray-100 dark:bg-[#121212] amoled:dark:bg-black px-4">
        <div className="md-dialog w-full max-w-sm bg-white dark:bg-[#272727] amoled:dark:bg-[#1a1a1a] rounded-lg elev-24 overflow-hidden">
          <div className="px-6 pt-8 pb-4 text-center">
            <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: accentColor + '18' }}>
              <KeyRound className="h-6 w-6" style={{ color: accentColor }} />
            </div>
            <h2 className="text-xl font-medium text-gray-900 dark:text-white mb-1">Account Recovery</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Enter your recovery key and a new password</p>
          </div>
          <div className="px-6 pb-2 space-y-3">
            <input
              type="text"
              value={recoveryKey}
              onChange={e => setRecoveryKey(e.target.value)}
              placeholder="Recovery key (XXXX-XXXX-...)"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none bg-transparent text-gray-900 dark:text-white placeholder-gray-400"
              style={{ '--tw-ring-color': accentColor } as React.CSSProperties}
              onFocus={e => (e.target.style.borderColor = accentColor)}
              onBlur={e => (e.target.style.borderColor = '')}
              autoFocus
            />
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleRecover()}
                placeholder="New password"
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none bg-transparent text-gray-900 dark:text-white placeholder-gray-400"
                style={{ '--tw-ring-color': accentColor } as React.CSSProperties}
                onFocus={e => (e.target.style.borderColor = accentColor)}
                onBlur={e => (e.target.style.borderColor = '')}
              />
              <button
                type="button"
                onClick={() => setShowPassword(p => !p)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {error && <p className="text-xs text-red-500 dark:text-red-400 text-center">{error}</p>}
          </div>
          <div className="px-6 pb-4 pt-3 space-y-2">
            <button
              onClick={handleRecover}
              disabled={loading || !recoveryKey.trim() || !newPassword.trim()}
              className="md-btn w-full h-10 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-40"
              style={{ backgroundColor: accentColor }}
            >
              {loading ? 'Recovering…' : 'Reset Password'}
            </button>
            <button
              onClick={() => { setIsRecovery(false); setError(''); setRecoveryKey(''); setNewPassword(''); }}
              className="md-btn w-full h-10 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5"
            >
              <span className="flex items-center justify-center gap-1.5">
                <ArrowLeft className="h-4 w-4" />
                Back to Login
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Login mode
  return (
    <div className="min-h-dvh flex items-center justify-center bg-gray-100 dark:bg-[#121212] amoled:dark:bg-black px-4">
      <div className="w-full max-w-sm bg-white dark:bg-[#272727] amoled:dark:bg-[#1a1a1a] rounded-lg elev-24 overflow-hidden">
        <div className="px-6 pt-8 pb-4 flex flex-col items-center">
          <div className="px-5 py-3 rounded-lg mb-5">
            <Logo className="h-7 w-auto text-gray-900 dark:text-white" />
          </div>
          <div className="mx-auto w-10 h-10 rounded-full flex items-center justify-center mb-3" style={{ backgroundColor: accentColor + '18' }}>
            <Lock className="h-5 w-5" style={{ color: accentColor }} />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Enter your password to continue</p>
        </div>
        <div className="px-6 pb-2">
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="Password"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none bg-transparent text-gray-900 dark:text-white placeholder-gray-400"
              style={{ '--tw-ring-color': accentColor } as React.CSSProperties}
              onFocus={e => (e.target.style.borderColor = accentColor)}
              onBlur={e => (e.target.style.borderColor = '')}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword(p => !p)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {error && <p className="text-xs text-red-500 dark:text-red-400 text-center mt-2">{error}</p>}
        </div>
        <div className="px-6 pb-6 pt-3 space-y-2">
          <button
            onClick={handleLogin}
            disabled={loading || !password.trim()}
            className="md-btn w-full h-10 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-40"
            style={{ backgroundColor: accentColor }}
          >
            {loading ? 'Signing in…' : 'Unlock'}
          </button>
          <button
            onClick={() => { setIsRecovery(true); setError(''); setPassword(''); }}
            className="md-btn w-full text-center text-xs py-2 rounded transition-colors"
            style={{ color: accentColor }}
          >
            Forgot password?
          </button>
        </div>
      </div>
    </div>
  );
}
