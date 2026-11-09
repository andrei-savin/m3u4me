import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { api, EpgChannel } from '../apiClient';
import { useStore, notifyError } from '../store';
import { useDebouncedValue } from '../utils/useDebouncedValue';

/* Same look as PlaylistEditor's other click-to-edit fields. */
const inlineInputCls = 'border-b-2 bg-transparent text-sm text-gray-900 dark:text-white px-0.5 py-0 focus:outline-none w-full';

/**
 * TVG-ID text field that suggests matching channels from the loaded EPG guides as you type.
 * Two ways to use it:
 *
 * - `inline` (desktop channel rows): opens focused, and finishes the edit by saving on
 *   Enter, on picking a suggestion, or on leaving the field; Escape cancels. `onSave` and
 *   `onCancel` are only used here.
 * - `field` (the phone channel editor sheet): an ordinary form field. Picking a suggestion
 *   just fills it in; saving is the sheet's Save button.
 */
export default function TvgIdAutocomplete({ value, onChange, onSave, onCancel, mode = 'inline' }: {
  value: string;
  onChange: (v: string) => void;
  onSave?: (value: string) => void;
  onCancel?: () => void;
  mode?: 'inline' | 'field';
}) {
  const { accentColor } = useStore();
  const isField = mode === 'field';
  const [suggestions, setSuggestions] = useState<EpgChannel[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Set once the edit has been saved or cancelled, so the blur that follows (the field unmounts
  // or loses focus) doesn't save a second time with the typed text.
  const finishedRef = useRef(false);
  // In field mode, picking a suggestion changes the value, which would otherwise search again
  // and reopen the list straight away.
  const pickedRef = useRef<string | null>(null);
  // The newest search sent. An older search that answers late is ignored, so fast typing
  // never ends with suggestions for something typed earlier.
  const latestQueryRef = useRef('');
  const debouncedValue = useDebouncedValue(value, 200);

  // Clears suggestions immediately when the field is emptied, rather than waiting out
  // the debounce below.
  useEffect(() => {
    if (!value.trim()) { setSuggestions([]); setShowDropdown(false); }
  }, [value]);

  useEffect(() => {
    if (!debouncedValue.trim()) return;
    if (pickedRef.current === debouncedValue) return;
    // Field mode: only search while the person is typing in it, not for the saved value
    // the sheet opens with.
    if (isField && document.activeElement !== inputRef.current) return;
    const query = debouncedValue;
    latestQueryRef.current = query;
    api.searchTvgIds(query).then(data => {
      if (latestQueryRef.current !== query) return;
      // Field mode: if the person left the field while this search was on its way, don't pop
      // the list open over the rest of the form.
      if (isField && document.activeElement !== inputRef.current) return;
      setSuggestions(data);
      // Shown even with no results, so a "No matching EPG channels" line confirms the search ran.
      setShowDropdown(true);
      setActiveIdx(-1);
    }).catch(e => {
      console.error(e);
      setSuggestions([]);
      notifyError(e, 'Failed to search EPG channels.');
    });
  }, [debouncedValue, isField]);

  // The dropdown is portalled to <body> with fixed positioning because the TVG-ID cell clips
  // its overflow, which used to hide the dropdown entirely. Placed below the field when there's
  // room, otherwise above it, and re-placed on scroll/resize so it stays attached to the row.
  // "Room" is measured against the visible part of the page (visualViewport): on a phone the
  // on-screen keyboard covers the bottom, and the list must not end up underneath it.
  useLayoutEffect(() => {
    if (!showDropdown) return;
    const place = () => {
      const input = inputRef.current;
      const menu = dropdownRef.current;
      if (!input || !menu) return;
      const margin = 8;
      const visible = window.visualViewport;
      const viewTop = visible?.offsetTop ?? 0;
      const viewBottom = viewTop + (visible?.height ?? window.innerHeight);
      const anchor = input.getBoundingClientRect();
      const width = Math.min(Math.max(anchor.width, 280), window.innerWidth - margin * 2);
      const height = menu.offsetHeight;
      let top = anchor.bottom + 4;
      if (top + height > viewBottom - margin) top = Math.max(viewTop + margin, anchor.top - height - 4);
      const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin));
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
      menu.style.width = `${width}px`;
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [showDropdown, suggestions]);

  const finish = (save: boolean, saveValue = value) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setShowDropdown(false);
    if (save) onSave?.(saveValue); else onCancel?.();
  };

  const selectSuggestion = (id: string) => {
    onChange(id);
    if (isField) {
      pickedRef.current = id;
      setShowDropdown(false);
      return;
    }
    finish(true, id);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (isField) {
        // Close just the list, not the sheet around the field.
        if (showDropdown) { e.stopPropagation(); setShowDropdown(false); }
        return;
      }
      finish(false);
      return;
    }
    if (e.key === 'Enter') {
      if (activeIdx >= 0 && suggestions[activeIdx]) {
        e.preventDefault();
        selectSuggestion(suggestions[activeIdx].id);
      } else if (isField) {
        setShowDropdown(false);
      } else {
        finish(true);
      }
      return;
    }
    if (e.key === 'ArrowDown' && showDropdown) {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp' && showDropdown) {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    }
  };

  useEffect(() => {
    if (activeIdx >= 0) {
      dropdownRef.current?.querySelector(`[data-idx="${activeIdx}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIdx]);

  return (
    <div className="w-full relative" onClick={e => e.stopPropagation()}>
      <input
        ref={inputRef}
        autoFocus={!isField}
        value={value}
        onChange={e => { pickedRef.current = null; onChange(e.target.value); }}
        onBlur={e => {
          if (!isField) { finish(true); return; }
          setShowDropdown(false);
          e.target.style.borderColor = '';
        }}
        onKeyDown={handleKey}
        className={isField
          ? 'w-full h-11 px-3 rounded border border-gray-300 dark:border-gray-600 bg-transparent font-mono text-base text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none'
          : `${inlineInputCls} font-mono text-[11px]`}
        style={isField ? undefined : { borderColor: accentColor }}
        onFocus={isField ? e => (e.target.style.borderColor = accentColor) : undefined}
        placeholder={isField ? 'Type to search your guides…' : 'Type to search EPG pool…'}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {showDropdown && createPortal(
        <div
          ref={dropdownRef}
          // Keeps focus in the field when clicking the dropdown (e.g. its scrollbar), since
          // blurring the field saves and closes the edit.
          onMouseDown={e => e.preventDefault()}
          className="md-menu fixed z-50 bg-white dark:bg-[#2a2a2a] amoled:dark:bg-[#1a1a1a] rounded elev-8 max-h-48 overflow-y-auto border border-gray-200 dark:border-white/10"
        >
          {suggestions.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-gray-400 dark:text-gray-500">No matching EPG channels</p>
          )}
          {suggestions.map((s, i) => (
            <button
              key={`${s.sourceId}-${s.id}`}
              data-idx={i}
              onMouseDown={e => { e.preventDefault(); selectSuggestion(s.id); }}
              className={`w-full flex items-center gap-2 px-3 py-2 ${isField ? 'min-h-11 text-sm' : 'text-[11px]'} text-left transition-colors ${
                i === activeIdx ? 'dark:bg-white/10' : 'hover:bg-gray-50 dark:hover:bg-white/5'
              }`}
              style={i === activeIdx ? { backgroundColor: `${accentColor}15` } : undefined}
            >
              {s.icon && <img src={s.icon} className="w-4 h-4 rounded shrink-0" alt="" onError={e => (e.currentTarget.style.display = 'none')} />}
              <span className="truncate text-gray-700 dark:text-gray-200">{s.displayName}</span>
              <span className="ml-auto shrink-0 font-mono text-gray-400 dark:text-gray-500 text-[10px]">{s.id}</span>
              <span className="shrink-0 text-gray-300 dark:text-gray-600 text-[9px]">{s.sourceName}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
