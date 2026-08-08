import { describe, expect, it } from "vitest";
import {
  buildWaveformPeaks,
  createCustomAlertSoundId,
  getCustomAlertSoundRecordId,
  MAX_CUSTOM_SOUND_FILE_SIZE_BYTES,
  MAX_CUSTOM_SOUND_TRIM_MS,
  MIN_CUSTOM_SOUND_TRIM_MS,
  normalizeCustomSoundName,
  normalizeCustomSoundTrim,
  validateCustomSoundFile,
} from "./customSounds";

function createFile(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("custom alert sounds", () => {
  it("accepts supported audio files under 5MB", () => {
    expect(validateCustomSoundFile(createFile("alert.mp3", "audio/mpeg", 1024))).toBeNull();
    expect(validateCustomSoundFile(createFile("alert.m4a", "", 1024))).toBeNull();
    expect(validateCustomSoundFile(createFile("alert.wav", "audio/wav", 1024))).toBeNull();
    expect(validateCustomSoundFile(createFile("alert.ogg", "audio/ogg", 1024))).toBeNull();
  });

  it("rejects unsupported or oversized files", () => {
    expect(validateCustomSoundFile(createFile("alert.txt", "text/plain", 1024))).toMatch(
      /mp3, m4a, wav, ogg/,
    );
    expect(
      validateCustomSoundFile(
        createFile("alert.mp3", "audio/mpeg", MAX_CUSTOM_SOUND_FILE_SIZE_BYTES + 1),
      ),
    ).toMatch(/5MB 이하/);
  });

  it("normalizes empty names from the file name", () => {
    expect(normalizeCustomSoundName("", "boss-warning.mp3")).toBe("boss-warning");
    expect(normalizeCustomSoundName("  직접 입력  ")).toBe("직접 입력");
  });

  it("keeps trim ranges between 0.5s and 15s", () => {
    expect(normalizeCustomSoundTrim(30_000, 0, 30_000)).toEqual({
      trimStartMs: 0,
      trimEndMs: MAX_CUSTOM_SOUND_TRIM_MS,
    });
    expect(normalizeCustomSoundTrim(30_000, 10_000, 10_100)).toEqual({
      trimStartMs: 10_000,
      trimEndMs: 10_000 + MIN_CUSTOM_SOUND_TRIM_MS,
    });
    expect(normalizeCustomSoundTrim(8_000, -100, 9_000)).toEqual({
      trimStartMs: 0,
      trimEndMs: 8_000,
    });
  });

  it("maps custom sound IDs to storage record IDs", () => {
    expect(createCustomAlertSoundId("sound-1")).toBe("custom:sound-1");
    expect(getCustomAlertSoundRecordId("custom:sound-1")).toBe("sound-1");
    expect(getCustomAlertSoundRecordId("sound-1")).toBe("sound-1");
    expect(getCustomAlertSoundRecordId("")).toBeNull();
  });

  it("builds normalized waveform peaks", () => {
    const buffer = {
      length: 4,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array([0, 0.5, -1, 0.25]),
    } as unknown as AudioBuffer;

    expect(buildWaveformPeaks(buffer, 4)).toEqual([0.08, 0.5, 1, 0.25]);
  });
});
