import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALERT_SOUNDS,
  ADAM_ERDA_FOUNTAIN_RANDOM_SOUND_ID,
  ADAM_HUNT_STALL_RANDOM_SOUND_ID,
  ADAM_RECALL_SOUND_ID,
  ADAM_RUNE_SOUND_ID,
  ADAM_SOL_JANUS_RANDOM_SOUND_ID,
  ADAM_SOL_JANUS_SOUND_IDS,
  DEFAULT_ALERT_SOUND_ID,
  DEFAULT_PICKER_ALERT_SOUNDS,
  FEMALE_ERDA_FOUNTAIN_RANDOM_SOUND_ID,
  FEMALE_HUNT_STALL_RANDOM_SOUND_ID,
  FEMALE_RUNE_SOUND_ID,
  FEMALE_SOL_JANUS_RANDOM_SOUND_ID,
  FEMALE_SOL_JANUS_SOUND_IDS,
  getAlertSound,
  getConcreteAlertSound,
  getBoosterExpiryAlertSounds,
  getBuffExpiryAlertSounds,
  getErdaFountainAlertSounds,
  getHuntStallAlertSounds,
  getRuneAlertSounds,
  getSolJanusAlertSounds,
  getSpecialCoreAlertSounds,
  normalizeAlertSoundId,
  normalizeAlertSoundIdForList,
} from "./sounds";

function labels(sounds: Array<{ label: string }>) {
  return sounds.map((sound) => sound.label);
}

describe("alert sounds", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds random Adam groups for Janus, Fountain, and hunt stall alerts", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);

    expect(getConcreteAlertSound(ADAM_SOL_JANUS_RANDOM_SOUND_ID).id).toBe(
      ADAM_SOL_JANUS_SOUND_IDS[2],
    );
    expect(getConcreteAlertSound(ADAM_ERDA_FOUNTAIN_RANDOM_SOUND_ID).label).toBe(
      "[아담] 파운틴 꺼질것 같애요",
    );
    expect(getConcreteAlertSound(ADAM_HUNT_STALL_RANDOM_SOUND_ID).label).toBe(
      "[아담] 사냥 멈춘것 같애요 3",
    );
    expect(getConcreteAlertSound(FEMALE_SOL_JANUS_RANDOM_SOUND_ID).id).toBe(
      FEMALE_SOL_JANUS_SOUND_IDS[2],
    );
    expect(getConcreteAlertSound(FEMALE_ERDA_FOUNTAIN_RANDOM_SOUND_ID).label).toBe(
      "[여성] 파운틴 꺼질것 같애요",
    );
    expect(getConcreteAlertSound(FEMALE_HUNT_STALL_RANDOM_SOUND_ID).label).toBe(
      "[여성] 사냥 멈춘것 같아요 3",
    );
  });

  it("displays missing custom sounds as the default alert sound", () => {
    const sound = getAlertSound("custom:missing");

    expect(sound.id).toBe(DEFAULT_ALERT_SOUND_ID);
    expect(sound.label).toBe("[기타] 띵동띵동");
  });

  it("limits context voices by alert context while keeping non-context sounds selectable", () => {
    expect(labels(getSolJanusAlertSounds()).filter((label) => label.startsWith("[아담]"))).toEqual([
      "[아담] 야누스 랜덤",
      "[아담] 야누스 곧 꺼져요",
      "[아담] 야누스 꺼져가요",
      "[아담] 야누스 꺼질것 같애요",
      "[아담] 회수하세요",
    ]);
    expect(labels(getSolJanusAlertSounds()).filter((label) => label.startsWith("[여성]"))).toEqual([
      "[여성] 야누스 랜덤",
      "[여성] 야누스 곧 꺼져요",
      "[여성] 야누스 꺼져가요",
      "[여성] 야누스 꺼질것 같애요",
    ]);
    expect(labels(getSolJanusAlertSounds())).toContain("[여성2] 야누스 꺼져가요");
    expect(labels(getErdaFountainAlertSounds()).filter((label) => label.startsWith("[아담]"))).toEqual([
      "[아담] 파운틴 랜덤",
      "[아담] 파운틴 곧 꺼져요",
      "[아담] 파운틴 꺼져가요",
      "[아담] 파운틴 꺼질것 같애요",
      "[아담] 회수하세요",
    ]);
    expect(labels(getErdaFountainAlertSounds()).filter((label) => label.startsWith("[여성]"))).toEqual([
      "[여성] 파운틴 랜덤",
      "[여성] 파운틴 곧 꺼져요",
      "[여성] 파운틴 꺼져가요",
      "[여성] 파운틴 꺼질것 같애요",
    ]);
    expect(labels(getErdaFountainAlertSounds())).toContain("[여성2] 파운틴 꺼져가요");
    expect(labels(getRuneAlertSounds()).filter((label) => label.startsWith("[아담]"))).toEqual([
      "[아담] 떳어요 룬 떳어요",
      "[아담] 회수하세요",
    ]);
    expect(labels(getRuneAlertSounds()).filter((label) => label.startsWith("[여성]"))).toEqual([
      "[여성] 룬 떳어요",
    ]);
    expect(labels(getRuneAlertSounds())).toContain("[여성2] 룬 떳어요");
    expect(labels(getHuntStallAlertSounds()).filter((label) => label.startsWith("[아담]"))).toEqual([
      "[아담] 사냥 멈춤 랜덤",
      "[아담] 사냥 멈춘것 같애요 1",
      "[아담] 사냥 멈춘것 같애요 2",
      "[아담] 사냥 멈춘것 같애요 3",
      "[아담] 회수하세요",
    ]);
    expect(labels(getHuntStallAlertSounds()).filter((label) => label.startsWith("[여성]"))).toEqual([
      "[여성] 사냥 멈춤 랜덤",
      "[여성] 사냥 멈춘것 같아요 1",
      "[여성] 사냥 멈춘것 같아요 2",
      "[여성] 사냥 멈춘것 같아요 3",
    ]);
    expect(labels(getHuntStallAlertSounds())).toContain("[여성2] 사냥 멈춘것 같애요");
    expect(labels(getBuffExpiryAlertSounds()).filter((label) => label.startsWith("[아담]"))).toEqual([
      "[아담] 버프 끝난것 같애요",
      "[아담] 회수하세요",
    ]);
    expect(labels(getBuffExpiryAlertSounds()).filter((label) => label.startsWith("[여성2]"))).toEqual([
      "[여성2] 버프 끝난것 같애요",
    ]);
    expect(labels(getBuffExpiryAlertSounds())).not.toContain("[아담] 부스터 끝나가요");
    expect(labels(getBuffExpiryAlertSounds())).not.toContain("[여성] 부스터 끝나가요");
    expect(labels(getBoosterExpiryAlertSounds())).toEqual(
      expect.arrayContaining([
        "[아담] 부스터 끝나가요",
        "[여성] 부스터 끝나가요",
        "[아담] 버프 끝난것 같애요",
        "[여성2] 버프 끝난것 같애요",
      ]),
    );
    expect(labels(ALERT_SOUNDS)).toContain("[아담] 부스터 끝나가요");
    expect(labels(ALERT_SOUNDS)).toContain("[아담] 회수하세요");
    expect(labels(ALERT_SOUNDS)).toContain("[여성] 부스터 끝나가요");
    expect(labels(DEFAULT_PICKER_ALERT_SOUNDS)).not.toContain("[아담] 부스터 끝나가요");
    expect(labels(DEFAULT_PICKER_ALERT_SOUNDS)).not.toContain("[여성] 부스터 끝나가요");
    expect(labels(DEFAULT_PICKER_ALERT_SOUNDS)).not.toContain("[여성] 카운트다운");
    expect(labels(getSpecialCoreAlertSounds())).toEqual(["[여성] 카운트다운"]);

    expect(getRuneAlertSounds().some((sound) => sound.id === ADAM_RUNE_SOUND_ID)).toBe(true);
    expect(getRuneAlertSounds().some((sound) => sound.id === FEMALE_RUNE_SOUND_ID)).toBe(true);
    expect(getRuneAlertSounds().some((sound) => sound.id === "미스터리")).toBe(true);
    expect(getHuntStallAlertSounds().some((sound) => sound.id === "띵동띵동")).toBe(true);
    expect(getAlertSound(ADAM_RECALL_SOUND_ID)).toMatchObject({
      label: "[아담] 회수하세요",
      src: "/sounds/adam-recall.m4a",
      fallbackSrc: "/sounds/adam-recall.mp3",
    });
  });

  it("includes the bundled low doorbell sounds", () => {
    expect(labels(ALERT_SOUNDS)).toEqual(
      expect.arrayContaining([
        "[기타] 깊은 띵동",
        "[기타] 낮은 도어벨",
        "[기타] 낮은 알림음",
        "[기타] 단음 알림",
        "[기타] 더블 동",
        "[기타] 따뜻한 띵동",
        "[기타] 부드러운 띵동",
        "[기타] 짧은 띵동",
        "[기타] 차분한 차임",
        "[기타] 투톤 알림",
      ]),
    );
  });

  it("uses m4a files as primary sources and mp3 files as fallbacks", () => {
    const concreteSounds = ALERT_SOUNDS.filter((sound) => sound.src);
    expect(concreteSounds.every((sound) => sound.src.endsWith(".m4a"))).toBe(true);

    const fallbackSounds = ALERT_SOUNDS.filter((sound) => sound.fallbackSrc);
    expect(fallbackSounds.every((sound) => sound.fallbackSrc?.endsWith(".mp3"))).toBe(true);
  });

  it("preserves custom sound IDs during normalization", () => {
    expect(normalizeAlertSoundId("custom:boss")).toBe("custom:boss");
    expect(normalizeAlertSoundIdForList("custom:boss", getRuneAlertSounds())).toBe("custom:boss");
  });
});
