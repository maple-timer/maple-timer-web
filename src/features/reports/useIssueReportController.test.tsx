import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertIssueReportDetails } from "./alertReportPayloads";
import {
  trackReportOpen,
  trackReportSubmitFailed,
  trackReportSubmitStart,
  trackReportSubmitSuccess,
} from "../../lib/analyticsEvents";
import { createDefaultProfile, createSkill } from "../../lib/storage";
import type { Profile } from "../../types";
import { useIssueReportController } from "./useIssueReportController";
import {
  createAlertIncidentJournal,
  type AlertIncidentJournal,
  type AlertIncidentJournalSelection,
} from "../../application/reporting/alertIncidentJournal";

vi.mock("../../lib/analyticsEvents", () => ({
  trackReportOpen: vi.fn(),
  trackReportSubmitFailed: vi.fn(),
  trackReportSubmitStart: vi.fn(),
  trackReportSubmitSuccess: vi.fn(),
}));

type HookApi = ReturnType<typeof useIssueReportController>;

const ISSUE: AlertIssueReportDetails = {
  reason: "other",
  label: "기타",
  note: "테스트",
};

const trackReportOpenMock = vi.mocked(trackReportOpen);
const trackReportSubmitFailedMock = vi.mocked(trackReportSubmitFailed);
const trackReportSubmitStartMock = vi.mocked(trackReportSubmitStart);
const trackReportSubmitSuccessMock = vi.mocked(trackReportSubmitSuccess);
const noop = () => undefined;

function Harness({
  profile,
  submitRuneIssueReport,
  submitSkillIssueReport,
  submitHuntStallIssueReport,
  submitBuffExpiryIssueReport,
  submitBoosterExpiryIssueReport,
  submitSpecialCoreIssueReport,
  freezeRuneIssueReportEvidence = noop,
  clearRuneIssueReportEvidence = noop,
  freezeBuffExpiryIssueReportEvidence = noop,
  clearBuffExpiryIssueReportEvidence = noop,
  freezeSkillIssueReportEvidence = noop,
  clearSkillIssueReportEvidence = noop,
  freezeHuntStallIssueReportEvidence = noop,
  clearHuntStallIssueReportEvidence = noop,
  freezeBoosterExpiryIssueReportEvidence = noop,
  clearBoosterExpiryIssueReportEvidence = noop,
  freezeSpecialCoreIssueReportEvidence = noop,
  clearSpecialCoreIssueReportEvidence = noop,
  isGloballyDisabled = false,
  alertIncidentJournal,
  setMessage,
  onReady,
}: {
  profile: Profile;
  submitRuneIssueReport: (
    issue: AlertIssueReportDetails,
    journalSelection?: AlertIncidentJournalSelection | null,
  ) => Promise<boolean>;
  submitSkillIssueReport: (
    skillId: string,
    issue: AlertIssueReportDetails,
    journalSelection?: AlertIncidentJournalSelection | null,
  ) => Promise<boolean>;
  submitHuntStallIssueReport: (
    issue: AlertIssueReportDetails,
    journalSelection?: AlertIncidentJournalSelection | null,
  ) => Promise<boolean>;
  submitBuffExpiryIssueReport: (
    issue: AlertIssueReportDetails,
    journalSelection?: AlertIncidentJournalSelection | null,
  ) => Promise<boolean>;
  submitBoosterExpiryIssueReport: (
    issue: AlertIssueReportDetails,
    journalSelection?: AlertIncidentJournalSelection | null,
  ) => Promise<boolean>;
  submitSpecialCoreIssueReport: (
    issue: AlertIssueReportDetails,
    journalSelection?: AlertIncidentJournalSelection | null,
  ) => Promise<boolean>;
  freezeRuneIssueReportEvidence?: (capturedAt: number) => void;
  clearRuneIssueReportEvidence?: () => void;
  freezeBuffExpiryIssueReportEvidence?: (capturedAt: number) => void;
  clearBuffExpiryIssueReportEvidence?: () => void;
  freezeSkillIssueReportEvidence?: (
    skillId: string,
    capturedAt: number,
  ) => void;
  clearSkillIssueReportEvidence?: () => void;
  freezeHuntStallIssueReportEvidence?: (
    capturedAt: number,
    journalSelection?: AlertIncidentJournalSelection | null,
  ) => void;
  clearHuntStallIssueReportEvidence?: () => void;
  freezeBoosterExpiryIssueReportEvidence?: (
    capturedAt: number,
    journalSelection?: AlertIncidentJournalSelection | null,
  ) => void;
  clearBoosterExpiryIssueReportEvidence?: () => void;
  freezeSpecialCoreIssueReportEvidence?: (
    capturedAt: number,
    journalSelection?: AlertIncidentJournalSelection | null,
  ) => void;
  clearSpecialCoreIssueReportEvidence?: () => void;
  isGloballyDisabled?: boolean;
  alertIncidentJournal?: AlertIncidentJournal;
  setMessage: (message: string) => void;
  onReady: (api: HookApi) => void;
}) {
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const api = useIssueReportController({
    profileRef,
    submitRuneIssueReport,
    submitSkillIssueReport,
    submitHuntStallIssueReport,
    submitBuffExpiryIssueReport,
    submitBoosterExpiryIssueReport,
    submitSpecialCoreIssueReport,
    freezeRuneIssueReportEvidence,
    clearRuneIssueReportEvidence,
    freezeBuffExpiryIssueReportEvidence,
    clearBuffExpiryIssueReportEvidence,
    freezeSkillIssueReportEvidence,
    clearSkillIssueReportEvidence,
    freezeHuntStallIssueReportEvidence,
    clearHuntStallIssueReportEvidence,
    freezeBoosterExpiryIssueReportEvidence,
    clearBoosterExpiryIssueReportEvidence,
    freezeSpecialCoreIssueReportEvidence,
    clearSpecialCoreIssueReportEvidence,
    isGloballyDisabled,
    alertIncidentJournal,
    setMessage,
  });

  useEffect(() => {
    onReady(api);
  }, [api, onReady]);

  return null;
}

describe("useIssueReportController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("opens and submits skill reports through the skill submitter", async () => {
    const skill = createSkill({ id: "skill_fountain", name: "에르다 파운틴" });
    const profile = { ...createDefaultProfile(), skills: [skill] };
    const submitSkillIssueReport = vi.fn().mockResolvedValue(true);
    const freezeSkillIssueReportEvidence = vi.fn();
    const clearSkillIssueReportEvidence = vi.fn();
    const apiRef: { current: HookApi | null } = { current: null };
    const getApi = () => {
      if (!apiRef.current) {
        throw new Error("hook api is not ready");
      }
      return apiRef.current;
    };

    render(
      <Harness
        profile={profile}
        submitRuneIssueReport={vi.fn().mockResolvedValue(true)}
        submitSkillIssueReport={submitSkillIssueReport}
        submitHuntStallIssueReport={vi.fn().mockResolvedValue(true)}
        submitBuffExpiryIssueReport={vi.fn().mockResolvedValue(true)}
        submitBoosterExpiryIssueReport={vi.fn().mockResolvedValue(true)}
        submitSpecialCoreIssueReport={vi.fn().mockResolvedValue(true)}
        freezeSkillIssueReportEvidence={freezeSkillIssueReportEvidence}
        clearSkillIssueReportEvidence={clearSkillIssueReportEvidence}
        setMessage={vi.fn()}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getApi().openSkillIssueReport(skill.id);
    });

    await waitFor(() => {
      expect(getApi().issueReportTarget).toEqual({
        kind: "skill",
        skillId: skill.id,
        skillName: "에르다 파운틴",
      });
    });

    let didSubmit = false;
    await act(async () => {
      didSubmit = await getApi().submitIssueReport(ISSUE);
    });

    expect(didSubmit).toBe(true);
    expect(submitSkillIssueReport).toHaveBeenCalledWith(skill.id, ISSUE);
    expect(freezeSkillIssueReportEvidence).toHaveBeenCalledTimes(1);
    expect(freezeSkillIssueReportEvidence).toHaveBeenCalledWith(
      skill.id,
      expect.any(Number),
    );
    expect(clearSkillIssueReportEvidence).toHaveBeenCalledTimes(2);
    expect(trackReportOpenMock).toHaveBeenCalledWith("skill");
    expect(trackReportSubmitStartMock).toHaveBeenCalledWith("skill");
    expect(trackReportSubmitSuccessMock).toHaveBeenCalledWith("skill");
  });

  it("freezes the target journal when the report dialog opens", async () => {
    const skill = createSkill({ id: "skill_janus", name: "솔 야누스" });
    const profile = { ...createDefaultProfile(), skills: [skill] };
    const journal = createAlertIncidentJournal();
    const occurredAt = Date.now() - 1_000;
    journal.record({
      id: "skill-sample",
      feature: "skill",
      targetId: skill.id,
      kind: "decision",
      occurredAt,
      frameId: `frame:${occurredAt}`,
      cycleId: "cycle-1",
      status: "watching",
      decision: "confirmed",
      value: 3,
      details: {},
    });
    const submitSkillIssueReport = vi.fn().mockResolvedValue(true);
    const apiRef: { current: HookApi | null } = { current: null };
    const getApi = () => {
      if (!apiRef.current) throw new Error("hook api is not ready");
      return apiRef.current;
    };

    render(
      <Harness
        profile={profile}
        submitRuneIssueReport={vi.fn().mockResolvedValue(true)}
        submitSkillIssueReport={submitSkillIssueReport}
        submitHuntStallIssueReport={vi.fn().mockResolvedValue(true)}
        submitBuffExpiryIssueReport={vi.fn().mockResolvedValue(true)}
        submitBoosterExpiryIssueReport={vi.fn().mockResolvedValue(true)}
        submitSpecialCoreIssueReport={vi.fn().mockResolvedValue(true)}
        alertIncidentJournal={journal}
        setMessage={vi.fn()}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getApi().openSkillIssueReport(skill.id);
    });
    await waitFor(() => expect(getApi().issueReportTarget?.kind).toBe("skill"));
    await act(async () => {
      await getApi().submitIssueReport(ISSUE);
    });

    const selection = submitSkillIssueReport.mock.calls[0]?.[2];
    expect(selection?.target).toEqual({ feature: "skill", targetId: skill.id });
    expect(
      selection?.entries.map(
        (entry: AlertIncidentJournalSelection["entries"][number]) => entry.id,
      ),
    ).toEqual(["skill-sample"]);
  });

  it("keeps rune runtime evidence frozen until the report dialog closes", async () => {
    const defaults = createDefaultProfile();
    const profile = {
      ...defaults,
      runeAlert: { ...defaults.runeAlert!, enabled: true },
    };
    const freezeRuneIssueReportEvidence = vi.fn();
    const clearRuneIssueReportEvidence = vi.fn();
    const submitRuneIssueReport = vi.fn().mockResolvedValue(false);
    const apiRef: { current: HookApi | null } = { current: null };
    const getApi = () => {
      if (!apiRef.current) throw new Error("hook api is not ready");
      return apiRef.current;
    };

    render(
      <Harness
        profile={profile}
        submitRuneIssueReport={submitRuneIssueReport}
        submitSkillIssueReport={vi.fn().mockResolvedValue(true)}
        submitHuntStallIssueReport={vi.fn().mockResolvedValue(true)}
        submitBuffExpiryIssueReport={vi.fn().mockResolvedValue(true)}
        submitBoosterExpiryIssueReport={vi.fn().mockResolvedValue(true)}
        submitSpecialCoreIssueReport={vi.fn().mockResolvedValue(true)}
        freezeRuneIssueReportEvidence={freezeRuneIssueReportEvidence}
        clearRuneIssueReportEvidence={clearRuneIssueReportEvidence}
        setMessage={vi.fn()}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getApi().openRuneIssueReport();
    });
    await waitFor(() => expect(getApi().issueReportTarget).toEqual({ kind: "rune" }));

    expect(clearRuneIssueReportEvidence).toHaveBeenCalledTimes(1);
    expect(freezeRuneIssueReportEvidence).toHaveBeenCalledTimes(1);
    expect(freezeRuneIssueReportEvidence).toHaveBeenCalledWith(expect.any(Number));

    await act(async () => {
      await getApi().submitIssueReport(ISSUE);
    });

    expect(submitRuneIssueReport).toHaveBeenCalledWith(ISSUE);
    expect(clearRuneIssueReportEvidence).toHaveBeenCalledTimes(1);

    act(() => {
      getApi().closeIssueReport();
    });
    expect(clearRuneIssueReportEvidence).toHaveBeenCalledTimes(2);
  });

  it("routes hunt stall report failures to failed analytics", async () => {
    const submitHuntStallIssueReport = vi.fn().mockResolvedValue(false);
    const freezeHuntStallIssueReportEvidence = vi.fn();
    const clearHuntStallIssueReportEvidence = vi.fn();
    const journal = createAlertIncidentJournal();
    const playbackAt = Date.now() - 500;
    journal.record({
      id: "skill-playback",
      feature: "skill",
      targetId: "skill-1",
      kind: "playback",
      occurredAt: playbackAt,
      frameId: null,
      cycleId: "skill-cycle",
      status: "started",
      decision: "initial",
      value: null,
      details: { requestedAt: playbackAt, startedAt: playbackAt + 20 },
    });
    const defaults = createDefaultProfile();
    const profile = {
      ...defaults,
      huntStallAlert: { ...defaults.huntStallAlert!, enabled: true },
    };
    const apiRef: { current: HookApi | null } = { current: null };
    const getApi = () => {
      if (!apiRef.current) {
        throw new Error("hook api is not ready");
      }
      return apiRef.current;
    };

    render(
      <Harness
        profile={profile}
        submitRuneIssueReport={vi.fn().mockResolvedValue(true)}
        submitSkillIssueReport={vi.fn().mockResolvedValue(true)}
        submitHuntStallIssueReport={submitHuntStallIssueReport}
        submitBuffExpiryIssueReport={vi.fn().mockResolvedValue(true)}
        submitBoosterExpiryIssueReport={vi.fn().mockResolvedValue(true)}
        submitSpecialCoreIssueReport={vi.fn().mockResolvedValue(true)}
        freezeHuntStallIssueReportEvidence={freezeHuntStallIssueReportEvidence}
        clearHuntStallIssueReportEvidence={clearHuntStallIssueReportEvidence}
        alertIncidentJournal={journal}
        setMessage={vi.fn()}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getApi().openHuntStallIssueReport();
    });

    await waitFor(() => expect(getApi().issueReportTarget).toEqual({ kind: "hunt-stall" }));
    const frozenJournal = freezeHuntStallIssueReportEvidence.mock.calls[0]?.[1];
    expect(freezeHuntStallIssueReportEvidence).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        target: { feature: "hunt-stall", targetId: null },
        relatedPlaybackEntries: [
          expect.objectContaining({ id: "skill-playback" }),
        ],
      }),
    );
    expect(clearHuntStallIssueReportEvidence).toHaveBeenCalledTimes(1);

    let didSubmit = true;
    await act(async () => {
      didSubmit = await getApi().submitIssueReport(ISSUE);
    });

    expect(didSubmit).toBe(false);
    expect(submitHuntStallIssueReport).toHaveBeenCalledWith(
      ISSUE,
      frozenJournal,
    );
    expect(trackReportOpenMock).toHaveBeenCalledWith("hunt_stall");
    expect(trackReportSubmitStartMock).toHaveBeenCalledWith("hunt_stall");
    expect(trackReportSubmitFailedMock).toHaveBeenCalledWith("hunt_stall");
  });

  it("opens and submits buff expiry reports through the buff expiry submitter", async () => {
    const submitBuffExpiryIssueReport = vi.fn().mockResolvedValue(true);
    const freezeBuffExpiryIssueReportEvidence = vi.fn();
    const clearBuffExpiryIssueReportEvidence = vi.fn();
    const defaults = createDefaultProfile();
    const profile = {
      ...defaults,
      buffExpiryAlert: { ...defaults.buffExpiryAlert!, enabled: true },
    };
    const apiRef: { current: HookApi | null } = { current: null };
    const getApi = () => {
      if (!apiRef.current) {
        throw new Error("hook api is not ready");
      }
      return apiRef.current;
    };

    render(
      <Harness
        profile={profile}
        submitRuneIssueReport={vi.fn().mockResolvedValue(true)}
        submitSkillIssueReport={vi.fn().mockResolvedValue(true)}
        submitHuntStallIssueReport={vi.fn().mockResolvedValue(true)}
        submitBuffExpiryIssueReport={submitBuffExpiryIssueReport}
        submitBoosterExpiryIssueReport={vi.fn().mockResolvedValue(true)}
        submitSpecialCoreIssueReport={vi.fn().mockResolvedValue(true)}
        freezeBuffExpiryIssueReportEvidence={freezeBuffExpiryIssueReportEvidence}
        clearBuffExpiryIssueReportEvidence={clearBuffExpiryIssueReportEvidence}
        setMessage={vi.fn()}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getApi().openBuffExpiryIssueReport();
    });

    await waitFor(() => expect(getApi().issueReportTarget).toEqual({ kind: "buff-expiry" }));
    expect(freezeBuffExpiryIssueReportEvidence).toHaveBeenCalledTimes(1);
    expect(freezeBuffExpiryIssueReportEvidence).toHaveBeenCalledWith(expect.any(Number));
    expect(clearBuffExpiryIssueReportEvidence).toHaveBeenCalledTimes(1);

    let didSubmit = false;
    await act(async () => {
      didSubmit = await getApi().submitIssueReport(ISSUE);
    });

    expect(didSubmit).toBe(true);
    expect(submitBuffExpiryIssueReport).toHaveBeenCalledWith(ISSUE);
    expect(trackReportOpenMock).toHaveBeenCalledWith("buff_expiry");
    expect(trackReportSubmitStartMock).toHaveBeenCalledWith("buff_expiry");
    expect(trackReportSubmitSuccessMock).toHaveBeenCalledWith("buff_expiry");
    expect(clearBuffExpiryIssueReportEvidence).toHaveBeenCalledTimes(2);
  });

  it("keeps frozen buff expiry evidence when submission fails", async () => {
    const defaults = createDefaultProfile();
    const profile = {
      ...defaults,
      buffExpiryAlert: { ...defaults.buffExpiryAlert!, enabled: true },
    };
    const submitBuffExpiryIssueReport = vi.fn().mockResolvedValue(false);
    const freezeBuffExpiryIssueReportEvidence = vi.fn();
    const clearBuffExpiryIssueReportEvidence = vi.fn();
    const apiRef: { current: HookApi | null } = { current: null };
    const getApi = () => {
      if (!apiRef.current) throw new Error("hook api is not ready");
      return apiRef.current;
    };

    render(
      <Harness
        profile={profile}
        submitRuneIssueReport={vi.fn().mockResolvedValue(true)}
        submitSkillIssueReport={vi.fn().mockResolvedValue(true)}
        submitHuntStallIssueReport={vi.fn().mockResolvedValue(true)}
        submitBuffExpiryIssueReport={submitBuffExpiryIssueReport}
        submitBoosterExpiryIssueReport={vi.fn().mockResolvedValue(true)}
        submitSpecialCoreIssueReport={vi.fn().mockResolvedValue(true)}
        freezeBuffExpiryIssueReportEvidence={freezeBuffExpiryIssueReportEvidence}
        clearBuffExpiryIssueReportEvidence={clearBuffExpiryIssueReportEvidence}
        setMessage={vi.fn()}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getApi().openBuffExpiryIssueReport();
    });
    await waitFor(() => expect(getApi().issueReportTarget?.kind).toBe("buff-expiry"));

    await act(async () => {
      await getApi().submitIssueReport(ISSUE);
    });

    expect(freezeBuffExpiryIssueReportEvidence).toHaveBeenCalledTimes(1);
    expect(clearBuffExpiryIssueReportEvidence).toHaveBeenCalledTimes(1);
  });

  it("opens and submits special core reports through the special core submitter", async () => {
    const submitSpecialCoreIssueReport = vi.fn().mockResolvedValue(true);
    const freezeSpecialCoreIssueReportEvidence = vi.fn();
    const clearSpecialCoreIssueReportEvidence = vi.fn();
    const journal = createAlertIncidentJournal();
    const playbackAt = Date.now() - 500;
    journal.record({
      id: "rune-playback-for-special-core",
      feature: "rune",
      targetId: null,
      kind: "playback",
      occurredAt: playbackAt,
      frameId: null,
      cycleId: "rune-cycle",
      status: "started",
      decision: "initial",
      value: null,
      details: { requestedAt: playbackAt, startedAt: playbackAt + 20 },
    });
    const defaults = createDefaultProfile();
    const profile = {
      ...defaults,
      specialCoreAlert: { ...defaults.specialCoreAlert!, enabled: true },
    };
    const apiRef: { current: HookApi | null } = { current: null };
    const getApi = () => {
      if (!apiRef.current) {
        throw new Error("hook api is not ready");
      }
      return apiRef.current;
    };

    render(
      <Harness
        profile={profile}
        submitRuneIssueReport={vi.fn().mockResolvedValue(true)}
        submitSkillIssueReport={vi.fn().mockResolvedValue(true)}
        submitHuntStallIssueReport={vi.fn().mockResolvedValue(true)}
        submitBuffExpiryIssueReport={vi.fn().mockResolvedValue(true)}
        submitBoosterExpiryIssueReport={vi.fn().mockResolvedValue(true)}
        submitSpecialCoreIssueReport={submitSpecialCoreIssueReport}
        freezeSpecialCoreIssueReportEvidence={
          freezeSpecialCoreIssueReportEvidence
        }
        clearSpecialCoreIssueReportEvidence={
          clearSpecialCoreIssueReportEvidence
        }
        alertIncidentJournal={journal}
        setMessage={vi.fn()}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getApi().openSpecialCoreIssueReport();
    });

    await waitFor(() => expect(getApi().issueReportTarget).toEqual({ kind: "special-core" }));

    const frozenJournal = freezeSpecialCoreIssueReportEvidence.mock.calls[0]?.[1];
    expect(freezeSpecialCoreIssueReportEvidence).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        target: { feature: "special-core", targetId: null },
        relatedPlaybackEntries: [
          expect.objectContaining({ id: "rune-playback-for-special-core" }),
        ],
      }),
    );
    expect(clearSpecialCoreIssueReportEvidence).toHaveBeenCalledTimes(1);

    let didSubmit = false;
    await act(async () => {
      didSubmit = await getApi().submitIssueReport(ISSUE);
    });

    expect(didSubmit).toBe(true);
    expect(submitSpecialCoreIssueReport).toHaveBeenCalledWith(
      ISSUE,
      frozenJournal,
    );
    expect(clearSpecialCoreIssueReportEvidence).toHaveBeenCalledTimes(2);
    expect(trackReportOpenMock).toHaveBeenCalledWith("special_core");
    expect(trackReportSubmitStartMock).toHaveBeenCalledWith("special_core");
    expect(trackReportSubmitSuccessMock).toHaveBeenCalledWith("special_core");
  });

  it("does not open a report while its alert is disabled", () => {
    const defaults = createDefaultProfile();
    const profile = {
      ...defaults,
      runeAlert: { ...defaults.runeAlert!, enabled: false },
    };
    const setMessage = vi.fn();
    const freezeRuneIssueReportEvidence = vi.fn();
    const clearRuneIssueReportEvidence = vi.fn();
    const apiRef: { current: HookApi | null } = { current: null };
    const getApi = () => {
      if (!apiRef.current) {
        throw new Error("hook api is not ready");
      }
      return apiRef.current;
    };

    render(
      <Harness
        profile={profile}
        submitRuneIssueReport={vi.fn().mockResolvedValue(true)}
        submitSkillIssueReport={vi.fn().mockResolvedValue(true)}
        submitHuntStallIssueReport={vi.fn().mockResolvedValue(true)}
        submitBuffExpiryIssueReport={vi.fn().mockResolvedValue(true)}
        submitBoosterExpiryIssueReport={vi.fn().mockResolvedValue(true)}
        submitSpecialCoreIssueReport={vi.fn().mockResolvedValue(true)}
        freezeRuneIssueReportEvidence={freezeRuneIssueReportEvidence}
        clearRuneIssueReportEvidence={clearRuneIssueReportEvidence}
        setMessage={setMessage}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getApi().openRuneIssueReport();
    });

    expect(getApi().issueReportTarget).toBeNull();
    expect(setMessage).toHaveBeenCalledWith("룬 알림을 켠 뒤 제보할 수 있습니다.");
    expect(trackReportOpenMock).not.toHaveBeenCalled();
    expect(freezeRuneIssueReportEvidence).not.toHaveBeenCalled();
    expect(clearRuneIssueReportEvidence).not.toHaveBeenCalled();
  });

  it("keeps frozen booster expiry evidence when submission fails", async () => {
    const defaults = createDefaultProfile();
    const profile = {
      ...defaults,
      boosterExpiryAlert: { ...defaults.boosterExpiryAlert!, enabled: true },
    };
    const journal = createAlertIncidentJournal();
    journal.record({
      id: "booster-playback",
      feature: "booster-expiry",
      targetId: null,
      kind: "playback",
      occurredAt: 10_000,
      frameId: null,
      cycleId: "booster-cycle",
      status: "finished",
      decision: "played",
      value: null,
      details: { requestedAt: 9_900, finishedAt: 10_000 },
    });
    const submitBoosterExpiryIssueReport = vi.fn().mockResolvedValue(false);
    const freezeBoosterExpiryIssueReportEvidence = vi.fn();
    const clearBoosterExpiryIssueReportEvidence = vi.fn();
    const apiRef: { current: HookApi | null } = { current: null };
    const getApi = () => {
      if (!apiRef.current) throw new Error("hook api is not ready");
      return apiRef.current;
    };

    render(
      <Harness
        profile={profile}
        submitRuneIssueReport={vi.fn().mockResolvedValue(true)}
        submitSkillIssueReport={vi.fn().mockResolvedValue(true)}
        submitHuntStallIssueReport={vi.fn().mockResolvedValue(true)}
        submitBuffExpiryIssueReport={vi.fn().mockResolvedValue(true)}
        submitBoosterExpiryIssueReport={submitBoosterExpiryIssueReport}
        submitSpecialCoreIssueReport={vi.fn().mockResolvedValue(true)}
        freezeBoosterExpiryIssueReportEvidence={
          freezeBoosterExpiryIssueReportEvidence
        }
        clearBoosterExpiryIssueReportEvidence={
          clearBoosterExpiryIssueReportEvidence
        }
        alertIncidentJournal={journal}
        setMessage={vi.fn()}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getApi().openBoosterExpiryIssueReport();
    });
    await waitFor(() => {
      expect(getApi().issueReportTarget).toEqual({ kind: "booster-expiry" });
    });

    const frozenJournalSelection =
      freezeBoosterExpiryIssueReportEvidence.mock.calls[0]?.[1];
    expect(frozenJournalSelection).toBeTruthy();
    expect(clearBoosterExpiryIssueReportEvidence).toHaveBeenCalledTimes(1);

    let didSubmit = true;
    await act(async () => {
      didSubmit = await getApi().submitIssueReport(ISSUE);
    });

    expect(didSubmit).toBe(false);
    expect(submitBoosterExpiryIssueReport).toHaveBeenCalledWith(
      ISSUE,
      frozenJournalSelection,
    );
    expect(clearBoosterExpiryIssueReportEvidence).toHaveBeenCalledTimes(1);

    act(() => {
      getApi().closeIssueReport();
    });
    expect(clearBoosterExpiryIssueReportEvidence).toHaveBeenCalledTimes(2);
  });

  it("rechecks availability when an open report becomes globally disabled", async () => {
    const defaults = createDefaultProfile();
    const profile = {
      ...defaults,
      boosterExpiryAlert: { ...defaults.boosterExpiryAlert!, enabled: true },
    };
    const submitBoosterExpiryIssueReport = vi.fn().mockResolvedValue(true);
    const setMessage = vi.fn();
    const apiRef: { current: HookApi | null } = { current: null };
    const getApi = () => {
      if (!apiRef.current) {
        throw new Error("hook api is not ready");
      }
      return apiRef.current;
    };
    const commonProps = {
      profile,
      submitRuneIssueReport: vi.fn().mockResolvedValue(true),
      submitSkillIssueReport: vi.fn().mockResolvedValue(true),
      submitHuntStallIssueReport: vi.fn().mockResolvedValue(true),
      submitBuffExpiryIssueReport: vi.fn().mockResolvedValue(true),
      submitBoosterExpiryIssueReport,
      submitSpecialCoreIssueReport: vi.fn().mockResolvedValue(true),
      setMessage,
      onReady: (next: HookApi) => {
        apiRef.current = next;
      },
    };
    const { rerender } = render(<Harness {...commonProps} />);

    act(() => {
      getApi().openBoosterExpiryIssueReport();
    });
    await waitFor(() => {
      expect(getApi().issueReportTarget).toEqual({ kind: "booster-expiry" });
    });
    expect(trackReportOpenMock).toHaveBeenCalledWith("booster_expiry");

    rerender(<Harness {...commonProps} isGloballyDisabled />);

    let didSubmit = true;
    await act(async () => {
      didSubmit = await getApi().submitIssueReport(ISSUE);
    });

    expect(didSubmit).toBe(false);
    expect(getApi().issueReportTarget).toBeNull();
    expect(setMessage).toHaveBeenCalledWith("전체 알림을 다시 켠 뒤 제보할 수 있습니다.");
    expect(submitBoosterExpiryIssueReport).not.toHaveBeenCalled();
    expect(trackReportSubmitStartMock).not.toHaveBeenCalled();
  });

  it("does not open a skill report for missing skill ids", () => {
    const setMessage = vi.fn();
    const apiRef: { current: HookApi | null } = { current: null };
    const getApi = () => {
      if (!apiRef.current) {
        throw new Error("hook api is not ready");
      }
      return apiRef.current;
    };

    render(
      <Harness
        profile={createDefaultProfile()}
        submitRuneIssueReport={vi.fn().mockResolvedValue(true)}
        submitSkillIssueReport={vi.fn().mockResolvedValue(true)}
        submitHuntStallIssueReport={vi.fn().mockResolvedValue(true)}
        submitBuffExpiryIssueReport={vi.fn().mockResolvedValue(true)}
        submitBoosterExpiryIssueReport={vi.fn().mockResolvedValue(true)}
        submitSpecialCoreIssueReport={vi.fn().mockResolvedValue(true)}
        setMessage={setMessage}
        onReady={(next) => {
          apiRef.current = next;
        }}
      />,
    );

    act(() => {
      getApi().openSkillIssueReport("missing");
    });

    expect(getApi().issueReportTarget).toBeNull();
    expect(setMessage).toHaveBeenCalledWith("제보할 스킬을 찾지 못했습니다.");
    expect(trackReportOpenMock).not.toHaveBeenCalled();
  });
});
