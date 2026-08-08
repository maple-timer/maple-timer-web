import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AlertDisableSnapshot } from "../../../lib/alertDisableSnapshot";
import { useAlertDisableSnapshot } from "./useAlertDisableSnapshot";

const STORAGE_KEY = "maple-timer.alert-disable.snapshot.v1";

describe("useAlertDisableSnapshot", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("keeps React state, the runtime ref, and persisted state synchronized", () => {
    const snapshot: AlertDisableSnapshot = {
      skills: { janus: true },
      runeEnabled: true,
      huntStallEnabled: false,
      buffExpiryEnabled: true,
      boosterExpiryEnabled: false,
      specialCoreEnabled: true,
      generalTimers: { timer: true },
      generalTimerRunning: { timer: false },
      createdAt: 1234,
    };
    const { result } = renderHook(() => useAlertDisableSnapshot());

    act(() => {
      result.current.activateAlertDisableSnapshot(snapshot);
    });

    expect(result.current.alertDisableSnapshot).toEqual(snapshot);
    expect(result.current.alertDisableSnapshotRef.current).toEqual(snapshot);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual(snapshot);

    act(() => {
      result.current.clearAlertDisableSnapshotState();
    });

    expect(result.current.alertDisableSnapshot).toBeNull();
    expect(result.current.alertDisableSnapshotRef.current).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
