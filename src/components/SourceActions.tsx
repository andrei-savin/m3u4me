import Icon from './Icon';

/**
 * Refresh and Edit for the channel source or EPG source that's open, next to its title in
 * ChannelPoolViewer and EpgViewer (tablets and computers; phones have the same two actions in
 * the top bar's ⋮). The list pane has them too, but there they're behind a hover with a mouse
 * and behind Edit on touch screens, which is too far away for something done this often.
 *
 * `onRefresh` is left out for uploaded files, which can't be downloaded again.
 */
export default function SourceActions({
  onRefresh,
  isRefreshing,
  onEdit,
  kind,
}: {
  onRefresh?: () => void;
  isRefreshing: boolean;
  onEdit: () => void;
  kind: 'source' | 'guide';
}) {
  return (
    <div className="shrink-0 flex items-center gap-0.5 -mb-1">
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="md-btn icon-btn text-on-surface-variant"
          title={isRefreshing ? 'Downloading…' : `Download this ${kind} again now`}
          aria-label={`Refresh ${kind}`}
        >
          <Icon name="refresh" className={`text-[24px] ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      )}
      <button
        onClick={onEdit}
        className="md-btn icon-btn text-on-surface-variant"
        title={`Edit this ${kind}: its address and how often it refreshes`}
        aria-label={`Edit ${kind}`}
      >
        <Icon name="edit" className="text-[24px]" />
      </button>
    </div>
  );
}
