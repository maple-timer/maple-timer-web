import {
  Bell,
  CheckCircle2,
  HelpCircle,
  MousePointer2,
  MonitorUp,
  Settings2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect } from "react";
import { BROWSER_SUPPORT_NOTICE } from "../../lib/browserSupport";
import { USAGE_GUIDE_SECTIONS } from "../../lib/usageGuide";
import { MotionDialogFrame } from "../../shared/components/MotionDialogFrame";

const START_GUIDE_SECTION = USAGE_GUIDE_SECTIONS.find((section) => section.id === "start");

const GUIDE_STEP_TITLES = [
  "화면 공유",
  "기능 켜기",
  "영역 선택",
  "알림 조정",
  "보스용 알림",
  "제보하기",
];

const GUIDE_STEP_ICONS: LucideIcon[] = [
  MonitorUp,
  CheckCircle2,
  MousePointer2,
  Settings2,
  Bell,
  HelpCircle,
];

const FALLBACK_GUIDE_POINTS = [
  "**메이플스토리가 보이는 창이나 화면**을 선택합니다.",
  "사용할 기능을 확인하고 필요한 기능을 켭니다.",
  "영역 선택이 필요한 기능은 영역 선택 버튼을 클릭해 가이드에 맞춰 영역을 선택합니다.",
  "알림 시점, 반복 알림, 랜덤 지연, 알림음을 필요한 만큼 조정합니다.",
  "보스에서는 **특수 코어 알림**과 **특수 코어 PIP**를 따로 사용할 수 있습니다.",
  "제대로 동작하지 않는다면 각 패널의 **제보하기**로 알려주세요.",
];

const GUIDE_STEPS = (START_GUIDE_SECTION?.points ?? FALLBACK_GUIDE_POINTS).map((body, index) => ({
  icon: GUIDE_STEP_ICONS[index] ?? CheckCircle2,
  title: GUIDE_STEP_TITLES[index] ?? "확인",
  body,
}));

function renderOnboardingText(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }

    return part;
  });
}

export function OnboardingModal({
  onClose,
  onOpenGuide,
  onDismissPermanently,
}: {
  onClose: () => void;
  onOpenGuide?: () => void;
  onDismissPermanently: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <MotionDialogFrame
      backdropClassName="onboarding-backdrop"
      dialogClassName="onboarding-dialog setup-onboarding-dialog"
      labelledBy="onboarding-title"
      onBackdropMouseDown={onClose}
      onDialogMouseDown={(event) => event.stopPropagation()}
    >
        <header className="onboarding-header">
          <div>
            <p className="eyebrow">Guide</p>
            <h2 id="onboarding-title">처음 설정은 이렇게 합니다</h2>
          </div>
          <button
            className="icon-button small"
            type="button"
            aria-label="가이드 닫기"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className="onboarding-main">
          <div className="onboarding-guide-copy">
            <p className="onboarding-browser-note">
              <span aria-hidden="true">i</span>
              {BROWSER_SUPPORT_NOTICE}
            </p>

            <ol className="onboarding-steps" aria-label="사용 순서">
              {GUIDE_STEPS.map((step, index) => {
                const Icon = step.icon;
                return (
                  <li key={step.title}>
                    <div className="onboarding-step-title-row">
                      <span className="onboarding-step-number">{index + 1}</span>
                      <strong>{step.title}</strong>
                    </div>
                    <div className="onboarding-step-detail-row">
                      <span className="onboarding-step-icon" aria-hidden="true">
                        <Icon size={18} />
                      </span>
                      <p>{renderOnboardingText(step.body)}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="onboarding-video-frame">
            <video
              aria-label="Maple Timer 사용 방법 영상"
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              src="/media/getting-started-guide.mp4"
            />
          </div>
        </div>

        <div className="onboarding-actions">
          {onOpenGuide && (
            <button className="secondary-button" type="button" onClick={onOpenGuide}>
              자세히 보기
            </button>
          )}
          <button className="secondary-button" type="button" onClick={onDismissPermanently}>
            다시 보지 않기
          </button>
          <button className="primary-button" type="button" onClick={onClose}>
            시작하기
          </button>
        </div>
    </MotionDialogFrame>
  );
}
