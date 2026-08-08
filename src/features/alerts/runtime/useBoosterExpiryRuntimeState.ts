import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BoosterExpiryRuntimeState,
  BoosterExpirySnapshot,
} from "../../../lib/boosterExpiry/boosterExpiryTypes";
import { createBoosterExpiryRuntimeState } from "../../../lib/boosterExpiry/boosterExpiryRuntime";
import {
  createBoosterExpiryIncidentRuntimeRecorder,
  requestBoosterExpiryIncidentRuntimeReset,
} from "../../../runtime/booster-expiry/evidence/boosterExpiryIncidentRuntimeRecorder";
import type { BoosterExpiryIncidentResetReason } from "../../../runtime/booster-expiry/evidence/boosterExpiryIncidentEvidenceTypes";

export function useBoosterExpiryRuntimeState() {
  const [boosterExpiryRuntime, setBoosterExpiryRuntime] =
    useState<BoosterExpiryRuntimeState>(() => createBoosterExpiryRuntimeState());
  const boosterExpiryRuntimeRef = useRef(boosterExpiryRuntime);
  const [boosterExpirySnapshot, setBoosterExpirySnapshot] =
    useState<BoosterExpirySnapshot | null>(null);
  const boosterExpirySnapshotRef = useRef<BoosterExpirySnapshot | null>(boosterExpirySnapshot);
  const boosterExpiryIncidentRecorderRef = useRef(
    createBoosterExpiryIncidentRuntimeRecorder(),
  );

  useEffect(() => {
    boosterExpiryRuntimeRef.current = boosterExpiryRuntime;
  }, [boosterExpiryRuntime]);

  useEffect(() => {
    boosterExpirySnapshotRef.current = boosterExpirySnapshot;
  }, [boosterExpirySnapshot]);

  const resetBoosterExpiryDetection = useCallback((
    reason: Exclude<BoosterExpiryIncidentResetReason, "initialized"> = "manual-reset",
  ) => {
    const next = createBoosterExpiryRuntimeState();
    boosterExpiryRuntimeRef.current = next;
    boosterExpirySnapshotRef.current = null;
    boosterExpiryIncidentRecorderRef.current =
      requestBoosterExpiryIncidentRuntimeReset({
        previous: boosterExpiryIncidentRecorderRef.current,
        reason,
      });
    setBoosterExpiryRuntime(next);
    setBoosterExpirySnapshot(null);
  }, []);

  return {
    boosterExpiryRuntime,
    setBoosterExpiryRuntime,
    boosterExpiryRuntimeRef,
    boosterExpirySnapshot,
    setBoosterExpirySnapshot,
    boosterExpirySnapshotRef,
    boosterExpiryIncidentRecorderRef,
    resetBoosterExpiryDetection,
  };
}
