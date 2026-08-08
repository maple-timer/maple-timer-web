import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_CROP_ZOOM,
  type CropTool,
  type PanState,
  clampCropZoom,
  getMovedPan,
  getWheelZoom,
} from "./cropSelectionUtils";

export function useCropPanZoom() {
  const panRef = useRef<PanState | null>(null);
  const [activeTool, setActiveTool] = useState<CropTool>("pan");
  const [zoom, setZoom] = useState(DEFAULT_CROP_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const setZoomClamped = useCallback((nextZoom: number) => {
    setZoom(clampCropZoom(nextZoom));
  }, []);

  const resetView = useCallback(() => {
    setZoom(DEFAULT_CROP_ZOOM);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setZoom((currentZoom) => getWheelZoom(currentZoom, event.deltaY));
  }, []);

  const beginPan = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (activeTool !== "pan") {
        return;
      }

      panRef.current = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [activeTool, pan.x, pan.y],
  );

  const updatePan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const current = panRef.current;
    if (!current) {
      return;
    }

    setPan(getMovedPan(current, event));
  }, []);

  const endPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return {
    activeTool,
    setActiveTool,
    zoom,
    pan,
    setZoomClamped,
    resetView,
    stageHandlers: {
      onWheel: handleWheel,
      onPointerDown: beginPan,
      onPointerMove: updatePan,
      onPointerUp: endPan,
      onPointerCancel: endPan,
    },
  };
}
