import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { ChatToolCalls, type ChatToolCallItem } from "@astryxdesign/core/Chat";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack } from "@astryxdesign/core/HStack";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  ClipboardCopy,
  CloudCog,
  Gauge,
  PencilLine,
  Unplug,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  RemoteRecognitionSessionSnapshot,
  RemoteRecognitionProbeDiagnostics,
  RemoteRecognitionSetupFailure,
  RemoteRecognitionSetupPhase,
} from "../../application/remote-recognition/remoteRecognitionSessionController";
import type { RemoteRecognitionFrameProbeReadiness } from "../../application/remote-recognition/remoteRecognitionFrameProbeSource";
import {
  REMOTE_RECOGNITION_READINESS_CONSENT_VERSION,
  type RemoteRecognitionConnectionIdentity,
} from "../../contracts/remote-recognition/remoteRecognitionControlContract";
import { CompactMetricCell } from "../../shared/components/CompactMetricCell";
import {
  PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
  type PrecisionParserInputTransport,
  type PrecisionParserInputTransportDiagnostics,
} from "../../contracts/recognition/precisionParserInputTransport";

type SetupStepId =
  | "capture"
  | "network"
  | "service"
  | "admission"
  | "probe"
  | "session";

const SETUP_STEPS: Array<{
  id: SetupStepId;
  /** Short monospace token in the tool-name slot, like `bash` or `edit`. */
  token: string;
  /** Resting secondary text beside the token. */
  object: string;
  /** Secondary text while this step is running. */
  runningText: string;
  description: string;
}> = [
  {
    id: "capture",
    token: "screen",
    object: "화면 공유·게임 영역",
    runningText: "게임 화면 확인 중",
    description: "분석할 게임 화면 영역이 준비됐는지 확인합니다.",
  },
  {
    id: "network",
    token: "network",
    object: "사이트 연결",
    runningText: "사이트 연결 확인 중",
    description: "원격 처리 준비 요청을 보낼 수 있는지 확인합니다.",
  },
  {
    id: "service",
    token: "server",
    object: "원격 서버 상태",
    runningText: "서버 상태 확인 중",
    description: "서버가 현재 요청을 받을 수 있는지 확인합니다.",
  },
  {
    id: "admission",
    token: "invite",
    object: "초대 코드·서버 자리",
    runningText: "초대 코드 유효성·남는 자리 확인 중",
    description:
      "초대 코드의 유효성, 기존 연결의 사용 여부, 서버에 남는 자리를 확인합니다.",
  },
  {
    id: "probe",
    token: "probe",
    object: "우상단 버프 영역 분석",
    runningText: "실제 화면 분석 중",
    description: "우상단 버프 영역을 1초 간격으로 다섯 번 분석합니다.",
  },
  {
    id: "session",
    token: "session",
    object: "임시 연결 준비",
    runningText: "임시 연결 준비 중",
    description: "이 페이지에서 사용할 임시 연결을 준비합니다.",
  },
];

type SetupDialogView = "input" | "progress";

/** Failures the user fixes by re-entering or freeing the invite code. */
const CODE_FAILURE_CODES = new Set([
  "not-entitled",
  "access-code-in-use",
  "client-reconnect-busy",
]);

function isCodeFailure(
  failure: RemoteRecognitionSetupFailure | null,
): boolean {
  return failure !== null && CODE_FAILURE_CODES.has(failure.code);
}

export function RemoteRecognitionSetupDialog({
  isOpen,
  readiness,
  snapshot,
  parserInputTransport,
  parserInputTransportDiagnostics,
  onStart,
  onStop,
  onParserProviderConsentChange,
  onVp8ParserPreviewChange,
  onClose,
}: {
  isOpen: boolean;
  readiness: RemoteRecognitionFrameProbeReadiness;
  snapshot: RemoteRecognitionSessionSnapshot;
  parserInputTransport: PrecisionParserInputTransport;
  parserInputTransportDiagnostics: PrecisionParserInputTransportDiagnostics;
  onStart(
    accessCode: string,
    readinessConsentVersion: typeof REMOTE_RECOGNITION_READINESS_CONSENT_VERSION,
  ): Promise<void>;
  onStop(): Promise<void>;
  onParserProviderConsentChange(consented: boolean): void;
  onVp8ParserPreviewChange(enabled: boolean): void;
  onClose(): void;
}) {
  const [accessCode, setAccessCode] = useState("");
  const [hasReadinessConsent, setHasReadinessConsent] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [view, setView] = useState<SetupDialogView>("input");
  const [wantsProviderOnReady, setWantsProviderOnReady] = useState(true);
  const isBusy = isBusyPhase(snapshot.phase);
  const isReady = snapshot.phase === "ready";
  const isFailed = snapshot.phase === "failed";
  const hasParserProviderConsent =
    snapshot.parserProvider.consentVersion !== null;
  const isVp8PreviewActive =
    parserInputTransport === PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW;
  const canStart =
    readiness === "ready" &&
    accessCode.trim().length > 0 &&
    hasReadinessConsent &&
    hasParserProviderConsent &&
    !isBusy;

  // The dialog has two views following the actual flow: entering the code
  // and consenting first, then watching the checks run. Code-shaped
  // failures return to the input view; infrastructure failures stay on the
  // progress view where retrying is the fix.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (isBusyPhase(snapshot.phase) || snapshot.phase === "ready") {
      setView("progress");
      return;
    }
    if (snapshot.phase === "failed") {
      setView(isCodeFailure(snapshot.failure) ? "input" : "progress");
    }
  }, [isOpen, snapshot.phase, snapshot.failure]);

  // The input page collects the ongoing-use intent up front; when the
  // checks finish, apply it once at the moment the session becomes ready.
  const previousPhaseRef = useRef(snapshot.phase);
  useEffect(() => {
    const becameReady =
      previousPhaseRef.current !== "ready" && snapshot.phase === "ready";
    previousPhaseRef.current = snapshot.phase;
    if (
      becameReady &&
      wantsProviderOnReady &&
      hasParserProviderConsent &&
      !isVp8PreviewActive
    ) {
      onVp8ParserPreviewChange(true);
    }
  }, [
    snapshot.phase,
    wantsProviderOnReady,
    hasParserProviderConsent,
    isVp8PreviewActive,
    onVp8ParserPreviewChange,
  ]);

  const close = () => {
    if (isBusy) {
      void onStop();
    }
    onClose();
  };
  const start = async () => {
    setShowValidation(true);
    if (!canStart) {
      setView("input");
      return;
    }
    setView("progress");
    await onStart(
      accessCode.trim(),
      REMOTE_RECOGNITION_READINESS_CONSENT_VERSION,
    );
  };
  const stop = async () => {
    await onStop();
    onClose();
  };

  const failureBanner =
    isFailed && snapshot.failure ? (
      <Banner
        status="error"
        title={failureCopy(snapshot.failure).title}
        description={failureCopy(snapshot.failure).description}
        container="card"
      />
    ) : null;

  return (
    <Dialog
      isOpen={isOpen}
      aria-label="원격 처리 연결 준비"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          close();
        }
      }}
      purpose="required"
      width={640}
      maxHeight="82vh"
    >
      <Layout
        header={
          <DialogHeader
            title="원격 처리 연결 준비"
            subtitle={
              view === "input"
                ? "초대 사용자용 시험 기능"
                : "연결 확인 진행 상황"
            }
            startContent={<CloudCog size={19} aria-hidden="true" />}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) {
                close();
              }
            }}
          />
        }
        content={
          <LayoutContent>
            {view === "input" ? (
              <VStack gap={4}>
                <Banner
                  status="info"
                  title="준비 확인과 실사용 원격 처리는 별도로 동의합니다"
                  description="연결 확인을 시작하면 보정된 게임 화면의 우상단 1/4 영역을 1초 간격으로 5회 Maple Timer API를 거쳐 전용 원격 서버로 보냅니다. 일반 프레임은 저장하지 않으며, 실사용 원격 처리는 별도 동의 전에는 켜지지 않습니다."
                  container="card"
                />

                {readiness !== "ready" ? (
                  <Banner
                    status="warning"
                    title={
                      readiness === "screen-share-required"
                        ? "먼저 화면을 공유해주세요"
                        : "먼저 게임 화면 영역을 확인해주세요"
                    }
                    description="화면 준비가 끝나야 실제 파서 분석을 확인할 수 있습니다."
                    container="card"
                  />
                ) : null}

                {failureBanner}

                <section className="remote-recognition-setup-fields">
                  <TextInput
                    type="password"
                    label="초대 코드"
                    description="별도로 전달받은 원격 처리 시험 코드를 입력하세요. 초대 코드는 저장하지 않고, 같은 브라우저 재연결용 임의 식별자만 이 브라우저에 저장합니다."
                    value={accessCode}
                    onChange={setAccessCode}
                    placeholder="초대 코드 입력"
                    isRequired
                    isDisabled={isBusy}
                    status={
                      showValidation && accessCode.trim().length === 0
                        ? { type: "error", message: "초대 코드를 입력해주세요." }
                        : undefined
                    }
                  />
                  <CheckboxInput
                    label="준비 확인을 위한 화면 전송에 동의합니다"
                    description="보정된 게임 화면의 우상단 1/4 영역을 1초 간격으로 총 5회 전송해 실제 parser 준비 상태를 확인합니다."
                    value={hasReadinessConsent}
                    onChange={setHasReadinessConsent}
                    isRequired
                    isDisabled={isBusy}
                    status={
                      showValidation && !hasReadinessConsent
                        ? { type: "error", message: "안내를 확인해주세요." }
                        : undefined
                    }
                  />
                  <CheckboxInput
                    label="실사용 원격 처리에 동의합니다"
                    description="정밀 스킬·버프 종료·특수 코어 사용 중 보정된 게임 화면의 우상단 1/4 영역을 1초마다 Maple Timer API를 거쳐 전용 원격 서버로 전송합니다. 서버는 버프 칸 위치와 처리 정보만 반환하며 일반 프레임은 저장하지 않습니다."
                    value={hasParserProviderConsent}
                    onChange={onParserProviderConsentChange}
                    isRequired
                    isDisabled={isBusy}
                    status={
                      showValidation && !hasParserProviderConsent
                        ? { type: "error", message: "안내를 확인해주세요." }
                        : undefined
                    }
                  />
                  <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
                    <VStack gap={1}>
                      <Text as="p" type="label" weight="semibold">
                        실사용 원격 처리
                      </Text>
                      <Text as="p" type="supporting" color="secondary">
                        정밀 스킬·버프 종료·특수 코어의 parser만 원격 서버에서
                        실행합니다.
                      </Text>
                    </VStack>
                    <Switch
                      label="실사용 원격 처리"
                      isLabelHidden
                      value={isReady ? isVp8PreviewActive : wantsProviderOnReady}
                      isDisabled={!hasParserProviderConsent || isBusy}
                      disabledMessage="위 실사용 원격 처리 안내에 먼저 동의해주세요."
                      onChange={(checked) => {
                        if (isReady) {
                          onVp8ParserPreviewChange(checked);
                          return;
                        }
                        setWantsProviderOnReady(checked);
                      }}
                    />
                  </HStack>
                </section>

                {snapshot.identity ? (
                  <ConnectionIdentityPanel
                    identity={snapshot.identity}
                    phase={snapshot.phase}
                  />
                ) : null}
              </VStack>
            ) : (
              <VStack gap={4}>
                <VStack className="remote-recognition-setup-checks" gap={2}>
                  <Text as="p" type="label" weight="semibold">
                    연결 확인 6단계
                  </Text>
                  <VStack gap={1}>
                    {buildSetupCalls(snapshot, readiness).map((call) => (
                      <ChatToolCalls key={call.key} calls={[call]} />
                    ))}
                  </VStack>
                  {snapshot.probeDiagnostics ? (
                    <ProbeDiagnostics diagnostics={snapshot.probeDiagnostics} />
                  ) : null}
                </VStack>

                {failureBanner}

                {isReady ? (
                  <Banner
                    status="success"
                    title="서버 연결 확인이 끝났습니다"
                    description={
                      isVp8PreviewActive
                        ? "실사용 원격 처리가 켜져 있습니다. parser는 원격 서버에서 실행하고, 아이콘 판독과 알림은 이 기기에서 처리합니다."
                        : "실제 화면 5회의 파서 분석을 통과했습니다. 임시 연결만 유지하며 현재 알림은 계속 이 기기에서 처리됩니다."
                    }
                    container="card"
                  />
                ) : null}

                {snapshot.identity ? (
                  <ConnectionIdentityPanel
                    identity={snapshot.identity}
                    phase={snapshot.phase}
                  />
                ) : null}

                {isReady && isVp8PreviewActive ? (
                  <ParserProviderRuntimePanel
                    diagnostics={parserInputTransportDiagnostics}
                  />
                ) : null}
              </VStack>
            )}
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <HStack gap={2} hAlign="end" wrap="wrap">
              {view === "progress" && isFailed ? (
                <Button
                  label="코드 다시 입력"
                  variant="secondary"
                  icon={<PencilLine size={16} aria-hidden="true" />}
                  onClick={() => setView("input")}
                />
              ) : isReady ? (
                <Button
                  label="연결 해제"
                  variant="secondary"
                  icon={<Unplug size={16} aria-hidden="true" />}
                  clickAction={stop}
                />
              ) : (
                <Button label="닫기" variant="secondary" onClick={close} />
              )}
              {isReady ? (
                <Button label="완료" variant="primary" onClick={onClose} />
              ) : (
                <Button
                  label={isFailed ? "다시 확인" : "연결 확인 시작"}
                  variant="primary"
                  icon={<Gauge size={16} aria-hidden="true" />}
                  isLoading={isBusy}
                  isDisabled={isBusy || readiness !== "ready"}
                  clickAction={start}
                />
              )}
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

function buildSetupCalls(
  snapshot: RemoteRecognitionSessionSnapshot,
  readiness: RemoteRecognitionFrameProbeReadiness,
): ChatToolCallItem[] {
  const failedStep =
    snapshot.phase === "failed" && snapshot.failure
      ? failureStep(snapshot.failure)
      : null;
  return SETUP_STEPS.map((step) => {
    const status = getStepStatus(step.id, snapshot, readiness);
    const isProbeStep = step.id === "probe";
    return {
      key: step.id,
      name: step.token,
      status: status === "active" ? "running" : status,
      // The step sentence is the row's own secondary text; no row expands,
      // and the probe timings render under the list instead.
      target: step.description,
      stats: isProbeStep ? probeProgressStats(snapshot) : undefined,
      duration:
        isProbeStep && status === "complete" && snapshot.probeDiagnostics
          ? formatDuration(snapshot.probeDiagnostics.averageRoundTripMs)
          : undefined,
      errorMessage:
        step.id === failedStep && snapshot.failure
          ? failureCopy(snapshot.failure).title
          : undefined,
    };
  });
}

function probeProgressStats(
  snapshot: RemoteRecognitionSessionSnapshot,
): string | undefined {
  if (!snapshot.probe?.completedRounds) {
    return undefined;
  }
  return `${snapshot.probe.completedRounds}/5`;
}

type CopyState = "idle" | "copied" | "failed";

function ConnectionIdentityPanel({
  identity,
  phase,
}: {
  identity: RemoteRecognitionConnectionIdentity;
  phase: RemoteRecognitionSetupPhase;
}) {
  const [betaAliasCopyState, setBetaAliasCopyState] =
    useState<CopyState>("idle");
  const [connectionCodeCopyState, setConnectionCodeCopyState] =
    useState<CopyState>("idle");

  useEffect(() => {
    setBetaAliasCopyState("idle");
    setConnectionCodeCopyState("idle");
  }, [identity.betaAlias, identity.connectionCode]);

  const title =
    phase === "ready"
      ? "현재 연결 정보"
      : phase === "idle" || phase === "failed"
        ? "최근 연결 정보"
        : "연결 정보";

  return (
    <Section
      className="remote-recognition-connection-identity"
      variant="muted"
      padding={3}
    >
      <VStack gap={3}>
        <VStack gap={1}>
          <Text as="p" type="label" weight="semibold">
            {title}
          </Text>
          <Text as="p" type="supporting" color="secondary">
            문의하거나 로그를 확인할 때 아래 두 값을 알려주세요.
          </Text>
        </VStack>
        <Grid columns={{ minWidth: 220, max: 2 }} gap={2}>
          <ConnectionIdentityValue
            label="테스터 코드"
            value={identity.betaAlias}
            copyLabel={copyButtonLabel("테스터 코드", betaAliasCopyState)}
            onCopy={() =>
              copyConnectionIdentityValue(
                identity.betaAlias,
                setBetaAliasCopyState,
              )
            }
          />
          <ConnectionIdentityValue
            label="연결 코드"
            value={identity.connectionCode}
            copyLabel={copyButtonLabel("연결 코드", connectionCodeCopyState)}
            onCopy={() =>
              copyConnectionIdentityValue(
                identity.connectionCode,
                setConnectionCodeCopyState,
              )
            }
          />
        </Grid>
      </VStack>
    </Section>
  );
}

function ConnectionIdentityValue({
  label,
  value,
  copyLabel,
  onCopy,
}: {
  label: string;
  value: string;
  copyLabel: string;
  onCopy(): Promise<void>;
}) {
  return (
    <VStack className="remote-recognition-connection-identity-value" gap={2}>
      <Text as="p" type="supporting" color="secondary">
        {label}
      </Text>
      <HStack gap={2} hAlign="between" vAlign="center" wrap="wrap">
        <code>{value}</code>
        <Button
          label={copyLabel}
          variant="ghost"
          size="sm"
          icon={<ClipboardCopy size={14} aria-hidden="true" />}
          clickAction={onCopy}
        />
      </HStack>
    </VStack>
  );
}

function copyButtonLabel(label: string, state: CopyState): string {
  if (state === "copied") return `${label} 복사됨`;
  if (state === "failed") return `${label} 복사 실패`;
  return `${label} 복사`;
}

async function copyConnectionIdentityValue(
  value: string,
  setState: (state: CopyState) => void,
): Promise<void> {
  try {
    if (!navigator.clipboard) {
      throw new Error("clipboard-unavailable");
    }
    await navigator.clipboard.writeText(value);
    setState("copied");
  } catch {
    setState("failed");
  }
}

function ParserProviderRuntimePanel({
  diagnostics,
}: {
  diagnostics: PrecisionParserInputTransportDiagnostics;
}) {
  return (
    <Section variant="muted" padding={3}>
      <VStack gap={3}>
        <Banner
          status="warning"
          title="원격 parser 결과가 실제 알림에 사용됩니다"
          description="기능을 평소처럼 사용해주세요. 연결이 끊기거나 연결을 해제하면 감지 상태를 초기화하고 로컬 처리로 돌아갑니다."
          container="card"
        />

        {diagnostics.successfulSamples > 0 || diagnostics.failedSamples > 0 ? (
          <Grid columns={{ minWidth: 110, max: 4 }} gap={2}>
            <CompactMetricCell
              label="처리 프레임"
              className="remote-recognition-diagnostic-metric"
            >
              {diagnostics.successfulSamples}회
            </CompactMetricCell>
            <CompactMetricCell
              label="실패"
              className="remote-recognition-diagnostic-metric"
            >
              {diagnostics.failedSamples}회
            </CompactMetricCell>
            <CompactMetricCell
              label="건너뜀"
              className="remote-recognition-diagnostic-metric"
            >
              {diagnostics.droppedSamples}회
            </CompactMetricCell>
            <DiagnosticMetric
              label="평균 전송 E2E"
              value={diagnostics.averageE2eMs ?? 0}
            />
            <DiagnosticMetric
              label="서버 전체"
              value={diagnostics.averageServerTotalMs ?? 0}
            />
            <DiagnosticMetric
              label="평균 인코딩"
              value={diagnostics.averageEncodeMs ?? 0}
            />
            <DiagnosticMetric
              label="서버 디코딩"
              value={diagnostics.averageDecodeMs ?? 0}
            />
            <CompactMetricCell
              label="평균 프레임"
              className="remote-recognition-diagnostic-metric"
            >
              {diagnostics.averageEncodedBytes === null
                ? "--"
                : formatBytes(diagnostics.averageEncodedBytes)}
            </CompactMetricCell>
          </Grid>
        ) : null}

        {diagnostics.lastError ? (
          <Text as="p" type="supporting">
            최근 오류: {diagnostics.lastError}
          </Text>
        ) : null}
      </VStack>
    </Section>
  );
}

function ProbeDiagnostics({
  diagnostics,
}: {
  diagnostics: RemoteRecognitionProbeDiagnostics;
}) {
  return (
    <VStack className="remote-recognition-probe-diagnostics" gap={3}>
      <HStack gap={2} hAlign="between" wrap="wrap">
        <Text as="p" type="label" weight="semibold">
          실제 화면 분석 시간
        </Text>
        <Text as="p" type="supporting" color="secondary">
          {diagnostics.completedRounds}/5회 평균 ·{" "}
          {formatExecutionProvider(diagnostics.executionProviders)}
        </Text>
      </HStack>
      <Grid columns={{ minWidth: 110, max: 4 }} gap={2}>
        <DiagnosticMetric
          label="왕복 평균"
          value={diagnostics.averageRoundTripMs}
        />
        <DiagnosticMetric
          label="서버 전체"
          value={diagnostics.averageServerTotalMs}
        />
        <DiagnosticMetric
          label="모델 추론"
          value={diagnostics.averageInferenceMs}
        />
        <DiagnosticMetric
          label="서버 전처리"
          value={diagnostics.averagePreprocessMs}
        />
        <DiagnosticMetric
          label="화면 읽기"
          value={diagnostics.averageCaptureMs}
        />
        <DiagnosticMetric
          label="화면 압축"
          value={diagnostics.averageCompressionMs}
        />
        <DiagnosticMetric
          label="서버 디코드"
          value={diagnostics.averageDecodeMs}
        />
        <DiagnosticMetric
          label="서버 후처리"
          value={diagnostics.averagePostprocessMs}
        />
        <CompactMetricCell
          label="평균 전송 크기"
          className="remote-recognition-diagnostic-metric"
        >
          {formatBytes(diagnostics.averageEncodedBytes)}
        </CompactMetricCell>
      </Grid>
    </VStack>
  );
}

function DiagnosticMetric({ label, value }: { label: string; value: number }) {
  return (
    <CompactMetricCell
      label={label}
      className="remote-recognition-diagnostic-metric"
    >
      {formatDuration(value)}
    </CompactMetricCell>
  );
}

function formatDuration(value: number): string {
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}ms`;
}

function formatBytes(value: number): string {
  return `${(value / 1024).toFixed(1)}KB`;
}

function formatExecutionProvider(providers: string[]): string {
  if (providers.includes("CoreMLExecutionProvider")) return "서버 Core ML";
  if (providers.some((provider) => provider.includes("CUDA"))) return "서버 GPU";
  if (providers.includes("CPUExecutionProvider")) return "서버 CPU";
  return "서버 실행 장치 확인됨";
}

function isBusyPhase(phase: RemoteRecognitionSetupPhase): boolean {
  return ["checking", "reserving", "probing", "activating", "stopping"].includes(
    phase,
  );
}

function getStepStatus(
  step: SetupStepId,
  snapshot: RemoteRecognitionSessionSnapshot,
  readiness: RemoteRecognitionFrameProbeReadiness,
): "pending" | "active" | "complete" | "error" {
  if (readiness !== "ready") {
    return step === "capture" ? "error" : "pending";
  }
  if (snapshot.phase === "ready") {
    return "complete";
  }
  if (snapshot.phase === "failed" && snapshot.failure) {
    const failedStep = failureStep(snapshot.failure);
    if (step === failedStep) {
      return "error";
    }
    return stepIndex(step) < stepIndex(failedStep) ? "complete" : "pending";
  }
  const activeStep = phaseStep(snapshot.phase);
  if (!activeStep) {
    return step === "capture" ? "complete" : "pending";
  }
  if (step === activeStep) {
    return "active";
  }
  return stepIndex(step) < stepIndex(activeStep) ? "complete" : "pending";
}

function phaseStep(phase: RemoteRecognitionSetupPhase): SetupStepId | null {
  if (phase === "checking") return "network";
  if (phase === "reserving") return "admission";
  if (phase === "probing") return "probe";
  if (phase === "activating") return "session";
  return null;
}

function failureStep(failure: RemoteRecognitionSetupFailure): SetupStepId {
  if (
    failure.code === "network-error" ||
    failure.code === "request-timeout"
  ) {
    return "network";
  }
  if (failure.phase === "status") return "service";
  if (failure.phase === "entitlement" || failure.phase === "admission") {
    return "admission";
  }
  if (failure.phase === "probe") return "probe";
  return "session";
}

function stepIndex(step: SetupStepId): number {
  return SETUP_STEPS.findIndex((candidate) => candidate.id === step);
}

function failureCopy(failure: RemoteRecognitionSetupFailure): {
  title: string;
  description: string;
} {
  if (failure.code === "not-entitled") {
    return {
      title: "초대 코드를 확인해주세요",
      description: "코드가 만료되었거나 원격 처리 시험 대상이 아닐 수 있습니다.",
    };
  }
  if (failure.code === "access-code-in-use") {
    return {
      title: "이 초대 코드는 다른 브라우저에서 사용 중입니다",
      description:
        "기존 브라우저에서 연결을 해제한 뒤 다시 시도해주세요. 기존 창이 비정상 종료됐다면 잠시 기다린 뒤 다시 확인해주세요.",
    };
  }
  if (failure.code === "client-reconnect-busy") {
    return {
      title: "기존 연결에서 처리 중입니다",
      description: "잠시 후 다시 시도해주세요.",
    };
  }
  if (failure.code === "capacity-full") {
    return {
      title: "현재 사용할 수 있는 자리가 없습니다",
      description: "다른 사용자의 연결이 끝난 뒤 잠시 후 다시 시도해주세요.",
    };
  }
  if (failure.code === "rate-limited") {
    return {
      title: "확인을 너무 자주 요청했습니다",
      description: "잠시 기다린 뒤 다시 시도해주세요.",
    };
  }
  if (failure.code === "probe-failed") {
    if (
      failure.technicalMessage.includes("screen-share") ||
      failure.technicalMessage.includes("game-viewport") ||
      failure.technicalMessage.includes("video-not-ready")
    ) {
      return {
        title: "게임 화면을 읽지 못했습니다",
        description: "화면 공유와 게임 화면 영역을 확인한 뒤 다시 시도해주세요.",
      };
    }
    return {
      title: "실제 화면 분석을 마치지 못했습니다",
      description: "화면 공유와 네트워크 상태를 확인한 뒤 다시 시도해주세요.",
    };
  }
  if (failure.code === "transport-not-enabled") {
    return {
      title: "실제 화면 분석 서버가 준비되지 않았습니다",
      description: "잠시 후 다시 시도해주세요.",
    };
  }
  if (
    failure.code === "network-error" ||
    failure.code === "request-timeout"
  ) {
    return {
      title: "원격 서버에 연결하지 못했습니다",
      description: "인터넷 연결을 확인한 뒤 다시 시도해주세요.",
    };
  }
  if (failure.code === "service-unavailable") {
    return {
      title: "현재 원격 처리 시험을 사용할 수 없습니다",
      description: "서버 점검 중이거나 아직 준비되지 않았습니다. 잠시 후 다시 확인해주세요.",
    };
  }
  if (failure.code === "session-frame-idle") {
    return {
      title: "장시간 사용이 없어 연결이 해제되었습니다",
      description: "자리를 다른 테스터에게 양보했어요. 다시 연결하면 이어서 사용할 수 있습니다.",
    };
  }
  if (
    failure.code === "session-expired" ||
    failure.code === "session-not-found"
  ) {
    return {
      title: "임시 연결이 종료되었습니다",
      description: "연결 준비를 처음부터 다시 진행해주세요.",
    };
  }
  return {
    title: "원격 처리 연결을 준비하지 못했습니다",
    description: "잠시 후 다시 시도해주세요. 같은 문제가 반복되면 문의해주세요.",
  };
}
