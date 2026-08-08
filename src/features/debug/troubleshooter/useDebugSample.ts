import { useCallback, useEffect, useMemo, useState } from "react";

export type DebugSampleLoadState =
  | { status: "idle"; source: string; sample: null; error: null }
  | { status: "loading"; source: string; sample: null; error: null }
  | { status: "ready"; source: string; sample: unknown; error: null }
  | { status: "error"; source: string; sample: null; error: string };

export function useDebugSample() {
  const initialSource = useMemo(getInitialSampleSource, []);
  const [input, setInput] = useState(initialSource);
  const [state, setState] = useState<DebugSampleLoadState>({
    status: "idle",
    source: initialSource,
    sample: null,
    error: null,
  });

  const load = useCallback(async (value: string) => {
    let source: string;
    try {
      source = normalizeSampleSource(value);
    } catch (error) {
      setState({
        status: "error",
        source: value,
        sample: null,
        error: error instanceof Error ? error.message : "샘플 주소를 확인해주세요.",
      });
      return;
    }

    setInput(source);
    setState({ status: "loading", source, sample: null, error: null });
    try {
      const response = await fetch(getSampleFetchUrl(source), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`샘플 조회 실패 (HTTP ${response.status})`);
      }
      const sample = await response.json();
      setState({ status: "ready", source, sample, error: null });
    } catch (error) {
      setState({
        status: "error",
        source,
        sample: null,
        error: error instanceof Error ? error.message : "샘플을 불러오지 못했습니다.",
      });
    }
  }, []);

  useEffect(() => {
    if (initialSource) void load(initialSource);
  }, [initialSource, load]);

  return {
    input,
    setInput,
    state,
    load,
    reload: () => (state.source ? load(state.source) : Promise.resolve()),
  };
}

export function normalizeSampleSource(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("샘플 ID 또는 조회 주소를 입력해주세요.");

  if (/^[a-zA-Z0-9-]{8,}$/.test(trimmed) && !trimmed.includes("/")) {
    return buildSameOriginSampleUrl(trimmed);
  }

  let url: URL;
  try {
    url = new URL(trimmed, window.location.origin);
  } catch {
    throw new Error("올바른 샘플 ID 또는 URL이 아닙니다.");
  }

  if (url.pathname.includes("timer-report-troubleshooter")) {
    const id = url.searchParams.get("sample") ?? url.searchParams.get("id");
    if (!id) throw new Error("트러블슈터 주소에 sample 값이 없습니다.");
    const sampleUrl = new URL("/api/debug-samples", url.origin);
    sampleUrl.searchParams.set("id", id);
    const token = url.searchParams.get("token");
    if (token) sampleUrl.searchParams.set("token", token);
    return sampleUrl.toString();
  }

  if (url.pathname !== "/api/debug-samples" || !url.searchParams.get("id")) {
    throw new Error("샘플 조회 API 주소 또는 샘플 ID를 입력해주세요.");
  }
  return url.toString();
}

function getInitialSampleSource() {
  const params = new URLSearchParams(window.location.search);
  const sampleUrl = params.get("sampleUrl");
  if (sampleUrl) return normalizeSampleSource(sampleUrl);
  const id = params.get("sample") ?? params.get("id");
  return id ? buildSameOriginSampleUrl(id) : "";
}

function buildSameOriginSampleUrl(id: string) {
  const isLocalDevelopment =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  const origin = isLocalDevelopment ? "https://maple-timer.com" : window.location.origin;
  const url = new URL("/api/debug-samples", origin);
  url.searchParams.set("id", id);
  const token = new URLSearchParams(window.location.search).get("token");
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

function getSampleFetchUrl(source: string) {
  const target = new URL(source);
  const current = new URL(window.location.href);
  const canUseProxy =
    current.hostname === "maple-timer.com" ||
    current.hostname === "preview.maple-timer.pages.dev";
  if (target.origin !== current.origin && canUseProxy) {
    return `/api/debug-sample-proxy?url=${encodeURIComponent(target.toString())}`;
  }
  return target.toString();
}
