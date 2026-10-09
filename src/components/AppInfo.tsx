import { useEffect, useState } from 'react';
import { api } from '../apiClient';

const GITHUB_API_LATEST = 'https://api.github.com/repos/andrei-savin/m3u4me/releases/latest';

interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  /** Set when the local /api/version check itself failed — we don't even know our own version. */
  versionCheckFailed: boolean;
  /** Set when the local check succeeded but reaching GitHub for the latest release failed. */
  updateCheckFailed: boolean;
}

/** Compares two semver strings. Returns 1 if b > a, -1 if a > b, 0 if equal. */
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (nb > na) return 1;
    if (na > nb) return -1;
  }
  return 0;
}

export function useVersionInfo(): VersionInfo {
  const [info, setInfo] = useState<VersionInfo>({
    current: '…',
    latest: null,
    updateAvailable: false,
    releaseUrl: null,
    versionCheckFailed: false,
    updateCheckFailed: false,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fetch local version. Through api (not a bare fetch) so it carries the session token:
        // with a password set, a bare fetch got a 401 and the version showed as unknown.
        const { version: current } = await api.getVersion();

        // Fetch latest GitHub release
        let latest: string | null = null;
        let releaseUrl: string | null = null;
        let updateCheckFailed = false;
        try {
          const ghRes = await fetch(GITHUB_API_LATEST);
          if (ghRes.ok) {
            const data = await ghRes.json();
            latest = (data.tag_name || '').replace(/^v/, '');
            releaseUrl = data.html_url || null;
          } else {
            updateCheckFailed = true;
          }
        } catch (e) {
          // GitHub unreachable — common for self-hosted setups with no outbound internet.
          // Not alarming enough for a toast, but still worth a quiet note in the UI.
          console.error(e);
          updateCheckFailed = true;
        }

        if (!cancelled) {
          setInfo({
            current,
            latest,
            updateAvailable: latest ? compareSemver(current, latest) > 0 : false,
            releaseUrl,
            versionCheckFailed: false,
            updateCheckFailed,
          });
        }
      } catch (e) {
        // Local API unreachable — this one is our own backend, worth flagging.
        console.error(e);
        if (!cancelled) {
          setInfo(prev => ({ ...prev, versionCheckFailed: true }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return info;
}

