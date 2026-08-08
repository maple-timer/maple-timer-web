import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSoundPickerCustomSounds } from "../../shared/components/SoundPickerCustomSoundsContext";
import { CustomSoundsProvider } from "./CustomSoundsContext";

function CustomSoundsProbe() {
  const { customSounds, onManageCustomSounds } = useSoundPickerCustomSounds();

  return (
    <button type="button" onClick={onManageCustomSounds}>
      {customSounds.map((sound) => sound.label).join(",")}
    </button>
  );
}

describe("CustomSoundsProvider", () => {
  afterEach(cleanup);

  it("adapts custom sound metadata to the neutral sound picker contract", () => {
    const onManage = vi.fn();
    render(
      <CustomSoundsProvider
        customSounds={[
          {
            id: "custom-1",
            name: "보스 알림",
            mimeType: "audio/mpeg",
            size: 1024,
            durationMs: 2_000,
            trimStartMs: 0,
            trimEndMs: 2_000,
            createdAt: "2026-05-26T00:00:00.000Z",
            updatedAt: "2026-05-26T00:00:00.000Z",
          },
        ]}
        openCustomSoundManager={onManage}
      >
        <CustomSoundsProbe />
      </CustomSoundsProvider>,
    );

    const manageButton = screen.getByRole("button", {
      name: "[내 알림음] 보스 알림",
    });
    expect(manageButton).toBeInTheDocument();

    fireEvent.click(manageButton);
    expect(onManage).toHaveBeenCalledTimes(1);
  });
});
