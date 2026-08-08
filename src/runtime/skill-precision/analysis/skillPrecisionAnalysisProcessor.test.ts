import { describe, expect, it } from "vitest";
import {
  getSkillBuffDurationMatcherBoxIndexes,
  SkillPrecisionAnalysisProcessor,
  toSkillBuffDurationMatch,
} from "./skillPrecisionAnalysisProcessor";
import type { BuffSlotAnalysis } from "../../../recognition/buff-slot/parser/parseBuffSlots";
import type {
  SkillIconCandidate,
  SkillIconMatchResult,
} from "../../../recognition/skill-precision/legacy-prototype/src";
import { SKILL_BUFF_DURATION_TARGETS } from "../../../lib/skillBuffDuration/skillBuffDurationTargets";

describe("SkillPrecisionAnalysisProcessor", () => {
  it("returns an empty detection result for a blank frame", async () => {
    const processor = new SkillPrecisionAnalysisProcessor({
      now: () => performance.now(),
    });
    const response = await processor.process({
      imageData: new ImageData(new Uint8ClampedArray(160 * 90 * 4), 160, 90),
      sampledAt: 10_000,
    });

    expect(response).toMatchObject({
      sampledAt: 10_000,
      boxCount: 0,
      detectedCount: 0,
      detectedIcon: null,
      candidateIcons: [],
      unsupported: false,
      unsupportedReason: null,
    });
    expect(response.performance).toMatchObject({
      countdownCount: 0,
      countdownModelStatus: "idle",
    });
    expect(response.performance.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("uses injected buff slot analysis without reparsing the frame", async () => {
    const processor = new SkillPrecisionAnalysisProcessor({
      now: () => performance.now(),
    });
    const response = await processor.process({
      imageData: null as unknown as ImageData,
      sampledAt: 11_000,
      buffSlotAnalysis: makeEmptyBuffSlotAnalysis(),
    });

    expect(response).toMatchObject({
      sampledAt: 11_000,
      parserEngine: "dl",
      parserVersion: "test-shared-parser",
      parserFallbackReason: "test-fallback",
      boxCount: 0,
      detectedCount: 0,
      detectedIcon: null,
      candidateIcons: [],
    });
    expect(response.performance).toMatchObject({
      detectMs: expect.any(Number),
      boxCount: 0,
      countdownModelStatus: "idle",
    });
  });

  it("limits skill buff matchers to the top row when only two buff rows exist", () => {
    expect(
      getSkillBuffDurationMatcherBoxIndexes([
        makeBox({ x: 300, y: 10 }),
        makeBox({ x: 340, y: 11 }),
        makeBox({ x: 380, y: 12 }),
        makeBox({ x: 310, y: 49 }),
        makeBox({ x: 350, y: 50 }),
        makeBox({ x: 390, y: 51 }),
      ]),
    ).toEqual([0, 1, 2]);
  });

  it("limits skill buff matchers to the top two rows when three or more buff rows exist", () => {
    expect(
      getSkillBuffDurationMatcherBoxIndexes([
        makeBox({ x: 300, y: 10 }),
        makeBox({ x: 340, y: 11 }),
        makeBox({ x: 310, y: 49 }),
        makeBox({ x: 350, y: 50 }),
        makeBox({ x: 320, y: 88 }),
        makeBox({ x: 360, y: 89 }),
        makeBox({ x: 330, y: 127 }),
        makeBox({ x: 370, y: 128 }),
        makeBox({ x: 340, y: 166 }),
        makeBox({ x: 380, y: 167 }),
      ]),
    ).toEqual([0, 1, 2, 3]);
  });

  it("keeps sparse second-row icons eligible when at least three buff rows exist", () => {
    expect(
      getSkillBuffDurationMatcherBoxIndexes([
        makeBox({ x: 420, y: 14 }),
        makeBox({ x: 460, y: 14 }),
        makeBox({ x: 460, y: 52 }),
        makeBox({ x: 220, y: 92 }),
        makeBox({ x: 260, y: 92 }),
        makeBox({ x: 300, y: 92 }),
        makeBox({ x: 340, y: 92 }),
      ]),
    ).toEqual([0, 1, 2]);
  });

  it("matches only the requested target from the aggregate skill matcher", () => {
    expect(
      toSkillBuffDurationMatch(makeSkillIconMatchResult({
        skillId: "hologramGraffitiBarrierVi",
        displayName: "홀로그램 그래피티: 역장VI",
        detectorId: "hologramGraffitiBarrierVi",
      })),
    ).toMatchObject({
      matched: true,
      skillId: "hologramGraffitiBarrierVi",
      displayName: "홀로그램 그래피티: 역장VI",
      detectorId: "hologramGraffitiBarrierVi",
      decisionReason: "matched",
    });

    expect(
      toSkillBuffDurationMatch(
        makeSkillIconMatchResult({
          skillId: "janus",
          displayName: "야누스",
          detectorId: "skill-deep-v2:janus",
        }),
        "hologramGraffitiBarrierVi",
      ),
    ).toMatchObject({
      matched: false,
      skillId: "janus",
      displayName: "야누스",
      detectorId: "skill-deep-v2:janus",
      decisionReason: "other_skill_target",
    });

    expect(
      toSkillBuffDurationMatch(
        makeSkillIconMatchResult({
          skillId: "janus",
          displayName: "야누스",
          detectorId: "skill-deep-v2:janus",
        }),
        {
          skillId: "janusDeepV2",
          matcherEngine: "deep-v2",
          matcherSkillId: "janus",
          detectorId: "skill-deep-v2:janus",
          maxBuffRowIndex: 1,
        },
      ),
    ).toMatchObject({
      matched: true,
      skillId: "janusDeepV2",
      rawSkillId: "janus",
      displayName: "야누스",
      detectorId: "skill-deep-v2:janus",
      decisionReason: "matched",
    });

    expect(
      toSkillBuffDurationMatch(
        makeSkillIconMatchResult({
          skillId: "fountain",
          displayName: "파운틴",
          detectorId: "skill-deep-v2:fountain",
        }),
        {
          skillId: "janusDeepV2",
          matcherEngine: "deep-v2",
          matcherSkillId: "janus",
          detectorId: "skill-deep-v2:janus",
          maxBuffRowIndex: 1,
        },
      ),
    ).toMatchObject({
      matched: false,
      skillId: "fountain",
      rawSkillId: "fountain",
      displayName: "파운틴",
      detectorId: "skill-deep-v2:fountain",
      decisionReason: "other_skill_target",
    });

    expect(
      toSkillBuffDurationMatch(
        makeSkillIconMatchResult({
          skillId: "fountain",
          displayName: "파운틴",
          detectorId: "skill-deep-v2:fountain",
        }),
        {
          skillId: "fountainDeepV2",
          matcherEngine: "deep-v2",
          matcherSkillId: "fountain",
          detectorId: "skill-deep-v2:fountain",
          maxBuffRowIndex: 1,
        },
      ),
    ).toMatchObject({
      matched: true,
      skillId: "fountainDeepV2",
      rawSkillId: "fountain",
      displayName: "파운틴",
      detectorId: "skill-deep-v2:fountain",
      decisionReason: "matched",
    });
  });

  it("routes every current precision target through the contract-v1 bundle runtime", () => {
    expect(SKILL_BUFF_DURATION_TARGETS.map((target) => [
      target.skillId,
      target.matcherEngine,
      target.matcherSkillId,
    ])).toEqual([
      ["janusDeepV2", "skill-bundle-v1", "janus"],
      ["hologramGraffitiBarrierVi", "skill-bundle-v1", "barrier"],
      ["fountainDeepV2", "skill-bundle-v1", "fountain"],
      ["maehwaYeinDeepV1", "skill-bundle-v1", "maehwaYein"],
    ]);
  });

  it("keeps bundle and positive-gate evidence on the target-specific match", () => {
    const result = toSkillBuffDurationMatch(
      makeBundleMatchResult(),
      {
        skillId: "janusDeepV2",
        matcherEngine: "skill-bundle-v1",
        matcherSkillId: "janus",
      },
    );

    expect(result).toMatchObject({
      matched: true,
      skillId: "janusDeepV2",
      rawSkillId: "janus",
      bundleId: "skill-deep-v2",
      modelVersion: "shared-test",
      baseSkillId: "janus",
      gateScore: 0.97,
      gateThreshold: 0.93,
      gateMargin: 0.04,
      decisionReason: "target_accepted",
    });
  });

  it("keeps each target's rejection evidence scoped to its own bundle", () => {
    const match = makeMultiBundleRejectedMatchResult();

    const janus = toSkillBuffDurationMatch(match, {
      skillId: "janusDeepV2",
      matcherEngine: "skill-bundle-v1",
      matcherSkillId: "janus",
    });
    const yein = toSkillBuffDurationMatch(match, {
      skillId: "maehwaYeinDeepV1",
      matcherEngine: "skill-bundle-v1",
      matcherSkillId: "maehwaYein",
    });

    expect(janus).toMatchObject({
      matched: false,
      bundleId: "skill-deep-v2",
      baseSkillId: null,
      decisionReason: "base_below_threshold",
    });
    expect(yein).toMatchObject({
      matched: false,
      bundleId: "skill-maehwa-yein-deep-v1",
      baseSkillId: "maehwaYein",
      rawSkillId: "maehwaYein",
      gateScore: 0.92,
      gateThreshold: 0.95,
      decisionReason: "positive_gate_below_threshold",
    });
  });
});

function makeBox({ x, y, size = 32 }: { x: number; y: number; size?: number }) {
  return {
    x,
    y,
    size,
    confidence: 1,
    score: 1000,
  };
}

function makeEmptyBuffSlotAnalysis(): BuffSlotAnalysis {
  return {
    icons: [],
    boxes: [],
    engine: "dl",
    parserVersion: "test-shared-parser",
    fallbackReason: "test-fallback",
  };
}

function makeSkillIconMatchResult({
  skillId,
  displayName,
  detectorId,
}: {
  skillId: string;
  displayName: string;
  detectorId: string;
}): SkillIconMatchResult {
  const bestMatch: SkillIconCandidate = {
    detectorId,
    skillId,
    slug: skillId,
    displayName,
    label: skillId,
    matched: true,
    score: 0.92,
    threshold: 0.8,
    margin: 0.12,
    minMarginVsHardNegative: 0.05,
    decisionReason: "matched",
    bestPositive: null,
    bestHardNegative: null,
  };
  return {
    kind: "target",
    matched: true,
    skillId,
    slug: skillId,
    displayName,
    label: skillId,
    score: 0.92,
    margin: 0.12,
    decisionReason: "matched",
    bestMatch,
    candidates: [bestMatch],
    elapsedMs: 0.5,
  };
}

function makeBundleMatchResult(): Parameters<typeof toSkillBuffDurationMatch>[0] {
  const bestMatch = {
    bundleId: "skill-deep-v2",
    modelVersion: "shared-test",
    detectorId: "skill-deep-v2:janus",
    skillId: "janus",
    displayName: "야누스",
    label: "janus",
    matched: true,
    score: 1.2,
    threshold: -0.3,
    margin: 1.5,
    gateScore: 0.97,
    gateThreshold: 0.93,
    gateMargin: 0.04,
    decisionReason: "target_accepted",
  };
  return {
    kind: "target",
    matched: true,
    skillId: "janus",
    displayName: "야누스",
    label: "janus",
    score: 1.2,
    margin: 1.5,
    decisionReason: "target_accepted",
    bestMatch,
    candidates: [bestMatch],
    elapsedMs: 10,
    matcherEngine: "skill-bundle-v1",
    bundleId: "skill-deep-v2",
    modelVersion: "shared-test",
    baseSkillId: "janus",
    gateScore: 0.97,
    gateThreshold: 0.93,
    gateMargin: 0.04,
  };
}

function makeMultiBundleRejectedMatchResult(): Parameters<typeof toSkillBuffDurationMatch>[0] {
  const janus = {
    bundleId: "skill-deep-v2",
    modelVersion: "shared-test",
    detectorId: "skill-deep-v2:janus",
    skillId: "janus",
    displayName: "야누스",
    label: "janus",
    matched: false,
    score: -0.8,
    threshold: -0.3,
    margin: -0.5,
    gateScore: null,
    gateThreshold: 0.95,
    gateMargin: null,
    decisionReason: "not_base_target",
  };
  const yein = {
    bundleId: "skill-maehwa-yein-deep-v1",
    modelVersion: "yein-test",
    detectorId: "skill-maehwa-yein-deep-v1",
    skillId: "maehwaYein",
    displayName: "매화검 3초식 : 예인 VI",
    label: "maehwaYein",
    matched: false,
    score: 1.2,
    threshold: -0.3,
    margin: 1.5,
    gateScore: 0.92,
    gateThreshold: 0.95,
    gateMargin: -0.03,
    decisionReason: "positive_gate_below_threshold",
  };
  return {
    kind: "unknown",
    matched: false,
    skillId: null,
    displayName: null,
    label: null,
    score: -1,
    margin: -1,
    decisionReason: "positive_gate_below_threshold",
    bestMatch: null,
    candidates: [janus, yein],
    elapsedMs: 12,
    matcherEngine: "skill-bundle-v1",
    bundleId: null,
    modelVersion: null,
    baseSkillId: null,
    gateScore: null,
    gateThreshold: null,
    gateMargin: null,
    bundleDecisions: [
      {
        bundleId: "skill-deep-v2",
        baseSkillId: null,
        decisionReason: "base_below_threshold",
      },
      {
        bundleId: "skill-maehwa-yein-deep-v1",
        baseSkillId: "maehwaYein",
        decisionReason: "positive_gate_below_threshold",
      },
    ],
  };
}
