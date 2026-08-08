import { createRef } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CaptureVideoHost } from "./CaptureVideoHost";

describe("CaptureVideoHost", () => {
  it("keeps the shared video element mounted for runtime sampling", () => {
    const videoRef = createRef<HTMLVideoElement>();
    const onMetadata = vi.fn();

    const { container } = render(
      <CaptureVideoHost videoRef={videoRef} onMetadata={onMetadata} />,
    );

    expect(videoRef.current).toBe(container.querySelector("video"));
    expect(container.querySelector(".capture-video-host")).toHaveAttribute("aria-hidden", "true");
  });

  it("notifies metadata updates from the hidden shared video", () => {
    const videoRef = createRef<HTMLVideoElement>();
    const onMetadata = vi.fn();
    const { container } = render(
      <CaptureVideoHost videoRef={videoRef} onMetadata={onMetadata} />,
    );

    const video = container.querySelector("video") as HTMLVideoElement;
    fireEvent.resize(video);

    expect(onMetadata).toHaveBeenCalledTimes(1);
  });
});
