import { describe, expect, it } from "vitest";
import {
  formatCustomSoundDurationMs,
  formatCustomSoundFileSize,
  getCustomSoundTrimFromRatio,
  getCustomSoundWaveformViewModel,
} from "./customSoundDialogViewModel";

describe("customSoundDialogViewModel", () => {
  it("formats short and long custom sound durations", () => {
    expect(formatCustomSoundDurationMs(-100)).toBe("0.00초");
    expect(formatCustomSoundDurationMs(450)).toBe("0.45초");
    expect(formatCustomSoundDurationMs(1_250)).toBe("1.25초");
    expect(formatCustomSoundDurationMs(10_000)).toBe("10.0초");
  });

  it("formats custom sound file sizes", () => {
    expect(formatCustomSoundFileSize(1)).toBe("1KB");
    expect(formatCustomSoundFileSize(1_536)).toBe("2KB");
    expect(formatCustomSoundFileSize(2.4 * 1024 * 1024)).toBe("2.4MB");
  });

  it("builds waveform selection and playhead styles", () => {
    const viewModel = getCustomSoundWaveformViewModel(
      {
        durationMs: 10_000,
        trimStartMs: 1_000,
        trimEndMs: 6_000,
      },
      {
        trimEndMs: 6_000,
        progressMs: 4_000,
      },
    );

    expect(viewModel.selectedPercentStart).toBe(10);
    expect(viewModel.selectedPercentEnd).toBe(60);
    expect(viewModel.previewPercent).toBe(40);
    expect(viewModel.selectionStyle).toEqual({ left: "10%", right: "40%" });
    expect(viewModel.previewStyle).toEqual({ left: "40%" });
    expect(viewModel.startHandleStyle).toEqual({ left: "10%" });
    expect(viewModel.endHandleStyle).toEqual({ left: "60%" });
  });

  it("omits the waveform playhead when no preview is active", () => {
    const viewModel = getCustomSoundWaveformViewModel(
      {
        durationMs: 10_000,
        trimStartMs: 1_000,
        trimEndMs: 6_000,
      },
      null,
    );

    expect(viewModel.previewPercent).toBeNull();
    expect(viewModel.previewStyle).toBeNull();
  });

  it("clamps start trim dragging to the allowed range", () => {
    const current = {
      durationMs: 30_000,
      trimStartMs: 2_000,
      trimEndMs: 18_000,
    };

    expect(getCustomSoundTrimFromRatio({ current, handle: "start", ratio: -1 })).toEqual({
      trimStartMs: 3_000,
      trimEndMs: 18_000,
    });
    expect(getCustomSoundTrimFromRatio({ current, handle: "start", ratio: 0.75 })).toEqual({
      trimStartMs: 17_500,
      trimEndMs: 18_000,
    });
  });

  it("clamps end trim dragging to the allowed range", () => {
    const current = {
      durationMs: 30_000,
      trimStartMs: 10_000,
      trimEndMs: 16_000,
    };

    expect(getCustomSoundTrimFromRatio({ current, handle: "end", ratio: 0 })).toEqual({
      trimStartMs: 10_000,
      trimEndMs: 10_500,
    });
    expect(getCustomSoundTrimFromRatio({ current, handle: "end", ratio: 1 })).toEqual({
      trimStartMs: 10_000,
      trimEndMs: 25_000,
    });
  });
});
