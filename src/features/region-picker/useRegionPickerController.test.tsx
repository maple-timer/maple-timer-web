import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trackCropSelectComplete, trackCropSelectStart } from "../../lib/analyticsEvents";
import {
  createDefaultHuntStallAlert,
  createDefaultRuneAlert,
  createDefaultUltimaRaidEquipmentAlert,
  createSkill,
} from "../../lib/storage";
import type {
  HuntStallAlertConfig,
  RelativeRegion,
  RuneAlertConfig,
  SkillConfig,
  UltimaRaidEquipmentAlertConfig,
} from "../../types";
import { useRegionPickerController } from "./useRegionPickerController";

vi.mock("../../lib/analyticsEvents", () => ({
  trackCropSelectComplete: vi.fn(),
  trackCropSelectStart: vi.fn(),
}));

type HookApi = ReturnType<typeof useRegionPickerController>;

const trackCropSelectCompleteMock = vi.mocked(trackCropSelectComplete);
const trackCropSelectStartMock = vi.mocked(trackCropSelectStart);

const REGION: RelativeRegion = {
  x: 0.25,
  y: 0.5,
  width: 0.25,
  height: 0.125,
};

function getHookApi(apiRef: { current: HookApi | null }): HookApi {
  if (!apiRef.current) {
    throw new Error("hook api is not ready");
  }
  return apiRef.current;
}

function Harness({
  isGameViewportReady = true,
  onRequireGameViewport = vi.fn(),
  selectedSkill,
  currentLayoutKey = "1920x1080",
  currentCaptureLayoutKey = currentLayoutKey,
  currentGameLayoutKey = currentLayoutKey,
  runeAlert = createDefaultRuneAlert(),
  ultimaRaidEquipmentAlert = createDefaultUltimaRaidEquipmentAlert(),
  huntStallAlert = createDefaultHuntStallAlert(),
  selectSkillRegionTarget = vi.fn(),
  changeSkill = vi.fn(),
  updateRuneAlert = vi.fn(),
  updateUltimaRaidEquipmentAlert = vi.fn(),
  updateHuntStallAlert = vi.fn(),
  resetRuneDetection = vi.fn(),
  resetUltimaRaidEquipmentDetection = vi.fn(),
  resetHuntStallDetection = vi.fn(),
  onReady,
}: {
  isGameViewportReady?: boolean;
  onRequireGameViewport?: () => void;
  selectedSkill: SkillConfig | null;
  currentLayoutKey?: string | null;
  currentCaptureLayoutKey?: string | null;
  currentGameLayoutKey?: string | null;
  runeAlert?: RuneAlertConfig;
  ultimaRaidEquipmentAlert?: UltimaRaidEquipmentAlertConfig;
  huntStallAlert?: HuntStallAlertConfig;
  selectSkillRegionTarget?: (skillId: string) => void;
  changeSkill?: (skillId: string, patch: Partial<SkillConfig>) => void;
  updateRuneAlert?: (patch: Partial<RuneAlertConfig>) => void;
  updateUltimaRaidEquipmentAlert?: (
    patch: Partial<UltimaRaidEquipmentAlertConfig>,
  ) => void;
  updateHuntStallAlert?: (patch: Partial<HuntStallAlertConfig>) => void;
  resetRuneDetection?: () => void;
  resetUltimaRaidEquipmentDetection?: () => void;
  resetHuntStallDetection?: () => void;
  onReady: (api: HookApi) => void;
}) {
  const api = useRegionPickerController({
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
  });

  useEffect(() => {
    onReady(api);
  }, [api, onReady]);

  return null;
}

describe("useRegionPickerController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("opens the skill picker by selecting the skill target and tracking start", async () => {
    const selectSkillRegionTarget = vi.fn();
    const skill = createSkill({ id: "skill_fountain" });
    const apiRef: { current: HookApi | null } = { current: null };

    render(
      <Harness
        selectedSkill={skill}
        selectSkillRegionTarget={selectSkillRegionTarget}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).openSkillRegionPicker(skill.id);
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isSkillRegionPickerOpen).toBe(true);
    });
    expect(selectSkillRegionTarget).toHaveBeenCalledWith(skill.id);
    expect(trackCropSelectStartMock).toHaveBeenCalledWith("skill");
  });

  it("resumes the requested picker after game viewport verification", async () => {
    const onRequireGameViewport = vi.fn();
    const skill = createSkill({ id: "skill_fountain" });
    const apiRef: { current: HookApi | null } = { current: null };

    render(
      <Harness
        selectedSkill={skill}
        isGameViewportReady={false}
        onRequireGameViewport={onRequireGameViewport}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).openSkillRegionPicker(skill.id);
    });

    expect(onRequireGameViewport).toHaveBeenCalledOnce();
    expect(getHookApi(apiRef).isSkillRegionPickerOpen).toBe(false);
    expect(trackCropSelectStartMock).not.toHaveBeenCalled();

    act(() => {
      getHookApi(apiRef).resumePendingGameViewportPicker();
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isSkillRegionPickerOpen).toBe(true);
    });
    expect(trackCropSelectStartMock).toHaveBeenCalledWith("skill");
  });

  it("applies a layout-aware skill region and closes the picker", async () => {
    const changeSkill = vi.fn();
    const skill = createSkill({
      id: "skill_fountain",
      regionsByLayout: {
        "1280x720": {
          x: 0.1,
          y: 0.1,
          width: 0.1,
          height: 0.1,
        },
      },
    });
    const apiRef: { current: HookApi | null } = { current: null };

    render(
      <Harness
        selectedSkill={skill}
        currentLayoutKey="1920x1080"
        changeSkill={changeSkill}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).openSkillRegionPicker(skill.id);
      getHookApi(apiRef).applySkillRegion(REGION);
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isSkillRegionPickerOpen).toBe(false);
    });
    expect(changeSkill).toHaveBeenCalledWith(skill.id, {
      region: REGION,
      regionsByLayout: {
        ...skill.regionsByLayout,
        "1920x1080": REGION,
      },
    });
    expect(trackCropSelectCompleteMock).toHaveBeenCalledWith("skill");
  });

  it("writes calibrated skill regions only to the game-space key", () => {
    const changeSkill = vi.fn();
    const fallbackRegion = {
      x: 0.7,
      y: 0.7,
      width: 0.05,
      height: 0.05,
    };
    const captureRegion = {
      x: 0.75,
      y: 0.75,
      width: 0.04,
      height: 0.04,
    };
    const skill = createSkill({
      id: "skill_fountain",
      region: fallbackRegion,
      regionsByLayout: {
        "1766x968": captureRegion,
      },
    });
    const apiRef: { current: HookApi | null } = { current: null };

    render(
      <Harness
        selectedSkill={skill}
        currentCaptureLayoutKey="1766x968"
        currentGameLayoutKey="game:1366x768"
        changeSkill={changeSkill}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).applySkillRegion(REGION);
    });

    expect(changeSkill).toHaveBeenCalledWith(skill.id, {
      region: skill.region,
      regionsByLayout: {
        "1766x968": skill.regionsByLayout?.["1766x968"],
        "game:1366x768": REGION,
      },
    });
  });

  it("does not apply a skill region when no skill is selected", () => {
    const changeSkill = vi.fn();
    const apiRef: { current: HookApi | null } = { current: null };

    render(
      <Harness
        selectedSkill={null}
        changeSkill={changeSkill}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).applySkillRegion(REGION);
    });

    expect(changeSkill).not.toHaveBeenCalled();
    expect(trackCropSelectCompleteMock).not.toHaveBeenCalled();
  });

  it("opens and applies rune regions with reset and tracking", async () => {
    const updateRuneAlert = vi.fn();
    const resetRuneDetection = vi.fn();
    const runeAlert = {
      ...createDefaultRuneAlert(),
      regionsByLayout: {
        "1280x720": {
          x: 0.2,
          y: 0.2,
          width: 0.2,
          height: 0.2,
        },
      },
    };
    const apiRef: { current: HookApi | null } = { current: null };

    render(
      <Harness
        selectedSkill={createSkill({ id: "skill_fountain" })}
        currentLayoutKey="1920x1080"
        runeAlert={runeAlert}
        updateRuneAlert={updateRuneAlert}
        resetRuneDetection={resetRuneDetection}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).openRuneRegionPicker();
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isRuneRegionPickerOpen).toBe(true);
    });
    expect(trackCropSelectStartMock).toHaveBeenCalledWith("rune");

    act(() => {
      getHookApi(apiRef).applyRuneRegion(REGION);
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isRuneRegionPickerOpen).toBe(false);
    });
    expect(updateRuneAlert).toHaveBeenCalledWith({
      region: REGION,
      regionsByLayout: {
        ...runeAlert.regionsByLayout,
        "1920x1080": REGION,
      },
    });
    expect(resetRuneDetection).toHaveBeenCalledTimes(1);
    expect(trackCropSelectCompleteMock).toHaveBeenCalledWith("rune");
  });

  it("keeps rune regions in capture space while game-space crops are active", () => {
    const updateRuneAlert = vi.fn();
    const runeAlert = createDefaultRuneAlert();
    const apiRef: { current: HookApi | null } = { current: null };

    render(
      <Harness
        selectedSkill={null}
        currentCaptureLayoutKey="1766x968"
        currentGameLayoutKey="game:1366x768"
        runeAlert={runeAlert}
        updateRuneAlert={updateRuneAlert}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).applyRuneRegion(REGION);
    });

    expect(updateRuneAlert).toHaveBeenCalledWith({
      region: REGION,
      regionsByLayout: {
        ...(runeAlert.regionsByLayout ?? {}),
        "1766x968": REGION,
      },
    });
  });

  it("opens and applies ultima raid equipment regions with reset and tracking", async () => {
    const updateUltimaRaidEquipmentAlert = vi.fn();
    const resetUltimaRaidEquipmentDetection = vi.fn();
    const ultimaRaidEquipmentAlert = {
      ...createDefaultUltimaRaidEquipmentAlert(),
      regionsByLayout: {
        "1280x720": {
          x: 0.1,
          y: 0.1,
          width: 0.15,
          height: 0.15,
        },
      },
    };
    const apiRef: { current: HookApi | null } = { current: null };

    render(
      <Harness
        selectedSkill={null}
        currentLayoutKey="1920x1080"
        ultimaRaidEquipmentAlert={ultimaRaidEquipmentAlert}
        updateUltimaRaidEquipmentAlert={updateUltimaRaidEquipmentAlert}
        resetUltimaRaidEquipmentDetection={resetUltimaRaidEquipmentDetection}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).openUltimaRaidEquipmentRegionPicker();
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isUltimaRaidEquipmentRegionPickerOpen).toBe(true);
    });
    expect(trackCropSelectStartMock).toHaveBeenCalledWith(
      "ultima_raid_equipment",
    );

    act(() => {
      getHookApi(apiRef).applyUltimaRaidEquipmentRegion(REGION);
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isUltimaRaidEquipmentRegionPickerOpen).toBe(
        false,
      );
    });
    expect(updateUltimaRaidEquipmentAlert).toHaveBeenCalledWith({
      region: REGION,
      regionsByLayout: {
        ...ultimaRaidEquipmentAlert.regionsByLayout,
        "1920x1080": REGION,
      },
    });
    expect(resetUltimaRaidEquipmentDetection).toHaveBeenCalledTimes(1);
    expect(trackCropSelectCompleteMock).toHaveBeenCalledWith(
      "ultima_raid_equipment",
    );
  });

  it("opens and applies hunt stall cooldown regions with reset and tracking", async () => {
    const updateHuntStallAlert = vi.fn();
    const resetHuntStallDetection = vi.fn();
    const huntStallAlert = {
      ...createDefaultHuntStallAlert(),
      mode: "cooldown-presence" as const,
      cooldownRegionsByLayout: {
        "1280x720": {
          x: 0.2,
          y: 0.2,
          width: 0.2,
          height: 0.2,
        },
      },
    };
    const apiRef: { current: HookApi | null } = { current: null };

    render(
      <Harness
        selectedSkill={createSkill({ id: "skill_fountain" })}
        currentLayoutKey="1920x1080"
        huntStallAlert={huntStallAlert}
        updateHuntStallAlert={updateHuntStallAlert}
        resetHuntStallDetection={resetHuntStallDetection}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).openHuntStallRegionPicker();
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isHuntStallRegionPickerOpen).toBe(true);
    });
    expect(trackCropSelectStartMock).toHaveBeenCalledWith("hunt_stall");

    act(() => {
      getHookApi(apiRef).applyHuntStallRegion(REGION);
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isHuntStallRegionPickerOpen).toBe(false);
    });
    expect(updateHuntStallAlert).toHaveBeenCalledWith({
      cooldownRegion: REGION,
      cooldownRegionsByLayout: {
        ...huntStallAlert.cooldownRegionsByLayout,
        "1920x1080": REGION,
      },
    });
    expect(resetHuntStallDetection).toHaveBeenCalledTimes(1);
    expect(resetHuntStallDetection).toHaveBeenCalledWith("region-changed");
    expect(trackCropSelectCompleteMock).toHaveBeenCalledWith("hunt_stall");
  });

  it("applies manual experience regions without replacing cooldown regions", async () => {
    const updateHuntStallAlert = vi.fn();
    const resetHuntStallDetection = vi.fn();
    const cooldownRegion = {
      x: 0.2,
      y: 0.2,
      width: 0.2,
      height: 0.2,
    };
    const huntStallAlert = {
      ...createDefaultHuntStallAlert(),
      mode: "manual-experience" as const,
      cooldownRegion,
      cooldownRegionsByLayout: { "1920x1080": cooldownRegion },
      manualExperienceRegionsByLayout: {
        "1280x720": { x: 0.1, y: 0.8, width: 0.8, height: 0.1 },
      },
    };
    const apiRef: { current: HookApi | null } = { current: null };

    render(
      <Harness
        selectedSkill={createSkill({ id: "skill_fountain" })}
        currentLayoutKey="1920x1080"
        huntStallAlert={huntStallAlert}
        updateHuntStallAlert={updateHuntStallAlert}
        resetHuntStallDetection={resetHuntStallDetection}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).openHuntStallRegionPicker();
      getHookApi(apiRef).applyHuntStallRegion(REGION);
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isHuntStallRegionPickerOpen).toBe(false);
    });
    expect(updateHuntStallAlert).toHaveBeenCalledWith({
      manualExperienceRegion: REGION,
      manualExperienceRegionsByLayout: {
        ...huntStallAlert.manualExperienceRegionsByLayout,
        "1920x1080": REGION,
      },
    });
    expect(updateHuntStallAlert).not.toHaveBeenCalledWith(
      expect.objectContaining({ cooldownRegion: expect.anything() }),
    );
    expect(resetHuntStallDetection).toHaveBeenCalledTimes(1);
    expect(resetHuntStallDetection).toHaveBeenCalledWith("region-changed");
    expect(trackCropSelectCompleteMock).toHaveBeenCalledWith("hunt_stall");
  });

  it("preserves hunt fallback regions when writing a calibrated game-space crop", () => {
    const updateHuntStallAlert = vi.fn();
    const fallbackRegion = {
      x: 0.6,
      y: 0.8,
      width: 0.3,
      height: 0.02,
    };
    const huntStallAlert = {
      ...createDefaultHuntStallAlert(),
      mode: "manual-experience" as const,
      manualExperienceRegion: fallbackRegion,
    };
    const apiRef: { current: HookApi | null } = { current: null };

    render(
      <Harness
        selectedSkill={null}
        currentCaptureLayoutKey="1766x968"
        currentGameLayoutKey="game:1366x768"
        huntStallAlert={huntStallAlert}
        updateHuntStallAlert={updateHuntStallAlert}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).applyHuntStallRegion(REGION);
    });

    expect(updateHuntStallAlert).toHaveBeenCalledWith({
      manualExperienceRegion: fallbackRegion,
      manualExperienceRegionsByLayout: {
        "game:1366x768": REGION,
      },
    });
  });

  it("closes both region pickers together", async () => {
    const skill = createSkill({ id: "skill_fountain" });
    const apiRef: { current: HookApi | null } = { current: null };

    render(
      <Harness
        selectedSkill={skill}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getHookApi(apiRef).openSkillRegionPicker(skill.id);
      getHookApi(apiRef).openRuneRegionPicker();
      getHookApi(apiRef).openHuntStallRegionPicker();
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isSkillRegionPickerOpen).toBe(true);
      expect(getHookApi(apiRef).isRuneRegionPickerOpen).toBe(true);
      expect(getHookApi(apiRef).isHuntStallRegionPickerOpen).toBe(true);
    });

    act(() => {
      getHookApi(apiRef).closeRegionPickers();
    });

    await waitFor(() => {
      expect(getHookApi(apiRef).isSkillRegionPickerOpen).toBe(false);
      expect(getHookApi(apiRef).isRuneRegionPickerOpen).toBe(false);
      expect(getHookApi(apiRef).isHuntStallRegionPickerOpen).toBe(false);
    });
  });
});
