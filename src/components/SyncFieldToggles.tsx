import React from 'react';
import { SyncField, SyncFieldToggles as Toggles, SYNC_FIELDS } from '../apiClient';
import Icon from './Icon';

export const SYNC_FIELD_LABELS: Record<SyncField, string> = {
  url: 'Stream link',
  name: 'Name',
  logo: 'Logo',
  tvgId: 'TVG-ID',
};

// One-line summary of which fields are on, e.g. "Stream link, Name".
export function describeSyncFields(fields: Toggles): string {
  const on = SYNC_FIELDS.filter(f => fields[f]).map(f => SYNC_FIELD_LABELS[f]);
  return on.length ? on.join(', ') : 'Nothing';
}

export function anySyncFieldOn(fields: Toggles): boolean {
  return SYNC_FIELDS.some(f => fields[f]);
}

/**
 * The four "what to keep in sync" switches, as Material 3 filter chips (filled with a tick
 * when on). Shared by Settings (defaults), the Add to Playlist modal (custom settings) and
 * the sync controls in My Playlists, so they all look and behave the same.
 */
export default function SyncFieldToggles({
  value,
  onChange,
  disabled = false,
}: {
  value: Toggles;
  onChange: (next: Toggles) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {SYNC_FIELDS.map(field => {
        const checked = value[field];
        return (
          <button
            key={field}
            type="button"
            role="checkbox"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange({ ...value, [field]: !checked })}
            className={`md-btn chip justify-start text-left disabled:opacity-40 ${checked ? 'chip-on' : 'text-on-surface'}`}
          >
            {checked && <Icon name="check" className="text-[20px] shrink-0 -ml-1" />}
            {SYNC_FIELD_LABELS[field]}
          </button>
        );
      })}
    </div>
  );
}
