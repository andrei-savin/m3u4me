import React from 'react';
import { EpgProgramme } from '../apiClient';
import { useStore } from '../store';
import { formatTime } from '../utils/formatTime';
import Dialog from './Dialog';
import Icon from './Icon';

export interface EpgProgramDialogProps {
  programme: EpgProgramme | null;
  onClose: () => void;
  onAssignChannel?: (channelId: string) => void;
}

export function parseXmltvTime(str: string): Date {
  if (!str || str.length < 14) return new Date();
  
  const year = parseInt(str.substring(0, 4), 10);
  const month = parseInt(str.substring(4, 6), 10) - 1;
  const day = parseInt(str.substring(6, 8), 10);
  const hour = parseInt(str.substring(8, 10), 10);
  const minute = parseInt(str.substring(10, 12), 10);
  const second = parseInt(str.substring(12, 14), 10);
  
  let date = new Date(Date.UTC(year, month, day, hour, minute, second));
  
  const tzMatch = str.match(/([+-]\d{2})(\d{2})$/);
  if (tzMatch) {
    const tzSign = tzMatch[1].startsWith('+') ? 1 : -1;
    const tzHour = parseInt(tzMatch[1].substring(1), 10);
    const tzMin = parseInt(tzMatch[2], 10);
    const tzOffsetMs = tzSign * (tzHour * 60 + tzMin) * 60000;
    date = new Date(date.getTime() - tzOffsetMs);
  }
  
  return date;
}

function formatDuration(ms: number): string {
  const totalMins = Math.floor(ms / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export default function EpgProgramDialog({ programme, onClose, onAssignChannel }: EpgProgramDialogProps) {
  const { is24Hour } = useStore();

  if (!programme) return null;

  const startDate = parseXmltvTime(programme.start);
  const endDate = parseXmltvTime(programme.stop);
  const durationMs = endDate.getTime() - startDate.getTime();

  const formattedTime = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: !is24Hour,
  }).format(startDate);

  const formattedEndTime = formatTime(endDate, is24Hour);

  return (
    <Dialog onClose={onClose} maxWidth="max-w-lg" panelClassName="max-h-[90vh]">
        <div className="flex items-center justify-between pl-6 pr-3 pt-5 pb-1 shrink-0">
          <h2 className="text-headline-sm text-on-surface truncate pr-4">
            {programme.title}
          </h2>
          <button 
            onClick={onClose} 
            className="md-btn icon-btn"
            aria-label="Close dialog"
          >
            <Icon name="close" className="text-[24px]" />
          </button>
        </div>
        
        <div className="px-6 pb-6 overflow-y-auto">
          <p className="text-label-lg text-primary mb-4">
            {formattedTime} &ndash; {formattedEndTime} ({formatDuration(durationMs)})
          </p>
          
          {programme.desc && (
            <div className="text-body-md text-on-surface-variant space-y-2 mb-4 whitespace-pre-wrap">
              {programme.desc}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-4">
            {programme.category && (
              <span className="inline-flex items-center h-8 px-3 rounded-lg border border-outline-variant text-label-lg text-on-surface-variant">
                {programme.category}
              </span>
            )}
            {programme.episodeNum && (
              <span className="inline-flex items-center h-8 px-3 rounded-lg border border-outline-variant text-label-lg text-on-surface-variant">
                Ep: {programme.episodeNum}
              </span>
            )}
            {programme.date && (
              <span className="inline-flex items-center h-8 px-3 rounded-lg border border-outline-variant text-label-lg text-on-surface-variant">
                Year: {programme.date}
              </span>
            )}
            {programme.rating && (
              <span className="inline-flex items-center h-8 px-3 rounded-lg border border-outline-variant text-label-lg text-on-surface-variant">
                Rating: {programme.rating}
              </span>
            )}
          </div>
        </div>

        {onAssignChannel && (
          <div className="flex justify-end gap-2 px-6 pb-6 shrink-0">
            <button
              onClick={() => onAssignChannel(programme.channel)}
              className="md-btn btn btn-tonal"
            >
              Assign this channel's EPG
            </button>
          </div>
        )}
    </Dialog>
  );
}
