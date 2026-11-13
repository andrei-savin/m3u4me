import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useStore, notifyError } from '../store';
import { usePlaylists, useChannels, api, triggerRefresh } from '../apiClient';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import SortableNavRow from './SortableNavRow';
import Dialog from './Dialog';
import ConfirmDialog from './ConfirmDialog';
import { PaneSectionHeader } from './Dashboard';

const restrictToVerticalAxis = ({ transform }: any) => ({ ...transform, x: 0 });

/**
 * `onPick` runs after a category is chosen or added; Dashboard uses it to close the floating
 * drawer. `touch`: touch screens and the drawer, where the rows are plain until the section's
 * Edit button (`editing`, `onToggleEdit`, kept by Dashboard) shows their grips and buttons.
 */
export default function CategoryList({ playlistId, onPick, touch = false, editing = false, onToggleEdit }: {
  playlistId: string;
  onPick?: () => void;
  touch?: boolean;
  editing?: boolean;
  onToggleEdit?: () => void;
}) {
  const { activeCategory, setActiveCategory, setUndoEntry } = useStore();
  const { playlists } = usePlaylists();
  const { channels } = useChannels(playlistId);
  const playlist = playlists.find(p => p.id === playlistId);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const availableCats = useMemo(() => {
    const cats = new Set(channels.map(c => c.category).filter(Boolean));
    if (cats.size === 0 && channels.length > 0) cats.add('General');
    return cats;
  }, [channels]);

  const baseCategories = useMemo(() => {
    const savedCats = playlist?.categories || [];
    const orderedCats: string[] = [];
    const seen = new Set<string>();
    savedCats.forEach(c => { orderedCats.push(c); seen.add(c); });
    availableCats.forEach(c => { if (!seen.has(c)) orderedCats.push(c); });
    return orderedCats;
  }, [playlist?.categories, availableCats]);

  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  useEffect(() => { setLocalOrder(null); }, [playlist?.categories, availableCats]);
  const categories = localOrder ?? baseCategories;

  // Rename/delete/add below write the full categories array themselves, in one shot.
  // While one of those is in flight, channels and the playlist can refetch independently
  // (both ride the same global refresh bus) and briefly disagree with each other — e.g.
  // a channel's category already updated but the playlist's saved category list hasn't
  // caught up yet. If the auto-sync effect below ran during that window it would merge
  // the stale old name back in as a phantom empty category, so it's suppressed for the
  // duration of any explicit mutation.
  const mutatingCategoriesRef = useRef(false);

  useEffect(() => {
    if (!playlist || mutatingCategoriesRef.current) return;
    const same = playlist.categories?.length === categories.length
      && playlist.categories?.every((c, i) => c === categories[i]);
    if (!same && categories.length > 0) {
      api.updatePlaylist(playlistId, { categories }).then(triggerRefresh).catch(e => { console.error(e); notifyError(e, 'Failed to save category order.'); });
    }
  }, [categories, playlist]);

  useEffect(() => {
    if (!activeCategory && categories.length > 0) {
      setActiveCategory(categories[0]);
    } else if (activeCategory && !categories.includes(activeCategory) && categories.length > 0) {
      setActiveCategory(categories[0]);
    }
  }, [categories, activeCategory, setActiveCategory]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    channels.forEach(c => { if (c.category) map.set(c.category, (map.get(c.category) || 0) + 1); });
    return map;
  }, [channels]);

  // A category has no hidden flag of its own: it counts as hidden when every
  // channel in it is hidden, so it always matches what the channel rows show.
  const hiddenCounts = useMemo(() => {
    const map = new Map<string, number>();
    channels.forEach(c => { if (c.category && c.isHidden) map.set(c.category, (map.get(c.category) || 0) + 1); });
    return map;
  }, [channels]);

  const [savingCategory, setSavingCategory] = useState<string | null>(null);

  const toggleCategoryHidden = async (catName: string) => {
    const inCategory = channels.filter(c => c.category === catName);
    if (inCategory.length === 0) return;
    // All hidden → show them all. Anything visible → hide them all, so a partly
    // hidden category becomes fully hidden on the first click.
    const hide = !inCategory.every(c => c.isHidden);
    // Remember each channel's own state so undo brings back a hand-picked mix exactly.
    const previous = inCategory.map(c => ({ id: c.id, changes: { isHidden: !!c.isHidden } }));
    setSavingCategory(catName);
    try {
      await api.bulkUpdateChannels(playlistId, inCategory.map(c => c.id), { isHidden: hide });
      triggerRefresh();
      setUndoEntry({
        description: `${hide ? 'Hid' : 'Showed'} category "${catName}" (${inCategory.length} channels)`,
        restore: async () => {
          try {
            await api.bulkUpdateManyChannels(playlistId, previous);
            triggerRefresh();
          } catch (e) {
            console.error(e);
            notifyError(e, 'Failed to undo.');
          }
        },
      });
    } catch (e) {
      console.error(e);
      notifyError(e, hide ? 'Failed to hide category.' : 'Failed to show category.');
    } finally { setSavingCategory(null); }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const newArray = arrayMove(categories, categories.indexOf(active.id as string), categories.indexOf(over.id as string));
      setLocalOrder(newArray);
      mutatingCategoriesRef.current = true;
      try {
        await api.updatePlaylist(playlistId, { categories: newArray });
        triggerRefresh();
      } catch (e) {
        console.error(e);
        notifyError(e, 'Failed to save category order.');
        setLocalOrder(null);
      } finally { mutatingCategoriesRef.current = false; }
    }
  };

  const confirmRenameCategory = async () => {
    const oldName = renamingCategory;
    const newName = renameValue.trim();
    setRenamingCategory(null);
    if (!oldName || !newName || newName === oldName) return;
    if (categories.includes(newName)) {
      notifyError(new Error(`A category named "${newName}" already exists in this playlist.`));
      return;
    }
    mutatingCategoriesRef.current = true;
    try {
      const toUpdate = channels.filter(c => c.category === oldName).map(c => c.id);
      if (toUpdate.length > 0) await api.bulkUpdateChannels(playlistId, toUpdate, { category: newName });
      const newCats = categories.map(c => c === oldName ? newName : c);
      await api.updatePlaylist(playlistId, { categories: newCats });
      setLocalOrder(newCats);
      if (activeCategory === oldName) setActiveCategory(newName);
      triggerRefresh();
    } catch (e) { console.error(e); notifyError(e, 'Failed to rename category.'); }
    finally { mutatingCategoriesRef.current = false; }
  };

  const confirmDeleteCategory = async () => {
    if (!showDeleteConfirm || !playlist) return;
    const catName = showDeleteConfirm;
    const toDeleteChannels = channels.filter(c => c.category === catName);
    const toDeleteIds = toDeleteChannels.map(c => c.id);
    const remainingCats = categories.filter(c => c !== catName);
    setShowDeleteConfirm(null);
    mutatingCategoriesRef.current = true;
    try {
      if (toDeleteIds.length > 0) await api.bulkDeleteChannels(playlistId, toDeleteIds);
      const savedCats = remainingCats.length ? remainingCats : ['General'];
      await api.updatePlaylist(playlistId, { categories: savedCats });
      setLocalOrder(savedCats);
      triggerRefresh();
      setUndoEntry({
        description: `Deleted category "${catName}" (${toDeleteChannels.length} channels)`,
        restore: async () => {
          mutatingCategoriesRef.current = true;
          try {
            const restoreData = toDeleteChannels.map(({ id: _id, playlistId: _pid, createdAt: _c, updatedAt: _u, ...rest }) => rest);
            if (restoreData.length > 0) await api.bulkAddChannels(playlistId, restoreData);
            const restoredCats = [...remainingCats, catName];
            await api.updatePlaylist(playlistId, { categories: restoredCats });
            setLocalOrder(restoredCats);
            triggerRefresh();
          } catch (e) {
            console.error(e);
            notifyError(e, 'Failed to restore category.');
          } finally {
            mutatingCategoriesRef.current = false;
          }
        },
      });
    } catch (e) { console.error(e); notifyError(e, 'Failed to delete category.'); }
    finally { mutatingCategoriesRef.current = false; }
  };

  const handleAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!name || !playlist) return;
    if (categories.includes(name)) {
      notifyError(new Error(`A category named "${name}" already exists in this playlist.`));
      return;
    }
    mutatingCategoriesRef.current = true;
    try {
      const newCats = [...categories, name];
      await api.updatePlaylist(playlistId, { categories: newCats });
      setLocalOrder(newCats);
      setActiveCategory(name);
      onPick?.();
      triggerRefresh();
    } catch (e) { console.error(e); notifyError(e, 'Failed to add category.'); }
    finally { mutatingCategoriesRef.current = false; setNewCategoryName(''); setShowAddCategory(false); }
  };

  if (!playlist) return null;

  return (
    <div className="mt-3 pt-3 border-t border-outline-variant">
      <PaneSectionHeader title="Categories" addLabel="Add category" onAdd={() => setShowAddCategory(true)} editing={editing} onToggleEdit={touch ? onToggleEdit : undefined} />

      {/* Sortable list */}
      <div className="space-y-0.5">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
          <SortableContext items={categories} strategy={verticalListSortingStrategy}>
            {categories.map(c => (
              <SortableNavRow
                key={c}
                id={c}
                label={c}
                kind="category"
                isActive={activeCategory === c}
                count={counts.get(c) || 0}
                onPick={() => { setActiveCategory(c); onPick?.(); }}
                onDelete={() => setShowDeleteConfirm(c)}
                isHidden={(counts.get(c) || 0) > 0 && hiddenCounts.get(c) === counts.get(c)}
                hideDisabled={(counts.get(c) || 0) === 0 || savingCategory === c}
                onToggleHide={() => toggleCategoryHidden(c)}
                touch={touch}
                showActions={touch && editing}
                isRenaming={renamingCategory === c}
                renameValue={renameValue}
                onRenameStart={() => { setRenamingCategory(c); setRenameValue(c); }}
                onRenameChange={setRenameValue}
                onRenameConfirm={confirmRenameCategory}
                onRenameCancel={() => setRenamingCategory(null)}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      {showDeleteConfirm && (
        <ConfirmDialog title="Delete category" confirmLabel="Delete" danger onConfirm={confirmDeleteCategory} onClose={() => setShowDeleteConfirm(null)}>
          Delete <strong className="font-semibold text-on-surface">{showDeleteConfirm}</strong> and all its channels? You can undo this right after.
        </ConfirmDialog>
      )}

      {showAddCategory && (
        <Dialog onClose={() => { setShowAddCategory(false); setNewCategoryName(''); }}>
          <h2 className="text-headline-sm text-on-surface px-6 pt-6 pb-4">New category</h2>
          <div className="px-6 pb-2">
            <input
              autoFocus
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddCategory();
                if (e.key === 'Escape') { setShowAddCategory(false); setNewCategoryName(''); }
              }}
              placeholder="Category name"
              className="field max-md:text-base"
            />
          </div>
          <div className="flex justify-end gap-2 px-6 pt-4 pb-6">
            <button onClick={() => { setShowAddCategory(false); setNewCategoryName(''); }} className="md-btn btn btn-text">Cancel</button>
            <button onClick={handleAddCategory} disabled={!newCategoryName.trim()} className="md-btn btn btn-text">Add</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
