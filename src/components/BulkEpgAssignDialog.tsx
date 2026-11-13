import React, { useState, useEffect, useMemo } from 'react';
import { api, EpgSource, EpgChannel, Channel } from '../apiClient';
import { notifyError } from '../store';
import Dialog from './Dialog';
import Icon from './Icon';

interface BulkEpgAssignDialogProps {
  open: boolean;
  onClose: () => void;
  playlistId: string;
  channels: Channel[];
  activeCategory: string;
}

// --- Fuzzy matching ---
// A name's normalized form plus its precomputed trigram/word sets, built once via
// buildMatchIndex and then reused for every comparison it's involved in — see
// handleRunMatching, which used to rebuild the EPG side of this from scratch on every
// single playlist-channel comparison (O(N×M) redundant Set construction), which is what
// froze the tab on a large EPG source.
interface MatchIndex {
  norm: string;
  trigrams: Set<string>;
  words: Set<string>;
}

function buildMatchIndex(raw: string): MatchIndex {
  const norm = raw.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const trigrams = new Set<string>();
  const padded = `  ${norm}  `;
  for (let i = 0; i < padded.length - 2; i++) trigrams.add(padded.slice(i, i + 3));
  const words = new Set(norm.split(' ').filter(Boolean));
  return { norm, trigrams, words };
}

// Returns a score 0-1 indicating how well two pre-indexed names match. Higher is better.
// Uses a simple trigram + word overlap approach.
function fuzzyScore(a: MatchIndex, b: MatchIndex): number {
  if (a.norm === b.norm) return 1;
  if (!a.norm || !b.norm) return 0;

  let intersection = 0;
  for (const t of a.trigrams) if (b.trigrams.has(t)) intersection++;
  const trigramScore = (2 * intersection) / (a.trigrams.size + b.trigrams.size);

  let wordIntersection = 0;
  for (const w of a.words) if (b.words.has(w)) wordIntersection++;
  const wordScore = (2 * wordIntersection) / (a.words.size + b.words.size);

  return trigramScore * 0.5 + wordScore * 0.5;
}

const MIN_SCORE = 0.35;

interface Match {
  channel: Channel;
  epgChannel: EpgChannel;
  score: number;
  accepted: boolean;
}

type Scope = 'playlist' | 'category';

export default function BulkEpgAssignDialog({
  open, onClose, playlistId, channels, activeCategory,
}: BulkEpgAssignDialogProps) {

  const [sources, setSources] = useState<EpgSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [scope, setScope] = useState<Scope>('category');
  const [step, setStep] = useState<'config' | 'matching' | 'preview' | 'applying' | 'done'>('config');
  const [matches, setMatches] = useState<Match[]>([]);
  const [appliedCount, setAppliedCount] = useState(0);
  const [loadingMsg, setLoadingMsg] = useState('');

  const [isReverting, setIsReverting] = useState(false);
  const cancelRef = React.useRef(false);

  // Prevent closing tab while applying
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (step === 'applying') {
        e.preventDefault();
        e.returnValue = ''; // Required for some browsers to show dialog
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [step]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStep('config');
      setMatches([]);
      setAppliedCount(0);
      setSelectedSourceId('');
      setScope('category');
      setIsReverting(false);
      cancelRef.current = false;
      api.getEpgSources().then(s => {
        setSources(s);
        if (s.length === 1) setSelectedSourceId(s[0].id);
      }).catch(e => {
        console.error(e);
        notifyError(e, 'Failed to load EPG sources.');
      });
    }
  }, [open]);

  const scopedChannels = useMemo(() => {
    if (scope === 'category') return channels.filter(c => c.category === activeCategory);
    return channels;
  }, [scope, channels, activeCategory]);

  const handleRunMatching = async () => {
    if (!selectedSourceId) return;
    setStep('matching');
    setLoadingMsg('Loading EPG channels…');
    cancelRef.current = false;

    try {
      const epgChannels = await api.getEpgChannels(selectedSourceId);
      // Build each EPG channel's match index (normalized name + trigram/word sets) once,
      // up front, instead of recomputing it from scratch inside the loop below for every
      // playlist channel it gets compared against.
      const epgIndex = epgChannels.map(epg => ({ epg, index: buildMatchIndex(epg.displayName) }));

      // Score each playlist channel against all EPG channels, take the best match. Runs in
      // small chunks with a yield in between (instead of one long synchronous pass) so a
      // large playlist/EPG source doesn't freeze the tab, and so Cancel below can interrupt it.
      const newMatches: Match[] = [];
      const CHUNK_SIZE = 25;
      for (let i = 0; i < scopedChannels.length; i += CHUNK_SIZE) {
        if (cancelRef.current) { setStep('config'); return; }
        const chunk = scopedChannels.slice(i, i + CHUNK_SIZE);
        for (const ch of chunk) {
          const chIndex = buildMatchIndex(ch.name);
          let bestScore = 0;
          let bestEpg: EpgChannel | null = null;
          for (const { epg, index } of epgIndex) {
            const s = fuzzyScore(chIndex, index);
            if (s > bestScore) { bestScore = s; bestEpg = epg; }
          }
          if (bestEpg && bestScore >= MIN_SCORE) {
            newMatches.push({ channel: ch, epgChannel: bestEpg, score: bestScore, accepted: true });
          }
        }
        const done = Math.min(i + CHUNK_SIZE, scopedChannels.length);
        setLoadingMsg(`Matching ${done} / ${scopedChannels.length} playlist channels…`);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      // Sort by score descending
      newMatches.sort((a, b) => b.score - a.score);
      setMatches(newMatches);
      setStep('preview');
    } catch (err) {
      console.error('Bulk EPG matching failed:', err);
      notifyError(err, 'Failed to match EPG channels.');
      setStep('config');
    }
  };

  const handleApply = async () => {
    cancelRef.current = false;
    setIsReverting(false);
    const toApply = matches.filter(m => m.accepted);
    if (toApply.length === 0) return;
    setStep('applying');
    
    let count = 0;
    const successfullyApplied: Match[] = [];
    const CHUNK_SIZE = 100;

    try {
      for (let i = 0; i < toApply.length; i += CHUNK_SIZE) {
        if (cancelRef.current) break;
        const chunk = toApply.slice(i, i + CHUNK_SIZE);
        const updates = chunk.map(m => ({ id: m.channel.id, changes: { tvgId: m.epgChannel.id } }));

        await api.bulkUpdateManyChannels(playlistId, updates);
        successfullyApplied.push(...chunk);
        count += chunk.length;
        setAppliedCount(count);
      }
    } catch (err) {
      console.error('Bulk EPG assignment failed:', err);
      notifyError(err, `Failed to apply EPG assignments after ${count} of ${toApply.length}.`);
      setStep('preview');
      return;
    }

    if (cancelRef.current) {
      setIsReverting(true);
      for (let i = 0; i < successfullyApplied.length; i += CHUNK_SIZE) {
        const chunk = successfullyApplied.slice(i, i + CHUNK_SIZE);
        // revert to whatever tvgId it had originally
        const revertUpdates = chunk.map(m => ({ id: m.channel.id, changes: { tvgId: m.channel.tvgId } }));
        await api.bulkUpdateManyChannels(playlistId, revertUpdates);
      }
      setIsReverting(false);
      cancelRef.current = false;
      setStep('preview');
      return;
    }

    setStep('done');
  };

  const toggleMatch = (idx: number) => {
    setMatches(prev => prev.map((m, i) => i === idx ? { ...m, accepted: !m.accepted } : m));
  };

  const acceptedCount = matches.filter(m => m.accepted).length;

  if (!open) return null;

  const scoreBar = (score: number) => {
    const pct = Math.round(score * 100);
    // Good matches in the success colour, doubtful ones in the warning colour.
    const tone = score >= 0.75 ? 'bg-success text-success' : 'bg-warning text-warning';
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="w-16 h-1.5 rounded-full bg-surface-container-highest overflow-hidden">
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
        </div>
        <span className={`text-label-sm font-mono w-8 text-right bg-transparent ${tone}`}>{pct}%</span>
      </div>
    );
  };

  return (
    <Dialog
      onClose={onClose}
      maxWidth="max-w-2xl"
      panelClassName="overflow-hidden max-h-[85vh]"
      scrimClassName="bg-black/60"
      // The 'applying' step blocks tab-close (see the beforeunload handler above) for
      // the same reason it shouldn't be dismissible via backdrop/Escape either: closing
      // mid-apply wouldn't stop the in-flight bulk-update-many calls, just hide the
      // "Cancel & Revert" affordance that's the only safe way to back out of them.
      dismissible={step !== 'applying'}
    >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-4 shrink-0">
          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-secondary-container text-on-secondary-container">
            <Icon name="auto_fix_high" className="text-[24px]" />
          </div>
          <div>
            <h2 className="text-headline-sm text-on-surface">Assign EPG automatically</h2>
            <p className="text-body-sm text-on-surface-variant">Automatically match channel names to EPG entries using fuzzy search</p>
          </div>
        </div>

        {/* ── Step: config ── */}
        {step === 'config' && (
          <div className="flex flex-col gap-5 px-6 pb-6 flex-1 overflow-y-auto">
            {/* EPG Source picker */}
            <div>
              <label className="field-label mb-2">EPG source</label>
              {sources.length === 0 ? (
                <p className="text-body-md text-on-surface-variant">No EPG sources added yet. Add one in the EPG view.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {sources.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedSourceId(s.id)}
                      className={`md-btn flex items-center gap-3 px-4 py-3 rounded-xl text-left ${selectedSourceId === s.id ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-highest text-on-surface'}`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${selectedSourceId === s.id ? 'border-primary bg-primary text-on-primary' : 'border-on-surface-variant'}`}
                      >
                        {selectedSourceId === s.id && <Icon name="check" className="text-[16px]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-label-lg">{s.name}</p>
                        <p className="text-body-sm opacity-80">{s.channelCount.toLocaleString()} channels · {s.type === 'xtream' ? 'Xtream Codes' : 'XMLTV'}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Scope picker */}
            <div>
              <label className="field-label mb-2">Assign to</label>
              <div className="grid grid-cols-2 gap-2">
                {(['category', 'playlist'] as Scope[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setScope(s)}
                    className={`md-btn px-4 py-3 rounded-xl text-left ${scope === s ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-highest text-on-surface'}`}
                  >
                    <p className="text-label-lg">
                      {s === 'category' ? `Current category` : 'Whole playlist'}
                    </p>
                    <p className="text-body-sm opacity-80 mt-0.5">
                      {s === 'category'
                        ? `"${activeCategory}" — ${channels.filter(c => c.category === activeCategory).length} channels`
                        : `All categories — ${channels.length} channels`}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="md-btn btn btn-text">Cancel</button>
              <button
                onClick={handleRunMatching}
                disabled={!selectedSourceId}
                className="md-btn btn btn-filled"
              >
                <Icon name="auto_fix_high" className="text-[20px]" />
                Match Channels
              </button>
            </div>
          </div>
        )}

        {/* ── Step: matching ── */}
        {step === 'matching' && (
          <div className="flex flex-col items-center justify-center gap-4 py-16 px-6">
            <Icon name="progress_activity" className="text-[32px] animate-spin text-primary" />
            <p className="text-body-md text-on-surface-variant">{loadingMsg}</p>
            <button
              onClick={() => cancelRef.current = true}
              className="mt-4 md-btn btn btn-text text-error"
            >
              Cancel
            </button>
          </div>
        )}

        {/* ── Step: preview ── */}
        {step === 'preview' && (
          <>
            <div className="px-6 py-3 shrink-0 border-b border-outline-variant flex items-center justify-between gap-4">
              <p className="text-body-md text-on-surface-variant">
                <span className="font-semibold text-on-surface">{matches.length}</span> matches found ·{' '}
                <span className="font-semibold text-primary">{acceptedCount}</span> selected
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMatches(prev => prev.map(m => ({ ...m, accepted: true })))}
                  className="text-label-md underline text-on-surface-variant hover:text-on-surface"
                >Select all</button>
                <span className="text-outline-variant">|</span>
                <button
                  onClick={() => setMatches(prev => prev.map(m => ({ ...m, accepted: false })))}
                  className="text-label-md underline text-on-surface-variant hover:text-on-surface"
                >Deselect all</button>
              </div>
            </div>

            {matches.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-on-surface-variant">
                <Icon name="cancel" className="text-[32px]" />
                <p className="text-body-md">No matches found above the confidence threshold.</p>
                <button onClick={() => setStep('config')} className="md-btn btn btn-text">Back to settings</button>
              </div>
            ) : (
              <>
                {/* Column headers */}
                <div className="px-4 h-10 items-center shrink-0 grid gap-2 text-label-md text-on-surface-variant border-b border-outline-variant"
                  style={{ gridTemplateColumns: '2rem 1fr 1fr 5.5rem' }}>
                  <span />
                  <span>Playlist Channel</span>
                  <span>EPG Channel</span>
                  <span>Confidence</span>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {matches.map((m, i) => (
                    <button
                      key={m.channel.id}
                      onClick={() => toggleMatch(i)}
                      className="md-btn w-full grid gap-2 items-center px-4 py-2.5 border-b border-outline-variant/60 text-left"
                      style={{ gridTemplateColumns: '2rem 1fr 1fr 5.5rem' }}
                    >
                      {/* Checkbox */}
                      <div className="flex items-center justify-center">
                        {m.accepted
                          ? <Icon name="check_circle" className="text-[24px] text-primary" />
                          : <div className="h-5 w-5 rounded-full border-2 border-on-surface-variant" />}
                      </div>
                      {/* Playlist channel */}
                      <div className="min-w-0">
                        <p className="text-label-lg text-on-surface truncate">{m.channel.name}</p>
                        {m.channel.tvgId && (
                          <p className="text-label-sm font-normal font-mono text-on-surface-variant truncate">was: {m.channel.tvgId}</p>
                        )}
                      </div>
                      {/* EPG channel */}
                      <div className="min-w-0">
                        <p className="text-body-md text-on-surface truncate">{m.epgChannel.displayName}</p>
                        <p className="text-label-sm font-normal font-mono text-on-surface-variant truncate">{m.epgChannel.id}</p>
                      </div>
                      {/* Score bar */}
                      {scoreBar(m.score)}
                    </button>
                  ))}
                </div>

                <div className="px-6 py-4 shrink-0 border-t border-outline-variant flex justify-end gap-2">
                  <button onClick={() => setStep('config')} className="md-btn btn btn-text">Back</button>
                  <button
                    onClick={handleApply}
                    disabled={acceptedCount === 0}
                    className="md-btn btn btn-filled"
                  >
                    <Icon name="check" className="text-[20px]" />
                    Apply {acceptedCount} Assignment{acceptedCount !== 1 ? 's' : ''}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/* ── Step: applying ── */}
        {step === 'applying' && (
          <div className="flex flex-col items-center justify-center gap-4 py-16 px-6">
            <Icon name="progress_activity" className="text-[32px] animate-spin text-primary" />
            <p className="text-body-md text-on-surface-variant">
              {isReverting ? 'Reverting changes...' : `Applying ${appliedCount} / ${matches.filter(m => m.accepted).length}…`}
            </p>
            {!isReverting && (
              <button 
                onClick={() => cancelRef.current = true}
                className="mt-4 md-btn btn btn-text text-error"
              >
                Cancel & Revert
              </button>
            )}
          </div>
        )}

        {/* ── Step: done ── */}
        {step === 'done' && (
          <div className="flex flex-col items-center justify-center gap-5 py-16 px-6">
            <div className="w-16 h-16 rounded-full flex items-center justify-center bg-primary-container text-on-primary-container">
              <Icon name="check_circle" className="text-[32px]" />
            </div>
            <div className="text-center">
              <p className="text-title-lg text-on-surface">Done</p>
              <p className="text-body-md text-on-surface-variant mt-1">
                Successfully assigned EPG IDs to <strong>{appliedCount}</strong> channel{appliedCount !== 1 ? 's' : ''}.
              </p>
            </div>
            <button
              onClick={onClose}
              className="md-btn btn btn-filled"
            >
              Done
            </button>
          </div>
        )}
    </Dialog>
  );
}
