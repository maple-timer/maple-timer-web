import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GameViewportCalibrationState,
  GameViewportVerificationStatus,
  PixelSize,
  ResolvedGameViewport,
} from "../../contracts/geometry/frameSource";
import type { RelativeRegion } from "../../types";
import {
  createGameViewportCalibration,
  isSamePixelSize,
  resolveGameViewport,
} from "../../lib/gameViewport";
import { shouldRecommendGameViewportSetup } from "./gameViewportSetupRecommendation";

const INITIAL_STATE: GameViewportCalibrationState = {
  status: "legacy-passthrough",
  revision: 0,
};

export function useGameViewportCalibrationController({
  captureSize,
  onCalibrationApplied,
  stream,
}: {
  captureSize: PixelSize | null;
  onCalibrationApplied?: (viewport: ResolvedGameViewport) => void;
  stream: MediaStream | null;
}) {
  const [state, setState] = useState<GameViewportCalibrationState>(INITIAL_STATE);
  const [isSetupOpen, setSetupOpen] = useState(false);
  const [isFullCaptureConfirmed, setFullCaptureConfirmed] = useState(false);
  const streamRef = useRef<MediaStream | null>(stream);
  const captureSizeRef = useRef<PixelSize | null>(captureSize);
  const revisionRef = useRef(0);

  useEffect(() => {
    if (streamRef.current === stream) {
      return;
    }

    streamRef.current = stream;
    captureSizeRef.current = captureSize;
    revisionRef.current += 1;
    setState({
      status: "legacy-passthrough",
      revision: revisionRef.current,
    });
    setFullCaptureConfirmed(false);
    setSetupOpen(false);
  }, [captureSize, stream]);

  useEffect(() => {
    const previousCaptureSize = captureSizeRef.current;
    captureSizeRef.current = captureSize;
    if (
      !previousCaptureSize ||
      !captureSize ||
      isSamePixelSize(previousCaptureSize, captureSize)
    ) {
      return;
    }

    setFullCaptureConfirmed(false);
    setState((current) => {
      revisionRef.current += 1;
      if (current.status === "legacy-passthrough") {
        return {
          status: "legacy-passthrough",
          revision: revisionRef.current,
        };
      }

      return {
        status: "stale",
        calibration: {
          ...current.calibration,
          revision: revisionRef.current,
        },
        captureSize,
      };
    });
  }, [captureSize]);

  const openSetup = useCallback(() => {
    if (!stream || !captureSize) {
      return;
    }
    setSetupOpen(true);
  }, [captureSize, stream]);

  const closeSetup = useCallback(() => {
    setSetupOpen(false);
  }, []);

  const applyCalibration = useCallback(
    ({
      gameResolution,
      region,
    }: {
      gameResolution: PixelSize;
      region: RelativeRegion;
    }) => {
      if (!captureSize) {
        return;
      }

      revisionRef.current += 1;
      const nextState: GameViewportCalibrationState = {
        status: "calibrated",
        calibration: createGameViewportCalibration({
          captureSize,
          gameResolution,
          region,
          revision: revisionRef.current,
        }),
      };
      setState(nextState);
      setFullCaptureConfirmed(false);
      const viewport = resolveGameViewport(nextState, captureSize);
      if (viewport) {
        onCalibrationApplied?.(viewport);
      }
      setSetupOpen(false);
    },
    [captureSize, onCalibrationApplied],
  );

  const useLegacyPassthrough = useCallback(() => {
    if (
      isFullCaptureConfirmed &&
      state.status === "legacy-passthrough"
    ) {
      setSetupOpen(false);
      return;
    }

    revisionRef.current += 1;
    setFullCaptureConfirmed(true);
    setState({
      status: "legacy-passthrough",
      revision: revisionRef.current,
    });
    setSetupOpen(false);
  }, [isFullCaptureConfirmed, state.status]);

  const candidateViewport = useMemo(
    () => resolveGameViewport(state, captureSize),
    [captureSize, state],
  );
  const isSetupRecommended = useMemo(
    () =>
      state.status === "legacy-passthrough" &&
      !isFullCaptureConfirmed &&
      shouldRecommendGameViewportSetup({ captureSize, stream }),
    [captureSize, isFullCaptureConfirmed, state.status, stream],
  );
  const verificationStatus = useMemo<GameViewportVerificationStatus>(() => {
    if (!stream || !captureSize) {
      return "unavailable";
    }
    if (state.status === "stale") {
      return "stale";
    }
    if (state.status === "calibrated") {
      return "calibrated";
    }
    if (isSetupRecommended) {
      return "unverified";
    }
    return isFullCaptureConfirmed ? "user-confirmed" : "known-capture";
  }, [
    captureSize,
    isFullCaptureConfirmed,
    isSetupRecommended,
    state.status,
    stream,
  ]);
  const resolvedViewport =
    verificationStatus === "unverified" ||
    verificationStatus === "unavailable" ||
    verificationStatus === "stale"
      ? null
      : candidateViewport;

  return {
    state,
    resolvedViewport,
    verificationStatus,
    isSetupRecommended,
    isSetupOpen,
    openSetup,
    closeSetup,
    applyCalibration,
    useLegacyPassthrough,
  };
}
