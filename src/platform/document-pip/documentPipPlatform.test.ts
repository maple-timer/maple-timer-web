import { describe, expect, it, vi } from "vitest";
import { createBrowserDocumentPipPlatform } from "./documentPipPlatform";

describe("browser Document PiP platform", () => {
  it("reports support and delegates native window creation", async () => {
    const pipWindow = createPipWindow();
    const requestWindow = vi.fn().mockResolvedValue(pipWindow);
    const platform = createBrowserDocumentPipPlatform(() => ({
      documentPictureInPicture: { requestWindow },
    } as unknown as Window & {
      documentPictureInPicture: { requestWindow: typeof requestWindow };
    }));

    expect(platform.isSupported()).toBe(true);
    await expect(
      platform.requestWindow({ width: 320, height: 180 }),
    ).resolves.toBe(pipWindow);
    expect(requestWindow).toHaveBeenCalledWith({ width: 320, height: 180 });
  });

  it("keeps unsupported-browser detection independent from presentation", async () => {
    const platform = createBrowserDocumentPipPlatform(() => null);

    expect(platform.isSupported()).toBe(false);
    await expect(platform.requestWindow()).rejects.toThrow(
      "Document Picture-in-Picture is unavailable.",
    );
  });

  it("creates the presentation mount host in the PiP document", () => {
    const pipDocument = document.implementation.createHTMLDocument("pip");
    const pipWindow = createPipWindow({ document: pipDocument });
    const platform = createBrowserDocumentPipPlatform(() => null);

    const host = platform.createMountHost(pipWindow, "maple-timer-pip-root");

    expect(host.id).toBe("maple-timer-pip-root");
    expect(pipDocument.body.contains(host)).toBe(true);
  });

  it("owns resize, close, and pagehide browser operations", () => {
    const resizeTo = vi.fn();
    const close = vi.fn();
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const pipWindow = createPipWindow({
      resizeTo,
      close,
      addEventListener,
      removeEventListener,
    });
    const platform = createBrowserDocumentPipPlatform(() => null);
    const onPageHide = vi.fn();

    expect(
      platform.tryResizeWindow(pipWindow, { width: 480, height: 270 }),
    ).toBe(true);
    expect(resizeTo).toHaveBeenCalledWith(480, 270);

    const unsubscribe = platform.onPageHide(pipWindow, onPageHide);
    expect(addEventListener).toHaveBeenCalledWith("pagehide", onPageHide, {
      once: true,
    });
    unsubscribe();
    expect(removeEventListener).toHaveBeenCalledWith("pagehide", onPageHide);

    platform.closeWindow(pipWindow);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not throw when a closed or browser-rejected window cannot resize", () => {
    const platform = createBrowserDocumentPipPlatform(() => null);
    const closedWindow = createPipWindow({ closed: true });
    const rejectedWindow = createPipWindow({
      resizeTo: vi.fn(() => {
        throw new Error("gesture expired");
      }),
    });

    expect(
      platform.tryResizeWindow(closedWindow, { width: 480, height: 270 }),
    ).toBe(false);
    expect(
      platform.tryResizeWindow(rejectedWindow, { width: 480, height: 270 }),
    ).toBe(false);
  });
});

function createPipWindow(overrides: Partial<Window> = {}): Window {
  return {
    closed: false,
    document,
    outerWidth: 0,
    outerHeight: 0,
    resizeTo: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    ...overrides,
  } as unknown as Window;
}
