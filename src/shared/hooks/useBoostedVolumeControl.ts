import { useEffect, useState } from "react";
import {
  acknowledgeVolumeBoostWarning,
  clampAlertVolume,
  shouldWarnForBoostedVolume,
} from "../../lib/volume";

export function useBoostedVolumeControl({
  volume,
  warningKey,
  onCommit,
}: {
  volume: number;
  warningKey: string;
  onCommit: (volume: number) => void;
}) {
  const [draftVolume, setDraftVolume] = useState(() => clampAlertVolume(volume));
  const [pendingBoostedVolume, setPendingBoostedVolume] = useState<number | null>(null);

  useEffect(() => {
    setDraftVolume(clampAlertVolume(volume));
  }, [volume]);

  const changeDraftVolume = (nextVolume: number) => {
    const clampedVolume = clampAlertVolume(nextVolume);
    setDraftVolume(clampedVolume);
    if (!shouldWarnForBoostedVolume(clampedVolume, warningKey)) {
      onCommit(clampedVolume);
    }
  };

  const finalizeDraftVolume = () => {
    if (pendingBoostedVolume !== null) {
      return;
    }
    if (shouldWarnForBoostedVolume(draftVolume, warningKey)) {
      setPendingBoostedVolume(draftVolume);
      return;
    }
    onCommit(draftVolume);
  };

  const cancelBoostedVolume = () => {
    setPendingBoostedVolume(null);
    setDraftVolume(clampAlertVolume(volume));
  };

  const confirmBoostedVolume = () => {
    if (pendingBoostedVolume === null) {
      return;
    }
    acknowledgeVolumeBoostWarning(warningKey);
    onCommit(pendingBoostedVolume);
    setDraftVolume(pendingBoostedVolume);
    setPendingBoostedVolume(null);
  };

  return {
    draftVolume,
    pendingBoostedVolume,
    changeDraftVolume,
    finalizeDraftVolume,
    cancelBoostedVolume,
    confirmBoostedVolume,
  };
}
