import { afterEach, describe, expect, it, vi } from "vitest";
import { postDebugSample } from "./reportClient";

describe("postDebugSample", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries without the full frame image when the sample is too large", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "sample is too large" }, 413))
      .mockResolvedValueOnce(jsonResponse({ id: "sample-1" }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await postDebugSample(
      {
        kind: "buff-expiry-issue",
        sample: {
          rawDataUrl: "data:image/png;base64,raw",
          processedDataUrl: "data:image/png;base64,processed",
          fullFrameDataUrl: "data:image/png;base64,full",
        },
      },
      "제보 전송에 실패했습니다.",
    );

    expect(result).toEqual({ id: "sample-1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(retryBody.sample).toMatchObject({
      rawDataUrl: "data:image/png;base64,raw",
      processedDataUrl: "data:image/png;base64,processed",
      fullFrameDataUrl: null,
      fullFrameDataUrlDropped: true,
    });
  });

  it("drops the full frame before posting when the payload is already near the API limit", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ id: "sample-1" }, 200));
    vi.stubGlobal("fetch", fetchMock);

    await postDebugSample(
      {
        kind: "buff-expiry-issue",
        sample: {
          rawDataUrl: "data:image/png;base64,raw",
          processedDataUrl: "data:image/png;base64,processed",
          fullFrameDataUrl: `data:image/png;base64,${"A".repeat(3_800_000)}`,
        },
      },
      "제보 전송에 실패했습니다.",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const postedBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(postedBody.sample.fullFrameDataUrl).toBeNull();
    expect(postedBody.sample.fullFrameDataUrlDropped).toBe(true);
  });

  it("retries by dropping optional history media even without a full-frame image", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "sample is too large" }, 413))
      .mockResolvedValueOnce(jsonResponse({ id: "sample-2" }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const optionalHistoryImage = `data:image/png;base64,${"A".repeat(3_200_000)}`;
    const result = await postDebugSample(
      {
        kind: "hunt-stall-issue",
        sample: {
          rawDataUrl: "data:image/png;base64,raw",
          processedDataUrl: "data:image/png;base64,processed",
          cropHistory: [{ rawDataUrl: optionalHistoryImage }],
        },
      },
      "제보 전송에 실패했습니다.",
    );

    expect(result).toEqual({ id: "sample-2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(retryBody.sample.cropHistory[0].rawDataUrl).toBeNull();
    expect(retryBody.reportPayloadBudget).toMatchObject({
      targetBytes: 3 * 1024 * 1024,
      overTarget: false,
    });
  });

  it("strips image data snapshots before posting", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ id: "sample-1" }, 200));
    vi.stubGlobal("fetch", fetchMock);

    await postDebugSample(
      {
        kind: "rune-issue",
        sample: {
          rawDataUrl: "data:image/png;base64,raw",
          processedDataUrl: "data:image/png;base64,processed",
        },
        rune: {
          lastSnapshot: {
            rawPreviewImageData: {
              width: 2,
              height: 2,
              data: { 0: 255, 1: 0, 2: 255, 3: 255 },
            },
            candidatePreviewImageData: {
              width: 1,
              height: 1,
              data: { 0: 255, 1: 0, 2: 255, 3: 255 },
            },
            candidate: { x: 1, y: 2, width: 10, height: 10 },
          },
        },
      },
      "제보 전송에 실패했습니다.",
    );

    const postedBodyText = fetchMock.mock.calls[0][1].body;
    const postedBody = JSON.parse(postedBodyText);
    expect(postedBodyText).not.toContain("rawPreviewImageData");
    expect(postedBodyText).not.toContain("candidatePreviewImageData");
    expect(postedBody.rune.lastSnapshot.candidate).toEqual({ x: 1, y: 2, width: 10, height: 10 });
  });
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
