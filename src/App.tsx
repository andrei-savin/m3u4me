import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import Dashboard from './components/Dashboard';
import LockScreen from './components/LockScreen';
import SettingsPage from './components/SettingsPage';
import { useStore, notifyError } from './store';
import { api, getSessionToken } from './apiClient';
import { updateFavicon } from './utils/favicon';

function AppContent() {
  const { isDarkMode, isAmoledMode, accentColor } = useStore();
  const [authChecked, setAuthChecked] = useState(false);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    updateFavicon(accentColor);
  }, [accentColor]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      document.documentElement.style.colorScheme = 'dark';
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.style.colorScheme = 'light';
    }
    if (isAmoledMode) {
      document.documentElement.classList.add('amoled');
    } else {
      document.documentElement.classList.remove('amoled');
    }
  }, [isDarkMode, isAmoledMode]);

  // Check auth status on mount
  useEffect(() => {
    api.getAuthStatus().then((res: any) => {
      if (res.enabled && !getSessionToken()) {
        setLocked(true);
      }
      setAuthChecked(true);
    }).catch((e) => {
      console.error(e);
      notifyError(e, 'Could not connect to the server. Some data may fail to load.');
      setAuthChecked(true);
    });
  }, []);

  // Listen for auth-expired events (401 from API)
  useEffect(() => {
    const handler = () => setLocked(true);
    window.addEventListener('auth-expired', handler);
    return () => window.removeEventListener('auth-expired', handler);
  }, []);

  if (!authChecked) return null; // Brief flash prevention

  if (locked) {
    return <LockScreen onUnlock={() => setLocked(false)} />;
  }

  return (
    <Routes>
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/playlists" element={<Dashboard activeView="playlists" />} />
      <Route path="/sources" element={<Dashboard activeView="channels" />} />
      <Route path="/epg" element={<Dashboard activeView="epg" />} />
      <Route path="*" element={<Navigate to="/playlists" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
