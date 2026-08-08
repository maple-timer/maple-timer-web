import type { CSSProperties } from "react";
import { getBuffExpiryCatalogItem } from "../../../domain/buff-expiry/catalog";
import type {
  BuffExpiryBox,
  BuffExpiryIconImageData,
  BuffExpirySnapshot,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryPrecisionIconObservation } from "../../../lib/buffExpiryPrecision/buffExpiryPrecisionTypes";
import {
  BUFF_EXPIRY_PRECISION_GROUP_LABELS,
  getBoxKey,
  getBuffExpiryPrecisionBoxPreviewImageData,
  type BuffExpiryDetectedBoxView,
} from "./buffExpiryPrecisionTargetSlots";

export type BuffExpiryDetectedBoxLayout = {
  columnCount: number;
  rows: Array<{
    key: string;
    items: Array<{
      view: BuffExpiryDetectedBoxView;
      colIndex: number;
    }>;
  }>;
};

export type BuffExpiryDetectedBoxPresentation = {
  label: string;
  statusClassName: string;
  title: string;
  countdownLabel: string | null;
  cropImageData: BuffExpiryIconImageData | null;
  cropStyle: CSSProperties | null;
};

export function getDetectedBoxLayout(views: BuffExpiryDetectedBoxView[]): BuffExpiryDetectedBoxLayout {
  if (!views.length) {
    return { columnCount: 1, rows: [] };
  }

  const providedLayout = getDetectedBoxProvidedLayout(views);
  if (providedLayout) {
    return providedLayout;
  }

  const rowGroups = groupDetectedBoxesByCoordinate(views, "y");
  const colGroups = groupDetectedBoxesByCoordinate(views, "x");
  return {
    columnCount: Math.max(1, colGroups.length),
    rows: rowGroups.map((rowGroup) => ({
      key: `row:${rowGroup.value}`,
      items: rowGroup.items
        .map((view) => ({
          view,
          colIndex: findDetectedBoxGroupIndex(colGroups, view.box.x),
        }))
        .filter((item) => item.colIndex >= 0)
        .sort((a, b) => a.colIndex - b.colIndex),
    })),
  };
}

export function getDetectedBoxPresentation({
  snapshot,
  view,
  showCountdown,
}: {
  snapshot: BuffExpirySnapshot | null;
  view: BuffExpiryDetectedBoxView;
  showCountdown: boolean;
}): BuffExpiryDetectedBoxPresentation {
  const label = getDetectedBoxLabel(view);
  return {
    label,
    statusClassName: getDetectedBoxStatusClassName(view),
    title: getDetectedBoxTitle(label, view),
    countdownLabel: showCountdown ? getStableTargetCountdownDisplayLabel(snapshot, view) : null,
    cropImageData: getBuffExpiryPrecisionBoxPreviewImageData(snapshot, view.box),
    cropStyle: getDetectedBoxCropStyle(snapshot, view.box),
  };
}

function getDetectedBoxProvidedLayout(
  views: BuffExpiryDetectedBoxView[],
): BuffExpiryDetectedBoxLayout | null {
  if (!views.every((view) => Number.isFinite(view.box.row) && Number.isFinite(view.box.col))) {
    return null;
  }

  const rows = new Map<number, BuffExpiryDetectedBoxView[]>();
  let maxCol = 0;
  for (const view of views) {
    const row = Math.max(0, Math.round(view.box.row ?? 0));
    const col = Math.max(0, Math.round(view.box.col ?? 0));
    maxCol = Math.max(maxCol, col);
    const rowItems = rows.get(row) ?? [];
    rowItems.push(view);
    rows.set(row, rowItems);
  }

  return {
    columnCount: maxCol + 1,
    rows: [...rows.entries()]
      .sort(([a], [b]) => a - b)
      .map(([row, items]) => ({
        key: `row:${row}`,
        items: items
          .map((view) => ({
            view,
            colIndex: Math.max(0, Math.round(view.box.col ?? 0)),
          }))
          .sort((a, b) => a.colIndex - b.colIndex),
      })),
  };
}

function groupDetectedBoxesByCoordinate(
  views: BuffExpiryDetectedBoxView[],
  axis: "x" | "y",
): Array<{ value: number; items: BuffExpiryDetectedBoxView[] }> {
  const sizes = views.map((view) => Math.max(view.box.width, view.box.height)).filter((size) => size > 0);
  const size = median(sizes.length ? sizes : [32]);
  const tolerance = Math.max(3, size * (axis === "x" ? 0.28 : 0.42));
  const groups: Array<{ value: number; items: BuffExpiryDetectedBoxView[] }> = [];

  for (const view of [...views].sort((a, b) => a.box[axis] - b.box[axis])) {
    const group = groups.find((candidate) => Math.abs(candidate.value - view.box[axis]) <= tolerance);
    if (group) {
      group.items.push(view);
      group.value = Math.round(median(group.items.map((entry) => entry.box[axis])));
    } else {
      groups.push({ value: Math.round(view.box[axis]), items: [view] });
    }
  }

  return groups.sort((a, b) => a.value - b.value);
}

function findDetectedBoxGroupIndex(
  groups: Array<{ value: number; items: BuffExpiryDetectedBoxView[] }>,
  value: number,
): number {
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < groups.length; index += 1) {
    const distance = Math.abs(groups[index]!.value - value);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return bestIndex;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) {
    return 0;
  }
  if (sorted.length % 2 === 1) {
    return sorted[middle]!;
  }
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function getDetectedBoxLabel(view: BuffExpiryDetectedBoxView): string {
  const buffId =
    view.track?.buffId ??
    view.pendingTrack?.buffId ??
    view.acceptedMatch?.buffId ??
    view.rejectedMatch?.candidateBuffId ??
    null;
  const catalogItem = buffId ? getBuffExpiryCatalogItem(buffId) : null;
  return (
    catalogItem?.label ??
    view.track?.name ??
    view.pendingTrack?.name ??
    view.acceptedMatch?.name ??
    view.rejectedMatch?.candidateName ??
    (view.nextObservation?.identity.group
      ? BUFF_EXPIRY_PRECISION_GROUP_LABELS[view.nextObservation.identity.group]
      : null) ??
    view.nextObservation?.identity.bestExcludedName ??
    "감지한 버프"
  );
}

function getDetectedBoxStatusClassName(view: BuffExpiryDetectedBoxView): string {
  if (view.track) {
    return "confirmed";
  }
  if (view.pendingTrack) {
    return "pending";
  }
  if (view.acceptedMatch) {
    return "accepted";
  }
  if (view.nextObservation?.identity.kind === "target") {
    return "next-target";
  }
  if (view.nextObservation?.identity.kind === "excluded") {
    return "next-excluded";
  }
  if (view.rejectedMatch) {
    return "rejected";
  }
  return "observed";
}

function getDetectedBoxTitle(label: string, view: BuffExpiryDetectedBoxView): string {
  if (view.track) {
    return `${label} · 확정 · ${view.track.detectedSeconds}초`;
  }
  if (view.pendingTrack) {
    const lastObservation = view.pendingTrack.observations[view.pendingTrack.observations.length - 1];
    return `${label} · 확인 중${lastObservation ? ` · ${lastObservation.seconds}초` : ""}`;
  }
  if (view.acceptedMatch) {
    return `${label} · 매칭 · ${view.acceptedMatch.seconds}초`;
  }
  if (view.rejectedMatch) {
    return `${label} · 제외 · ${view.rejectedMatch.reason}`;
  }
  if (view.nextObservation?.identity.kind === "target") {
    const identity = view.nextObservation.identity;
    const countdown = getNextCountdownTitle(view.nextObservation.countdown);
    return `${label} · 대상 버프${countdown ? ` · ${countdown}` : ""} · ${identity.score.toFixed(3)} · ${identity.decisionReason}`;
  }
  if (view.nextObservation?.identity.kind === "excluded") {
    const identity = view.nextObservation.identity;
    return `${label} · 제외 버프 · ${identity.score.toFixed(3)} · ${identity.decisionReason}`;
  }
  if (view.nextObservation?.identity.kind === "unknown") {
    const identity = view.nextObservation.identity;
    return `${label} · 미확인 · ${identity.score.toFixed(3)} · ${identity.decisionReason}`;
  }
  return label;
}

function getStableTargetCountdownDisplayLabel(
  snapshot: BuffExpirySnapshot | null,
  view: BuffExpiryDetectedBoxView,
): string | null {
  if (!view.track || !snapshot) {
    return null;
  }
  const remainingSeconds = Math.max(0, Math.ceil((view.track.expiresAt - snapshot.sampledAt) / 1000));
  if (remainingSeconds >= 60) {
    return null;
  }
  return `${remainingSeconds}초`;
}

function getNextCountdownTitle(
  countdown: BuffExpiryPrecisionIconObservation["countdown"] | null,
): string | null {
  if (!countdown) {
    return null;
  }
  if (countdown.kind === "exact") {
    if (countdown.format === "minutes-seconds" && countdown.text) {
      return countdown.text;
    }
    return countdown.totalSeconds === null ? null : `${countdown.totalSeconds}초`;
  }
  if (countdown.kind === "not_supported") {
    return `숫자 위치 미지원 · ${countdown.textRegion}`;
  }
  return countdown.routerTarget === "center" ? "숫자 없음" : "숫자 영역 없음";
}

function getDetectedBoxCropStyle(
  snapshot: BuffExpirySnapshot | null,
  box: BuffExpiryBox,
): CSSProperties | null {
  const boxPreviewUrl = snapshot?.boxPreviewUrls?.[getBoxKey(box)];
  if (boxPreviewUrl) {
    return {
      backgroundImage: `url(${boxPreviewUrl})`,
      backgroundSize: "32px 32px",
    };
  }

  if (!snapshot?.rawPreviewUrl || !snapshot.roi || box.width <= 0 || box.height <= 0) {
    return null;
  }

  const scale = 32 / Math.max(1, box.width);
  return {
    backgroundImage: `url(${snapshot.rawPreviewUrl})`,
    backgroundPosition: `${Math.round(-(box.x - snapshot.roi.x) * scale)}px ${Math.round(
      -(box.y - snapshot.roi.y) * scale,
    )}px`,
    backgroundSize: `${Math.round(snapshot.roi.width * scale)}px ${Math.round(snapshot.roi.height * scale)}px`,
  };
}
