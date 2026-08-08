import { describe, expect, it } from "vitest";
import { validateSemanticLabBootstrap } from "./canvasSyntheticMediaSource";

const ORIGIN = "http://127.0.0.1:4173";

describe("semantic lab browser bootstrap", () => {
  it("accepts a closed same-origin fixed-size asset bootstrap", () => {
    const result = validateSemanticLabBootstrap(bootstrap(), ORIGIN);
    expect(result.assets).toHaveLength(1);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.assets)).toBe(true);
  });

  it.each([
    ["unknown root key", () => ({ ...bootstrap(), extra: true })],
    ["wrong schema", () => ({ ...bootstrap(), schema: "wrong" })],
    ["weak capability", () => ({ ...bootstrap(), capability: "secret" })],
    [
      "external asset origin",
      () => ({
        ...bootstrap(),
        assets: [
          {
            ...bootstrap().assets[0],
            url: "https://example.com/__maple-remote-v1-semantic/assets/asset-frame-a1",
          },
        ],
      }),
    ],
    [
      "asset query",
      () => ({
        ...bootstrap(),
        assets: [
          {
            ...bootstrap().assets[0],
            url: `${bootstrap().assets[0].url}?copy=1`,
          },
        ],
      }),
    ],
    [
      "dimension drift",
      () => ({
        ...bootstrap(),
        assets: [
          bootstrap().assets[0],
          {
            ...bootstrap().assets[0],
            id: "asset-frame-a2",
            url: `${ORIGIN}/__maple-remote-v1-semantic/assets/asset-frame-a2`,
            width: 32,
          },
        ],
      }),
    ],
    [
      "duplicate asset",
      () => ({ ...bootstrap(), assets: [bootstrap().assets[0], bootstrap().assets[0]] }),
    ],
  ])("rejects %s", (_name, createValue) => {
    expect(() => validateSemanticLabBootstrap(createValue(), ORIGIN)).toThrow(
      /semantic-lab-/,
    );
  });
});

function bootstrap() {
  return {
    schema: "maple-timer.remote-recognition-v1-semantic-lab-bootstrap",
    version: 1,
    fixture: {
      manifestSha256: "a".repeat(64),
      contentSha256: "b".repeat(64),
      runtimeContractSha256: "c".repeat(64),
    },
    capability: "d".repeat(64),
    assets: [
      {
        id: "asset-frame-a1",
        url: `${ORIGIN}/__maple-remote-v1-semantic/assets/asset-frame-a1`,
        byteCount: 128,
        byteSha256: "e".repeat(64),
        rgbaSha256: "f".repeat(64),
        width: 16,
        height: 9,
      },
    ],
  };
}
