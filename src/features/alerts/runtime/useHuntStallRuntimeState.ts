import { useCallback, useEffect, useRef, useState } from "react";
import type { HuntStallRuntimeState, HuntStallSnapshot } from "../../../alertTypes";
import { createHuntStallRuntimeState } from "../../../lib/huntStall";
import {
  createHuntStallIncidentRuntimeRecorder,
  requestHuntStallIncidentRuntimeReset,
} from "../../../runtime/hunt-stall/evidence/huntStallIncidentRuntimeRecorder";
import type { HuntStallIncidentResetReason } from "../../../runtime/hunt-stall/evidence/huntStallIncidentEvidenceTypes";

export function useHuntStallRuntimeState() {
  const [huntStallRuntime, setHuntStallRuntime] = useState<HuntStallRuntimeState>(() =>
    createHuntStallRuntimeState(),
  );
  const huntStallRuntimeRef = useRef(huntStallRuntime);
  const [huntStallSnapshot, setHuntStallSnapshot] = useState<HuntStallSnapshot | null>(null);
  const huntStallSnapshotRef = useRef<HuntStallSnapshot | null>(huntStallSnapshot);
  const huntStallIncidentRecorderRef = useRef(
    createHuntStallIncidentRuntimeRecorder(),
  );

  useEffect(() => {
    huntStallRuntimeRef.current = huntStallRuntime;
  }, [huntStallRuntime]);

  useEffect(() => {
    huntStallSnapshotRef.current = huntStallSnapshot;
  }, [huntStallSnapshot]);

  const resetHuntStallDetection = useCallback((
    reason: Exclude<HuntStallIncidentResetReason, "initialized"> = "profile-replaced",
  ) => {
    const nextState = createHuntStallRuntimeState();
    huntStallRuntimeRef.current = nextState;
    setHuntStallRuntime(nextState);
    huntStallSnapshotRef.current = null;
    setHuntStallSnapshot(null);
    huntStallIncidentRecorderRef.current = requestHuntStallIncidentRuntimeReset({
      previous: huntStallIncidentRecorderRef.current,
      reason,
    });
  }, []);

  return {
    huntStallRuntime,
    setHuntStallRuntime,
    huntStallRuntimeRef,
    huntStallSnapshot,
    setHuntStallSnapshot,
    huntStallSnapshotRef,
    huntStallIncidentRecorderRef,
    resetHuntStallDetection,
  };
}
