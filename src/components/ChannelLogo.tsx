import { useEffect, useState } from 'react';

/**
 * Channel/EPG logo with a graceful fallback to a 3-letter initials badge —
 * used when there's no logo URL at all, or the URL 404s / fails to load.
 *
 * Renders exactly one of the two at a time (never both). An earlier version
 * layered the fallback permanently behind an absolutely-positioned <img> and
 * relied on onError to hide the image, but that let transparent-background
 * logos (common for PNG channel art) show the fallback text bleeding through
 * behind them — a double-image effect. Real state avoids that.
 */
export default function ChannelLogo({ logo, name, logoBgColor, className }: {
  logo?: string | null;
  name?: string;
  logoBgColor: string;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  // Reset if the channel's logo URL itself changes (e.g. edited), so a past
  // failure doesn't permanently stick to a since-corrected URL.
  useEffect(() => { setFailed(false); }, [logo]);

  const bg = logoBgColor === 'transparent' ? undefined : logoBgColor;

  if (logo && !failed) {
    return (
      <img
        src={logo}
        alt=""
        className={`${className} object-contain`}
        style={{ backgroundColor: bg }}
        onError={() => setFailed(true)}
      />
    );
  }
  // A fixed mid-grey, not a theme colour: it sits on the logo background the user picked
  // (light by default), which doesn't change with dark mode.
  return (
    <div
      className={`${className} flex items-center justify-center text-[8px] font-bold text-gray-400 uppercase`}
      style={{ backgroundColor: bg }}
    >
      {(name || 'Unnamed').substring(0, 3)}
    </div>
  );
}
