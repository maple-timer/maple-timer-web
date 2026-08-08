import type { RefObject } from "react";

export function CaptureVideoHost({
  videoRef,
  onMetadata,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  onMetadata: () => void;
}) {
  return (
    <div className="capture-video-host" aria-hidden="true">
      <video
        ref={videoRef}
        muted
        playsInline
        onLoadedMetadata={onMetadata}
        onPlaying={onMetadata}
        onResize={onMetadata}
      />
    </div>
  );
}
