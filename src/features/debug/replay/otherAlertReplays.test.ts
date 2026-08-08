import { describe, expect, it } from "vitest";
import {
  analyzeHuntStallReplaySample,
  analyzeRuneReplaySample,
  analyzeSkillReplaySample,
} from "./otherAlertReplays";

const NOW = 1_000_000;
const REGION = { x: 0.1, y: 0.1, width: 0.1, height: 0.1 };

describe("analyzeRuneReplaySample", () => {
  it("marks a stable detected rune candidate as currently due", () => {
    const result = analyzeRuneReplaySample(
      {
        body: {
          kind: "rune-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            result: { detected: true, confidence: 0.92, candidateCount: 1 },
          },
          rune: {
            config: { enabled: true, region: REGION },
            currentRegion: REGION,
            state: {
              status: "candidate",
              stableCount: 3,
              confidence: 0.92,
              alertedAt: null,
              lastAlertedAt: null,
            },
          },
        },
      },
      { now: NOW },
    );

    expect(result.supported).toBe(true);
    expect(result.shouldAlert).toBe(true);
    expect(result.decisionReason).toBe("due-now");
    expect(result.causes[0]).toMatchObject({
      status: "fail",
      title: "현재 알림 대상",
    });
  });

  it("does not claim a duplicate rune alert when the payload is already alerted", () => {
    const result = analyzeRuneReplaySample(
      {
        body: {
          kind: "rune-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            result: { detected: true, confidence: 0.95, candidateCount: 1 },
          },
          rune: {
            config: { enabled: true, region: REGION },
            currentRegion: REGION,
            state: {
              status: "alerted",
              stableCount: 4,
              confidence: 0.95,
              alertedAt: NOW - 1_000,
              lastAlertedAt: NOW - 1_000,
            },
          },
        },
      },
      { now: NOW },
    );

    expect(result.shouldAlert).toBe(false);
    expect(result.decisionReason).toBe("already-alerted");
    expect(result.causes[0]).toMatchObject({
      status: "pass",
      title: "알림 완료 상태",
    });
  });

  it("uses the saved runtime trace instead of a separately detected report frame", () => {
    const result = analyzeRuneReplaySample(
      {
        body: {
          kind: "rune-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            sampledAt: NOW,
            result: { detected: true, confidence: 0.99, candidateCount: 1 },
          },
          rune: {
            config: { enabled: true, region: REGION },
            currentRegion: REGION,
            state: {
              status: "waiting",
              stableCount: 0,
              candidateCount: 0,
              lastAlertedAt: null,
              lastAlertPlayback: null,
            },
            runtimeTrace: [
              {
                sampledAt: NOW - 400,
                detected: false,
                confidence: 0,
                candidateCount: 0,
                stableCount: 0,
                shouldAlert: false,
                status: "waiting",
                reason: "waiting",
              },
            ],
          },
        },
      },
      { now: NOW },
    );

    expect(result.shouldAlert).toBe(false);
    expect(result.metrics).toMatchObject({
      reportFrameDetected: true,
      detected: false,
      stableCount: 0,
      alertOutcome: "not-triggered",
    });
  });

  it("explains that a detected report frame could not alert while rune alerting was off", () => {
    const result = analyzeRuneReplaySample(
      {
        body: {
          kind: "rune-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            sampledAt: NOW,
            result: { detected: true, confidence: 0.99, candidateCount: 1 },
          },
          rune: {
            config: { enabled: false, region: REGION },
            currentRegion: REGION,
            state: {
              status: "paused",
              stableCount: 0,
              candidateCount: 0,
              lastAlertedAt: null,
              lastAlertPlayback: null,
            },
            runtimeTrace: [
              {
                sampledAt: NOW - 400,
                detected: false,
                confidence: 0,
                candidateCount: 0,
                stableCount: 0,
                shouldAlert: false,
                status: "paused",
                reason: "paused",
              },
            ],
          },
        },
      },
      { now: NOW },
    );

    expect(result.shouldAlert).toBe(false);
    expect(result.decisionReason).toBe("disabled");
    expect(result.causes[0]).toMatchObject({
      status: "warn",
      title: "제보 당시 룬 알림이 꺼져 있었습니다",
    });
  });

  it("replays stored samples without policy metadata using the legacy OR rule", () => {
    const result = analyzeRuneReplaySample(
      {
        body: {
          kind: "rune-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: { sampledAt: NOW, result: { detected: true, confidence: 0.9 } },
          rune: {
            config: { enabled: true, region: REGION },
            currentRegion: REGION,
            state: {
              status: "candidate",
              stableCount: 2,
              firstDetectedAt: NOW - 900,
              candidateCount: 1,
            },
          },
        },
      },
      { now: NOW },
    );

    expect(result.shouldAlert).toBe(true);
    expect(result.metrics).toMatchObject({
      runtimeStable: true,
      confirmationPolicyVersion: "rune-confirmation-v1",
      confirmationPolicyMode: "any",
      requiredStableFrames: 3,
      requiredStableMilliseconds: 900,
    });
  });

  it("requires both frame count and duration for current policy samples", () => {
    const result = analyzeRuneReplaySample(
      {
        body: {
          kind: "rune-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: { sampledAt: NOW, result: { detected: true, confidence: 0.9 } },
          rune: {
            config: { enabled: true, region: REGION },
            confirmationPolicy: {
              version: "rune-confirmation-v2",
              mode: "all",
              requiredStableFrames: 3,
              requiredStableMilliseconds: 900,
            },
            currentRegion: REGION,
            state: {
              status: "candidate",
              stableCount: 2,
              firstDetectedAt: NOW - 1_001,
              candidateCount: 1,
            },
          },
        },
      },
      { now: NOW },
    );

    expect(result.shouldAlert).toBe(false);
    expect(result.metrics).toMatchObject({
      runtimeStable: false,
      confirmationPolicyVersion: "rune-confirmation-v2",
      confirmationPolicyMode: "all",
      requiredStableFrames: 3,
      requiredStableMilliseconds: 900,
    });
  });

  it("classifies a rune playback failure separately from missed detection", () => {
    const result = analyzeRuneReplaySample(
      {
        body: {
          kind: "rune-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            result: { detected: true, confidence: 0.94, candidateCount: 1 },
          },
          rune: {
            config: { enabled: true, region: REGION },
            currentRegion: REGION,
            state: {
              status: "candidate",
              stableCount: 0,
              confidence: 0.94,
              alertedAt: null,
              lastAlertPlayback: {
                status: "failed",
                decision: "initial",
                startedAt: NOW - 500,
                finishedAt: null,
                failedAt: NOW - 400,
                error: "NotAllowedError",
              },
            },
          },
        },
      },
      { now: NOW },
    );

    expect(result.shouldAlert).toBe(false);
    expect(result.decisionReason).toBe("playback-failed");
    expect(result.metrics).toMatchObject({
      lastAlertPlaybackStatus: "failed",
      lastAlertPlaybackError: "NotAllowedError",
    });
    expect(result.causes[0]).toMatchObject({
      status: "fail",
      title: "룬 알림 재생 실패",
    });
  });
});

describe("analyzeHuntStallReplaySample", () => {
  it("marks cooldown-presence unchanged time past threshold as currently due", () => {
    const result = analyzeHuntStallReplaySample(
      {
        body: {
          kind: "hunt-stall-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            mode: "cooldown-presence",
            result: { value: "5", confidence: 0.88 },
          },
          huntStall: {
            config: {
              enabled: true,
              mode: "cooldown-presence",
              cooldownRegion: REGION,
              cooldownMissingThresholdSeconds: 5,
            },
            state: {
              status: "stalled",
              unchangedSeconds: 8,
              hasObservedCooldownPresence: true,
              alertedAt: null,
              confidence: 0.88,
            },
          },
        },
      },
      { now: NOW },
    );

    expect(result.supported).toBe(true);
    expect(result.shouldAlert).toBe(true);
    expect(result.decisionReason).toBe("due-now");
    expect(result.metrics).toMatchObject({
      mode: "cooldown-presence",
      thresholdSeconds: 5,
      unchangedSeconds: 8,
    });
  });

  it("does not claim a duplicate experience-stall alert after alertedAt is set", () => {
    const result = analyzeHuntStallReplaySample(
      {
        body: {
          kind: "hunt-stall-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            mode: "experience",
            rawDataUrl: "data:image/png;base64,AA==",
            result: { value: "17", confidence: 0.75 },
          },
          huntStall: {
            config: {
              enabled: true,
              mode: "experience",
              stallThresholdSeconds: 10,
            },
            state: {
              status: "alerted",
              unchangedSeconds: 40,
              hasObservedExperienceChange: true,
              alertedAt: NOW - 2_000,
              confidence: 0.75,
            },
          },
        },
      },
      { now: NOW },
    );

    expect(result.shouldAlert).toBe(false);
    expect(result.decisionReason).toBe("already-alerted");
    expect(result.causes[0]).toMatchObject({
      status: "pass",
      title: "알림 처리 기록 있음",
    });
  });

  it("replays a due manual-experience repeat from the saved completion timestamp", () => {
    const result = analyzeHuntStallReplaySample(
      {
        body: {
          kind: "hunt-stall-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            sampledAt: NOW,
            mode: "manual-experience",
            rawDataUrl: "data:image/png;base64,AA==",
            result: { value: "12.345%", confidence: 0.9 },
          },
          huntStall: {
            config: {
              enabled: true,
              mode: "manual-experience",
              stallThresholdSeconds: 10,
              repeatAlertEnabled: true,
              repeatAlertIntervalSeconds: 5,
              repeatAlertMaxCount: 3,
            },
            state: {
              status: "alerted",
              unchangedSeconds: 20,
              hasObservedExperienceChange: true,
              alertedAt: NOW - 20_000,
              lastRepeatedAlertAt: NOW - 5_000,
              repeatedAlertCount: 1,
              lastAlertPlayback: { status: "finished" },
            },
          },
        },
      },
      { now: NOW },
    );

    expect(result.shouldAlert).toBe(true);
    expect(result.decisionReason).toBe("repeat-due");
    expect(result.metrics).toMatchObject({
      repeatAlertEnabled: true,
      repeatIntervalSeconds: 5,
      repeatMaxCount: 3,
      repeatedAlertCount: 1,
    });
  });

  it("does not schedule another repeat while the saved playback is still in flight", () => {
    const result = analyzeHuntStallReplaySample(
      {
        body: {
          kind: "hunt-stall-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            sampledAt: NOW,
            mode: "manual-experience",
            rawDataUrl: "data:image/png;base64,AA==",
          },
          huntStall: {
            config: {
              enabled: true,
              mode: "manual-experience",
              stallThresholdSeconds: 10,
              repeatAlertEnabled: true,
              repeatAlertIntervalSeconds: 5,
              repeatAlertMaxCount: null,
            },
            state: {
              status: "alerted",
              unchangedSeconds: 20,
              hasObservedExperienceChange: true,
              alertedAt: NOW - 20_000,
              lastRepeatedAlertAt: NOW - 10_000,
              repeatedAlertCount: 1,
              lastAlertPlayback: { status: "started" },
            },
          },
        },
      },
      { now: NOW },
    );

    expect(result.shouldAlert).toBe(false);
    expect(result.decisionReason).toBe("repeat-playback-pending");
  });

  it("flags saved alert requests that are closer together than the repeat interval", () => {
    const result = analyzeHuntStallReplaySample(
      {
        body: {
          kind: "hunt-stall-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            sampledAt: NOW,
            mode: "manual-experience",
            rawDataUrl: "data:image/png;base64,AA==",
            runtimeTrace: [
              { sampledAt: NOW - 2_000, shouldAlert: true },
              { sampledAt: NOW - 1_000, shouldAlert: true },
            ],
          },
          huntStall: {
            config: {
              enabled: true,
              mode: "manual-experience",
              stallThresholdSeconds: 10,
              repeatAlertEnabled: true,
              repeatAlertIntervalSeconds: 5,
              repeatAlertMaxCount: null,
            },
            state: {
              status: "alerted",
              unchangedSeconds: 20,
              hasObservedExperienceChange: true,
              alertedAt: NOW - 20_000,
              lastRepeatedAlertAt: NOW - 1_000,
              repeatedAlertCount: 2,
              lastAlertPlayback: { status: "finished" },
            },
          },
        },
      },
      { now: NOW },
    );

    expect(result.metrics).toMatchObject({
      rapidRepeatDetected: true,
      minimumAlertGapMs: 1_000,
    });
    expect(result.causes[0]).toMatchObject({
      status: "fail",
      title: "반복 간격보다 빠른 알림 요청",
    });
  });
});

describe("analyzeSkillReplaySample", () => {
  it("marks a skill timer at or below the threshold as currently due", () => {
    const result = analyzeSkillReplaySample(
      {
        body: {
          kind: "skill-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            result: { value: 5, confidence: 0.91 },
          },
          skill: {
            id: "skill-1",
            config: {
              id: "skill-1",
              name: "에르다 파운틴",
              enabled: true,
              durationSeconds: 60,
              alertThresholdSeconds: 7,
            },
            currentRegion: REGION,
            state: {
              skillId: "skill-1",
              status: "running",
              observedRemainingSeconds: 5,
              observedAt: NOW,
              estimatedExpiresAt: NOW + 5_000,
              alertedAt: null,
              confidence: 0.91,
            },
          },
        },
      },
      { now: NOW },
    );

    expect(result.supported).toBe(true);
    expect(result.shouldAlert).toBe(true);
    expect(result.decisionReason).toBe("due-now");
    expect(result.metrics).toMatchObject({
      skillName: "에르다 파운틴",
      remainingSeconds: 5,
      alertThresholdSeconds: 7,
    });
  });

  it("does not claim a duplicate skill alert after alertedAt is set", () => {
    const result = analyzeSkillReplaySample(
      {
        body: {
          kind: "skill-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            result: { value: 4, confidence: 0.9 },
          },
          skill: {
            id: "skill-1",
            config: {
              id: "skill-1",
              name: "에르다 파운틴",
              enabled: true,
              durationSeconds: 60,
              alertThresholdSeconds: 7,
            },
            currentRegion: REGION,
            state: {
              skillId: "skill-1",
              status: "alerted",
              observedRemainingSeconds: 4,
              observedAt: NOW,
              estimatedExpiresAt: NOW + 4_000,
              alertedAt: NOW - 1_000,
              confidence: 0.9,
            },
          },
        },
      },
      { now: NOW },
    );

    expect(result.shouldAlert).toBe(false);
    expect(result.decisionReason).toBe("already-alerted");
    expect(result.causes[0]).toMatchObject({
      status: "pass",
      title: "알림 처리 기록 있음",
    });
  });

  it("analyzes skill reports at the latest snapshot time instead of the initial anchor time", () => {
    const result = analyzeSkillReplaySample({
      body: {
        kind: "skill-issue",
        diagnostics: { capture: { hasStream: true } },
        sample: {
          result: { value: 41, confidence: 0.71 },
        },
        skill: {
          id: "skill-1",
          config: {
            id: "skill-1",
            name: "쿨타임 보정 설치기",
            enabled: true,
            countdownSource: "cooldown",
            durationSeconds: 120,
            cooldownDurationSeconds: 90,
            alertThresholdSeconds: 5,
          },
          currentRegion: REGION,
          state: {
            skillId: "skill-1",
            status: "running",
            observedRemainingSeconds: 108,
            observedAt: NOW,
            estimatedExpiresAt: NOW + 108_000,
            alertedAt: null,
            confidence: 0.71,
          },
          lastSnapshot: {
            sampledAt: NOW + 38_000,
          },
        },
      },
    });

    expect(result.shouldAlert).toBe(false);
    expect(result.metrics).toMatchObject({
      remainingSeconds: 70,
      alertInSeconds: 65,
    });
    expect(result.causes[0]).toMatchObject({
      title: "알림 기준 전",
      detail: expect.stringContaining("남은 시간 70초"),
    });
  });

  it("analyzes Sol Janus buff-slot skill reports through the buff-duration evidence", () => {
    const result = analyzeSkillReplaySample(
      {
        body: {
          kind: "skill-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            rawDataUrl: "data:image/png;base64,buff-slot-roi",
            result: { value: null, confidence: 0.89 },
            buffDuration: {
              detected: true,
              boxCount: 18,
              detectedCount: 1,
              displayStatus: "detected",
              displayLastSeenAt: NOW,
              score: 0.92,
              margin: 0.13,
              decisionReason: "matched",
              countdownModelStatus: "ready",
              countdown: {
                text: "41",
                totalSeconds: 41,
                confidence: 0.94,
                status: "high",
              },
              candidateIcons: [
                {
                  name: "솔 야누스: 새벽 후보",
                  boxIndex: 3,
                  imageDataUrl: "data:image/png;base64,icon",
                  match: { matched: true, score: 0.92, threshold: 0.8, margin: 0.13 },
                },
              ],
            },
          },
          skill: {
            id: "skill-janus",
            config: {
              id: "skill-janus",
              name: "솔 야누스 : 새벽",
              presetId: "sol-janus-dawn-2min",
              detectionSource: "buff-duration",
              enabled: true,
              durationSeconds: 120,
              alertThresholdSeconds: 10,
            },
            state: {
              skillId: "skill-janus",
              status: "running",
              observedRemainingSeconds: 41,
              observedAt: NOW,
              estimatedExpiresAt: NOW + 41_000,
              alertedAt: null,
              confidence: 0.89,
            },
            lastSnapshot: { sampledAt: NOW },
          },
        },
      },
      { now: NOW },
    );

    expect(result.engine).toBe("skill-buff-duration");
    expect(result.supported).toBe(true);
    expect(result.shouldAlert).toBe(false);
    expect(result.decisionReason).toBe("scheduled-future");
    expect(result.metrics).toMatchObject({
      presetId: "sol-janus-dawn-2min",
      presetLabel: "솔 야누스: 새벽 (2분)",
      detectionSource: "buff-duration",
      detectionMode: "버프칸",
      targetDisplayName: "솔 야누스: 새벽 (2분)",
      detected: true,
      boxCount: 18,
      candidateCount: 1,
      countdownSeconds: 41,
      remainingSeconds: 41,
    });
  });

  it("surfaces missing target matcher evidence for buff-slot skill reports", () => {
    const result = analyzeSkillReplaySample(
      {
        body: {
          kind: "skill-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            rawDataUrl: "data:image/png;base64,buff-slot-roi",
            result: { value: null, confidence: 0 },
            buffDuration: {
              detected: false,
              boxCount: 18,
              detectedCount: 0,
              displayStatus: "missing",
              matcherEngine: "skill-bundle-v1",
              bundleId: "skill-deep-v2",
              modelVersion: "shared-test-v2",
              baseSkillId: "janus",
              score: 1.2,
              threshold: -0.3,
              margin: 1.5,
              gateScore: 0.92,
              gateThreshold: 0.95,
              gateMargin: -0.03,
              decisionReason: "positive_gate_below_threshold",
              candidateIcons: [
                {
                  boxIndex: 7,
                  imageDataUrl: "data:image/png;base64,candidate",
                  match: {
                    matched: false,
                    matcherEngine: "skill-bundle-v1",
                    bundleId: "skill-deep-v2",
                    modelVersion: "shared-test-v2",
                    baseSkillId: "janus",
                    rawSkillId: "janus",
                    score: 1.2,
                    threshold: -0.3,
                    margin: 1.5,
                    gateScore: 0.92,
                    gateThreshold: 0.95,
                    gateMargin: -0.03,
                    decisionReason: "positive_gate_below_threshold",
                  },
                },
              ],
            },
          },
          skill: {
            id: "skill-janus",
            config: {
              id: "skill-janus",
              name: "솔 야누스 : 새벽",
              presetId: "sol-janus-dawn-2min",
              detectionSource: "buff-duration",
              enabled: true,
              durationSeconds: 120,
              alertThresholdSeconds: 10,
            },
            state: {
              skillId: "skill-janus",
              status: "idle",
              observedRemainingSeconds: null,
              observedAt: null,
              estimatedExpiresAt: null,
              alertedAt: null,
              confidence: 0,
            },
          },
        },
      },
      { now: NOW },
    );

    expect(result.engine).toBe("skill-buff-duration");
    expect(result.decisionReason).toBe("no-target-match");
    expect(result.metrics).toMatchObject({
      matcherEngine: "skill-bundle-v1",
      bundleId: "skill-deep-v2",
      modelVersion: "shared-test-v2",
      baseSkillId: "janus",
      score: 1.2,
      gateScore: 0.92,
      gateThreshold: 0.95,
      gateMargin: -0.03,
      matcherDecision: "positive_gate_below_threshold",
    });
    expect(result.causes[0]).toMatchObject({
      status: "warn",
      title: "솔 야누스: 새벽 (2분) 아이콘 형태 검증 미통과",
      detail: expect.stringContaining("형태 점수 0.920, 기준 0.950"),
    });
  });

  it("keeps buff-slot skill target labels generic for non-Janus skills", () => {
    const result = analyzeSkillReplaySample(
      {
        body: {
          kind: "skill-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            rawDataUrl: "data:image/png;base64,buff-slot-roi",
            result: { value: null, confidence: 0.88 },
            buffDuration: {
              targetSkillId: "hologramGraffitiBarrierVi",
              targetDisplayName: "홀로그램 그래피티: 역장 VI",
              detected: true,
              boxCount: 14,
              detectedCount: 1,
              displayStatus: "detected",
              score: 0.91,
              margin: 0.11,
              decisionReason: "matched",
              countdown: {
                text: "32",
                totalSeconds: 32,
                confidence: 0.9,
                status: "high",
              },
              candidateIcons: [
                {
                  name: "역장 VI 후보",
                  boxIndex: 5,
                  imageDataUrl: "data:image/png;base64,icon",
                  match: { matched: true, score: 0.91, threshold: 0.8, margin: 0.11 },
                },
              ],
            },
          },
          skill: {
            id: "skill-hologram",
            config: {
              id: "skill-hologram",
              name: "홀로그램 그래피티: 역장 VI",
              presetId: "hologram-graffiti-barrier-vi",
              detectionSource: "buff-duration",
              enabled: true,
              durationSeconds: 60,
              alertThresholdSeconds: 5,
            },
            state: {
              skillId: "skill-hologram",
              status: "running",
              observedRemainingSeconds: 32,
              observedAt: NOW,
              estimatedExpiresAt: NOW + 32_000,
              alertedAt: null,
              confidence: 0.88,
            },
          },
        },
      },
      { now: NOW },
    );

    expect(result.engine).toBe("skill-buff-duration");
    expect(result.metrics).toMatchObject({
      presetId: "hologram-graffiti-barrier-vi",
      presetLabel: "홀로그램 그래피티: 역장 VI",
      targetSkillId: "hologramGraffitiBarrierVi",
      targetDisplayName: "홀로그램 그래피티: 역장 VI",
      countdownSeconds: 32,
    });
    expect(result.decisionReason).toBe("scheduled-future");
  });

  it("replays Yein remaining-count flow without treating a quarantined 3 as alertable", () => {
    const result = analyzeSkillReplaySample(
      {
        body: {
          kind: "skill-issue",
          diagnostics: { capture: { hasStream: true } },
          sample: {
            rawDataUrl: "data:image/png;base64,buff-slot-roi",
            result: {
              value: 3,
              confidence: 0.91,
              recognizerVersion: "bottom-right-cooldown-cnn-v1",
            },
            buffDuration: {
              targetSkillId: "maehwaYeinDeepV1",
              targetDisplayName: "매화검 3초식 : 예인 VI",
              detected: true,
              boxCount: 18,
              detectedCount: 1,
              score: 0.99,
              margin: 0.1,
              decisionReason: "target_accepted",
              remainingCountModelStatus: "ready",
              remainingCount: {
                text: "3",
                count: 3,
                format: "remaining-count",
                confidence: 0.91,
              },
              candidateIcons: [
                {
                  name: "예인 후보",
                  imageDataUrl: "data:image/png;base64,icon",
                  match: {
                    matched: true,
                    score: 0.99,
                    threshold: 0.8,
                    margin: 0.19,
                    decisionReason: "target_accepted",
                  },
                  remainingCount: { count: 3, confidence: 0.91 },
                },
              ],
            },
          },
          skill: {
            id: "skill-yein",
            config: {
              id: "skill-yein",
              name: "매화검 3초식 : 예인 VI",
              presetId: "maehwa-yein-vi",
              detectionSource: "buff-duration",
              enabled: true,
              durationSeconds: 60,
              alertThresholdSeconds: 3,
            },
            state: {
              skillId: "skill-yein",
              status: "running",
              observedRemainingCount: 11,
              countObservedAt: NOW - 5_000,
              alertedAt: null,
              confidence: 0.91,
              rejectedReading: 3,
              pendingRemainingCountDrop: {
                observedRemainingCount: 3,
                observedAt: NOW - 2_000,
                lastObservedAt: NOW,
                count: 3,
                fromRemainingCount: 11,
                minReachableCount: 8,
              },
            },
            runtimeTimeline: {
              samples: [
                {
                  sampledAt: NOW,
                  ocrValue: 3,
                  observedRemainingCount: 11,
                  remainingCountDecision: "implausible-drop-held",
                  remainingCountExpectedMin: 6,
                  remainingCountExpectedMax: 11,
                  shouldFireAlert: false,
                },
              ],
              alertEvents: [],
            },
          },
        },
      },
      { now: NOW },
    );

    expect(result.engine).toBe("skill-buff-duration");
    expect(result.shouldAlert).toBe(false);
    expect(result.decisionReason).toBe("implausible-count-drop");
    expect(result.metrics).toMatchObject({
      valueKind: "remaining-count",
      rawRemainingCount: 3,
      confirmedRemainingCount: 11,
      remainingCountFlowDecision: "implausible-drop-held",
      remainingCountExpectedMin: 6,
      remainingCountExpectedMax: 11,
      alertInCount: 8,
    });
    expect(result.causes[0]).toMatchObject({
      status: "warn",
      title: "불가능한 횟수 변화를 보류함",
      detail: expect.stringContaining("원시 판독 3회"),
    });
  });
});
