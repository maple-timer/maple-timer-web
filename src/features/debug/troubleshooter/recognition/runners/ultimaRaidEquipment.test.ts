import { describe, expect, it } from "vitest";
import { buildTroubleshooterViewModel } from "../../model/buildTroubleshooterViewModel";
import { runUltimaRaidEquipmentRecognition } from "./ultimaRaidEquipment";

describe("runUltimaRaidEquipmentRecognition", () => {
  it("treats warm count-band edges as unreadable instead of replaying a false bag alert", async () => {
    const view = buildTroubleshooterViewModel({
      id: "ultima-equipment-edge-current-recognition",
      body: {
        kind: "ultima-raid-equipment-issue",
        reportIssue: {
          reason: "ultima-raid-equipment-false-alert",
        },
        sample: {
          ultimaRaidEquipmentEvidence: {
            schemaVersion: "ultima-raid-equipment-incident-evidence-v2",
            selection: {
              target: "equipment",
              support: "full",
              selectedFrameId: "equipment:3",
            },
            frames: [
              { id: "equipment:1", sampledAt: 1_000 },
              { id: "equipment:2", sampledAt: 2_000 },
              { id: "equipment:3", sampledAt: 3_000 },
            ],
            media: [],
            playbackAttempts: [],
          },
        },
        ultimaRaidEquipment: {
          alertTarget: "equipment",
        },
      },
    });
    const sequenceFrames = [1_000, 2_000, 3_000].map((sampledAt, index) =>
      createSequenceFrame(
        `경계 오탐 ${index + 1}`,
        sampledAt,
        createWarmEdgeImage(),
      ),
    );

    const result = await runUltimaRaidEquipmentRecognition({
      view,
      imageData: sequenceFrames[2].imageData,
      startedAt: performance.now(),
      sequenceKind: "runtime-incident",
      sequenceFrames,
    });

    expect(result.title).toBe("현재 감지기는 가방 가득 참을 인식하지 않음");
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ultima-current-bag-unreadable",
          value: "3/3개",
        }),
        expect.objectContaining({
          id: "ultima-current-alert",
          value: "미충족",
        }),
      ]),
    );
  });

  it("replays the ordinary-to-boss transition with the current confirmation rule", async () => {
    const view = buildTroubleshooterViewModel({
      id: "ultima-boss-current-recognition",
      body: {
        kind: "ultima-raid-boss-issue",
        reportIssue: {
          reason: "ultima-raid-boss-missed",
        },
        sample: {
          ultimaRaidEquipmentEvidence: {
            schemaVersion: "ultima-raid-equipment-incident-evidence-v2",
            selection: {
              target: "boss",
              support: "full",
              selectedFrameId: "boss:3",
            },
            frames: [
              { id: "normal:1", sampledAt: 1_000 },
              { id: "boss:2", sampledAt: 2_000 },
              { id: "boss:3", sampledAt: 3_000 },
            ],
            media: [],
            playbackAttempts: [],
          },
        },
        ultimaRaidEquipment: {
          alertTarget: "boss",
        },
      },
    });
    const sequenceFrames = [
      createSequenceFrame("일반 진행", 1_000, createProgressImage("normal")),
      createSequenceFrame("보스 후보", 2_000, createProgressImage("boss")),
      createSequenceFrame("보스 확정", 3_000, createProgressImage("boss")),
    ];

    const result = await runUltimaRaidEquipmentRecognition({
      view,
      imageData: sequenceFrames[2].imageData,
      startedAt: performance.now(),
      sequenceKind: "runtime-incident",
      sequenceFrames,
    });

    expect(result.tone).toBe("positive");
    expect(result.title).toBe("현재 코드도 보스 등장 알림 조건을 충족함");
    expect(result.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ultima-boss-confirmation",
          status: "complete",
          summary: "알림 조건 충족",
        }),
      ]),
    );
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ultima-current-boss",
          value: "2/3개",
        }),
        expect.objectContaining({
          id: "ultima-current-normal-progress",
          value: "1/3개",
        }),
      ]),
    );
  });
});

function createWarmEdgeImage(): ImageData {
  const width = 392;
  const height = 160;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set([54, 126, 156, 255], offset);
  }
  const image = { width, height, colorSpace: "srgb", data } as ImageData;
  const rightEdge = Math.ceil(width * 0.115) - 1;
  const top = Math.floor(height * 0.49) + 2;
  for (let row = top; row < top + 18; row += 1) {
    image.data.set(
      [216, 191, 126, 255],
      (row * image.width + rightEdge) * 4,
    );
  }
  return image;
}

function createSequenceFrame(
  label: string,
  sampledAt: number,
  imageData: ImageData,
) {
  return {
    label,
    sampledAt,
    imageData,
    src: `data:image/png;base64,${label}`,
  };
}

function createProgressImage(state: "normal" | "boss"): ImageData {
  const width = 390;
  const height = 166;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set([54, 84, 92, 255], offset);
  }
  const image = { width, height, colorSpace: "srgb", data } as ImageData;
  const color =
    state === "boss"
      ? ([244, 55, 124, 255] as const)
      : ([60, 196, 214, 255] as const);
  paintRelativeRect(
    image,
    0.39,
    0.845,
    state === "boss" ? 0.31 : 0.24,
    0.065,
    color,
  );
  return image;
}

function paintRelativeRect(
  image: ImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  color: readonly [number, number, number, number],
) {
  const left = Math.floor(image.width * x);
  const top = Math.floor(image.height * y);
  const right = Math.ceil(image.width * (x + width));
  const bottom = Math.ceil(image.height * (y + height));
  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      image.data.set(color, (row * image.width + column) * 4);
    }
  }
}
