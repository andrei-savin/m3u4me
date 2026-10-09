import React, { useRef, useState } from 'react';
import { FileJson, Upload, X } from 'lucide-react';
import { RestoreResult } from '../apiClient';
import { accentAlpha } from '../store';

/** "48 KB" / "12.3 MB", for showing which file was picked. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
}

/** "3 playlists with 1,240 channels, 2 sources and 1 TV guide", for the messages shown after a
 * restore (first-run setup and Settings). */
export function describeRestoredBackup(result: RestoreResult): string {
  return `${plural(result.playlists, 'playlist')} with ${plural(result.channels, 'channel')}, `
    + `${plural(result.channelPoolSources, 'source')} and ${plural(result.epgSources, 'TV guide')}`;
}

/** What to show when api.restoreBackup() fails: the server's own plain-language reason (not a
 * backup file, data folder not writable…), or a connection problem. fetch() itself throws a
 * TypeError when the server can't be reached, and its message ("Failed to fetch") means nothing
 * to most people. */
export function restoreErrorMessage(e: unknown): string {
  if (e instanceof TypeError) return "Couldn't reach m3u4me. Check that it's still running, then try again.";
  return e instanceof Error && e.message ? e.message : "Couldn't restore the backup. Try again.";
}

/**
 * Drop-or-click area for picking a backup file, shared by the first-run setup's restore step and
 * Settings' "Restore from backup" dialog. It only picks the file; the caller sends it with
 * api.restoreBackup(). Any file is accepted (the server checks it), because a db.json copied
 * from an old install may have been renamed.
 */
export default function BackupDropZone({ file, onFileChange, accentColor, disabled = false }: {
  file: File | null;
  onFileChange: (file: File | null) => void;
  accentColor: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const clear = () => {
    onFileChange(null);
    // Otherwise picking the same file again wouldn't fire onChange.
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div>
      {/* Always mounted, so clicking the zone (or "Choose another") can open the file picker. */}
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        disabled={disabled}
        onChange={e => { const picked = e.target.files?.[0]; if (picked) onFileChange(picked); }}
      />

      {file ? (
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-white/10 bg-white/70 dark:bg-black/20 px-4 py-3">
          <div className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center" style={{ backgroundColor: accentAlpha(accentColor, '20') }}>
            <FileJson className="h-5 w-5" style={{ color: accentColor }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{file.name}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{formatFileSize(file.size)}</div>
          </div>
          <button
            type="button"
            onClick={clear}
            disabled={disabled}
            className="md-btn shrink-0 p-1.5 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-white disabled:opacity-40"
            aria-label="Choose a different file"
            title="Choose a different file"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault();
            setDragging(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped && !disabled) onFileChange(dropped);
          }}
          className="md-btn w-full flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 dark:border-white/15 px-4 py-8 text-center transition-colors disabled:opacity-40"
          style={dragging ? { borderColor: accentColor, backgroundColor: accentAlpha(accentColor, '0D') } : undefined}
        >
          <Upload className="h-6 w-6" style={{ color: accentColor }} />
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Drop your backup file here</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">or click to choose it</span>
        </button>
      )}
    </div>
  );
}
