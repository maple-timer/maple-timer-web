import { useCallback, useEffect, useRef, useState } from "react";
import {
  createUltimaRaidEquipmentRuntimeState,
  type UltimaRaidEquipmentRuntimeState,
} from "../../../runtime/ultima-raid-equipment/ultimaRaidEquipmentAlertState";
import {
  createUltimaRaidEquipmentIncidentArchive,
} from "../../../runtime/ultima-raid-equipment/evidence/ultimaRaidEquipmentIncidentEvidence";
import type { UltimaRaidEquipmentSnapshot } from "../../../runtime/ultima-raid-equipment/ultimaRaidEquipmentSnapshot";

export function useUltimaRaidEquipmentRuntimeState() {
  const [ultimaRaidEquipmentRuntime, setUltimaRaidEquipmentRuntime] =
    useState<UltimaRaidEquipmentRuntimeState>(() =>
      createUltimaRaidEquipmentRuntimeState(),
    );
  const ultimaRaidEquipmentRuntimeRef = useRef(ultimaRaidEquipmentRuntime);
  const [ultimaRaidEquipmentSnapshot, setUltimaRaidEquipmentSnapshot] =
    useState<UltimaRaidEquipmentSnapshot | null>(null);
  const ultimaRaidEquipmentSnapshotRef =
    useRef<UltimaRaidEquipmentSnapshot | null>(null);
  const ultimaRaidEquipmentIncidentArchiveRef = useRef(
    createUltimaRaidEquipmentIncidentArchive(),
  );

  useEffect(() => {
    ultimaRaidEquipmentRuntimeRef.current = ultimaRaidEquipmentRuntime;
  }, [ultimaRaidEquipmentRuntime]);

  useEffect(() => {
    ultimaRaidEquipmentSnapshotRef.current = ultimaRaidEquipmentSnapshot;
  }, [ultimaRaidEquipmentSnapshot]);

  const resetUltimaRaidEquipmentDetection = useCallback(() => {
    const nextState = createUltimaRaidEquipmentRuntimeState();
    ultimaRaidEquipmentRuntimeRef.current = nextState;
    setUltimaRaidEquipmentRuntime(nextState);
    ultimaRaidEquipmentSnapshotRef.current = null;
    setUltimaRaidEquipmentSnapshot(null);
    ultimaRaidEquipmentIncidentArchiveRef.current =
      createUltimaRaidEquipmentIncidentArchive();
  }, []);

  return {
    ultimaRaidEquipmentRuntime,
    setUltimaRaidEquipmentRuntime,
    ultimaRaidEquipmentRuntimeRef,
    ultimaRaidEquipmentSnapshot,
    setUltimaRaidEquipmentSnapshot,
    ultimaRaidEquipmentSnapshotRef,
    ultimaRaidEquipmentIncidentArchiveRef,
    resetUltimaRaidEquipmentDetection,
  };
}
