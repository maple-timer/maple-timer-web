import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack } from "@astryxdesign/core/HStack";
import { IconButton } from "@astryxdesign/core/IconButton";
import { List, ListItem } from "@astryxdesign/core/List";
import { Section } from "@astryxdesign/core/Section";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Cpu,
  ExternalLink,
  RefreshCw,
  Send,
} from "lucide-react";
import { useEffect, useState } from "react";
import { MAPLE_TIMER_BACKUP_URL } from "../../../contracts/deployment/mapleTimerHosts";
import {
  PRECISION_PARSER_DIAGNOSTIC_STAGE_ORDER,
  getFailedPrecisionParserDiagnosticStep,
  type PrecisionParserDiagnosticStage,
  type PrecisionParserDiagnosticStatus,
} from "../../../contracts/recognition/precisionParserDiagnostics";
import {
  DEFAULT_PRECISION_PARSER_DIAGNOSTIC_USER_CHECKS,
  type PrecisionParserChromeGpuWebGpuStatus,
  type PrecisionParserDiagnosticSubmissionResult,
  type PrecisionParserDiagnosticUserChecks,
} from "../../../contracts/reporting/precisionParserDiagnosticFeedback";
import {
  canOfferPrecisionParserCpuFallback,
  getPrecisionParserFailureContent,
  type PrecisionParserReadiness,
} from "../../../lib/buffSlotParser/precisionParserAvailability";
import type { PrecisionParserCpuFallbackState } from "../../../contracts/recognition/precisionParserRuntime";
import {
  collectPrecisionParserDiagnosticEnvironment,
  collectPrecisionParserDiagnosticEnvironmentWithProbe,
  type PrecisionParserDiagnosticEnvironment,
} from "../../../platform/browser-diagnostics/precisionParserDiagnosticEnvironment";
import { getPrecisionParserBrowserGuidance } from "../../../platform/browser-diagnostics/precisionParserBrowserGuidance";
import { getPrecisionParserRecoveryGuidance } from "./precisionParserRecoveryGuidance";
import { PrecisionParserCpuFallbackDialog } from "./PrecisionParserCpuFallbackDialog";

const STAGE_LABELS: Record<PrecisionParserDiagnosticStage, string> = {
  "analysis-worker": "분석 작업 시작",
  "webgpu-api": "브라우저의 WebGPU 기능 확인",
  "gpu-adapter": "그래픽 장치 연결 확인",
  "gpu-device": "그래픽 연산 시작",
  "onnx-runtime": "정밀 감지 실행 엔진",
  "model-session": "정밀 감지 모델 준비",
  "first-inference": "실제 모델 분석",
};

const STATUS_LABELS: Record<PrecisionParserDiagnosticStatus, string> = {
  pending: "대기",
  checking: "확인 중",
  passed: "완료",
  failed: "문제 발견",
};

const BROWSER_GPU_WEBGPU_STATUS_LABELS: Record<
  PrecisionParserChromeGpuWebGpuStatus,
  string
> = {
  "not-checked": "아직 확인하지 않음",
  "not-found": "WebGPU 항목을 찾지 못함",
  "hardware-accelerated": "정상 · Hardware accelerated",
  "software-only": "소프트웨어 처리 · Software only",
  disabled: "사용 중지됨 · Disabled",
};

type CopyState = "idle" | "copied" | "failed";
type SubmissionState =
  | { status: "idle" | "submitting" | "failed"; id: null }
  | { status: "submitted"; id: string | null; deduplicated: boolean };

export function PrecisionParserRequirementBanner({
  readiness,
  cpuFallback = { status: "idle" },
  onRetry,
  onStartCpuFallback,
  onCancelCpuFallbackBenchmark,
  onStopCpuFallback,
  onSubmitDiagnostics,
}: {
  readiness: PrecisionParserReadiness;
  cpuFallback?: PrecisionParserCpuFallbackState;
  onRetry: () => void;
  onStartCpuFallback?: () => Promise<void>;
  onCancelCpuFallbackBenchmark?: () => void;
  onStopCpuFallback?: () => void;
  onSubmitDiagnostics?: (
    readiness: Extract<PrecisionParserReadiness, { status: "unavailable" }>,
  ) => Promise<PrecisionParserDiagnosticSubmissionResult>;
}) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [submissionState, setSubmissionState] = useState<SubmissionState>({
    status: "idle",
    id: null,
  });
  const [gpuStatusAddressCopyState, setGpuStatusAddressCopyState] =
    useState<CopyState>("idle");
  const [isCpuFallbackDialogOpen, setCpuFallbackDialogOpen] = useState(false);
  const [isRecoveryDetailsOpen, setRecoveryDetailsOpen] = useState(false);

  useEffect(() => {
    if (cpuFallback.status === "active") {
      setCpuFallbackDialogOpen(false);
    }
  }, [cpuFallback.status]);

  if (cpuFallback.status === "active") {
    return (
      <Banner
        className="precision-parser-requirement-banner"
        status="warning"
        title="정밀 감지 · CPU 모드"
        description={`그래픽 가속 대신 CPU를 사용 중입니다. 한 화면 처리 평균 약 ${Math.round(cpuFallback.benchmark.requestAverageMs)}ms입니다.`}
        container="card"
        endContent={
          <HStack
            className="precision-parser-banner-header-actions"
            gap={1}
            wrap="wrap"
          >
            <Button
              label="그래픽 가속 다시 확인"
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={14} aria-hidden="true" />}
              onClick={onRetry}
            />
            {onStopCpuFallback ? (
              <Button
                label="CPU 모드 종료"
                variant="ghost"
                size="sm"
                icon={<Cpu size={14} aria-hidden="true" />}
                onClick={onStopCpuFallback}
              />
            ) : null}
          </HStack>
        }
      />
    );
  }

  if (cpuFallback.status === "overloaded") {
    return (
      <Banner
        className="precision-parser-requirement-banner"
        status="error"
        title="CPU 정밀 감지를 계속할 수 없습니다"
        description="CPU가 화면을 안정적으로 처리하지 못해 정밀 감지를 중지했습니다. 그래픽 설정을 확인하거나 백업 사이트를 이용해주세요."
        container="card"
        endContent={
          <HStack
            className="precision-parser-banner-header-actions"
            gap={1}
            wrap="wrap"
          >
            <Button
              label="그래픽 가속 다시 확인"
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={14} aria-hidden="true" />}
              onClick={onRetry}
            />
            <Button
              label="백업 사이트 열기"
              variant="ghost"
              size="sm"
              icon={<ExternalLink size={14} aria-hidden="true" />}
              onClick={openBackupSite}
            />
          </HStack>
        }
      />
    );
  }

  if (readiness.status !== "unavailable") {
    return null;
  }

  const failedStep = getFailedPrecisionParserDiagnosticStep(
    readiness.diagnostic,
  );
  const browserGuidance = getPrecisionParserBrowserGuidance();
  const content = getPrecisionParserFailureContent(
    readiness.failureReason,
    failedStep?.stage ?? null,
    failedStep?.technicalMessage ?? null,
  );
  const shouldShowWebGpuRecovery =
    readiness.failureReason === "webgpu-unavailable";
  const canOfferCpuFallback =
    Boolean(onStartCpuFallback) &&
    canOfferPrecisionParserCpuFallback(readiness);
  const cpuFallbackNeedsRetry =
    cpuFallback.status === "rejected" ||
    (cpuFallback.status === "failed" && cpuFallback.phase === "benchmark");
  const shouldShowBackupAction =
    cpuFallback.status === "rejected" || cpuFallback.status === "failed";
  const recoveryDetailsLabel = shouldShowWebGpuRecovery
    ? isRecoveryDetailsOpen
      ? "그래픽 설정 닫기"
      : "그래픽 설정 확인"
    : isRecoveryDetailsOpen
      ? "문제 해결 방법 닫기"
      : "문제 해결 방법";
  const bannerTitle = canOfferCpuFallback
    ? "그래픽 가속을 사용할 수 없습니다"
    : content.title;
  const bannerDescription = canOfferCpuFallback
    ? "CPU로 정밀 감지를 계속 사용할 수 있습니다. 시작 전 약 5초 동안 이 기기에서 충분히 빠른지 확인합니다."
    : content.description;
  const recoveryGuidance = getPrecisionParserRecoveryGuidance({
    browser: browserGuidance,
    failedStage: failedStep?.stage ?? null,
    failureReason: readiness.failureReason,
    technicalMessage: failedStep?.technicalMessage ?? null,
    isWindows: /Windows NT/i.test(navigator.userAgent),
  });
  const copyLabel =
    copyState === "copied"
      ? "복사됨"
      : copyState === "failed"
        ? "복사 실패"
        : "진단 정보 복사";

  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(
        formatPrecisionParserDiagnosticSummary(
          readiness,
          shouldShowWebGpuRecovery
            ? await collectPrecisionParserDiagnosticEnvironmentWithProbe()
            : collectPrecisionParserDiagnosticEnvironment(),
        ),
      );
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const copyGpuStatusAddress = async () => {
    try {
      await navigator.clipboard.writeText(browserGuidance.gpuStatusUrl);
      setGpuStatusAddressCopyState("copied");
    } catch {
      setGpuStatusAddressCopyState("failed");
    }
  };

  const submitDiagnostics = async () => {
    if (
      !onSubmitDiagnostics ||
      submissionState.status === "submitted"
    ) {
      return;
    }
    setCopyState("idle");
    setSubmissionState({ status: "submitting", id: null });
    try {
      const result = await onSubmitDiagnostics(readiness);
      setSubmissionState({
        status: "submitted",
        id: result.id,
        deduplicated: result.deduplicated,
      });
    } catch {
      setSubmissionState({ status: "failed", id: null });
    }
  };

  const submissionDescription = getSubmissionDescription(submissionState);

  return (
    <VStack className="precision-parser-requirement-shell" gap={2}>
      <Banner
        className="precision-parser-requirement-banner"
        status="error"
        title={bannerTitle}
        description={bannerDescription}
        container="card"
        endContent={
          <HStack
            className="precision-parser-banner-header-actions"
            gap={1}
            wrap="wrap"
          >
            {canOfferCpuFallback ? (
              <Button
                label={
                  cpuFallbackNeedsRetry
                    ? "CPU 속도 다시 확인"
                    : "CPU로 계속 사용"
                }
                variant="secondary"
                size="sm"
                className="precision-parser-banner-action"
                icon={<Cpu size={14} aria-hidden="true" />}
                onClick={() => setCpuFallbackDialogOpen(true)}
              />
            ) : null}
            <IconButton
              label={recoveryDetailsLabel}
              tooltip={recoveryDetailsLabel}
              variant="ghost"
              size="sm"
              icon={
                isRecoveryDetailsOpen ? (
                  <ChevronUp size={14} aria-hidden="true" />
                ) : (
                  <ChevronDown size={14} aria-hidden="true" />
                )
              }
              aria-expanded={isRecoveryDetailsOpen}
              aria-controls="precision-parser-recovery-details"
              onClick={() => setRecoveryDetailsOpen((open) => !open)}
            />
            {shouldShowBackupAction ? (
              <Button
                label="백업 사이트 열기"
                variant="ghost"
                size="sm"
                className="precision-parser-banner-action"
                icon={<ExternalLink size={14} aria-hidden="true" />}
                onClick={openBackupSite}
              />
            ) : null}
          </HStack>
        }
      />
      {isRecoveryDetailsOpen ? (
        <Section
          className="precision-parser-recovery-section"
          id="precision-parser-recovery-details"
          variant="section"
          padding={4}
          dividers={["top", "bottom"]}
        >
          <Grid
            className="precision-parser-recovery-layout"
            columns={2}
            gap={4}
            align="start"
          >
            <VStack gap={2}>
              <List
                density="compact"
                listStyle="disc"
                header={
                  <Text type="label" weight="semibold">
                    가능한 원인
                  </Text>
                }
              >
                {recoveryGuidance.causes.map((cause) => (
                  <ListItem key={cause} label={cause} />
                ))}
              </List>
              <List
                density="balanced"
                listStyle="decimal"
                header={
                  <Text type="label" weight="semibold">
                    아래 순서대로 확인해주세요
                  </Text>
                }
              >
                {recoveryGuidance.steps.map((step) => (
                  <ListItem
                    key={step.label}
                    label={step.label}
                    description={
                      <VStack gap={1}>
                        <Text type="supporting" color="secondary">
                          {step.description}
                        </Text>
                        {step.address ? (
                          <HStack gap={1} wrap="wrap" vAlign="center">
                            <Text type="supporting" weight="semibold">
                              {step.address}
                            </Text>
                            <IconButton
                              label={`${browserGuidance.label} WebGPU 상태 주소 복사`}
                              tooltip={
                                gpuStatusAddressCopyState === "copied"
                                  ? "주소를 복사했습니다"
                                  : gpuStatusAddressCopyState === "failed"
                                    ? "주소를 복사하지 못했습니다"
                                    : "주소 복사"
                              }
                              variant="ghost"
                              size="sm"
                              icon={
                                <ClipboardCopy size={14} aria-hidden="true" />
                              }
                              onClick={() => void copyGpuStatusAddress()}
                            />
                            {gpuStatusAddressCopyState === "copied" ? (
                              <Text type="supporting" color="secondary">
                                복사됨
                              </Text>
                            ) : null}
                          </HStack>
                        ) : null}
                      </VStack>
                    }
                  />
                ))}
              </List>
              {!canOfferCpuFallback || shouldShowBackupAction ? (
                <Text type="supporting" color="secondary">
                  문제가 계속되면 이번 업데이트 이전에 정상 동작하던 백업
                  사이트를 이용할 수 있습니다.
                </Text>
              ) : null}
              <HStack
                className="precision-parser-banner-actions"
                gap={1}
                wrap="wrap"
                vAlign="center"
              >
                <Button
                  label="다시 확인"
                  variant="primary"
                  size="md"
                  className="precision-parser-banner-action"
                  icon={<RefreshCw size={14} aria-hidden="true" />}
                  onClick={() => {
                    setCopyState("idle");
                    setSubmissionState({ status: "idle", id: null });
                    onRetry();
                  }}
                />
                {onSubmitDiagnostics ? (
                  <Button
                    label={
                      submissionState.status === "submitted"
                        ? "전송 완료"
                        : "진단 정보 보내기"
                    }
                    variant="secondary"
                    size="md"
                    className="precision-parser-banner-action"
                    icon={<Send size={14} aria-hidden="true" />}
                    isLoading={submissionState.status === "submitting"}
                    isDisabled={submissionState.status === "submitted"}
                    onClick={() => void submitDiagnostics()}
                  />
                ) : null}
                {!canOfferCpuFallback || shouldShowBackupAction ? (
                  <Button
                    label="백업 사이트 열기"
                    variant="secondary"
                    size="md"
                    className="precision-parser-banner-action"
                    icon={<ExternalLink size={14} aria-hidden="true" />}
                    onClick={openBackupSite}
                  />
                ) : null}
                {submissionState.status === "failed" ? (
                  <Button
                    label={copyLabel}
                    variant="ghost"
                    size="md"
                    icon={<ClipboardCopy size={14} aria-hidden="true" />}
                    onClick={() => void copyDiagnostics()}
                  />
                ) : null}
              </HStack>
              <Text type="supporting" color="secondary">
                {shouldShowWebGpuRecovery
                  ? "진단 전송 시 앱 버전, 브라우저, 단계별 오류와 메인 화면 어댑터 재검사 결과만 보냅니다. 화면, 게임 정보, 설정은 보내지 않습니다."
                  : "진단 전송 시 앱 버전, 브라우저, 단계별 오류만 보냅니다. 화면, 게임 정보, 설정은 보내지 않습니다."}
              </Text>
              {submissionDescription ? (
                <Text type="supporting" weight="semibold">
                  {submissionDescription}
                </Text>
              ) : null}
            </VStack>
            <VStack className="precision-parser-diagnostic-results" gap={1}>
              <Text type="label" weight="semibold">
                진단 결과
              </Text>
              <List density="compact" hasDividers>
                {PRECISION_PARSER_DIAGNOSTIC_STAGE_ORDER.map((stage) => {
                  const step = readiness.diagnostic.steps[stage];
                  return (
                    <ListItem
                      key={stage}
                      label={STAGE_LABELS[stage]}
                      description={
                        <Text type="supporting" color="secondary">
                          {getStepDescription(stage, step.status)}
                        </Text>
                      }
                      startContent={
                        <StatusDot
                          variant={getStatusVariant(step.status)}
                          label={`${STAGE_LABELS[stage]} ${STATUS_LABELS[step.status]}`}
                          isPulsing={step.status === "checking"}
                        />
                      }
                      endContent={
                        <Text type="supporting" color="secondary">
                          {STATUS_LABELS[step.status]}
                        </Text>
                      }
                    />
                  );
                })}
              </List>
            </VStack>
          </Grid>
        </Section>
      ) : null}
      {canOfferCpuFallback && onStartCpuFallback ? (
        <PrecisionParserCpuFallbackDialog
          isOpen={isCpuFallbackDialogOpen}
          state={cpuFallback}
          onOpenChange={setCpuFallbackDialogOpen}
          onStart={onStartCpuFallback}
          onCancel={onCancelCpuFallbackBenchmark}
        />
      ) : null}
    </VStack>
  );
}

function openBackupSite(): void {
  window.open(MAPLE_TIMER_BACKUP_URL, "_blank", "noopener,noreferrer");
}

export function formatPrecisionParserDiagnosticSummary(
  readiness: Extract<PrecisionParserReadiness, { status: "unavailable" }>,
  environment: Pick<
    PrecisionParserDiagnosticEnvironment,
    | "buildLabel"
    | "origin"
    | "userAgent"
    | "secureContext"
    | "mainThreadWebGpu"
    | "mainThreadWebGpuAdapterProbe"
  > = collectPrecisionParserDiagnosticEnvironment(),
  userChecks: PrecisionParserDiagnosticUserChecks =
    DEFAULT_PRECISION_PARSER_DIAGNOSTIC_USER_CHECKS,
): string {
  const failedStep = getFailedPrecisionParserDiagnosticStep(
    readiness.diagnostic,
  );
  const lines = [
    "Maple Timer 정밀 감지 진단",
    `빌드: ${environment.buildLabel}`,
    `주소: ${environment.origin}`,
    `확인 시각: ${readiness.diagnostic.updatedAt ?? "기록 없음"}`,
    `보안 연결: ${environment.secureContext ? "예" : "아니요"}`,
    `메인 화면 WebGPU API: ${environment.mainThreadWebGpu ? "있음" : "없음"}`,
    `메인 화면 어댑터 재검사: ${formatMainThreadAdapterProbe(environment.mainThreadWebGpuAdapterProbe)}`,
    `브라우저: ${environment.userAgent}`,
    `분류: ${readiness.failureReason}`,
    `실패 단계: ${failedStep ? STAGE_LABELS[failedStep.stage] : "확인되지 않음"}`,
    `오류 코드: ${failedStep?.code ?? "기록 없음"}`,
    `기술 오류: ${failedStep?.technicalMessage ?? "기록 없음"}`,
    "",
    "단계별 결과",
  ];

  if (userChecks.chromeGpuWebGpuStatus !== "not-checked") {
    lines.splice(
      7,
      0,
      `브라우저 WebGPU (사용자 확인): ${BROWSER_GPU_WEBGPU_STATUS_LABELS[userChecks.chromeGpuWebGpuStatus]}`,
    );
  }

  for (const stage of PRECISION_PARSER_DIAGNOSTIC_STAGE_ORDER) {
    const step = readiness.diagnostic.steps[stage];
    lines.push(`- ${STAGE_LABELS[stage]}: ${STATUS_LABELS[step.status]}`);
    for (const [key, value] of Object.entries(step.details)) {
      lines.push(`  ${key}: ${String(value)}`);
    }
  }
  return lines.join("\n");
}

function getSubmissionDescription(state: SubmissionState): string | null {
  if (state.status === "submitted") {
    const id = state.id ? ` · 제보 ID ${state.id}` : "";
    return state.deduplicated
      ? `같은 진단 정보가 이미 전송됐습니다${id}`
      : `진단 정보를 전송했습니다${id}`;
  }
  if (state.status === "failed") {
    return "전송하지 못했습니다. 진단 정보를 복사해 전달해주세요.";
  }
  return null;
}

function getStatusVariant(
  status: PrecisionParserDiagnosticStatus,
): "success" | "error" | "accent" | "neutral" {
  if (status === "passed") {
    return "success";
  }
  if (status === "failed") {
    return "error";
  }
  if (status === "checking") {
    return "accent";
  }
  return "neutral";
}

function getStepDescription(
  stage: PrecisionParserDiagnosticStage,
  status: PrecisionParserDiagnosticStatus,
): string {
  if (status === "pending") {
    return "앞 단계의 문제가 해결되면 확인합니다.";
  }
  if (status === "checking") {
    return "현재 이 단계를 확인하고 있습니다.";
  }
  if (status === "passed") {
    if (stage === "webgpu-api") {
      return "브라우저에서 WebGPU 기능을 찾았습니다. 그래픽 가속 연결 여부는 다음 단계에서 따로 확인합니다.";
    }
    if (stage === "gpu-adapter") {
      return "실제 그래픽 장치에 연결했습니다.";
    }
    return "정상적으로 확인했습니다.";
  }
  return FAILED_STAGE_DESCRIPTIONS[stage];
}

const FAILED_STAGE_DESCRIPTIONS: Record<
  PrecisionParserDiagnosticStage,
  string
> = {
  "analysis-worker": "페이지의 분석 작업을 시작하지 못했습니다.",
  "webgpu-api": "브라우저에서 WebGPU 기능을 찾지 못했습니다.",
  "gpu-adapter":
    "브라우저에 WebGPU 기능은 있지만 실제 그래픽 장치에 연결하지 못했습니다.",
  "gpu-device":
    "그래픽 장치는 찾았지만 정밀 감지용 연산을 시작하지 못했습니다.",
  "onnx-runtime":
    "그래픽 장치는 준비됐지만 정밀 감지 엔진을 시작하지 못했습니다.",
  "model-session":
    "정밀 감지 엔진은 준비됐지만 모델을 불러오지 못했습니다.",
  "first-inference": "준비는 끝났지만 첫 화면 분석에 실패했습니다.",
};

function formatMainThreadAdapterProbe(
  probe: PrecisionParserDiagnosticEnvironment["mainThreadWebGpuAdapterProbe"],
): string {
  const labels = {
    "not-run": "실행하지 않음",
    "api-unavailable": "WebGPU API 없음",
    available: "연결 성공",
    unavailable: "연결 실패",
    failed: "재검사 오류",
  } as const;
  return probe.technicalMessage
    ? `${labels[probe.status]} · ${probe.technicalMessage}`
    : labels[probe.status];
}
