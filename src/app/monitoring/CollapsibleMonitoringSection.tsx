import { ChevronDown } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { FloatingTooltipButton } from "../../shared/components/FloatingTooltip";
import type { MonitoringSectionId } from "./monitoringSectionCollapse";

export function CollapsibleMonitoringSection({
  id,
  title,
  isEnabled,
  isCollapsed,
  onToggle,
  renderExpanded,
}: {
  id: MonitoringSectionId;
  title: string;
  isEnabled: boolean;
  isCollapsed: boolean;
  onToggle: (sectionId: MonitoringSectionId) => void;
  renderExpanded: (headerAction: ReactNode, isSectionCollapsed: boolean) => ReactNode;
}) {
  const actionLabel = isCollapsed ? `${title} 패널 펼치기` : `${title} 패널 접기`;

  const handleExpandedClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (!target.closest(".panel-heading")) {
      return;
    }
    if (
      target.closest(
        "button, a, input, select, textarea, label, [role='button'], .alert-section-controls",
      )
    ) {
      return;
    }
    onToggle(id);
  };

  return (
    <section
      className={
        isCollapsed
          ? "alert-section-animator is-collapsed"
          : "alert-section-animator is-expanded"
      }
    >
      <div
        className={
          isCollapsed ? "alert-section-shell section-collapsed" : "alert-section-shell"
        }
        onClick={handleExpandedClick}
      >
        {renderExpanded(
          <div className="alert-section-controls">
            <FloatingTooltipButton
              className={
                isCollapsed
                  ? "icon-button small alert-section-collapse-button"
                  : "icon-button small alert-section-collapse-button expanded"
              }
              type="button"
              aria-expanded={!isCollapsed}
              aria-label={actionLabel}
              tooltip={isCollapsed ? "펼치기" : "접기"}
              tooltipId={`${id}-section-collapse-tooltip`}
              onClick={() => onToggle(id)}
            >
              <ChevronDown size={16} />
            </FloatingTooltipButton>
          </div>,
          isCollapsed,
        )}
      </div>
    </section>
  );
}
