import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useRef,
  useState,
} from "react";

export const MIN_GAME_VIEWPORT_EDITOR_ZOOM = 1;
export const MAX_GAME_VIEWPORT_EDITOR_ZOOM = 4;
export const GAME_VIEWPORT_EDITOR_ZOOM_INCREMENT = 0.25;

type Point = {
  x: number;
  y: number;
};

type ViewportSize = {
  width: number;
  height: number;
};

export type GameViewportEditorView = {
  zoom: number;
  pan: Point;
};

type PanDragState = {
  pointerX: number;
  pointerY: number;
  panX: number;
  panY: number;
};

const INITIAL_VIEW: GameViewportEditorView = {
  zoom: MIN_GAME_VIEWPORT_EDITOR_ZOOM,
  pan: { x: 0, y: 0 },
};

export function clampGameViewportEditorZoom(zoom: number): number {
  return Math.min(
    MAX_GAME_VIEWPORT_EDITOR_ZOOM,
    Math.max(MIN_GAME_VIEWPORT_EDITOR_ZOOM, zoom),
  );
}

export function clampGameViewportEditorPan(
  pan: Point,
  zoom: number,
  viewportSize: ViewportSize,
): Point {
  const clampedZoom = clampGameViewportEditorZoom(zoom);
  const maxX = Math.max(0, (viewportSize.width * (clampedZoom - 1)) / 2);
  const maxY = Math.max(0, (viewportSize.height * (clampedZoom - 1)) / 2);

  return {
    x: maxX === 0 ? 0 : Math.min(maxX, Math.max(-maxX, pan.x)),
    y: maxY === 0 ? 0 : Math.min(maxY, Math.max(-maxY, pan.y)),
  };
}

export function zoomGameViewportEditorAtPoint(
  view: GameViewportEditorView,
  nextZoom: number,
  viewportSize: ViewportSize,
  focalPoint: Point = {
    x: viewportSize.width / 2,
    y: viewportSize.height / 2,
  },
): GameViewportEditorView {
  const zoom = clampGameViewportEditorZoom(nextZoom);
  if (zoom === view.zoom) {
    return view;
  }

  const scale = zoom / view.zoom;
  const focalFromCenter = {
    x: focalPoint.x - viewportSize.width / 2,
    y: focalPoint.y - viewportSize.height / 2,
  };
  const pan = clampGameViewportEditorPan(
    {
      x: focalFromCenter.x - scale * (focalFromCenter.x - view.pan.x),
      y: focalFromCenter.y - scale * (focalFromCenter.y - view.pan.y),
    },
    zoom,
    viewportSize,
  );

  return { zoom, pan };
}

export function useGameViewportEditorView() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const panDragRef = useRef<PanDragState | null>(null);
  const [view, setView] = useState<GameViewportEditorView>(INITIAL_VIEW);
  const [isPanning, setIsPanning] = useState(false);

  const getViewportSize = useCallback((): ViewportSize => {
    const rect = stageRef.current?.getBoundingClientRect();
    return {
      width: Math.max(1, rect?.width ?? 1),
      height: Math.max(1, rect?.height ?? 1),
    };
  }, []);

  const setZoom = useCallback(
    (nextZoom: number) => {
      const viewportSize = getViewportSize();
      setView((current) =>
        zoomGameViewportEditorAtPoint(current, nextZoom, viewportSize),
      );
    },
    [getViewportSize],
  );

  const resetView = useCallback(() => {
    panDragRef.current = null;
    setIsPanning(false);
    setView(INITIAL_VIEW);
  }, []);

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (event.deltaY === 0) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const viewportSize = {
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      };
      const focalPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      setView((current) => {
        const nextZoom =
          event.deltaY < 0 ? current.zoom * 1.15 : current.zoom / 1.15;
        return zoomGameViewportEditorAtPoint(
          current,
          nextZoom,
          viewportSize,
          focalPoint,
        );
      });
    },
    [],
  );

  const beginPan = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button > 0 || view.zoom <= MIN_GAME_VIEWPORT_EDITOR_ZOOM) {
        return;
      }

      panDragRef.current = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        panX: view.pan.x,
        panY: view.pan.y,
      };
      setIsPanning(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [view.pan.x, view.pan.y, view.zoom],
  );

  const updatePan = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = panDragRef.current;
      if (!drag) {
        return;
      }

      const viewportSize = getViewportSize();
      setView((current) => ({
        ...current,
        pan: clampGameViewportEditorPan(
          {
            x: drag.panX + event.clientX - drag.pointerX,
            y: drag.panY + event.clientY - drag.pointerY,
          },
          current.zoom,
          viewportSize,
        ),
      }));
    },
    [getViewportSize],
  );

  const endPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    panDragRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return {
    stageRef,
    view,
    isPanning,
    setZoom,
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
