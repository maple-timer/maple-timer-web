import { type MutableRefObject, useCallback, useRef } from "react";
import { playAlert } from "../../../lib/alert";
import { trackAlertPlayed } from "../../../lib/analyticsEvents";
import { applyMasterVolume, STANDARD_ALERT_VOLUME } from "../../../lib/volume";
import type { Profile } from "../../../types";

export function useAlertPlaybackController({
  profileRef,
  setMessage,
}: {
  profileRef: MutableRefObject<Profile>;
  setMessage: (message: string) => void;
}) {
  const lastAlertErrorRef = useRef<string | null>(null);

  const previewSound = useCallback(
    (soundId: string, volume: number) => {
      void playAlert(soundId, applyMasterVolume(volume, profileRef.current.masterVolume)).catch(
        (error) => {
          const nextError =
            error instanceof Error ? error.message : "알람 미리듣기에 실패했습니다.";
          setMessage(nextError);
        },
      );
    },
    [profileRef, setMessage],
  );

  const previewMasterVolume = useCallback(
    () => {
      void playAlert(
        profileRef.current.alertDefaults.soundId,
        applyMasterVolume(STANDARD_ALERT_VOLUME, profileRef.current.masterVolume),
      ).catch((error) => {
        const nextError =
          error instanceof Error ? error.message : "마스터 볼륨 미리듣기에 실패했습니다.";
        setMessage(nextError);
      });
    },
    [profileRef, setMessage],
  );

  const playGeneralTimerAlert = useCallback(
    (soundId: string, volume: number) => {
      void playAlert(soundId, applyMasterVolume(volume, profileRef.current.masterVolume))
        .then(() => {
          trackAlertPlayed("general_timer", "timer");
        })
        .catch((error) => {
          const nextError =
            error instanceof Error ? error.message : "일반 타이머 알람 재생에 실패했습니다.";
          setMessage(nextError);
        });
    },
    [profileRef, setMessage],
  );

  return {
    lastAlertErrorRef,
    playGeneralTimerAlert,
    previewSound,
    previewMasterVolume,
  };
}
