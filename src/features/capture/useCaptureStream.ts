import { useCallback, useEffect, useRef, useState } from "react";
import type { CaptureStatus } from "../../captureTypes";
import { RECOMMENDED_BROWSER_LABEL } from "../../lib/browserSupport";

type CaptureSize = { width: number; height: number };

type UseCaptureStreamOptions = {
  onMessage?: (message: string | null) => void;
};

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

const displayMediaOptions: DisplayMediaStreamOptions = {
  video: {
    displaySurface: "window",
  },
  audio: false,
};

export function useCaptureStream({ onMessage }: UseCaptureStreamOptions = {}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("idle");
  const [captureSize, setCaptureSize] = useState<CaptureSize | null>(null);

  const handleEnded = useCallback(() => {
    streamRef.current = null;
    setStream(null);
    setCaptureStatus("idle");
    setCaptureSize(null);
  }, []);

  const requestCapture = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      onMessage?.(
        `이 브라우저는 화면 공유 캡처를 지원하지 않습니다. ${RECOMMENDED_BROWSER_LABEL}에서 다시 시도해 주세요.`,
      );
      return;
    }

    onMessage?.(null);
    setCaptureStatus("starting");
    setCaptureSize(null);

    try {
      const mediaStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
      mediaStream.getVideoTracks()[0]?.addEventListener("ended", handleEnded, { once: true });
      stopTracks(streamRef.current);
      streamRef.current = mediaStream;
      setStream(mediaStream);
      setCaptureStatus("active");
    } catch (error) {
      setCaptureStatus("idle");
      onMessage?.(error instanceof Error ? error.message : "화면 공유를 시작하지 못했습니다.");
    }
  }, [handleEnded, onMessage]);

  const startCapture = useCallback(async () => {
    await requestCapture();
  }, [requestCapture]);

  const stopCapture = useCallback(() => {
    stopTracks(streamRef.current);
    streamRef.current = null;
    setStream(null);
    setCaptureStatus("idle");
    setCaptureSize(null);
  }, []);

  const changeCapture = useCallback(async () => {
    stopTracks(streamRef.current);
    streamRef.current = null;
    setStream(null);
    setCaptureSize(null);
    await requestCapture();
  }, [requestCapture]);

  const handleMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      return;
    }
    setCaptureSize((current) =>
      current?.width === video.videoWidth && current.height === video.videoHeight
        ? current
        : { width: video.videoWidth, height: video.videoHeight },
    );
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.srcObject = stream;
    if (stream) {
      video.play().catch(() => {
        onMessage?.("브라우저가 미리보기 재생을 보류했습니다.");
      });
    }
  }, [onMessage, stream]);

  useEffect(() => {
    return () => stopTracks(streamRef.current);
  }, []);

  return {
    videoRef,
    stream,
    captureStatus,
    captureSize,
    startCapture,
    changeCapture,
    stopCapture,
    handleMetadata,
  };
}
