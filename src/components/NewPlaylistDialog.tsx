import React, { useState, useRef, useEffect } from 'react';
import { api } from '../apiClient';
import { notifyError } from '../store';
import Dialog from './Dialog';
import SegmentedButtons from './SegmentedButtons';
import Icon from './Icon';

interface NewPlaylistDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (playlistId: string) => void;
}

type StartMode = 'empty' | 'import';
type ImportTab = 'url' | 'file';

export default function NewPlaylistDialog({ open, onClose, onCreated }: NewPlaylistDialogProps) {
  const [mode, setMode] = useState<StartMode>('empty');
  const [importTab, setImportTab] = useState<ImportTab>('url');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // null = not yet checked, string = warning to show, and a boolean tracking whether
  // the user has already seen it and clicked through once (so the next submit proceeds anyway).
  const [warning, setWarning] = useState<string | null>(null);
  const [warningConfirmed, setWarningConfirmed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setMode('empty');
      setImportTab('url');
      setName('');
      setUrl('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setWarning(null);
      setWarningConfirmed(false);
      setIsSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const resetImportInputs = () => {
    setWarning(null);
    setWarningConfirmed(false);
  };

  const isFormValid = () => {
    if (!name.trim()) return false;
    if (mode === 'empty') return true;
    if (importTab === 'url') return url.trim() !== '';
    return file !== null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid() || isSubmitting) return;

    if (mode === 'empty') {
      setIsSubmitting(true);
      try {
        const pl = await api.createPlaylist(name.trim());
        onCreated(pl.id);
      } catch (err) {
        console.error(err);
        notifyError(err, 'Failed to create playlist.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: { name: string; url?: string; content?: string; confirmWarning?: boolean } = {
        name: name.trim(),
        confirmWarning: warningConfirmed,
      };
      if (importTab === 'url') {
        payload.url = url.trim();
      } else if (file) {
        payload.content = await file.text();
      }

      const result: any = await api.importPlaylist(payload);

      if (result?.error) {
        notifyError(new Error(result.error));
        return;
      }
      if (result?.warning) {
        setWarning(result.warning);
        setWarningConfirmed(true); // next submit proceeds despite the warning
        return;
      }
      onCreated(result.id);
    } catch (err) {
      console.error(err);
      notifyError(err, 'Failed to import playlist.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClasses = "field max-md:text-base";

  return (
    <Dialog onClose={onClose}>
        <h2 className="text-headline-sm text-on-surface px-6 pt-6 pb-3">
          New playlist
        </h2>

        {/* Start mode */}
        <div className="flex mx-6 border-b border-outline-variant">
          <button
            type="button"
            onClick={() => setMode('empty')}
            className={`md-btn flex-1 h-12 text-title-sm relative ${mode === 'empty' ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}
          >
            Empty playlist
            {mode === 'empty' && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-28 h-[3px] rounded-t-full bg-primary" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setMode('import')}
            className={`md-btn flex-1 h-12 text-title-sm relative ${mode === 'import' ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}
          >
            Import M3U
            {mode === 'import' && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-24 h-[3px] rounded-t-full bg-primary" />
            )}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 pt-5 pb-6 flex flex-col gap-4">
          <div>
            <label className="field-label">Name</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Playlist name"
              className={inputClasses}
            />
          </div>

          {mode === 'import' && (
            <>
              {/* Sub-tabs for import source */}
              {/* From a link or from a file: two segmented buttons. */}
              <SegmentedButtons
                options={[{ value: 'url', label: 'From a link' }, { value: 'file', label: 'From a file' }]}
                value={importTab}
                onChange={tab => { setImportTab(tab); resetImportInputs(); }}
              />

              {importTab === 'url' ? (
                <div>
                  <label className="field-label">Playlist URL</label>
                  <input
                    type="url"
                    placeholder="https://example.com/playlist.m3u"
                    value={url}
                    onChange={(e) => { setUrl(e.target.value); resetImportInputs(); }}
                    className={inputClasses}
                  />
                  <p className="text-body-sm text-on-surface-variant mt-1.5">Supports M3U and XSPF playlists — not M3U8 livestream links</p>
                </div>
              ) : (
                <div>
                  <label className="field-label">File</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".m3u,.m3u8,.xspf"
                    onChange={(e) => { setFile(e.target.files?.[0] || null); resetImportInputs(); }}
                    className={inputClasses + " h-auto py-2 file:mr-3 file:h-8 file:px-4 file:rounded-full file:border-0 file:text-label-lg file:bg-secondary-container file:text-on-secondary-container file:cursor-pointer"}
                  />
                </div>
              )}

              {warning && (
                <div className="flex gap-2.5 rounded-xl bg-tertiary-container text-on-tertiary-container p-3 text-body-sm">
                  <Icon name="warning" className="text-[20px] shrink-0 mt-0.5" />
                  <p>{warning}{warningConfirmed ? ' Click Create again to import anyway.' : ''}</p>
                </div>
              )}
            </>
          )}

          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={onClose}
              className="md-btn btn btn-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isFormValid() || isSubmitting}
              className="md-btn btn btn-filled"
            >
              {isSubmitting && <Icon name="progress_activity" className="text-[20px] animate-spin" />}
              Create
            </button>
          </div>
        </form>
    </Dialog>
  );
}
