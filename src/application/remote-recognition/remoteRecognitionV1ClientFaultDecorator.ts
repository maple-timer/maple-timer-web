import type { AppBuildInfo } from "../../contracts/deployment/appBuildInfo";
import { isValidRemoteRecognitionV1ReviewedBranch } from "../../contracts/deployment/remoteRecognitionV1TestArm";
import { RemoteRecognitionControlContractError } from "../../contracts/remote-recognition/remoteRecognitionControlContract";
import type { RemoteRecognitionParserFrameControlPort } from "./remoteRecognitionControlPort";

export const REMOTE_RECOGNITION_V1_PARSER_FRAME_FAILURE_QUERY =
  "remote-recognition-v1-parser-frame-failures";

export type RemoteRecognitionV1ParserFramePort =
  RemoteRecognitionParserFrameControlPort;

export type RemoteRecognitionV1ClientFaultDecoratorOptions = {
  port: RemoteRecognitionV1ParserFramePort;
  compileTimeArm: boolean;
  buildInfo: AppBuildInfo;
  reviewedCommit: string;
  reviewedBranch: string;
  labAvailable: boolean;
  search: string;
};

const FULL_LOWERCASE_COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const SHORT_COMMIT_LENGTH = 7;
const INJECTED_FAILURE_MESSAGE =
  "remote-recognition-v1-parser-frame-failure-injected";

export function createRemoteRecognitionV1ClientFaultDecorator({
  port,
  compileTimeArm,
  buildInfo,
  reviewedCommit,
  reviewedBranch,
  labAvailable,
  search,
}: RemoteRecognitionV1ClientFaultDecoratorOptions): RemoteRecognitionV1ParserFramePort | null {
  const failureCount = parseFailureCount(search);
  if (
    compileTimeArm !== true ||
    buildInfo.remoteRecognitionV1TestArm !== true ||
    buildInfo.channel !== "preview" ||
    buildInfo.name !== "maple-timer" ||
    !FULL_LOWERCASE_COMMIT_PATTERN.test(buildInfo.commitSha) ||
    !FULL_LOWERCASE_COMMIT_PATTERN.test(reviewedCommit) ||
    buildInfo.commitSha !== reviewedCommit ||
    buildInfo.shortCommit !== reviewedCommit.slice(0, SHORT_COMMIT_LENGTH) ||
    !isValidRemoteRecognitionV1ReviewedBranch(reviewedBranch) ||
    buildInfo.branch !== reviewedBranch ||
    labAvailable !== true ||
    failureCount === null
  ) {
    return null;
  }

  let remainingFailures: 0 | 1 | 2 | 3 = failureCount;
  let faultSessionId: string | null = null;
  return Object.freeze({
    analyzeSessionParserFrame(sessionId, sessionToken, frame, options) {
      if (remainingFailures > 0) {
        if (faultSessionId === null) {
          faultSessionId = sessionId;
        } else if (faultSessionId !== sessionId) {
          remainingFailures = 0;
          return port.analyzeSessionParserFrame(
            sessionId,
            sessionToken,
            frame,
            options,
          );
        }
        remainingFailures = decrementRemainingFailures(remainingFailures);
        return Promise.reject(
          new RemoteRecognitionControlContractError(
            "network-error",
            "transport",
            true,
            null,
            INJECTED_FAILURE_MESSAGE,
          ),
        );
      }
      return port.analyzeSessionParserFrame(
        sessionId,
        sessionToken,
        frame,
        options,
      );
    },
  });
}

function decrementRemainingFailures(value: 0 | 1 | 2 | 3): 0 | 1 | 2 {
  if (value === 3) {
    return 2;
  }
  if (value === 2) {
    return 1;
  }
  return 0;
}

function parseFailureCount(search: string): 1 | 2 | 3 | null {
  const values = new URLSearchParams(search).getAll(
    REMOTE_RECOGNITION_V1_PARSER_FRAME_FAILURE_QUERY,
  );
  if (values.length !== 1) {
    return null;
  }
  if (values[0] === "1") {
    return 1;
  }
  if (values[0] === "2") {
    return 2;
  }
  return values[0] === "3" ? 3 : null;
}
