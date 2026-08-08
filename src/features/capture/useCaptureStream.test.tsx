import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCaptureStream } from "./useCaptureStream";

type FakeStream = MediaStream & {
  stopSpy: ReturnType<typeof vi.fn>;
};

function makeStream(): FakeStream {
  const stopSpy = vi.fn();
  const track = {
    stop: stopSpy,
    addEventListener: vi.fn(),
  };
  return {
    stopSpy,
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as FakeStream;
}

function Harness() {
  const { captureStatus, startCapture, changeCapture } = useCaptureStream();
  return (
    <>
      <button type="button" onClick={() => void startCapture()}>
        start
      </button>
      <button type="button" onClick={() => void changeCapture()}>
        change
      </button>
      <span data-testid="status">{captureStatus}</span>
    </>
  );
}

describe("useCaptureStream", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("stops the previous stream when changing capture source", async () => {
    const firstStream = makeStream();
    const secondStream = makeStream();
    const getDisplayMedia = vi
      .fn()
      .mockResolvedValueOnce(firstStream)
      .mockResolvedValueOnce(secondStream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia },
    });

    render(<Harness />);

    fireEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("active"));

    fireEvent.click(screen.getByText("change"));
    await waitFor(() => expect(getDisplayMedia).toHaveBeenCalledTimes(2));

    expect(firstStream.stopSpy).toHaveBeenCalledTimes(1);
  });

  it("requests a window display surface as the preferred capture source", async () => {
    const stream = makeStream();
    const getDisplayMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia },
    });

    render(<Harness />);

    fireEvent.click(screen.getByText("start"));
    await waitFor(() => expect(getDisplayMedia).toHaveBeenCalledTimes(1));

    expect(getDisplayMedia).toHaveBeenCalledWith({
      video: {
        displaySurface: "window",
      },
      audio: false,
    });
  });
});
