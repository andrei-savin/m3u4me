import React, { useState, useEffect } from 'react';
import { api, triggerEpgRefresh, EpgSource } from '../apiClient';
import { notifyError } from '../store';
import Dialog from './Dialog';
import Icon from './Icon';

interface AddEpgSourceDialogProps {
  open: boolean;
  onClose: () => void;
  editingSource?: EpgSource | null;
}

export default function AddEpgSourceDialog({ open, onClose, editingSource }: AddEpgSourceDialogProps) {
  const [tab, setTab] = useState<'xml' | 'xtream'>('xml');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // EPG Link State
  const [xmlName, setXmlName] = useState('');
  const [xmlUrl, setXmlUrl] = useState('');
  const [xmlInterval, setXmlInterval] = useState(12);

  // Xtream State
  const [xtreamName, setXtreamName] = useState('');
  const [xtreamUrl, setXtreamUrl] = useState('');
  const [xtreamUser, setXtreamUser] = useState('');
  const [xtreamPass, setXtreamPass] = useState('');
  const [xtreamInterval, setXtreamInterval] = useState(12);

  useEffect(() => {
    if (open) {
      if (editingSource) {
        setTab(editingSource.type);
        if (editingSource.type === 'xml') {
          setXmlName(editingSource.name);
          setXmlUrl(editingSource.url);
          setXmlInterval(editingSource.refreshIntervalHours || 12);
          setXtreamName('');
          setXtreamUrl('');
          setXtreamUser('');
          setXtreamPass('');
          setXtreamInterval(12);
        } else {
          setXtreamName(editingSource.name);
          setXtreamUrl(editingSource.url);
          setXtreamUser(editingSource.xtreamCredentials?.username || '');
          setXtreamPass(editingSource.xtreamCredentials?.password || '');
          setXtreamInterval(editingSource.refreshIntervalHours || 12);
          setXmlName('');
          setXmlUrl('');
          setXmlInterval(12);
        }
      } else {
        setTab('xml');
        setXmlName('');
        setXmlUrl('');
        setXmlInterval(12);
        setXtreamName('');
        setXtreamUrl('');
        setXtreamUser('');
        setXtreamPass('');
        setXtreamInterval(12);
      }
      setIsSubmitting(false);
    }
  }, [open, editingSource]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const payload = tab === 'xml'
        ? {
            name: xmlName,
            url: xmlUrl,
            type: 'xml' as const,
            refreshIntervalHours: xmlInterval,
          }
        : {
            name: xtreamName,
            url: xtreamUrl,
            type: 'xtream' as const,
            xtreamCredentials: { username: xtreamUser, password: xtreamPass },
            refreshIntervalHours: xtreamInterval,
          };

      if (editingSource) {
        await api.updateEpgSource(editingSource.id, payload);

        // If URL or credentials changed, trigger a refresh to fetch new EPG data
        let needsRefresh = false;
        if (tab === 'xml' && xmlUrl !== (editingSource.url || '')) {
          needsRefresh = true;
        } else if (tab === 'xtream') {
          if (xtreamUrl !== (editingSource.url || '')) needsRefresh = true;
          if (xtreamUser !== (editingSource.xtreamCredentials?.username || '')) needsRefresh = true;
          if (xtreamPass !== (editingSource.xtreamCredentials?.password || '')) needsRefresh = true;
        }

        if (needsRefresh) {
          await api.refreshEpgSource(editingSource.id);
        }
      } else {
        // @ts-ignore
        await api.createEpgSource(payload);
      }
      
      triggerEpgRefresh();
      onClose();
    } catch (error) {
      console.error(editingSource ? 'Failed to update EPG source' : 'Failed to add EPG source', error);
      notifyError(error, editingSource ? 'Failed to update EPG source.' : 'Failed to add EPG source.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = () => {
    if (tab === 'xml') return xmlName.trim() !== '' && xmlUrl.trim() !== '';
    return xtreamName.trim() !== '' && xtreamUrl.trim() !== '' && xtreamUser.trim() !== '' && xtreamPass.trim() !== '';
  };

  const inputClasses = "field max-md:text-base";

  return (
    <Dialog onClose={onClose}>
        <h2 className="text-headline-sm text-on-surface px-6 pt-6 pb-3">
          {editingSource ? 'Edit EPG source' : 'Add EPG source'}
        </h2>

        {/* Tabs */}
        <div className="flex mx-6 border-b border-outline-variant">
          <button
            onClick={() => setTab('xml')}
            className={`md-btn flex-1 h-12 text-title-sm relative ${tab === 'xml' ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}
            disabled={!!editingSource && editingSource.type !== 'xml'}
            style={editingSource && editingSource.type !== 'xml' ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            EPG Link
            {tab === 'xml' && (
              <div className="absolute bottom-0 left-4 right-4 h-[3px] rounded-t-full bg-primary" />
            )}
          </button>
          <button
            onClick={() => setTab('xtream')}
            className={`md-btn flex-1 h-12 text-title-sm relative ${tab === 'xtream' ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}
            disabled={!!editingSource && editingSource.type !== 'xtream'}
            style={editingSource && editingSource.type !== 'xtream' ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            Xtream Codes API
            {tab === 'xtream' && (
              <div className="absolute bottom-0 left-4 right-4 h-[3px] rounded-t-full bg-primary" />
            )}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 pt-5 pb-6 flex flex-col gap-4">
          {tab === 'xml' ? (
            <>
              <div>
                <label className="field-label">Name</label>
                <input
                  type="text"
                  placeholder="My EPG Source"
                  value={xmlName}
                  onChange={(e) => setXmlName(e.target.value)}
                  className={inputClasses}
                />
              </div>
              <div>
                <label className="field-label">URL</label>
                <input
                  type="url"
                  placeholder="https://example.com/epg.xml.gz"
                  value={xmlUrl}
                  onChange={(e) => setXmlUrl(e.target.value)}
                  className={inputClasses}
                />
                <p className="text-body-sm text-on-surface-variant mt-1.5">Supports .xml and .gz compressed files</p>
              </div>
              <div>
                <label className="field-label">Refresh Interval</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={xmlInterval}
                    onChange={(e) => setXmlInterval(parseInt(e.target.value) || 1)}
                    className={inputClasses + " w-24"}
                  />
                  <span className="text-body-md text-on-surface-variant">hours</span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="field-label">Name</label>
                <input
                  type="text"
                  placeholder="My Xtream Source"
                  value={xtreamName}
                  onChange={(e) => setXtreamName(e.target.value)}
                  className={inputClasses}
                />
              </div>
              <div>
                <label className="field-label">Server URL</label>
                <input
                  type="url"
                  placeholder="http://example.com:8080"
                  value={xtreamUrl}
                  onChange={(e) => setXtreamUrl(e.target.value)}
                  className={inputClasses}
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="field-label">Username</label>
                  <input
                    type="text"
                    value={xtreamUser}
                    onChange={(e) => setXtreamUser(e.target.value)}
                    className={inputClasses}
                  />
                </div>
                <div className="flex-1">
                  <label className="field-label">Password</label>
                  <input
                    type="password"
                    value={xtreamPass}
                    onChange={(e) => setXtreamPass(e.target.value)}
                    className={inputClasses}
                  />
                </div>
              </div>
              <div>
                <label className="field-label">Refresh Interval</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={xtreamInterval}
                    onChange={(e) => setXtreamInterval(parseInt(e.target.value) || 1)}
                    className={inputClasses + " w-24"}
                  />
                  <span className="text-body-md text-on-surface-variant">hours</span>
                </div>
                <p className="text-body-sm text-on-surface-variant mt-1.5">Will fetch EPG from the server's XMLTV endpoint</p>
              </div>
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
              {editingSource ? 'Save changes' : 'Add source'}
            </button>
          </div>
        </form>
    </Dialog>
  );
}
