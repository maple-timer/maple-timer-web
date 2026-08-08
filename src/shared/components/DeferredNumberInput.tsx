import { useEffect, useRef, useState } from "react";

type FeedbackState = "invalid" | "corrected" | null;

function parseDraft(value: string, min: number, max: number) {
  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: false, corrected: false, value: null };
  }

  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) {
    return { valid: false, corrected: false, value: null };
  }

  const rounded = Math.round(numeric);
  const clamped = Math.min(max, Math.max(min, rounded));
  return {
    valid: true,
    corrected: clamped !== rounded,
    value: clamped,
  };
}

export function DeferredNumberInput({
  value,
  min,
  max,
  step = 1,
  disabled = false,
  autoFocus = false,
  ariaLabel,
  className,
  onCommit,
  onEditingComplete,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel: string;
  className: string;
  onCommit: (value: number) => void;
  onEditingComplete?: () => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [isFocused, setFocused] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [draftInvalidPulse, setDraftInvalidPulse] = useState(false);
  const feedbackTimer = useRef<number | null>(null);
  const draftInvalidTimer = useRef<number | null>(null);
  const draftInvalidFrame = useRef<number | null>(null);

  useEffect(() => {
    if (!isFocused) {
      setDraft(String(value));
    }
  }, [isFocused, value]);

  useEffect(
    () => () => {
      if (feedbackTimer.current !== null) {
        window.clearTimeout(feedbackTimer.current);
      }
    },
    [],
  );

  const flash = (state: FeedbackState) => {
    if (feedbackTimer.current !== null) {
      window.clearTimeout(feedbackTimer.current);
    }
    setFeedback(state);
    feedbackTimer.current = window.setTimeout(() => setFeedback(null), 520);
  };

  const parsed = parseDraft(draft, min, max);
  const isDraftInvalid =
    isFocused && draft.trim() !== "" && (!parsed.valid || parsed.corrected);

  useEffect(() => {
    if (draftInvalidFrame.current !== null) {
      window.cancelAnimationFrame(draftInvalidFrame.current);
      draftInvalidFrame.current = null;
    }
    if (draftInvalidTimer.current !== null) {
      window.clearTimeout(draftInvalidTimer.current);
      draftInvalidTimer.current = null;
    }

    if (!isDraftInvalid) {
      setDraftInvalidPulse(false);
      return;
    }

    setDraftInvalidPulse(false);
    draftInvalidFrame.current = window.requestAnimationFrame(() => {
      setDraftInvalidPulse(true);
      draftInvalidTimer.current = window.setTimeout(() => {
        setDraftInvalidPulse(false);
        draftInvalidTimer.current = null;
      }, 260);
    });
  }, [draft, isDraftInvalid]);

  useEffect(
    () => () => {
      if (draftInvalidFrame.current !== null) {
        window.cancelAnimationFrame(draftInvalidFrame.current);
      }
      if (draftInvalidTimer.current !== null) {
        window.clearTimeout(draftInvalidTimer.current);
      }
    },
    [],
  );

  const commitDraft = () => {
    const next = parseDraft(draft, min, max);
    if (!next.valid || next.value === null) {
      setDraft(String(value));
      flash("invalid");
      return;
    }

    setDraft(String(next.value));
    if (next.value !== value) {
      onCommit(next.value);
    }
    if (next.corrected) {
      flash("corrected");
    } else {
      setFeedback(null);
    }
  };

  const inputClassName = [
    className,
    "deferred-number-input",
    isDraftInvalid ? "number-input-invalid" : "",
    draftInvalidPulse ? "number-input-draft-invalid-pulse" : "",
    feedback === "corrected" ? "number-input-corrected" : "",
    feedback === "invalid" ? "number-input-empty-invalid" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <input
      aria-invalid={isDraftInvalid || feedback === "invalid"}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      className={inputClassName}
      disabled={disabled}
      inputMode={min < 0 ? "decimal" : "numeric"}
      max={max}
      min={min}
      step={step}
      type="number"
      value={draft}
      onBlur={() => {
        setFocused(false);
        commitDraft();
        onEditingComplete?.();
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        setFeedback(null);
      }}
      onFocus={(event) => {
        setFocused(true);
        event.currentTarget.select();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(String(value));
          setFeedback(null);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
