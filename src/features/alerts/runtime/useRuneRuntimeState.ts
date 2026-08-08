import { useCallback, useEffect, useRef, useState } from "react";
import type { RuneRuntimeState, RuneSnapshot } from "../../../alertTypes";
import { createRuneRuntimeState } from "../../../lib/runeAlert";

export function useRuneRuntimeState() {
  const [runeRuntime, setRuneRuntime] = useState<RuneRuntimeState>(() => createRuneRuntimeState());
  const runeRuntimeRef = useRef(runeRuntime);
  const [runeSnapshot, setRuneSnapshot] = useState<RuneSnapshot | null>(null);
  const runeSnapshotRef = useRef<RuneSnapshot | null>(runeSnapshot);

  useEffect(() => {
    runeRuntimeRef.current = runeRuntime;
  }, [runeRuntime]);

  useEffect(() => {
    runeSnapshotRef.current = runeSnapshot;
  }, [runeSnapshot]);

  const resetRuneDetection = useCallback(() => {
    const nextState = createRuneRuntimeState();
    runeRuntimeRef.current = nextState;
    setRuneRuntime(nextState);
    runeSnapshotRef.current = null;
    setRuneSnapshot(null);
  }, []);

  return {
    runeRuntime,
    setRuneRuntime,
    runeRuntimeRef,
    runeSnapshot,
    setRuneSnapshot,
    runeSnapshotRef,
    resetRuneDetection,
  };
}
