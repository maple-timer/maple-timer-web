import { useCallback, useEffect, useRef, useState } from "react";
import type { BuffExpiryRuntimeState, BuffExpirySnapshot } from "../../../lib/buffExpiry/buffExpiryTypes";
import { createBuffExpiryRuntimeState } from "../../../lib/buffExpiry/buffExpiryRuntimeState";
import {
  createBuffExpiryIncidentRuntimeRecorder,
  resetBuffExpiryIncidentRuntimeRecorder,
} from "../../../runtime/buff-expiry/evidence/buffExpiryIncidentRuntimeRecorder";

export function useBuffExpiryRuntimeState() {
  const [buffExpiryRuntime, setBuffExpiryRuntime] = useState<BuffExpiryRuntimeState>(() =>
    createBuffExpiryRuntimeState(),
  );
  const buffExpiryRuntimeRef = useRef(buffExpiryRuntime);
  const [buffExpirySnapshot, setBuffExpirySnapshot] = useState<BuffExpirySnapshot | null>(null);
  const buffExpirySnapshotRef = useRef<BuffExpirySnapshot | null>(buffExpirySnapshot);
  const buffExpiryIncidentRecorderRef = useRef(
    createBuffExpiryIncidentRuntimeRecorder(),
  );

  useEffect(() => {
    buffExpiryRuntimeRef.current = buffExpiryRuntime;
  }, [buffExpiryRuntime]);

  useEffect(() => {
    buffExpirySnapshotRef.current = buffExpirySnapshot;
  }, [buffExpirySnapshot]);

  const resetBuffExpiryDetection = useCallback(() => {
    buffExpiryIncidentRecorderRef.current = resetBuffExpiryIncidentRuntimeRecorder({
      previous: buffExpiryIncidentRecorderRef.current,
      reason: "feature-reset",
    });
    const nextState = createBuffExpiryRuntimeState();
    buffExpiryRuntimeRef.current = nextState;
    setBuffExpiryRuntime(nextState);
    buffExpirySnapshotRef.current = null;
    setBuffExpirySnapshot(null);
  }, []);

  return {
    buffExpiryRuntime,
    setBuffExpiryRuntime,
    buffExpiryRuntimeRef,
    buffExpirySnapshot,
    setBuffExpirySnapshot,
    buffExpirySnapshotRef,
    buffExpiryIncidentRecorderRef,
    resetBuffExpiryDetection,
  };
}
