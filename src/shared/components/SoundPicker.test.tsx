import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SoundPicker } from "./SoundPicker";
import { SoundPickerCustomSoundsProvider } from "./SoundPickerCustomSoundsContext";

describe("SoundPicker", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows custom sounds at the top of the menu", () => {
    const onOpenCustomSoundManager = vi.fn();
    const onChange = vi.fn();
    render(
      <SoundPickerCustomSoundsProvider
        customSounds={[
          {
            id: "custom:custom-1",
            label: "[내 알림음] 보스 알림",
            src: "custom-sound://custom-1",
          },
        ]}
        onManageCustomSounds={onOpenCustomSoundManager}
      >
        <SoundPicker
          value="custom:custom-1"
          sounds={[{ id: "기본", label: "[기타] 기본", src: "/a.m4a" }]}
          onChange={onChange}
        />
      </SoundPickerCustomSoundsProvider>,
    );

    expect(screen.getByRole("button", { name: "알람음" })).toHaveTextContent(
      "[내 알림음] 보스 알림",
    );

    fireEvent.click(screen.getByRole("button", { name: "알람음" }));

    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("내 알림음 관리");
    expect(options[1]).toHaveTextContent("[내 알림음] 보스 알림");
    expect(options[2]).toHaveTextContent("[기타] 기본");

    fireEvent.click(options[0]);
    expect(onOpenCustomSoundManager).toHaveBeenCalledTimes(1);
  });

  it("shows an add action when no custom sounds exist", () => {
    const onOpenCustomSoundManager = vi.fn();
    render(
      <SoundPickerCustomSoundsProvider
        customSounds={[]}
        onManageCustomSounds={onOpenCustomSoundManager}
      >
        <SoundPicker
          value="기본"
          sounds={[{ id: "기본", label: "[기타] 기본", src: "/a.m4a" }]}
          onChange={() => undefined}
        />
      </SoundPickerCustomSoundsProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "알람음" }));
    fireEvent.click(screen.getByRole("option", { name: /내 알림음 추가/ }));

    expect(onOpenCustomSoundManager).toHaveBeenCalledTimes(1);
  });
});
