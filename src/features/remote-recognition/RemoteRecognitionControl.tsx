import { Button } from "@astryxdesign/core/Button";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { CloudCog } from "lucide-react";
import type { RemoteRecognitionSessionSnapshot } from "../../application/remote-recognition/remoteRecognitionSessionController";
import type { RemoteRecognitionFrameProbeReadiness } from "../../application/remote-recognition/remoteRecognitionFrameProbeSource";
import {
  PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
  type PrecisionParserInputTransport,
} from "../../contracts/recognition/precisionParserInputTransport";

export function RemoteRecognitionControl({
  snapshot,
  readiness,
  parserInputTransport,
  onOpenSetup,
  onStop,
}: {
  snapshot: RemoteRecognitionSessionSnapshot;
  readiness: RemoteRecognitionFrameProbeReadiness;
  parserInputTransport?: PrecisionParserInputTransport;
  onOpenSetup(): void;
  onStop(): void | Promise<void>;
}) {
  const isReady = snapshot.phase === "ready";
  const isBusy = [
    "checking",
    "reserving",
    "probing",
    "activating",
    "stopping",
  ].includes(snapshot.phase);
  const presentation = getControlPresentation(
    snapshot,
    readiness,
    parserInputTransport,
  );
  const isInputReady = readiness === "ready";
  const recentE2eMs =
    isReady &&
    parserInputTransport === PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW
      ? snapshot.parserFrames.lastE2eMs
      : null;

  return (
    <section className="remote-recognition-control" aria-label="원격 처리 연결">
      <span className="remote-recognition-control-icon" aria-hidden="true">
        <CloudCog size={18} />
      </span>
      <section className="remote-recognition-control-copy">
        <Text as="p" type="label" weight="semibold">
          원격 처리 연결
        </Text>
        <Text as="p" type="supporting" color="secondary">
          {presentation.description}
        </Text>
      </section>
      <span className="remote-recognition-control-runtime">
        {isReady && snapshot.identity ? (
          <Text
            as="span"
            type="supporting"
            color="secondary"
            className="remote-recognition-control-identity"
          >
            {snapshot.identity.betaAlias} · {snapshot.identity.connectionCode}
          </Text>
        ) : null}
        {recentE2eMs !== null ? (
          <Text
            as="span"
            type="supporting"
            color="secondary"
            className="remote-recognition-control-e2e"
          >
            최근 전송 E2E {Math.round(recentE2eMs)}ms
          </Text>
        ) : null}
        <span className="remote-recognition-control-status">
          <StatusDot
            variant={presentation.variant}
            label={presentation.label}
            isPulsing={isBusy}
          />
          <Text type="supporting" color="secondary">
            {presentation.label}
          </Text>
        </span>
      </span>
      <span className="remote-recognition-control-actions">
        {isReady ? (
          <Button label="설정" variant="secondary" onClick={onOpenSetup} />
        ) : null}
        <Switch
          label="원격 처리 연결"
          isLabelHidden
          value={isReady}
          isLoading={isBusy}
          isDisabled={!isReady && !isInputReady}
          disabledMessage={
            readiness === "screen-share-required"
              ? "먼저 화면을 공유해주세요."
              : readiness === "game-viewport-required"
                ? "먼저 게임 화면 영역을 확인해주세요."
                : undefined
          }
          onChange={(checked) => {
            if (checked) {
              onOpenSetup();
              return;
            }
            void onStop();
          }}
        />
      </span>
    </section>
  );
}

function getControlPresentation(
  snapshot: RemoteRecognitionSessionSnapshot,
  readiness: RemoteRecognitionFrameProbeReadiness,
  parserInputTransport?: PrecisionParserInputTransport,
): {
  label: string;
  description: string;
  variant: "success" | "warning" | "error" | "accent" | "neutral";
} {
  if (snapshot.phase === "ready") {
    if (
      parserInputTransport === PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW
    ) {
      return {
        label: "원격 처리 중",
        description:
          "정밀 기능의 parser는 원격 서버에서, 이후 판독과 알림은 이 기기에서 처리합니다.",
        variant: "accent",
      };
    }
    return {
      label: "연결 확인됨",
      description: "실제 화면 분석을 확인했습니다. 현재 알림은 아직 이 기기에서 처리합니다.",
      variant: "success",
    };
  }
  if (
    snapshot.phase === "checking" ||
    snapshot.phase === "reserving" ||
    snapshot.phase === "probing" ||
    snapshot.phase === "activating" ||
    snapshot.phase === "stopping"
  ) {
    return {
      label: snapshot.phase === "stopping" ? "연결 해제 중" : "확인 중",
      description: "원격 서버 상태와 현재 사용할 수 있는 자리를 확인하고 있습니다.",
      variant: "accent",
    };
  }
  if (snapshot.phase === "failed") {
    if (snapshot.failure?.code === "session-frame-idle") {
      return {
        label: "자동 연결 해제",
        description:
          "오랫동안 사용하지 않아 연결을 잠시 꺼두었습니다. 다시 연결하면 이어서 사용할 수 있습니다.",
        variant: "warning",
      };
    }
    return {
      label: "확인 필요",
      description: "연결 준비를 마치지 못했습니다. 다시 열어 결과를 확인해주세요.",
      variant: "error",
    };
  }
  if (readiness === "screen-share-required") {
    return {
      label: "화면 공유 필요",
      description: "실제 화면으로 서버 분석을 확인하려면 먼저 화면을 공유해주세요.",
      variant: "warning",
    };
  }
  if (readiness === "game-viewport-required") {
    return {
      label: "게임 화면 확인 필요",
      description: "게임 화면 영역을 확인한 뒤 실제 화면 분석을 시작할 수 있습니다.",
      variant: "warning",
    };
  }
  return {
    label: "연결 안 됨",
    description: "화면 분석에 필요한 무거운 연산을 원격에서 처리합니다.",
    variant: "neutral",
  };
}
