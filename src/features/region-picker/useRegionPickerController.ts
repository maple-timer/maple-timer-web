import { useCallback, useMemo, useState } from "react";
import { trackCropSelectComplete, trackCropSelectStart } from "../../lib/analyticsEvents";
import { buildRegionPatchForLayout, getSkillRegionForLayout } from "../../lib/regions";
import { isGameViewportLayoutKey } from "../../lib/gameViewport";
import type {
  HuntStallAlertConfig,
  RelativeRegion,
  RuneAlertConfig,
  SkillConfig,
  UltimaRaidEquipmentAlertConfig,
} from "../../types";
import type { HuntStallIncidentResetReason } from "../../runtime/hunt-stall/evidence/huntStallIncidentEvidenceTypes";

type UseRegionPickerControllerParams = {
  isGameViewportReady: boolean;
  onRequireGameViewport: () => void;
  selectedSkill: SkillConfig | null;
  currentCaptureLayoutKey: string | null;
  currentGameLayoutKey: string | null;
  runeAlert: RuneAlertConfig;
  ultimaRaidEquipmentAlert: UltimaRaidEquipmentAlertConfig;
  huntStallAlert: HuntStallAlertConfig;
  selectSkillRegionTarget: (skillId: string) => void;
  changeSkill: (skillId: string, patch: Partial<SkillConfig>) => void;
  updateRuneAlert: (patch: Partial<RuneAlertConfig>) => void;
  updateUltimaRaidEquipmentAlert: (
    patch: Partial<UltimaRaidEquipmentAlertConfig>,
  ) => void;
  updateHuntStallAlert: (patch: Partial<HuntStallAlertConfig>) => void;
  resetRuneDetection: () => void;
  resetUltimaRaidEquipmentDetection: () => void;
  resetHuntStallDetection: (
    reason?: Exclude<HuntStallIncidentResetReason, "initialized">,
  ) => void;
};

type PendingGameViewportPicker =
  | { kind: "skill"; skillId: string }
  | { kind: "hunt-stall" };

export function useRegionPickerController({
  isGameViewportReady,
  onRequireGameViewport,
  selectedSkill,
  currentCaptureLayoutKey,
  currentGameLayoutKey,
  runeAlert,
  ultimaRaidEquipmentAlert,
  huntStallAlert,
  selectSkillRegionTarget,
  changeSkill,
  updateRuneAlert,
  updateUltimaRaidEquipmentAlert,
  updateHuntStallAlert,
  resetRuneDetection,
  resetUltimaRaidEquipmentDetection,
  resetHuntStallDetection,
}: UseRegionPickerControllerParams) {
  const [isSkillRegionPickerOpen, setSkillRegionPickerOpen] = useState(false);
  const [isRuneRegionPickerOpen, setRuneRegionPickerOpen] = useState(false);
  const [
    isUltimaRaidEquipmentRegionPickerOpen,
    setUltimaRaidEquipmentRegionPickerOpen,
  ] = useState(false);
  const [isHuntStallRegionPickerOpen, setHuntStallRegionPickerOpen] = useState(false);
  const [pendingGameViewportPicker, setPendingGameViewportPicker] =
    useState<PendingGameViewportPicker | null>(null);

  const selectedSkillRegion = useMemo(
    () =>
      selectedSkill
        ? getSkillRegionForLayout(selectedSkill, currentGameLayoutKey)
        : null,
    [currentGameLayoutKey, selectedSkill],
  );
  const runeRegion = useMemo(
    () => getSkillRegionForLayout(runeAlert, currentCaptureLayoutKey),
    [currentCaptureLayoutKey, runeAlert],
  );
  const ultimaRaidEquipmentRegion = useMemo(
    () =>
      getSkillRegionForLayout(
        ultimaRaidEquipmentAlert,
        currentCaptureLayoutKey,
      ),
    [currentCaptureLayoutKey, ultimaRaidEquipmentAlert],
  );
  const huntStallCooldownRegion = useMemo(
    () =>
      getSkillRegionForLayout(
        {
          region: huntStallAlert.cooldownRegion,
          regionsByLayout: huntStallAlert.cooldownRegionsByLayout,
        },
        currentGameLayoutKey,
      ),
    [currentGameLayoutKey, huntStallAlert],
  );
  const huntStallManualExperienceRegion = useMemo(
    () =>
      getSkillRegionForLayout(
        {
          region: huntStallAlert.manualExperienceRegion ?? null,
          regionsByLayout: huntStallAlert.manualExperienceRegionsByLayout,
        },
        currentGameLayoutKey,
      ),
    [currentGameLayoutKey, huntStallAlert],
  );
  const huntStallRegion =
    huntStallAlert.mode === "manual-experience"
      ? huntStallManualExperienceRegion
      : huntStallCooldownRegion;

  const openSkillRegionPicker = useCallback(
    (skillId: string) => {
      selectSkillRegionTarget(skillId);
      if (!isGameViewportReady) {
        setPendingGameViewportPicker({ kind: "skill", skillId });
        onRequireGameViewport();
        return;
      }

      trackCropSelectStart("skill");
      setSkillRegionPickerOpen(true);
    },
    [
      isGameViewportReady,
      onRequireGameViewport,
      selectSkillRegionTarget,
    ],
  );

  const closeSkillRegionPicker = useCallback(() => {
    setSkillRegionPickerOpen(false);
  }, []);

  const openRuneRegionPicker = useCallback(() => {
    trackCropSelectStart("rune");
    setRuneRegionPickerOpen(true);
  }, []);

  const closeRuneRegionPicker = useCallback(() => {
    setRuneRegionPickerOpen(false);
  }, []);

  const openUltimaRaidEquipmentRegionPicker = useCallback(() => {
    trackCropSelectStart("ultima_raid_equipment");
    setUltimaRaidEquipmentRegionPickerOpen(true);
  }, []);

  const closeUltimaRaidEquipmentRegionPicker = useCallback(() => {
    setUltimaRaidEquipmentRegionPickerOpen(false);
  }, []);

  const openHuntStallRegionPicker = useCallback(() => {
    if (!isGameViewportReady) {
      setPendingGameViewportPicker({ kind: "hunt-stall" });
      onRequireGameViewport();
      return;
    }

    trackCropSelectStart("hunt_stall");
    setHuntStallRegionPickerOpen(true);
  }, [isGameViewportReady, onRequireGameViewport]);

  const closeHuntStallRegionPicker = useCallback(() => {
    setHuntStallRegionPickerOpen(false);
  }, []);

  const closeRegionPickers = useCallback(() => {
    setSkillRegionPickerOpen(false);
    setRuneRegionPickerOpen(false);
    setUltimaRaidEquipmentRegionPickerOpen(false);
    setHuntStallRegionPickerOpen(false);
    setPendingGameViewportPicker(null);
  }, []);

  const resumePendingGameViewportPicker = useCallback(() => {
    if (!pendingGameViewportPicker) {
      return;
    }

    if (pendingGameViewportPicker.kind === "skill") {
      selectSkillRegionTarget(pendingGameViewportPicker.skillId);
      trackCropSelectStart("skill");
      setSkillRegionPickerOpen(true);
    } else {
      trackCropSelectStart("hunt_stall");
      setHuntStallRegionPickerOpen(true);
    }
    setPendingGameViewportPicker(null);
  }, [pendingGameViewportPicker, selectSkillRegionTarget]);

  const cancelPendingGameViewportPicker = useCallback(() => {
    setPendingGameViewportPicker(null);
  }, []);

  const requestGameViewportForHuntStallPicker = useCallback(() => {
    setHuntStallRegionPickerOpen(false);
    setPendingGameViewportPicker({ kind: "hunt-stall" });
    onRequireGameViewport();
  }, [onRequireGameViewport]);

  const applySkillRegion = useCallback(
    (region: RelativeRegion) => {
      if (!selectedSkill) {
        return;
      }

      changeSkill(
        selectedSkill.id,
        buildRegionPatchForLayout(
          selectedSkill,
          currentGameLayoutKey,
          region,
          {
            preserveFallbackRegion:
              isGameViewportLayoutKey(currentGameLayoutKey),
          },
        ),
      );
      trackCropSelectComplete("skill");
      setSkillRegionPickerOpen(false);
    },
    [changeSkill, currentGameLayoutKey, selectedSkill],
  );

  const applyRuneRegion = useCallback(
    (region: RelativeRegion) => {
      updateRuneAlert(
        buildRegionPatchForLayout(
          runeAlert,
          currentCaptureLayoutKey,
          region,
        ),
      );
      resetRuneDetection();
      trackCropSelectComplete("rune");
      setRuneRegionPickerOpen(false);
    },
    [
      currentCaptureLayoutKey,
      resetRuneDetection,
      runeAlert,
      updateRuneAlert,
    ],
  );

  const applyUltimaRaidEquipmentRegion = useCallback(
    (region: RelativeRegion) => {
      updateUltimaRaidEquipmentAlert(
        buildRegionPatchForLayout(
          ultimaRaidEquipmentAlert,
          currentCaptureLayoutKey,
          region,
        ),
      );
      resetUltimaRaidEquipmentDetection();
      trackCropSelectComplete("ultima_raid_equipment");
      setUltimaRaidEquipmentRegionPickerOpen(false);
    },
    [
      currentCaptureLayoutKey,
      resetUltimaRaidEquipmentDetection,
      ultimaRaidEquipmentAlert,
      updateUltimaRaidEquipmentAlert,
    ],
  );

  const applyHuntStallRegion = useCallback(
    (region: RelativeRegion) => {
      if (huntStallAlert.mode === "manual-experience") {
        const patch = buildRegionPatchForLayout(
          {
            region: huntStallAlert.manualExperienceRegion ?? null,
            regionsByLayout: huntStallAlert.manualExperienceRegionsByLayout,
          },
          currentGameLayoutKey,
          region,
          {
            preserveFallbackRegion:
              isGameViewportLayoutKey(currentGameLayoutKey),
          },
        );
        updateHuntStallAlert({
          manualExperienceRegion: patch.region,
          manualExperienceRegionsByLayout: patch.regionsByLayout,
        });
      } else {
        const patch = buildRegionPatchForLayout(
          {
            region: huntStallAlert.cooldownRegion,
            regionsByLayout: huntStallAlert.cooldownRegionsByLayout,
          },
          currentGameLayoutKey,
          region,
          {
            preserveFallbackRegion:
              isGameViewportLayoutKey(currentGameLayoutKey),
          },
        );
        updateHuntStallAlert({
          cooldownRegion: patch.region,
          cooldownRegionsByLayout: patch.regionsByLayout,
        });
      }
      resetHuntStallDetection("region-changed");
      trackCropSelectComplete("hunt_stall");
      setHuntStallRegionPickerOpen(false);
    },
    [
      currentGameLayoutKey,
      huntStallAlert,
      resetHuntStallDetection,
      updateHuntStallAlert,
    ],
  );

  return {
    isSkillRegionPickerOpen,
    selectedSkillRegion,
    isRuneRegionPickerOpen,
    runeRegion,
    isUltimaRaidEquipmentRegionPickerOpen,
    ultimaRaidEquipmentRegion,
    isHuntStallRegionPickerOpen,
    huntStallRegion,
    openSkillRegionPicker,
    closeSkillRegionPicker,
    openRuneRegionPicker,
    closeRuneRegionPicker,
    openUltimaRaidEquipmentRegionPicker,
    closeUltimaRaidEquipmentRegionPicker,
    openHuntStallRegionPicker,
    closeHuntStallRegionPicker,
    closeRegionPickers,
    resumePendingGameViewportPicker,
    cancelPendingGameViewportPicker,
    requestGameViewportForHuntStallPicker,
    applySkillRegion,
    applyRuneRegion,
    applyUltimaRaidEquipmentRegion,
    applyHuntStallRegion,
  };
}
