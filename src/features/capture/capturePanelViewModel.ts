import type { CaptureStatus } from "../../captureTypes";
import { coerceRegionToSquare } from "../../lib/capture";
import { getGameResolutionLabel } from "../../lib/gameResolutions";
import {
  captureSizeToLayoutKey,
  getSkillRegionForLayout,
  hasUsableRegion,
} from "../../lib/regions";
import type { RelativeRegion, RuneAlertConfig, SkillConfig } from "../../types";

export { getGameResolutionLabel };

export type CapturePanelViewModel = {
  layoutKey: string | null;
  captureSizeLabel: string;
  canStartCapture: boolean;
  shellClassName: string;
  shellStyle: { aspectRatio: string } | undefined;
  shouldShowCollapsedStartButton: boolean;
  shouldShowChangeButton: boolean;
  shouldShowStaticOverlay: boolean;
  shouldShowPlaceholder: boolean;
};

export type CaptureStaticRegionBoxStyle = {
  left: string;
  top: string;
  width: string;
  height: string;
};

export type CaptureStaticRegionBox = {
  id: string;
  className: string;
  style: CaptureStaticRegionBoxStyle;
};

export function isInteractiveHeaderTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    ? Boolean(target.closest("button, a, input, select, textarea, label, [role='button']"))
    : false;
}

export function getCapturePanelViewModel({
  stream,
  captureStatus,
  captureSize,
  currentLayoutKey,
  isCollapsed,
}: {
  stream: MediaStream | null;
  captureStatus: CaptureStatus;
  captureSize: { width: number; height: number } | null;
  currentLayoutKey?: string | null;
  isCollapsed: boolean;
}): CapturePanelViewModel {
  const layoutKey = currentLayoutKey ?? captureSizeToLayoutKey(captureSize);
  const canStartCapture = !stream && captureStatus !== "starting";

  return {
    layoutKey,
    captureSizeLabel: getGameResolutionLabel(captureSize),
    canStartCapture,
    shellClassName: ["video-shell", stream ? "has-video" : ""].filter(Boolean).join(" "),
    shellStyle: captureSize
      ? { aspectRatio: `${captureSize.width} / ${captureSize.height}` }
      : undefined,
    shouldShowCollapsedStartButton: isCollapsed && canStartCapture,
    shouldShowChangeButton: Boolean(stream),
    shouldShowStaticOverlay: !isCollapsed && Boolean(stream && captureSize),
    shouldShowPlaceholder: !isCollapsed && !stream,
  };
}

export function getCaptureStaticRegionBoxes({
  skills,
  runeAlert,
  layoutKey,
  sourceAspect,
}: {
  skills: SkillConfig[];
  runeAlert?: RuneAlertConfig;
  layoutKey: string | null;
  sourceAspect: number;
}): CaptureStaticRegionBox[] {
  const skillBoxes = skills
    .map((skill) => ({ id: skill.id, region: getSkillRegionForLayout(skill, layoutKey) }))
    .filter((item): item is { id: string; region: RelativeRegion } => hasUsableRegion(item.region))
    .map(({ id, region }) => ({
      id,
      className: "region-static-box",
      style: getCaptureStaticRegionBoxStyle(coerceRegionToSquare(region, sourceAspect)),
    }));
  const runeRegion = runeAlert?.enabled
    ? getSkillRegionForLayout(runeAlert, layoutKey)
    : null;

  if (!hasUsableRegion(runeRegion)) {
    return skillBoxes;
  }

  return [
    ...skillBoxes,
    {
      id: "rune",
      className: "region-static-box rune-region-static-box",
      style: getCaptureStaticRegionBoxStyle(runeRegion),
    },
  ];
}

function getCaptureStaticRegionBoxStyle(region: RelativeRegion): CaptureStaticRegionBoxStyle {
  return {
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.width * 100}%`,
    height: `${region.height * 100}%`,
  };
}
