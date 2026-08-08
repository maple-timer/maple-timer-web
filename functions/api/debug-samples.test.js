import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDebugSampleLinks,
  buildDebugSampleNotificationContent,
  onRequestGet,
  onRequestPost,
} from "./debug-samples.js";
import {
  getDebugSampleAssets,
  hasRequiredSampleImages,
  metadataFromSample,
  rehydrateDebugSampleAsset,
} from "./_shared/debug-sample-record.js";
import { saveDebugSampleReport } from "./_shared/debug-sample-report-storage.js";
import {
  enforceFalseReportRateLimit,
  sanitizeRateLimitKey,
} from "./_shared/debug-sample-rate-limit.js";
import {
  deliverReportNotification,
  getReportWebhookUrl,
} from "./_shared/debug-sample-webhook.js";
import { buildDebugSampleSlackNotificationPayload } from "./_shared/debug-sample-slack.js";

const STORED_REPORT_ASSET_PLACEHOLDER = "[stored as report asset]";

function redactDataUrlsForTest(value) {
  if (typeof value === "string") {
    return value.startsWith("data:") ? STORED_REPORT_ASSET_PLACEHOLDER : value;
  }
  if (Array.isArray(value)) {
    return value.map(redactDataUrlsForTest);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        redactDataUrlsForTest(nestedValue),
      ]),
    );
  }
  return value;
}

function createDebugSamplesBinding() {
  const store = new Map();
  const metadataStore = new Map();
  return {
    get: vi.fn(async (key, type) => {
      const value = store.get(key) ?? null;
      if (type === "json" && typeof value === "string") {
        return JSON.parse(value);
      }
      return value;
    }),
    put: vi.fn(async (key, value, options = {}) => {
      store.set(key, value);
      if (options.metadata) {
        metadataStore.set(key, options.metadata);
      }
    }),
    list: vi.fn(async ({ prefix = "", limit = 50 } = {}) => ({
      keys: [...store.keys()]
        .filter((key) => key.startsWith(prefix))
        .slice(0, limit)
        .map((key) => ({
          name: key,
          metadata: metadataStore.get(key) ?? null,
        })),
    })),
  };
}

function createDurableDebugSampleBindings({
  id = "sample-1",
  storedSample = null,
  source = "issue",
  assets = [],
} = {}) {
  const queries = [];
  const assetRows = assets.map((asset, index) => ({
    name: asset.name,
    type: asset.type,
    blob_key: asset.blobKey ?? `reports/${id}/asset-${index + 1}`,
  }));
  const objects = new Map(
    assetRows.map((row, index) => [
      row.blob_key,
      {
        ...assets[index],
        type: row.type,
      },
    ]),
  );
  const prepare = vi.fn((sql) => ({
    bind: (...params) => {
      queries.push({ sql, params });
      return {
        first: vi.fn(async () => {
          if (!sql.includes("FROM reports")) {
            throw new Error(`Unexpected D1 first query: ${sql}`);
          }
          if (!storedSample || params[0] !== id) {
            return null;
          }
          return {
            source,
            payload_json: JSON.stringify({ payload: storedSample }),
          };
        }),
        all: vi.fn(async () => {
          if (!sql.includes("FROM report_assets")) {
            throw new Error(`Unexpected D1 all query: ${sql}`);
          }
          return { results: params[0] === id ? assetRows : [] };
        }),
      };
    },
  }));
  const get = vi.fn(async (key) => {
    const asset = objects.get(key);
    if (!asset || asset.missing) {
      return null;
    }
    const bytes = new TextEncoder().encode(asset.contents ?? "");
    return {
      httpMetadata: asset.httpMetadata,
      arrayBuffer: vi.fn(async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      ),
    };
  });

  return {
    env: {
      REPORTS_DB: { prepare },
      REPORT_ASSETS: { get },
    },
    get,
    prepare,
    queries,
  };
}

function createReportStoreBindings() {
  const run = vi.fn(async () => ({}));
  const bind = vi.fn(() => ({ run }));
  const prepare = vi.fn(() => ({ bind }));
  return {
    REPORTS_DB: { prepare },
    REPORT_ASSETS: {
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
  };
}

function createPayload(patch = {}) {
  return {
    kind: "rune-issue",
    clientId: "client-1",
    submittedAt: "2026-05-11T00:00:00.000Z",
    url: "https://maple-timer.com/",
    appBuild: {
      name: "maple-timer",
      version: "0.1.0",
      commitSha: "abc123def456",
      shortCommit: "abc123d",
      branch: "preview",
      deploymentUrl: "https://preview.maple-timer.pages.dev",
      buildTime: "2026-05-20T00:00:00.000Z",
      channel: "preview",
      runtimeOrigin: "https://preview.maple-timer.pages.dev",
      runtimeHostname: "preview.maple-timer.pages.dev",
    },
    reportIssue: {
      reason: "rune-missed",
      label: "룬이 떴는데 감지가 안돼요",
      note: "미니맵에 룬이 있는데 감지를 못했습니다.",
    },
    diagnostics: {
      capture: {
        hasStream: true,
        size: { width: 1920, height: 1080 },
        layoutKey: "1920x1080",
      },
    },
    sample: {
      rawDataUrl: "data:image/png;base64,raw",
      processedDataUrl: "data:image/png;base64,mask",
      regionLabel: "140x80",
      result: {
        value: null,
        confidence: 0.82,
        detected: false,
        candidateCount: 1,
      },
    },
    rune: {
      state: {
        status: "waiting",
      },
    },
    ...patch,
  };
}

function createBuffExpiryIncidentAssetPayload() {
  return {
    kind: "buff-expiry-issue",
    sample: {
      buffExpiryEvidence: {
        schemaVersion: "buff-expiry-incident-evidence-v1",
        frozenAt: 3_000,
        selection: {
          policy: "buff-expiry-scenario-selection-v1",
          status: "matched",
          support: "definitive",
          anchorKind: "episode",
          frameIds: [
            "buff-expiry-frame:epoch:1",
            "buff-expiry-frame:epoch:2",
          ],
          episodeIds: ["buff-expiry-episode:epoch:unionWealth:1"],
          cycleIds: [],
          attemptIds: [],
          eventIds: [],
          mediaFrameIds: [
            "buff-expiry-frame:epoch:1",
            "buff-expiry-frame:epoch:2",
          ],
        },
        frames: [
          {
            id: "buff-expiry-frame:epoch:1",
            sampledAt: 1_000,
            source: "runtime",
          },
          {
            id: "buff-expiry-frame:epoch:2",
            sampledAt: 2_000,
            source: "runtime",
          },
        ],
        episodes: [
          {
            id: "buff-expiry-episode:epoch:unionWealth:1",
            group: "unionWealth",
            observationIds: [],
            transitionIds: [],
            cycleIds: [],
          },
        ],
        media: [
          {
            frameId: "buff-expiry-frame:epoch:1",
            sampledAt: 1_000,
            reason: "confirmation",
            dataUrl: "data:image/jpeg;base64,QUFB",
          },
          {
            frameId: "buff-expiry-frame:epoch:2",
            sampledAt: 2_000,
            reason: "pre-due",
            dataUrl: "data:image/webp;base64,QkJC",
          },
        ],
        omissions: [],
        reportFrame: {
          id: "buff-expiry-report-time:3000",
          source: "report-time",
          sampledAt: 3_000,
        },
      },
    },
    buffExpiry: {
      config: { enabled: true },
      state: { status: "tracking" },
    },
  };
}

function createSkillIncidentAssetPayload() {
  return {
    kind: "skill-issue",
    sample: {
      skillEvidence: {
        schemaVersion: "skill-incident-evidence-v1",
        frozenAt: 3_000,
        selectedSkillId: "skill-a",
        leaseId: "skill-report-lease:skill-a:3000",
        selection: {
          policy: "skill-alert-scenario-selection-v1",
          status: "matched",
          support: "definitive",
          anchorKind: "cycle",
          selectedEventAt: 2_000,
          selectedSkillId: "skill-a",
          frameIds: ["skill-frame:epoch:1", "skill-frame:epoch:2"],
          observationIds: ["skill-observation:1"],
          cycleIds: ["skill-cycle:1"],
          decisionIds: ["skill-decision:1"],
          attemptIds: ["skill-playback:1"],
          mediaIds: ["skill-media:frame:1", "skill-media:frame:2"],
          degradationReasons: [],
        },
        frames: [
          { id: "skill-frame:epoch:1", sampledAt: 1_000, source: "runtime" },
          { id: "skill-frame:epoch:2", sampledAt: 2_000, source: "runtime" },
        ],
        observations: [
          {
            id: "skill-observation:1",
            frameId: "skill-frame:epoch:2",
            recognitionDecision: "accepted",
          },
        ],
        cycles: [{ id: "skill-cycle:1", status: "active" }],
        decisions: [{ id: "skill-decision:1", outcome: "requested" }],
        playbackAttempts: [
          { id: "skill-playback:1", status: "started", startedAt: 2_010 },
        ],
        media: [
          {
            id: "skill-media:frame:1",
            frameId: "skill-frame:epoch:1",
            capturedAt: 1_000,
            reason: "anchor",
            variant: "quickslot-raw",
            dataUrl: "data:image/jpeg;base64,QUFB",
          },
          {
            id: "skill-media:frame:2",
            frameId: "skill-frame:epoch:2",
            capturedAt: 2_000,
            reason: "alert-decision",
            variant: "quickslot-raw",
            dataUrl: "data:image/webp;base64,QkJC",
          },
        ],
        omissions: [],
        budget: {
          mediaCount: 2,
          mediaChars: 62,
          droppedMediaIds: [],
        },
        reportFrame: {
          id: "skill-report-time:3000",
          source: "report-time",
          sampledAt: 3_000,
        },
      },
    },
    skill: {
      id: "skill-a",
      state: { status: "alerted" },
    },
  };
}

function createHuntStallIncidentAssetPayload() {
  return {
    kind: "hunt-stall-issue",
    reportIssue: {
      reason: "hunt-stall-reading",
      label: "읽은 값이 이상해요",
    },
    sample: {
      rawDataUrl: null,
      processedDataUrl: null,
      huntStallEvidence: {
        schemaVersion: "hunt-stall-incident-evidence-v1",
        frozenAt: 3_000,
        selection: {
          policy: "hunt-stall-scenario-selection-v1",
          status: "matched",
          support: "definitive",
          anchorKind: "observation",
          selectedEventAt: 2_000,
          mode: "manual-experience",
          resetEpochId: "hunt-stall-reset:1",
          candidateIds: ["hunt-stall-observation:2"],
          frameIds: [
            "hunt-stall-frame:epoch:1",
            "hunt-stall-frame:epoch:2",
          ],
          observationIds: ["hunt-stall-observation:2"],
          activityEpochIds: ["hunt-stall-activity:1"],
          stallEpisodeIds: ["hunt-stall-episode:1"],
          cycleIds: ["hunt-stall-cycle:1"],
          decisionIds: ["hunt-stall-decision:1"],
          attemptIds: ["hunt-stall-playback:1"],
          eventIds: [],
          configurationRevisionIds: ["hunt-stall-config:1"],
          mediaFrameIds: [
            "hunt-stall-frame:epoch:1",
            "hunt-stall-frame:epoch:2",
          ],
          relatedPlaybackIds: [],
          ambiguous: false,
          operatorConclusion: "playback-failed",
          physicalAudibility: "unknown",
          externalPlayerActivity: "unknown",
          degradationReasons: [],
        },
        configurations: [{ id: "hunt-stall-config:1" }],
        frames: [
          {
            id: "hunt-stall-frame:epoch:1",
            sampledAt: 1_000,
            source: "runtime",
          },
          {
            id: "hunt-stall-frame:epoch:2",
            sampledAt: 2_000,
            source: "runtime",
            mode: "manual-experience",
            region: { x: 100, y: 700, width: 500, height: 40 },
            recognizer: {
              engine: "experience-ocr",
              modelId: "hunt-ocr",
              modelVersion: "hunt-v2",
              workerVersion: "worker-v1",
              provider: "wasm",
            },
          },
        ],
        observations: [
          {
            id: "hunt-stall-observation:2",
            frameId: "hunt-stall-frame:epoch:2",
            sampledAt: 2_000,
            mode: "manual-experience",
            recognition: {
              decision: "accepted",
              reason: null,
              rawText: "100",
              rawValue: 100,
              correctedValue: 100,
              confidence: 0.98,
            },
            transition: {
              kind: "threshold-reached",
              reason: "unchanged-threshold-reached",
              elapsedMs: 10_000,
              thresholdMs: 10_000,
              shouldAlert: true,
            },
          },
        ],
        activityEpochs: [
          {
            id: "hunt-stall-activity:1",
            mode: "manual-experience",
            startedAt: 1_000,
          },
        ],
        stallEpisodes: [
          {
            id: "hunt-stall-episode:1",
            activityEpochId: "hunt-stall-activity:1",
            mode: "manual-experience",
            startedAt: 1_000,
            status: "alerted",
            alertCycleId: "hunt-stall-cycle:1",
            lastEvaluation: {
              evaluatedAt: 2_000,
              elapsedMs: 10_000,
              thresholdMs: 10_000,
              thresholdReached: true,
              outcome: "alert",
              reason: "threshold-reached",
            },
          },
        ],
        alertCycles: [
          {
            id: "hunt-stall-cycle:1",
            stallEpisodeId: "hunt-stall-episode:1",
            mode: "manual-experience",
            startedAt: 2_000,
            initialDecisionId: "hunt-stall-decision:1",
            status: "active",
          },
        ],
        decisions: [
          {
            id: "hunt-stall-decision:1",
            cycleId: "hunt-stall-cycle:1",
            kind: "initial",
            occurredAt: 2_000,
            frameId: "hunt-stall-frame:epoch:2",
            observationId: "hunt-stall-observation:2",
            evaluation: {
              outcome: "alert",
              reason: "threshold-reached",
            },
          },
        ],
        playbackAttempts: [
          {
            id: "hunt-stall-playback:1",
            cycleId: "hunt-stall-cycle:1",
            decisionId: "hunt-stall-decision:1",
            requestedAt: 2_000,
            startedAt: null,
            finishedAt: null,
            failedAt: 2_010,
            status: "failed",
            error: "NotAllowedError",
            effectiveVolume: 0.8,
          },
        ],
        lifecycle: [],
        relatedPlayback: [],
        media: [
          {
            id: "hunt-stall-media:frame:1",
            frameId: "hunt-stall-frame:epoch:1",
            sampledAt: 1_000,
            reason: "activity-anchor",
            rawDataUrl: "data:image/jpeg;base64,QUFB",
            processedDataUrl: "data:image/webp;base64,QkJC",
          },
          {
            id: "hunt-stall-media:frame:2",
            frameId: "hunt-stall-frame:epoch:2",
            sampledAt: 2_000,
            reason: "rejected-observation",
            rawDataUrl: "data:image/png;base64,Q0ND",
            processedDataUrl: null,
          },
        ],
        omissions: [],
        budget: {
          mediaCount: 2,
          mediaChars: 93,
          droppedMediaFrameIds: [],
        },
        reportFrame: null,
      },
    },
    huntStall: {
      config: { enabled: true },
      state: { status: "watching" },
    },
  };
}

function createSpecialCoreIncidentAssetPayload() {
  return {
    kind: "special-core-issue",
    reportIssue: {
      reason: "special-core-missed",
      label: "특수 코어 발동 아이콘을 찾지 못했어요",
    },
    sample: {
      rawDataUrl: null,
      specialCoreEvidence: {
        schemaVersion: "special-core-incident-evidence-v1",
        frozenAt: 3_000,
        selection: {
          policy: "special-core-scenario-selection-v1",
          status: "matched",
          support: "definitive",
          anchorKind: "observation",
          selectedEventAt: 2_000,
          resetEpochId: "special-core-reset:1",
          candidateIds: ["special-core-observation:2"],
          frameIds: ["special-core-frame:1", "special-core-frame:2"],
          observationIds: ["special-core-observation:2"],
          confirmationAttemptIds: [],
          activationIds: [],
          scheduleIds: [],
          decisionIds: [],
          playbackAttemptIds: [],
          eventIds: [],
          configurationRevisionIds: ["special-core-config:1"],
          mediaFrameIds: ["special-core-frame:1", "special-core-frame:2"],
          relatedPlaybackIds: [],
          ambiguous: false,
          operatorConclusion: "recognition-missing",
          physicalAudibility: "unknown",
          degradationReasons: [],
        },
        configurations: [{ id: "special-core-config:1" }],
        frames: [
          { id: "special-core-frame:1", sampledAt: 1_000 },
          { id: "special-core-frame:2", sampledAt: 2_000 },
        ],
        observations: [
          {
            id: "special-core-observation:2",
            frameId: "special-core-frame:2",
            sampledAt: 2_000,
            decision: "rejected",
          },
        ],
        media: [
          {
            id: "special-core-media:frame:1",
            frameId: "special-core-frame:1",
            sampledAt: 1_000,
            reason: "confirmation",
            imageDataUrl: "data:image/jpeg;base64,QUFB",
          },
          {
            id: "special-core-media:frame:2",
            frameId: "special-core-frame:2",
            sampledAt: 2_000,
            reason: "rejected-observation",
            imageDataUrl: "data:image/webp;base64,QkJC",
          },
        ],
        omissions: [],
        budget: {
          mediaCount: 2,
          mediaChars: 62,
          droppedMediaFrameIds: [],
        },
        reportFrame: null,
      },
    },
    specialCore: {
      config: { enabled: true },
      state: { status: "waiting" },
    },
  };
}

function createBoosterExpiryIncidentAssetPayload() {
  return {
    kind: "booster-expiry-issue",
    reportIssue: {
      reason: "booster-expiry-reading",
      label: "남은 시간 판독이 이상해요",
    },
    sample: {
      rawDataUrl: null,
      timerDataUrl: null,
      runtimeTrace: [],
      timerEvidence: [],
      confirmationEvidence: [],
      boosterExpiryEvidence: {
        schemaVersion: "booster-expiry-incident-evidence-v1",
        archiveUpdatedAt: 2_000,
        frozenAt: 3_000,
        leaseId: "booster-expiry-report-lease:1",
        selection: {
          policy: "booster-expiry-scenario-selection-v1",
          status: "matched",
          support: "definitive",
          anchorKind: "observation",
          selectedEventAt: 2_000,
          resetEpochId: "booster-expiry-reset:1",
          configurationRevisionIds: ["booster-expiry-config:1"],
          flowEpochIds: ["booster-expiry-flow:1"],
          frameIds: ["booster-expiry-frame:1", "booster-expiry-frame:2"],
          observationIds: ["booster-expiry-observation:2"],
          candidateAttemptIds: [],
          cycleIds: [],
          scheduleIds: [],
          decisionIds: [],
          playbackAttemptIds: [],
          eventIds: [],
          mediaFrameIds: [
            "booster-expiry-frame:1",
            "booster-expiry-frame:2",
          ],
          relatedPlaybackIds: [],
          ambiguous: false,
          operatorConclusion: "recognition-wrong-value",
          physicalAudibility: "unknown",
          degradationReasons: [],
        },
        frames: [
          {
            id: "booster-expiry-frame:1",
            sampledAt: 1_000,
            mediaFrameId: "booster-expiry-media:frame:1",
          },
          {
            id: "booster-expiry-frame:2",
            sampledAt: 2_000,
            mediaFrameId: "booster-expiry-media:frame:2",
          },
        ],
        observations: [
          {
            id: "booster-expiry-observation:2",
            frameId: "booster-expiry-frame:2",
            sampledAt: 2_000,
            decision: "accepted",
          },
        ],
        media: [
          {
            id: "booster-expiry-media:frame:1",
            frameId: "booster-expiry-frame:1",
            sampledAt: 1_000,
            reason: "cycle-confirmation",
            imageDataUrl: "data:image/jpeg;base64,QUFB",
          },
          {
            id: "booster-expiry-media:frame:2",
            frameId: "booster-expiry-frame:2",
            sampledAt: 2_000,
            reason: "rejected-observation",
            imageDataUrl: "data:image/webp;base64,QkJC",
          },
        ],
        omissions: [],
        budget: {
          mediaCount: 2,
          mediaChars: 62,
          droppedMediaFrameIds: [],
        },
        reportFrame: null,
      },
    },
    boosterExpiry: {
      config: { enabled: true },
      state: { status: "tracking" },
    },
  };
}

function createUltimaRaidEquipmentIncidentAssetPayload() {
  return {
    kind: "ultima-raid-equipment-issue",
    reportIssue: {
      reason: "ultima-raid-equipment-missed",
      label: "가방이 가득 찼는데 알림이 안 울려요",
    },
    sample: {
      result: {
        value: "full",
        detected: true,
        candidateCount: 1,
        confidence: 0.94,
        detectionSource: "bag-number",
        bagCountState: "full",
        detectorVersion: "ultima-raid-inventory-full-v2",
        shouldAlert: true,
      },
      ultimaRaidEquipmentEvidence: {
        schemaVersion: "ultima-raid-equipment-incident-evidence-v1",
        frozenAt: 3_000,
        selection: {
          policy: "ultima-raid-equipment-scenario-selection-v1",
          support: "full",
          occurrence: "recent",
          scenario: "playback-missing",
          selectedEventAt: 2_000,
          selectedFrameId: "ultima-raid-equipment-frame:2",
          frameIds: [
            "ultima-raid-equipment-frame:1",
            "ultima-raid-equipment-frame:2",
          ],
          mediaIds: [
            "ultima-raid-equipment-media:frame:1",
            "ultima-raid-equipment-media:frame:2",
          ],
          playbackAttemptIds: ["ultima-raid-equipment-playback:1"],
          degradationReasons: [],
        },
        frames: [
          {
            id: "ultima-raid-equipment-frame:1",
            sampledAt: 1_000,
            detected: false,
            shouldAlert: false,
          },
          {
            id: "ultima-raid-equipment-frame:2",
            sampledAt: 2_000,
            detected: true,
            bagCountState: "full",
            bagFullDetected: true,
            bagCountRowTopRatio: 0.43,
            bagCountRowHeightRatio: 0.26,
            largestBagWarmClusterXRatio: 0.41,
            largestBagWarmClusterYRatio: 0.52,
            fullBannerDetected: false,
            shouldAlert: true,
          },
        ],
        media: [
          {
            id: "ultima-raid-equipment-media:frame:1",
            frameId: "ultima-raid-equipment-frame:1",
            sampledAt: 1_000,
            reason: "signal-start",
            dataUrl: "data:image/jpeg;base64,QUFB",
          },
          {
            id: "ultima-raid-equipment-media:frame:2",
            frameId: "ultima-raid-equipment-frame:2",
            sampledAt: 2_000,
            reason: "alert",
            dataUrl: "data:image/webp;base64,QkJC",
          },
        ],
        playbackAttempts: [
          {
            id: "ultima-raid-equipment-playback:1",
            frameId: "ultima-raid-equipment-frame:2",
            requestedAt: 2_000,
            startedAt: 2_050,
            finishedAt: 2_200,
            failedAt: null,
            status: "finished",
            error: null,
          },
        ],
        budget: {
          retentionMs: 60_000,
          maxFrames: 72,
          maxMedia: 4,
          mediaChars: 62,
          droppedMediaCount: 0,
        },
      },
    },
    ultimaRaidEquipment: {
      config: { enabled: true },
      state: { status: "alerted" },
      reportReason: "ultima-raid-equipment-missed",
    },
  };
}

describe("debug-samples API notifications", () => {
  it("summarizes Ultima Squad runtime decisions and playback", () => {
    const body = createUltimaRaidEquipmentIncidentAssetPayload();
    const slack = buildDebugSampleSlackNotificationPayload({
      id: "ultima-raid-equipment-incident-slack",
      key: "sample:key",
      metadata: metadataFromSample(
        "ultima-raid-equipment-incident-slack",
        body,
        "2026-07-26T10:00:00.000Z",
      ),
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });
    const slackText = JSON.stringify(slack.attachments[0].blocks);

    expect(slackText).toContain("full · playback-missing");
    expect(slackText).toContain("최근 감지 프레임");
    expect(slackText).toContain("2개");
    expect(slackText).toContain("보관 이미지");
    expect(slackText).toContain("가방 숫자 신호");
    expect(slackText).toContain("*가방 숫자 판독*\\n가득 참");
    expect(slackText).toContain("*숫자 행 위치*\\n43~69%");
    expect(slackText).toContain("*색 영역 위치*\\n가로 41% · 세로 52%");
    expect(slackText).toContain("상단 안내 신호");
    expect(slackText).toContain("알림 요청");
    expect(slackText).toContain("브라우저 재생 종료");
    expect(slackText).toContain("ultima-raid-inventory-full-v2");
  });

  it("summarizes Ultima Squad finite repeat settings and attempts", () => {
    const body = createUltimaRaidEquipmentIncidentAssetPayload();
    body.reportIssue.scenario = "repeat-timing";
    body.ultimaRaidEquipment.config = {
      ...body.ultimaRaidEquipment.config,
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 5,
      repeatAlertMaxCount: 5,
    };
    body.sample.ultimaRaidEquipmentEvidence.selection.scenario =
      "repeat-timing";
    Object.assign(
      body.sample.ultimaRaidEquipmentEvidence.playbackAttempts[0],
      {
        kind: "initial",
        cycleId: 2_000,
        repeatMaxCount: 2,
        repeatIntervalSeconds: 3,
      },
    );
    body.sample.ultimaRaidEquipmentEvidence.playbackAttempts.push({
      id: "ultima-raid-equipment-playback:old-repeat",
      target: "equipment",
      kind: "repeat",
      cycleId: 500,
      repeatIndex: 1,
      repeatMaxCount: 1,
      repeatIntervalSeconds: 2,
      frameId: "ultima-raid-equipment-frame:old",
      requestedAt: 700,
      startedAt: 700,
      finishedAt: 900,
      failedAt: null,
      status: "finished",
      error: null,
    });
    body.sample.ultimaRaidEquipmentEvidence.playbackAttempts.push({
      id: "ultima-raid-equipment-playback:2",
      target: "equipment",
      kind: "repeat",
      cycleId: 2_000,
      repeatIndex: 1,
      repeatMaxCount: 2,
      repeatIntervalSeconds: 3,
      frameId: "ultima-raid-equipment-frame:2",
      requestedAt: 5_200,
      startedAt: null,
      finishedAt: null,
      failedAt: 5_250,
      status: "failed",
      error: "NotAllowedError",
    });

    const slack = buildDebugSampleSlackNotificationPayload({
      id: "ultima-raid-equipment-repeat-slack",
      key: "sample:key",
      metadata: metadataFromSample(
        "ultima-raid-equipment-repeat-slack",
        body,
        "2026-07-27T10:00:00.000Z",
      ),
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });
    const slackText = JSON.stringify(slack.attachments[0].blocks);

    expect(slackText).toContain(
      "*실제 재생*\\n반복 1/2회 · 재생 실패 (NotAllowedError)",
    );
    expect(slackText).toContain("*반복 설정*\\n3초 간격 · 2회");
    expect(slackText).toContain("*반복 재생*\\n0/2회 완료 · 실패 1회");
  });

  it("summarizes a v1 Ultima false alert from its playback-linked alert frame", () => {
    const body = createUltimaRaidEquipmentIncidentAssetPayload();
    body.reportIssue = {
      reason: "ultima-raid-equipment-false-alert",
      label: "가방이 가득 차지 않았는데 알림이 울려요",
    };
    body.sample.result.shouldAlert = false;
    body.sample.ultimaRaidEquipmentEvidence.selection = {
      ...body.sample.ultimaRaidEquipmentEvidence.selection,
      scenario: "wrong-target",
      selectedEventAt: 1_000,
      selectedFrameId: "ultima-raid-equipment-frame:1",
    };
    const slack = buildDebugSampleSlackNotificationPayload({
      id: "ultima-raid-equipment-v1-wrong-target",
      key: "sample:key",
      metadata: metadataFromSample(
        "ultima-raid-equipment-v1-wrong-target",
        body,
        "2026-07-26T10:00:00.000Z",
      ),
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });
    const slackText = JSON.stringify(slack.attachments[0].blocks);

    expect(slackText).toContain("*알림 요청*\\n있음");
    expect(slackText).toContain("*가방 숫자 신호*\\n감지");
    expect(slackText).toContain("*실제 재생*\\n브라우저 재생 종료");
  });

  it("does not summarize an unrelated Ultima playback for a non-alert frame", () => {
    const body = createUltimaRaidEquipmentIncidentAssetPayload();
    body.reportIssue = {
      reason: "ultima-raid-equipment-missed",
      label: "가방이 가득 찼는데 알림이 안 울려요",
    };
    body.sample.ultimaRaidEquipmentEvidence.selection = {
      ...body.sample.ultimaRaidEquipmentEvidence.selection,
      policy: "ultima-raid-equipment-scenario-selection-v2",
      scenario: "recognized-no-alert",
      selectedEventAt: 1_000,
      selectedFrameId: "ultima-raid-equipment-frame:1",
    };
    const slack = buildDebugSampleSlackNotificationPayload({
      id: "ultima-raid-equipment-unrelated-playback",
      key: "sample:key",
      metadata: metadataFromSample(
        "ultima-raid-equipment-unrelated-playback",
        body,
        "2026-07-26T10:00:00.000Z",
      ),
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });
    const slackText = JSON.stringify(slack.attachments[0].blocks);

    expect(slackText).toContain("*알림 요청*\\n없음");
    expect(slackText).toContain("*실제 재생*\\n기록 없음");
  });

  it("summarizes Ultima boss evidence without borrowing equipment playback", () => {
    const body = createUltimaRaidEquipmentIncidentAssetPayload();
    body.kind = "ultima-raid-boss-issue";
    body.reportIssue = {
      reason: "ultima-raid-boss-missed",
      label: "보스가 등장했는데 알림이 안 울려요",
    };
    body.ultimaRaidEquipment.alertTarget = "boss";
    body.ultimaRaidEquipment.config = {
      enabled: true,
      bossAlert: { enabled: true },
    };
    body.ultimaRaidEquipment.state = {
      status: "alerted",
      boss: { status: "active" },
    };
    body.sample.ultimaRaidEquipmentEvidence.schemaVersion =
      "ultima-raid-equipment-incident-evidence-v2";
    body.sample.ultimaRaidEquipmentEvidence.selection = {
      ...body.sample.ultimaRaidEquipmentEvidence.selection,
      policy: "ultima-raid-equipment-scenario-selection-v2",
      target: "boss",
      selectedFrameId: "ultima-raid-equipment-frame:2",
    };
    body.sample.ultimaRaidEquipmentEvidence.frames[0] = {
      ...body.sample.ultimaRaidEquipmentEvidence.frames[0],
      bossProgressState: "normal",
      bossBarDetected: false,
      normalProgressBarDetected: true,
      bossShouldAlert: false,
    };
    body.sample.ultimaRaidEquipmentEvidence.frames[1] = {
      ...body.sample.ultimaRaidEquipmentEvidence.frames[1],
      bossProgressState: "boss",
      bossBarDetected: true,
      normalProgressBarDetected: false,
      bossBarWidthRatio: 0.96,
      bossBarFillRatio: 0.78,
      bossDetectorVersion: "ultima-raid-boss-progress-v1",
      bossShouldAlert: true,
    };
    body.sample.ultimaRaidEquipmentEvidence.playbackAttempts[0].target =
      "equipment";
    body.sample.ultimaRaidEquipmentEvidence.playbackAttempts.push({
      id: "ultima-raid-equipment-playback:boss",
      target: "boss",
      frameId: "ultima-raid-equipment-frame:2",
      requestedAt: 2_000,
      startedAt: null,
      finishedAt: null,
      failedAt: 2_100,
      status: "failed",
      error: "NotAllowedError",
    });

    const slack = buildDebugSampleSlackNotificationPayload({
      id: "ultima-raid-boss-incident-slack",
      key: "sample:key",
      metadata: metadataFromSample(
        "ultima-raid-boss-incident-slack",
        body,
        "2026-07-26T10:00:00.000Z",
      ),
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });
    const slackText = JSON.stringify(slack.attachments[0].blocks);

    expect(slackText).toContain("*하단 진행도*\\nboss");
    expect(slackText).toContain("*보스 진행 바*\\n감지");
    expect(slackText).toContain("*일반 진행 바*\\n감지 없음");
    expect(slackText).toContain("*알림 요청*\\n있음");
    expect(slackText).toContain("*실제 재생*\\n재생 실패 (NotAllowedError)");
    expect(slackText).toContain("ultima-raid-boss-progress-v1");
    expect(slackText).not.toContain("*실제 재생*\\n브라우저 재생 종료");
  });

  it("summarizes the selected buff-expiry incident separately from report-time state", () => {
    const body = createBuffExpiryIncidentAssetPayload();
    const evidence = body.sample.buffExpiryEvidence;
    evidence.selection = {
      ...evidence.selection,
      support: "partial",
      anchorKind: "attempt",
      selectedEventAt: 2_500,
      affectedGroup: "unionWealth",
      ambiguous: false,
      degradationReasons: ["asset-missing"],
    };
    evidence.frames[1] = {
      ...evidence.frames[1],
      parser: {
        engine: "dl",
        version: "incident-parser-v1",
        provider: "wasm",
      },
      recognition: {
        parserBoxCount: 6,
        parsedRowCount: 4,
        localizedBoxCount: 4,
        localizedRowCount: 2,
        spatialExcludedBoxCount: 2,
        localizationStatus: "selected",
        localizationReason: "source-edge-anchor",
        localizationVersion: "buff-slot-cluster-localizer-v1",
        upperExcludedBoxCount: 2,
        eligibleBoxCount: 2,
        matcherObservationCount: 1,
        selectedCandidateCount: 1,
        acceptedTargetCount: 1,
      },
      runtimeFailure: null,
    };
    evidence.observations = [
      {
        id: "observation:1",
        frameId: evidence.frames[1].id,
        episodeId: evidence.episodes[0].id,
        group: "unionWealth",
        targetAccepted: true,
        decisionReason: "target_accepted",
        countdown: { decision: "accepted", seconds: 3 },
      },
    ];
    evidence.episodes[0] = {
      ...evidence.episodes[0],
      status: "confirmed",
      confirmedAt: 2_000,
    };
    evidence.transitions = [
      { id: "transition:1", kind: "confirmed", episodeId: evidence.episodes[0].id },
    ];
    evidence.cycles = [
      { id: "cycle:1", status: "fired", episodeIds: [evidence.episodes[0].id] },
    ];
    evidence.cycleEvents = [
      { id: "cycle-event:1", cycleId: "cycle:1", status: "fired" },
    ];
    evidence.attempts = [
      {
        id: "attempt:1",
        cycleId: "cycle:1",
        requestedAt: 2_500,
        status: "failed",
        error: "NotAllowedError",
      },
    ];
    evidence.omissions = [
      { id: "omission:1", reason: "asset-missing", kind: "asset" },
    ];
    body.sample.next = {
      parser: { boxCount: 0 },
      identity: { targetObservations: [] },
    };
    body.buffExpiry.state.lastAlertPlayback = {
      status: "started",
      requestedAt: 3_000,
      startedAt: 3_000,
    };

    const slack = buildDebugSampleSlackNotificationPayload({
      id: "buff-incident-slack",
      key: "sample:key",
      metadata: metadataFromSample(body),
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });
    const slackText = JSON.stringify(slack.attachments[0].blocks);

    expect(slackText).toContain("최근 사건 일치 · 일부 증거 · 재생 시도 · 유니온의 부");
    expect(slackText).toContain(
      "후보 6칸/4행 · 실제 버프칸 4칸/2행 · 외부 제외 2 · 상단 제외 2 · 통과 2",
    );
    expect(slackText).toContain("재생 실패 (NotAllowedError)");
    expect(slackText).toContain("저장 파일 없음");
    expect(slackText).toContain("CPU (WASM)");
    expect(slackText).toContain("버프칸 0 · 대상 0 · 사건 판정과 별도");
    expect(slackText).not.toContain("브라우저 재생 시작");
  });

  it("summarizes the selected skill incident separately from report-time state", () => {
    const body = createSkillIncidentAssetPayload();
    const evidence = body.sample.skillEvidence;
    body.skill = {
      id: "skill-a",
      config: {
        id: "skill-a",
        name: "솔 야누스 : 새벽",
        presetId: "sol-janus-dawn-deep-v2",
        detectionSource: "buff-duration",
      },
      state: {
        status: "detecting",
        alertedAt: null,
      },
    };
    body.sample.result = { value: 99 };
    body.sample.buffDuration = { boxCount: 0, detected: false };
    evidence.selection = {
      ...evidence.selection,
      support: "partial",
      mode: "precision-countdown",
      targetId: "janus",
      arbitrationIds: ["skill-arbitration:1"],
      configurationRevisionIds: ["skill-config:1"],
      degradationReasons: ["asset-missing"],
      playbackStartEvidence: "browser-play-accepted",
      physicalAudibility: "unknown",
    };
    evidence.frames[1] = {
      ...evidence.frames[1],
      mode: "precision-countdown",
      provider: "wasm",
      recognizerVersion: "center-ocr-v5",
    };
    evidence.observations = [
      {
        id: "skill-observation:1",
        frameId: evidence.frames[1].id,
        sampledAt: 2_000,
        mode: "precision-countdown",
        recognitionDecision: "accepted",
        parser: {
          boxCount: 4,
          rowCount: 2,
          eligibleBoxCount: 2,
          candidateCount: 2,
          decisionReason: "rows-filtered",
        },
        matcher: {
          accepted: true,
          candidateCount: 1,
          decisionReason: "target_accepted",
          bundleId: "skill-deep-v2",
        },
        value: {
          kind: "countdown",
          rawValue: 3,
          text: "3",
          decision: "accepted",
          reason: null,
        },
        flow: {
          confirmedValue: 3,
          expectedMin: 2,
          expectedMax: 4,
          decisionReason: "accepted-decrease",
        },
      },
    ];
    evidence.cycles = [
      {
        id: "skill-cycle:1",
        status: "terminal",
        lastEventAt: 2_000,
        terminalReason: "alert-requested",
      },
    ];
    evidence.decisions = [
      {
        id: "skill-decision:1",
        outcome: "requested",
      },
      {
        id: "skill-decision:2",
        outcome: "suppressed-duplicate-target",
      },
    ];
    evidence.arbitrations = [
      {
        id: "skill-arbitration:1",
        winnerSkillId: "skill-a",
        suppressedSkillIds: ["skill-b"],
      },
    ];
    evidence.playbackAttempts = [
      {
        id: "skill-playback:1",
        requestedAt: 2_000,
        startedAt: 2_010,
        status: "started",
        startedMeaning: "browser-play-accepted",
      },
    ];
    evidence.configurations = [{ id: "skill-config:1" }];
    evidence.omissions = [
      {
        id: "skill-omission:1",
        reason: "asset-missing",
        kind: "asset",
        subjectIds: ["skill-media:frame:2"],
        count: 1,
      },
    ];

    const slack = buildDebugSampleSlackNotificationPayload({
      id: "skill-incident-slack",
      key: "sample:key",
      metadata: metadataFromSample(body),
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });
    const slackText = JSON.stringify(slack.attachments[0].blocks);

    expect(slackText).toContain("최근 사건 일치 · 일부 증거 · 감지 주기 · 정밀 시간");
    expect(slackText).toContain("parser 4칸/2행 · 행 규칙 통과 2 · matcher 대상 일치");
    expect(slackText).toContain("재생 요청 · 중복 대상 억제");
    expect(slackText).toContain("선택 skill-a · 억제 skill-b");
    expect(slackText).toContain("브라우저 play() 수락 · 실제 청취 확인 불가");
    expect(slackText).toContain("저장 파일 없음");
    expect(slackText).toContain("실행: CPU (WASM) · 인식기: center-ocr-v5");
    expect(slackText).toContain("버프칸 0 · 판독 99 · 선택 사건 판정과 별도");
    expect(slackText).not.toContain("최근 알림");
  });

  it("summarizes the selected special-core incident instead of latest legacy state", () => {
    const body = createSpecialCoreIncidentAssetPayload();
    const evidence = body.sample.specialCoreEvidence;
    evidence.selection = {
      ...evidence.selection,
      support: "partial",
      anchorKind: "playback-attempt",
      selectedEventAt: 2_500,
      observationIds: ["special-core-observation:2"],
      confirmationAttemptIds: ["special-core-confirmation:1"],
      activationIds: ["special-core-activation:1"],
      scheduleIds: ["special-core-schedule:1"],
      decisionIds: ["special-core-decision:1"],
      playbackAttemptIds: ["special-core-playback:1"],
      configurationRevisionIds: ["special-core-config:1"],
      operatorConclusion: "playback-failed",
      degradationReasons: ["asset-missing"],
    };
    evidence.frames[1] = {
      ...evidence.frames[1],
      configRevisionId: "special-core-config:1",
      source: { parserInputMode: "topRightQuadrant" },
      parser: {
        engine: "dl",
        version: "incident-parser-v1",
        runtime: { executionProvider: "wasm" },
      },
      parsedBoxes: [{ x: 1, y: 1, size: 20 }],
      eligibleBoxIndexes: [0],
      timings: { totalMs: 22 },
      runtimeFailure: null,
    };
    evidence.observations = [
      {
        id: "special-core-observation:2",
        frameId: "special-core-frame:2",
        sampledAt: 2_000,
        decision: "accepted",
        selectedCandidateBoxIndex: 0,
        candidates: [
          {
            boxIndex: 0,
            match: {
              decisionReason: "target_accepted",
              score: 3.2,
              gateScore: 0.97,
            },
          },
        ],
      },
    ];
    evidence.confirmationAttempts = [
      {
        id: "special-core-confirmation:1",
        status: "confirmed",
        observationIds: ["special-core-observation:1", "special-core-observation:2"],
        lastObservedAt: 2_000,
      },
    ];
    evidence.activations = [
      {
        id: "special-core-activation:1",
        confirmationKind: "new-activation",
        observationIds: ["special-core-observation:1", "special-core-observation:2"],
        confirmedAt: 2_000,
        cooldownEndsAt: 32_000,
        timingConfigRevisionId: "special-core-config:1",
      },
    ];
    evidence.schedules = [
      {
        id: "special-core-schedule:1",
        registeredAt: 2_000,
        alertDueAt: 2_500,
        status: "fired",
      },
    ];
    evidence.decisions = [
      {
        id: "special-core-decision:1",
        occurredAt: 2_500,
        dueAt: 2_500,
        schedulerDelayMs: 0,
        firedConfigRevisionId: "special-core-config:1",
      },
    ];
    evidence.playbackAttempts = [
      {
        id: "special-core-playback:1",
        requestedAt: 2_500,
        status: "failed",
        error: "NotAllowedError",
        configRevisionId: "special-core-config:1",
      },
    ];
    evidence.configurations = [
      {
        id: "special-core-config:1",
        values: {
          cooldownSeconds: 30,
          alertLeadSeconds: 5,
          soundId: "selected-sound",
          effectiveVolume: 0.7,
        },
      },
    ];
    evidence.omissions = [
      {
        id: "special-core-omission:1",
        reason: "asset-missing",
        kind: "asset",
      },
    ];
    body.sample.result = { detected: true, candidateCount: 99 };
    body.specialCore = {
      config: { enabled: true, cooldownSeconds: 999, alertLeadSeconds: 999 },
      state: {
        status: "alerted",
        boxCount: 99,
        lastAlertedAt: 3_000,
        lastAlertPlayback: { status: "finished" },
      },
      timeline: { playbackEvents: [{ status: "finished" }] },
    };

    const slack = buildDebugSampleSlackNotificationPayload({
      id: "special-core-incident-slack",
      key: "sample:key",
      metadata: metadataFromSample(body),
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });
    const slackText = JSON.stringify(slack.attachments[0].blocks);

    expect(slackText).toContain("최근 사건 일치 · 일부 증거 · 재생 시도");
    expect(slackText).toContain("재생 실패");
    expect(slackText).toContain("NotAllowedError");
    expect(slackText).toContain("저장 파일 없음");
    expect(slackText).toContain("실행: CPU (WASM)");
    expect(slackText).toContain("독립 분석 없음 · 선택 사건만 사용");
    expect(slackText).not.toContain("브라우저 재생 종료");
    expect(slackText).not.toContain("999초");
    expect(slackText).not.toContain("최근 알림");
  });

  it("summarizes the selected booster incident instead of latest legacy state", () => {
    const body = createBoosterExpiryIncidentAssetPayload();
    const evidence = body.sample.boosterExpiryEvidence;
    evidence.selection = {
      ...evidence.selection,
      support: "partial",
      anchorKind: "playback-attempt",
      selectedEventAt: 2_500,
      observationIds: ["booster-expiry-observation:2"],
      candidateAttemptIds: ["booster-expiry-candidate:1"],
      cycleIds: ["booster-expiry-cycle:1"],
      scheduleIds: ["booster-expiry-schedule:1"],
      decisionIds: ["booster-expiry-decision:1"],
      playbackAttemptIds: ["booster-expiry-playback:1"],
      configurationRevisionIds: ["booster-expiry-config:1"],
      operatorConclusion: "playback-failed",
      degradationReasons: ["asset-missing"],
    };
    evidence.frames[1] = {
      ...evidence.frames[1],
      configRevisionId: "booster-expiry-config:1",
      source: {
        kind: "capture-top-strip-v1",
        sourceDimensions: { width: 1920, height: 1080 },
        sampledRegion: { width: 1920, height: 216 },
      },
      runtimeFailure: null,
    };
    evidence.observations = [
      {
        id: "booster-expiry-observation:2",
        frameId: "booster-expiry-frame:2",
        sampledAt: 2_000,
        decision: "accepted",
        selectedTime: { text: "0:08", seconds: 8 },
        timerCandidateCount: 1,
        recognizerVersion: "booster-model-v1",
        flow: { locked: true, source: "confirmed", predictedSeconds: 8 },
      },
    ];
    evidence.candidateAttempts = [
      {
        id: "booster-expiry-candidate:1",
        status: "confirmed",
        observationIds: ["booster-expiry-observation:2"],
        lastObservedAt: 2_000,
      },
    ];
    evidence.cycles = [
      {
        id: "booster-expiry-cycle:1",
        status: "active",
        observationIds: ["booster-expiry-observation:2"],
        confirmedAt: 2_000,
        expiresAt: 10_000,
        timingConfigRevisionId: "booster-expiry-config:1",
      },
    ];
    evidence.schedules = [
      {
        id: "booster-expiry-schedule:1",
        registeredAt: 2_000,
        alertDueAt: 2_500,
        status: "fired",
      },
    ];
    evidence.decisions = [
      {
        id: "booster-expiry-decision:1",
        occurredAt: 2_500,
        dueAt: 2_500,
        schedulerDelayMs: 0,
        firedConfigRevisionId: "booster-expiry-config:1",
      },
    ];
    evidence.playbackAttempts = [
      {
        id: "booster-expiry-playback:1",
        requestedAt: 2_500,
        status: "failed",
        error: "NotAllowedError",
        configRevisionId: "booster-expiry-config:1",
        effectiveVolume: 0.7,
      },
    ];
    evidence.configurations = [
      {
        id: "booster-expiry-config:1",
        values: {
          alertLeadSeconds: 5,
          soundId: "selected-sound",
          effectiveVolume: 0.7,
        },
      },
    ];
    evidence.omissions = [
      {
        id: "booster-expiry-omission:1",
        reason: "asset-missing",
        kind: "asset",
      },
    ];
    evidence.relatedPlayback = [];
    body.sample.result = { value: "9:59", detected: true };
    body.boosterExpiry = {
      config: { enabled: true, alertLeadSeconds: 999 },
      state: {
        status: "alerted",
        remainingSeconds: 599,
        lastAlertPlayback: { status: "finished" },
      },
      lastSnapshot: { flowSource: "legacy-latest" },
    };

    const slack = buildDebugSampleSlackNotificationPayload({
      id: "booster-expiry-incident-slack",
      key: "sample:key",
      metadata: metadataFromSample(body),
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });
    const slackText = JSON.stringify(slack.attachments[0].blocks);

    expect(slackText).toContain("최근 사건 일치 · 일부 증거 · 재생 시도");
    expect(slackText).toContain("판독 채택 · 0:08 · 후보 1개 · booster-model-v1");
    expect(slackText).toContain("재생 실패 (NotAllowedError)");
    expect(slackText).toContain("알림 5초 전 · 소리 selected-sound · 볼륨 70%");
    expect(slackText).toContain("저장 파일 없음");
    expect(slackText).toContain("독립 분석 없음 · 선택 사건만 사용");
    expect(slackText).toContain("실제 청취");
    expect(slackText).not.toContain("브라우저 재생 종료");
    expect(slackText).not.toContain("9:59");
    expect(slackText).not.toContain("999초");
    expect(slackText).not.toContain("legacy-latest");
  });

  it("summarizes the selected Hunt Stall incident instead of current legacy state", () => {
    const body = createHuntStallIncidentAssetPayload();
    body.sample.huntStallEvidence.observations.push({
      id: "hunt-stall-observation:distractor",
      frameId: "hunt-stall-frame:distractor",
      sampledAt: 2_999,
      recognition: {
        decision: "accepted",
        rawValue: 999,
        correctedValue: 999,
        confidence: 1,
      },
      transition: { kind: "activity-confirmed", shouldAlert: false },
    });
    body.sample.result = { value: "999", confidence: 0.1 };
    body.huntStall.config = {
      enabled: true,
      mode: "manual-experience",
      stallThresholdSeconds: 10,
    };
    body.huntStall.state = {
      status: "watching",
      recognizedText: "999",
      unchangedSeconds: 1,
      lastAlertPlayback: { status: "finished" },
    };

    const slack = buildDebugSampleSlackNotificationPayload({
      id: "hunt-stall-incident-slack",
      key: "sample:key",
      metadata: metadataFromSample(body),
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });
    const slackText = JSON.stringify(slack.attachments[0].blocks);

    expect(slackText).toContain(
      "최근 사건 일치 · 판단 가능 · 판독 · 재생 실패",
    );
    expect(slackText).toContain("채택 · 값 100 · 신뢰도 98%");
    expect(slackText).toContain("알림 기준 도달 · 10초");
    expect(slackText).toContain("첫 알림 · alert · threshold-reached");
    expect(slackText).toContain("재생 실패 (NotAllowedError)");
    expect(slackText).toContain("독립 분석 없음 · 선택 사건만 사용");
    expect(slackText).toContain("experience-ocr · hunt-v2 · 실행: CPU (WASM)");
    expect(slackText).not.toContain("브라우저 재생 종료");
    expect(slackText).not.toContain("경험치 판독값");
    expect(slackText).not.toContain("값 999");
  });

  it("includes the saved parser provider and timing in notifications", () => {
    const body = createPayload({
      kind: "skill-issue",
      rune: undefined,
      skill: {
        config: {
          name: "솔 야누스 : 새벽",
          detectionSource: "buff-duration",
        },
        state: { status: "running" },
      },
      sample: {
        rawDataUrl: "data:image/png;base64,raw",
        processedDataUrl: null,
        parser: {
          engine: "dl",
          version: "buff-detector-yolov8n-q1-544x960-fp16",
          fallbackReason: null,
          runtime: {
            executionProvider: "remote",
            selectionSource: "user-opt-in",
          },
          performance: {
            detectMs: 300.4,
          },
        },
        result: {
          value: null,
          confidence: 0,
          detected: false,
          candidateCount: 0,
        },
      },
    });

    const notification = buildDebugSampleNotificationContent({
      id: "sample-provider",
      key: "sample:key",
      metadata: metadataFromSample(body),
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });
    const slack = buildDebugSampleSlackNotificationPayload({
      id: "sample-provider",
      key: "sample:key",
      metadata: metadataFromSample(body),
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });

    expect(notification).toContain(
      "runtime parser: dl · buff-detector-yolov8n-q1-544x960-fp16 · 실행: 원격 서버",
    );
    expect(JSON.stringify(slack.attachments[0].blocks)).toContain("실행: 원격 서버");
    expect(JSON.stringify(slack.attachments[0].blocks)).toContain("parser: 300ms");
  });

  it("includes structured precision parser failures in Slack diagnostics", () => {
    const body = createPayload({
      kind: "buff-expiry-issue",
      rune: undefined,
      buffExpiry: {
        config: { enabled: true },
        state: { status: "unavailable" },
      },
      sample: {
        rawDataUrl: "data:image/png;base64,raw",
        processedDataUrl: null,
        parser: {
          engine: null,
          version: null,
          fallbackReason: null,
          failure: {
            reason: "webgpu-unavailable",
            technicalMessage: "navigator.gpu.requestAdapter() returned null",
            diagnostic: {
              stage: "gpu-adapter",
              status: "failed",
              code: "gpu-adapter-unavailable",
              technicalMessage: "navigator.gpu.requestAdapter() returned null",
              details: {},
              occurredAt: 100_000,
            },
          },
        },
        result: {
          value: null,
          confidence: 0,
          detected: false,
          candidateCount: 0,
        },
      },
    });

    const notification = buildDebugSampleNotificationContent({
      id: "sample-parser-failure",
      key: "sample:key",
      metadata: metadataFromSample(body),
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });
    const slack = buildDebugSampleSlackNotificationPayload({
      id: "sample-parser-failure",
      key: "sample:key",
      metadata: metadataFromSample(body),
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });
    const slackText = JSON.stringify(slack.attachments[0].blocks);

    expect(notification).toContain(
      "실패: 그래픽 장치 사용 불가 · 그래픽 장치 연결 · gpu-adapter-unavailable",
    );
    expect(notification).toContain(
      "기술 오류: navigator.gpu.requestAdapter() returned null",
    );
    expect(slackText).toContain("그래픽 장치 연결");
    expect(slackText).toContain("gpu-adapter-unavailable");
  });

  it("includes non-parser runtime analysis failures in notifications and Slack", () => {
    const body = createPayload({
      kind: "hunt-stall-issue",
      rune: undefined,
      huntStall: {
        config: { enabled: true, mode: "manual-experience" },
        state: { status: "unavailable" },
      },
      sample: {
        rawDataUrl: "data:image/png;base64,raw",
        runtimeTrace: [
          {
            sampledAt: 100_000,
            runtimeFailure: {
              stage: "feature-analysis",
              code: "feature-analysis-failed",
              technicalMessage: "worker channel closed",
              occurredAt: 100_000,
            },
          },
        ],
        result: { value: null, confidence: 0 },
      },
    });

    const notification = buildDebugSampleNotificationContent({
      id: "sample-runtime-failure",
      key: "sample:key",
      metadata: metadataFromSample(body),
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });
    const slack = buildDebugSampleSlackNotificationPayload({
      id: "sample-runtime-failure",
      key: "sample:key",
      metadata: metadataFromSample(body),
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });
    const slackText = JSON.stringify(slack.attachments[0].blocks);

    expect(notification).toContain(
      "분석 실행 오류: 기능 분석 · feature-analysis-failed · worker channel closed",
    );
    expect(slackText).toContain("분석 실행 오류");
    expect(slackText).toContain("feature-analysis-failed");
    expect(slackText).toContain("worker channel closed");
  });

  it("includes the rune confirmation policy in Slack diagnostics", () => {
    const body = createPayload({
      sample: {
        rawDataUrl: "data:image/png;base64,raw",
        processedDataUrl: "data:image/png;base64,processed",
        runeEvidence: {
          selection: {
            policy: "rune-scenario-incident-v2",
            status: "matched",
            anchorKind: "episode",
            candidateCount: 2,
            sampleCount: 54,
            ambiguous: true,
            degradationReason: "ambiguous-selection",
          },
          runtimeFrames: [
            { frameId: "frame:1000", rawDataUrl: "data:image/png;base64,runtime" },
          ],
          episodes: [
            {
              episodeId: "rune-episode:3:500",
              alertAttemptIds: ["3:1000:initial", "3:4000:repeat"],
            },
          ],
          alertAttempts: [
            {
              cycleId: "3:1000:initial",
              decision: "initial",
              playbackEvents: [{ status: "finished" }],
            },
            {
              cycleId: "3:4000:repeat",
              decision: "repeat",
              playbackEvents: [{ status: "failed" }],
            },
          ],
          mediaBudget: {
            omittedCapacity: 1,
            omittedOversized: 0,
          },
        },
        result: {
          value: null,
          confidence: 0.8,
          detected: true,
          candidateCount: 1,
        },
      },
      rune: {
        confirmationPolicy: {
          version: "rune-confirmation-v2",
          mode: "all",
          requiredStableFrames: 3,
          requiredStableMilliseconds: 900,
        },
        lastSnapshot: {
          detectionDebug: {
            detectorKind: "onnx-cascade",
            proposalCount: 5,
            selectedProposalRank: 2,
            shapeScore: 0.95,
            shapeThreshold: 0.89,
            shapePass: true,
            appearanceScore: 0.7,
            appearanceThreshold: 0.88,
            appearancePass: false,
          },
        },
        state: {
          status: "candidate",
          detectorVersion: "rune-model-v2",
          stableCount: 2,
          scenePolicyVersion: "rune-scene-v1",
          sceneEpoch: 3,
          consecutiveMissCount: 1,
          lastAlertPlayback: {
            status: "finished",
            requestedAt: 1_000,
            startedAt: 1_025,
            finishedAt: 2_000,
            effectiveVolume: 0.8,
          },
        },
        runtimeIncident: {
          frameCount: 6,
          signalFrameCount: 3,
          lastSignalAt: 1_500,
        },
      },
    });
    const payload = buildDebugSampleSlackNotificationPayload({
      id: "sample-1",
      key: "sample:key",
      metadata: metadataFromSample(body),
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });

    expect(JSON.stringify(payload)).toContain(
      "3회 그리고 900ms (rune-confirmation-v2)",
    );
    expect(JSON.stringify(payload)).toContain("브라우저 재생 종료");
    expect(JSON.stringify(payload)).toContain("80%");
    expect(JSON.stringify(payload)).toContain("3 · rune-scene-v1");
    expect(JSON.stringify(payload)).toContain("6개 · 신호 3개");
    expect(JSON.stringify(payload)).toContain(
      "최근 사건 일치 · 감지 구간 · 사건 후보 2개 · 런타임 샘플 54개 · 여러 사건 중 최신",
    );
    expect(JSON.stringify(payload)).toContain("선택 런타임 원본");
    expect(JSON.stringify(payload)).toContain("선택 구간/알림 시도");
    expect(JSON.stringify(payload)).toContain("1개 / 2개");
    expect(JSON.stringify(payload)).toContain("첫 알림 종료 · 반복 실패");
    expect(JSON.stringify(payload)).toContain(
      "사건: ambiguous-selection · 용량 제한 1개",
    );
    expect(JSON.stringify(payload)).toContain(
      "후보 2/5 · 형태 95%/89% 통과 · 외형 70%/88% 탈락",
    );
  });

  it("labels a retained last Rune trigger after the incident journal expires", () => {
    const body = createPayload({
      sample: {
        rawDataUrl: "data:image/png;base64,raw",
        runeEvidence: {
          selection: {
            policy: "rune-scenario-incident-v2",
            status: "unavailable",
            anchorKind: "attempt",
            candidateCount: 1,
            sampleCount: 0,
            ambiguous: false,
            degradationReason: "journal-expired-trigger-retained",
          },
          runtimeFrames: [
            { frameId: "frame:1000", rawDataUrl: "data:image/png;base64,runtime" },
          ],
          alertAttempts: [
            {
              cycleId: "3:1000:initial",
              decision: "initial",
              playbackEvents: [{ status: "finished" }],
            },
          ],
        },
        result: {
          value: null,
          confidence: 0.8,
          detected: true,
          candidateCount: 1,
        },
      },
    });
    const payload = buildDebugSampleSlackNotificationPayload({
      id: "sample-retained-rune-trigger",
      key: "sample:key",
      metadata: metadataFromSample(body),
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });

    expect(JSON.stringify(payload)).toContain(
      "사건 기록 만료 · 마지막 알림 원본 보관",
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("builds raw sample, viewer, and troubleshooter links from the request origin", () => {
    expect(
      buildDebugSampleLinks("https://preview.maple-timer.pages.dev/api/debug-samples", "sample-1"),
    ).toEqual({
      sampleUrl: "https://preview.maple-timer.pages.dev/api/debug-samples?id=sample-1",
      sampleViewerUrl:
        "https://preview.maple-timer.pages.dev/debug-tools/debug-sample-viewer.html?sample=sample-1",
      troubleshooterUrl:
        "https://preview.maple-timer.pages.dev/debug-tools/timer-report-troubleshooter.html?sample=sample-1",
    });
  });

  it("normalizes debug sample metadata from the active report payload", () => {
    const metadata = metadataFromSample(
      "sample-1",
      createPayload({
        kind: "hunt-stall-issue",
        reportIssue: {
          reason: "hunt-stall-reading",
          label: "경험치 판독이 이상해요",
        },
        rune: undefined,
        huntStall: {
          state: {
            status: "active",
          },
        },
        sample: {
          rawDataUrl: "data:image/png;base64,raw",
          processedDataUrl: "data:image/png;base64,mask",
          regionLabel: "451,797 465x7",
          result: {
            value: "302 [19.062%]",
            confidence: 0.91,
            detected: true,
            candidateCount: 2,
          },
        },
      }),
      "2026-06-10T00:00:00.000Z",
    );

    expect(metadata).toMatchObject({
      id: "sample-1",
      createdAt: "2026-06-10T00:00:00.000Z",
      kind: "hunt-stall-issue",
      regionLabel: "451,797 465x7",
      value: "302 [19.062%]",
      confidence: 0.91,
      detected: true,
      candidateCount: 2,
      status: "active",
      issueReason: "hunt-stall-reading",
      issueLabel: "경험치 판독이 이상해요",
      appBuild: {
        channel: "preview",
        branch: "preview",
        shortCommit: "abc123d",
      },
    });
  });

  it("requires raw and processed sample images except for booster expiry reports", () => {
    expect(hasRequiredSampleImages({ sample: { rawDataUrl: "data:image/png;base64,raw" } })).toBe(false);
    expect(
      hasRequiredSampleImages({
        sample: {
          rawDataUrl: "data:image/png;base64,raw",
          processedDataUrl: "data:image/png;base64,mask",
        },
      }),
    ).toBe(true);
    expect(
      hasRequiredSampleImages({
        kind: "buff-expiry-issue",
        sample: {
          source: {
            dataUrl: "data:image/png;base64,runtime-source",
          },
        },
      }),
    ).toBe(true);
    expect(
      hasRequiredSampleImages({
        kind: "booster-expiry-issue",
        sample: { rawDataUrl: "data:image/png;base64,raw" },
      }),
    ).toBe(true);
    expect(
      hasRequiredSampleImages({
        kind: "skill-issue",
        sample: {
          buffDuration: {
            candidateIcons: [
              {
                imageDataUrl: "data:image/png;base64,buffslot",
              },
            ],
          },
        },
      }),
    ).toBe(true);
    expect(
      hasRequiredSampleImages(createHuntStallIncidentAssetPayload()),
    ).toBe(true);
    expect(
      hasRequiredSampleImages(createSpecialCoreIncidentAssetPayload()),
    ).toBe(true);
    expect(
      hasRequiredSampleImages(createBoosterExpiryIncidentAssetPayload()),
    ).toBe(true);
    expect(
      hasRequiredSampleImages(
        createUltimaRaidEquipmentIncidentAssetPayload(),
      ),
    ).toBe(true);
  });

  it("extracts report assets with stable names and caps precision replay frames", () => {
    const png = "data:image/png;base64,AA==";
    const body = {
      kind: "buff-expiry-issue",
      sample: {
        source: {
          kind: "buff-slot-top-right-quadrant-v1",
          dataUrl: png,
        },
        rawDataUrl: png,
        processedDataUrl: png,
        timerDataUrl: png,
        fullFrameDataUrl: "data:image/jpeg;base64,AA==",
        candidateDataUrl: png,
        runeEvidence: {
          current: {
            candidateDataUrl: png,
          },
          lastAlert: {
            rawDataUrl: png,
            processedDataUrl: png,
            candidateDataUrl: png,
          },
          runtimeIncident: {
            frames: Array.from({ length: 7 }, (_, index) => ({
              rawDataUrl:
                index === 1
                  ? "data:image/jpeg;base64,AA=="
                  : index === 2
                    ? "data:image/webp;base64,AA=="
                    : png,
            })),
          },
          alertTrigger: {
            frames: Array.from({ length: 4 }, (_, index) => ({
              rawDataUrl:
                index === 1
                  ? "data:image/jpeg;base64,AA=="
                  : index === 2
                    ? "data:image/webp;base64,AA=="
                    : png,
            })),
          },
        },
        cropCandidates: [
          {
            rawDataUrl: png,
            processedDataUrl: png,
          },
        ],
        cropHistory: [
          {
            rawDataUrl: "data:image/webp;base64,AA==",
            processedDataUrl: png,
          },
        ],
        timerEvidence: [{ dataUrl: png }],
        confirmationEvidence: [{ dataUrl: "data:image/jpeg;base64,AA==" }],
        buffDuration: {
          candidateIcons: [
            {
              boxIndex: 7,
              imageDataUrl: png,
              match: {
                score: 0.431,
              },
            },
          ],
        },
        specialCore: {
          candidateIcons: [
            {
              boxIndex: 4,
              imageDataUrl: png,
              match: {
                score: 3.812,
              },
            },
          ],
        },
        next: {
          iconEvidence: [{ normalizedIconDataUrl: png }],
          replay: {
            frames: Array.from({ length: 22 }, (_, index) => ({
              reason: index === 0 ? "target seen" : "periodic",
              imageDataUrl:
                index === 1
                  ? "data:image/jpeg;base64,AA=="
                  : index === 2
                    ? "data:image/webp;base64,AA=="
                    : png,
            })),
          },
        },
        lastAlertEvidence: {
          triggeredTracks: [{ normalizedIconDataUrl: png }],
        },
      },
      specialCore: {
        activationEvidence: {
          confirmationIcons: [
            {
              boxIndex: 6,
              imageDataUrl: png,
              match: {
                score: 4.123,
              },
            },
          ],
        },
        recentEvidence: Array.from({ length: 31 }, (_, index) => ({
          source: index === 0 ? "detected" : "top-candidate",
          evidenceIcon: {
            boxIndex: index,
            imageDataUrl: png,
            match: {
              score: 0.5 + index / 100,
            },
          },
        })),
      },
    };
    const assets = getDebugSampleAssets(body);

    expect(assets.map((asset) => asset.name)).toEqual(
      expect.arrayContaining([
        "sample-source-buff-slot-top-right-quadrant-v1.png",
        "sample-raw.png",
        "sample-processed.png",
        "booster-expiry-timer.png",
        "buff-expiry-full-frame.jpg",
        "sample-candidate.png",
        "rune-current-candidate.png",
        "rune-last-alert-raw.png",
        "rune-last-alert-processed.png",
        "rune-last-alert-candidate.png",
        "rune-runtime-incident-01.jpg",
        "rune-runtime-incident-02.webp",
        "rune-runtime-incident-03.png",
        "rune-runtime-incident-04.png",
        "rune-runtime-incident-05.png",
        "rune-runtime-incident-06.png",
        "rune-alert-trigger-01.jpg",
        "rune-alert-trigger-02.webp",
        "rune-alert-trigger-03.png",
        "hunt-stall-candidate-01-raw.png",
        "hunt-stall-candidate-01-processed.png",
        "hunt-stall-history-01-raw.webp",
        "hunt-stall-history-01-processed.png",
        "booster-expiry-timer-01.png",
        "booster-expiry-confirmation-01.jpg",
        "skill-buff-duration-candidate-01-box-07-score-0431.png",
        "special-core-candidate-01-box-04-score-3812.png",
        "buff-expiry-icon-01.png",
        "buff-expiry-alert-01.png",
        "special-core-activation-01-box-06-score-4123.png",
        "special-core-evidence-01-detected-box-00-score-0500.png",
        "special-core-evidence-30-top-candidate-box-29-score-0790.png",
        "buff-expiry-precision-roi-01-target-seen.png",
        "buff-expiry-precision-roi-02-periodic.jpg",
        "buff-expiry-precision-roi-03-periodic.webp",
      ]),
    );
    expect(assets.filter((asset) => asset.name.startsWith("special-core-evidence-"))).toHaveLength(30);
    expect(assets.filter((asset) => asset.name.startsWith("rune-runtime-incident-"))).toHaveLength(6);
    expect(assets.filter((asset) => asset.name.startsWith("rune-alert-trigger-"))).toHaveLength(3);
    expect(assets.some((asset) => asset.name === "special-core-evidence-31-top-candidate-box-30-score-0800.png")).toBe(false);
    expect(assets.filter((asset) => asset.name.startsWith("buff-expiry-precision-roi-"))).toHaveLength(20);
    expect(assets.some((asset) => asset.name === "buff-expiry-precision-roi-21-periodic.png")).toBe(false);

    const storedSample = { body: redactDataUrlsForTest(body) };
    expect(
      assets.map((asset) =>
        rehydrateDebugSampleAsset(storedSample, asset.name, asset.dataUrl),
      ),
    ).toEqual(assets.map(() => true));
  });

  it("extracts each deduplicated rune runtime frame once and rehydrates it", () => {
    const body = {
      kind: "rune-issue",
      sample: {
        runeEvidence: {
          runtimeFrames: [
            {
              frameId: "frame:1000",
              sampledAt: 1_000,
              roles: ["runtime-signal", "alert-trigger"],
              rawDataUrl: "data:image/jpeg;base64,AA==",
            },
            {
              frameId: "frame:2000",
              sampledAt: 2_000,
              roles: ["runtime-after"],
              rawDataUrl: "data:image/webp;base64,AA==",
            },
          ],
          runtimeIncident: {
            frames: [{ frameId: "frame:1000", sampledAt: 1_000 }],
          },
          alertTrigger: {
            frames: [{ frameId: "frame:1000", sampledAt: 1_000 }],
          },
          episodes: [
            {
              episodeId: "rune-episode:2:500",
              frameIds: ["frame:1000"],
              alertAttemptIds: ["2:1000:initial"],
            },
          ],
          alertAttempts: [
            {
              cycleId: "2:1000:initial",
              parentEpisodeId: "rune-episode:2:500",
              frameIds: ["frame:1000"],
              frames: [{ frameId: "frame:1000", sampledAt: 1_000 }],
              playbackEvents: [{ id: "playback-1", status: "finished" }],
            },
          ],
        },
      },
    };

    const assets = getDebugSampleAssets(body);

    expect(assets.map((asset) => asset.name)).toEqual([
      "rune-runtime-frame-01-frame-1000.jpg",
      "rune-runtime-frame-02-frame-2000.webp",
    ]);
    const storedSample = { body: redactDataUrlsForTest(body) };
    expect(
      assets.map((asset) =>
        rehydrateDebugSampleAsset(storedSample, asset.name, asset.dataUrl),
      ),
    ).toEqual([true, true]);
    expect(storedSample.body.sample.runeEvidence.runtimeFrames).toEqual(
      body.sample.runeEvidence.runtimeFrames,
    );
    expect(storedSample.body.sample.runeEvidence.episodes).toEqual(
      body.sample.runeEvidence.episodes,
    );
    expect(storedSample.body.sample.runeEvidence.alertAttempts).toEqual(
      body.sample.runeEvidence.alertAttempts,
    );
  });

  it("extracts Buff Expiry incident media once and rehydrates by stable frame ID", () => {
    const body = createBuffExpiryIncidentAssetPayload();
    const firstAssets = getDebugSampleAssets(body);
    const reorderedBody = structuredClone(body);
    reorderedBody.sample.buffExpiryEvidence.media.reverse();
    const reorderedAssets = getDebugSampleAssets(reorderedBody);

    expect(firstAssets).toHaveLength(2);
    expect(firstAssets.map((asset) => asset.name).sort()).toEqual(
      reorderedAssets.map((asset) => asset.name).sort(),
    );
    expect(firstAssets.map((asset) => asset.name)).toEqual([
      expect.stringMatching(
        /^buff-expiry-incident-frame-buff-expiry-frame-.+-[a-f0-9]{8}\.jpg$/,
      ),
      expect.stringMatching(
        /^buff-expiry-incident-frame-buff-expiry-frame-.+-[a-f0-9]{8}\.webp$/,
      ),
    ]);

    const storedSample = { body: redactDataUrlsForTest(reorderedBody) };
    expect(
      firstAssets.map((asset) =>
        rehydrateDebugSampleAsset(storedSample, asset.name, asset.dataUrl),
      ),
    ).toEqual([true, true]);
    expect(
      Object.fromEntries(
        storedSample.body.sample.buffExpiryEvidence.media.map((entry) => [
          entry.frameId,
          entry.dataUrl,
        ]),
      ),
    ).toEqual({
      "buff-expiry-frame:epoch:2": "data:image/webp;base64,QkJC",
      "buff-expiry-frame:epoch:1": "data:image/jpeg;base64,QUFB",
    });
    expect(storedSample.body.sample.buffExpiryEvidence.selection).toEqual(
      body.sample.buffExpiryEvidence.selection,
    );
  });

  it("extracts Skill incident media once and rehydrates by stable media ID", () => {
    const body = createSkillIncidentAssetPayload();
    const firstAssets = getDebugSampleAssets(body);
    const reorderedBody = structuredClone(body);
    reorderedBody.sample.skillEvidence.media.reverse();
    const reorderedAssets = getDebugSampleAssets(reorderedBody);

    expect(firstAssets).toHaveLength(2);
    expect(firstAssets.map((asset) => asset.name).sort()).toEqual(
      reorderedAssets.map((asset) => asset.name).sort(),
    );
    expect(firstAssets.map((asset) => asset.name)).toEqual([
      expect.stringMatching(
        /^skill-incident-media-skill-media-frame-1-[a-f0-9]{8}\.jpg$/,
      ),
      expect.stringMatching(
        /^skill-incident-media-skill-media-frame-2-[a-f0-9]{8}\.webp$/,
      ),
    ]);

    const storedSample = { body: redactDataUrlsForTest(reorderedBody) };
    expect(
      firstAssets.map((asset) =>
        rehydrateDebugSampleAsset(storedSample, asset.name, asset.dataUrl),
      ),
    ).toEqual([true, true]);
    expect(
      Object.fromEntries(
        storedSample.body.sample.skillEvidence.media.map((entry) => [
          entry.id,
          entry.dataUrl,
        ]),
      ),
    ).toEqual({
      "skill-media:frame:2": "data:image/webp;base64,QkJC",
      "skill-media:frame:1": "data:image/jpeg;base64,QUFB",
    });
    expect(storedSample.body.sample.skillEvidence.selection).toEqual(
      body.sample.skillEvidence.selection,
    );
  });

  it("extracts Hunt Stall incident media variants once and rehydrates by stable media ID", () => {
    const body = createHuntStallIncidentAssetPayload();
    const firstAssets = getDebugSampleAssets(body);
    const duplicateBody = structuredClone(body);
    duplicateBody.sample.huntStallEvidence.media.push(
      structuredClone(duplicateBody.sample.huntStallEvidence.media[0]),
    );
    const reorderedBody = structuredClone(body);
    reorderedBody.sample.huntStallEvidence.media.reverse();
    const reorderedAssets = getDebugSampleAssets(reorderedBody);

    expect(firstAssets).toHaveLength(3);
    expect(getDebugSampleAssets(duplicateBody)).toHaveLength(3);
    expect(firstAssets.map((asset) => asset.name).sort()).toEqual(
      reorderedAssets.map((asset) => asset.name).sort(),
    );
    expect(firstAssets.map((asset) => asset.name)).toEqual([
      expect.stringMatching(
        /^hunt-stall-incident-media-hunt-stall-media-frame-1-[a-f0-9]{8}-raw\.jpg$/,
      ),
      expect.stringMatching(
        /^hunt-stall-incident-media-hunt-stall-media-frame-1-[a-f0-9]{8}-processed\.webp$/,
      ),
      expect.stringMatching(
        /^hunt-stall-incident-media-hunt-stall-media-frame-2-[a-f0-9]{8}-raw\.png$/,
      ),
    ]);

    const storedSample = { body: redactDataUrlsForTest(reorderedBody) };
    expect(
      firstAssets.map((asset) =>
        rehydrateDebugSampleAsset(storedSample, asset.name, asset.dataUrl),
      ),
    ).toEqual([true, true, true]);
    const mediaById = Object.fromEntries(
      storedSample.body.sample.huntStallEvidence.media.map((entry) => [
        entry.id,
        {
          rawDataUrl: entry.rawDataUrl,
          processedDataUrl: entry.processedDataUrl,
        },
      ]),
    );
    expect(mediaById).toEqual({
      "hunt-stall-media:frame:1": {
        rawDataUrl: "data:image/jpeg;base64,QUFB",
        processedDataUrl: "data:image/webp;base64,QkJC",
      },
      "hunt-stall-media:frame:2": {
        rawDataUrl: "data:image/png;base64,Q0ND",
        processedDataUrl: null,
      },
    });
    expect(storedSample.body.sample.huntStallEvidence.selection).toEqual(
      body.sample.huntStallEvidence.selection,
    );
  });

  it("extracts Special Core incident media once and rehydrates by stable media ID", () => {
    const body = createSpecialCoreIncidentAssetPayload();
    const firstAssets = getDebugSampleAssets(body);
    const duplicateBody = structuredClone(body);
    duplicateBody.sample.specialCoreEvidence.media.push(
      structuredClone(duplicateBody.sample.specialCoreEvidence.media[0]),
    );
    const reorderedBody = structuredClone(body);
    reorderedBody.sample.specialCoreEvidence.media.reverse();
    const reorderedAssets = getDebugSampleAssets(reorderedBody);

    expect(firstAssets).toHaveLength(2);
    expect(getDebugSampleAssets(duplicateBody)).toHaveLength(2);
    expect(firstAssets.map((asset) => asset.name).sort()).toEqual(
      reorderedAssets.map((asset) => asset.name).sort(),
    );
    expect(firstAssets.map((asset) => asset.name)).toEqual([
      expect.stringMatching(
        /^special-core-incident-media-special-core-media-frame-1-[a-f0-9]{8}\.jpg$/,
      ),
      expect.stringMatching(
        /^special-core-incident-media-special-core-media-frame-2-[a-f0-9]{8}\.webp$/,
      ),
    ]);

    const storedSample = { body: redactDataUrlsForTest(reorderedBody) };
    expect(
      firstAssets.map((asset) =>
        rehydrateDebugSampleAsset(storedSample, asset.name, asset.dataUrl),
      ),
    ).toEqual([true, true]);
    expect(
      Object.fromEntries(
        storedSample.body.sample.specialCoreEvidence.media.map((entry) => [
          entry.id,
          entry.imageDataUrl,
        ]),
      ),
    ).toEqual({
      "special-core-media:frame:2": "data:image/webp;base64,QkJC",
      "special-core-media:frame:1": "data:image/jpeg;base64,QUFB",
    });
    expect(storedSample.body.sample.specialCoreEvidence.selection).toEqual(
      body.sample.specialCoreEvidence.selection,
    );
  });

  it("extracts Booster Expiry incident media once and rehydrates by stable media ID", () => {
    const body = createBoosterExpiryIncidentAssetPayload();
    const firstAssets = getDebugSampleAssets(body);
    const duplicateBody = structuredClone(body);
    duplicateBody.sample.boosterExpiryEvidence.media.push(
      structuredClone(duplicateBody.sample.boosterExpiryEvidence.media[0]),
    );
    const reorderedBody = structuredClone(body);
    reorderedBody.sample.boosterExpiryEvidence.media.reverse();
    const reorderedAssets = getDebugSampleAssets(reorderedBody);

    expect(firstAssets).toHaveLength(2);
    expect(getDebugSampleAssets(duplicateBody)).toHaveLength(2);
    expect(firstAssets.map((asset) => asset.name).sort()).toEqual(
      reorderedAssets.map((asset) => asset.name).sort(),
    );
    expect(firstAssets.map((asset) => asset.name)).toEqual([
      expect.stringMatching(
        /^booster-expiry-incident-media-booster-expiry-media-frame-1-[a-f0-9]{8}\.jpg$/,
      ),
      expect.stringMatching(
        /^booster-expiry-incident-media-booster-expiry-media-frame-2-[a-f0-9]{8}\.webp$/,
      ),
    ]);

    const storedSample = { body: redactDataUrlsForTest(reorderedBody) };
    expect(
      firstAssets.map((asset) =>
        rehydrateDebugSampleAsset(storedSample, asset.name, asset.dataUrl),
      ),
    ).toEqual([true, true]);
    expect(
      Object.fromEntries(
        storedSample.body.sample.boosterExpiryEvidence.media.map((entry) => [
          entry.id,
          entry.imageDataUrl,
        ]),
      ),
    ).toEqual({
      "booster-expiry-media:frame:2": "data:image/webp;base64,QkJC",
      "booster-expiry-media:frame:1": "data:image/jpeg;base64,QUFB",
    });
    expect(storedSample.body.sample.boosterExpiryEvidence.selection).toEqual(
      body.sample.boosterExpiryEvidence.selection,
    );
  });

  it("extracts Ultima Squad incident media once and rehydrates by stable media ID", () => {
    const body = createUltimaRaidEquipmentIncidentAssetPayload();
    const firstAssets = getDebugSampleAssets(body);
    const duplicateBody = structuredClone(body);
    duplicateBody.sample.ultimaRaidEquipmentEvidence.media.push(
      structuredClone(
        duplicateBody.sample.ultimaRaidEquipmentEvidence.media[0],
      ),
    );
    const reorderedBody = structuredClone(body);
    reorderedBody.sample.ultimaRaidEquipmentEvidence.media.reverse();
    const reorderedAssets = getDebugSampleAssets(reorderedBody);

    expect(firstAssets).toHaveLength(2);
    expect(getDebugSampleAssets(duplicateBody)).toHaveLength(2);
    expect(firstAssets.map((asset) => asset.name).sort()).toEqual(
      reorderedAssets.map((asset) => asset.name).sort(),
    );
    expect(firstAssets.map((asset) => asset.name)).toEqual([
      expect.stringMatching(
        /^ultima-raid-equipment-incident-media-ultima-raid-equipment-media-frame-1-[a-f0-9]{8}\.jpg$/,
      ),
      expect.stringMatching(
        /^ultima-raid-equipment-incident-media-ultima-raid-equipment-media-frame-2-[a-f0-9]{8}\.webp$/,
      ),
    ]);

    const storedSample = { body: redactDataUrlsForTest(reorderedBody) };
    expect(
      firstAssets.map((asset) =>
        rehydrateDebugSampleAsset(storedSample, asset.name, asset.dataUrl),
      ),
    ).toEqual([true, true]);
    expect(
      Object.fromEntries(
        storedSample.body.sample.ultimaRaidEquipmentEvidence.media.map(
          (entry) => [entry.id, entry.dataUrl],
        ),
      ),
    ).toEqual({
      "ultima-raid-equipment-media:frame:2":
        "data:image/webp;base64,QkJC",
      "ultima-raid-equipment-media:frame:1":
        "data:image/jpeg;base64,QUFB",
    });
  });

  it("sanitizes and enforces false report rate-limit keys", async () => {
    expect(sanitizeRateLimitKey("client/with spaces?")).toBe("client-with-spaces-");

    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
    };
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      headers: {
        "CF-Connecting-IP": "127.0.0.1",
      },
    });
    const body = createPayload({
      kind: "rune-issue",
      clientId: "client/with spaces?",
    });
    const now = new Date("2026-06-10T01:23:45.000Z");

    await env.DEBUG_SAMPLES.put("rate:rune-issue:client-with-spaces-:2026-06-10T01", "10");
    const result = await enforceFalseReportRateLimit({ request, env, body, now });

    expect(result).toEqual({
      status: 429,
      body: {
        error: "룬 감지 제보는 브라우저 기준 1시간에 10회까지만 보낼 수 있습니다.",
      },
    });
  });

  it("stores false report rate-limit counters with TTL metadata", async () => {
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
    };
    const request = new Request("https://maple-timer.com/api/debug-samples");
    const body = createPayload({
      kind: "skill-issue",
      clientId: "client-1",
    });
    const now = new Date("2026-06-10T01:23:45.000Z");

    const result = await enforceFalseReportRateLimit({ request, env, body, now });

    expect(result).toBeNull();
    expect(env.DEBUG_SAMPLES.put).toHaveBeenCalledWith(
      "rate:skill-issue:client-1:2026-06-10T01",
      "1",
      {
        expirationTtl: 3720,
        metadata: {
          clientId: "client-1",
          kind: "skill-issue-rate-limit",
          hour: "2026-06-10T01",
        },
      },
    );
  });

  it("prefers the report webhook URL and falls back to the feedback webhook URL", () => {
    expect(
      getReportWebhookUrl({
        REPORT_WEBHOOK_URL: "https://hooks.slack.com/services/report",
        FEEDBACK_WEBHOOK_URL: "https://discord.com/api/webhooks/feedback",
      }),
    ).toBe("https://hooks.slack.com/services/report");
    expect(
      getReportWebhookUrl({
        FEEDBACK_WEBHOOK_URL: "https://discord.com/api/webhooks/feedback",
      }),
    ).toBe("https://discord.com/api/webhooks/feedback");
  });

  it("delivers generic webhook notifications with a text payload", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deliverReportNotification("https://example.com/report", {
      content: "plain report",
    });

    expect(result).toEqual({ skipped: false, channel: "generic" });
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "plain report" }),
    });
  });

  it("keeps debug sample report storage failures non-fatal", async () => {
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = createReportStoreBindings();
    env.REPORTS_DB.prepare = vi.fn(() => {
      throw new Error("db unavailable");
    });
    const result = await saveDebugSampleReport(
      env,
      {
        id: "sample-1",
        key: "sample:key",
        metadata: {
          kind: "rune-issue",
          issueLabel: "룬이 떴는데 감지가 안돼요",
        },
        body: createPayload(),
        storedAt: "2026-06-10T00:00:00.000Z",
      },
    );

    expect(result).toEqual({ skipped: true, error: "storage failed" });
    expect(warnMock).toHaveBeenCalledWith("db unavailable");
  });

  it("builds a Discord-safe notification summary without image data", () => {
    const body = createPayload();
    const content = buildDebugSampleNotificationContent({
      id: "sample-1",
      key: "sample:key",
      metadata: {
        id: "sample-1",
        kind: "rune-issue",
        issueLabel: "룬이 떴는데 감지가 안돼요",
        issueReason: "rune-missed",
        status: "waiting",
        value: null,
        confidence: 0.82,
        candidateCount: 1,
      },
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });

    expect(content).toContain("새 Maple Timer 감지 제보");
    expect(content).toContain("유형: 룬 감지 제보");
    expect(content).toContain("버전: preview preview@abc123d");
    expect(content).toContain("신뢰도: 82%");
    expect(content).toContain(
      "샘플 보기: https://maple-timer.com/debug-tools/debug-sample-viewer.html?sample=sample-1",
    );
    expect(content).toContain("원본 JSON: https://maple-timer.com/api/debug-samples?id=sample-1");
    expect(content).not.toContain("data:image");
  });

  it("notifies the configured webhook after storing an issue report", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      FEEDBACK_WEBHOOK_URL: "https://discord.com/api/webhooks/test/token",
    };
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPayload()),
    });

    const response = await onRequestPost({ request, env });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.notification).toEqual({ skipped: false, channel: "discord" });
    expect(env.DEBUG_SAMPLES.put).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0];
    const webhookPayload = JSON.parse(init.body);
    expect(webhookPayload.content).toContain("룬이 떴는데 감지가 안돼요");
    expect(webhookPayload.content).not.toContain("data:image");
    expect(webhookPayload.allowed_mentions).toEqual({ parse: [] });
  });

  it("sends issue reports to Slack with structured blocks and action links", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      REPORT_WEBHOOK_URL: "https://hooks.slack.com/services/T000/B000/token",
    };
    const request = new Request("https://preview.maple-timer.pages.dev/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload({
          kind: "buff-expiry-issue",
          reportIssue: {
            reason: "buff-expiry-misread",
            label: "버프/시간 감지가 이상해요",
            note: "정밀 감지 Slack 테스트입니다.",
          },
          rune: undefined,
          sample: {
            source: {
              kind: "buff-slot-top-right-quadrant-v1",
              parserInputMode: "topRightQuadrant",
              dataUrl: "data:image/png;base64,roi",
            },
            parser: {
              engine: "rule",
              version: "buff-slot-rule-v1",
              fallbackReason: "dl-init-failed",
            },
            rawDataUrl: null,
            processedDataUrl: "data:image/png;base64,annotated",
            result: {
              value: "유니온의 부",
              confidence: 0.74,
              detected: true,
              candidateCount: 32,
              performance: { totalMs: 197.5 },
            },
            next: {
              parser: {
                boxCount: 32,
                displayBoxCount: 31,
              },
              countdown: {
                recognizedCount: 4,
              },
              replay: {
                frameCount: 6,
              },
            },
          },
          buffExpiry: {
            config: {
              enabled: true,
              alertLeadSeconds: 30,
              selectedBuffIds: [],
              soundId: "default",
              volume: 1,
            },
            state: {
              status: "tracking",
              tracks: [{ id: "track-1" }, { id: "track-2" }],
              pendingTracks: [{ id: "pending-1" }],
              lastAlertPlayback: {
                status: "finished",
                requestedAt: 1_000,
                startedAt: 1_000,
                finishedAt: 2_000,
              },
            },
            summary: {
              moduleVersions: {
                parser: "parser-v1",
                matcher: "buff-group-bundle-v1",
                matcherModel: "buff-group-bundles-20260711",
                matcherBundles: [
                  {
                    group: "potion",
                    bundleId: "buff-group-potion-deep-v1",
                    modelVersion: "potion-20260711-v1",
                  },
                ],
              },
              runtimeStatus: "tracking",
              snapshotDisplayBoxCount: 31,
              targetObservationCount: 5,
              countdownObservationCount: 4,
              trackCount: 2,
              pendingTrackCount: 1,
              recentRoiFrameCount: 6,
              groupSummary: [
                { group: "unionWealth", label: "유니온의 부", targetCount: 1 },
                { group: "potion", label: "비약", targetCount: 2 },
              ],
              lastAlertEvidence: {
                triggeredTrackCount: 1,
              },
            },
            lastSnapshot: {
              displayBoxCount: 31,
              performance: { totalMs: 197.5 },
            },
          },
        }),
      ),
    });

    const response = await onRequestPost({ request, env });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.notification).toEqual({ skipped: false, channel: "slack" });
    const [, init] = fetchMock.mock.calls[0];
    const webhookPayload = JSON.parse(init.body);
    const payloadText = JSON.stringify(webhookPayload);
    expect(webhookPayload.text).toContain("버프 종료 감지 제보");
    expect(webhookPayload.attachments[0]).toMatchObject({
      color: "#f59e0b",
    });
    expect(webhookPayload.attachments[0].blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "새 Maple Timer 감지 제보" },
    });
    expect(payloadText).toContain("정밀 감지");
    expect(payloadText).toContain("유니온의 부 1개");
    expect(payloadText).toContain("parser:parser-v1");
    expect(payloadText).toContain("rule · buff-slot-rule-v1 · fallback: dl-init-failed");
    expect(payloadText).toContain("브라우저 재생 종료");
    expect(payloadText).toContain("potion:buff-group-potion-deep-v1@potion-20260711-v1");
    expect(payloadText).toContain("샘플 조회");
    expect(payloadText).toContain("/debug-tools/debug-sample-viewer.html?sample=");
    expect(payloadText).toContain("원본 JSON");
    expect(payloadText).toContain("트러블슈팅");
    expect(payloadText).not.toContain("data:image");
  });

  it("includes special-core V2 matcher provenance and gate decision in Slack", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      REPORT_WEBHOOK_URL: "https://hooks.slack.com/services/T000/B000/token",
    };
    const request = new Request("https://preview.maple-timer.pages.dev/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload({
          kind: "special-core-issue",
          reportIssue: {
            reason: "special-core-missed",
            label: "특수 코어를 찾지 못해요",
          },
          rune: undefined,
          sample: {
            source: {
              kind: "buff-slot-top-right-quadrant-v1",
              parserInputMode: "topRightQuadrant",
              dataUrl: "data:image/png;base64,roi",
            },
            parser: {
              engine: "dl",
              version: "buff-slot-dl-v2",
              fallbackReason: null,
            },
            rawDataUrl: null,
            processedDataUrl: null,
            result: {
              value: null,
              confidence: null,
              detected: false,
              candidateCount: 1,
              debug: {
                bundleId: "special-core-deep-v2",
                modelVersion: "special-core-20260711-v2",
                decisionReason: "below_positive_gate_threshold",
                bestScore: 1.2,
                bestGateScore: 0.91,
              },
            },
            specialCore: {
              performance: { totalMs: 12.5 },
              candidateIcons: [
                {
                  match: {
                    bundleId: "special-core-deep-v2",
                    modelVersion: "special-core-20260711-v2",
                    decisionReason: "below_positive_gate_threshold",
                    score: 1.2,
                    gateScore: 0.91,
                  },
                },
              ],
            },
          },
          specialCore: {
            config: { enabled: true, cooldownSeconds: 30, alertLeadSeconds: 5 },
            state: {
              status: "alerted",
              boxCount: 18,
              lastAlertedAt: 3_000,
              lastAlertPlayback: {
                status: "finished",
                requestedAt: 2_000,
                startedAt: 2_000,
                finishedAt: 3_000,
              },
            },
            timeline: {
              samples: [],
              playbackEvents: [
                {
                  status: "finished",
                  requestedAt: 2_000,
                  startedAt: 2_000,
                  finishedAt: 3_000,
                  recordedAt: 3_000,
                },
              ],
            },
          },
        }),
      ),
    });

    const response = await onRequestPost({ request, env });
    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    const payloadText = JSON.stringify(JSON.parse(init.body));
    expect(payloadText).toContain("형태 검증 기준 미달");
    expect(payloadText).toContain("special-core-deep-v2");
    expect(payloadText).toContain("special-core-20260711-v2");
    expect(payloadText).toContain("1.2 / 0.91");
    expect(payloadText).toContain("dl · buff-slot-dl-v2");
    expect(payloadText).toContain("브라우저 재생 종료");
    expect(payloadText).not.toContain("0%");
    expect(payloadText).not.toContain("data:image");
  });

  it("includes class install settings in Slack skill issue fields", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      REPORT_WEBHOOK_URL: "https://hooks.slack.com/services/T000/B000/token",
    };
    const request = new Request("https://preview.maple-timer.pages.dev/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload({
          kind: "skill-issue",
          reportIssue: {
            reason: "skill-alert-timing",
            label: "알림이 예정된 시간에 안 울려요",
          },
          rune: undefined,
          skill: {
            config: {
              presetId: "class-install",
              detectionSource: "quickslot",
              countdownSource: "cooldown",
              name: "직업 설치기",
              durationSeconds: 30,
              cooldownDurationSeconds: 120,
              alertThresholdSeconds: 5,
            },
            state: {
              status: "detecting",
              observedRemainingSeconds: null,
              estimatedExpiresAt: null,
              alertedAt: null,
              pendingShortAnchor: null,
              rejectedReading: 19,
            },
          },
          sample: {
            rawDataUrl: "data:image/png;base64,raw",
            processedDataUrl: "data:image/png;base64,mask",
            regionLabel: "70x70",
            result: {
              value: 19,
              confidence: 0.91,
              estimatedRemainingSeconds: null,
              alertInSeconds: null,
            },
          },
        }),
      ),
    });

    const response = await onRequestPost({ request, env });

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    const webhookPayload = JSON.parse(init.body);
    const payloadText = JSON.stringify(webhookPayload);
    expect(payloadText).toContain("감지 방식");
    expect(payloadText).toContain("퀵슬롯");
    expect(payloadText).toContain("스킬 상세");
    expect(payloadText).toContain("직업 설치기");
    expect(payloadText).toContain("스킬 설정");
    expect(payloadText).toContain("설치기 설정");
    expect(payloadText).toContain("퀵슬롯 쿨타임 기준 · 지속 30초 · 쿨 120초");
    expect(payloadText).toContain("추정 남은 시간");
    expect(payloadText).toContain("없음");
  });

  it("includes contract-v1 bundle and matcher decision details in skill issue notifications", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      REPORT_WEBHOOK_URL: "https://hooks.slack.com/services/T000/B000/token",
    };
    const deepV2Payload = createPayload({
      kind: "skill-issue",
      reportIssue: {
        reason: "skill-not-detected",
        label: "감지가 안돼요",
      },
      rune: undefined,
      skill: {
        config: {
          presetId: "sol-janus-dawn-deep-v2",
          detectionSource: "buff-duration",
          countdownSource: "cooldown",
          name: "솔 야누스 : 새벽",
          durationSeconds: 120,
          cooldownDurationSeconds: 56,
          alertThresholdSeconds: 10,
        },
        state: {
          status: "detecting",
          observedRemainingSeconds: null,
          estimatedExpiresAt: null,
          alertedAt: null,
          pendingShortAnchor: null,
        },
      },
      sample: {
        rawDataUrl: "data:image/png;base64,quadrant",
        processedDataUrl: "data:image/png;base64,janus",
        regionLabel: "24개 버프칸",
        result: {
          value: 41,
          confidence: 0.91,
          estimatedRemainingSeconds: 41,
          alertInSeconds: 31,
        },
        buffDuration: {
          detected: true,
          boxCount: 24,
          detectedCount: 1,
          displayStatus: "detected",
          displayLastSeenAt: 20_000,
          matcherEngine: "skill-bundle-v1",
          bundleId: "skill-deep-v2",
          modelVersion: "confirmed-bg-v1-seed20260632-r2-positive-gates-v2",
          score: 4.2,
          margin: 1.1,
          decisionReason: "target_accepted",
          countdown: {
            text: "41",
            totalSeconds: 41,
          },
          candidateIcons: [
            {
              boxIndex: 2,
              box: { x: 1200, y: 36, size: 32 },
              match: {
                matched: true,
                matcherEngine: "skill-bundle-v1",
                bundleId: "skill-deep-v2",
                modelVersion: "confirmed-bg-v1-seed20260632-r2-positive-gates-v2",
                baseSkillId: "janus",
                rawSkillId: "janus",
                skillId: "janusDeepV2",
                displayName: "야누스",
                score: 4.2,
                margin: 1.1,
                gateScore: 0.99,
                gateThreshold: 0.95,
                gateMargin: 0.04,
                decisionReason: "target_accepted",
              },
              imageDataUrl: "data:image/png;base64,icon",
            },
          ],
        },
      },
    });
    const request = new Request("https://preview.maple-timer.pages.dev/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deepV2Payload),
    });

    const response = await onRequestPost({ request, env });

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    const webhookPayload = JSON.parse(init.body);
    const payloadText = JSON.stringify(webhookPayload);
    expect(payloadText).toContain("감지 엔진");
    expect(payloadText).toContain("정밀 스킬 모델");
    expect(payloadText).toContain("skill-deep-v2");
    expect(payloadText).toContain("confirmed-bg-v1-seed20260632-r2-positive-gates-v2");
    expect(payloadText).toContain("matcher 판정");
    expect(payloadText).toContain("대상 일치");

    const textContent = buildDebugSampleNotificationContent({
      id: "sample-1",
      key: "sample:key",
      metadata: {
        id: "sample-1",
        kind: "skill-issue",
        issueLabel: "감지가 안돼요",
        issueReason: "skill-not-detected",
        status: "detecting",
        value: 41,
        confidence: 0.91,
        candidateCount: null,
      },
      body: deepV2Payload,
      requestUrl: "https://preview.maple-timer.pages.dev/api/debug-samples",
    });
    expect(textContent).toContain(
      "감지 엔진: 정밀 스킬 모델 · skill-deep-v2 · confirmed-bg-v1-seed20260632-r2-positive-gates-v2",
    );
    expect(textContent).toContain("matcher 판정: 대상 일치");
  });

  it("includes deep-v2 Erda Fountain skill details in skill issue notifications", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      REPORT_WEBHOOK_URL: "https://hooks.slack.com/services/T000/B000/token",
    };
    const deepV2Payload = createPayload({
      kind: "skill-issue",
      reportIssue: {
        reason: "skill-not-detected",
        label: "감지가 안돼요",
      },
      rune: undefined,
      skill: {
        config: {
          presetId: "erda-fountain-deep-v2",
          detectionSource: "buff-duration",
          countdownSource: "cooldown",
          name: "에르다 파운틴",
          durationSeconds: 60,
          cooldownDurationSeconds: 56,
          alertThresholdSeconds: 10,
        },
        state: {
          status: "detecting",
          observedRemainingSeconds: null,
          estimatedExpiresAt: null,
          alertedAt: null,
          pendingShortAnchor: null,
        },
      },
      sample: {
        rawDataUrl: "data:image/png;base64,quadrant",
        processedDataUrl: "data:image/png;base64,fountain",
        regionLabel: "24개 버프칸",
        result: {
          value: 41,
          confidence: 0.91,
          estimatedRemainingSeconds: 41,
          alertInSeconds: 31,
        },
        buffDuration: {
          detected: true,
          boxCount: 24,
          detectedCount: 1,
          displayStatus: "detected",
          displayLastSeenAt: 20_000,
          score: 4.2,
          margin: 1.1,
          decisionReason: "matched",
          countdown: {
            text: "41",
            totalSeconds: 41,
          },
          candidateIcons: [
            {
              boxIndex: 2,
              box: { x: 1200, y: 36, size: 32 },
              match: {
                matched: true,
                matcherEngine: "deep-v2",
                modelVersion: "confirmed-bg-v1-seed20260632-r2",
                rawSkillId: "fountain",
                skillId: "fountainDeepV2",
                displayName: "파운틴",
                score: 4.2,
                margin: 1.1,
                decisionReason: "matched",
              },
              imageDataUrl: "data:image/png;base64,icon",
            },
          ],
        },
      },
    });
    const request = new Request("https://preview.maple-timer.pages.dev/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deepV2Payload),
    });

    const response = await onRequestPost({ request, env });

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    const webhookPayload = JSON.parse(init.body);
    const payloadText = JSON.stringify(webhookPayload);
    expect(payloadText).toContain("에르다 파운틴 (정밀)");
    expect(payloadText).toContain("감지 엔진");
    expect(payloadText).toContain("deep-v2 정밀 모델");
    expect(payloadText).toContain("confirmed-bg-v1-seed20260632-r2");

    const textContent = buildDebugSampleNotificationContent({
      id: "sample-1",
      key: "sample:key",
      metadata: {
        id: "sample-1",
        kind: "skill-issue",
        issueLabel: "감지가 안돼요",
        issueReason: "skill-not-detected",
        status: "detecting",
        value: 41,
        confidence: 0.91,
        candidateCount: null,
      },
      body: deepV2Payload,
      requestUrl: "https://preview.maple-timer.pages.dev/api/debug-samples",
    });
    expect(textContent).toContain("스킬: 에르다 파운틴");
    expect(textContent).toContain("스킬 상세: 에르다 파운틴 (정밀)");
    expect(textContent).toContain("감지 엔진: deep-v2 정밀 모델 · confirmed-bg-v1-seed20260632-r2");
  });

  it("falls back to an exact D1 lookup when the KV sample is outside the 50-key window", async () => {
    const DEBUG_SAMPLES = createDebugSamplesBinding();
    for (let index = 0; index < 50; index += 1) {
      const decoyId = `decoy-${String(index).padStart(2, "0")}`;
      await DEBUG_SAMPLES.put(
        `sample:${String(index).padStart(4, "0")}:${decoyId}`,
        JSON.stringify({ id: decoyId, body: { kind: "rune-issue" } }),
        { metadata: { id: decoyId } },
      );
    }
    await DEBUG_SAMPLES.put(
      "sample:9999:sample-51",
      JSON.stringify({ id: "sample-51", body: { source: "kv-outside-window" } }),
      { metadata: { id: "sample-51" } },
    );
    const storedSample = {
      id: "sample-51",
      key: "sample:9999:sample-51",
      storedAt: "2026-07-01T00:00:00.000Z",
      body: { kind: "rune-issue", source: "durable-report" },
    };
    const durable = createDurableDebugSampleBindings({ id: "sample-51", storedSample });
    const request = new Request("https://maple-timer.com/api/debug-samples?id=sample-51");

    const response = await onRequestGet({
      request,
      env: { DEBUG_SAMPLES, ...durable.env },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(storedSample);
    expect(DEBUG_SAMPLES.list).toHaveBeenCalledWith({ prefix: "sample:", limit: 50 });
    expect(durable.queries[0]).toEqual(
      expect.objectContaining({
        params: ["sample-51"],
      }),
    );
    expect(durable.queries[0].sql).toContain("WHERE id = ?");
  });

  it("falls back to D1 after the seven-day KV copy has expired", async () => {
    const storedSample = {
      id: "expired-sample",
      key: "sample:0001:expired-sample",
      storedAt: "2026-06-01T00:00:00.000Z",
      body: { kind: "buff-expiry-issue", source: "durable-report" },
    };
    const durable = createDurableDebugSampleBindings({
      id: "expired-sample",
      storedSample,
    });
    const request = new Request(
      "https://maple-timer.com/api/debug-samples?id=expired-sample",
    );

    const response = await onRequestGet({
      request,
      env: { DEBUG_SAMPLES: createDebugSamplesBinding(), ...durable.env },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(storedSample);
  });

  it("rehydrates D1 payload placeholders from their named R2 assets", async () => {
    const storedSample = {
      id: "sample-with-assets",
      key: "sample:0001:sample-with-assets",
      storedAt: "2026-06-01T00:00:00.000Z",
      body: {
        kind: "skill-issue",
        sample: {
          source: {
            kind: "buff-slot-top-right-quadrant-v1",
            dataUrl: STORED_REPORT_ASSET_PLACEHOLDER,
          },
          rawDataUrl: STORED_REPORT_ASSET_PLACEHOLDER,
          processedDataUrl: STORED_REPORT_ASSET_PLACEHOLDER,
          buffDuration: {
            candidateIcons: [
              {
                boxIndex: 7,
                match: { score: 0.431 },
                imageDataUrl: STORED_REPORT_ASSET_PLACEHOLDER,
              },
            ],
          },
        },
      },
    };
    const durable = createDurableDebugSampleBindings({
      id: storedSample.id,
      storedSample,
      assets: [
        {
          name: "skill-buff-duration-candidate-01-box-07-score-0431.png",
          type: "image/png",
          contents: "candidate-bytes",
        },
        {
          name: "sample-processed.png",
          type: "image/png",
          contents: "processed-bytes",
        },
        {
          name: "sample-source-buff-slot-top-right-quadrant-v1.webp",
          type: "image/webp",
          contents: "source-bytes",
        },
        {
          name: "sample-raw.png",
          type: "image/png",
          contents: "raw-bytes",
        },
      ],
    });
    const request = new Request(
      "https://maple-timer.com/api/debug-samples?id=sample-with-assets",
    );

    const response = await onRequestGet({
      request,
      env: { DEBUG_SAMPLES: createDebugSamplesBinding(), ...durable.env },
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      id: "sample-with-assets",
      key: "sample:0001:sample-with-assets",
      body: {
        sample: {
          source: { dataUrl: "data:image/webp;base64,c291cmNlLWJ5dGVz" },
          rawDataUrl: "data:image/png;base64,cmF3LWJ5dGVz",
          processedDataUrl: "data:image/png;base64,cHJvY2Vzc2VkLWJ5dGVz",
          buffDuration: {
            candidateIcons: [
              { imageDataUrl: "data:image/png;base64,Y2FuZGlkYXRlLWJ5dGVz" },
            ],
          },
        },
      },
    });
    expect(JSON.stringify(data)).not.toContain(STORED_REPORT_ASSET_PLACEHOLDER);
    expect(durable.get).toHaveBeenCalledTimes(4);
  });

  it("rehydrates deduplicated rune incident frames from R2 after KV expiry", async () => {
    const storedSample = {
      id: "rune-durable-sample",
      key: "sample:0001:rune-durable-sample",
      storedAt: "2026-07-19T00:00:00.000Z",
      body: {
        kind: "rune-issue",
        sample: {
          runeEvidence: {
            selection: {
              policy: "rune-scenario-incident-v1",
              status: "matched",
              anchorKind: "episode",
              frameIds: ["frame:1000", "frame:2000"],
              episodeIds: ["rune-episode:2:500"],
              cycleIds: ["2:2000:initial"],
            },
            runtimeFrames: [
              {
                frameId: "frame:1000",
                sampledAt: 1_000,
                roles: ["runtime-signal"],
                rawDataUrl: STORED_REPORT_ASSET_PLACEHOLDER,
              },
              {
                frameId: "frame:2000",
                sampledAt: 2_000,
                roles: ["alert-trigger", "runtime-signal"],
                rawDataUrl: STORED_REPORT_ASSET_PLACEHOLDER,
              },
            ],
            runtimeIncident: {
              id: "2:500",
              frames: [
                { frameId: "frame:1000", sampledAt: 1_000 },
                { frameId: "frame:2000", sampledAt: 2_000 },
              ],
            },
            alertTrigger: {
              cycleId: "2:2000:initial",
              frames: [{ frameId: "frame:2000", sampledAt: 2_000 }],
            },
            episodes: [
              {
                episodeId: "rune-episode:2:500",
                frameIds: ["frame:1000", "frame:2000"],
                alertAttemptIds: ["2:2000:initial"],
              },
            ],
            alertAttempts: [
              {
                cycleId: "2:2000:initial",
                parentEpisodeId: "rune-episode:2:500",
                frameIds: ["frame:2000"],
                frames: [{ frameId: "frame:2000", sampledAt: 2_000 }],
                playbackEvents: [{ id: "playback-1", status: "finished" }],
              },
            ],
          },
        },
      },
    };
    const durable = createDurableDebugSampleBindings({
      id: storedSample.id,
      storedSample,
      assets: [
        {
          name: "rune-runtime-frame-01-frame-1000.png",
          type: "image/png",
          contents: "rune-frame-one",
        },
        {
          name: "rune-runtime-frame-02-frame-2000.webp",
          type: "image/webp",
          contents: "rune-frame-two",
        },
      ],
    });
    const response = await onRequestGet({
      request: new Request(
        "https://maple-timer.com/api/debug-samples?id=rune-durable-sample",
      ),
      env: { DEBUG_SAMPLES: createDebugSamplesBinding(), ...durable.env },
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.body.sample.runeEvidence.runtimeFrames).toEqual([
      expect.objectContaining({
        frameId: "frame:1000",
        rawDataUrl: "data:image/png;base64,cnVuZS1mcmFtZS1vbmU=",
      }),
      expect.objectContaining({
        frameId: "frame:2000",
        rawDataUrl: "data:image/webp;base64,cnVuZS1mcmFtZS10d28=",
      }),
    ]);
    expect(data.body.sample.runeEvidence.episodes).toEqual(
      storedSample.body.sample.runeEvidence.episodes,
    );
    expect(data.body.sample.runeEvidence.alertAttempts).toEqual(
      storedSample.body.sample.runeEvidence.alertAttempts,
    );
    expect(data.body.sample.runeEvidence.runtimeIncident.frames).toEqual([
      { frameId: "frame:1000", sampledAt: 1_000 },
      { frameId: "frame:2000", sampledAt: 2_000 },
    ]);
    expect(JSON.stringify(data)).not.toContain(STORED_REPORT_ASSET_PLACEHOLDER);
    expect(durable.get).toHaveBeenCalledTimes(2);
  });

  it("rehydrates Buff Expiry incident media from R2 after KV expiry by frame ID", async () => {
    const body = createBuffExpiryIncidentAssetPayload();
    const assets = getDebugSampleAssets(body);
    const storedSample = {
      id: "buff-expiry-durable-sample",
      key: "sample:0001:buff-expiry-durable-sample",
      storedAt: "2026-07-19T00:00:00.000Z",
      body: redactDataUrlsForTest(body),
    };
    storedSample.body.sample.buffExpiryEvidence.media.reverse();
    const durable = createDurableDebugSampleBindings({
      id: storedSample.id,
      storedSample,
      assets: [
        {
          name: assets[1].name,
          type: assets[1].type,
          contents: "buff-frame-two",
        },
        {
          name: assets[0].name,
          type: assets[0].type,
          contents: "buff-frame-one",
        },
      ],
    });
    const response = await onRequestGet({
      request: new Request(
        "https://maple-timer.com/api/debug-samples?id=buff-expiry-durable-sample",
      ),
      env: { DEBUG_SAMPLES: createDebugSamplesBinding(), ...durable.env },
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(
      Object.fromEntries(
        data.body.sample.buffExpiryEvidence.media.map((entry) => [
          entry.frameId,
          entry.dataUrl,
        ]),
      ),
    ).toEqual({
      "buff-expiry-frame:epoch:2":
        "data:image/webp;base64,YnVmZi1mcmFtZS10d28=",
      "buff-expiry-frame:epoch:1":
        "data:image/jpeg;base64,YnVmZi1mcmFtZS1vbmU=",
    });
    expect(data.body.sample.buffExpiryEvidence.selection).toEqual(
      body.sample.buffExpiryEvidence.selection,
    );
    expect(data.body.sample.buffExpiryEvidence.frames).toEqual(
      body.sample.buffExpiryEvidence.frames,
    );
    expect(JSON.stringify(data)).not.toContain(STORED_REPORT_ASSET_PLACEHOLDER);
    expect(durable.get).toHaveBeenCalledTimes(2);
  });

  it("rehydrates Skill incident media from R2 after KV expiry by media ID", async () => {
    const body = createSkillIncidentAssetPayload();
    const assets = getDebugSampleAssets(body);
    const storedSample = {
      id: "skill-durable-sample",
      key: "sample:0001:skill-durable-sample",
      storedAt: "2026-07-19T00:00:00.000Z",
      body: redactDataUrlsForTest(body),
    };
    storedSample.body.sample.skillEvidence.media.reverse();
    const durable = createDurableDebugSampleBindings({
      id: storedSample.id,
      storedSample,
      assets: [
        {
          name: assets[1].name,
          type: assets[1].type,
          contents: "skill-frame-two",
        },
        {
          name: assets[0].name,
          type: assets[0].type,
          contents: "skill-frame-one",
        },
      ],
    });
    const response = await onRequestGet({
      request: new Request(
        "https://maple-timer.com/api/debug-samples?id=skill-durable-sample",
      ),
      env: { DEBUG_SAMPLES: createDebugSamplesBinding(), ...durable.env },
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(
      Object.fromEntries(
        data.body.sample.skillEvidence.media.map((entry) => [
          entry.id,
          entry.dataUrl,
        ]),
      ),
    ).toEqual({
      "skill-media:frame:2":
        "data:image/webp;base64,c2tpbGwtZnJhbWUtdHdv",
      "skill-media:frame:1":
        "data:image/jpeg;base64,c2tpbGwtZnJhbWUtb25l",
    });
    expect(data.body.sample.skillEvidence.selection).toEqual(
      body.sample.skillEvidence.selection,
    );
    expect(data.body.sample.skillEvidence.frames).toEqual(
      body.sample.skillEvidence.frames,
    );
    expect(data.body.sample.skillEvidence.playbackAttempts).toEqual(
      body.sample.skillEvidence.playbackAttempts,
    );
    expect(JSON.stringify(data)).not.toContain(STORED_REPORT_ASSET_PLACEHOLDER);
    expect(durable.get).toHaveBeenCalledTimes(2);
  });

  it("rehydrates Hunt Stall incident media variants from R2 after KV expiry by media ID", async () => {
    const body = createHuntStallIncidentAssetPayload();
    const assets = getDebugSampleAssets(body);
    const storedSample = {
      id: "hunt-stall-durable-sample",
      key: "sample:0001:hunt-stall-durable-sample",
      storedAt: "2026-07-19T00:00:00.000Z",
      body: redactDataUrlsForTest(body),
    };
    storedSample.body.sample.huntStallEvidence.media.reverse();
    const durable = createDurableDebugSampleBindings({
      id: storedSample.id,
      storedSample,
      assets: [
        {
          name: assets[2].name,
          type: assets[2].type,
          contents: "hunt-frame-two-raw",
        },
        {
          name: assets[1].name,
          type: assets[1].type,
          contents: "hunt-frame-one-processed",
        },
        {
          name: assets[0].name,
          type: assets[0].type,
          contents: "hunt-frame-one-raw",
        },
      ],
    });
    const response = await onRequestGet({
      request: new Request(
        "https://maple-timer.com/api/debug-samples?id=hunt-stall-durable-sample",
      ),
      env: { DEBUG_SAMPLES: createDebugSamplesBinding(), ...durable.env },
    });
    const data = await response.json();
    const mediaById = Object.fromEntries(
      data.body.sample.huntStallEvidence.media.map((entry) => [
        entry.id,
        {
          rawDataUrl: entry.rawDataUrl,
          processedDataUrl: entry.processedDataUrl,
        },
      ]),
    );

    expect(response.status).toBe(200);
    expect(mediaById).toEqual({
      "hunt-stall-media:frame:2": {
        rawDataUrl: `data:image/png;base64,${btoa("hunt-frame-two-raw")}`,
        processedDataUrl: null,
      },
      "hunt-stall-media:frame:1": {
        rawDataUrl: `data:image/jpeg;base64,${btoa("hunt-frame-one-raw")}`,
        processedDataUrl: `data:image/webp;base64,${btoa("hunt-frame-one-processed")}`,
      },
    });
    expect(data.body.sample.huntStallEvidence.selection).toEqual(
      body.sample.huntStallEvidence.selection,
    );
    expect(data.body.sample.huntStallEvidence.frames).toEqual(
      body.sample.huntStallEvidence.frames,
    );
    expect(JSON.stringify(data)).not.toContain(STORED_REPORT_ASSET_PLACEHOLDER);
    expect(durable.get).toHaveBeenCalledTimes(3);
  });

  it("rehydrates Special Core incident media from R2 after KV expiry by media ID", async () => {
    const body = createSpecialCoreIncidentAssetPayload();
    const assets = getDebugSampleAssets(body);
    const storedSample = {
      id: "special-core-durable-sample",
      key: "sample:0001:special-core-durable-sample",
      storedAt: "2026-07-19T00:00:00.000Z",
      body: redactDataUrlsForTest(body),
    };
    storedSample.body.sample.specialCoreEvidence.media.reverse();
    const durable = createDurableDebugSampleBindings({
      id: storedSample.id,
      storedSample,
      assets: [
        {
          name: assets[1].name,
          type: assets[1].type,
          contents: "special-core-frame-two",
        },
        {
          name: assets[0].name,
          type: assets[0].type,
          contents: "special-core-frame-one",
        },
      ],
    });
    const response = await onRequestGet({
      request: new Request(
        "https://maple-timer.com/api/debug-samples?id=special-core-durable-sample",
      ),
      env: { DEBUG_SAMPLES: createDebugSamplesBinding(), ...durable.env },
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(
      Object.fromEntries(
        data.body.sample.specialCoreEvidence.media.map((entry) => [
          entry.id,
          entry.imageDataUrl,
        ]),
      ),
    ).toEqual({
      "special-core-media:frame:2":
        `data:image/webp;base64,${btoa("special-core-frame-two")}`,
      "special-core-media:frame:1":
        `data:image/jpeg;base64,${btoa("special-core-frame-one")}`,
    });
    expect(data.body.sample.specialCoreEvidence.selection).toEqual(
      body.sample.specialCoreEvidence.selection,
    );
    expect(data.body.sample.specialCoreEvidence.frames).toEqual(
      body.sample.specialCoreEvidence.frames,
    );
    expect(JSON.stringify(data)).not.toContain(STORED_REPORT_ASSET_PLACEHOLDER);
    expect(durable.get).toHaveBeenCalledTimes(2);
  });

  it("rehydrates Booster Expiry incident media from R2 after KV expiry by media ID", async () => {
    const body = createBoosterExpiryIncidentAssetPayload();
    const assets = getDebugSampleAssets(body);
    const storedSample = {
      id: "booster-expiry-durable-sample",
      key: "sample:0001:booster-expiry-durable-sample",
      storedAt: "2026-07-19T00:00:00.000Z",
      body: redactDataUrlsForTest(body),
    };
    storedSample.body.sample.boosterExpiryEvidence.media.reverse();
    const durable = createDurableDebugSampleBindings({
      id: storedSample.id,
      storedSample,
      assets: [
        {
          name: assets[1].name,
          type: assets[1].type,
          contents: "booster-frame-two",
        },
        {
          name: assets[0].name,
          type: assets[0].type,
          contents: "booster-frame-one",
        },
      ],
    });
    const response = await onRequestGet({
      request: new Request(
        "https://maple-timer.com/api/debug-samples?id=booster-expiry-durable-sample",
      ),
      env: { DEBUG_SAMPLES: createDebugSamplesBinding(), ...durable.env },
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(
      Object.fromEntries(
        data.body.sample.boosterExpiryEvidence.media.map((entry) => [
          entry.id,
          entry.imageDataUrl,
        ]),
      ),
    ).toEqual({
      "booster-expiry-media:frame:2":
        `data:image/webp;base64,${btoa("booster-frame-two")}`,
      "booster-expiry-media:frame:1":
        `data:image/jpeg;base64,${btoa("booster-frame-one")}`,
    });
    expect(data.body.sample.boosterExpiryEvidence.selection).toEqual(
      body.sample.boosterExpiryEvidence.selection,
    );
    expect(data.body.sample.boosterExpiryEvidence.frames).toEqual(
      body.sample.boosterExpiryEvidence.frames,
    );
    expect(JSON.stringify(data)).not.toContain(STORED_REPORT_ASSET_PLACEHOLDER);
    expect(durable.get).toHaveBeenCalledTimes(2);
  });

  it("records an honest Buff Expiry omission when a durable R2 asset is missing", async () => {
    const body = createBuffExpiryIncidentAssetPayload();
    const assets = getDebugSampleAssets(body);
    const storedSample = {
      id: "buff-expiry-missing-asset",
      key: "sample:0001:buff-expiry-missing-asset",
      storedAt: "2026-07-19T00:00:00.000Z",
      body: redactDataUrlsForTest(body),
    };
    const durable = createDurableDebugSampleBindings({
      id: storedSample.id,
      storedSample,
      assets: [
        {
          name: assets[0].name,
          type: assets[0].type,
          contents: "buff-frame-one",
        },
        {
          name: assets[1].name,
          type: assets[1].type,
          missing: true,
        },
      ],
    });
    const response = await onRequestGet({
      request: new Request(
        "https://maple-timer.com/api/debug-samples?id=buff-expiry-missing-asset",
      ),
      env: { DEBUG_SAMPLES: createDebugSamplesBinding(), ...durable.env },
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.body.sample.buffExpiryEvidence.media[0].dataUrl).toBe(
      "data:image/jpeg;base64,YnVmZi1mcmFtZS1vbmU=",
    );
    expect(data.body.sample.buffExpiryEvidence.media[1].dataUrl).toBe(
      STORED_REPORT_ASSET_PLACEHOLDER,
    );
    expect(data.body.sample.buffExpiryEvidence.omissions).toContainEqual(
      expect.objectContaining({
        kind: "asset",
        reason: "asset-missing",
        subjectIds: ["buff-expiry-frame:epoch:2"],
        count: 1,
      }),
    );
  });

  it("records an honest Skill omission when a durable R2 asset is missing", async () => {
    const body = createSkillIncidentAssetPayload();
    const assets = getDebugSampleAssets(body);
    const storedSample = {
      id: "skill-missing-asset",
      key: "sample:0001:skill-missing-asset",
      storedAt: "2026-07-19T00:00:00.000Z",
      body: redactDataUrlsForTest(body),
    };
    const durable = createDurableDebugSampleBindings({
      id: storedSample.id,
      storedSample,
      assets: [
        {
          name: assets[0].name,
          type: assets[0].type,
          contents: "skill-frame-one",
        },
        {
          name: assets[1].name,
          type: assets[1].type,
          missing: true,
        },
      ],
    });
    const response = await onRequestGet({
      request: new Request(
        "https://maple-timer.com/api/debug-samples?id=skill-missing-asset",
      ),
      env: { DEBUG_SAMPLES: createDebugSamplesBinding(), ...durable.env },
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.body.sample.skillEvidence.media[0].dataUrl).toBe(
      "data:image/jpeg;base64,c2tpbGwtZnJhbWUtb25l",
    );
    expect(data.body.sample.skillEvidence.media[1].dataUrl).toBe(
      STORED_REPORT_ASSET_PLACEHOLDER,
    );
    expect(data.body.sample.skillEvidence.selection).toMatchObject({
      support: "partial",
      degradationReasons: ["asset-missing"],
    });
    expect(data.body.sample.skillEvidence.omissions).toContainEqual(
      expect.objectContaining({
        kind: "asset",
        reason: "asset-missing",
        subjectIds: ["skill-media:frame:2"],
        count: 1,
      }),
    );
  });

  it("records an honest Hunt Stall omission when a durable R2 asset is missing", async () => {
    const body = createHuntStallIncidentAssetPayload();
    const assets = getDebugSampleAssets(body);
    const storedSample = {
      id: "hunt-stall-missing-asset",
      key: "sample:0001:hunt-stall-missing-asset",
      storedAt: "2026-07-19T00:00:00.000Z",
      body: redactDataUrlsForTest(body),
    };
    const durable = createDurableDebugSampleBindings({
      id: storedSample.id,
      storedSample,
      assets: [
        {
          name: assets[0].name,
          type: assets[0].type,
          contents: "hunt-frame-one-raw",
        },
        {
          name: assets[1].name,
          type: assets[1].type,
          missing: true,
        },
        {
          name: assets[2].name,
          type: assets[2].type,
          contents: "hunt-frame-two-raw",
        },
      ],
    });
    const response = await onRequestGet({
      request: new Request(
        "https://maple-timer.com/api/debug-samples?id=hunt-stall-missing-asset",
      ),
      env: { DEBUG_SAMPLES: createDebugSamplesBinding(), ...durable.env },
    });
    const data = await response.json();
    const firstMedia = data.body.sample.huntStallEvidence.media[0];

    expect(response.status).toBe(200);
    expect(firstMedia.rawDataUrl).toBe(
      `data:image/jpeg;base64,${btoa("hunt-frame-one-raw")}`,
    );
    expect(firstMedia.processedDataUrl).toBe(
      STORED_REPORT_ASSET_PLACEHOLDER,
    );
    expect(data.body.sample.huntStallEvidence.selection).toMatchObject({
      support: "partial",
      degradationReasons: ["asset-missing"],
    });
    expect(data.body.sample.huntStallEvidence.omissions).toContainEqual(
      expect.objectContaining({
        kind: "asset",
        reason: "asset-missing",
        subjectIds: ["hunt-stall-media:frame:1"],
        count: 1,
      }),
    );
  });

  it("records an honest Special Core omission when a durable R2 asset is missing", async () => {
    const body = createSpecialCoreIncidentAssetPayload();
    const assets = getDebugSampleAssets(body);
    const storedSample = {
      id: "special-core-missing-asset",
      key: "sample:0001:special-core-missing-asset",
      storedAt: "2026-07-19T00:00:00.000Z",
      body: redactDataUrlsForTest(body),
    };
    const durable = createDurableDebugSampleBindings({
      id: storedSample.id,
      storedSample,
      assets: [
        {
          name: assets[0].name,
          type: assets[0].type,
          contents: "special-core-frame-one",
        },
        {
          name: assets[1].name,
          type: assets[1].type,
          missing: true,
        },
      ],
    });
    const response = await onRequestGet({
      request: new Request(
        "https://maple-timer.com/api/debug-samples?id=special-core-missing-asset",
      ),
      env: { DEBUG_SAMPLES: createDebugSamplesBinding(), ...durable.env },
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(
      data.body.sample.specialCoreEvidence.media[0].imageDataUrl,
    ).toBe(`data:image/jpeg;base64,${btoa("special-core-frame-one")}`);
    expect(
      data.body.sample.specialCoreEvidence.media[1].imageDataUrl,
    ).toBe(STORED_REPORT_ASSET_PLACEHOLDER);
    expect(data.body.sample.specialCoreEvidence.selection).toMatchObject({
      support: "partial",
      degradationReasons: ["asset-missing"],
    });
    expect(data.body.sample.specialCoreEvidence.omissions).toContainEqual(
      expect.objectContaining({
        kind: "asset",
        reason: "asset-missing",
        subjectIds: ["special-core-frame:2"],
        count: 1,
      }),
    );
  });

  it("records an honest Booster Expiry omission when a durable R2 asset is missing", async () => {
    const body = createBoosterExpiryIncidentAssetPayload();
    const assets = getDebugSampleAssets(body);
    const storedSample = {
      id: "booster-expiry-missing-asset",
      key: "sample:0001:booster-expiry-missing-asset",
      storedAt: "2026-07-19T00:00:00.000Z",
      body: redactDataUrlsForTest(body),
    };
    const durable = createDurableDebugSampleBindings({
      id: storedSample.id,
      storedSample,
      assets: [
        {
          name: assets[0].name,
          type: assets[0].type,
          contents: "booster-frame-one",
        },
        {
          name: assets[1].name,
          type: assets[1].type,
          missing: true,
        },
      ],
    });
    const response = await onRequestGet({
      request: new Request(
        "https://maple-timer.com/api/debug-samples?id=booster-expiry-missing-asset",
      ),
      env: { DEBUG_SAMPLES: createDebugSamplesBinding(), ...durable.env },
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(
      data.body.sample.boosterExpiryEvidence.media[0].imageDataUrl,
    ).toBe(`data:image/jpeg;base64,${btoa("booster-frame-one")}`);
    expect(
      data.body.sample.boosterExpiryEvidence.media[1].imageDataUrl,
    ).toBe(STORED_REPORT_ASSET_PLACEHOLDER);
    expect(data.body.sample.boosterExpiryEvidence.selection).toMatchObject({
      support: "partial",
      degradationReasons: ["asset-missing"],
    });
    expect(data.body.sample.boosterExpiryEvidence.omissions).toContainEqual(
      expect.objectContaining({
        kind: "asset",
        reason: "asset-missing",
        subjectIds: ["booster-expiry-frame:2"],
        count: 1,
      }),
    );
  });

  it("returns 404 when neither KV nor D1 contains the requested ID", async () => {
    const durable = createDurableDebugSampleBindings();
    const request = new Request("https://maple-timer.com/api/debug-samples?id=missing-sample");

    const response = await onRequestGet({
      request,
      env: { DEBUG_SAMPLES: createDebugSamplesBinding(), ...durable.env },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not found" });
    expect(durable.get).not.toHaveBeenCalled();
  });

  it("keeps legacy unwrapped KV samples readable by their key suffix", async () => {
    const DEBUG_SAMPLES = createDebugSamplesBinding();
    const legacySample = {
      kind: "rune-issue",
      sample: {
        rawDataUrl: "data:image/png;base64,legacy-raw",
        processedDataUrl: "data:image/png;base64,legacy-mask",
      },
    };
    await DEBUG_SAMPLES.put(
      "sample:0001:legacy-sample",
      JSON.stringify(legacySample),
    );
    const request = new Request(
      "https://maple-timer.com/api/debug-samples?id=legacy-sample",
    );

    const response = await onRequestGet({ request, env: { DEBUG_SAMPLES } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(legacySample);
  });

  it("keeps the no-ID listing bounded to KV without enumerating D1 reports", async () => {
    const DEBUG_SAMPLES = createDebugSamplesBinding();
    await DEBUG_SAMPLES.put(
      "sample:0001:recent-sample",
      JSON.stringify({ id: "recent-sample" }),
      { metadata: { id: "recent-sample", kind: "rune-issue" } },
    );
    const durable = createDurableDebugSampleBindings({
      storedSample: { id: "sample-1", body: { kind: "rune-issue" } },
    });
    const request = new Request("https://maple-timer.com/api/debug-samples");

    const response = await onRequestGet({
      request,
      env: { DEBUG_SAMPLES, ...durable.env },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      samples: [
        {
          key: "sample:0001:recent-sample",
          id: "recent-sample",
          kind: "rune-issue",
        },
      ],
    });
    expect(durable.prepare).not.toHaveBeenCalled();
  });

  it("includes CORS headers on debug sample GET responses", async () => {
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
    };
    await env.DEBUG_SAMPLES.put(
      "sample:0001:sample-1",
      JSON.stringify({
        id: "sample-1",
        key: "sample:0001:sample-1",
        storedAt: "2026-06-09T00:00:00.000Z",
        body: createPayload(),
      }),
      {
        metadata: {
          id: "sample-1",
          kind: "rune-issue",
        },
      },
    );
    const request = new Request("https://maple-timer.com/api/debug-samples?id=sample-1");

    const response = await onRequestGet({ request, env });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    expect(data.id).toBe("sample-1");
  });

  it("includes skill runtime status in skill issue notifications", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      FEEDBACK_WEBHOOK_URL: "https://discord.com/api/webhooks/test/token",
    };
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload({
          kind: "skill-issue",
          reportIssue: {
            reason: "skill-alert-timing",
            label: "알림이 예정된 시간에 안 울려요",
          },
          rune: undefined,
          skill: {
            config: {
              name: "솔 야누스 : 새벽",
              alertThresholdSeconds: 50,
              soundId: "야누스 랜덤",
              volume: 1.2,
            },
            relatedActiveSkills: [
              {
                id: "skill_a",
                name: "솔 야누스 : 새벽",
                presetId: "sol-janus-dawn-2min",
                enabled: true,
              },
              {
                id: "skill_b",
                name: "솔 야누스 : 새벽",
                presetId: "sol-janus-dawn-1min",
                enabled: true,
              },
            ],
            state: {
              status: "running",
              observedRemainingSeconds: 115,
              alertedAt: null,
              pendingShortAnchor: null,
              rejectedReading: null,
            },
            runtimeTimeline: {
              samples: [
                {
                  sampledAt: 1_000,
                  ocrValue: 47,
                  confidence: 0.84,
                  recognizedText: "47",
                  estimatedRemainingSeconds: 115,
                  alertInSeconds: 65,
                  alertDecision: null,
                },
              ],
              alertEvents: [
                {
                  startedAt: 2_000,
                  alertCycleStartedAt: 2_000,
                  soundId: "야누스 랜덤",
                  status: "finished",
                  finishedAt: 3_000,
                  failedAt: null,
                  error: null,
                },
              ],
            },
          },
          sample: {
            rawDataUrl: "data:image/png;base64,raw",
            processedDataUrl: "data:image/png;base64,mask",
            regionLabel: "30x30",
            result: {
              value: 47,
              confidence: 0.84,
              estimatedRemainingSeconds: 115,
              alertInSeconds: 65,
            },
          },
        }),
      ),
    });

    const response = await onRequestPost({ request, env });

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    const webhookPayload = JSON.parse(init.body);
    expect(webhookPayload.content).toContain("상태: 감시 중");
    expect(webhookPayload.content).toContain("현재 추정 남은 시간: 115초");
    expect(webhookPayload.content).toContain("현재 OCR 값: 47");
    expect(webhookPayload.content).toContain("예상 알림까지: 65초");
    expect(webhookPayload.content).toContain("최근 알림: 없음");
    expect(webhookPayload.content).toContain("보류 후보: 없음");
    expect(webhookPayload.content).toContain("최근 판독 기록: 1개");
    expect(webhookPayload.content).toContain("최근 알림 재생: 재생 완료");
    expect(webhookPayload.content).toContain("알람음: 야누스 랜덤");
    expect(webhookPayload.content).toContain("볼륨: 120%");
    expect(webhookPayload.content).toContain("동일 이름 활성 행: 2개");
    expect(webhookPayload.content).not.toContain("인식값:");
  });

  it("labels Yein remaining-count flow evidence without seconds in notifications", () => {
    const body = createPayload({
      kind: "skill-issue",
      reportIssue: {
        reason: "skill-alert-timing",
        label: "알림이 너무 일찍 울려요",
      },
      rune: undefined,
      skill: {
        config: {
          presetId: "maehwa-yein-vi",
          detectionSource: "buff-duration",
          name: "매화검 3초식 : 예인 VI",
          alertThresholdSeconds: 3,
        },
        state: {
          status: "running",
          observedRemainingCount: 11,
          alertedAt: null,
          rejectedReading: 3,
          pendingRemainingCountDrop: {
            observedRemainingCount: 3,
            count: 3,
          },
        },
        runtimeTimeline: {
          samples: [
            {
              sampledAt: 7_000,
              remainingCountDecision: "implausible-drop-held",
              remainingCountExpectedMin: 6,
              remainingCountExpectedMax: 11,
            },
          ],
          alertEvents: [],
        },
      },
      sample: {
        rawDataUrl: "data:image/png;base64,raw",
        processedDataUrl: "data:image/png;base64,icon",
        result: { value: 3, confidence: 0.91 },
        buffDuration: {
          detected: true,
          remainingCount: {
            count: 3,
            format: "remaining-count",
          },
        },
      },
    });
    const metadata = {
      id: "sample-yein",
      kind: "skill-issue",
      issueLabel: "알림이 너무 일찍 울려요",
      issueReason: "skill-alert-timing",
      status: "running",
      value: 3,
      confidence: 0.91,
      candidateCount: 1,
    };

    const slackPayload = buildDebugSampleSlackNotificationPayload({
      id: "sample-yein",
      key: "sample:key",
      metadata,
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });
    const slackText = JSON.stringify(slackPayload);
    expect(slackText).toContain("알림 기준");
    expect(slackText).toContain("3회");
    expect(slackText).toContain("원시 횟수");
    expect(slackText).toContain("확정 횟수");
    expect(slackText).toContain("11회");
    expect(slackText).toContain("불가능한 감소 계속 보류");
    expect(slackText).toContain("6~11회");
    expect(slackText).toContain("버프칸 남은 횟수 기준");

    const notification = buildDebugSampleNotificationContent({
      id: "sample-yein",
      key: "sample:key",
      metadata,
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });
    expect(notification).toContain("알림 기준: 3회");
    expect(notification).toContain("원시 횟수: 3회 (반영 안 됨)");
    expect(notification).toContain("확정 횟수: 11회");
    expect(notification).toContain("흐름 판정: 불가능한 감소 계속 보류");
    expect(notification).toContain("도달 가능 범위: 6~11회");
  });

  it("marks rejected skill readings as not applied in issue notifications", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      FEEDBACK_WEBHOOK_URL: "https://discord.com/api/webhooks/test/token",
    };
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload({
          kind: "skill-issue",
          reportIssue: {
            reason: "skill-not-detected",
            label: "감지가 안돼요",
          },
          rune: undefined,
          skill: {
            config: {
              presetId: "class-install",
              detectionSource: "quickslot",
              countdownSource: "cooldown",
              name: "직업 설치기",
              durationSeconds: 30,
              cooldownDurationSeconds: 120,
              alertThresholdSeconds: 5,
            },
            state: {
              status: "detecting",
              observedRemainingSeconds: null,
              estimatedExpiresAt: null,
              alertedAt: null,
              pendingShortAnchor: null,
              rejectedReading: 19,
            },
          },
          sample: {
            rawDataUrl: "data:image/png;base64,raw",
            processedDataUrl: "data:image/png;base64,mask",
            regionLabel: "38x38",
            result: {
              value: 19,
              confidence: 0.91,
              estimatedRemainingSeconds: null,
              alertInSeconds: null,
            },
          },
        }),
      ),
    });

    const response = await onRequestPost({ request, env });

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    const webhookPayload = JSON.parse(init.body);
    expect(webhookPayload.content).toContain("상태: 감지 대기");
    expect(webhookPayload.content).toContain("현재 추정 남은 시간: 없음");
    expect(webhookPayload.content).toContain("현재 OCR 값: 19 (반영 안 됨)");
    expect(webhookPayload.content).toContain("예상 알림까지: 없음");
    expect(webhookPayload.content).toContain("감지 방식: 퀵슬롯");
    expect(webhookPayload.content).toContain("스킬 상세: 직업 설치기");
    expect(webhookPayload.content).toContain("스킬 설정: 퀵슬롯 쿨타임 기준 · 지속 30초 · 쿨 120초");
    expect(webhookPayload.content).toContain("설치기 설정: 퀵슬롯 쿨타임 기준 · 지속 30초 · 쿨 120초");
    expect(webhookPayload.content).toContain("최근 알림: 없음");
    expect(webhookPayload.content).toContain("보류 후보: 없음");
    expect(webhookPayload.content).toContain("거부값: 19");
  });

  it("includes hunt stall runtime status in hunt stall issue notifications", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      FEEDBACK_WEBHOOK_URL: "https://discord.com/api/webhooks/test/token",
    };
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload({
          kind: "hunt-stall-issue",
          reportIssue: {
            reason: "hunt-stall-false-alert",
            label: "사냥 중인데 알림이 울려요",
          },
          rune: undefined,
          huntStall: {
            config: {
              mode: "manual-experience",
              stallThresholdSeconds: 7,
              soundId: "사냥 멈춤 랜덤",
              volume: 1.5,
              repeatAlertEnabled: true,
              repeatAlertIntervalSeconds: 5,
              repeatAlertMaxCount: 3,
            },
            state: {
              status: "alerted",
              unchangedSeconds: 12,
              hasObservedExperienceChange: true,
              repeatedAlertCount: 2,
              lastAlertPlayback: {
                status: "finished",
                requestedAt: 1_000,
                startedAt: 1_050,
                finishedAt: 2_000,
              },
            },
          },
          sample: {
            rawDataUrl: "data:image/png;base64,raw",
            processedDataUrl: "data:image/png;base64,processed",
            regionLabel: "220x17",
            result: {
              value: "1,530,768 [11.120%]",
              confidence: 0.91,
              changeScore: 0.02,
            },
          },
        }),
      ),
    });

    const response = await onRequestPost({ request, env });

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    const webhookPayload = JSON.parse(init.body);
    expect(webhookPayload.content).toContain("유형: 사냥 멈춤 감지 제보");
    expect(webhookPayload.content).toContain("알림 기준: 7초");
    expect(webhookPayload.content).toContain("볼륨: 150%");
    expect(webhookPayload.content).toContain("상태: 알림 완료");
    expect(webhookPayload.content).toContain("경험치 판독값: 1,530,768 [11.120%]");
    expect(webhookPayload.content).toContain("변화 없음: 12초");
    expect(webhookPayload.content).toContain("반복: 5초 간격 · 2/3회");
    expect(webhookPayload.content).toContain("실제 재생: 브라우저 재생 종료");
  });

  it("uses cooldown mode labels and threshold in hunt stall issue notifications", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      FEEDBACK_WEBHOOK_URL: "https://discord.com/api/webhooks/test/token",
    };
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload({
          kind: "hunt-stall-issue",
          rune: undefined,
          huntStall: {
            config: {
              mode: "cooldown-presence",
              stallThresholdSeconds: 6,
              cooldownMissingThresholdSeconds: 5,
              soundId: "사냥 멈춤 랜덤",
              volume: 1,
            },
            state: {
              status: "alerted",
              unchangedSeconds: 89,
              hasObservedExperienceChange: false,
              hasObservedCooldownPresence: true,
            },
          },
          sample: {
            rawDataUrl: "data:image/png;base64,raw",
            processedDataUrl: "data:image/png;base64,processed",
            regionLabel: "63x63",
            result: {
              value: "17",
              confidence: 0.74,
              changeScore: 0.017,
            },
          },
        }),
      ),
    });

    const response = await onRequestPost({ request, env });

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    const webhookPayload = JSON.parse(init.body);
    expect(webhookPayload.content).toContain("알림 기준: 5초");
    expect(webhookPayload.content).toContain("쿨타임 판독값: 17");
    expect(webhookPayload.content).toContain("쿨타임 시작 감지: 있음");
    expect(webhookPayload.content).not.toContain("경험치 판독값: 17");
    expect(webhookPayload.content).not.toContain("알림 기준: 6초");
  });

  it("includes buff expiry runtime status in buff expiry issue notifications", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      FEEDBACK_WEBHOOK_URL: "https://discord.com/api/webhooks/test/token",
    };
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload({
          kind: "buff-expiry-issue",
          reportIssue: {
            reason: "buff-expiry-missed",
            label: "버프가 꺼졌는데 알림이 안 울려요",
          },
          rune: undefined,
          buffExpiry: {
            config: {
              alertLeadSeconds: 30,
              supportedBuffIds: [
                "union_wealth",
                "union_luck",
                "small_wealth_exp_potion_group",
                "mvp_exp_coupon_70",
                "mvp_exp_4x_coupon",
                "vip_exp_buff",
                "extreme_gold",
              ],
              selectedBuffIds: ["union_wealth", "extreme_gold"],
              soundId: "버프 종료 랜덤",
              volume: 0.8,
            },
            state: {
              status: "tracking",
              boxCount: 5,
              acceptedMatchCount: 2,
              tracks: [{ id: "track-1" }],
              pendingTracks: [{ id: "pending-1" }],
            },
            lastSnapshot: {
              boxCount: 5,
              displayBoxCount: 6,
              acceptedMatchCount: 3,
              performance: {
                totalMs: 8.4,
              },
            },
          },
          sample: {
            rawDataUrl: "data:image/png;base64,roi",
            processedDataUrl: "data:image/png;base64,annotated",
            fullFrameDataUrl: "data:image/png;base64,full",
            regionLabel: "960x486",
            rejectedMatches: [
              { score: 0.81, reason: "low-score" },
              { score: 0.77, reason: "low-score" },
            ],
            result: {
              value: "익스트림 골드",
              confidence: 0.95,
              detected: true,
              candidateCount: 5,
              performance: {
                totalMs: 8.4,
              },
            },
          },
        }),
      ),
    });

    const response = await onRequestPost({ request, env });

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    const webhookPayload = JSON.parse(init.body);
    expect(webhookPayload.content).toContain("유형: 버프 종료 감지 제보");
    expect(webhookPayload.content).toContain("상태: 추적 중");
    expect(webhookPayload.content).toContain("알림 기준: 30초");
    expect(webhookPayload.content).toContain("지원 버프: 7개");
    expect(webhookPayload.content).toContain("감지 버프칸: 6");
    expect(webhookPayload.content).toContain("매칭: 3");
    expect(webhookPayload.content).toContain("추적: 1개");
    expect(webhookPayload.content).toContain("확인 중: 1개");
    expect(webhookPayload.content).toContain("최고 거절: 81% (low-score)");
    expect(webhookPayload.content).toContain("처리 시간: 8.4ms");
  });

  it("uses buff expiry snapshot counts in notification summaries", () => {
    const body = createPayload({
      kind: "buff-expiry-issue",
      reportIssue: {
        reason: "other",
        label: "기타",
        note: "감지 자체가 되질 않습니다.",
      },
      rune: undefined,
      sample: {
        rawDataUrl: "data:image/png;base64,roi",
        processedDataUrl: "data:image/png;base64,annotated",
        result: {
          value: null,
          confidence: 0,
          detected: false,
          candidateCount: 29,
        },
        rejectedMatches: [
          { score: 0.783, reason: "low-score" },
        ],
      },
      buffExpiry: {
        config: {
          enabled: true,
          alertLeadSeconds: 10,
          supportedBuffIds: ["union_wealth_group", "vip_exp_buff"],
          selectedBuffIds: ["union_wealth_group"],
          soundId: "여성2 버프 끝난것 같애요",
          volume: 0.6,
        },
        state: {
          status: "waiting",
          boxCount: 0,
          acceptedMatchCount: 0,
          tracks: [],
          pendingTracks: [],
        },
        lastSnapshot: {
          boxCount: 29,
          displayBoxCount: 29,
          acceptedMatchCount: 0,
          performance: {
            totalMs: 1663.7,
          },
        },
      },
    });

    const content = buildDebugSampleNotificationContent({
      id: "buff-sample-1",
      key: "sample:key",
      metadata: {
        id: "buff-sample-1",
        kind: "buff-expiry-issue",
        issueLabel: "기타",
        issueReason: "other",
        status: "waiting",
        value: null,
        confidence: 0,
        candidateCount: 29,
      },
      body,
      requestUrl: "https://maple-timer.com/api/debug-samples",
    });

    expect(content).toContain("상태: 카운트다운 대기");
    expect(content).toContain("감지 버프칸: 29");
    expect(content).toContain("매칭: 0");
    expect(content).toContain("최고 거절: 78% (low-score)");
  });

  it("stores hunt stall full-frame and candidate crop images as report assets", async () => {
    const reportStore = createReportStoreBindings();
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      ...reportStore,
    };
    const image = "data:image/png;base64,AA==";
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload({
          kind: "hunt-stall-issue",
          reportIssue: {
            reason: "hunt-stall-reading",
            label: "경험치 판독이 이상해요",
          },
          rune: undefined,
          huntStall: {
            config: {
              stallThresholdSeconds: 7,
            },
            state: {
              status: "active",
            },
          },
          sample: {
            rawDataUrl: image,
            processedDataUrl: image,
            fullFrameDataUrl: "data:image/jpeg;base64,AA==",
            cropCandidates: [
              {
                label: "fixed-y-wide 1368x807 #4",
                rawDataUrl: image,
                processedDataUrl: image,
              },
              {
                label: "fixed-y-wide 1368x807 #5",
                rawDataUrl: image,
                processedDataUrl: image,
              },
            ],
            regionLabel: "451,797 465x7",
            result: {
              value: "302 [19.062%]",
              confidence: 0.91,
              candidateCount: 2,
            },
          },
        }),
      ),
    });

    const response = await onRequestPost({ request, env });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stored).toBe(true);
    expect(reportStore.REPORT_ASSETS.put).toHaveBeenCalledTimes(7);
    const assetNames = reportStore.REPORT_ASSETS.put.mock.calls.map(
      ([, , options]) => options.customMetadata.name,
    );
    expect(assetNames).toEqual(
      expect.arrayContaining([
        "sample-raw.png",
        "sample-processed.png",
        "hunt-stall-full-frame.jpg",
        "hunt-stall-candidate-01-raw.png",
        "hunt-stall-candidate-01-processed.png",
        "hunt-stall-candidate-02-raw.png",
        "hunt-stall-candidate-02-processed.png",
      ]),
    );
  });

  it("stores buff expiry precision replay ROI frames as report assets", async () => {
    const reportStore = createReportStoreBindings();
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      ...reportStore,
    };
    const image = "data:image/png;base64,AA==";
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload({
          kind: "buff-expiry-issue",
          reportIssue: {
            reason: "buff-expiry-missed",
            label: "버프가 꺼졌는데 알림이 안 울려요",
          },
          rune: undefined,
          sample: {
            rawDataUrl: image,
            processedDataUrl: image,
            result: {
              value: null,
              confidence: 0,
              candidateCount: 30,
            },
            next: {
              replay: {
                frames: [
                  {
                    reason: "periodic",
                    imageDataUrl: "data:image/webp;base64,AA==",
                  },
                  {
                    reason: "target-seen",
                    imageDataUrl: "data:image/jpeg;base64,AA==",
                  },
                ],
              },
            },
          },
          buffExpiry: {
            config: {
              enabled: true,
              alertLeadSeconds: 10,
              selectedBuffIds: [],
              soundId: "default",
              volume: 1,
            },
            state: {
              status: "waiting",
            },
          },
        }),
      ),
    });

    const response = await onRequestPost({ request, env });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stored).toBe(true);
    const assetNames = reportStore.REPORT_ASSETS.put.mock.calls.map(
      ([, , options]) => options.customMetadata.name,
    );
    expect(assetNames).toEqual(
      expect.arrayContaining([
        "buff-expiry-precision-roi-01-periodic.webp",
        "buff-expiry-precision-roi-02-target-seen.jpg",
      ]),
    );
  });

  it("stores Buff Expiry incident media with stable frame names and no legacy duplicate", async () => {
    const reportStore = createReportStoreBindings();
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      ...reportStore,
    };
    const incidentBody = createBuffExpiryIncidentAssetPayload();
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload({
          ...incidentBody,
          sample: {
            ...incidentBody.sample,
            source: {
              kind: "buff-slot-top-right-quadrant-v1",
              dataUrl: "data:image/png;base64,U09VUkNF",
            },
            rawDataUrl: null,
            processedDataUrl: null,
            next: { replay: { frames: [] }, iconEvidence: [] },
            lastAlertEvidence: null,
          },
        }),
      ),
    });

    const response = await onRequestPost({ request, env });
    const data = await response.json();
    const assetNames = reportStore.REPORT_ASSETS.put.mock.calls.map(
      ([, , options]) => options.customMetadata.name,
    );

    expect(response.status).toBe(200);
    expect(data.stored).toBe(true);
    expect(
      assetNames.filter((name) => name.startsWith("buff-expiry-incident-frame-")),
    ).toHaveLength(2);
    expect(
      assetNames.some((name) =>
        name.startsWith("buff-expiry-precision-roi-"),
      ),
    ).toBe(false);
    expect(assetNames.some((name) => name.startsWith("buff-expiry-icon-"))).toBe(
      false,
    );
    expect(assetNames.some((name) => name.startsWith("buff-expiry-alert-"))).toBe(
      false,
    );
  });

  it("stores Skill incident media with stable media names", async () => {
    const reportStore = createReportStoreBindings();
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      ...reportStore,
    };
    const incidentBody = createSkillIncidentAssetPayload();
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload({
          ...incidentBody,
          reportIssue: {
            reason: "skill-not-detected",
            label: "감지가 안돼요",
          },
        }),
      ),
    });

    const response = await onRequestPost({ request, env });
    const data = await response.json();
    const assetNames = reportStore.REPORT_ASSETS.put.mock.calls.map(
      ([, , options]) => options.customMetadata.name,
    );

    expect(response.status).toBe(200);
    expect(data.stored).toBe(true);
    expect(
      assetNames.filter((name) => name.startsWith("skill-incident-media-")),
    ).toHaveLength(2);
    expect(assetNames).not.toContain("sample-raw.png");
    expect(assetNames).not.toContain("sample-processed.png");
  });

  it("stores Hunt Stall incident media variants without legacy duplicates", async () => {
    const reportStore = createReportStoreBindings();
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      ...reportStore,
    };
    const incidentBody = createHuntStallIncidentAssetPayload();
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPayload(incidentBody)),
    });

    const response = await onRequestPost({ request, env });
    const data = await response.json();
    const assetNames = reportStore.REPORT_ASSETS.put.mock.calls.map(
      ([, , options]) => options.customMetadata.name,
    );

    expect(response.status).toBe(200);
    expect(data.stored).toBe(true);
    expect(
      assetNames.filter((name) =>
        name.startsWith("hunt-stall-incident-media-"),
      ),
    ).toHaveLength(3);
    expect(assetNames).not.toContain("sample-raw.png");
    expect(assetNames).not.toContain("sample-processed.png");
    expect(
      assetNames.some((name) => name.startsWith("hunt-stall-history-")),
    ).toBe(false);
    expect(
      assetNames.some((name) => name.startsWith("hunt-stall-candidate-")),
    ).toBe(false);
  });

  it("stores Special Core incident media without legacy duplicates", async () => {
    const reportStore = createReportStoreBindings();
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      ...reportStore,
    };
    const incidentBody = createSpecialCoreIncidentAssetPayload();
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPayload(incidentBody)),
    });

    const response = await onRequestPost({ request, env });
    const data = await response.json();
    const assetNames = reportStore.REPORT_ASSETS.put.mock.calls.map(
      ([, , options]) => options.customMetadata.name,
    );

    expect(response.status).toBe(200);
    expect(data.stored).toBe(true);
    expect(
      assetNames.filter((name) =>
        name.startsWith("special-core-incident-media-"),
      ),
    ).toHaveLength(2);
    expect(assetNames).not.toContain("sample-raw.png");
    expect(
      assetNames.some((name) => name.startsWith("special-core-candidate-")),
    ).toBe(false);
    expect(
      assetNames.some((name) => name.startsWith("special-core-activation-")),
    ).toBe(false);
    expect(
      assetNames.some((name) => name.startsWith("special-core-evidence-")),
    ).toBe(false);
  });

  it("stores Booster Expiry incident media without legacy duplicates", async () => {
    const reportStore = createReportStoreBindings();
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      ...reportStore,
    };
    const incidentBody = createBoosterExpiryIncidentAssetPayload();
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPayload(incidentBody)),
    });

    const response = await onRequestPost({ request, env });
    const data = await response.json();
    const assetNames = reportStore.REPORT_ASSETS.put.mock.calls.map(
      ([, , options]) => options.customMetadata.name,
    );

    expect(response.status).toBe(200);
    expect(data.stored).toBe(true);
    expect(
      assetNames.filter((name) =>
        name.startsWith("booster-expiry-incident-media-"),
      ),
    ).toHaveLength(2);
    expect(assetNames).not.toContain("sample-raw.png");
    expect(assetNames).not.toContain("booster-expiry-timer.png");
    expect(
      assetNames.some((name) => name.startsWith("booster-expiry-timer-")),
    ).toBe(false);
    expect(
      assetNames.some((name) => name.startsWith("booster-expiry-confirmation-")),
    ).toBe(false);
  });

  it("stores Ultima Squad incident media without inline duplicates", async () => {
    const reportStore = createReportStoreBindings();
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      ...reportStore,
    };
    const request = new Request(
      "https://maple-timer.com/api/debug-samples",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createPayload(createUltimaRaidEquipmentIncidentAssetPayload()),
        ),
      },
    );

    const response = await onRequestPost({ request, env });
    const data = await response.json();
    const assetNames = reportStore.REPORT_ASSETS.put.mock.calls.map(
      ([, , options]) => options.customMetadata.name,
    );

    expect(response.status).toBe(200);
    expect(data.stored).toBe(true);
    expect(
      assetNames.filter((name) =>
        name.startsWith("ultima-raid-equipment-incident-media-"),
      ),
    ).toHaveLength(2);
    expect(assetNames).not.toContain("sample-raw.png");
  });

  it("keeps temporary Buff Expiry evidence and records permanent storage failure", async () => {
    const reportStore = createReportStoreBindings();
    reportStore.REPORT_ASSETS.put.mockRejectedValue(new Error("R2 unavailable"));
    const DEBUG_SAMPLES = createDebugSamplesBinding();
    const incidentBody = createBuffExpiryIncidentAssetPayload();
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload({
          ...incidentBody,
          sample: {
            ...incidentBody.sample,
            source: {
              kind: "buff-slot-top-right-quadrant-v1",
              dataUrl: "data:image/png;base64,U09VUkNF",
            },
          },
        }),
      ),
    });
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await onRequestPost({
      request,
      env: { DEBUG_SAMPLES, ...reportStore },
    });
    const result = await response.json();
    const samples = await DEBUG_SAMPLES.list({ prefix: "sample:", limit: 50 });
    const stored = await DEBUG_SAMPLES.get(samples.keys[0].name, "json");

    expect(response.status).toBe(200);
    expect(result.stored).toBe(false);
    expect(stored.body.sample.buffExpiryEvidence.omissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "asset-persist-failed",
          subjectIds: ["buff-expiry-frame:epoch:1"],
        }),
        expect.objectContaining({
          reason: "asset-persist-failed",
          subjectIds: ["buff-expiry-frame:epoch:2"],
        }),
      ]),
    );
    expect(stored.body.sample.buffExpiryEvidence.media[0].dataUrl).toMatch(
      /^data:image\//,
    );
    expect(warnMock).toHaveBeenCalledWith("R2 unavailable");
  });

  it("keeps temporary Skill evidence and records permanent storage failure", async () => {
    const reportStore = createReportStoreBindings();
    reportStore.REPORT_ASSETS.put.mockRejectedValue(new Error("R2 unavailable"));
    const DEBUG_SAMPLES = createDebugSamplesBinding();
    const incidentBody = createSkillIncidentAssetPayload();
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload({
          ...incidentBody,
          reportIssue: {
            reason: "skill-not-detected",
            label: "감지가 안돼요",
          },
        }),
      ),
    });
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await onRequestPost({
      request,
      env: { DEBUG_SAMPLES, ...reportStore },
    });
    const result = await response.json();
    const samples = await DEBUG_SAMPLES.list({ prefix: "sample:", limit: 50 });
    const stored = await DEBUG_SAMPLES.get(samples.keys[0].name, "json");

    expect(response.status).toBe(200);
    expect(result.stored).toBe(false);
    expect(stored.body.sample.skillEvidence.selection).toMatchObject({
      support: "partial",
      degradationReasons: ["asset-persist-failed"],
    });
    expect(stored.body.sample.skillEvidence.omissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "asset-persist-failed",
          subjectIds: ["skill-media:frame:1"],
        }),
        expect.objectContaining({
          reason: "asset-persist-failed",
          subjectIds: ["skill-media:frame:2"],
        }),
      ]),
    );
    expect(stored.body.sample.skillEvidence.media[0].dataUrl).toMatch(
      /^data:image\//,
    );
    expect(warnMock).toHaveBeenCalledWith("R2 unavailable");
  });

  it("keeps temporary Hunt Stall evidence and records permanent storage failure", async () => {
    const reportStore = createReportStoreBindings();
    reportStore.REPORT_ASSETS.put.mockRejectedValue(new Error("R2 unavailable"));
    const DEBUG_SAMPLES = createDebugSamplesBinding();
    const incidentBody = createHuntStallIncidentAssetPayload();
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPayload(incidentBody)),
    });
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await onRequestPost({
      request,
      env: { DEBUG_SAMPLES, ...reportStore },
    });
    const result = await response.json();
    const samples = await DEBUG_SAMPLES.list({ prefix: "sample:", limit: 50 });
    const stored = await DEBUG_SAMPLES.get(samples.keys[0].name, "json");

    expect(response.status).toBe(200);
    expect(result.stored).toBe(false);
    expect(stored.body.sample.huntStallEvidence.selection).toMatchObject({
      support: "partial",
      degradationReasons: ["asset-persist-failed"],
    });
    expect(stored.body.sample.huntStallEvidence.omissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "asset-persist-failed",
          subjectIds: ["hunt-stall-media:frame:1"],
        }),
        expect.objectContaining({
          reason: "asset-persist-failed",
          subjectIds: ["hunt-stall-media:frame:2"],
        }),
      ]),
    );
    expect(stored.body.sample.huntStallEvidence.media[0].rawDataUrl).toMatch(
      /^data:image\//,
    );
    expect(warnMock).toHaveBeenCalledWith("R2 unavailable");
  });

  it("keeps temporary Special Core evidence and records permanent storage failure", async () => {
    const reportStore = createReportStoreBindings();
    reportStore.REPORT_ASSETS.put.mockRejectedValue(new Error("R2 unavailable"));
    const DEBUG_SAMPLES = createDebugSamplesBinding();
    const incidentBody = createSpecialCoreIncidentAssetPayload();
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPayload(incidentBody)),
    });
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await onRequestPost({
      request,
      env: { DEBUG_SAMPLES, ...reportStore },
    });
    const result = await response.json();
    const samples = await DEBUG_SAMPLES.list({ prefix: "sample:", limit: 50 });
    const stored = await DEBUG_SAMPLES.get(samples.keys[0].name, "json");

    expect(response.status).toBe(200);
    expect(result.stored).toBe(false);
    expect(stored.body.sample.specialCoreEvidence.selection).toMatchObject({
      support: "partial",
      degradationReasons: ["asset-persist-failed"],
    });
    expect(stored.body.sample.specialCoreEvidence.omissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "asset-persist-failed",
          subjectIds: ["special-core-frame:1"],
        }),
        expect.objectContaining({
          reason: "asset-persist-failed",
          subjectIds: ["special-core-frame:2"],
        }),
      ]),
    );
    expect(
      stored.body.sample.specialCoreEvidence.media[0].imageDataUrl,
    ).toMatch(/^data:image\//);
    expect(warnMock).toHaveBeenCalledWith("R2 unavailable");
  });

  it("keeps temporary Booster Expiry evidence and records permanent storage failure", async () => {
    const reportStore = createReportStoreBindings();
    reportStore.REPORT_ASSETS.put.mockRejectedValue(new Error("R2 unavailable"));
    const DEBUG_SAMPLES = createDebugSamplesBinding();
    const incidentBody = createBoosterExpiryIncidentAssetPayload();
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPayload(incidentBody)),
    });
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await onRequestPost({
      request,
      env: { DEBUG_SAMPLES, ...reportStore },
    });
    const result = await response.json();
    const samples = await DEBUG_SAMPLES.list({ prefix: "sample:", limit: 50 });
    const stored = await DEBUG_SAMPLES.get(samples.keys[0].name, "json");

    expect(response.status).toBe(200);
    expect(result.stored).toBe(false);
    expect(stored.body.sample.boosterExpiryEvidence.selection).toMatchObject({
      support: "partial",
      degradationReasons: ["asset-persist-failed"],
    });
    expect(stored.body.sample.boosterExpiryEvidence.omissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "asset-persist-failed",
          subjectIds: ["booster-expiry-frame:1"],
        }),
        expect.objectContaining({
          reason: "asset-persist-failed",
          subjectIds: ["booster-expiry-frame:2"],
        }),
      ]),
    );
    expect(
      stored.body.sample.boosterExpiryEvidence.media[0].imageDataUrl,
    ).toMatch(/^data:image\//);
    expect(warnMock).toHaveBeenCalledWith("R2 unavailable");
  });

  it("stores deduplicated rune runtime frames without legacy duplicates", async () => {
    const reportStore = createReportStoreBindings();
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      ...reportStore,
    };
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload({
          sample: {
            rawDataUrl: "data:image/png;base64,AA==",
            processedDataUrl: "data:image/png;base64,AA==",
            result: {
              value: null,
              confidence: 0.9,
              detected: true,
              candidateCount: 1,
            },
            runeEvidence: {
              runtimeFrames: [
                {
                  frameId: "frame:1000",
                  sampledAt: 1_000,
                  roles: ["runtime-signal"],
                  rawDataUrl: "data:image/jpeg;base64,AA==",
                },
                {
                  frameId: "frame:2000",
                  sampledAt: 2_000,
                  roles: ["runtime-signal", "alert-trigger"],
                  rawDataUrl: "data:image/webp;base64,AA==",
                },
              ],
              runtimeIncident: {
                frames: [
                  { frameId: "frame:1000", sampledAt: 1_000 },
                  { frameId: "frame:2000", sampledAt: 2_000 },
                ],
              },
              alertTrigger: {
                frames: [{ frameId: "frame:2000", sampledAt: 2_000 }],
              },
            },
          },
        }),
      ),
    });

    const response = await onRequestPost({ request, env });
    const data = await response.json();
    const assetNames = reportStore.REPORT_ASSETS.put.mock.calls.map(
      ([, , options]) => options.customMetadata.name,
    );

    expect(response.status).toBe(200);
    expect(data.stored).toBe(true);
    expect(assetNames).toEqual(
      expect.arrayContaining([
        "rune-runtime-frame-01-frame-1000.jpg",
        "rune-runtime-frame-02-frame-2000.webp",
      ]),
    );
    expect(assetNames.some((name) => name.startsWith("rune-runtime-incident-"))).toBe(
      false,
    );
    expect(assetNames.some((name) => name.startsWith("rune-alert-trigger-"))).toBe(
      false,
    );
  });

  it("accepts booster expiry issue reports without a processed sample image", async () => {
    const reportStore = createReportStoreBindings();
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      ...reportStore,
    };
    const image = "data:image/png;base64,AA==";
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        createPayload({
          kind: "booster-expiry-issue",
          reportIssue: {
            reason: "booster-expiry-misread",
            label: "부스터 시간이 이상해요",
          },
          rune: undefined,
          sample: {
            rawDataUrl: image,
            timerDataUrl: image,
            regionLabel: "1280x270",
            result: {
              value: "01:35",
              confidence: 1,
              detected: true,
            },
          },
          boosterExpiry: {
            config: {
              enabled: true,
              alertLeadSeconds: 10,
              soundId: "default",
              volume: 0.8,
            },
            state: {
              status: "armed",
              rawText: "01:35",
              displayText: "01:35",
              confirmedExpiresAt: 100000,
            },
          },
        }),
      ),
    });

    const response = await onRequestPost({ request, env });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stored).toBe(true);
    const assetNames = reportStore.REPORT_ASSETS.put.mock.calls.map(
      ([, , options]) => options.customMetadata.name,
    );
    expect(assetNames).toEqual(
      expect.arrayContaining(["sample-raw.png", "booster-expiry-timer.png"]),
    );
    expect(assetNames).not.toContain("sample-processed.png");
  });

  it("keeps the report successful when webhook notification fails", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 500 }));
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DEBUG_SAMPLES: createDebugSamplesBinding(),
      REPORT_WEBHOOK_URL: "https://discord.com/api/webhooks/test/token",
    };
    const request = new Request("https://maple-timer.com/api/debug-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPayload()),
    });

    const response = await onRequestPost({ request, env });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.id).toEqual(expect.any(String));
    expect(data.notification).toEqual({ skipped: true });
    expect(warnMock).toHaveBeenCalledWith("report webhook failed with 500");
  });
});

describe("expanded UI report diagnostics", () => {
  it("shows the analysis coordinate space in Slack and text notifications", () => {
    const body = {
      kind: "buff-expiry-issue",
      url: "https://maple-timer.com/",
      diagnostics: {
        capture: {
          hasStream: true,
          size: { width: 1920, height: 1080 },
          layoutKey: "1920x1080",
          frameSource: {
            coordinateSpace: "game-viewport",
            layoutKey: "game:1366x768",
            gameViewport: {
              state: "calibrated",
              captureSize: { width: 1920, height: 1080 },
              region: { x: 277, y: 156, width: 1366, height: 768 },
              gameResolution: { width: 1366, height: 768 },
              revision: 3,
              verification: "calibrated",
            },
          },
        },
      },
    };
    const metadata = {
      kind: "buff-expiry-issue",
      issueLabel: "버프가 꺼졌는데 알림이 안 울려요",
      issueReason: "buff-expiry-missed",
      candidateCount: 0,
    };
    const requestUrl = "https://maple-timer.com/api/debug-samples";

    const textContent = buildDebugSampleNotificationContent({
      id: "expanded-ui-sample",
      key: "sample:key",
      metadata,
      body,
      requestUrl,
    });
    const slackPayload = buildDebugSampleSlackNotificationPayload({
      id: "expanded-ui-sample",
      key: "sample:key",
      metadata,
      body,
      requestUrl,
    });

    expect(textContent).toContain(
      "분석 기준: 설정한 게임 영역 · game:1366x768",
    );
    expect(textContent).toContain(
      "게임 영역: 게임 영역 사용자 설정 · 1366x768 · (277, 156) 1366x768 · r3",
    );
    expect(JSON.stringify(slackPayload)).toContain("설정한 게임 영역");
    expect(JSON.stringify(slackPayload)).toContain("(277, 156) 1366x768");
  });
});
