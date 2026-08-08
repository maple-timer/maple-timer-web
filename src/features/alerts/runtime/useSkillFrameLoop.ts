import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type {
  RgbaImageSnapshot,
  SkillAlertPlaybackEvent,
  SkillReportTimeline,
  SkillRuntimeEvidenceFrame,
  SkillRuntimeEvidenceState,
  SkillSnapshot,
  SkillTraceSample,
} from "../../../alertTypes";
import { playAlertUntilEnded } from "../../../lib/alert";
import {
  trackAlertPlayed,
  trackFeatureSessionActive,
} from "../../../lib/analyticsEvents";
import {
  createBuffSlotEvidenceSource,
  type BuffSlotVideoFrameSample,
} from "../../../lib/buffSlotParser/buffSlotFrameCapture";
import { imageDataToUrl } from "../../../lib/canvasImage";
import { createPlaceholderImageData } from "../../../lib/imageData";
import {
  getRecognitionEngine,
  type RecognitionEngine,
} from "../../../lib/recognition";
import {
  createSkillBuffDurationEngine,
  type SkillBuffDurationEngine,
} from "../../../platform/runtime-workers/skill-precision/skillPrecisionWorkerClient";
import type {
  SkillBuffDurationIcon,
  SkillBuffDurationSampleResponse,
} from "../../../runtime/skill-precision/analysis/skillPrecisionAnalysisRuntime";
import {
  getSkillBuffDurationTargetForSkill,
  type SkillBuffDurationTarget,
} from "../../../lib/skillBuffDuration/skillBuffDurationTargets";
import { createRuntimeState, markAlertPlaybackFinished } from "../../../lib/timer";
import { applyMasterVolume } from "../../../lib/volume";
import type { Profile, SkillConfig, SkillRuntimeState } from "../../../types";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import type { RemoteRecognitionWarmTraceFeaturePort } from "../../../contracts/remote-recognition/remoteRecognitionWarmTrace";
import {
  processSkillFrameSample,
  type SkillBuffDurationFrameResult,
} from "./skillFrameProcessor";
import {
  createSkillBuffDurationStickyState,
  updateSkillBuffDurationStickyFrameResult,
} from "./skillBuffDurationStickyDetection";
import {
  getSharedBuffSlotAnalysisFailureEvidence,
  getSharedBuffSlotAnalysisFailureFrame,
  isSharedBuffSlotAnalysisDroppedError,
  type GetSharedBuffSlotAnalysis,
  type SharedBuffSlotAnalysisResult,
  type SharedBuffSlotFrameSample,
} from "./useSharedBuffSlotAnalysis";
import {
  claimSkillWarmTrace,
  completeSkillWarmTraceMatcher,
  completeSkillWarmTracePlayback,
  completeSkillWarmTraceSchedule,
  completeSkillWarmTraceTemporal,
  isSkillWarmTraceLifecycleCurrent,
  terminateSkillWarmTraceCurrentStage,
  terminateSkillWarmTraceStage,
  type SkillWarmTraceClaim,
} from "./skillWarmTrace";
import type { RuntimeReportEvidenceCoordinator } from "../../../contracts/reporting/runtimeReportEvidence";
import { RUNTIME_EVIDENCE_ROLLING_MEDIA_BUDGET_CHARS } from "../../../contracts/reporting/runtimeEvidenceMediaPolicy";
import type { SkillBuffDurationRuntimeReportPayload } from "../../../contracts/reporting/runtimeReportEvidencePayloads";
import {
  createAlertIncidentFrameId,
  type AlertIncidentJournal,
} from "../../../application/reporting/alertIncidentJournal";
import { createSkillIncidentRuntimeSampleInput } from "./skillIncidentEvidenceAdapter";
import {
  recordSkillIncidentPlaybackFailed,
  recordSkillIncidentPlaybackFinished,
  recordSkillIncidentPlaybackRequested,
  recordSkillIncidentPlaybackStarted,
  recordSkillIncidentSample,
  recordSkillIncidentTargetArbitration,
  resetSkillIncidentRuntimeRecorder,
  syncSkillIncidentRuntimeSkills,
  type SkillIncidentRuntimeRecorder,
} from "../../../runtime/skill-alert/evidence/skillIncidentRuntimeRecorder";

const SKILL_TRACE_WINDOW_MS = 60_000;
const SKILL_TRACE_MAX_SAMPLES = 72;
const SKILL_ALERT_EVENT_WINDOW_MS = 60_000;
const SKILL_RUNTIME_EVIDENCE_FRAME_INTERVAL_MS = 15_000;
const SKILL_RUNTIME_EVIDENCE_FRAME_LIMIT = 8;
const SKILL_RUNTIME_EVIDENCE_DATA_URL_MAX_CHARS =
  RUNTIME_EVIDENCE_ROLLING_MEDIA_BUDGET_CHARS.skillQuickSlot;

function getSkillTimeline(
  timelines: Record<string, SkillReportTimeline>,
  skillId: string,
): SkillReportTimeline {
  const timeline = timelines[skillId] ?? { samples: [], alertEvents: [], frames: [] };
  timelines[skillId] = timeline;
  return timeline;
}

function trimSkillTimeline(timeline: SkillReportTimeline, now: number) {
  timeline.samples = timeline.samples
    .filter((sample) => now - sample.sampledAt <= SKILL_TRACE_WINDOW_MS)
    .slice(-SKILL_TRACE_MAX_SAMPLES);
  timeline.alertEvents = timeline.alertEvents.filter(
    (event) => now - event.startedAt <= SKILL_ALERT_EVENT_WINDOW_MS,
  );
  timeline.frames = trimSkillRuntimeEvidenceFrames(timeline.frames ?? [], now);
}

function pushSkillTraceSample(
  timelines: Record<string, SkillReportTimeline>,
  skillId: string,
  sample: SkillTraceSample,
) {
  const timeline = getSkillTimeline(timelines, skillId);
  timeline.samples.push(sample);
  trimSkillTimeline(timeline, sample.sampledAt);
}

function pushSkillAlertEvent(
  timelines: Record<string, SkillReportTimeline>,
  skillId: string,
  event: SkillAlertPlaybackEvent,
) {
  const timeline = getSkillTimeline(timelines, skillId);
  timeline.alertEvents.push(event);
  trimSkillTimeline(timeline, event.startedAt);
}

function pushSkillRuntimeEvidenceFrame(
  timelines: Record<string, SkillReportTimeline>,
  skillId: string,
  frame: SkillRuntimeEvidenceFrame,
) {
  const timeline = getSkillTimeline(timelines, skillId);
  timeline.frames = trimSkillRuntimeEvidenceFrames(
    [...(timeline.frames ?? []), frame],
    frame.sampledAt,
  );
  trimSkillTimeline(timeline, frame.sampledAt);
}

function trimSkillRuntimeEvidenceFrames(
  frames: SkillRuntimeEvidenceFrame[],
  now: number,
) {
  const recent = frames
    .filter((frame) => now - frame.sampledAt <= SKILL_TRACE_WINDOW_MS)
    .slice(-SKILL_RUNTIME_EVIDENCE_FRAME_LIMIT);
  while (
    getSkillRuntimeEvidenceDataUrlLength(recent) >
      SKILL_RUNTIME_EVIDENCE_DATA_URL_MAX_CHARS &&
    recent.length > 1
  ) {
    const periodicIndex = recent.findIndex(
      (frame) => frame.reasons.length === 1 && frame.reasons[0] === "interval",
    );
    recent.splice(periodicIndex >= 0 ? periodicIndex : 0, 1);
  }
  return recent;
}

function getSkillRuntimeEvidenceDataUrlLength(
  frames: SkillRuntimeEvidenceFrame[],
) {
  return frames.reduce(
    (total, frame) =>
      total +
      (frame.rawDataUrl?.length ?? 0) +
      (frame.processedDataUrl?.length ?? 0),
    0,
  );
}

function updateLatestSkillAlertEvent(
  timelines: Record<string, SkillReportTimeline>,
  skillId: string,
  alertCycleStartedAt: number,
  patch: Partial<SkillAlertPlaybackEvent>,
) {
  const timeline = timelines[skillId];
  if (!timeline) {
    return;
  }

  const index = [...timeline.alertEvents]
    .reverse()
    .findIndex((event) => event.alertCycleStartedAt === alertCycleStartedAt);
  if (index < 0) {
    return;
  }

  const actualIndex = timeline.alertEvents.length - 1 - index;
  timeline.alertEvents[actualIndex] = {
    ...timeline.alertEvents[actualIndex],
    ...patch,
  };
}

function createSkillAlertPlaybackKey({
  alertCycleStartedAt,
  decision,
  repeatedAlertCount,
  skillId,
}: {
  alertCycleStartedAt: number;
  decision: "initial" | "repeat";
  repeatedAlertCount: number;
  skillId: string;
}): string {
  return `${skillId}:${alertCycleStartedAt}:${decision}:${repeatedAlertCount}`;
}

function getSkillAlertAnalyticsContext(skill: SkillConfig) {
  return {
    alertDetail: skill.presetId ?? "class-install",
    countdownSource: skill.countdownSource,
    detectionMode: skill.detectionSource === "buff-duration" ? "buff_duration" : "quickslot",
  } as const;
}

function getSkillFeatureSessionMode(skill: SkillConfig) {
  return skill.detectionSource === "buff-duration" ? "buff_duration" : "quickslot";
}

function getSkillFeatureSessionItem(skill: SkillConfig) {
  return skill.presetId ?? "class-install";
}

function getSkillIncidentMonotonicNow(): number | null {
  return typeof performance === "undefined" ? null : performance.now();
}

export function useSkillFrameLoop({
  stream,
  gameViewportRevision,
  profileRef,
  runtimeRef,
  skillIncidentRecorderRef,
  skillReportTimelineRef,
  lastAlertErrorRef,
  setRuntimeStates,
  setSnapshots,
  getSharedBuffSlotAnalysis,
  precisionParserRuntimeKey,
  runtimeReportEvidenceCoordinator,
  alertIncidentJournal,
  remoteRecognitionWarmTracePort,
  onMessage,
}: {
  stream: MediaStream | null;
  gameViewportRevision: number;
  profileRef: MutableRefObject<Profile>;
  runtimeRef: MutableRefObject<Record<string, SkillRuntimeState>>;
  skillIncidentRecorderRef: MutableRefObject<SkillIncidentRuntimeRecorder>;
  skillReportTimelineRef: MutableRefObject<Record<string, SkillReportTimeline>>;
  lastAlertErrorRef: MutableRefObject<string | null>;
  setRuntimeStates: Dispatch<SetStateAction<Record<string, SkillRuntimeState>>>;
  setSnapshots: Dispatch<SetStateAction<Record<string, SkillSnapshot>>>;
  getSharedBuffSlotAnalysis?: GetSharedBuffSlotAnalysis;
  precisionParserRuntimeKey?: string;
  runtimeReportEvidenceCoordinator?: RuntimeReportEvidenceCoordinator;
  alertIncidentJournal?: AlertIncidentJournal;
  remoteRecognitionWarmTracePort?: RemoteRecognitionWarmTraceFeaturePort;
  onMessage: (message: string) => void;
}) {
  const skillBuffDurationEngineRef = useRef<SkillBuffDurationEngine | null>(null);
  const skillBuffDurationStickyRef = useRef<Record<string, ReturnType<typeof createSkillBuffDurationStickyState>>>({});
  const activeSkillAlertPlaybackKeysRef = useRef<Set<string>>(new Set());
  const currentPrecisionParserRuntimeKeyRef = useRef(precisionParserRuntimeKey);
  const appliedPrecisionParserRuntimeKeyRef = useRef(precisionParserRuntimeKey);
  const currentGameViewportRevisionRef = useRef(gameViewportRevision);
  const appliedGameViewportRevisionRef = useRef(gameViewportRevision);
  currentPrecisionParserRuntimeKeyRef.current = precisionParserRuntimeKey;
  currentGameViewportRevisionRef.current = gameViewportRevision;

  const resetSkillBuffDurationEngine = useCallback(() => {
    skillBuffDurationEngineRef.current?.reset();
    skillBuffDurationEngineRef.current = null;
    skillBuffDurationStickyRef.current = {};
  }, []);

  useEffect(() => {
    skillIncidentRecorderRef.current = resetSkillIncidentRuntimeRecorder({
      previous: skillIncidentRecorderRef.current,
      reason: stream ? "screen-share-started-or-replaced" : "screen-share-stopped",
      captureChanged: true,
    });
    if (!stream) {
      resetSkillBuffDurationEngine();
      skillReportTimelineRef.current = {};
      setSnapshots({});
    }
  }, [
    resetSkillBuffDurationEngine,
    setSnapshots,
    skillIncidentRecorderRef,
    skillReportTimelineRef,
    stream,
  ]);

  useEffect(() => {
    if (appliedPrecisionParserRuntimeKeyRef.current === precisionParserRuntimeKey) {
      return;
    }
    appliedPrecisionParserRuntimeKeyRef.current = precisionParserRuntimeKey;
    resetSkillBuffDurationEngine();
    activeSkillAlertPlaybackKeysRef.current.clear();

    const precisionSkillIds = new Set(
      profileRef.current.skills
        .filter((skill) => getSkillBuffDurationTargetForSkill(skill) !== null)
        .map((skill) => skill.id),
    );
    skillIncidentRecorderRef.current = syncSkillIncidentRuntimeSkills({
      previous: skillIncidentRecorderRef.current,
      activeSkillIds: profileRef.current.skills
        .filter(
          (skill) =>
            skill.enabled && !precisionSkillIds.has(skill.id),
        )
        .map((skill) => skill.id),
      now: Date.now(),
      reason: "precision-parser-runtime-changed",
    });
    if (precisionSkillIds.size <= 0) {
      return;
    }
    const nextRuntimeStates = { ...runtimeRef.current };
    for (const skillId of precisionSkillIds) {
      nextRuntimeStates[skillId] = createRuntimeState(skillId);
      delete skillReportTimelineRef.current[skillId];
    }
    runtimeRef.current = nextRuntimeStates;
    setRuntimeStates(nextRuntimeStates);
    setSnapshots((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([skillId]) => !precisionSkillIds.has(skillId),
        ),
      ),
    );
  }, [
    precisionParserRuntimeKey,
    profileRef,
    resetSkillBuffDurationEngine,
    runtimeRef,
    skillIncidentRecorderRef,
    setRuntimeStates,
    setSnapshots,
    skillReportTimelineRef,
  ]);

  useEffect(() => {
    if (appliedGameViewportRevisionRef.current === gameViewportRevision) {
      return;
    }
    appliedGameViewportRevisionRef.current = gameViewportRevision;
    resetSkillBuffDurationEngine();
    activeSkillAlertPlaybackKeysRef.current.clear();
    skillReportTimelineRef.current = {};
    skillIncidentRecorderRef.current = resetSkillIncidentRuntimeRecorder({
      previous: skillIncidentRecorderRef.current,
      reason: "game-viewport-changed",
    });
    const nextRuntimeStates = Object.fromEntries(
      profileRef.current.skills.map((skill) => [
        skill.id,
        createRuntimeState(skill.id),
      ]),
    );
    runtimeRef.current = nextRuntimeStates;
    setRuntimeStates(nextRuntimeStates);
    setSnapshots({});
  }, [
    gameViewportRevision,
    profileRef,
    resetSkillBuffDurationEngine,
    runtimeRef,
    setRuntimeStates,
    setSnapshots,
    skillIncidentRecorderRef,
    skillReportTimelineRef,
  ]);

  return useCallback(
    async ({
      context,
    }: {
      context: MonitoringFrameContext;
    }) => {
      const {
        gameFrameLayoutKey: frameLayoutKey,
        masterVolume,
        sampledAt,
      } = context;
      const precisionParserRuntimeKeyAtStart =
        currentPrecisionParserRuntimeKeyRef.current;
      const gameViewportRevisionAtStart =
        currentGameViewportRevisionRef.current;
      const currentProfile = profileRef.current;
      const sampledMonotonicAt = getSkillIncidentMonotonicNow();
      let quickRecognitionEngine: RecognitionEngine | null = null;
      skillIncidentRecorderRef.current = syncSkillIncidentRuntimeSkills({
        previous: skillIncidentRecorderRef.current,
        activeSkillIds: currentProfile.skills
          .filter((skill) => skill.enabled)
          .map((skill) => skill.id),
        now: sampledAt,
      });
      const nextStates: Record<string, SkillRuntimeState> = {};
      const nextSnapshots: Record<string, SkillSnapshot> = {};
      const buffDurationFrameBatch = await getSkillBuffDurationFrameResults({
        context,
        currentProfile,
        engineRef: skillBuffDurationEngineRef,
        getSharedBuffSlotAnalysis,
        getCurrentWarmTraceLifecycle: () => ({
          profile: profileRef.current,
          precisionParserRuntimeKey:
            currentPrecisionParserRuntimeKeyRef.current,
          gameViewportRevision: currentGameViewportRevisionRef.current,
        }),
        precisionParserRuntimeKey: precisionParserRuntimeKeyAtStart,
        gameViewportRevision: gameViewportRevisionAtStart,
        remoteRecognitionWarmTracePort,
        runtimeReportEvidenceCoordinator,
      });
      const rawBuffDurationFrameResults = buffDurationFrameBatch.results;
      let warmTraceClaim = buffDurationFrameBatch.warmTraceClaim;
      try {
      if (
        currentPrecisionParserRuntimeKeyRef.current !==
          precisionParserRuntimeKeyAtStart ||
        currentGameViewportRevisionRef.current !== gameViewportRevisionAtStart
      ) {
        terminateSkillWarmTraceStage(
          warmTraceClaim,
          "temporalDecisionUs",
          "replaced",
        );
        warmTraceClaim = null;
        return;
      }
      if (Object.keys(rawBuffDurationFrameResults).length <= 0) {
        skillBuffDurationStickyRef.current = {};
      }
      const buffDurationFrameResults = applySkillBuffDurationStickyFrameResults(
        skillBuffDurationStickyRef.current,
        rawBuffDurationFrameResults,
        sampledAt,
      );
      if (profileRef.current !== currentProfile) {
        terminateSkillWarmTraceStage(
          warmTraceClaim,
          "temporalDecisionUs",
          "replaced",
        );
        warmTraceClaim = null;
        return;
      }
      const warmTraceOwnerSkillId = warmTraceClaim?.ownerSkillId ?? null;
      const currentWarmTraceFrame = warmTraceClaim
        ? rawBuffDurationFrameResults[warmTraceClaim.spec.targetSkillId] ?? null
        : null;
      const currentStates = runtimeRef.current;
      const enabledSkillCount = currentProfile.skills.filter((skill) => skill.enabled).length;

      const sampledAlertBuffDurationTargets = new Map<
        string,
        {
          sourceFrameId: string | null;
          winnerSkillId: string;
          dueSkillIds: string[];
          decisionIds: string[];
        }
      >();
      for (const skill of currentProfile.skills) {
        if (skill.enabled) {
          trackFeatureSessionActive("skill", {
            mode: getSkillFeatureSessionMode(skill),
            item: getSkillFeatureSessionItem(skill),
            enabledCount: enabledSkillCount,
          });
        }

        const buffDurationTarget = getSkillBuffDurationTargetForSkill(skill);
        const rawBuffDurationFrameResult = buffDurationTarget
          ? rawBuffDurationFrameResults[buffDurationTarget.skillId] ?? null
          : null;
        if (skill.enabled && !buffDurationTarget && !quickRecognitionEngine) {
          quickRecognitionEngine = getRecognitionEngine();
        }
        const quickRecognitionEngineForSkill = quickRecognitionEngine;
        let skillWarmTraceClaim =
          warmTraceClaim && skill.id === warmTraceOwnerSkillId
            ? warmTraceClaim
            : null;
        const stateBefore =
          currentStates[skill.id] ?? createRuntimeState(skill.id);
        let processed: ReturnType<typeof processSkillFrameSample>;
        try {
          processed = processSkillFrameSample({
            buffDurationFrameResult: buffDurationTarget
              ? buffDurationFrameResults[buffDurationTarget.skillId] ?? null
              : null,
            frameLayoutKey,
            previousState: stateBefore,
            recognize: (imageData) =>
              (quickRecognitionEngineForSkill ?? getRecognitionEngine()).recognize(
                imageData,
              ),
            sampleSkill: context.sampleSkill,
            sampledAt,
            skill,
            initialAlertJitterEnabled:
              currentProfile.skillAlertInitialJitterEnabled === true,
          });
        } catch (error) {
          terminateSkillWarmTraceStage(
            skillWarmTraceClaim,
            "temporalDecisionUs",
            "failed",
          );
          throw error;
        }
        if (
          skillWarmTraceClaim &&
          !isSkillWarmTraceLifecycleCurrent(skillWarmTraceClaim, {
            profile: profileRef.current,
            precisionParserRuntimeKey:
              currentPrecisionParserRuntimeKeyRef.current,
            gameViewportRevision: currentGameViewportRevisionRef.current,
          })
        ) {
          terminateSkillWarmTraceStage(
            skillWarmTraceClaim,
            "temporalDecisionUs",
            "replaced",
          );
          skillWarmTraceClaim = null;
          warmTraceClaim = null;
        } else if (
          skillWarmTraceClaim &&
          !completeSkillWarmTraceTemporal({
            warmTrace: skillWarmTraceClaim,
            frame: currentWarmTraceFrame,
            stateBefore,
            processed,
            sampledAt,
            skill,
          })
        ) {
          skillWarmTraceClaim = null;
          warmTraceClaim = null;
        }
        const nextState = processed.state;
        const incidentSampleInput = createSkillIncidentRuntimeSampleInput({
          recorder: skillIncidentRecorderRef.current,
          profile: currentProfile,
          skill,
          masterVolume,
          frameLayoutKey,
          precisionParserRuntimeKey: precisionParserRuntimeKeyAtStart,
          quickRecognizerId: quickRecognitionEngineForSkill?.id ?? "not-loaded",
          sampledAt,
          monotonicAt: sampledMonotonicAt,
          stateBefore,
          processed,
          rawBuffDurationFrameResult,
        });
        const incidentSample = recordSkillIncidentSample({
          previous: skillIncidentRecorderRef.current,
          input: incidentSampleInput,
        });
        skillIncidentRecorderRef.current = incidentSample.recorder;

        const playSkillAlert = (
          alertCycleStartedAt: number,
          analyticsAction: "initial" | "repeat",
          repeatedAlertCount: number,
          incidentDecisionId: string | null,
          traceClaim: SkillWarmTraceClaim | null,
        ) => {
          let playbackWarmTraceClaim = traceClaim;
          const playbackKey = createSkillAlertPlaybackKey({
            alertCycleStartedAt,
            decision: analyticsAction,
            repeatedAlertCount,
            skillId: skill.id,
          });
          if (activeSkillAlertPlaybackKeysRef.current.has(playbackKey)) {
            terminateSkillWarmTraceStage(
              playbackWarmTraceClaim,
              "scheduleUs",
              "suppressed",
            );
            return;
          }
          activeSkillAlertPlaybackKeysRef.current.add(playbackKey);

          const playbackStartedAt = Date.now();
          const playbackRequestedMonotonicAt = getSkillIncidentMonotonicNow();
          const visibilityState =
            typeof document === "undefined" ? null : document.visibilityState;
          let incidentAttemptId: string | null = null;
          if (incidentDecisionId) {
            const incidentAttempt = recordSkillIncidentPlaybackRequested({
              previous: skillIncidentRecorderRef.current,
              decisionId: incidentDecisionId,
              requestedAt: playbackStartedAt,
              requestedMonotonicAt: playbackRequestedMonotonicAt,
              soundId: skill.soundId,
              featureVolume: skill.volume,
              masterVolume,
              effectiveVolume: applyMasterVolume(skill.volume, masterVolume),
              visibilityState,
            });
            skillIncidentRecorderRef.current = incidentAttempt.recorder;
            incidentAttemptId = incidentAttempt.attemptId;
          }
          const playbackConfiguration = getSkillIncidentConfiguration(
            skill,
            masterVolume,
          );

          pushSkillAlertEvent(skillReportTimelineRef.current, skill.id, {
            startedAt: playbackStartedAt,
            alertCycleStartedAt,
            soundId: skill.soundId,
            status: "started",
            finishedAt: null,
            failedAt: null,
            error: null,
          });
          alertIncidentJournal?.record({
            id: playbackKey,
            feature: "skill",
            targetId: skill.id,
            kind: "playback",
            occurredAt: playbackStartedAt,
            frameId: createAlertIncidentFrameId(sampledAt),
            cycleId: alertCycleStartedAt,
            status: "started",
            decision: analyticsAction,
            value: null,
            configuration: playbackConfiguration,
            details: {
              requestedAt: playbackStartedAt,
              startedAt: playbackStartedAt,
              soundId: skill.soundId,
              repeatedAlertCount,
              visibilityState,
            },
          });

          if (playbackWarmTraceClaim) {
            if (
              !isSkillWarmTraceLifecycleCurrent(playbackWarmTraceClaim, {
                profile: profileRef.current,
                precisionParserRuntimeKey:
                  currentPrecisionParserRuntimeKeyRef.current,
                gameViewportRevision:
                  currentGameViewportRevisionRef.current,
              })
            ) {
              terminateSkillWarmTraceStage(
                playbackWarmTraceClaim,
                "scheduleUs",
                "replaced",
              );
              playbackWarmTraceClaim = null;
            } else if (!completeSkillWarmTraceSchedule(playbackWarmTraceClaim)) {
              playbackWarmTraceClaim = null;
            }
          }
          let playbackAccepted = false;
          void playAlertUntilEnded(
            skill.soundId,
            applyMasterVolume(skill.volume, masterVolume),
            {
              onStarted: () => {
                if (
                  playbackWarmTraceClaim &&
                  isSkillWarmTraceLifecycleCurrent(playbackWarmTraceClaim, {
                    profile: profileRef.current,
                    precisionParserRuntimeKey:
                      currentPrecisionParserRuntimeKeyRef.current,
                    gameViewportRevision:
                      currentGameViewportRevisionRef.current,
                  })
                ) {
                  completeSkillWarmTracePlayback(playbackWarmTraceClaim);
                } else if (playbackWarmTraceClaim) {
                  terminateSkillWarmTraceStage(
                    playbackWarmTraceClaim,
                    "playbackAcceptanceUs",
                    "replaced",
                  );
                }
                playbackAccepted = true;
                if (!incidentAttemptId) {
                  return;
                }
                skillIncidentRecorderRef.current =
                  recordSkillIncidentPlaybackStarted({
                    previous: skillIncidentRecorderRef.current,
                    attemptId: incidentAttemptId,
                    startedAt: Date.now(),
                    startedMonotonicAt: getSkillIncidentMonotonicNow(),
                  });
              },
            },
          )
            .then(() => {
              if (!playbackAccepted) {
                terminateSkillWarmTraceStage(
                  playbackWarmTraceClaim,
                  "playbackAcceptanceUs",
                  "failed",
                );
              }
              const finishedAt = Date.now();
              if (incidentAttemptId) {
                skillIncidentRecorderRef.current =
                  recordSkillIncidentPlaybackFinished({
                    previous: skillIncidentRecorderRef.current,
                    attemptId: incidentAttemptId,
                    finishedAt,
                    finishedMonotonicAt: getSkillIncidentMonotonicNow(),
                  });
              }
              updateLatestSkillAlertEvent(
                skillReportTimelineRef.current,
                skill.id,
                alertCycleStartedAt,
                {
                  status: "finished",
                  finishedAt,
                  error: null,
                },
              );
              alertIncidentJournal?.record({
                id: playbackKey,
                feature: "skill",
                targetId: skill.id,
                kind: "playback",
                occurredAt: playbackStartedAt,
                frameId: createAlertIncidentFrameId(sampledAt),
                cycleId: alertCycleStartedAt,
                status: "finished",
                decision: analyticsAction,
                value: null,
                configuration: playbackConfiguration,
                details: {
                  requestedAt: playbackStartedAt,
                  startedAt: playbackStartedAt,
                  finishedAt,
                  soundId: skill.soundId,
                  repeatedAlertCount,
                  visibilityState,
                },
              });
              trackAlertPlayed(
                "skill",
                analyticsAction,
                getSkillAlertAnalyticsContext(skill),
              );
              setRuntimeStates((current) => {
                const currentSkillState = current[skill.id] ?? runtimeRef.current[skill.id];
                if (!currentSkillState) {
                  return current;
                }

                const nextSkillState = markAlertPlaybackFinished(
                  currentSkillState,
                  alertCycleStartedAt,
                  finishedAt,
                );
                if (nextSkillState === currentSkillState) {
                  return current;
                }

                runtimeRef.current = {
                  ...runtimeRef.current,
                  [skill.id]: nextSkillState,
                };
                return {
                  ...current,
                  [skill.id]: nextSkillState,
                };
              });
            })
            .catch((error) => {
              if (!playbackAccepted) {
                terminateSkillWarmTraceStage(
                  playbackWarmTraceClaim,
                  "playbackAcceptanceUs",
                  "failed",
                );
              }
              const failedAt = Date.now();
              const nextError =
                error instanceof Error ? error.message : "알람 재생에 실패했습니다.";
              if (incidentAttemptId) {
                skillIncidentRecorderRef.current =
                  recordSkillIncidentPlaybackFailed({
                    previous: skillIncidentRecorderRef.current,
                    attemptId: incidentAttemptId,
                    failedAt,
                    failedMonotonicAt: getSkillIncidentMonotonicNow(),
                    error: nextError,
                  });
              }
              updateLatestSkillAlertEvent(
                skillReportTimelineRef.current,
                skill.id,
                alertCycleStartedAt,
                {
                  status: "failed",
                  failedAt,
                  error: nextError,
                },
              );
              alertIncidentJournal?.record({
                id: playbackKey,
                feature: "skill",
                targetId: skill.id,
                kind: "playback",
                occurredAt: playbackStartedAt,
                frameId: createAlertIncidentFrameId(sampledAt),
                cycleId: alertCycleStartedAt,
                status: "failed",
                decision: analyticsAction,
                value: null,
                configuration: playbackConfiguration,
                details: {
                  requestedAt: playbackStartedAt,
                  startedAt: playbackStartedAt,
                  failedAt,
                  error: nextError,
                  soundId: skill.soundId,
                  repeatedAlertCount,
                  visibilityState,
                },
              });
              if (lastAlertErrorRef.current !== nextError) {
                lastAlertErrorRef.current = nextError;
                onMessage(nextError);
              }
            })
            .finally(() => {
              activeSkillAlertPlaybackKeysRef.current.delete(playbackKey);
            });
        };

        if (processed.alertDecision && processed.alertCycleStartedAt !== null) {
          const sampledTarget = buffDurationTarget
            ? sampledAlertBuffDurationTargets.get(buffDurationTarget.skillId) ?? null
            : null;
          const isDuplicateBuffDurationTargetAlert = sampledTarget !== null;
          if (!isDuplicateBuffDurationTargetAlert) {
            playSkillAlert(
              processed.alertCycleStartedAt,
              processed.alertDecision,
              nextState.repeatedAlertCount,
              incidentSample.decisionId,
              skillWarmTraceClaim,
            );
            if (skillWarmTraceClaim) {
              warmTraceClaim = null;
            }
          } else if (skillWarmTraceClaim) {
            terminateSkillWarmTraceStage(
              skillWarmTraceClaim,
              "scheduleUs",
              "suppressed",
            );
            warmTraceClaim = null;
          }
          if (buffDurationTarget !== null) {
            const dueSkillIds = [
              ...(sampledTarget?.dueSkillIds ?? []),
              skill.id,
            ];
            const decisionIds = [
              ...(sampledTarget?.decisionIds ?? []),
              ...(incidentSample.decisionId ? [incidentSample.decisionId] : []),
            ];
            const sourceFrameId =
              sampledTarget?.sourceFrameId ?? incidentSample.sourceFrameId;
            const winnerSkillId = sampledTarget?.winnerSkillId ?? skill.id;
            if (sampledTarget && sourceFrameId) {
              skillIncidentRecorderRef.current =
                recordSkillIncidentTargetArbitration({
                  previous: skillIncidentRecorderRef.current,
                  sourceFrameId,
                  targetId: incidentSampleInput.targetId,
                  occurredAt: sampledAt,
                  monotonicAt: sampledMonotonicAt,
                  dueSkillIds,
                  winnerSkillId,
                  decisionIds,
                });
            }
            sampledAlertBuffDurationTargets.set(buffDurationTarget.skillId, {
              sourceFrameId,
              winnerSkillId,
              dueSkillIds,
              decisionIds,
            });
          }
        } else if (skillWarmTraceClaim) {
          terminateSkillWarmTraceStage(
            skillWarmTraceClaim,
            "scheduleUs",
            "suppressed",
          );
          warmTraceClaim = null;
        }

        pushSkillTraceSample(skillReportTimelineRef.current, skill.id, processed.traceSample);
        if (!buffDurationTarget) {
          const timeline = getSkillTimeline(skillReportTimelineRef.current, skill.id);
          const lastFrame = timeline.frames?.[timeline.frames.length - 1] ?? null;
          const frameReasons = getSkillRuntimeEvidenceFrameReasons({
            lastFrame,
            stateBefore,
            stateAfter: nextState,
            trace: processed.traceSample,
          });
          if (frameReasons.length > 0) {
            pushSkillRuntimeEvidenceFrame(skillReportTimelineRef.current, skill.id, {
              sampledAt,
              reasons: frameReasons,
              rawDataUrl: processed.snapshot.rawPreviewUrl,
              processedDataUrl: processed.snapshot.previewUrl,
              recognition: {
                value: processed.snapshot.result.value,
                confidence: processed.snapshot.result.confidence,
                reason: processed.snapshot.result.debug?.reason ?? null,
              },
              decision: processed.traceSample.alertDecision,
              stateBefore: toSkillRuntimeEvidenceState(stateBefore),
              stateAfter: toSkillRuntimeEvidenceState(nextState),
            });
          }
        }
        alertIncidentJournal?.record({
          id: `skill:${skill.id}:sample:${sampledAt}`,
          feature: "skill",
          targetId: skill.id,
          kind: processed.alertDecision ? "decision" : "sample",
          occurredAt: sampledAt,
          frameId: createAlertIncidentFrameId(sampledAt),
          cycleId: processed.alertCycleStartedAt,
          status: nextState.status,
          decision: processed.alertDecision ?? processed.traceSample.reason,
          value:
            processed.traceSample.ocrValue ??
            processed.traceSample.observedRemainingCount ??
            null,
          configuration: getSkillIncidentConfiguration(skill, masterVolume),
          details: {
            confidence: processed.traceSample.confidence,
            shouldFireAlert: processed.traceSample.shouldFireAlert,
            shouldRepeatAlert: processed.traceSample.shouldRepeatAlert,
            estimatedRemainingSeconds: processed.traceSample.estimatedRemainingSeconds,
            alertInSeconds: processed.traceSample.alertInSeconds,
            remainingCountDecision: processed.traceSample.remainingCountDecision ?? null,
            parserFailureReason:
              rawBuffDurationFrameResult?.parserFailure?.reason ?? null,
            parserFailureStage:
              rawBuffDurationFrameResult?.parserFailure?.diagnostic?.stage ?? null,
            parserFailureCode:
              rawBuffDurationFrameResult?.parserFailure?.diagnostic?.code ?? null,
            parserTechnicalMessage:
              rawBuffDurationFrameResult?.parserFailure?.technicalMessage ?? null,
            runtimeFailureStage:
              processed.traceSample.runtimeFailure?.stage ?? null,
            runtimeFailureCode:
              processed.traceSample.runtimeFailure?.code ?? null,
            runtimeTechnicalMessage:
              processed.traceSample.runtimeFailure?.technicalMessage ?? null,
            stateBefore: toSkillRuntimeEvidenceState(stateBefore),
            stateAfter: toSkillRuntimeEvidenceState(nextState),
          },
        });

        if (buffDurationTarget && runtimeReportEvidenceCoordinator) {
          const evidenceTarget = {
            feature: "skill-buff-duration" as const,
            targetId: skill.id,
          };
          const rawFrameResult = rawBuffDurationFrameResult;
          const source = rawFrameResult?.evidenceSource ?? null;
          if (
            rawFrameResult &&
            source &&
            runtimeReportEvidenceCoordinator.hasPending(evidenceTarget)
          ) {
            const timeline = skillReportTimelineRef.current[skill.id] ?? {
              samples: [],
              alertEvents: [],
              frames: [],
            };
            runtimeReportEvidenceCoordinator.publish<SkillBuffDurationRuntimeReportPayload>({
              target: evidenceTarget,
              sampledAt,
              source,
              parser: {
                engine: rawFrameResult.snapshot.parserEngine ?? null,
                version: rawFrameResult.snapshot.parserVersion ?? null,
                fallbackReason: rawFrameResult.snapshot.parserFallbackReason ?? null,
                ...(rawFrameResult.parserFailure
                  ? { failure: rawFrameResult.parserFailure }
                  : {}),
                ...(rawFrameResult.parserRuntime
                  ? {
                      runtime: rawFrameResult.parserRuntime,
                      performance: rawFrameResult.parserPerformance ?? null,
                    }
                  : {}),
              },
              payload: {
                skillId: skill.id,
                snapshot: createSkillBuffDurationRuntimeReportSnapshot({
                  processedSnapshot: processed.snapshot,
                  rawFrameResult,
                }),
                stateBefore: currentStates[skill.id] ?? createRuntimeState(skill.id),
                stateAfter: nextState,
                traceSample: processed.traceSample,
                timeline: {
                  samples: [...timeline.samples],
                  alertEvents: [...timeline.alertEvents],
                  frames: [...(timeline.frames ?? [])],
                },
              },
            });
          }
        }

        nextStates[skill.id] = nextState;
        nextSnapshots[skill.id] = processed.snapshot;
      }

      const committedStates = mergeSkillFrameLoopRuntimeStates(
        runtimeRef.current,
        nextStates,
      );
      runtimeRef.current = committedStates;
      setRuntimeStates(committedStates);
      setSnapshots(nextSnapshots);
      } finally {
        terminateSkillWarmTraceCurrentStage(warmTraceClaim, "failed");
      }
    },
    [
      getSharedBuffSlotAnalysis,
      lastAlertErrorRef,
      onMessage,
      profileRef,
      remoteRecognitionWarmTracePort,
      runtimeRef,
      runtimeReportEvidenceCoordinator,
      setRuntimeStates,
      setSnapshots,
      skillIncidentRecorderRef,
      skillReportTimelineRef,
      alertIncidentJournal,
    ],
  );
}

function getSkillRuntimeEvidenceFrameReasons({
  lastFrame,
  stateBefore,
  stateAfter,
  trace,
}: {
  lastFrame: SkillRuntimeEvidenceFrame | null;
  stateBefore: SkillRuntimeState;
  stateAfter: SkillRuntimeState;
  trace: SkillTraceSample;
}) {
  const reasons: string[] = [];
  if (
    !lastFrame ||
    trace.sampledAt - lastFrame.sampledAt >=
      SKILL_RUNTIME_EVIDENCE_FRAME_INTERVAL_MS
  ) {
    reasons.push("interval");
  }
  if (trace.alertDecision) {
    reasons.push("alert-decision");
  }
  if (stateBefore.status !== stateAfter.status) {
    reasons.push("status-change");
  }
  if (lastFrame?.recognition.value !== trace.ocrValue) {
    reasons.push("value-change");
  }
  if (stateBefore.rejectedReading !== stateAfter.rejectedReading) {
    reasons.push("rejected-reading-change");
  }
  if (trace.runtimeFailure) {
    reasons.push("runtime-failure");
  }
  return reasons;
}

function toSkillRuntimeEvidenceState(
  state: SkillRuntimeState,
): SkillRuntimeEvidenceState {
  return {
    status: state.status,
    observedRemainingSeconds: state.observedRemainingSeconds,
    observedRemainingCount: state.observedRemainingCount ?? null,
    estimatedExpiresAt: state.estimatedExpiresAt,
    alertedAt: state.alertedAt,
    lastRepeatedAlertAt: state.lastRepeatedAlertAt,
    repeatedAlertCount: state.repeatedAlertCount,
    rejectedReading: state.rejectedReading,
  };
}

function getSkillIncidentConfiguration(skill: SkillConfig, masterVolume: number) {
  return {
    enabled: skill.enabled,
    presetId: skill.presetId ?? null,
    detectionSource: skill.detectionSource ?? null,
    countdownSource: skill.countdownSource,
    durationSeconds: skill.durationSeconds,
    cooldownDurationSeconds: skill.cooldownDurationSeconds ?? null,
    alertThresholdSeconds: skill.alertThresholdSeconds,
    recognitionStartSeconds: skill.recognitionStartSeconds,
    recognitionMode: skill.recognitionMode,
    repeatAlertEnabled: skill.repeatAlertEnabled ?? false,
    repeatAlertIntervalSeconds: skill.repeatAlertIntervalSeconds ?? null,
    repeatAlertMaxCount: skill.repeatAlertMaxCount ?? null,
    soundId: skill.soundId,
    volume: skill.volume,
    masterVolume,
    effectiveVolume: applyMasterVolume(skill.volume, masterVolume),
  };
}

export function mergeSkillFrameLoopRuntimeStates(
  latestStates: Record<string, SkillRuntimeState>,
  nextStates: Record<string, SkillRuntimeState>,
): Record<string, SkillRuntimeState> {
  return Object.fromEntries(
    Object.entries(nextStates).map(([skillId, nextState]) => [
      skillId,
      mergeSkillPlaybackProgress(latestStates[skillId], nextState),
    ]),
  );
}

function mergeSkillPlaybackProgress(
  latestState: SkillRuntimeState | undefined,
  nextState: SkillRuntimeState,
): SkillRuntimeState {
  if (
    !latestState ||
    latestState.alertedAt === null ||
    latestState.alertedAt !== nextState.alertedAt
  ) {
    return nextState;
  }

  const repeatedAlertCount = Math.max(
    latestState.repeatedAlertCount,
    nextState.repeatedAlertCount,
  );
  let lastRepeatedAlertAt = nextState.lastRepeatedAlertAt;

  if (
    nextState.repeatedAlertCount > latestState.repeatedAlertCount &&
    nextState.lastRepeatedAlertAt === null
  ) {
    lastRepeatedAlertAt = null;
  } else if (
    latestState.repeatedAlertCount > nextState.repeatedAlertCount &&
    latestState.lastRepeatedAlertAt === null
  ) {
    lastRepeatedAlertAt = null;
  } else if (
    latestState.lastRepeatedAlertAt !== null &&
    (nextState.lastRepeatedAlertAt === null ||
      latestState.lastRepeatedAlertAt > nextState.lastRepeatedAlertAt)
  ) {
    lastRepeatedAlertAt = latestState.lastRepeatedAlertAt;
  }

  if (
    repeatedAlertCount === nextState.repeatedAlertCount &&
    lastRepeatedAlertAt === nextState.lastRepeatedAlertAt
  ) {
    return nextState;
  }

  return {
    ...nextState,
    repeatedAlertCount,
    lastRepeatedAlertAt,
  };
}

async function getSkillBuffDurationFrameResults({
  context,
  currentProfile,
  engineRef,
  getSharedBuffSlotAnalysis,
  getCurrentWarmTraceLifecycle,
  precisionParserRuntimeKey,
  gameViewportRevision,
  remoteRecognitionWarmTracePort,
  runtimeReportEvidenceCoordinator,
}: {
  context: MonitoringFrameContext;
  currentProfile: Profile;
  engineRef: MutableRefObject<SkillBuffDurationEngine | null>;
  getSharedBuffSlotAnalysis?: GetSharedBuffSlotAnalysis;
  getCurrentWarmTraceLifecycle: () => {
    profile: Profile;
    precisionParserRuntimeKey?: string;
    gameViewportRevision: number;
  };
  precisionParserRuntimeKey?: string;
  gameViewportRevision: number;
  remoteRecognitionWarmTracePort?: RemoteRecognitionWarmTraceFeaturePort;
  runtimeReportEvidenceCoordinator?: RuntimeReportEvidenceCoordinator;
}): Promise<{
  results: Record<string, SkillBuffDurationFrameResult | null>;
  warmTraceClaim: SkillWarmTraceClaim | null;
}> {
  const activeTargets = getActiveSkillBuffDurationTargets(currentProfile.skills);
  if (activeTargets.length <= 0) {
    engineRef.current?.reset();
    engineRef.current = null;
    return { results: {}, warmTraceClaim: null };
  }

  const sampledAt = context.sampledAt;
  const includeEvidencePreview = activeTargets.some((target) =>
    runtimeReportEvidenceCoordinator?.hasPending({
      feature: "skill-buff-duration",
      targetId: target.skillId,
    }),
  );
  let frame: BuffSlotVideoFrameSample | SharedBuffSlotFrameSample | null = null;
  let warmTraceClaim: SkillWarmTraceClaim | null = null;
  try {
    const sharedAnalysis = await getOptionalSharedBuffSlotAnalysis({
      context,
      getSharedBuffSlotAnalysis,
      includePreview: includeEvidencePreview,
    });
    let imageData: ImageData;
    if (sharedAnalysis) {
      frame = sharedAnalysis.frame;
      imageData = createPlaceholderImageData();
      warmTraceClaim = claimSkillWarmTrace({
        carrier: sharedAnalysis,
        activeTargets,
        profile: currentProfile,
        featurePort: remoteRecognitionWarmTracePort,
        precisionParserRuntimeKey,
        gameViewportRevision,
      });
    } else {
      const sampledFrame = context.sampleBuffSlotFrame({
        includePreview: includeEvidencePreview,
      });
      frame = sampledFrame;
      imageData = sampledFrame.imageData;
    }
    const engine = engineRef.current ?? createSkillBuffDurationEngine();
    engineRef.current = engine;
    if (!frame) {
      throw new Error("skill-buff-duration-frame-missing");
    }
    const capturedFrame = frame;
    const response = await engine.process({
      imageData,
      sampledAt,
      buffSlotAnalysis: sharedAnalysis?.analysis,
      targets: activeTargets.map((target) => ({
        skillId: target.skillId,
        detectorId: target.detectorId,
        matcherEngine: target.matcherEngine ?? "prototype",
        matcherSkillId: target.matcherSkillId,
        maxBuffRowIndex: target.maxBuffRowIndex,
        valueKind: target.valueKind ?? "countdown",
      })),
    });
    const results = Object.fromEntries(
      activeTargets.map((target) => [
        target.skillId,
        toSkillBuffDurationFrameResult(
          response,
          capturedFrame,
          target,
          sharedAnalysis,
        ),
      ]),
    );
    if (
      warmTraceClaim &&
      !completeSkillWarmTraceMatcher({
        warmTrace: warmTraceClaim,
        response,
        sampledAt,
      })
    ) {
      warmTraceClaim = null;
    }
    return { results, warmTraceClaim };
  } catch (error) {
    const terminalOutcome = warmTraceClaim &&
      !isSkillWarmTraceLifecycleCurrent(
        warmTraceClaim,
        getCurrentWarmTraceLifecycle(),
      )
      ? "replaced"
      : "failed";
    terminateSkillWarmTraceStage(
      warmTraceClaim,
      "matcherOcrUs",
      terminalOutcome,
    );
    if (isSharedBuffSlotAnalysisDroppedError(error)) {
      return {
        results: Object.fromEntries(
          activeTargets.map((target) => [target.skillId, null]),
        ),
        warmTraceClaim: null,
      };
    }
    frame = getSharedBuffSlotAnalysisFailureFrame(error) ?? frame;
    return {
      results: Object.fromEntries(
        activeTargets.map((target) => [
          target.skillId,
          createSkillBuffDurationErrorFrameResult(target, error, frame),
        ]),
      ),
      warmTraceClaim: null,
    };
  }
}

async function getOptionalSharedBuffSlotAnalysis({
  context,
  getSharedBuffSlotAnalysis,
  includePreview,
}: {
  context: MonitoringFrameContext;
  getSharedBuffSlotAnalysis?: GetSharedBuffSlotAnalysis;
  includePreview: boolean;
}): Promise<Awaited<ReturnType<GetSharedBuffSlotAnalysis>> | null> {
  if (!getSharedBuffSlotAnalysis) {
    return null;
  }
  return getSharedBuffSlotAnalysis({
    sampledAt: context.sampledAt,
    video: context.video,
    sampleBuffSlotFrame: context.sampleBuffSlotFrame,
    includePreview,
  });
}

function getActiveSkillBuffDurationTargets(skills: SkillConfig[]): SkillBuffDurationTarget[] {
  const targetsBySkillId = new Map<string, SkillBuffDurationTarget>();
  skills.forEach((skill) => {
    if (!skill.enabled) {
      return;
    }
    const target = getSkillBuffDurationTargetForSkill(skill);
    if (target) {
      targetsBySkillId.set(target.skillId, target);
    }
  });
  return [...targetsBySkillId.values()];
}

function applySkillBuffDurationStickyFrameResults(
  stickyStates: Record<string, ReturnType<typeof createSkillBuffDurationStickyState>>,
  frameResults: Record<string, SkillBuffDurationFrameResult | null>,
  sampledAt: number,
): Record<string, SkillBuffDurationFrameResult | null> {
  return Object.fromEntries(
    Object.entries(frameResults).map(([skillId, frameResult]) => {
      stickyStates[skillId] = stickyStates[skillId] ?? createSkillBuffDurationStickyState();
      return [
        skillId,
        updateSkillBuffDurationStickyFrameResult(stickyStates[skillId], frameResult, sampledAt),
      ];
    }),
  );
}

function toSkillBuffDurationFrameResult(
  response: SkillBuffDurationSampleResponse,
  frame: BuffSlotVideoFrameSample | SharedBuffSlotFrameSample,
  target: SkillBuffDurationTarget,
  sharedAnalysis: SharedBuffSlotAnalysisResult | null,
): SkillBuffDurationFrameResult {
  const targetDetection = response.detectionsBySkillId?.[target.skillId] ?? null;
  const detectedIcon = targetDetection?.detectedIcon ?? null;
  const previewUrl = detectedIcon
    ? skillBuffDurationIconToDataUrl(detectedIcon.icon)
    : null;
  const previewImageData = detectedIcon
    ? skillBuffDurationIconToPreviewImageData(detectedIcon.icon)
    : null;

  return {
    evidenceSource: createBuffSlotEvidenceSource(frame),
    rawPreviewUrl: frame.rawPreviewUrl,
    previewUrl,
    previewImageData,
    regionLabel: detectedIcon
      ? `${Math.round(detectedIcon.box.size)}px · ${response.boxCount}개 버프칸`
      : `${frame.regionLabel} · ${response.boxCount}개 버프칸`,
    parserRuntime: sharedAnalysis?.analysis.runtime ?? null,
    parserPerformance: sharedAnalysis?.performance ?? null,
    parserFailure: null,
    snapshot: {
      targetSkillId: target.skillId,
      targetDisplayName: target.displayName,
      detected: Boolean(detectedIcon),
      boxCount: response.boxCount,
      parserRowCount: response.parserRowCount ?? null,
      parserEngine: response.parserEngine ?? null,
      parserVersion: response.parserVersion ?? null,
      parserFallbackReason: response.parserFallbackReason ?? null,
      detectedCount: targetDetection?.detectedCount ?? 0,
      matcherEngine: detectedIcon?.match.matcherEngine ?? null,
      bundleId: detectedIcon?.match.bundleId ?? null,
      modelVersion: detectedIcon?.match.modelVersion ?? null,
      baseSkillId: detectedIcon?.match.baseSkillId ?? null,
      rawSkillId: detectedIcon?.match.rawSkillId ?? null,
      score: detectedIcon?.match.score ?? null,
      threshold: detectedIcon?.match.threshold ?? null,
      margin: detectedIcon?.match.margin ?? null,
      gateScore: detectedIcon?.match.gateScore ?? null,
      gateThreshold: detectedIcon?.match.gateThreshold ?? null,
      gateMargin: detectedIcon?.match.gateMargin ?? null,
      decisionReason: detectedIcon?.match.decisionReason ?? null,
      countdown: detectedIcon?.countdown ?? null,
      countdownModelStatus: response.performance.countdownModelStatus,
      remainingCount: detectedIcon?.remainingCount ?? null,
      remainingCountModelStatus: response.performance.remainingCountModelStatus,
      performanceMs: response.performance.totalMs,
      error: null,
      candidateIcons: (targetDetection?.candidateIcons ?? [])
        .slice(0, 8)
        .map((candidate) => ({
          boxIndex: candidate.boxIndex,
          box: candidate.box,
          match: candidate.match,
          countdown: candidate.countdown ?? null,
          remainingCount: candidate.remainingCount ?? null,
          imageDataUrl: skillBuffDurationIconToDataUrl(candidate.icon),
        })),
    },
  };
}

function createSkillBuffDurationErrorFrameResult(
  target: SkillBuffDurationTarget,
  error: unknown,
  frame: BuffSlotVideoFrameSample | SharedBuffSlotFrameSample | null,
): SkillBuffDurationFrameResult {
  const parserFailure = getSharedBuffSlotAnalysisFailureEvidence(error);
  return {
    evidenceSource: frame ? createBuffSlotEvidenceSource(frame) : null,
    rawPreviewUrl: frame?.rawPreviewUrl ?? null,
    previewUrl: null,
    regionLabel: frame?.regionLabel ?? null,
    parserFailure,
    snapshot: {
      targetSkillId: target.skillId,
      targetDisplayName: target.displayName,
      detected: false,
      boxCount: 0,
      parserEngine: null,
      parserVersion: null,
      parserFallbackReason: null,
      detectedCount: 0,
      score: null,
      margin: null,
      decisionReason: null,
      performanceMs: null,
      error: error instanceof Error ? error.message : "skill-buff-duration-failed",
      candidateIcons: [],
    },
  };
}

function createSkillBuffDurationRuntimeReportSnapshot({
  processedSnapshot,
  rawFrameResult,
}: {
  processedSnapshot: SkillSnapshot;
  rawFrameResult: SkillBuffDurationFrameResult;
}): SkillSnapshot {
  return {
    ...processedSnapshot,
    rawPreviewUrl: rawFrameResult.rawPreviewUrl,
    previewUrl: rawFrameResult.previewUrl,
    previewImageData: rawFrameResult.previewImageData ?? null,
    regionLabel: rawFrameResult.regionLabel,
    buffDuration: rawFrameResult.snapshot,
  };
}

function skillBuffDurationIconToDataUrl(icon: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}): string | null {
  return imageDataToUrl(
    new ImageData(
      new Uint8ClampedArray(icon.data),
      icon.width,
      icon.height,
    ),
  );
}

function skillBuffDurationIconToPreviewImageData(
  icon: SkillBuffDurationIcon,
): RgbaImageSnapshot {
  return {
    width: icon.width,
    height: icon.height,
    data: new Uint8ClampedArray(icon.data),
  };
}
