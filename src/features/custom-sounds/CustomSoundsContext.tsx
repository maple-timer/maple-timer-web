import { type ReactNode, useMemo } from "react";
import { SoundPickerCustomSoundsProvider } from "../../shared/components/SoundPickerCustomSoundsContext";
import {
  customSoundMetadataToAlertSound,
  type CustomAlertSoundMetadata,
} from "../../lib/customSounds";

export function CustomSoundsProvider({
  customSounds,
  openCustomSoundManager,
  children,
}: {
  customSounds: CustomAlertSoundMetadata[];
  openCustomSoundManager: () => void;
  children: ReactNode;
}) {
  const customAlertSounds = useMemo(
    () => customSounds.map(customSoundMetadataToAlertSound),
    [customSounds],
  );

  return (
    <SoundPickerCustomSoundsProvider
      customSounds={customAlertSounds}
      onManageCustomSounds={openCustomSoundManager}
    >
      {children}
    </SoundPickerCustomSoundsProvider>
  );
}
