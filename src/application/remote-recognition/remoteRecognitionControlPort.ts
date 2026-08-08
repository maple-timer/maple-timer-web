import type {
  RemoteRecognitionAdmissionRequest,
  RemoteRecognitionAdmissionResponse,
  RemoteRecognitionFrameProbePayload,
  RemoteRecognitionFrameProbeResponse,
  RemoteRecognitionHeartbeatResponse,
  RemoteRecognitionParserFramePayload,
  RemoteRecognitionParserFrameResponse,
  RemoteRecognitionProbeResponse,
  RemoteRecognitionReleaseResponse,
  RemoteRecognitionServiceStatusResponse,
  RemoteRecognitionSessionResponse,
} from "../../contracts/remote-recognition/remoteRecognitionControlContract";
import type { RemoteRecognitionClientTelemetryReport } from "../../contracts/remote-recognition/remoteRecognitionClientTelemetry";

export type RemoteRecognitionControlRequestOptions = {
  signal?: AbortSignal;
  clientTelemetry?: RemoteRecognitionClientTelemetryReport;
};

export interface RemoteRecognitionControlPort {
  getStatus(
    options?: RemoteRecognitionControlRequestOptions,
  ): Promise<RemoteRecognitionServiceStatusResponse>;
  createAdmission(
    request: RemoteRecognitionAdmissionRequest,
    options?: RemoteRecognitionControlRequestOptions,
  ): Promise<RemoteRecognitionAdmissionResponse>;
  probeAdmission(
    admissionId: string,
    admissionToken: string,
    options?: RemoteRecognitionControlRequestOptions,
  ): Promise<RemoteRecognitionProbeResponse>;
  probeAdmissionFrame(
    admissionId: string,
    admissionToken: string,
    frame: RemoteRecognitionFrameProbePayload,
    options?: RemoteRecognitionControlRequestOptions,
  ): Promise<RemoteRecognitionFrameProbeResponse>;
  promoteAdmission(
    admissionId: string,
    admissionToken: string,
    options?: RemoteRecognitionControlRequestOptions,
  ): Promise<RemoteRecognitionSessionResponse>;
  cancelAdmission(
    admissionId: string,
    admissionToken: string,
    options?: RemoteRecognitionControlRequestOptions,
  ): Promise<RemoteRecognitionReleaseResponse>;
  heartbeatSession(
    sessionId: string,
    sessionToken: string,
    options?: RemoteRecognitionControlRequestOptions,
  ): Promise<RemoteRecognitionHeartbeatResponse>;
  analyzeSessionParserFrame(
    sessionId: string,
    sessionToken: string,
    frame: RemoteRecognitionParserFramePayload,
    options?: RemoteRecognitionControlRequestOptions,
  ): Promise<RemoteRecognitionParserFrameResponse>;
  stopSession(
    sessionId: string,
    sessionToken: string,
    options?: RemoteRecognitionControlRequestOptions,
  ): Promise<RemoteRecognitionReleaseResponse>;
}

export type RemoteRecognitionParserFrameControlPort = Pick<
  RemoteRecognitionControlPort,
  "analyzeSessionParserFrame"
>;
