import React from 'react';
import { CheckSquare, Square } from 'lucide-react';
import { SyncField, SyncFieldToggles as Toggles, SYNC_FIELDS } from '../apiClient';

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
 * The four "what to keep in sync" checkboxes. Shared by Settings (defaults), the Add to
 * Playlist modal (custom settings) and the sync controls in My Playlists, so they all look
 * and behave the same.
 */
export default function SyncFieldToggles({
  value,
  onChange,
  accentColor,
  disabled = false,
}: {
  value: Toggles;
  onChange: (next: Toggles) => void;
  accentColor: string;
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
            className={`md-btn flex items-center gap-2 h-9 px-3 rounded border text-sm text-left disabled:opacity-50 ${
              checked ? '' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
            }`}
            style={checked ? { borderColor: accentColor, color: accentColor, backgroundColor: `${accentColor}12` } : undefined}
          >
            {checked
              ? <CheckSquare className="h-4 w-4 shrink-0" />
              : <Square className="h-4 w-4 shrink-0 text-gray-400" />}
            {SYNC_FIELD_LABELS[field]}
          </button>
        );
      })}
    </div>
  );
}
