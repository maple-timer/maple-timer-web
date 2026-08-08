import { AnimatePresence, m as motion, useReducedMotion } from "motion/react";
import { AlertTriangle, X } from "lucide-react";
import {
  type FormEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  HuntStallRuntimeState,
  HuntStallSnapshot,
  RuneSnapshot,
  SkillSnapshot,
} from "../../alertTypes";
import {
  trackReportSubmitFailed,
  trackReportSubmitStart,
  trackReportSubmitSuccess,
} from "../../lib/analyticsEvents";
import { MotionDialogFrame } from "../../shared/components/MotionDialogFrame";
import type { FeedbackKind } from "../../contracts/reporting/feedback";
import type { ReportFrameSourceContext } from "../../contracts/reporting/frameSourceDiagnostics";
import type { PrecisionParserRuntimeReport } from "../../contracts/reporting/precisionParserRuntimeReport";
import { buildFeedbackPayload } from "./feedbackPayload";
import type { Profile, SkillRuntimeState } from "../../types";
import { FeedbackActions, type FeedbackSubmitState } from "./feedback/FeedbackActions";
import {
  FeedbackDiagnosticsFields,
  FeedbackPrimaryFields,
  FeedbackReviewFields,
} from "./feedback/FeedbackFields";

export { buildFeedbackPayload } from "./feedbackPayload";

type FeedbackStep = "details" | "diagnostics" | "review";

export function FeedbackModal({
  profile,
  states,
  snapshots,
  runeSnapshot,
  huntStallState,
  huntStallSnapshot,
  videoRef,
  stream,
  captureSize,
  currentLayoutKey,
  frameSourceContext,
  precisionParserRuntime,
  onClose,
  onSubmitted,
}: {
  profile: Profile;
  states: Record<string, SkillRuntimeState>;
  snapshots: Record<string, SkillSnapshot>;
  runeSnapshot: RuneSnapshot | null;
  huntStallState: HuntStallRuntimeState | null;
  huntStallSnapshot: HuntStallSnapshot | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  captureSize: { width: number; height: number } | null;
  currentLayoutKey: string | null;
  frameSourceContext: ReportFrameSourceContext;
  precisionParserRuntime: PrecisionParserRuntimeReport;
  onClose: () => void;
  onSubmitted: (message: string) => void;
}) {
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [includeFullScreenshot, setIncludeFullScreenshot] = useState(false);
  const [includeCropImages, setIncludeCropImages] = useState(false);
  const [includeSettings, setIncludeSettings] = useState(false);
  const [submitState, setSubmitState] = useState<FeedbackSubmitState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<FeedbackStep>("details");
  const [reviewUnlocked, setReviewUnlocked] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  const hasCapture = Boolean(stream && captureSize);
  const cropImageCount = useMemo(
    () =>
      Object.values(snapshots).filter((snapshot) => snapshot.rawPreviewUrl || snapshot.previewUrl)
        .length + (runeSnapshot?.rawPreviewUrl || runeSnapshot?.maskPreviewUrl ? 1 : 0),
    [runeSnapshot, snapshots],
  );
  const huntStallCropImageCount = useMemo(
    () =>
      Number(Boolean(huntStallSnapshot?.rawPreviewUrl)) +
      Number(Boolean(huntStallSnapshot?.processedPreviewUrl)),
    [huntStallSnapshot],
  );
  const diagnosticCropImageCount = cropImageCount + huntStallCropImageCount;
  const canProceed = message.trim().length > 0 && submitState !== "submitting";
  const canSubmit = canProceed && step === "review" && reviewUnlocked;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && submitState !== "submitting") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, submitState]);

  useEffect(() => {
    if (step !== "review") {
      setReviewUnlocked(false);
      return;
    }

    setReviewUnlocked(false);
    const unlockTimer = window.setTimeout(() => {
      setReviewUnlocked(true);
    }, 280);
    return () => window.clearTimeout(unlockTimer);
  }, [step]);

  const submitFeedback = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (step === "details") {
        if (canProceed) {
          setError(null);
          setStep("diagnostics");
        }
        return;
      }

      if (step === "diagnostics") {
        if (canProceed) {
          setError(null);
          setStep("review");
        }
        return;
      }

      if (!canSubmit) {
        return;
      }

      setSubmitState("submitting");
      setError(null);

      try {
        trackReportSubmitStart(kind, {
          hasFullScreenshot: includeFullScreenshot && hasCapture,
          hasCropImages: includeCropImages && diagnosticCropImageCount > 0,
          hasSettings: includeSettings,
        });

        const payload = await buildFeedbackPayload({
          kind,
          message,
          includeFullScreenshot: includeFullScreenshot && hasCapture,
          includeCropImages: includeCropImages && diagnosticCropImageCount > 0,
          includeSettings,
          profile,
          states,
          snapshots,
          runeSnapshot,
          huntStallState,
          huntStallSnapshot,
          video: videoRef.current,
          stream,
          captureSize,
          currentLayoutKey,
          frameSourceContext,
          precisionParserRuntime,
        });

        const response = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            typeof data.error === "string" ? data.error : "피드백 전송에 실패했습니다.",
          );
        }

        setSubmitState("done");
        trackReportSubmitSuccess(kind, {
          hasFullScreenshot: includeFullScreenshot && hasCapture,
          hasCropImages: includeCropImages && diagnosticCropImageCount > 0,
          hasSettings: includeSettings,
        });
        onSubmitted(
          typeof data.id === "string"
            ? `피드백을 보냈습니다. ID: ${data.id}`
            : "피드백을 보냈습니다.",
        );
        window.setTimeout(onClose, 450);
      } catch (nextError) {
        setSubmitState("idle");
        trackReportSubmitFailed(kind, {
          hasFullScreenshot: includeFullScreenshot && hasCapture,
          hasCropImages: includeCropImages && diagnosticCropImageCount > 0,
          hasSettings: includeSettings,
        });
        setError(
          nextError instanceof Error ? nextError.message : "피드백 전송에 실패했습니다.",
        );
      }
    },
    [
      canProceed,
      canSubmit,
      captureSize,
      cropImageCount,
      diagnosticCropImageCount,
      currentLayoutKey,
      frameSourceContext,
      hasCapture,
      includeCropImages,
      includeFullScreenshot,
      includeSettings,
      kind,
      message,
      onClose,
      onSubmitted,
      profile,
      precisionParserRuntime,
      runeSnapshot,
      huntStallState,
      huntStallSnapshot,
      snapshots,
      states,
      step,
      stream,
      videoRef,
    ],
  );

  return (
    <MotionDialogFrame
      backdropClassName="feedback-backdrop"
      dialogClassName="feedback-dialog"
      dialogLayout="size"
      labelledBy="feedback-title"
      onBackdropMouseDown={submitState === "submitting" ? undefined : onClose}
      onDialogMouseDown={(event) => event.stopPropagation()}
    >
        {submitState === "submitting" && (
          <div className="modal-progress-bar" role="status" aria-label="피드백 전송 중" />
        )}
        <header className="feedback-header">
          <div className="feedback-header-copy">
            <h2 id="feedback-title">문의/피드백</h2>
            <p>문제 상황이나 개선 아이디어를 알려주세요.</p>
          </div>
          <button
            className="icon-button small"
            type="button"
            aria-label="닫기"
            onClick={onClose}
            disabled={submitState === "submitting"}
          >
            <X size={16} />
          </button>
        </header>

        <form className="feedback-form" onSubmit={submitFeedback}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              className="feedback-step-motion"
              initial={shouldReduceMotion ? false : { opacity: 0, x: step === "details" ? -10 : 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={shouldReduceMotion ? undefined : { opacity: 0, x: step === "details" ? -10 : 10 }}
              transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.16, ease: "easeOut" }}
            >
              {step === "details" ? (
                <FeedbackPrimaryFields
                  kind={kind}
                  message={message}
                  onKindChange={setKind}
                  onMessageChange={setMessage}
                />
              ) : step === "diagnostics" ? (
                <FeedbackDiagnosticsFields
                  includeFullScreenshot={includeFullScreenshot}
                  includeCropImages={includeCropImages}
                  includeSettings={includeSettings}
                  hasCapture={hasCapture}
                  cropImageCount={diagnosticCropImageCount}
                  onIncludeFullScreenshotChange={setIncludeFullScreenshot}
                  onIncludeCropImagesChange={setIncludeCropImages}
                  onIncludeSettingsChange={setIncludeSettings}
                />
              ) : (
                <FeedbackReviewFields
                  kind={kind}
                  message={message}
                  includeFullScreenshot={includeFullScreenshot}
                  includeCropImages={includeCropImages}
                  includeSettings={includeSettings}
                  hasCapture={hasCapture}
                  cropImageCount={diagnosticCropImageCount}
                />
              )}
            </motion.div>
          </AnimatePresence>

          {error && (
            <p className="feedback-error" role="alert">
              <AlertTriangle size={15} />
              {error}
            </p>
          )}

          <FeedbackActions
            step={step}
            submitState={submitState}
            canProceed={canProceed}
            canSubmit={canSubmit}
            onBack={() => setStep(step === "review" ? "diagnostics" : "details")}
            onClose={onClose}
            onNext={() => {
              if (canProceed) {
                setError(null);
                setStep(step === "details" ? "diagnostics" : "review");
              }
            }}
          />
        </form>
    </MotionDialogFrame>
  );
}
