import { AlertTriangle, Check, X } from "lucide-react";
import { AnimatePresence, m as motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AlertIssueReportTarget } from "../../application/reporting/alertIssueReportAvailability";
import { createAlertIssueIncidentId } from "../../contracts/reporting/alertReportIncident";
import type {
  AlertIssueOccurrence,
  AlertIssueOtherCategory,
  AlertIssueScenario,
} from "../../contracts/reporting/alertIssueScenario";
import { MotionDialogFrame } from "../../shared/components/MotionDialogFrame";
import type { AlertIssueReportDetails } from "./alertReportPayloads";
import type { AlertIssueReportPreflight } from "./alertIssueReportPreflight";
import {
  getAlertIssueReportCheckPanelClassName,
  getAlertIssueReportAffectedTargetOptions,
  getAlertIssueReportDialogCopy,
  getAlertIssueReportOccurrenceOptions,
  getAlertIssueReportOtherCategoryOptions,
  getAlertIssueReportScenarioOptions,
  getAlertIssueReportSelectedOption,
  getAlertIssueReportStepTitle,
  getAlertIssueReportSubmitLabel,
  type AlertIssueReportStep,
} from "./alertIssueReportDialogViewModel";

export type AlertIssueReportContext = {
  previewUrl: string | null;
  previewLabel: string;
  emptyPreviewLabel: string;
  statusText: string;
  checklist: string[];
  guideVideoSrc: string;
  guideVideoLabel: string;
  guideTitle: string;
  preflight?: AlertIssueReportPreflight | null;
};

const STEP_VIEWPORT_HEIGHT_BUFFER = 10;
const BUFF_SLOT_PREFLIGHT_IMAGES = [
  {
    src: "/media/quickslot-buff-time-large-center.png",
    alt: "퀵슬롯과 버프 시간 표시가 중앙, 크게로 설정된 예시",
    label: "퀵슬롯&버프 시간표시",
  },
  {
    src: "/media/buff-sort-options.png",
    alt: "버프 표시 방식, 자동 정렬 적용, 버프 최소화 기능 사용 설정 예시",
    label: "버프 정렬과 표시 방식",
  },
] as const;

export function AlertIssueReportDialog({
  target,
  context,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  target: AlertIssueReportTarget;
  context: AlertIssueReportContext;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (issue: AlertIssueReportDetails) => Promise<boolean>;
}) {
  const copy = getAlertIssueReportDialogCopy(target);
  const { title, description, isSingleStep, options } = copy;
  const [selectedReason, setSelectedReason] = useState(options[0].reason);
  const [incidentId] = useState(createAlertIssueIncidentId);
  const initialScenario = getAlertIssueReportScenarioOptions(options[0].reason)[0];
  const [selectedScenario, setSelectedScenario] = useState<AlertIssueScenario>(
    initialScenario.scenario,
  );
  const [selectedOccurrence, setSelectedOccurrence] =
    useState<AlertIssueOccurrence>("recent");
  const otherCategoryOptions = getAlertIssueReportOtherCategoryOptions();
  const [selectedOtherCategory, setSelectedOtherCategory] =
    useState<AlertIssueOtherCategory>(otherCategoryOptions[0].category);
  const affectedTargetOptions = useMemo(
    () => getAlertIssueReportAffectedTargetOptions(target),
    [target],
  );
  const [selectedAffectedTargetId, setSelectedAffectedTargetId] = useState(
    affectedTargetOptions[0]?.id ?? "",
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<AlertIssueReportStep>(() =>
    context.preflight ? "preflight" : "issue",
  );
  const [direction, setDirection] = useState(1);
  const [stepHeight, setStepHeight] = useState<number | null>(null);
  const stepObserverRef = useRef<ResizeObserver | null>(null);
  const shouldReduceMotion = useReducedMotion();
  const isPreflightStep = step === "preflight";
  const selectedOption = useMemo(
    () => getAlertIssueReportSelectedOption({ options, selectedReason }),
    [options, selectedReason],
  );
  const scenarioOptions = useMemo(
    () => getAlertIssueReportScenarioOptions(selectedReason),
    [selectedReason],
  );
  const occurrenceOptions = getAlertIssueReportOccurrenceOptions();
  const selectedScenarioOption = useMemo(
    () =>
      scenarioOptions.find((option) => option.scenario === selectedScenario) ??
      scenarioOptions[0],
    [scenarioOptions, selectedScenario],
  );
  const selectedAffectedTarget = useMemo(
    () =>
      affectedTargetOptions.find((option) => option.id === selectedAffectedTargetId) ??
      null,
    [affectedTargetOptions, selectedAffectedTargetId],
  );
  const stepTitle = getAlertIssueReportStepTitle(step);
  const submitLabel = getAlertIssueReportSubmitLabel({ isSingleStep, isSubmitting, step });
  const isOther = selectedOption.reason === "other";
  const hasGuideMedia = Boolean(context.guideVideoSrc);
  const isSkillBuffDurationReview =
    target.kind === "skill" && context.previewLabel === "현재 우상단 버프칸 분석 화면";
  const isSpecialCoreReview = target.kind === "special-core";
  const reviewDescription = isSkillBuffDurationReview
    ? "버프 즐겨찾기 설정과 전송될 화면을 확인한 뒤 제보를 보내주세요."
    : hasGuideMedia
      ? "현재 선택한 영역과 예시를 비교한 뒤 제보를 보내주세요."
      : "전송될 화면을 확인한 뒤 제보를 보내주세요.";
  const compareGridClassName = [
    "issue-report-compare-grid",
    hasGuideMedia ? "" : "no-guide",
    isSkillBuffDurationReview ? "skill-buff-duration-review" : "",
    isSpecialCoreReview ? "special-core-review" : "",
  ].filter(Boolean).join(" ");
  const validateIssue = () => {
    const trimmedNote = note.trim();
    if (isOther && !trimmedNote) {
      setError("기타를 선택한 경우 내용을 한 줄로 적어주세요.");
      return false;
    }

    setError(null);
    return true;
  };
  const buildIssueDetails = (): AlertIssueReportDetails => ({
    reason: selectedOption.reason,
    label: selectedOption.label,
    note: note.trim() || undefined,
    incidentId,
    scenario: selectedScenarioOption.scenario,
    scenarioLabel: selectedScenarioOption.label,
    occurrence: selectedOccurrence,
    affectedTarget: selectedAffectedTarget ?? undefined,
    otherCategory: isOther ? selectedOtherCategory : undefined,
    otherCategoryLabel: isOther
      ? otherCategoryOptions.find(
          (option) => option.category === selectedOtherCategory,
        )?.label
      : undefined,
  });
  const goToIssueStep = () => {
    setError(null);
    setDirection(-1);
    setStep("issue");
  };
  const goToCheckStep = () => {
    if (validateIssue()) {
      setDirection(1);
      setStep("check");
    }
  };
  const goToPreflightIssueStep = () => {
    setError(null);
    setDirection(1);
    setStep("issue");
  };
  const setStepMotionNode = useCallback((node: HTMLDivElement | null) => {
    stepObserverRef.current?.disconnect();
    stepObserverRef.current = null;

    if (!node) {
      return;
    }

    const updateHeight = () => {
      setStepHeight(Math.ceil(node.getBoundingClientRect().height) + STEP_VIEWPORT_HEIGHT_BUFFER);
    };

    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);
    stepObserverRef.current = observer;
  }, []);

  useEffect(() => {
    return () => {
      stepObserverRef.current?.disconnect();
    };
  }, []);

  return (
    <MotionDialogFrame
      backdropClassName="issue-report-backdrop"
      dialogClassName="issue-report-dialog"
      dialogLayout="size"
      labelledBy="issue-report-title"
      onBackdropMouseDown={isSubmitting ? undefined : onClose}
      onDialogMouseDown={(event) => event.stopPropagation()}
    >
        {isSubmitting && (
          <div className="modal-progress-bar" role="status" aria-label="감지 제보 전송 중" />
        )}
        <header className="issue-report-header">
          <div>
            <p className="eyebrow">Report</p>
            <h2 id="issue-report-title">{title}</h2>
            <p>{description}</p>
          </div>
          {!isSingleStep && !isPreflightStep && (
            <div className="issue-report-step-indicator" aria-label="제보 단계">
              <button
                type="button"
                className={step === "issue" ? "active" : ""}
                aria-current={step === "issue" ? "step" : undefined}
                disabled={isSubmitting}
                onClick={goToIssueStep}
              >
                문제 선택
              </button>
              <button
                type="button"
                className={step === "check" ? "active" : ""}
                aria-current={step === "check" ? "step" : undefined}
                disabled={isSubmitting}
                onClick={goToCheckStep}
              >
                확인
              </button>
            </div>
          )}
          <button
            className="icon-button small"
            type="button"
            aria-label="닫기"
            disabled={isSubmitting}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <motion.form
          className="issue-report-form"
          layout
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          onSubmit={async (event) => {
            event.preventDefault();
            if (isPreflightStep) {
              goToPreflightIssueStep();
              return;
            }
            if (isSingleStep) {
              if (!validateIssue()) {
                return;
              }

              const didSubmit = await onSubmit(buildIssueDetails());
              if (didSubmit) {
                onClose();
              }
              return;
            }

            if (step !== "check") {
              goToCheckStep();
              return;
            }
            if (!validateIssue()) {
              setStep("issue");
              return;
            }

            setError(null);
            setDirection(1);
            const didSubmit = await onSubmit(buildIssueDetails());
            if (didSubmit) {
              onClose();
            }
          }}
        >
          <motion.div
            className="issue-report-step-viewport"
            animate={shouldReduceMotion || stepHeight === null ? undefined : { height: stepHeight }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                className="issue-report-step-motion"
                initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, x: direction * 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, x: direction * -16 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                <div ref={setStepMotionNode} className="issue-report-step-measure">
                  {step === "issue" ? (
                    <>
                      <fieldset className="issue-report-question-panel">
                        <legend>{stepTitle}</legend>
                        <p>
                          선택한 항목과 현재 화면 일부가 함께 전송됩니다. 아래에서 가장 가까운 상황을 골라주세요.
                        </p>
                        {options.map((option) => {
                          const isSelected = selectedReason === option.reason;

                          return (
                            <label
                              className={isSelected ? "issue-report-option selected" : "issue-report-option"}
                              key={option.reason}
                            >
                              <input
                                className="issue-report-radio-input"
                                type="radio"
                                name="issue-report-reason"
                                value={option.reason}
                                checked={isSelected}
                                disabled={isSubmitting}
                                onChange={() => {
                                  setSelectedReason(option.reason);
                                  setSelectedScenario(
                                    getAlertIssueReportScenarioOptions(option.reason)[0].scenario,
                                  );
                                  setError(null);
                                }}
                              />
                              <motion.span
                                className="issue-report-option-mark"
                                aria-hidden="true"
                                animate={
                                  shouldReduceMotion
                                    ? undefined
                                    : {
                                        opacity: isSelected ? 1 : 0.56,
                                        scale: isSelected ? 1 : 0.86,
                                      }
                                }
                                transition={
                                  shouldReduceMotion
                                    ? undefined
                                    : { duration: 0.14, ease: [0.22, 1, 0.36, 1] }
                                }
                              >
                                {isSelected && <Check size={13} strokeWidth={3} />}
                              </motion.span>
                              <span className="issue-report-option-label">{option.label}</span>
                            </label>
                          );
                        })}
                      </fieldset>

                      <fieldset className="issue-report-context-panel issue-report-scenario-panel">
                        <legend>어느 단계에서 달랐나요?</legend>
                        <div className="issue-report-context-options">
                          {scenarioOptions.map((option) => {
                            const isSelected = selectedScenario === option.scenario;
                            return (
                              <label
                                className={
                                  isSelected
                                    ? "issue-report-context-option selected"
                                    : "issue-report-context-option"
                                }
                                key={option.scenario}
                              >
                                <input
                                  type="radio"
                                  name="issue-report-scenario"
                                  value={option.scenario}
                                  checked={isSelected}
                                  disabled={isSubmitting}
                                  onChange={() => setSelectedScenario(option.scenario)}
                                />
                                <span>{option.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>

                      <fieldset className="issue-report-context-panel">
                        <legend>언제 있었나요?</legend>
                        <p className="issue-report-context-help">
                          제보를 누른 뒤 전송된 시각이 아니라, 실제 문제가 있었던 시점을 골라주세요.
                        </p>
                        <div className="issue-report-context-options compact">
                          {occurrenceOptions.map((option) => {
                            const isSelected = selectedOccurrence === option.occurrence;
                            return (
                              <label
                                className={
                                  isSelected
                                    ? "issue-report-context-option selected"
                                    : "issue-report-context-option"
                                }
                                key={option.occurrence}
                              >
                                <input
                                  type="radio"
                                  name="issue-report-occurrence"
                                  value={option.occurrence}
                                  checked={isSelected}
                                  disabled={isSubmitting}
                                  onChange={() => setSelectedOccurrence(option.occurrence)}
                                />
                                <span>{option.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>

                      {isOther && (
                        <fieldset className="issue-report-context-panel">
                          <legend>어떤 종류의 문제인가요?</legend>
                          <div className="issue-report-context-options">
                            {otherCategoryOptions.map((option) => {
                              const isSelected =
                                selectedOtherCategory === option.category;
                              return (
                                <label
                                  className={
                                    isSelected
                                      ? "issue-report-context-option selected"
                                      : "issue-report-context-option"
                                  }
                                  key={option.category}
                                >
                                  <input
                                    type="radio"
                                    name="issue-report-other-category"
                                    value={option.category}
                                    checked={isSelected}
                                    disabled={isSubmitting}
                                    onChange={() =>
                                      setSelectedOtherCategory(option.category)
                                    }
                                  />
                                  <span>{option.label}</span>
                                </label>
                              );
                            })}
                          </div>
                        </fieldset>
                      )}

                      {affectedTargetOptions.length > 0 && (
                        <label className="field-label issue-report-target-select">
                          <span>어떤 버프였나요?</span>
                          <select
                            value={selectedAffectedTargetId}
                            disabled={isSubmitting}
                            onChange={(event) => setSelectedAffectedTargetId(event.target.value)}
                          >
                            {affectedTargetOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}

                      <label className="field-label issue-report-note">
                        <span>{isOther ? "상세 내용" : "추가 설명 (선택)"}</span>
                        <input
                          type="text"
                          value={note}
                          maxLength={120}
                          disabled={isSubmitting}
                          placeholder={
                            isOther
                              ? "예: 특정 맵에서 룬 아이콘을 놓쳐요"
                              : "문제가 생긴 조건이 있다면 적어주세요"
                          }
                          onChange={(event) => setNote(event.target.value)}
                        />
                      </label>

                      {isSingleStep && (
                        <section className="issue-report-check-panel" aria-label="전송 내용 안내">
                          <div className="issue-report-section-heading">
                            <span>함께 전송되는 내용</span>
                          </div>
                          <ul>
                            {context.checklist.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </section>
                      )}
                    </>
                  ) : (
                    <>
                      <section
                        className={
                          isPreflightStep
                            ? "issue-report-review-copy issue-report-preflight-copy"
                            : "issue-report-review-copy"
                        }
                        aria-label="확인 안내"
                      >
                        <div>
                          {isPreflightStep ? (
                            <h3>{context.preflight?.description ?? reviewDescription}</h3>
                          ) : (
                            <>
                              <h3>{stepTitle}</h3>
                              <p>{reviewDescription}</p>
                            </>
                          )}
                        </div>
                        {step === "check" && (
                          <div className="issue-report-selected-context">
                            <span className="issue-report-selected-reason">{selectedOption.label}</span>
                            <span className="issue-report-selected-reason">
                              {selectedScenarioOption.label}
                            </span>
                          </div>
                        )}
                      </section>

                      {isPreflightStep ? (
                        <>
                          <div className={compareGridClassName}>
                            <section className="issue-report-current-panel issue-report-preflight-examples-panel" aria-label="설정 예시">
                              <div className="issue-report-section-heading">
                                <span>설정 예시</span>
                              </div>
                              <div className="issue-report-preflight-image-stack">
                                {BUFF_SLOT_PREFLIGHT_IMAGES.map((image) => (
                                  <figure className="issue-report-preflight-image-card" key={image.src}>
                                    <img src={image.src} alt={image.alt} />
                                    <figcaption>{image.label}</figcaption>
                                  </figure>
                                ))}
                              </div>
                              <p className="issue-report-status-note">
                                예시와 다르면 게임 설정을 먼저 조정해주세요.
                              </p>
                            </section>

                            {hasGuideMedia && (
                              <section className="issue-report-video-stage" aria-label={context.guideTitle}>
                                <div className="issue-report-section-heading">
                                  <span>{context.guideTitle}</span>
                                </div>
                                <video
                                  src={context.guideVideoSrc}
                                  aria-label={context.guideVideoLabel}
                                  autoPlay
                                  loop
                                  muted
                                  playsInline
                                  preload="metadata"
                                />
                                <p className="issue-report-status-note">
                                  예시와 다르게 보이면 설정을 먼저 조정한 뒤 제보해주세요.
                                </p>
                              </section>
                            )}
                          </div>

                          <section
                            className={`${getAlertIssueReportCheckPanelClassName(target)} issue-report-preflight-checklist`}
                            aria-label="확인할 설정"
                          >
                            <div className="issue-report-section-heading">
                              <span>확인할 설정</span>
                            </div>
                            <ul>
                              {context.checklist.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </section>
                        </>
                      ) : (
                        <>
                          <div className={compareGridClassName}>
                            <section className="issue-report-current-panel" aria-label="현재 선택한 영역">
                              <div className="issue-report-section-heading">
                                <span>전송될 화면</span>
                              </div>
                              <div className="issue-report-preview-frame">
                                {context.previewUrl ? (
                                  <img src={context.previewUrl} alt={context.previewLabel} />
                                ) : (
                                  <span>{context.emptyPreviewLabel}</span>
                                )}
                              </div>
                              <p className="issue-report-status-note">{context.statusText}</p>
                            </section>

                            {hasGuideMedia && (
                              <section className="issue-report-video-stage" aria-label={context.guideTitle}>
                                <div className="issue-report-section-heading">
                                  <span>{context.guideTitle}</span>
                                </div>
                                <video
                                  src={context.guideVideoSrc}
                                  aria-label={context.guideVideoLabel}
                                  autoPlay
                                  loop
                                  muted
                                  playsInline
                                  preload="metadata"
                                />
                                <p className="issue-report-status-note">
                                  예시와 다르게 보이면 이전 단계로 돌아가 사유를 다시 선택해 주세요.
                                </p>
                              </section>
                            )}
                          </div>

                          <section
                            className={getAlertIssueReportCheckPanelClassName(target)}
                            aria-label="보내기 전 확인"
                          >
                            <div className="issue-report-section-heading">
                              <span>제보 전 체크리스트</span>
                            </div>
                            <ul>
                              {context.checklist.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </section>
                        </>
                      )}
                    </>
                  )}
                </div>
              </motion.div>
            </AnimatePresence>
          </motion.div>

          {error && (
            <p className="issue-report-error" role="alert">
              <AlertTriangle size={15} />
              {error}
            </p>
          )}

          <div className="issue-report-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={isSubmitting}
              onClick={step === "check" ? goToIssueStep : onClose}
            >
              {step === "check" ? "이전" : "취소"}
            </button>
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting && <span className="submit-spinner" aria-hidden="true" />}
              {submitLabel}
            </button>
          </div>
        </motion.form>
    </MotionDialogFrame>
  );
}
