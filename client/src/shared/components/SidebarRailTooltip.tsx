import { memo, useSyncExternalStore } from 'react';
import type { RailTipStore } from '../../lib/railTipStore';

interface SidebarRailTooltipProps {
  store: RailTipStore;
  active: boolean;
}

export const SidebarRailTooltip = memo(function SidebarRailTooltip({
  store,
  active,
}: SidebarRailTooltipProps) {
  const railTip = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  if (!active || !railTip) return null;
  return (
    <div className="rail-tooltip" role="tooltip" style={{ top: `${railTip.top}px` }}>
      {railTip.label}
    </div>
  );
});
