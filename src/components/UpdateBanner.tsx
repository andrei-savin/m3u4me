import { useState } from 'react';
import { useVersionInfo } from './AppInfo';
import Icon from './Icon';

/**
 * The "a new version is available" strip at the top of Dashboard and Home, shown when GitHub
 * has a newer release than the one running. Closing it hides it until the screen is opened again.
 */
export default function UpdateBanner() {
  const versionInfo = useVersionInfo();
  const [dismissed, setDismissed] = useState(false);
  if (!versionInfo.updateAvailable || dismissed || !versionInfo.releaseUrl) return null;

  return (
    <div className="shrink-0 z-30 flex items-center gap-3 pl-4 pr-1.5 py-1 bg-primary-container text-on-primary-container text-body-md">
      <Icon name="arrow_circle_up" className="text-[24px] shrink-0" />
      <span className="flex-1 min-w-0">
        A new version of m3u4me is available: <strong className="font-semibold">v{versionInfo.latest}</strong>
      </span>
      <a
        href={versionInfo.releaseUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="md-btn btn btn-text text-on-primary-container"
      >
        View release
      </a>
      <button onClick={() => setDismissed(true)} className="md-btn icon-btn text-on-primary-container" aria-label="Dismiss">
        <Icon name="close" className="text-[24px]" />
      </button>
    </div>
  );
}
