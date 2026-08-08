import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AlertDisableSnapshot,
  clearAlertDisableSnapshot,
  loadAlertDisableSnapshot,
  saveAlertDisableSnapshot,
} from "../../../lib/alertDisableSnapshot";

export function useAlertDisableSnapshot() {
  const [alertDisableSnapshot, setAlertDisableSnapshot] =
    useState<AlertDisableSnapshot | null>(() => loadAlertDisableSnapshot());
  const alertDisableSnapshotRef = useRef(alertDisableSnapshot);

  useEffect(() => {
    alertDisableSnapshotRef.current = alertDisableSnapshot;
  }, [alertDisableSnapshot]);

  const activateAlertDisableSnapshot = useCallback((snapshot: AlertDisableSnapshot) => {
    saveAlertDisableSnapshot(snapshot);
    alertDisableSnapshotRef.current = snapshot;
    setAlertDisableSnapshot(snapshot);
  }, []);

  const clearAlertDisableSnapshotState = useCallback(() => {
    clearAlertDisableSnapshot();
    alertDisableSnapshotRef.current = null;
    setAlertDisableSnapshot(null);
  }, []);

  return {
    alertDisableSnapshot,
    alertDisableSnapshotRef,
    activateAlertDisableSnapshot,
    clearAlertDisableSnapshotState,
  };
}
