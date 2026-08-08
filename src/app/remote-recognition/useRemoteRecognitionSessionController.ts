import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ResolvedGameViewport } from "../../contracts/geometry/frameSource";
import {
  RemoteRecognitionSessionController,
  type RemoteRecognitionSessionSnapshot,
} from "../../application/remote-recognition/remoteRecognitionSessionController";
import type { RemoteRecognitionFrameProbeReadiness } from "../../application/remote-recognition/remoteRecognitionFrameProbeSource";
import {
  appBuildInfo,
  formatAppBuildInfo,
} from "../../platform/runtime-build/currentAppBuildInfo";
import { browserRemoteRecognitionControlClient } from "../../platform/remote-recognition/remoteRecognitionControlClient";
import { browserRemoteRecognitionClientIdentity } from "../../platform/remote-recognition/browserRemoteRecognitionClientIdentity";
import { SharedMonitoringRemoteRecognitionFrameProbeSource } from "../../platform/remote-recognition/remoteRecognitionFrameProbeSource";
import { isRemoteRecognitionLabAvailable } from "../../features/remote-recognition/remoteRecognitionLabAvailability";
import type { RemoteRecognitionParserFrameProvider } from "../../contracts/remote-recognition/remoteRecognitionControlContract";
import type { REMOTE_RECOGNITION_READINESS_CONSENT_VERSION } from "../../contracts/remote-recognition/remoteRecognitionControlContract";
import type { MonitoringFrameContext } from "../../runtime/monitoring/monitoringFrameContext";
import {
  createRemoteRecognitionV1ClientFaultDecorator,
  type RemoteRecognitionV1ClientFaultDecoratorOptions,
  type RemoteRecognitionV1ParserFramePort,
} from "../../application/remote-recognition/remoteRecognitionV1ClientFaultDecorator";

const REMOTE_RECOGNITION_CONTROL_RUNTIME_VERSION =
  "browser-vp8-parser-provider-v1";

export type RemoteRecognitionSessionBinding = {
  isAvailable: boolean;
  readiness: RemoteRecognitionFrameProbeReadiness;
  snapshot: RemoteRecognitionSessionSnapshot;
  start(
    accessCode: string,
    readinessConsentVersion: typeof REMOTE_RECOGNITION_READINESS_CONSENT_VERSION,
  ): Promise<void>;
  stop(): Promise<void>;
  acceptMonitoringFrame(context: MonitoringFrameContext | null): void;
  setParserProviderConsent(consented: boolean): void;
  setParserProviderEnabled(enabled: boolean): void;
  failParserProvider(error: unknown, sampledAt?: number | null): Promise<void>;
  analyzeParserFrame: RemoteRecognitionParserFrameProvider;
};

export function useRemoteRecognitionSessionController({
  gameViewport,
  stream,
}: {
  gameViewport: ResolvedGameViewport | null;
  stream: MediaStream | null;
}): RemoteRecognitionSessionBinding {
  const search = typeof window === "undefined" ? "" : window.location.search;
  const isAvailable = isRemoteRecognitionLabAvailable({
    buildInfo: appBuildInfo,
    search,
    environmentEnabled:
      import.meta.env.VITE_REMOTE_RECOGNITION_CONTROL_ENABLED === "1",
  });
  const readiness: RemoteRecognitionFrameProbeReadiness = !stream?.active
    ? "screen-share-required"
    : !gameViewport
      ? "game-viewport-required"
      : "ready";
  const frameSource = useMemo(
    () => new SharedMonitoringRemoteRecognitionFrameProbeSource(),
    [gameViewport, stream],
  );
  const v1ParserFrameFaultPort =
    useStableRemoteRecognitionV1ClientFaultDecorator({
      port: browserRemoteRecognitionControlClient,
      compileTimeArm:
        typeof __REMOTE_RECOGNITION_V1_TEST_ARM__ === "boolean" &&
        __REMOTE_RECOGNITION_V1_TEST_ARM__,
      buildInfo: appBuildInfo,
      reviewedCommit:
        typeof __REMOTE_RECOGNITION_V1_REVIEWED_COMMIT__ === "string"
          ? __REMOTE_RECOGNITION_V1_REVIEWED_COMMIT__
          : "",
      reviewedBranch:
        typeof __REMOTE_RECOGNITION_V1_REVIEWED_BRANCH__ === "string"
          ? __REMOTE_RECOGNITION_V1_REVIEWED_BRANCH__
          : "",
      labAvailable: isAvailable,
      search,
    });
  const controller = useMemo(
    () =>
      new RemoteRecognitionSessionController(
        browserRemoteRecognitionControlClient,
        frameSource,
        {
          appBuild: formatAppBuildInfo(appBuildInfo),
          channel:
            appBuildInfo.channel === "local"
              ? "development"
              : appBuildInfo.channel,
          runtimeVersion: REMOTE_RECOGNITION_CONTROL_RUNTIME_VERSION,
          getClientInstanceId: () =>
            browserRemoteRecognitionClientIdentity.getClientInstanceId(),
          createAdmissionAttemptId: () =>
            browserRemoteRecognitionClientIdentity.createAdmissionAttemptId(),
        },
        undefined,
        undefined,
        v1ParserFrameFaultPort ?? undefined,
      ),
    [frameSource, v1ParserFrameFaultPort],
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    if (!isAvailable) {
      frameSource.clear();
      void controller.stop();
      return;
    }
    const handlePageHide = () => {
      void controller.stop();
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      frameSource.clear();
      void controller.stop();
    };
  }, [controller, frameSource, isAvailable]);

  const start = useCallback(
    (
      accessCode: string,
      readinessConsentVersion: typeof REMOTE_RECOGNITION_READINESS_CONSENT_VERSION,
    ) => controller.start(accessCode, readinessConsentVersion),
    [controller],
  );
  const stop = useCallback(() => controller.stop(), [controller]);
  const acceptMonitoringFrame = useCallback(
    (context: MonitoringFrameContext | null) => {
      if (
        !context?.gameViewport ||
        !gameViewport ||
        !isAvailable ||
        !isSameGameViewport(context.gameViewport, gameViewport)
      ) {
        return;
      }
      frameSource.offerFrame({
        sampledAt: context.sampledAt,
        capture: () => {
          const frame = context.sampleBuffSlotFrame({ includePreview: false });
          return { imageData: frame.imageData, roi: frame.roi };
        },
      });
    },
    [frameSource, gameViewport, isAvailable],
  );
  const setParserProviderConsent = useCallback(
    (consented: boolean) => controller.setParserProviderConsent(consented),
    [controller],
  );
  const setParserProviderEnabled = useCallback(
    (enabled: boolean) => controller.setParserProviderEnabled(enabled),
    [controller],
  );
  const failParserProvider = useCallback(
    (error: unknown, sampledAt?: number | null) =>
      controller.failParserProvider(error, sampledAt),
    [controller],
  );
  const analyzeParserFrame = useCallback<RemoteRecognitionParserFrameProvider>(
    (request) => controller.analyzeParserFrame(request),
    [controller],
  );

  return {
    isAvailable,
    readiness,
    snapshot,
    start,
    stop,
    acceptMonitoringFrame,
    setParserProviderConsent,
    setParserProviderEnabled,
    failParserProvider,
    analyzeParserFrame,
  };
}

export function useStableRemoteRecognitionV1ClientFaultDecorator(
  options: RemoteRecognitionV1ClientFaultDecoratorOptions,
): RemoteRecognitionV1ParserFramePort | null {
  const [port] = useState(() =>
    createRemoteRecognitionV1ClientFaultDecorator(options),
  );
  return port;
}

function isSameGameViewport(
  left: ResolvedGameViewport,
  right: ResolvedGameViewport,
): boolean {
  return (
    left.revision === right.revision &&
    left.layoutKey === right.layoutKey &&
    left.sourceSize.width === right.sourceSize.width &&
    left.sourceSize.height === right.sourceSize.height &&
    left.region.x === right.region.x &&
    left.region.y === right.region.y &&
    left.region.width === right.region.width &&
    left.region.height === right.region.height
  );
}
