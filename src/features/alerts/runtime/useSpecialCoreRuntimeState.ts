import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSpecialCoreRuntimeState,
  retimeSpecialCoreRuntimeState,
  type SpecialCoreRuntimeState,
  type SpecialCoreSnapshot,
} from "../../../lib/specialCore";
import type { SpecialCoreAlertConfig } from "../../../types";
import {
  createSpecialCoreIncidentRuntimeRecorder,
  requestSpecialCoreIncidentRuntimeReset,
} from "../../../runtime/special-core/evidence/specialCoreIncidentRuntimeRecorder";
import type { SpecialCoreIncidentResetReason } from "../../../runtime/special-core/evidence/specialCoreIncidentEvidenceTypes";
import { terminateSpecialCoreWarmTraceForState } from "./specialCoreWarmTrace";

export function useSpecialCoreRuntimeState() {
  const [specialCoreRuntime, setSpecialCoreRuntime] =
    useState<SpecialCoreRuntimeState>(() => createSpecialCoreRuntimeState());
  const specialCoreRuntimeRef = useRef(specialCoreRuntime);
  const [specialCoreSnapshot, setSpecialCoreSnapshot] = useState<SpecialCoreSnapshot | null>(null);
  const specialCoreSnapshotRef = useRef<SpecialCoreSnapshot | null>(specialCoreSnapshot);
  const specialCoreIncidentRecorderRef = useRef(
    createSpecialCoreIncidentRuntimeRecorder(),
  );

  useEffect(() => {
    specialCoreRuntimeRef.current = specialCoreRuntime;
  }, [specialCoreRuntime]);

  useEffect(() => {
    specialCoreSnapshotRef.current = specialCoreSnapshot;
  }, [specialCoreSnapshot]);

  const resetSpecialCoreDetection = useCallback((
    reason: Exclude<SpecialCoreIncidentResetReason, "initialized"> = "profile-replaced",
  ) => {
    terminateSpecialCoreWarmTraceForState(
      specialCoreRuntimeRef.current,
      "replaced",
    );
    const next = createSpecialCoreRuntimeState();
    specialCoreRuntimeRef.current = next;
    specialCoreSnapshotRef.current = null;
    specialCoreIncidentRecorderRef.current = requestSpecialCoreIncidentRuntimeReset({
      previous: specialCoreIncidentRecorderRef.current,
      reason,
    });
    setSpecialCoreRuntime(next);
    setSpecialCoreSnapshot(null);
  }, []);

  const retimeSpecialCoreDetection = useCallback(
    (config: Pick<SpecialCoreAlertConfig, "cooldownSeconds" | "alertLeadSeconds">) => {
      setSpecialCoreRuntime((previous) => {
        terminateSpecialCoreWarmTraceForState(previous, "replaced");
        const next = retimeSpecialCoreRuntimeState({ state: previous, config });
        specialCoreRuntimeRef.current = next;
        return next;
      });
    },
    [],
  );

  return {
    specialCoreRuntime,
    setSpecialCoreRuntime,
    specialCoreRuntimeRef,
    specialCoreSnapshot,
    setSpecialCoreSnapshot,
    specialCoreSnapshotRef,
    specialCoreIncidentRecorderRef,
    resetSpecialCoreDetection,
    retimeSpecialCoreDetection,
  };
}
