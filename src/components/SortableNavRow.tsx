import React, { useEffect, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Icon from './Icon';

/**
 * One row in the list pane that can be dragged to a new place: a playlist or a category.
 * Both look and behave the same: the name, a count on the right, and rename / hide / delete.
 *
 * - With a mouse the whole row is the drag handle (a click still selects: dragging only
 *   starts after moving 5px), so no space is kept free for a handle. A small grip fades in
 *   over the row's left padding as a hint, and the buttons appear on hover in place of the
 *   count. Double-click renames.
 * - With `touch` (touch screens and the floating drawer) there's no hover, and a finger's
 *   movement is needed for scrolling. The row is then just the name and count, a big target
 *   to tap. The list's Edit button (`showActions`) adds a grip to drag by and the buttons,
 *   including a rename pencil. (Hover-revealed buttons can't be used here: a tap on an iPad
 *   counts as a hover and would pop them up.)
 *
 * Must sit inside a dnd-kit SortableContext whose items include `id`.
 */
export default function SortableNavRow({
  id, label, kind, isActive, count, badge, onPick, onDelete,
  isHidden = false, onToggleHide, hideDisabled = false,
  touch, showActions,
  isRenaming, renameValue, onRenameStart, onRenameChange, onRenameConfirm, onRenameCancel,
}: {
  key?: string | number;
  id: string;
  label: string;
  /** Used in button labels: "Rename playlist", "Delete category"… */
  kind: 'playlist' | 'category';
  isActive: boolean;
  count: number;
  /** A small badge before the count, e.g. unread sync log entries. */
  badge?: React.ReactNode;
  onPick: () => void;
  onDelete: () => void;
  /** Categories only: every channel in it is hidden, and the eye button that toggles that. */
  isHidden?: boolean;
  onToggleHide?: () => void;
  hideDisabled?: boolean;
  touch: boolean;
  /** Touch only: the list is in Edit mode, so the grip and the buttons show. */
  showActions: boolean;
  isRenaming: boolean;
  renameValue: string;
  onRenameStart: () => void;
  onRenameChange: (v: string) => void;
  onRenameConfirm: () => void;
  onRenameCancel: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  // The row being dragged stays above its neighbours.
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined };
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) inputRef.current?.select();
  }, [isRenaming]);

  // Not while renaming, or dragging would fight with selecting text in the name box.
  const dragByRow = !touch && !isRenaming;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(dragByRow ? { ...attributes, ...listeners } : {})}
      // md-btn stays on the current row too: its overflow:hidden is what keeps the press
      // ripple inside the pill.
      className={`nav-item md-btn group ${touch ? 'h-[52px]' : 'h-11'} ${isActive ? 'nav-item-on' : ''} ${showActions ? '' : 'pl-5'}`}
    >
      {showActions ? (
        <div
          {...attributes}
          {...listeners}
          className="self-stretch flex items-center px-1 -mr-3 touch-none cursor-grab active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <Icon name="drag_indicator" className="text-[24px] mx-2" />
        </div>
      ) : !touch && (
        <Icon name="drag_indicator" className="absolute left-0 text-[20px] opacity-0 group-hover:opacity-60 transition-opacity pointer-events-none" />
      )}

      {isRenaming ? (
        <div className="flex-1 flex items-center pr-3 min-w-0">
          <input
            ref={inputRef}
            value={renameValue}
            onChange={e => onRenameChange(e.target.value)}
            onBlur={onRenameConfirm}
            onKeyDown={e => {
              if (e.key === 'Enter') onRenameConfirm();
              if (e.key === 'Escape') onRenameCancel();
            }}
            className="flex-1 min-w-0 text-label-lg max-md:text-base bg-transparent border-b-2 border-primary focus:outline-none text-on-surface px-0.5"
          />
        </div>
      ) : (
        <button
          onClick={onPick}
          onDoubleClick={e => { e.stopPropagation(); onRenameStart(); }}
          className={`flex-1 min-w-0 self-stretch flex items-center gap-2 text-left ${showActions ? 'pr-1' : touch ? 'pr-4' : 'pr-3'}`}
        >
          <span className={`flex-1 truncate ${isActive ? 'font-semibold' : isHidden ? '' : 'text-on-surface'}`}>{label}</span>
          {badge}
          {/* The count (and a hidden category's eye) make room for the buttons while the row is hovered. */}
          {isHidden && !showActions && <Icon name="visibility_off" className={`text-[20px] shrink-0 ${touch ? '' : 'group-hover:hidden'}`} aria-label="Hidden" />}
          {!showActions && <span className={`shrink-0 text-label-md min-w-6 text-right ${touch ? '' : 'group-hover:hidden'}`}>{count}</span>}
        </button>
      )}

      {!isRenaming && (showActions || !touch) && (
        <div className={`items-center pr-1 ${showActions ? 'flex' : 'hidden group-hover:flex'}`}>
          {/* Touch screens can't double-click to rename, so they get a pencil. */}
          {showActions && (
            <button
              onClick={e => { e.stopPropagation(); onRenameStart(); }}
              className="md-btn icon-btn w-11 h-11"
              title={`Rename ${kind}`}
            >
              <Icon name="edit" className="text-[20px]" />
            </button>
          )}
          {/* Hide/show every channel in the category. Looks and reads exactly like the
              per-channel eye button in PlaylistEditor, so it behaves the way people expect. */}
          {onToggleHide && (
            <button
              onClick={e => { e.stopPropagation(); onToggleHide(); }}
              disabled={hideDisabled}
              className={`md-btn icon-btn ${touch ? 'w-11 h-11' : 'w-9 h-9'}`}
              title={isHidden ? 'Include in export' : 'Exclude from export'}
            >
              {isHidden ? <Icon name="visibility_off" className="text-[20px]" /> : <Icon name="visibility" className="text-[20px]" />}
            </button>
          )}
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className={`md-btn icon-btn ${touch ? 'w-11 h-11' : 'w-9 h-9'} hover:text-error`}
            title={`Delete ${kind}`}
          >
            <Icon name="delete" className="text-[20px]" />
          </button>
        </div>
      )}
    </div>
  );
}
