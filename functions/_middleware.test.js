import { describe, expect, it } from "vitest";
import {
  onRequest,
  shouldApplyIsolatedPreviewResourceHeaders,
  shouldApplyIsolatedPreviewWorkerHeaders,
  shouldApplyMemoryLabHeaders,
} from "./_middleware.js";

describe("memory lab middleware", () => {
  it("adds isolation headers on preview memory lab routes", async () => {
    const response = await onRequest({
      request: new Request("https://preview.maple-timer.pages.dev/memory-lab"),
      next: async () => new Response("ok", { headers: { "X-Test": "1" } }),
    });

    expect(response.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(response.headers.get("Cross-Origin-Embedder-Policy")).toBe("credentialless");
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(response.headers.get("X-Test")).toBe("1");
  });

  it("does not add isolation headers on production custom domain", () => {
    expect(shouldApplyMemoryLabHeaders("https://maple-timer.com/memory-lab")).toBe(false);
  });

  it("does not add isolation headers on unrelated preview routes", () => {
    expect(shouldApplyMemoryLabHeaders("https://preview.maple-timer.pages.dev/")).toBe(false);
  });

  it("marks preview runtime assets as same-origin resources for the isolated lab", async () => {
    const response = await onRequest({
      request: new Request("https://preview.maple-timer.pages.dev/assets/buffExpiryPrecision.worker-dzuY4mPw.js"),
      next: async () => new Response("ok"),
    });

    expect(shouldApplyIsolatedPreviewResourceHeaders("https://preview.maple-timer.pages.dev/assets/main.js")).toBe(
      true,
    );
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(response.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(response.headers.get("Cross-Origin-Embedder-Policy")).toBe("credentialless");
    expect(shouldApplyIsolatedPreviewWorkerHeaders("https://preview.maple-timer.pages.dev/assets/main.js")).toBe(
      false,
    );
    expect(
      shouldApplyIsolatedPreviewWorkerHeaders(
        "https://preview.maple-timer.pages.dev/assets/buffExpiryPrecision.worker-dzuY4mPw.js",
      ),
    ).toBe(true);
  });

  it("does not mark production assets with diagnostic resource headers", () => {
    expect(shouldApplyIsolatedPreviewResourceHeaders("https://maple-timer.com/assets/main.js")).toBe(false);
  });
});
