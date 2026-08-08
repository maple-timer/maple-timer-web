import { CheckCircle2, Send } from "lucide-react";

export type FeedbackSubmitState = "idle" | "submitting" | "done";
export type FeedbackActionStep = "details" | "diagnostics" | "review";

export function FeedbackActions({
  step,
  submitState,
  canProceed,
  canSubmit,
  onBack,
  onClose,
  onNext,
}: {
  step: FeedbackActionStep;
  submitState: FeedbackSubmitState;
  canProceed: boolean;
  canSubmit: boolean;
  onBack: () => void;
  onClose: () => void;
  onNext: () => void;
}) {
  const isSubmitting = submitState === "submitting";
  const isDone = submitState === "done";
  const isDetailsStep = step === "details";
  const isReviewStep = step === "review";

  return (
    <div className="feedback-actions">
      <button
        className="secondary-button feedback-action-button feedback-action-secondary"
        type="button"
        onClick={isDetailsStep ? onClose : onBack}
        disabled={isSubmitting}
      >
        {isDetailsStep ? "취소" : "이전"}
      </button>
      {!isReviewStep ? (
        <button
          className="primary-button feedback-action-button feedback-action-primary"
          type="button"
          disabled={!canProceed}
          onClick={onNext}
        >
          다음
        </button>
      ) : (
        <button
          className="primary-button feedback-action-button feedback-action-primary"
          type="submit"
          disabled={!canSubmit}
        >
          {isSubmitting ? (
            <span className="submit-spinner" aria-hidden="true" />
          ) : isDone ? (
            <CheckCircle2 size={16} />
          ) : (
            <Send size={16} />
          )}
          {isSubmitting ? "전송 중" : isDone ? "완료" : "선택한 내용 보내기"}
        </button>
      )}
    </div>
  );
}
