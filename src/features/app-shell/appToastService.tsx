import { AlertCircle, AlertTriangle, Check, Info, Loader2 } from "lucide-react";
import { m as motion, useReducedMotion } from "motion/react";
import type { CSSProperties } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { APP_TOAST_ID_PREFIX, APP_TOASTER_ID } from "./appToastConstants";
import { getAppToastPresentation, type AppToastTone } from "./appToastModel";

const DEFAULT_TOAST_DURATION_MS = 4500;
const ERROR_TOAST_DURATION_MS = 6500;

export function showAppToast(message: string | null) {
  if (!message) {
    toast.dismiss();
    return;
  }

  const presentation = getAppToastPresentation(message);
  const duration = presentation.tone === "error" ? ERROR_TOAST_DURATION_MS : DEFAULT_TOAST_DURATION_MS;
  const stableToastId = createAppToastId(message);

  toast.custom((toastId) => <AppToastCard duration={duration} toastId={toastId} {...presentation} />, {
    id: stableToastId,
    toasterId: APP_TOASTER_ID,
    className: "app-toast-host",
    duration,
    unstyled: true,
  });
}

function createAppToastId(message: string): string {
  let hash = 5381;
  for (let index = 0; index < message.length; index += 1) {
    hash = (hash * 33) ^ message.charCodeAt(index);
  }
  return `${APP_TOAST_ID_PREFIX}:${(hash >>> 0).toString(36)}`;
}

type AppToastCardProps = {
  tone: AppToastTone;
  title: string;
  description: string | null;
  duration: number;
  toastId: number | string;
};

function AppToastCard({ tone, title, description, duration, toastId }: AppToastCardProps) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      className={`app-toast-card app-toast--${tone}`}
      initial={reducedMotion ? false : { opacity: 0, y: 10, scale: 0.965 }}
      animate={reducedMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      transition={
        reducedMotion
          ? undefined
          : {
              duration: 0.34,
              ease: [0.2, 0.86, 0.24, 1],
            }
      }
      style={
        {
          "--app-toast-duration": `${duration}ms`,
        } as CSSProperties
      }
    >
      <div className="app-toast-icon" aria-hidden="true">
        {getToastIcon(tone)}
      </div>
      <div className="app-toast-content">
        <strong className="app-toast-title">{title}</strong>
        {description ? <p className="app-toast-description">{description}</p> : null}
      </div>
      <button
        aria-label="토스트 닫기"
        className="app-toast-close"
        onClick={() => toast.dismiss(toastId)}
        type="button"
      >
        ×
      </button>
    </motion.div>
  );
}

function getToastIcon(tone: AppToastTone): ReactNode {
  if (tone === "success") {
    return <Check size={18} strokeWidth={2.7} />;
  }
  if (tone === "warning") {
    return <AlertTriangle size={18} strokeWidth={2.5} />;
  }
  if (tone === "error") {
    return <AlertCircle size={18} strokeWidth={2.5} />;
  }
  if (tone === "loading") {
    return <Loader2 className="app-toast-spinner" size={18} strokeWidth={2.5} />;
  }
  return <Info size={18} strokeWidth={2.5} />;
}
