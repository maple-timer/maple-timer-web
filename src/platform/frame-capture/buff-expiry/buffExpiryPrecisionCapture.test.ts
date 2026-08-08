import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBuffExpiryPrecisionDiagnosticRoiPreview,
  sampleBuffExpiryPrecisionVideoFrame,
} from "./buffExpiryPrecisionCapture";

describe("buff expiry precision frame capture", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the full-frame sample and preview scaling contract", () => {
    const source = createCanvasStub("data:image/png;base64,raw");
    const preview = createCanvasStub("data:image/png;base64,full");
    const imageData = {
      width: 1920,
      height: 1080,
      data: new Uint8ClampedArray([1, 2, 3, 4]),
    } as ImageData;
    source.context.getImageData.mockReturnValue(imageData);
    mockCanvasCreation([source.canvas, preview.canvas]);
    const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;

    const result = sampleBuffExpiryPrecisionVideoFrame(video, true, true);

    expect(source.canvas.width).toBe(1920);
    expect(source.canvas.height).toBe(1080);
    expect(source.context.imageSmoothingEnabled).toBe(false);
    expect(source.context.drawImage).toHaveBeenCalledWith(video, 0, 0, 1920, 1080);
    expect(source.context.getImageData).toHaveBeenCalledWith(0, 0, 1920, 1080);
    expect(source.canvas.toDataURL).toHaveBeenCalledWith("image/png");
    expect(preview.canvas.width).toBe(960);
    expect(preview.canvas.height).toBe(540);
    expect(preview.context.imageSmoothingEnabled).toBe(true);
    expect(preview.context.drawImage).toHaveBeenCalledWith(source.canvas, 0, 0, 960, 540);
    expect(preview.canvas.toDataURL).toHaveBeenCalledWith("image/png");
    expect(result).toEqual({
      imageData,
      roi: { x: 0, y: 0, width: 1920, height: 1080 },
      rawPreviewUrl: "data:image/png;base64,raw",
      fullFramePreviewUrl: "data:image/png;base64,full",
    });
  });

  it("keeps diagnostic ROI coordinates and WebP quality", () => {
    const crop = createCanvasStub("data:image/webp;base64,roi");
    mockCanvasCreation([crop.canvas]);
    const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;

    const result = createBuffExpiryPrecisionDiagnosticRoiPreview(video);

    expect(crop.canvas.width).toBe(1037);
    expect(crop.canvas.height).toBe(389);
    expect(crop.context.imageSmoothingEnabled).toBe(false);
    expect(crop.context.drawImage).toHaveBeenCalledWith(
      video,
      883,
      0,
      1037,
      389,
      0,
      0,
      1037,
      389,
    );
    expect(crop.canvas.toDataURL).toHaveBeenCalledWith("image/webp", 0.82);
    expect(result).toEqual({
      sourceSize: { width: 1920, height: 1080 },
      roi: { x: 883, y: 0, width: 1037, height: 389 },
      imageDataUrl: "data:image/webp;base64,roi",
    });
  });
});

function createCanvasStub(dataUrl: string) {
  const context = {
    imageSmoothingEnabled: true,
    drawImage: vi.fn(),
    getImageData: vi.fn(),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toDataURL: vi.fn(() => dataUrl),
  } as unknown as HTMLCanvasElement;
  return { canvas, context };
}

function mockCanvasCreation(canvases: HTMLCanvasElement[]): void {
  const queue = [...canvases];
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
    if (tagName !== "canvas") {
      throw new Error(`unexpected-element:${tagName}`);
    }
    const canvas = queue.shift();
    if (!canvas) {
      throw new Error("missing-canvas-stub");
    }
    return canvas;
  }) as typeof document.createElement);
}
