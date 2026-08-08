import { Button } from "@astryxdesign/core/Button";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { ScanSearch } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toneVariant } from "./DetailTabs";
import type {
  PipelineStageStatus,
  TroubleshooterTone,
  TroubleshooterViewModel,
} from "./model";
import { formatMilliseconds } from "./model/sample";
import {
  getCurrentRecognitionAvailability,
  getCurrentRecognitionSources,
  runCurrentRecognition,
  type CurrentRecognitionResult,
} from "./recognition/runCurrentRecognition";

type RecognitionState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ready"; result: CurrentRecognitionResult }
  | { status: "error"; message: string };

export function CurrentRecognitionPanel({ view }: { view: TroubleshooterViewModel }) {
  const sources = useMemo(() => getCurrentRecognitionSources(view), [view]);
  const [sourceId, setSourceId] = useState(() => sources[0]?.id ?? "");
  const availability = useMemo(
    () => getCurrentRecognitionAvailability(view, sourceId),
    [sourceId, view],
  );
  const [state, setState] = useState<RecognitionState>({ status: "idle" });
  const requestIdRef = useRef(0);

  useEffect(() => {
    requestIdRef.current += 1;
    setSourceId(sources[0]?.id ?? "");
    setState({ status: "idle" });
  }, [sources, view.metadata.sampleId]);

  const selectedSource =
    sources.find((source) => source.id === sourceId) ?? sources[0] ?? null;

  function handleSourceChange(value: string) {
    requestIdRef.current += 1;
    setSourceId(value);
    setState({ status: "idle" });
  }

  async function handleRun() {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState({ status: "running" });
    try {
      const result = await runCurrentRecognition(view, sourceId);
      if (requestIdRef.current === requestId) {
        setState({ status: "ready", result });
      }
    } catch (error) {
      if (requestIdRef.current === requestId) {
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "현재 인식기를 실행하지 못했습니다.",
        });
      }
    }
  }

  return (
    <section className="current-recognition" aria-labelledby="current-recognition-title">
      <header className="current-recognition-heading">
        <span>
          <strong id="current-recognition-title">현재 인식기 비교</strong>
          <small>{selectedSource?.description ?? "저장된 원본 한 프레임 재분석"}</small>
        </span>
        <Button
          label={state.status === "ready" ? "다시 분석" : "현재 모델로 분석"}
          icon={<ScanSearch size={16} aria-hidden="true" />}
          size="sm"
          variant="secondary"
          isDisabled={!availability.available || state.status === "running"}
          isLoading={state.status === "running"}
          onClick={() => void handleRun()}
        />
      </header>

      {sources.length > 1 ? (
        <section className="current-recognition-source-picker" aria-label="분석할 프레임">
          <SegmentedControl
            value={selectedSource?.id ?? ""}
            onChange={handleSourceChange}
            label="현재 인식기 입력 프레임"
            size="sm"
            layout="hug"
            isDisabled={state.status === "running"}
            disabledMessage="현재 분석이 끝난 뒤 다른 프레임을 선택할 수 있습니다."
          >
            {sources.map((source) => (
              <SegmentedControlItem
                key={source.id}
                value={source.id}
                label={source.label}
              />
            ))}
          </SegmentedControl>
        </section>
      ) : null}

      {state.status === "idle" ? (
        <p className="current-recognition-help">{availability.reason}</p>
      ) : null}
      {state.status === "running" ? (
        <p className="current-recognition-help" aria-live="polite">
          이 기능의 parser와 모델을 불러와 선택한 프레임을 다시 분석하고 있습니다.
        </p>
      ) : null}
      {state.status === "error" ? (
        <p className="current-recognition-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.status === "ready" ? <RecognitionResult result={state.result} /> : null}
    </section>
  );
}

function RecognitionResult({ result }: { result: CurrentRecognitionResult }) {
  return (
    <section className="current-recognition-result" aria-live="polite">
      <header>
        <StatusDot variant={toneVariant(result.tone)} label={result.title} />
        <span>
          <strong>{result.title}</strong>
          <small>{result.detail}</small>
        </span>
        <code>{formatMilliseconds(result.durationMs)}</code>
      </header>
      <dl className="current-recognition-metrics">
        {result.metrics.map((item) => (
          <span key={item.id} title={item.detail}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </span>
        ))}
      </dl>
      <ol className="current-recognition-stages">
        {result.stages.map((stage, index) => (
          <li key={stage.id} title={stage.detail}>
            <code>{String(index + 1).padStart(2, "0")}</code>
            <StatusDot variant={toneVariant(stageTone(stage.status))} label={stage.label} />
            <span>
              <strong>{stage.label}</strong>
              <small>{stage.summary}</small>
            </span>
          </li>
        ))}
      </ol>
      {result.evidence.length > 0 ? (
        <section className="current-recognition-evidence" aria-label="현재 인식기 후보 이미지">
          {result.evidence.map((item) => (
            <figure key={item.id} title={item.description}>
              <img src={item.src} alt={item.label} />
              <figcaption>{item.label}</figcaption>
            </figure>
          ))}
        </section>
      ) : null}
    </section>
  );
}

function stageTone(status: PipelineStageStatus): TroubleshooterTone {
  if (status === "complete") return "positive";
  if (status === "warning") return "warning";
  if (status === "blocked") return "critical";
  return "neutral";
}
