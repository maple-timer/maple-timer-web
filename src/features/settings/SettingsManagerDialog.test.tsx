import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultProfile } from "../../lib/storage";
import { createSettingsPreset, type SettingsPreset } from "./settingsPresets";
import { SettingsManagerDialog } from "./SettingsManagerDialog";

function createPreset(id: string, name: string): SettingsPreset {
  return {
    ...createSettingsPreset(name, createDefaultProfile()),
    id,
    name,
  };
}

function renderSettingsManagerDialog({
  presets = [createPreset("preset-a", "사냥 프리셋"), createPreset("preset-b", "보스 프리셋")],
  selectedPresetId = presets[0]?.id ?? "",
}: {
  presets?: SettingsPreset[];
  selectedPresetId?: string;
} = {}) {
  const props = {
    presets,
    currentSettingsPresetName: presets[0]?.name ?? null,
    selectedPresetId,
    isApplyHintVisible: false,
    onSelectedPresetChange: vi.fn(),
    onSaveNewPreset: vi.fn(),
    onRenamePreset: vi.fn(),
    onOverwritePreset: vi.fn(),
    onDeletePreset: vi.fn(),
    onApplyPreset: vi.fn(),
    onExportAllPresets: vi.fn(),
    onExportSelectedPreset: vi.fn(),
    onImportSettings: vi.fn(),
    onResetSettings: vi.fn(),
    onClose: vi.fn(),
  };

  return {
    ...render(<SettingsManagerDialog {...props} />),
    props,
  };
}

describe("SettingsManagerDialog", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows an empty disabled preset picker when there are no presets", () => {
    renderSettingsManagerDialog({ presets: [] });

    const trigger = screen.getByRole("button", { name: "보유 프리셋" });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent("보유 프리셋 없음");
  });

  it("opens the preset dropdown and selects a preset", () => {
    const { props } = renderSettingsManagerDialog();

    fireEvent.click(screen.getByRole("button", { name: "보유 프리셋" }));
    expect(screen.getByRole("listbox", { name: "보유 프리셋" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "보스 프리셋" }));

    expect(props.onSelectedPresetChange).toHaveBeenCalledWith("preset-b");
    expect(screen.queryByRole("listbox", { name: "보유 프리셋" })).not.toBeInTheDocument();
  });

  it("opens the rename dialog from the preset dropdown", () => {
    renderSettingsManagerDialog();

    fireEvent.click(screen.getByRole("button", { name: "보유 프리셋" }));
    fireEvent.click(screen.getByRole("button", { name: "사냥 프리셋 이름 변경" }));

    expect(screen.getByRole("dialog", { name: "프리셋 이름 변경" })).toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "보유 프리셋" })).not.toBeInTheDocument();
  });

  it("saves a new preset from the manager action dialog", () => {
    const { props } = renderSettingsManagerDialog();

    fireEvent.click(screen.getByRole("button", { name: "새 프리셋 저장" }));
    fireEvent.change(screen.getByLabelText("프리셋 이름"), {
      target: { value: "새 사냥 프리셋" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(props.onSaveNewPreset).toHaveBeenCalledWith("새 사냥 프리셋");
  });

  it("shows a duplicate name error when saving a new preset", () => {
    const { props } = renderSettingsManagerDialog();

    fireEvent.click(screen.getByRole("button", { name: "새 프리셋 저장" }));
    fireEvent.change(screen.getByLabelText("프리셋 이름"), {
      target: { value: "사냥 프리셋" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(screen.getByText("이미 같은 이름의 프리셋이 있습니다.")).toBeInTheDocument();
    expect(props.onSaveNewPreset).not.toHaveBeenCalled();
  });

  it("renames a preset from the manager action dialog", () => {
    const { props } = renderSettingsManagerDialog();

    fireEvent.click(screen.getByRole("button", { name: "보유 프리셋" }));
    fireEvent.click(screen.getByRole("button", { name: "사냥 프리셋 이름 변경" }));
    fireEvent.change(screen.getByLabelText("프리셋 이름"), {
      target: { value: "새 이름" },
    });
    fireEvent.click(screen.getByRole("button", { name: "이름 변경" }));

    expect(props.onRenamePreset).toHaveBeenCalledWith("preset-a", "새 이름");
  });

  it("opens the delete dialog from the preset dropdown", () => {
    renderSettingsManagerDialog();

    fireEvent.click(screen.getByRole("button", { name: "보유 프리셋" }));
    fireEvent.click(screen.getByRole("button", { name: "사냥 프리셋 삭제" }));

    expect(screen.getByRole("dialog", { name: '"사냥 프리셋" 프리셋을 삭제할까요?' })).toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "보유 프리셋" })).not.toBeInTheDocument();
  });

  it("overwrites the selected preset from the confirm dialog", () => {
    const { props } = renderSettingsManagerDialog();

    fireEvent.click(screen.getByRole("button", { name: "현재 설정으로 갱신" }));
    fireEvent.click(screen.getByRole("button", { name: "갱신하기" }));

    expect(props.onOverwritePreset).toHaveBeenCalledWith("preset-a");
  });

  it("deletes a preset from the confirm dialog", () => {
    const { props } = renderSettingsManagerDialog();

    fireEvent.click(screen.getByRole("button", { name: "보유 프리셋" }));
    fireEvent.click(screen.getByRole("button", { name: "사냥 프리셋 삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제하기" }));

    expect(props.onDeletePreset).toHaveBeenCalledWith("preset-a");
  });

  it("resets current settings from the confirm dialog", () => {
    const { props } = renderSettingsManagerDialog();

    fireEvent.click(screen.getByRole("button", { name: "현재 설정 초기화" }));
    fireEvent.click(screen.getByRole("button", { name: "초기화하기" }));

    expect(props.onResetSettings).toHaveBeenCalledTimes(1);
  });

  it("closes the preset dropdown on Escape and outside mouse down", () => {
    renderSettingsManagerDialog();

    const trigger = screen.getByRole("button", { name: "보유 프리셋" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "보유 프리셋" })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole("listbox", { name: "보유 프리셋" })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox", { name: "보유 프리셋" })).not.toBeInTheDocument();
  });
});
