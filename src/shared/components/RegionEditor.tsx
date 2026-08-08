import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  aspectRegionFromBottomRightDrag,
  coerceRegionToAspectRatio,
  rectangleRegionFromDrag,
} from "../../lib/capture";
import { clamp, normalizeRegion } from "../../lib/regions";
import type { RelativeRegion } from "../../types";

type RegionDragMode = "draw" | "move" | "nw" | "ne" | "sw" | "se";
export type RegionInteractionMode =
  | "edit"
  | "edit-existing"
  | "replace"
  | "move-only";
export type RegionShape = "square" | "rectangle" | "horizontal-band";

type RegionDragState = {
  mode: RegionDragMode;
  startX: number;
  startY: number;
  startRegion: RelativeRegion;
  currentRegion: RelativeRegion;
};

function aspectRegionFromCorner(
  region: RelativeRegion,
  mode: RegionDragMode,
  point: { x: number; y: number },
  sourceAspect: number,
  targetAspectRatio: number,
): RelativeRegion {
  const right = region.x + region.width;
  const bottom = region.y + region.height;
  const aspect = Math.max(0.1, sourceAspect);
  const targetAspect = Math.max(0.1, targetAspectRatio);
  const anchor =
    mode === "nw"
      ? { x: right, y: bottom }
      : mode === "ne"
        ? { x: region.x, y: bottom }
        : mode === "sw"
          ? { x: right, y: region.y }
          : { x: region.x, y: region.y };
  const signX = mode.includes("w") ? -1 : 1;
  const signY = mode.includes("n") ? -1 : 1;
  const maxSizeInSourceHeight = Math.min(
    signX > 0
      ? ((1 - anchor.x) * aspect) / targetAspect
      : (anchor.x * aspect) / targetAspect,
    signY > 0 ? 1 - anchor.y : anchor.y,
  );
  const sizeInSourceHeight = Math.max(
    0.006,
    Math.min(
      Math.max(
        (Math.abs(point.x - anchor.x) * aspect) / targetAspect,
        Math.abs(point.y - anchor.y),
      ),
      maxSizeInSourceHeight,
    ),
  );
  const width = (sizeInSourceHeight * targetAspect) / aspect;

  return normalizeRegion({
    x: signX > 0 ? anchor.x : anchor.x - width,
    y: signY > 0 ? anchor.y : anchor.y - sizeInSourceHeight,
    width,
    height: sizeInSourceHeight,
  });
}

function rectangleRegionFromCorner(
  region: RelativeRegion,
  mode: RegionDragMode,
  point: { x: number; y: number },
): RelativeRegion {
  const right = region.x + region.width;
  const bottom = region.y + region.height;
  const anchor =
    mode === "nw"
      ? { x: right, y: bottom }
      : mode === "ne"
        ? { x: region.x, y: bottom }
        : mode === "sw"
          ? { x: right, y: region.y }
          : { x: region.x, y: region.y };

  return rectangleRegionFromDrag(anchor, point);
}

export function RegionEditor({
  region,
  onChange,
  disabled,
  sourceAspect = 1,
  interactionMode = "edit",
  shape = "square",
  lockedAspectRatio,
  onCommit,
}: {
  region: RelativeRegion | null;
  onChange: (region: RelativeRegion) => void;
  onCommit?: (region: RelativeRegion) => void;
  disabled: boolean;
  sourceAspect?: number;
  interactionMode?: RegionInteractionMode;
  shape?: RegionShape;
  lockedAspectRatio?: number;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<RegionDragState | null>(null);
  const canDraw =
    interactionMode === "edit" || interactionMode === "replace";
  const canMove = interactionMode !== "replace";
  const showHandles =
    interactionMode === "edit" || interactionMode === "edit-existing";
  const effectiveAspectRatio = shape === "square" ? 1 : lockedAspectRatio;
  const editorRegion = useMemo(
    () =>
      region
        ? effectiveAspectRatio
          ? coerceRegionToAspectRatio(region, sourceAspect, effectiveAspectRatio)
          : normalizeRegion(region)
        : null,
    [effectiveAspectRatio, region, sourceAspect],
  );

  const getPoint = useCallback((event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }

    return {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    };
  }, []);

  const updateFromDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || disabled) {
        return;
      }

      const point = getPoint(event);
      let next: RelativeRegion;

      if (drag.mode === "draw") {
        next =
          effectiveAspectRatio
            ? aspectRegionFromBottomRightDrag(
                { x: drag.startX, y: drag.startY },
                point,
                sourceAspect,
                effectiveAspectRatio,
              )
            : rectangleRegionFromDrag({ x: drag.startX, y: drag.startY }, point);
      } else if (drag.mode === "move") {
        next = {
          ...drag.startRegion,
          x: clamp(point.x - drag.startX + drag.startRegion.x, 0, 1 - drag.startRegion.width),
          y: clamp(point.y - drag.startY + drag.startRegion.y, 0, 1 - drag.startRegion.height),
        };
      } else {
        next =
          effectiveAspectRatio
            ? aspectRegionFromCorner(
                drag.startRegion,
                drag.mode,
                point,
                sourceAspect,
                effectiveAspectRatio,
              )
            : rectangleRegionFromCorner(drag.startRegion, drag.mode, point);
      }

      drag.currentRegion = next;
      onChange(next);
    },
    [disabled, effectiveAspectRatio, getPoint, onChange, sourceAspect],
  );

  const beginDraw = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled || !canDraw || (interactionMode !== "replace" && event.target !== event.currentTarget)) {
        return;
      }
      const point = getPoint(event);
      const initial =
        effectiveAspectRatio
          ? aspectRegionFromBottomRightDrag(
              point,
              { x: point.x + 0.02, y: point.y + 0.02 },
              sourceAspect,
              effectiveAspectRatio,
            )
          : rectangleRegionFromDrag(point, { x: point.x + 0.08, y: point.y + 0.05 });
      dragRef.current = {
        mode: "draw",
        startX: point.x,
        startY: point.y,
        startRegion: initial,
        currentRegion: initial,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      onChange(dragRef.current.startRegion);
    },
    [
      canDraw,
      disabled,
      effectiveAspectRatio,
      getPoint,
      interactionMode,
      onChange,
      sourceAspect,
    ],
  );

  const beginMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!editorRegion || disabled || !canMove) {
        return;
      }
      event.stopPropagation();
      const point = getPoint(event);
      dragRef.current = {
        mode: "move",
        startX: point.x,
        startY: point.y,
        startRegion: editorRegion,
        currentRegion: editorRegion,
      };
      overlayRef.current?.setPointerCapture(event.pointerId);
    },
    [canMove, disabled, editorRegion, getPoint],
  );

  const beginResize = useCallback(
    (mode: RegionDragMode) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!editorRegion || disabled) {
        return;
      }
      event.stopPropagation();
      const point = getPoint(event);
      dragRef.current = {
        mode,
        startX: point.x,
        startY: point.y,
        startRegion: editorRegion,
        currentRegion: editorRegion,
      };
      overlayRef.current?.setPointerCapture(event.pointerId);
    },
    [disabled, editorRegion, getPoint],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const committedRegion = dragRef.current?.currentRegion;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (committedRegion) {
        onCommit?.(committedRegion);
      }
    },
    [onCommit],
  );

  return (
    <div
      ref={overlayRef}
      className={[
        "region-editor",
        disabled ? "disabled" : "",
        interactionMode === "replace" ? "replace-mode" : "",
        interactionMode === "move-only" ? "move-only" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onPointerDown={beginDraw}
      onPointerMove={updateFromDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {editorRegion ? (
        <div
          className="region-box"
          style={{
            left: `${editorRegion.x * 100}%`,
            top: `${editorRegion.y * 100}%`,
            width: `${editorRegion.width * 100}%`,
            height: `${editorRegion.height * 100}%`,
          }}
          onPointerDown={beginMove}
        >
          {showHandles && (
            <>
              <button
                className="region-handle nw"
                type="button"
                onPointerDown={beginResize("nw")}
                aria-label="좌상단 크기 조절"
              />
              <button
                className="region-handle ne"
                type="button"
                onPointerDown={beginResize("ne")}
                aria-label="우상단 크기 조절"
              />
              <button
                className="region-handle sw"
                type="button"
                onPointerDown={beginResize("sw")}
                aria-label="좌하단 크기 조절"
              />
              <button
                className="region-handle se"
                type="button"
                onPointerDown={beginResize("se")}
                aria-label="우하단 크기 조절"
              />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
