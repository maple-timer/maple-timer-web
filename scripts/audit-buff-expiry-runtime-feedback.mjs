import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
  reconcileBuffExpiryTracks,
  selectBuffExpiryRuntimeMatches,
} from "../src/lib/buffExpiryLegacy/buffExpiryLegacyRuntime.ts";
import { SUPPORTED_BUFF_EXPIRY_BUFF_IDS } from "../src/lib/buffExpiry/buffExpiryCatalog.ts";

const resourceRoot = resolve(
  process.argv[2] ?? "debug-samples/test-resources/buff-expiry",
);
const reportsDir = join(resourceRoot, "runtime-trace/feedback/reports");
const resultsPath = join(resourceRoot, "manual-review-results.json");
const outputDir = join(resourceRoot, "runtime-trace");
const outputJsonPath = join(outputDir, "runtime-feedback-replay-audit.json");
const outputMarkdownPath = join(outputDir, "runtime-feedback-replay-audit.md");
const strict = process.argv.includes("--strict");
const supportedBuffIds = new Set(SUPPORTED_BUFF_EXPIRY_BUFF_IDS);

const runtimeExpectations = {
  "357c2411-7666-4735-bcbd-21e8e0567567": {
    kind: "no-tracks",
    note: "waiting/no-track result should stay empty",
  },
  "640fae37-6e6c-4542-a597-e5ed2b6342af": {
    kind: "required-tracks",
    requiredBuffIds: ["union_wealth_group"],
    note: "new feedback sample should at least keep the observed union wealth confirmation",
  },
  "38d706c6-2ecc-4955-8348-d1fed5513e04": {
    kind: "required-tracks",
    requiredBuffIds: ["union_wealth_group"],
    note: "union wealth should confirm in addition to the existing detected group",
  },
  "39ba7e73-4951-4a21-9522-7cb52626d4e3": {
    kind: "no-tracks",
    note: "waiting/no-track result should stay empty",
  },
  "64053723-099f-488b-9a8a-4a2f04e2dec7": {
    kind: "no-tracks",
    note: "waiting/no-track result should stay empty",
  },
  "642aebb7-a099-4d5d-b437-983efb79f19a": {
    kind: "required-tracks",
    requiredBuffIds: [
      "union_wealth_group",
      "union_luck_group",
      "small_wealth_exp_potion_group",
      "exp_multiplier_coupon_group",
      "bonus_exp_coupon_group",
    ],
    note: "all five supported selected buff groups should confirm",
  },
  "d25bb915-59ae-4819-aa2b-4a44c425aea5": {
    kind: "required-tracks",
    requiredBuffIds: ["bonus_exp_coupon_group"],
    note: "new feedback sample should at least keep the observed bonus EXP coupon confirmation",
  },
  "c4ec942b-1274-4db9-af11-b99d6afd14f3": {
    kind: "no-tracks",
    note: "missed-alert feedback has a trace, but no stable 31-59s countdown evidence in the captured window",
  },
  "e262dfff-19dc-4cbe-8574-7735ef531793": {
    kind: "no-tracks",
    note: "unsupported town buff icons with timer labels must not confirm as union buff expiry tracks",
  },
  "298c049a-1e0a-4f8f-85fd-2a215e0b4efe": {
    kind: "no-tracks",
    note: "unsupported buff icons with timer labels must not confirm as union buff expiry tracks",
  },
  "2cac8f89-0752-4500-ba7f-20037600c090": {
    kind: "required-tracks",
    requiredBuffIds: [
      "union_wealth_group",
      "union_luck_group",
      "small_wealth_exp_potion_group",
      "exp_multiplier_coupon_group",
      "bonus_exp_coupon_group",
    ],
    maxReplayTrackExpiresSpreadMs: 30_000,
    note: "follow-up report from the same run should keep all five groups inside one alert window",
  },
  "8f0a91fc-cd1b-45a4-b4a9-8e2078a8a0ae": {
    kind: "no-tracks",
    note: "unsupported buff icons with timer labels must not confirm as union buff expiry tracks",
  },
  "80973686-0b16-4c3d-9e70-868f6596efa8": {
    kind: "required-tracks",
    requiredBuffIds: [
      "union_wealth_group",
      "union_luck_group",
      "small_wealth_exp_potion_group",
      "exp_multiplier_coupon_group",
      "bonus_exp_coupon_group",
    ],
    maxReplayTrackExpiresSpreadMs: 30_000,
    note: "initial report from the same run should confirm the five observed groups as one alert window",
  },
  "6adaa46c-c11d-48fa-bf12-1080b891392e": {
    kind: "no-tracks",
    note: "old false-positive report has no runtime trace; covered by matcher negative samples",
  },
  "c287154c-b56a-4368-847b-388ee7ddd073": {
    kind: "no-tracks",
    note: "old false-positive report has no runtime trace; covered by matcher negative samples",
  },
};

if (!existsSync(reportsDir)) {
  throw new Error(`Missing runtime feedback report directory: ${reportsDir}`);
}

const manualReviewResults = existsSync(resultsPath)
  ? JSON.parse(readFileSync(resultsPath, "utf8"))
  : null;
const reportIds = readdirSync(reportsDir)
  .filter((fileName) => fileName.endsWith(".json"))
  .map((fileName) => basename(fileName, ".json"))
  .sort();
const auditResults = reportIds.map((reportId) => auditReport(reportId));
const summary = {
  pass: auditResults.filter((result) => result.status === "pass").length,
  fail: auditResults.filter((result) => result.status === "fail").length,
  skipped: auditResults.filter((result) => result.status === "skipped").length,
};

mkdirSync(outputDir, { recursive: true });
writeFileSync(
  outputJsonPath,
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    resourceRoot,
    manualReviewResults: resultsPath,
    summary,
    results: auditResults,
  }, null, 2)}\n`,
);
writeFileSync(outputMarkdownPath, makeMarkdownReport(auditResults, summary));

console.log(makeConsoleReport(auditResults, summary));
console.log(`\nJSON: ${relative(process.cwd(), outputJsonPath)}`);
console.log(`Markdown: ${relative(process.cwd(), outputMarkdownPath)}`);

if (strict && summary.fail > 0) {
  process.exitCode = 1;
}

function auditReport(reportId) {
  const reportPath = join(reportsDir, `${reportId}.json`);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const sample = getReportSample(report);
  const frames = Array.isArray(sample?.runtimeTrace) ? sample.runtimeTrace : [];
  const replay = replayRuntimeTrace(frames);
  const expectation = runtimeExpectations[reportId] ?? { kind: "manual-only", note: "no replay expectation configured" };
  const manualReview = manualReviewResults?.reviews?.[`runtime:${reportId}`] ?? null;
  const evaluation = evaluateReplay(expectation, replay, frames.length);

  return {
    reportId,
    status: evaluation.status,
    reason: evaluation.reason,
    manualStatus: manualReview?.status ?? null,
    manualNote: manualReview?.note ?? "",
    expectation,
    traceFrameCount: frames.length,
    replayTracks: replay.tracks.map(compactTrack),
    replayPendingTracks: replay.pendingTracks.map(compactPendingTrack),
    acceptedSequences: summarizeAcceptedSequences(frames),
    rejectedSequences: summarizeRejectedSequences(frames),
  };
}

function getReportSample(report) {
  return report.body?.sample ?? report.sample ?? report.buffExpiry?.lastSnapshot ?? null;
}

function replayRuntimeTrace(frames) {
  let tracks = [];
  let pendingTracks = [];
  let temporalCandidateTracks = [];
  let expiryClusters = [];

  for (const frame of frames) {
    const acceptedMatches = (frame.acceptedMatches ?? []).filter((match) => supportedBuffIds.has(match.buffId));
    const temporalCandidateMatches = selectTemporalCandidateMatchesFromRejected(frame.rejectedMatches ?? []);
    const trackingMatches = selectBuffExpiryRuntimeMatches({
      acceptedMatches,
      hypothesisMatches: [],
      previousTracks: tracks,
      previousPendingTracks: pendingTracks,
      now: frame.sampledAt,
    });
    const boxes = collectFrameBoxes(frame);
    const reconciled = reconcileBuffExpiryTracks({
      previousTracks: tracks,
      previousPendingTracks: pendingTracks,
      previousTemporalCandidateTracks: temporalCandidateTracks,
      previousExpiryClusters: expiryClusters,
      acceptedMatches: trackingMatches,
      temporalCandidateMatches,
      boxes,
      now: frame.sampledAt,
    });
    tracks = reconciled.tracks;
    pendingTracks = reconciled.pendingTracks;
    temporalCandidateTracks = reconciled.temporalCandidateTracks;
    expiryClusters = reconciled.expiryClusters;
  }

  return { tracks, pendingTracks, temporalCandidateTracks, expiryClusters };
}

function selectTemporalCandidateMatchesFromRejected(rejectedMatches) {
  return rejectedMatches
    .filter((match) =>
      ["low-score", "low-buff-margin", "low-second-margin"].includes(match.reason) &&
      match.candidateBuffId &&
      supportedBuffIds.has(match.candidateBuffId) &&
      typeof match.candidateSeconds === "number" &&
      match.candidateSeconds >= 31 &&
      match.candidateSeconds <= 59 &&
      typeof match.score === "number" &&
      match.score >= 0.905
    )
    .map((match) => ({
      box: match.box,
      buffId: match.candidateBuffId,
      name: match.candidateName ?? match.candidateBuffId,
      seconds: match.candidateSeconds,
      score: match.score,
      buffMargin: 0,
      secondMargin: 0,
      reason: "temporal-low-score",
      strength: "weak",
      topMatches: match.topMatches ?? [],
    }));
}

function collectFrameBoxes(frame) {
  const byKey = new Map();
  for (const match of [...(frame.acceptedMatches ?? []), ...(frame.rejectedMatches ?? [])]) {
    if (!match.box) {
      continue;
    }
    byKey.set(boxKey(match.box), match.box);
  }
  for (const track of [...(frame.tracks ?? []), ...(frame.pendingTracks ?? [])]) {
    if (!track.box) {
      continue;
    }
    byKey.set(boxKey(track.box), track.box);
  }
  return [...byKey.values()];
}

function evaluateReplay(expectation, replay, frameCount) {
  if (expectation.kind === "manual-only") {
    return { status: "skipped", reason: "no configured runtime replay expectation" };
  }
  if (frameCount === 0) {
    return { status: "skipped", reason: "report has no runtime trace to replay" };
  }
  if (expectation.kind === "no-tracks") {
    return replay.tracks.length === 0
      ? { status: "pass", reason: "no replay tracks" }
      : { status: "fail", reason: `unexpected tracks: ${replay.tracks.map((track) => track.buffId).join(", ")}` };
  }
  if (expectation.kind === "required-tracks") {
    const confirmed = new Set(replay.tracks.map((track) => track.buffId));
    const missing = expectation.requiredBuffIds.filter((buffId) => !confirmed.has(buffId));
    if (missing.length > 0) {
      return { status: "fail", reason: `missing required tracks: ${missing.join(", ")}` };
    }

    if (typeof expectation.maxReplayTrackExpiresSpreadMs === "number") {
      const expiresAt = replay.tracks.map((track) => track.expiresAt);
      const spread = expiresAt.length ? Math.max(...expiresAt) - Math.min(...expiresAt) : 0;
      if (spread > expectation.maxReplayTrackExpiresSpreadMs) {
        return {
          status: "fail",
          reason: `replay track expiry spread ${spread}ms exceeds ${expectation.maxReplayTrackExpiresSpreadMs}ms`,
        };
      }
    }

    return { status: "pass", reason: "all required tracks confirmed" };
  }
  return { status: "skipped", reason: `unknown expectation kind: ${expectation.kind}` };
}

function summarizeAcceptedSequences(frames) {
  const sequences = new Map();
  for (const frame of frames) {
    for (const match of frame.acceptedMatches ?? []) {
      if (!supportedBuffIds.has(match.buffId)) {
        continue;
      }
      const key = `${match.buffId}@${match.box?.row ?? "?"}:${match.box?.col ?? "?"}`;
      if (!sequences.has(key)) {
        sequences.set(key, []);
      }
      const firstAt = sequences.get(key)[0]?.sampledAt ?? frame.sampledAt;
      sequences.get(key).push({
        sampledAt: frame.sampledAt,
        elapsedMs: frame.sampledAt - firstAt,
        seconds: match.seconds,
        strength: match.strength,
        score: round(match.score),
        reason: match.reason,
      });
    }
  }

  return [...sequences.entries()].map(([key, observations]) => ({
    key,
    observations: observations.map(({ elapsedMs, seconds, strength, score, reason }) => ({
      elapsedSeconds: Math.round(elapsedMs / 1000),
      seconds,
      strength,
      score,
      reason,
    })),
  }));
}

function summarizeRejectedSequences(frames) {
  const sequences = new Map();
  for (const frame of frames) {
    for (const match of frame.rejectedMatches ?? []) {
      if (!match.candidateBuffId || match.score < 0.9) {
        continue;
      }
      if (!supportedBuffIds.has(match.candidateBuffId)) {
        continue;
      }
      const key = `${match.candidateBuffId}@${match.box?.row ?? "?"}:${match.box?.col ?? "?"}`;
      if (!sequences.has(key)) {
        sequences.set(key, []);
      }
      const firstAt = sequences.get(key)[0]?.sampledAt ?? frame.sampledAt;
      sequences.get(key).push({
        sampledAt: frame.sampledAt,
        elapsedMs: frame.sampledAt - firstAt,
        seconds: match.candidateSeconds,
        score: round(match.score),
        reason: match.reason,
      });
    }
  }

  return [...sequences.entries()].map(([key, observations]) => {
    const reasons = new Map();
    let max = observations[0] ?? null;
    for (const observation of observations) {
      reasons.set(observation.reason, (reasons.get(observation.reason) ?? 0) + 1);
      if (!max || observation.score > max.score) {
        max = observation;
      }
    }
    return {
      key,
      count: observations.length,
      reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]),
      max: max
        ? {
          seconds: max.seconds,
          score: max.score,
          reason: max.reason,
        }
        : null,
      observations: observations.map(({ elapsedMs, seconds, score, reason }) => ({
        elapsedSeconds: Math.round(elapsedMs / 1000),
        seconds,
        score,
        reason,
      })),
    };
  });
}

function compactTrack(track) {
  return {
    id: track.id,
    buffId: track.buffId,
    detectedSeconds: track.detectedSeconds,
    detectedAt: track.detectedAt,
    expiresAt: track.expiresAt,
    alertedAt: track.alertedAt,
    score: round(track.score),
    box: compactBox(track.box),
  };
}

function compactPendingTrack(track) {
  return {
    id: track.id,
    buffId: track.buffId,
    score: round(track.score),
    box: compactBox(track.box),
    observations: track.observations.map((observation) => ({
      seconds: observation.seconds,
      observedAt: observation.observedAt,
      score: round(observation.score),
      strength: observation.strength,
      reason: observation.reason,
    })),
  };
}

function compactBox(box) {
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
    row: box.row ?? null,
    col: box.col ?? null,
  };
}

function boxKey(box) {
  return [
    Math.round(box.x),
    Math.round(box.y),
    Math.round(box.width),
    Math.round(box.height),
  ].join(":");
}

function round(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * 10_000) / 10_000
    : value;
}

function makeConsoleReport(results, counts) {
  const lines = [
    `Runtime feedback replay: ${counts.pass} pass, ${counts.fail} fail, ${counts.skipped} skipped`,
  ];
  for (const result of results) {
    lines.push(`- ${result.status.toUpperCase()} ${result.reportId}: ${result.reason}`);
  }
  return lines.join("\n");
}

function makeMarkdownReport(results, counts) {
  return `# Buff Expiry Runtime Feedback Replay Audit

Source: \`${relative(process.cwd(), resourceRoot)}\`

Summary: ${counts.pass} pass, ${counts.fail} fail, ${counts.skipped} skipped.

| Status | Report | Manual | Trace Frames | Result |
| --- | --- | --- | ---: | --- |
${results.map((result) => `| ${result.status} | \`${result.reportId}\` | ${result.manualStatus ?? ""} | ${result.traceFrameCount} | ${result.reason} |`).join("\n")}

## Details

${results.map((result) => makeResultSection(result)).join("\n\n")}
`;
}

function makeResultSection(result) {
  const tracks = result.replayTracks.length
    ? result.replayTracks.map((track) => `- ${track.buffId}: ${track.detectedSeconds}s @ row ${track.box.row}, col ${track.box.col}`).join("\n")
    : "- none";
  const pending = result.replayPendingTracks.length
    ? result.replayPendingTracks.map((track) => `- ${track.buffId}: ${track.observations.map((observation) => observation.seconds).join(" -> ")}`).join("\n")
    : "- none";
  const sequences = result.acceptedSequences.length
    ? result.acceptedSequences
      .map((sequence) => `- ${sequence.key}: ${sequence.observations.map((observation) => `${observation.elapsedSeconds}s=${observation.seconds}/${observation.strength}/${observation.score}`).join(", ")}`)
      .join("\n")
    : "- none";
  const rejected = result.rejectedSequences.length
    ? result.rejectedSequences
      .map((sequence) => {
        const reasons = sequence.reasons.map(([reason, count]) => `${reason}=${count}`).join(", ");
        const max = sequence.max ? `max ${sequence.max.seconds}/${sequence.max.score}/${sequence.max.reason}` : "max n/a";
        return `- ${sequence.key}: ${sequence.count} rejected (${reasons}; ${max})`;
      })
      .join("\n")
    : "- none";

  return `### ${result.reportId}

- Status: ${result.status}
- Reason: ${result.reason}
- Manual: ${result.manualStatus ?? "n/a"}${result.manualNote ? ` (${result.manualNote})` : ""}
- Expectation: ${result.expectation.note}

Replay tracks:
${tracks}

Replay pending tracks:
${pending}

Accepted sequences:
${sequences}

Rejected candidates >= 0.90:
${rejected}`;
}
