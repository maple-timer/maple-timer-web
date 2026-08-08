import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useRef,
  useState,
} from "react";
import { clamp, normalizeRegion } from "../../lib/regions";
import type { RelativeRegion } from "../../types";

const DEFAULT_BAND_X = 0.33;
const DEFAULT_BAND_WIDTH = 0.34;
const MIN_BAND_HEIGHT = 0.006;

function buildBandRegion(topY: number): RelativeRegion {
  const top = clamp(topY, 0, 1 - MIN_BAND_HEIGHT);
  return normalizeRegion({
    x: DEFAULT_BAND_X,
    y: top,
    width: DEFAULT_BAND_WIDTH,
    height: 1 - top,
  });
}

export function BandRegionEditor({
  region,
  onChange,
  onCommit,
  disabled,
}: {
  region: RelativeRegion | null;
  onChange: (region: RelativeRegion) => void;
  onCommit?: (region: RelativeRegion) => void;
  disabled: boolean;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [hoverY, setHoverY] = useState<number | null>(null);

  const getY = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) {
      return 0;
    }

    return clamp((event.clientY - rect.top) / rect.height);
  }, []);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) {
        return;
      }
      setHoverY(getY(event));
    },
    [disabled, getY],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) {
        return;
      }
      event.stopPropagation();
      const nextY = getY(event);
      const nextRegion = buildBandRegion(nextY);
      setHoverY(nextY);
      onChange(nextRegion);
      onCommit?.(nextRegion);
    },
    [disabled, getY, onChange, onCommit],
  );

  const previewRegion = hoverY !== null ? buildBandRegion(hoverY) : null;
  const editorRegion = region ? normalizeRegion(region) : null;

  return (
    <div
      ref={overlayRef}
      className={[
        "region-editor",
        "band-region-editor",
        disabled ? "disabled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setHoverY(null)}
    >
      {hoverY !== null && (
        <span
          className="region-band-hover-line"
          style={{ top: `${hoverY * 100}%` }}
          aria-hidden="true"
        />
      )}
      {(previewRegion ?? editorRegion) ? (
        <div
          className={previewRegion ? "region-box region-band-preview" : "region-box"}
          style={{
            left: `${(previewRegion ?? editorRegion)!.x * 100}%`,
            top: `${(previewRegion ?? editorRegion)!.y * 100}%`,
            width: `${(previewRegion ?? editorRegion)!.width * 100}%`,
            height: `${(previewRegion ?? editorRegion)!.height * 100}%`,
          }}
        />
      ) : null}
    </div>
  );
}
