import { describe, expect, it } from "vitest";
import {
  buildTroubleshooterMetadata,
  normalizeDebugSample,
} from "./sample";

describe("game viewport troubleshooting metadata", () => {
  it("distinguishes explicit full-screen confirmation from legacy passthrough", () => {
    const sample = normalizeDebugSample({
      id: "viewport-confirmed",
      body: {
        kind: "hunt-stall-issue",
        diagnostics: {
          capture: {
            frameSource: {
              coordinateSpace: "game-viewport",
              layoutKey: "1920x1080",
              gameViewport: {
                state: "legacy-passthrough",
                verification: "user-confirmed",
                gameResolution: { width: 1920, height: 1080 },
                region: { x: 0, y: 0, width: 1920, height: 1080 },
                revision: 3,
              },
            },
          },
        },
      },
    });

    expect(buildTroubleshooterMetadata(sample).gameViewportLabel).toBe(
      "전체 화면 사용자 확인 · 1920x1080 · (0, 0) 1920x1080 · r3",
    );
  });
});
