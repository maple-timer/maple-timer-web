import type { FocusEvent, MouseEvent } from "react";
import { ImageDataCanvas } from "../../../shared/components/ImageDataCanvas";
import type { getSkillRowVisualState } from "./skillDashboardUtils";

type SkillCropVisualState = ReturnType<typeof getSkillRowVisualState>;

export function SkillCropCell({
  visualState,
  hasRegion,
  canPickRegion,
  cropTooltipId,
  onOpenMissingRegionPicker,
  showFloatingTooltip,
  hideFloatingTooltip,
}: {
  visualState: SkillCropVisualState;
  hasRegion: boolean;
  canPickRegion: boolean;
  cropTooltipId: string | undefined;
  onOpenMissingRegionPicker: () => void;
  showFloatingTooltip: (id: string, text: string, target: HTMLElement) => void;
  hideFloatingTooltip: () => void;
}) {
  const isBuffDurationPlaceholder =
    visualState.kind === "placeholder" && visualState.variant === "buff-duration";
  const isBuffDurationLoadingPlaceholder =
    isBuffDurationPlaceholder && visualState.description === "모듈 로딩 중";
  const canShowRegionAction =
    visualState.kind === "placeholder" &&
    !hasRegion &&
    canPickRegion &&
    (visualState.label === "스킬 영역 선택" ||
      visualState.label === "스킬 영역 다시 선택" ||
      visualState.label === "게임 영역 설정 필요");
  const passivePlaceholderClassName = [
    isBuffDurationPlaceholder ? "skill-buff-duration-description" : "crop-unavailable-text",
    visualState.tone ? `is-${visualState.tone}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const tooltipProps = {
    "aria-describedby": cropTooltipId,
    onBlur: hideFloatingTooltip,
    onFocus: (event: FocusEvent<HTMLElement>) => {
      if (visualState.tooltip && cropTooltipId) {
        showFloatingTooltip(cropTooltipId, visualState.tooltip, event.currentTarget);
      }
    },
    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
      if (visualState.tooltip && cropTooltipId) {
        showFloatingTooltip(cropTooltipId, visualState.tooltip, event.currentTarget);
      }
    },
    onMouseLeave: hideFloatingTooltip,
  };

  const renderBuffDurationPlaceholderContent = () => {
    if (isBuffDurationLoadingPlaceholder) {
      return (
        <span
          className="buff-expiry-precision-prep-metric skill-buff-duration-loading-metric"
          role="status"
          aria-live="polite"
          aria-label={visualState.description}
        >
          <span className="buff-expiry-precision-prep-spinner" aria-hidden="true" />
          <span>{visualState.description}</span>
          <span className="buff-expiry-precision-prep-progress" aria-hidden="true">
            <span />
          </span>
        </span>
      );
    }

    return (
      <span className="skill-buff-duration-summary-text">
        {visualState.description ?? visualState.label}
      </span>
    );
  };

  if (visualState.kind === "thumbnail") {
    if (visualState.variant === "buff-duration") {
      return (
        <div className="skill-cell" role="cell">
          <div
            className={[
              "skill-buff-duration-summary",
              visualState.tone ? `is-${visualState.tone}` : "",
            ]
              .filter(Boolean)
              .join(" ")}
            {...tooltipProps}
            tabIndex={visualState.tooltip ? 0 : undefined}
          >
            {visualState.imageData ? (
              <ImageDataCanvas
                className="skill-buff-duration-summary-icon"
                image={visualState.imageData}
                ariaLabel={visualState.label ?? "감지된 버프칸 스킬"}
              />
            ) : (
              <img
                className="skill-buff-duration-summary-icon"
                src={visualState.url ?? ""}
                alt={visualState.label ?? "감지된 버프칸 스킬"}
              />
            )}
            <span className="skill-buff-duration-summary-copy">
              <span className="skill-buff-duration-summary-text">
                {visualState.description ?? visualState.label}
              </span>
            </span>
          </div>
        </div>
      );
    }

    return (
      <div className="skill-cell" role="cell">
        <div className="crop-preview" {...tooltipProps} tabIndex={visualState.tooltip ? 0 : undefined}>
          <img
            className={visualState.variant === "buff-duration" ? "skill-buff-duration-thumbnail" : undefined}
            src={visualState.url ?? ""}
            alt={visualState.label ?? "감지 영역 미리보기"}
          />
          {visualState.badgeLabel && (
            <span className="skill-buff-duration-thumbnail-badge">{visualState.badgeLabel}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="skill-cell" role="cell">
      <div className={isBuffDurationPlaceholder ? "skill-buff-duration-summary-wrap" : "crop-preview"}>
        {canShowRegionAction ? (
          <button
            {...tooltipProps}
            className="region-required-action"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenMissingRegionPicker();
            }}
          >
            {visualState.label}
          </button>
        ) : !hasRegion ? (
          <span
            {...tooltipProps}
            className={passivePlaceholderClassName}
            tabIndex={visualState.tooltip ? 0 : undefined}
            onClick={(event) => event.stopPropagation()}
          >
            {isBuffDurationPlaceholder ? (
              renderBuffDurationPlaceholderContent()
            ) : (
              visualState.label
            )}
          </span>
        ) : (
          <span
            className={passivePlaceholderClassName}
          >
            {isBuffDurationPlaceholder ? (
              renderBuffDurationPlaceholderContent()
            ) : (
              visualState.label
            )}
          </span>
        )}
      </div>
    </div>
  );
}
