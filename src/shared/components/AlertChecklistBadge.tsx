import { type ReactNode } from "react";
import { MapleHoverCard } from "./MapleHoverCard";
import { TooltipHelpContent } from "./FloatingTooltip";

export function AlertChecklistBadge({
  label,
  title,
  items,
  width = 360,
}: {
  id: string;
  label: string;
  title: ReactNode;
  items: ReactNode[];
  width?: number;
}) {
  return (
    <MapleHoverCard
      className="alert-checklist-hover-card"
      content={<TooltipHelpContent title={title} items={items} />}
      width={width}
    >
      <button
        aria-label={label}
        className="alert-checklist-badge"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        체크리스트
      </button>
    </MapleHoverCard>
  );
}
