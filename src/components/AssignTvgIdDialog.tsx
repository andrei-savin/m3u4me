import React, { useState, useEffect } from 'react';
import { api, usePlaylists, triggerRefresh, Channel } from '../apiClient';
import { useStore, notifyError, notifyInfo } from '../store';
import ChannelLogo from './ChannelLogo';
import Dialog from './Dialog';
import Icon from './Icon';

interface AssignTvgIdDialogProps {
  open: boolean;
  onClose: () => void;
  epgChannelId: string;
  epgDisplayName: string;
}

export default function AssignTvgIdDialog({ open, onClose, epgChannelId, epgDisplayName }: AssignTvgIdDialogProps) {
  const { playlists } = usePlaylists();
  const { logoBgColor } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedPlaylists, setExpandedPlaylists] = useState<Set<string>>(new Set());
  // Playlists the user has explicitly expanded/collapsed themselves - search-driven
  // auto-expand/collapse never overrides a playlist once the user has touched it.
  const [manualToggles, setManualToggles] = useState<Set<string>>(new Set());
  const [playlistChannels, setPlaylistChannels] = useState<Record<string, Channel[]>>({});
  const [loadingPlaylists, setLoadingPlaylists] = useState<Set<string>>(new Set());
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setExpandedPlaylists(new Set());
      setManualToggles(new Set());
      setSelectedChannels(new Set());
    }
  }, [open]);

  const loadPlaylistChannels = async (playlistId: string) => {
    if (playlistChannels[playlistId] || loadingPlaylists.has(playlistId)) return;
    setLoadingPlaylists((prev) => new Set(prev).add(playlistId));
    try {
      const channels = await api.getChannels(playlistId);
      setPlaylistChannels((prev) => ({ ...prev, [playlistId]: channels }));
    } catch (error) {
      console.error('Failed to load channels', error);
      notifyError(error, 'Failed to load channels.');
    } finally {
      setLoadingPlaylists((prev) => {
        const next = new Set(prev);
        next.delete(playlistId);
        return next;
      });
    }
  };

  // While searching, fetch every playlist's channels (not just the ones the user
  // happened to expand already) so the search can actually find matches anywhere.
  useEffect(() => {
    if (!open || !searchQuery.trim()) return;
    playlists.forEach((p) => loadPlaylistChannels(p.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, searchQuery, playlists]);

  // Auto-expand playlists that have a match while searching, and auto-collapse ones
  // that don't - but never fight a playlist the user has explicitly toggled themselves.
  useEffect(() => {
    if (!searchQuery.trim()) return;
    setExpandedPlaylists((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const playlist of playlists) {
        if (manualToggles.has(playlist.id)) continue;
        const channels = playlistChannels[playlist.id];
        if (!channels) continue;
        const hasMatch = channels.some((c) => (c.name || '').toLowerCase().includes(searchQuery.toLowerCase()));
        if (hasMatch && !next.has(playlist.id)) {
          next.add(playlist.id);
          changed = true;
        } else if (!hasMatch && next.has(playlist.id)) {
          next.delete(playlist.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [searchQuery, playlistChannels, playlists, manualToggles]);

  if (!open) return null;

  const togglePlaylist = (playlistId: string) => {
    setManualToggles((prev) => new Set(prev).add(playlistId));
    setExpandedPlaylists((prev) => {
      const next = new Set(prev);
      if (next.has(playlistId)) {
        next.delete(playlistId);
      } else {
        next.add(playlistId);
        loadPlaylistChannels(playlistId);
      }
      return next;
    });
  };

  const toggleChannelSelection = (channelId: string) => {
    const newSelected = new Set(selectedChannels);
    if (newSelected.has(channelId)) {
      newSelected.delete(channelId);
    } else {
      newSelected.add(channelId);
    }
    setSelectedChannels(newSelected);
  };

  const handleAssign = async () => {
    setIsSubmitting(true);
    try {
      // Group selected channels by playlist so each playlist gets one batched
      // bulk-update-many request instead of one individual PUT per channel — the same
      // endpoint BulkEpgAssignDialog already uses for this exact kind of change.
      const updatesByPlaylist = new Map<string, { id: string; changes: any }[]>();
      for (const playlistId of Object.keys(playlistChannels)) {
        const channels = playlistChannels[playlistId];
        for (const channel of channels) {
          if (selectedChannels.has(channel.id)) {
            if (!updatesByPlaylist.has(playlistId)) updatesByPlaylist.set(playlistId, []);
            updatesByPlaylist.get(playlistId)!.push({ id: channel.id, changes: { tvgId: epgChannelId } });
          }
        }
      }
      const count = selectedChannels.size;
      await Promise.all(
        Array.from(updatesByPlaylist.entries()).map(([playlistId, updates]) =>
          api.bulkUpdateManyChannels(playlistId, updates)
        )
      );
      triggerRefresh();
      onClose();
      notifyInfo(`Assigned EPG to ${count} ${count === 1 ? 'channel' : 'channels'}.`);
    } catch (error) {
      console.error('Failed to assign tvg-id', error);
      notifyError(error, 'Failed to assign EPG source.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog onClose={onClose} maxWidth="max-w-md" panelClassName="max-h-[70vh]">
        {/* Header */}
        <div className="px-6 pt-6 pb-3 shrink-0">
          <h2 className="text-headline-sm text-on-surface mb-3">Assign this guide channel</h2>
          <div className="flex items-center gap-3 p-3 bg-surface-container-highest rounded-xl">
            <div className="w-10 h-10 rounded-lg bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0 overflow-hidden">
              <span className="text-label-md font-bold">EPG</span>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-label-lg text-on-surface truncate">{epgDisplayName}</span>
              <span className="text-body-sm font-mono text-on-surface-variant truncate">{epgChannelId}</span>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="px-6 pb-3 border-b border-outline-variant shrink-0">
          <div className="relative">
            <Icon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-[24px] text-on-surface-variant" />
            <input
              type="text"
              placeholder="Search channels"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-12 pl-11 pr-4 rounded-full bg-surface-container-highest text-body-md max-md:text-base text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {/* Playlists List */}
        <div className="flex-1 overflow-y-auto p-2">
          {playlists.map((playlist) => {
            const isExpanded = expandedPlaylists.has(playlist.id);
            const isLoading = loadingPlaylists.has(playlist.id);
            const channels = playlistChannels[playlist.id] || [];
            const filteredChannels = channels.filter((c) => (c.name || '').toLowerCase().includes(searchQuery.toLowerCase()));

            return (
              <div key={playlist.id} className="mb-1">
                <button
                  onClick={() => togglePlaylist(playlist.id)}
                  className="md-btn w-full flex items-center gap-2 h-11 px-3 rounded-full text-left"
                >
                  {isExpanded ? <Icon name="keyboard_arrow_down" className="text-[24px] text-on-surface-variant" /> : <Icon name="chevron_right" className="text-[24px] text-on-surface-variant" />}
                  <span className="text-label-lg text-on-surface">{playlist.name}</span>
                  {isLoading && <Icon name="progress_activity" className="text-[16px] animate-spin text-on-surface-variant ml-auto" />}
                </button>

                {isExpanded && !isLoading && (
                  <div className="pl-6 pr-2 py-1 space-y-1">
                    {filteredChannels.length === 0 ? (
                      <div className="text-body-sm text-on-surface-variant py-2">No matching channels</div>
                    ) : (
                      <>
                        {filteredChannels.slice(0, 100).map((channel) => {
                          const isAssigned = channel.tvgId === epgChannelId;
                          const isSelected = selectedChannels.has(channel.id);

                          return (
                            <div
                              key={channel.id}
                              className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-on-surface/[0.06]"
                            >
                              {isAssigned ? (
                                <div className="w-[18px] h-[18px] flex items-center justify-center text-primary" title="Already uses this guide channel">
                                  <Icon name="check" className="text-[20px]" />
                                </div>
                              ) : (
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleChannelSelection(channel.id)}
                                  className="w-[18px] h-[18px] accent-primary cursor-pointer"
                                />
                              )}
                              
                              <ChannelLogo
                                logo={channel.logo}
                                name={channel.name}
                                logoBgColor={logoBgColor}
                                className="w-10 h-7 rounded-md"
                              />
                              
                              <div className="flex flex-col min-w-0 flex-1">
                                <span className="text-body-md text-on-surface truncate">{channel.name || 'Unnamed'}</span>
                                {channel.tvgId && !isAssigned && (
                                  <span className="text-label-sm font-normal font-mono text-on-surface-variant truncate">{channel.tvgId}</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {filteredChannels.length > 100 && (
                          <div className="text-body-sm text-center text-on-surface-variant pt-2 pb-1">
                            Showing 100 of {filteredChannels.length}. Use search to find more.
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-outline-variant shrink-0 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="md-btn btn btn-text"
          >
            Cancel
          </button>
          <button
            onClick={handleAssign}
            disabled={selectedChannels.size === 0 || isSubmitting}
            className="md-btn btn btn-filled"
          >
            {isSubmitting && <Icon name="progress_activity" className="text-[20px] animate-spin" />}
            Assign to {selectedChannels.size} {selectedChannels.size === 1 ? 'channel' : 'channels'}
          </button>
        </div>
    </Dialog>
  );
}
