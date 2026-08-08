import { useCallback, useEffect, useState } from "react";
import {
  loadCustomAlertSoundMetadata,
  type CustomAlertSoundMetadata,
} from "../../lib/customSounds";

export function useCustomSoundLibrary({ onMessage }: { onMessage: (message: string) => void }) {
  const [customSounds, setCustomSounds] = useState<CustomAlertSoundMetadata[]>([]);

  const refreshCustomSounds = useCallback(async (silent = false) => {
    try {
      setCustomSounds(await loadCustomAlertSoundMetadata());
    } catch (error) {
      setCustomSounds([]);
      if (!silent) {
        onMessage(error instanceof Error ? error.message : "사용자 알림음을 불러오지 못했습니다.");
      }
    }
  }, [onMessage]);

  useEffect(() => {
    void refreshCustomSounds(true);
  }, [refreshCustomSounds]);

  return {
    customSounds,
    refreshCustomSounds,
  };
}
