import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import type { AlertSound } from "../../lib/sounds";

type SoundPickerCustomSoundsContextValue = {
  customSounds: AlertSound[];
  onManageCustomSounds: () => void;
};

const SoundPickerCustomSoundsContext =
  createContext<SoundPickerCustomSoundsContextValue>({
    customSounds: [],
    onManageCustomSounds: () => undefined,
  });

export function SoundPickerCustomSoundsProvider({
  customSounds,
  onManageCustomSounds,
  children,
}: SoundPickerCustomSoundsContextValue & { children: ReactNode }) {
  const value = useMemo(
    () => ({ customSounds, onManageCustomSounds }),
    [customSounds, onManageCustomSounds],
  );

  return (
    <SoundPickerCustomSoundsContext.Provider value={value}>
      {children}
    </SoundPickerCustomSoundsContext.Provider>
  );
}

export function useSoundPickerCustomSounds(): SoundPickerCustomSoundsContextValue {
  return useContext(SoundPickerCustomSoundsContext);
}
