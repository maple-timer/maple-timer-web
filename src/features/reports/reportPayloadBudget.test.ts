import { describe, expect, it } from "vitest";
import {
  compactReportPayload,
  getReportPayloadByteLength,
} from "./reportPayloadBudget";
import { createAlertReportPayload } from "../../contracts/reporting/alertReportContract";
import { createAlertReportIncident } from "../../contracts/reporting/alertReportIncident";

const image = (size: number) => `data:image/webp;base64,${"A".repeat(size)}`;

describe("compactReportPayload", () => {
  it("keeps runtime failure metadata while removing diagnostic media", () => {
    const runtimeFailure = {
      stage: "recognizer",
      code: "recognizer-failed",
      technicalMessage: "session crashed",
      occurredAt: 10_000,
    };
    const compacted = compactReportPayload(
      {
        kind: "skill-issue",
        sample: {
          fullFrameDataUrl: image(2_000),
          result: { value: null, runtimeFailure },
        },
        skill: {
          runtimeTimeline: {
            samples: [{ sampledAt: 10_000, runtimeFailure }],
          },
        },
      },
      { targetBytes: 900, aggressive: true },
    ) as any;

    expect(compacted.sample.fullFrameDataUrl).toBeNull();
    expect(compacted.sample.result.runtimeFailure).toEqual(runtimeFailure);
    expect(
      compacted.skill.runtimeTimeline.samples[0].runtimeFailure,
    ).toEqual(runtimeFailure);
  });

  it("drops full frames and periodic history before incident evidence", () => {
    const compacted = compactReportPayload(
      {
        kind: "buff-expiry-issue",
        sample: {
          source: { dataUrl: image(500) },
          fullFrameDataUrl: image(700),
          next: {
            replay: { frames: [{ imageDataUrl: image(600) }] },
            lastAlertEvidence: { imageDataUrl: image(400) },
          },
        },
      },
      { targetBytes: 1_800 },
    ) as any;

    expect(compacted.sample.source.dataUrl).toContain("data:image/");
    expect(compacted.sample.next.lastAlertEvidence.imageDataUrl).toContain("data:image/");
    expect(compacted.sample.fullFrameDataUrl).toBeNull();
    expect(compacted.reportPayloadBudget.droppedPaths[0]).toBe("sample.fullFrameDataUrl");
  });

  it("keeps a diagnostic when no media needs to be removed", () => {
    const compacted = compactReportPayload(
      { sample: { rawDataUrl: image(10), processedDataUrl: image(10) } },
      { targetBytes: 10_000 },
    ) as any;

    expect(compacted.reportPayloadBudget).toMatchObject({
      droppedMediaCount: 0,
      overTarget: false,
      originalMediaCount: 2,
    });
    expect(getReportPayloadByteLength(compacted)).toBe(
      compacted.reportPayloadBudget.finalBytes,
    );
  });

  it("drops bounded rune runtime history before protected alert-trigger evidence", () => {
    const compacted = compactReportPayload(
      {
        sample: {
          rawDataUrl: image(500),
          runeEvidence: {
            runtimeIncident: {
              frames: [
                { rawDataUrl: image(900) },
                { rawDataUrl: image(900) },
              ],
            },
            alertTrigger: {
              frames: [{ rawDataUrl: image(400) }],
            },
          },
        },
      },
      { targetBytes: 1_500 },
    ) as any;

    expect(compacted.sample.rawDataUrl).toContain("data:image/");
    expect(compacted.sample.runeEvidence.alertTrigger.frames[0].rawDataUrl).toContain(
      "data:image/",
    );
    expect(compacted.reportPayloadBudget.droppedPaths).toEqual(
      expect.arrayContaining([
        "sample.runeEvidence.runtimeIncident.frames.0.rawDataUrl",
        "sample.runeEvidence.runtimeIncident.frames.1.rawDataUrl",
      ]),
    );
  });

  it("preserves selected rune runtime frames before report-time derivatives", () => {
    const compacted = compactReportPayload(
      {
        sample: {
          rawDataUrl: image(500),
          candidateDataUrl: image(1_100),
          runeEvidence: {
            reportFrame: { candidateDataUrl: image(900) },
            runtimeFrames: [
              {
                frameId: "frame:1000",
                roles: ["runtime-signal"],
                rawDataUrl: image(700),
              },
            ],
          },
        },
      },
      { targetBytes: 2_100 },
    ) as any;

    expect(compacted.sample.candidateDataUrl).toBeNull();
    expect(compacted.sample.runeEvidence.reportFrame.candidateDataUrl).toBeNull();
    expect(compacted.sample.runeEvidence.runtimeFrames[0].rawDataUrl).toContain(
      "data:image/",
    );
    expect(compacted.reportPayloadBudget.droppedPaths).not.toContain(
      "sample.runeEvidence.runtimeFrames.0.rawDataUrl",
    );
  });

  it("reconciles the evidence manifest after referenced media is removed", () => {
    const incident = createAlertReportIncident({
      feature: "buff-expiry",
      submittedAt: "2026-07-18T01:00:10.000Z",
      issue: {
        reason: "buff-expiry-missed",
        label: "버프가 꺼졌는데 알림이 안 울려요",
      },
      evidence: {
        source: "runtime-snapshot",
        sampledAt: Date.parse("2026-07-18T01:00:08.000Z"),
        ageMs: null,
        windowStartedAt: null,
        windowEndedAt: null,
        frameCount: 1,
        stateBinding: "after-only",
        mediaCount: 1,
      },
      evidenceReferences: [
        {
          id: "source",
          kind: "sourceImage",
          paths: ["sample.cropHistory.0.rawDataUrl"],
          capturedAt: null,
          frameId: null,
          cycleId: null,
        },
      ],
      completeness: {
        sourceImage: true,
        temporalTrace: false,
        stateBeforeAfter: false,
        decision: false,
        playback: false,
      },
    });
    const payload = createAlertReportPayload({
      kind: "buff-expiry-issue",
      incident,
      sample: { cropHistory: [{ rawDataUrl: image(2_000) }] },
    });

    expect(payload.incident.evidenceManifest.references[0]).toMatchObject({
      produced: true,
      producedPaths: ["sample.cropHistory.0.rawDataUrl"],
      retained: true,
      retainedPaths: ["sample.cropHistory.0.rawDataUrl"],
    });
    expect(payload.incident.completeness.sourceImage).toBe(true);
    expect(payload.incident.evidence.mediaCount).toBe(1);

    const compacted = compactReportPayload(payload, {
      targetBytes: 1_000,
      aggressive: true,
    }) as typeof payload & { reportPayloadBudget: { droppedPaths: string[] } };

    expect(compacted.sample.cropHistory[0]?.rawDataUrl).toBeNull();
    expect(compacted.incident.evidenceManifest.references[0]).toMatchObject({
      produced: true,
      producedPaths: ["sample.cropHistory.0.rawDataUrl"],
      retained: false,
      retainedPaths: [],
    });
    expect(compacted.incident.completeness.sourceImage).toBe(false);
    expect(compacted.incident.evidence.mediaCount).toBe(0);
    expect(compacted.reportPayloadBudget.droppedPaths).toContain(
      "sample.cropHistory.0.rawDataUrl",
    );
  });

  it("protects selected Buff Expiry media until aggressive retry and records exact omissions", () => {
    const incident = createAlertReportIncident({
      feature: "buff-expiry",
      submittedAt: "2026-07-19T01:00:10.000Z",
      issue: {
        reason: "buff-expiry-missed",
        label: "버프가 꺼졌는데 알림이 안 울려요",
      },
      evidence: {
        source: "mixed",
        sampledAt: Date.parse("2026-07-19T01:00:08.000Z"),
        ageMs: null,
        windowStartedAt: null,
        windowEndedAt: null,
        frameCount: 2,
        stateBinding: "before-after",
        mediaCount: 2,
      },
      evidenceReferences: [
        {
          id: "buff-expiry-source",
          kind: "sourceImage",
          paths: ["sample.buffExpiryEvidence.media"],
          capturedAt: null,
          frameId: "frame:2",
          cycleId: null,
        },
      ],
      completeness: {
        sourceImage: true,
        temporalTrace: true,
        stateBeforeAfter: true,
        decision: true,
        playback: false,
      },
    });
    const payload = createAlertReportPayload({
      kind: "buff-expiry-issue",
      incident,
      sample: {
        source: { dataUrl: image(300) },
        buffExpiryEvidence: {
          frozenAt: 10_000,
          media: [
            { frameId: "frame:1", dataUrl: image(900) },
            { frameId: "frame:2", dataUrl: image(900) },
          ],
          omissions: [],
        },
      },
    });

    const normal = compactReportPayload(payload, {
      targetBytes: 600,
    }) as any;
    expect(normal.sample.buffExpiryEvidence.media[0].dataUrl).toContain(
      "data:image/",
    );
    expect(normal.sample.buffExpiryEvidence.media[1].dataUrl).toContain(
      "data:image/",
    );
    expect(normal.sample.buffExpiryEvidence.omissions).toEqual([]);

    const aggressive = compactReportPayload(payload, {
      targetBytes: 600,
      aggressive: true,
    }) as any;
    expect(
      aggressive.sample.buffExpiryEvidence.media.every(
        (entry: { dataUrl: unknown }) => entry.dataUrl === null,
      ),
    ).toBe(true);
    expect(aggressive.sample.buffExpiryEvidence.omissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "payload-compacted",
          subjectIds: ["frame:1"],
        }),
        expect.objectContaining({
          reason: "payload-compacted",
          subjectIds: ["frame:2"],
        }),
      ]),
    );
    expect(aggressive.incident.completeness.sourceImage).toBe(false);
    expect(aggressive.incident.evidence.mediaCount).toBe(1);
  });

  it("protects selected Skill media and keeps report-time images out of incident counts", () => {
    const incident = createAlertReportIncident({
      feature: "skill",
      submittedAt: "2026-07-19T01:00:10.000Z",
      issue: {
        reason: "skill-not-detected",
        label: "감지가 안돼요",
      },
      evidence: {
        source: "runtime-atomic",
        sampledAt: Date.parse("2026-07-19T01:00:08.000Z"),
        ageMs: null,
        windowStartedAt: null,
        windowEndedAt: null,
        frameCount: 1,
        stateBinding: "before-after",
        mediaCount: 1,
      },
      evidenceReferences: [
        {
          id: "skill-source",
          kind: "sourceImage",
          paths: ["sample.skillEvidence.media"],
          capturedAt: null,
          frameId: "skill-frame:1",
          cycleId: "skill-cycle:1",
        },
      ],
      completeness: {
        sourceImage: true,
        temporalTrace: true,
        stateBeforeAfter: true,
        decision: true,
        playback: false,
      },
    });
    const payload = createAlertReportPayload({
      kind: "skill-issue",
      incident,
      sample: {
        source: { dataUrl: image(300) },
        skillEvidence: {
          frozenAt: 10_000,
          selection: {
            support: "definitive",
            degradationReasons: [],
          },
          media: [
            {
              id: "skill-media:1",
              frameId: "skill-frame:1",
              dataUrl: image(900),
            },
          ],
          omissions: [],
          budget: {
            mediaLimitCount: 12,
            mediaCount: 1,
            mediaLimitChars: 1_250_000,
            mediaChars: 900,
            requestTargetChars: 2_097_152,
            requestChars: 1_500,
            droppedMediaIds: [],
          },
        },
      },
    });

    const normal = compactReportPayload(payload, {
      targetBytes: 600,
    }) as any;
    expect(normal.sample.skillEvidence.media[0].dataUrl).toContain(
      "data:image/",
    );
    expect(normal.incident.evidence.mediaCount).toBe(1);

    const aggressive = compactReportPayload(payload, {
      targetBytes: 600,
      aggressive: true,
    }) as any;
    expect(aggressive.sample.skillEvidence.media[0].dataUrl).toBeNull();
    expect(aggressive.sample.skillEvidence.selection).toMatchObject({
      support: "partial",
      degradationReasons: ["payload-compacted"],
    });
    expect(aggressive.sample.skillEvidence.omissions).toContainEqual(
      expect.objectContaining({
        reason: "payload-compacted",
        subjectIds: ["skill-media:1"],
      }),
    );
    expect(aggressive.sample.skillEvidence.budget).toMatchObject({
      mediaCount: 0,
      mediaChars: 0,
      droppedMediaIds: ["skill-media:1"],
    });
    expect(aggressive.incident.completeness.sourceImage).toBe(false);
    expect(aggressive.incident.evidence.mediaCount).toBe(0);
  });

  it("protects selected Special Core media and records stable frame omissions on retry", () => {
    const incident = createAlertReportIncident({
      feature: "special-core",
      submittedAt: "2026-07-19T01:00:10.000Z",
      issue: {
        reason: "special-core-missed",
        label: "특수 코어 발동 아이콘을 찾지 못했어요",
      },
      evidence: {
        source: "runtime-atomic",
        sampledAt: Date.parse("2026-07-19T01:00:08.000Z"),
        ageMs: null,
        windowStartedAt: null,
        windowEndedAt: null,
        frameCount: 1,
        stateBinding: "before-after",
        mediaCount: 1,
      },
      evidenceReferences: [
        {
          id: "special-core-source",
          kind: "sourceImage",
          paths: ["sample.specialCoreEvidence.media"],
          capturedAt: null,
          frameId: "special-core-frame:1",
          cycleId: null,
        },
      ],
      completeness: {
        sourceImage: true,
        temporalTrace: false,
        stateBeforeAfter: true,
        decision: false,
        playback: false,
      },
    });
    const payload = createAlertReportPayload({
      kind: "special-core-issue",
      incident,
      sample: {
        specialCoreEvidence: {
          frozenAt: 10_000,
          selection: {
            support: "definitive",
            degradationReasons: [],
          },
          media: [
            {
              id: "special-core-media:frame:1",
              frameId: "special-core-frame:1",
              imageDataUrl: image(900),
            },
          ],
          omissions: [],
          budget: {
            mediaLimitCount: 6,
            mediaCount: 1,
            mediaLimitChars: 1_650_000,
            mediaChars: 900,
            requestTargetBytes: 2_097_152,
            requestBytes: 1_500,
            droppedMediaFrameIds: [],
          },
        },
      },
    });

    const normal = compactReportPayload(payload, {
      targetBytes: 600,
    }) as any;
    expect(
      normal.sample.specialCoreEvidence.media[0].imageDataUrl,
    ).toContain("data:image/");
    expect(normal.incident.evidence.mediaCount).toBe(1);

    const aggressive = compactReportPayload(payload, {
      targetBytes: 600,
      aggressive: true,
    }) as any;
    expect(
      aggressive.sample.specialCoreEvidence.media[0].imageDataUrl,
    ).toBeNull();
    expect(aggressive.sample.specialCoreEvidence.selection).toMatchObject({
      support: "partial",
      degradationReasons: ["payload-compacted"],
    });
    expect(aggressive.sample.specialCoreEvidence.omissions).toContainEqual(
      expect.objectContaining({
        reason: "payload-compacted",
        subjectIds: ["special-core-frame:1"],
      }),
    );
    expect(aggressive.sample.specialCoreEvidence.budget).toMatchObject({
      mediaCount: 0,
      mediaChars: 0,
      droppedMediaFrameIds: ["special-core-frame:1"],
    });
    expect(aggressive.incident.completeness.sourceImage).toBe(false);
    expect(aggressive.incident.evidence.mediaCount).toBe(0);
  });

  it("protects Ultima Squad incident media and marks aggressive compaction", () => {
    const incident = createAlertReportIncident({
      feature: "ultima-raid-equipment",
      submittedAt: "2026-07-26T10:00:10.000Z",
      issue: {
        reason: "ultima-raid-equipment-missed",
        label: "가방이 가득 찼는데 알림이 안 울려요",
      },
      evidence: {
        source: "runtime-atomic",
        sampledAt: Date.parse("2026-07-26T10:00:08.000Z"),
        ageMs: null,
        windowStartedAt: null,
        windowEndedAt: null,
        frameCount: 2,
        stateBinding: "before-after",
        mediaCount: 1,
      },
      evidenceReferences: [
        {
          id: "ultima-raid-equipment-source",
          kind: "sourceImage",
          paths: ["sample.ultimaRaidEquipmentEvidence.media"],
          capturedAt: null,
          frameId: "ultima-raid-equipment-frame:2",
          cycleId: null,
        },
      ],
      completeness: {
        sourceImage: true,
        temporalTrace: true,
        stateBeforeAfter: true,
        decision: true,
        playback: false,
      },
    });
    const payload = createAlertReportPayload({
      kind: "ultima-raid-equipment-issue",
      incident,
      sample: {
        ultimaRaidEquipmentEvidence: {
          frozenAt: 10_000,
          selection: {
            support: "full",
            degradationReasons: [],
          },
          media: [
            {
              id: "ultima-raid-equipment-media:2",
              frameId: "ultima-raid-equipment-frame:2",
              dataUrl: image(900),
            },
          ],
          budget: {
            mediaChars: 900,
            droppedMediaCount: 0,
          },
        },
      },
    });

    const normal = compactReportPayload(payload, {
      targetBytes: 600,
    }) as any;
    expect(
      normal.sample.ultimaRaidEquipmentEvidence.media[0].dataUrl,
    ).toContain("data:image/");
    expect(normal.incident.evidence.mediaCount).toBe(1);

    const aggressive = compactReportPayload(payload, {
      targetBytes: 600,
      aggressive: true,
    }) as any;
    expect(
      aggressive.sample.ultimaRaidEquipmentEvidence.media[0].dataUrl,
    ).toBeNull();
    expect(
      aggressive.sample.ultimaRaidEquipmentEvidence.selection,
    ).toMatchObject({
      support: "partial",
      degradationReasons: ["payload-compacted"],
    });
    expect(
      aggressive.sample.ultimaRaidEquipmentEvidence.budget,
    ).toMatchObject({
      mediaChars: 0,
      droppedMediaCount: 1,
    });
    expect(aggressive.incident.completeness.sourceImage).toBe(false);
    expect(aggressive.incident.evidence.mediaCount).toBe(0);
  });
});
