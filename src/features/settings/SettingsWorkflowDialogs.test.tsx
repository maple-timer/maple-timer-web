import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultProfile } from "../../lib/storage";
import { createSettingsPreset, type SettingsPreset } from "./settingsPresets";
import { SettingsWorkflowDialogs, type SettingsWorkflowDialogsProps } from "./SettingsWorkflowDialogs";

function createPreset(id: string, name: string): SettingsPreset {
  return {
    ...createSettingsPreset(name, createDefaultProfile()),
    id,
    name,
  };
}

function renderSettingsWorkflowDialogs(overrides: Partial<SettingsWorkflowDialogsProps> = {}) {
  const props: SettingsWorkflowDialogsProps = {
    pendingSettingsPresetImport: null,
    pendingSettingsReplacementAction: null,
    isUnsavedSettingsSavePromptOpen: false,
    pendingSettingsApply: null,
    onCancelSettingsPresetImport: vi.fn(),
    onConfirmSettingsPresetImport: vi.fn(),
    onSelectAllImportedSettingsPresets: vi.fn(),
    onClearImportedSettingsPresetSelection: vi.fn(),
    onToggleImportedSettingsPreset: vi.fn(),
    onCancelUnsavedSettingsReplacement: vi.fn(),
    onConfirmUnsavedSettingsReplacement: vi.fn(),
    onOpenUnsavedSettingsSavePrompt: vi.fn(),
    onCloseUnsavedSettingsSavePrompt: vi.fn(),
    onSaveCurrentSettingsBeforeReplacement: vi.fn(),
    onCancelSettingsApply: vi.fn(),
    onConfirmSettingsApply: vi.fn(),
    ...overrides,
  };

  return {
    ...render(<SettingsWorkflowDialogs {...props} />),
    props,
  };
}

describe("SettingsWorkflowDialogs", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the preset import dialog summary, selection, warnings, and actions", () => {
    const presetA = createPreset("preset-a", "사냥 프리셋");
    const presetB = createPreset("preset-b", "보스 프리셋");
    const { props } = renderSettingsWorkflowDialogs({
      pendingSettingsPresetImport: {
        fileName: "maple-settings.json",
        presets: [presetA, presetB],
        selectedPresetIds: [presetA.id],
        warnings: ["중복 이름은 파일 이름을 덧붙였습니다."],
      },
    });

    const dialog = screen.getByRole("dialog", { name: "설정 파일을 프리셋으로 불러올까요?" });
    expect(dialog).toHaveTextContent('"maple-settings.json" 파일에서 불러올 프리셋을 선택합니다.');
    expect(dialog).toHaveTextContent("선택됨");
    expect(dialog).toHaveTextContent("1개");
    expect(dialog).toHaveTextContent("파일 안 프리셋");
    expect(dialog).toHaveTextContent("2개");
    expect(dialog).toHaveTextContent("현재 설정");
    expect(dialog).toHaveTextContent("유지");
    expect(dialog).toHaveTextContent("중복 이름은 파일 이름을 덧붙였습니다.");

    expect(screen.getByLabelText("사냥 프리셋")).toBeChecked();
    expect(screen.getByLabelText("보스 프리셋")).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "전체 선택" }));
    expect(props.onSelectAllImportedSettingsPresets).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "전체 해제" }));
    expect(props.onClearImportedSettingsPresetSelection).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("보스 프리셋"));
    expect(props.onToggleImportedSettingsPreset).toHaveBeenCalledWith(presetB.id, true);

    fireEvent.click(screen.getByRole("button", { name: "선택한 프리셋 추가" }));
    expect(props.onConfirmSettingsPresetImport).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "불러오지 않기" }));
    expect(props.onCancelSettingsPresetImport).toHaveBeenCalledTimes(1);
  });

  it("disables preset import confirmation when no preset is selected", () => {
    renderSettingsWorkflowDialogs({
      pendingSettingsPresetImport: {
        fileName: "empty-selection.json",
        presets: [createPreset("preset-a", "사냥 프리셋")],
        selectedPresetIds: [],
      },
    });

    expect(screen.getByRole("button", { name: "선택한 프리셋 추가" })).toBeDisabled();
  });

  it("keeps the unsaved reset dialog labels and handlers", () => {
    const { props } = renderSettingsWorkflowDialogs({
      pendingSettingsReplacementAction: { kind: "reset" },
    });

    expect(
      screen.getByRole("dialog", { name: "현재 설정을 저장하지 않고 변경할까요?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "새 프리셋으로 저장" }));
    expect(props.onOpenUnsavedSettingsSavePrompt).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "그대로 초기화" }));
    expect(props.onConfirmUnsavedSettingsReplacement).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "돌아가기" }));
    expect(props.onCancelUnsavedSettingsReplacement).toHaveBeenCalledTimes(1);
  });

  it("keeps the unsaved apply dialog confirm label", () => {
    renderSettingsWorkflowDialogs({
      pendingSettingsReplacementAction: {
        kind: "apply-preset",
        presetId: "preset-a",
        presetName: "사냥 프리셋",
        profile: createDefaultProfile(),
      },
    });

    expect(screen.getByRole("button", { name: "그대로 적용" })).toBeInTheDocument();
  });

  it("saves current settings through the text input dialog", () => {
    const { props } = renderSettingsWorkflowDialogs({
      pendingSettingsReplacementAction: { kind: "reset" },
      isUnsavedSettingsSavePromptOpen: true,
    });

    fireEvent.change(screen.getByLabelText("프리셋 이름"), {
      target: { value: "보관할 설정" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장 후 계속" }));

    expect(props.onSaveCurrentSettingsBeforeReplacement).toHaveBeenCalledWith("보관할 설정");

    fireEvent.click(screen.getByRole("button", { name: "돌아가기" }));
    expect(props.onCloseUnsavedSettingsSavePrompt).toHaveBeenCalledTimes(1);
  });

  it("renders the pending apply dialog and wires cancel and confirm", () => {
    const { props } = renderSettingsWorkflowDialogs({
      pendingSettingsApply: {
        title: '"사냥 프리셋" 프리셋 적용',
        description: "현재 설정을 선택한 프리셋으로 교체합니다.",
        confirmLabel: "프리셋 적용",
        profile: createDefaultProfile(),
        warnings: ["일부 프리셋은 새 이름으로 저장됩니다."],
        importedPresetCount: 2,
      },
    });

    const dialog = screen.getByRole("dialog", { name: '"사냥 프리셋" 프리셋 적용' });
    expect(dialog).toHaveTextContent("현재 설정을 선택한 프리셋으로 교체합니다.");
    expect(dialog).toHaveTextContent("포함 프리셋");
    expect(dialog).toHaveTextContent("2개");
    expect(dialog).toHaveTextContent("일부 프리셋은 새 이름으로 저장됩니다.");

    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(props.onCancelSettingsApply).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "프리셋 적용" }));
    expect(props.onConfirmSettingsApply).toHaveBeenCalledTimes(1);
  });

  it("renders the missing custom sound fallback notice prominently", () => {
    const profile = createDefaultProfile();
    renderSettingsWorkflowDialogs({
      pendingSettingsApply: {
        title: '"커스텀 프리셋" 프리셋 적용',
        description:
          "현재 설정을 선택한 프리셋으로 교체합니다. 없는 사용자 알림음은 기본 알림음으로 바꿔 적용합니다.",
        confirmLabel: "기본 알림음으로 적용",
        profile,
        customSoundFallbackNotice: {
          missingSoundCount: 1,
          replacedReferenceCount: 2,
          fallbackSoundLabel: "띵동띵동",
          affectedLabels: ["기본 알림음", `스킬: ${profile.skills[0].name}`],
        },
      },
    });

    const dialog = screen.getByRole("dialog", { name: '"커스텀 프리셋" 프리셋 적용' });
    expect(dialog).toHaveTextContent("사용자 알림음 파일이 없습니다");
    expect(dialog).toHaveTextContent("없는 알림음 1개를 찾았습니다.");
    expect(dialog).toHaveTextContent("관련 설정 2개가 띵동띵동 기본 알림음으로 바뀝니다.");
    expect(dialog).toHaveTextContent(`스킬: ${profile.skills[0].name}`);
    expect(screen.getByRole("button", { name: "기본 알림음으로 적용" })).toBeInTheDocument();
  });
});
