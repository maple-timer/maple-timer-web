import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  createBuffExpiryPrecisionEngine,
  type BuffExpiryPrecisionPreloadStatus,
} from "../../../platform/runtime-workers/buff-expiry/buffExpiryPrecisionWorkerClient";
import type { BuffExpiryPrecisionTargetGroup } from "../../../lib/buffExpiryPrecision/buffExpiryPrecisionTypes";

type BuffExpiryPrecisionEngine = ReturnType<typeof createBuffExpiryPrecisionEngine>;

export function useBuffExpiryPrecisionEnginePreload({
  active,
  activeGroups,
  precisionEngineRef,
  setBuffExpiryPrecisionPreloadStatus,
}: {
  active: boolean;
  activeGroups: BuffExpiryPrecisionTargetGroup[];
  precisionEngineRef: MutableRefObject<BuffExpiryPrecisionEngine>;
  setBuffExpiryPrecisionPreloadStatus: Dispatch<SetStateAction<BuffExpiryPrecisionPreloadStatus>>;
}) {
  const precisionEnginePreloadGenerationRef = useRef(0);
  const precisionEnginePreloadRequestedRef = useRef(false);
  const precisionEnginePreloadStatusRef = useRef<BuffExpiryPrecisionPreloadStatus>("idle");
  const precisionEnginePreloadConfigKeyRef = useRef<string | null>(null);
  const activeGroupsRef = useRef(activeGroups);
  activeGroupsRef.current = activeGroups;
  const activeGroupsKey = activeGroups.join("|");

  const updatePrecisionEnginePreloadStatus = useCallback(
    (nextStatus: BuffExpiryPrecisionPreloadStatus) => {
      precisionEnginePreloadStatusRef.current = nextStatus;
      setBuffExpiryPrecisionPreloadStatus(nextStatus);
    },
    [setBuffExpiryPrecisionPreloadStatus],
  );

  const resetPrecisionEnginePreload = useCallback(() => {
    precisionEnginePreloadRequestedRef.current = false;
    precisionEnginePreloadGenerationRef.current += 1;
    updatePrecisionEnginePreloadStatus("idle");
  }, [updatePrecisionEnginePreloadStatus]);

  const updatePrecisionEnginePreloadStatusFromSample = useCallback(
    (nextStatus: BuffExpiryPrecisionPreloadStatus) => {
      if (nextStatus === "ready" || nextStatus === "error") {
        updatePrecisionEnginePreloadStatus(nextStatus);
        return;
      }
      if (precisionEnginePreloadStatusRef.current !== "ready") {
        updatePrecisionEnginePreloadStatus(nextStatus);
      }
    },
    [updatePrecisionEnginePreloadStatus],
  );

  useEffect(() => {
    if (!active) {
      precisionEnginePreloadConfigKeyRef.current = null;
      resetPrecisionEnginePreload();
      return;
    }

    if (precisionEnginePreloadConfigKeyRef.current !== activeGroupsKey) {
      precisionEnginePreloadRequestedRef.current = false;
      precisionEnginePreloadGenerationRef.current += 1;
      precisionEnginePreloadConfigKeyRef.current = activeGroupsKey;
    }

    if (precisionEnginePreloadRequestedRef.current) {
      return;
    }
    precisionEnginePreloadRequestedRef.current = true;
    precisionEnginePreloadGenerationRef.current += 1;
    const preloadGeneration = precisionEnginePreloadGenerationRef.current;
    updatePrecisionEnginePreloadStatus("loading");
    void precisionEngineRef.current.preload(activeGroupsRef.current).then(
      (response) => {
        if (precisionEnginePreloadGenerationRef.current !== preloadGeneration) {
          return;
        }
        if (
          !response ||
          (response.countdownModelStatus === "ready" && response.matcherModelStatus === "ready")
        ) {
          updatePrecisionEnginePreloadStatus("ready");
          return;
        }
        if (
          response.countdownModelStatus === "error" ||
          response.matcherModelStatus === "error"
        ) {
          precisionEnginePreloadRequestedRef.current = false;
          updatePrecisionEnginePreloadStatus("error");
          return;
        }
        updatePrecisionEnginePreloadStatus("loading");
      },
      () => {
        if (precisionEnginePreloadGenerationRef.current !== preloadGeneration) {
          return;
        }
        precisionEnginePreloadRequestedRef.current = false;
        updatePrecisionEnginePreloadStatus("error");
      },
    );
  }, [
    active,
    activeGroupsKey,
    precisionEngineRef,
    resetPrecisionEnginePreload,
    updatePrecisionEnginePreloadStatus,
  ]);

  return {
    precisionEnginePreloadStatusRef,
    resetPrecisionEnginePreload,
    updatePrecisionEnginePreloadStatusFromSample,
  };
}
