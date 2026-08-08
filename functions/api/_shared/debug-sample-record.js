import { truncate } from "./debug-sample-format.js";

const STORED_REPORT_ASSET_PLACEHOLDER = "[stored as report asset]";

export function metadataFromSample(id, body, now) {
  const sourceRoi = body?.sample?.source?.roi;
  return {
    id,
    createdAt: now,
    kind: body?.kind ?? body?.sample?.kind ?? "skill",
    slotIndex: body?.slot?.index ?? null,
    regionLabel:
      body?.sample?.regionLabel ??
      (Number.isFinite(sourceRoi?.width) && Number.isFinite(sourceRoi?.height)
        ? `${Math.round(sourceRoi.width)}x${Math.round(sourceRoi.height)}`
        : null),
    value: body?.sample?.result?.value ?? null,
    confidence: body?.sample?.result?.confidence ?? null,
    detected: body?.sample?.result?.detected ?? null,
    candidateCount: body?.sample?.result?.candidateCount ?? null,
    status:
      body?.rune?.state?.status ??
      body?.skill?.state?.status ??
      body?.huntStall?.state?.status ??
      body?.buffExpiry?.state?.status ??
      body?.boosterExpiry?.state?.status ??
      body?.specialCore?.state?.status ??
      body?.ultimaRaidEquipment?.state?.status ??
      null,
    issueReason:
      body?.reportIssue?.reason ??
      body?.skill?.reportReason ??
      body?.rune?.reportReason ??
      body?.buffExpiry?.reportReason ??
      body?.boosterExpiry?.reportReason ??
      body?.specialCore?.reportReason ??
      body?.ultimaRaidEquipment?.reportReason ??
      null,
    issueLabel: body?.reportIssue?.label ?? null,
    issueOtherCategory:
      body?.incident?.otherCategory ?? body?.reportIssue?.otherCategory ?? null,
    issueOtherCategoryLabel:
      body?.incident?.otherCategoryLabel ??
      body?.reportIssue?.otherCategoryLabel ??
      null,
    incidentId: body?.incident?.id ?? body?.reportIssue?.incidentId ?? null,
    issueScenario: body?.incident?.scenario ?? body?.reportIssue?.scenario ?? null,
    issueScenarioLabel:
      body?.incident?.scenarioLabel ?? body?.reportIssue?.scenarioLabel ?? null,
    issueOccurrence: body?.incident?.occurrence ?? body?.reportIssue?.occurrence ?? null,
    affectedTarget: body?.incident?.affectedTarget ?? body?.reportIssue?.affectedTarget ?? null,
    appBuild:
      body?.appBuild && typeof body.appBuild === "object"
        ? {
            channel: truncate(body.appBuild.channel || "unknown", 40),
            branch: truncate(body.appBuild.branch || "unknown", 80),
            shortCommit: truncate(body.appBuild.shortCommit || body.appBuild.commitSha || "unknown", 80),
          }
        : null,
  };
}

export function getDebugSampleAssets(body) {
  const assets = [];
  const sample = body?.sample ?? {};
  if (isImageDataUrl(sample.source?.dataUrl)) {
    const sourceType = getImageDataUrlType(sample.source.dataUrl);
    assets.push({
      name: `sample-source-${sanitizeAssetNamePart(sample.source.kind || "runtime")}.${getImageExtension(sourceType)}`,
      type: sourceType,
      dataUrl: sample.source.dataUrl,
    });
  }
  if (sample.rawDataUrl) {
    assets.push({
      name: "sample-raw.png",
      type: "image/png",
      dataUrl: sample.rawDataUrl,
    });
  }
  if (sample.processedDataUrl) {
    assets.push({
      name: "sample-processed.png",
      type: "image/png",
      dataUrl: sample.processedDataUrl,
    });
  }
  if (sample.timerDataUrl) {
    assets.push({
      name: "booster-expiry-timer.png",
      type: "image/png",
      dataUrl: sample.timerDataUrl,
    });
  }
  if (sample.fullFrameDataUrl) {
    assets.push({
      name: sample.fullFrameDataUrl.startsWith("data:image/jpeg")
        ? `${body?.kind === "buff-expiry-issue" ? "buff-expiry" : "hunt-stall"}-full-frame.jpg`
        : `${body?.kind === "buff-expiry-issue" ? "buff-expiry" : "hunt-stall"}-full-frame.png`,
      type: sample.fullFrameDataUrl.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png",
      dataUrl: sample.fullFrameDataUrl,
    });
  }
  if (sample.candidateDataUrl) {
    assets.push({
      name: "sample-candidate.png",
      type: "image/png",
      dataUrl: sample.candidateDataUrl,
    });
  }
  const runeEvidence = sample.runeEvidence;
  if (isImageDataUrl(runeEvidence?.current?.candidateDataUrl)) {
    assets.push({
      name: "rune-current-candidate.png",
      type: "image/png",
      dataUrl: runeEvidence.current.candidateDataUrl,
    });
  }
  if (isImageDataUrl(runeEvidence?.lastAlert?.rawDataUrl)) {
    assets.push({
      name: "rune-last-alert-raw.png",
      type: "image/png",
      dataUrl: runeEvidence.lastAlert.rawDataUrl,
    });
  }
  if (isImageDataUrl(runeEvidence?.lastAlert?.processedDataUrl)) {
    assets.push({
      name: "rune-last-alert-processed.png",
      type: "image/png",
      dataUrl: runeEvidence.lastAlert.processedDataUrl,
    });
  }
  if (isImageDataUrl(runeEvidence?.lastAlert?.candidateDataUrl)) {
    assets.push({
      name: "rune-last-alert-candidate.png",
      type: "image/png",
      dataUrl: runeEvidence.lastAlert.candidateDataUrl,
    });
  }
  const runeRuntimeFrames = Array.isArray(runeEvidence?.runtimeFrames)
    ? runeEvidence.runtimeFrames
    : null;
  if (runeRuntimeFrames) {
    runeRuntimeFrames.slice(-6).forEach((frame, index) => {
      if (!isImageDataUrl(frame?.rawDataUrl)) {
        return;
      }
      const type = getImageDataUrlType(frame.rawDataUrl);
      const suffix = String(index + 1).padStart(2, "0");
      const frameId = sanitizeAssetNamePart(frame?.frameId || frame?.sampledAt || suffix);
      assets.push({
        name: `rune-runtime-frame-${suffix}-${frameId}.${getImageExtension(type)}`,
        type,
        dataUrl: frame.rawDataUrl,
      });
    });
  } else if (Array.isArray(runeEvidence?.runtimeIncident?.frames)) {
    runeEvidence.runtimeIncident.frames.slice(-6).forEach((frame, index) => {
      if (!isImageDataUrl(frame?.rawDataUrl)) {
        return;
      }
      const type = getImageDataUrlType(frame.rawDataUrl);
      const suffix = String(index + 1).padStart(2, "0");
      assets.push({
        name: `rune-runtime-incident-${suffix}.${getImageExtension(type)}`,
        type,
        dataUrl: frame.rawDataUrl,
      });
    });
  }
  if (!runeRuntimeFrames && Array.isArray(runeEvidence?.alertTrigger?.frames)) {
    runeEvidence.alertTrigger.frames.slice(-3).forEach((frame, index) => {
      if (!isImageDataUrl(frame?.rawDataUrl)) {
        return;
      }
      const type = getImageDataUrlType(frame.rawDataUrl);
      const suffix = String(index + 1).padStart(2, "0");
      assets.push({
        name: `rune-alert-trigger-${suffix}.${getImageExtension(type)}`,
        type,
        dataUrl: frame.rawDataUrl,
      });
    });
  }
  const buffExpiryEvidence = sample.buffExpiryEvidence;
  if (Array.isArray(buffExpiryEvidence?.media)) {
    const retainedFrameIds = new Set();
    buffExpiryEvidence.media.forEach((frame) => {
      if (
        !isImageDataUrl(frame?.dataUrl) ||
        typeof frame?.frameId !== "string" ||
        retainedFrameIds.has(frame.frameId)
      ) {
        return;
      }
      retainedFrameIds.add(frame.frameId);
      const type = getImageDataUrlType(frame.dataUrl);
      assets.push({
        name: `buff-expiry-incident-frame-${createStableAssetNamePart(frame.frameId)}.${getImageExtension(type)}`,
        type,
        dataUrl: frame.dataUrl,
      });
    });
  }
  const skillEvidence = sample.skillEvidence;
  if (Array.isArray(skillEvidence?.media)) {
    const retainedMediaIds = new Set();
    skillEvidence.media.forEach((entry) => {
      if (
        !isImageDataUrl(entry?.dataUrl) ||
        typeof entry?.id !== "string" ||
        retainedMediaIds.has(entry.id)
      ) {
        return;
      }
      retainedMediaIds.add(entry.id);
      const type = getImageDataUrlType(entry.dataUrl);
      assets.push({
        name: `skill-incident-media-${createStableAssetNamePart(entry.id)}.${getImageExtension(type)}`,
        type,
        dataUrl: entry.dataUrl,
      });
    });
  }
  const huntStallEvidence = sample.huntStallEvidence;
  if (Array.isArray(huntStallEvidence?.media)) {
    const retainedMediaVariants = new Set();
    huntStallEvidence.media.forEach((entry) => {
      if (typeof entry?.id !== "string") {
        return;
      }
      for (const [variant, dataUrl] of [
        ["raw", entry.rawDataUrl],
        ["processed", entry.processedDataUrl],
      ]) {
        const variantId = `${entry.id}:${variant}`;
        if (!isImageDataUrl(dataUrl) || retainedMediaVariants.has(variantId)) {
          continue;
        }
        retainedMediaVariants.add(variantId);
        const type = getImageDataUrlType(dataUrl);
        assets.push({
          name: `hunt-stall-incident-media-${createStableAssetNamePart(entry.id)}-${variant}.${getImageExtension(type)}`,
          type,
          dataUrl,
        });
      }
    });
  }
  const specialCoreEvidence = sample.specialCoreEvidence;
  if (Array.isArray(specialCoreEvidence?.media)) {
    const retainedMediaIds = new Set();
    specialCoreEvidence.media.forEach((entry) => {
      if (
        !isImageDataUrl(entry?.imageDataUrl) ||
        typeof entry?.id !== "string" ||
        retainedMediaIds.has(entry.id)
      ) {
        return;
      }
      retainedMediaIds.add(entry.id);
      const type = getImageDataUrlType(entry.imageDataUrl);
      assets.push({
        name: `special-core-incident-media-${createStableAssetNamePart(entry.id)}.${getImageExtension(type)}`,
        type,
        dataUrl: entry.imageDataUrl,
      });
    });
  }
  const boosterExpiryEvidence = sample.boosterExpiryEvidence;
  if (Array.isArray(boosterExpiryEvidence?.media)) {
    const retainedMediaIds = new Set();
    boosterExpiryEvidence.media.forEach((entry) => {
      if (
        !isImageDataUrl(entry?.imageDataUrl) ||
        typeof entry?.id !== "string" ||
        retainedMediaIds.has(entry.id)
      ) {
        return;
      }
      retainedMediaIds.add(entry.id);
      const type = getImageDataUrlType(entry.imageDataUrl);
      assets.push({
        name: `booster-expiry-incident-media-${createStableAssetNamePart(entry.id)}.${getImageExtension(type)}`,
        type,
        dataUrl: entry.imageDataUrl,
      });
    });
  }
  const ultimaRaidEquipmentEvidence = sample.ultimaRaidEquipmentEvidence;
  if (Array.isArray(ultimaRaidEquipmentEvidence?.media)) {
    const retainedMediaIds = new Set();
    ultimaRaidEquipmentEvidence.media.slice(-4).forEach((entry) => {
      if (
        !isImageDataUrl(entry?.dataUrl) ||
        typeof entry?.id !== "string" ||
        retainedMediaIds.has(entry.id)
      ) {
        return;
      }
      retainedMediaIds.add(entry.id);
      const type = getImageDataUrlType(entry.dataUrl);
      assets.push({
        name: `ultima-raid-equipment-incident-media-${createStableAssetNamePart(entry.id)}.${getImageExtension(type)}`,
        type,
        dataUrl: entry.dataUrl,
      });
    });
  }
  if (Array.isArray(sample.cropCandidates)) {
    sample.cropCandidates.forEach((candidate, index) => {
      const suffix = String(index + 1).padStart(2, "0");
      if (candidate?.rawDataUrl) {
        assets.push({
          name: `hunt-stall-candidate-${suffix}-raw.png`,
          type: "image/png",
          dataUrl: candidate.rawDataUrl,
        });
      }
      if (candidate?.processedDataUrl) {
        assets.push({
          name: `hunt-stall-candidate-${suffix}-processed.png`,
          type: "image/png",
          dataUrl: candidate.processedDataUrl,
        });
      }
    });
  }
  if (Array.isArray(sample.cropHistory)) {
    sample.cropHistory.forEach((frame, index) => {
      const suffix = String(index + 1).padStart(2, "0");
      for (const [variant, dataUrl] of [
        ["raw", frame?.rawDataUrl],
        ["processed", frame?.processedDataUrl],
      ]) {
        if (!isImageDataUrl(dataUrl)) {
          continue;
        }
        const type = getImageDataUrlType(dataUrl);
        assets.push({
          name: `hunt-stall-history-${suffix}-${variant}.${getImageExtension(type)}`,
          type,
          dataUrl,
        });
      }
    });
  }
  for (const [series, history] of [
    ["timer", sample.timerEvidence],
    ["confirmation", sample.confirmationEvidence],
  ]) {
    if (!Array.isArray(history)) {
      continue;
    }
    history.forEach((entry, index) => {
      if (!isImageDataUrl(entry?.dataUrl)) {
        return;
      }
      const type = getImageDataUrlType(entry.dataUrl);
      assets.push({
        name: `booster-expiry-${series}-${String(index + 1).padStart(2, "0")}.${getImageExtension(type)}`,
        type,
        dataUrl: entry.dataUrl,
      });
    });
  }
  if (Array.isArray(sample.buffDuration?.candidateIcons)) {
    sample.buffDuration.candidateIcons.forEach((candidate, index) => {
      if (!isImageDataUrl(candidate?.imageDataUrl)) {
        return;
      }
      const suffix = String(index + 1).padStart(2, "0");
      const boxIndex = Number.isFinite(candidate.boxIndex)
        ? String(candidate.boxIndex).padStart(2, "0")
        : "na";
      const score = Number.isFinite(candidate.match?.score)
        ? String(Math.round(candidate.match.score * 1000)).padStart(4, "0")
        : "noscore";
      assets.push({
        name: `skill-buff-duration-candidate-${suffix}-box-${boxIndex}-score-${score}.png`,
        type: "image/png",
        dataUrl: candidate.imageDataUrl,
      });
    });
  }
  if (Array.isArray(sample.specialCore?.candidateIcons)) {
    sample.specialCore.candidateIcons.forEach((candidate, index) => {
      if (!isImageDataUrl(candidate?.imageDataUrl)) {
        return;
      }
      const suffix = String(index + 1).padStart(2, "0");
      const boxIndex = Number.isFinite(candidate.boxIndex)
        ? String(candidate.boxIndex).padStart(2, "0")
        : "na";
      const score = Number.isFinite(candidate.match?.score)
        ? String(Math.round(candidate.match.score * 1000)).padStart(4, "0")
        : "noscore";
      assets.push({
        name: `special-core-candidate-${suffix}-box-${boxIndex}-score-${score}.png`,
        type: "image/png",
        dataUrl: candidate.imageDataUrl,
      });
    });
  }
  if (Array.isArray(sample.next?.iconEvidence)) {
    sample.next.iconEvidence.forEach((entry, index) => {
      if (!isImageDataUrl(entry?.normalizedIconDataUrl)) {
        return;
      }
      const type = getImageDataUrlType(entry.normalizedIconDataUrl);
      assets.push({
        name: `buff-expiry-icon-${String(index + 1).padStart(2, "0")}.${getImageExtension(type)}`,
        type,
        dataUrl: entry.normalizedIconDataUrl,
      });
    });
  }
  if (Array.isArray(sample.lastAlertEvidence?.triggeredTracks)) {
    sample.lastAlertEvidence.triggeredTracks.forEach((track, index) => {
      if (!isImageDataUrl(track?.normalizedIconDataUrl)) {
        return;
      }
      const type = getImageDataUrlType(track.normalizedIconDataUrl);
      assets.push({
        name: `buff-expiry-alert-${String(index + 1).padStart(2, "0")}.${getImageExtension(type)}`,
        type,
        dataUrl: track.normalizedIconDataUrl,
      });
    });
  }
  if (Array.isArray(body?.specialCore?.activationEvidence?.confirmationIcons)) {
    body.specialCore.activationEvidence.confirmationIcons.slice(0, 10).forEach((candidate, index) => {
      if (!isImageDataUrl(candidate?.imageDataUrl)) {
        return;
      }
      const suffix = String(index + 1).padStart(2, "0");
      const boxIndex = Number.isFinite(candidate.boxIndex)
        ? String(candidate.boxIndex).padStart(2, "0")
        : "na";
      const score = Number.isFinite(candidate.match?.score)
        ? String(Math.round(candidate.match.score * 1000)).padStart(4, "0")
        : "noscore";
      assets.push({
        name: `special-core-activation-${suffix}-box-${boxIndex}-score-${score}.png`,
        type: "image/png",
        dataUrl: candidate.imageDataUrl,
      });
    });
  }
  if (Array.isArray(body?.specialCore?.recentEvidence)) {
    body.specialCore.recentEvidence.slice(0, 30).forEach((entry, index) => {
      const evidenceIcon = entry?.evidenceIcon;
      if (!isImageDataUrl(evidenceIcon?.imageDataUrl)) {
        return;
      }
      const suffix = String(index + 1).padStart(2, "0");
      const source = String(entry?.source || "candidate").replace(/[^a-zA-Z0-9-]/g, "-");
      const boxIndex = Number.isFinite(evidenceIcon.boxIndex)
        ? String(evidenceIcon.boxIndex).padStart(2, "0")
        : "na";
      const score = Number.isFinite(evidenceIcon.match?.score)
        ? String(Math.round(evidenceIcon.match.score * 1000)).padStart(4, "0")
        : "noscore";
      assets.push({
        name: `special-core-evidence-${suffix}-${source}-box-${boxIndex}-score-${score}.png`,
        type: "image/png",
        dataUrl: evidenceIcon.imageDataUrl,
      });
    });
  }
  const replayFrames = sample.next?.replay?.frames;
  if (Array.isArray(replayFrames)) {
    replayFrames.slice(0, 20).forEach((frame, index) => {
      if (!frame?.imageDataUrl) {
        return;
      }
      const suffix = String(index + 1).padStart(2, "0");
      const reason = String(frame.reason || "frame").replace(/[^a-zA-Z0-9-]/g, "-");
      const isWebp = frame.imageDataUrl.startsWith("data:image/webp");
      const isJpeg = frame.imageDataUrl.startsWith("data:image/jpeg");
      assets.push({
        name: `buff-expiry-precision-roi-${suffix}-${reason}.${isWebp ? "webp" : isJpeg ? "jpg" : "png"}`,
        type: isWebp ? "image/webp" : isJpeg ? "image/jpeg" : "image/png",
        dataUrl: frame.imageDataUrl,
      });
    });
  }
  return assets;
}

export function rehydrateDebugSampleAsset(storedSample, assetName, dataUrl) {
  // Historical D1 rows retain stable asset names, but not their original JSON paths.
  const body = isRecord(storedSample?.body) ? storedSample.body : storedSample;
  if (!isRecord(body) || typeof assetName !== "string" || typeof dataUrl !== "string") {
    return false;
  }

  const sample = isRecord(body.sample) ? body.sample : null;
  if (!sample) {
    return false;
  }

  if (/^sample-source-.+\.(?:png|jpg|webp)$/.test(assetName)) {
    return replaceStoredAsset(sample.source, "dataUrl", dataUrl);
  }

  const directSampleAssets = {
    "sample-raw.png": "rawDataUrl",
    "sample-processed.png": "processedDataUrl",
    "booster-expiry-timer.png": "timerDataUrl",
    "buff-expiry-full-frame.jpg": "fullFrameDataUrl",
    "buff-expiry-full-frame.png": "fullFrameDataUrl",
    "hunt-stall-full-frame.jpg": "fullFrameDataUrl",
    "hunt-stall-full-frame.png": "fullFrameDataUrl",
    "sample-candidate.png": "candidateDataUrl",
  };
  if (directSampleAssets[assetName]) {
    return replaceStoredAsset(sample, directSampleAssets[assetName], dataUrl);
  }

  const directRuneAssets = {
    "rune-current-candidate.png": [sample.runeEvidence?.current, "candidateDataUrl"],
    "rune-last-alert-raw.png": [sample.runeEvidence?.lastAlert, "rawDataUrl"],
    "rune-last-alert-processed.png": [sample.runeEvidence?.lastAlert, "processedDataUrl"],
    "rune-last-alert-candidate.png": [sample.runeEvidence?.lastAlert, "candidateDataUrl"],
  };
  if (directRuneAssets[assetName]) {
    return replaceStoredAsset(...directRuneAssets[assetName], dataUrl);
  }

  let match = assetName.match(
    /^rune-runtime-frame-(\d+)-.+\.(?:png|jpg|webp)$/,
  );
  if (match) {
    const frames = sample.runeEvidence?.runtimeFrames;
    const slicedIndex = toZeroBasedIndex(match[1]);
    if (!Array.isArray(frames) || slicedIndex === null) {
      return false;
    }
    const frameIndex = Math.max(0, frames.length - 6) + slicedIndex;
    return replaceStoredAsset(frames[frameIndex], "rawDataUrl", dataUrl);
  }

  match = assetName.match(/^rune-runtime-incident-(\d+)\.(?:png|jpg|webp)$/);
  if (match) {
    const frames = sample.runeEvidence?.runtimeIncident?.frames;
    const slicedIndex = toZeroBasedIndex(match[1]);
    if (!Array.isArray(frames) || slicedIndex === null) {
      return false;
    }
    const frameIndex = Math.max(0, frames.length - 6) + slicedIndex;
    return replaceStoredAsset(frames[frameIndex], "rawDataUrl", dataUrl);
  }

  match = assetName.match(/^rune-alert-trigger-(\d+)\.(?:png|jpg|webp)$/);
  if (match) {
    const frames = sample.runeEvidence?.alertTrigger?.frames;
    const slicedIndex = toZeroBasedIndex(match[1]);
    if (!Array.isArray(frames) || slicedIndex === null) {
      return false;
    }
    const frameIndex = Math.max(0, frames.length - 3) + slicedIndex;
    return replaceStoredAsset(frames[frameIndex], "rawDataUrl", dataUrl);
  }

  match = assetName.match(
    /^buff-expiry-incident-frame-(.+)\.(?:png|jpg|webp)$/,
  );
  if (match) {
    const media = sample.buffExpiryEvidence?.media;
    if (!Array.isArray(media)) {
      return false;
    }
    const frame = media.find(
      (entry) =>
        typeof entry?.frameId === "string" &&
        createStableAssetNamePart(entry.frameId) === match[1],
    );
    return replaceStoredAsset(frame, "dataUrl", dataUrl);
  }

  match = assetName.match(
    /^skill-incident-media-(.+)\.(?:png|jpg|webp)$/,
  );
  if (match) {
    const media = sample.skillEvidence?.media;
    if (!Array.isArray(media)) {
      return false;
    }
    const entry = media.find(
      (candidate) =>
        typeof candidate?.id === "string" &&
        createStableAssetNamePart(candidate.id) === match[1],
    );
    return replaceStoredAsset(entry, "dataUrl", dataUrl);
  }

  match = assetName.match(
    /^hunt-stall-incident-media-(.+)-(raw|processed)\.(?:png|jpg|webp)$/,
  );
  if (match) {
    const media = sample.huntStallEvidence?.media;
    if (!Array.isArray(media)) {
      return false;
    }
    const entry = media.find(
      (candidate) =>
        typeof candidate?.id === "string" &&
        createStableAssetNamePart(candidate.id) === match[1],
    );
    return replaceStoredAsset(entry, `${match[2]}DataUrl`, dataUrl);
  }

  match = assetName.match(
    /^special-core-incident-media-(.+)\.(?:png|jpg|webp)$/,
  );
  if (match) {
    const media = sample.specialCoreEvidence?.media;
    if (!Array.isArray(media)) {
      return false;
    }
    const entry = media.find(
      (candidate) =>
        typeof candidate?.id === "string" &&
        createStableAssetNamePart(candidate.id) === match[1],
    );
    return replaceStoredAsset(entry, "imageDataUrl", dataUrl);
  }

  match = assetName.match(
    /^booster-expiry-incident-media-(.+)\.(?:png|jpg|webp)$/,
  );
  if (match) {
    const media = sample.boosterExpiryEvidence?.media;
    if (!Array.isArray(media)) {
      return false;
    }
    const entry = media.find(
      (candidate) =>
        typeof candidate?.id === "string" &&
        createStableAssetNamePart(candidate.id) === match[1],
    );
    return replaceStoredAsset(entry, "imageDataUrl", dataUrl);
  }

  match = assetName.match(
    /^ultima-raid-equipment-incident-media-(.+)\.(?:png|jpg|webp)$/,
  );
  if (match) {
    const media = sample.ultimaRaidEquipmentEvidence?.media;
    if (!Array.isArray(media)) {
      return false;
    }
    const entry = media.find(
      (candidate) =>
        typeof candidate?.id === "string" &&
        createStableAssetNamePart(candidate.id) === match[1],
    );
    return replaceStoredAsset(entry, "dataUrl", dataUrl);
  }

  match = assetName.match(/^hunt-stall-candidate-(\d+)-(raw|processed)\.png$/);
  if (match) {
    const index = toZeroBasedIndex(match[1]);
    const candidate = index === null ? null : sample.cropCandidates?.[index];
    return replaceStoredAsset(candidate, `${match[2]}DataUrl`, dataUrl);
  }

  match = assetName.match(/^hunt-stall-history-(\d+)-(raw|processed)\.(?:png|jpg|webp)$/);
  if (match) {
    const index = toZeroBasedIndex(match[1]);
    const frame = index === null ? null : sample.cropHistory?.[index];
    return replaceStoredAsset(frame, `${match[2]}DataUrl`, dataUrl);
  }

  match = assetName.match(/^booster-expiry-(timer|confirmation)-(\d+)\.(?:png|jpg|webp)$/);
  if (match) {
    const index = toZeroBasedIndex(match[2]);
    const history = match[1] === "timer" ? sample.timerEvidence : sample.confirmationEvidence;
    const entry = index === null ? null : history?.[index];
    return replaceStoredAsset(entry, "dataUrl", dataUrl);
  }

  match = assetName.match(/^skill-buff-duration-candidate-(\d+)-box-.+\.png$/);
  if (match) {
    const index = toZeroBasedIndex(match[1]);
    const candidate = index === null ? null : sample.buffDuration?.candidateIcons?.[index];
    return replaceStoredAsset(candidate, "imageDataUrl", dataUrl);
  }

  match = assetName.match(/^special-core-candidate-(\d+)-box-.+\.png$/);
  if (match) {
    const index = toZeroBasedIndex(match[1]);
    const candidate = index === null ? null : sample.specialCore?.candidateIcons?.[index];
    return replaceStoredAsset(candidate, "imageDataUrl", dataUrl);
  }

  match = assetName.match(/^buff-expiry-icon-(\d+)\.(?:png|jpg|webp)$/);
  if (match) {
    const index = toZeroBasedIndex(match[1]);
    const evidence = index === null ? null : sample.next?.iconEvidence?.[index];
    return replaceStoredAsset(evidence, "normalizedIconDataUrl", dataUrl);
  }

  match = assetName.match(/^buff-expiry-alert-(\d+)\.(?:png|jpg|webp)$/);
  if (match) {
    const index = toZeroBasedIndex(match[1]);
    const track = index === null ? null : sample.lastAlertEvidence?.triggeredTracks?.[index];
    const replaced = replaceStoredAsset(track, "normalizedIconDataUrl", dataUrl);
    const nestedTrack =
      index === null
        ? null
        : sample.next?.tracking?.lastAlertEvidence?.triggeredTracks?.[index];
    const nestedReplaced = replaceStoredAsset(
      nestedTrack,
      "normalizedIconDataUrl",
      dataUrl,
    );
    const sectionTrack =
      index === null
        ? null
        : body.buffExpiry?.lastSnapshot?.lastAlertEvidence?.triggeredTracks?.[index];
    const sectionReplaced = replaceStoredAsset(
      sectionTrack,
      "normalizedIconDataUrl",
      dataUrl,
    );
    return replaced || nestedReplaced || sectionReplaced;
  }

  match = assetName.match(/^special-core-activation-(\d+)-box-.+\.png$/);
  if (match) {
    const index = toZeroBasedIndex(match[1]);
    const candidate =
      index === null
        ? null
        : body.specialCore?.activationEvidence?.confirmationIcons?.[index];
    return replaceStoredAsset(candidate, "imageDataUrl", dataUrl);
  }

  match = assetName.match(/^special-core-evidence-(\d+)-.+\.png$/);
  if (match) {
    const index = toZeroBasedIndex(match[1]);
    const evidenceIcon =
      index === null ? null : body.specialCore?.recentEvidence?.[index]?.evidenceIcon;
    return replaceStoredAsset(evidenceIcon, "imageDataUrl", dataUrl);
  }

  match = assetName.match(/^buff-expiry-precision-roi-(\d+)-.+\.(?:png|jpg|webp)$/);
  if (match) {
    const index = toZeroBasedIndex(match[1]);
    const frame = index === null ? null : sample.next?.replay?.frames?.[index];
    return replaceStoredAsset(frame, "imageDataUrl", dataUrl);
  }

  return false;
}

export function recordDebugSampleAssetFailure(
  storedSample,
  assetName,
  reason,
) {
  if (
    !["asset-missing", "asset-persist-failed"].includes(reason) ||
    typeof assetName !== "string"
  ) {
    return false;
  }
  const body = isRecord(storedSample?.body) ? storedSample.body : storedSample;
  const sample = body?.sample;
  const buffExpiryEvidence = sample?.buffExpiryEvidence;
  const buffExpiryMedia = buffExpiryEvidence?.media;
  let match = assetName.match(
    /^buff-expiry-incident-frame-(.+)\.(?:png|jpg|webp)$/,
  );
  if (match && Array.isArray(buffExpiryMedia)) {
    const frame = buffExpiryMedia.find(
      (entry) =>
        typeof entry?.frameId === "string" &&
        createStableAssetNamePart(entry.frameId) === match[1],
    );
    return frame
      ? appendAssetFailureOmission({
          evidence: buffExpiryEvidence,
          subjectId: frame.frameId,
          prefix: "buff-expiry-asset",
          reason,
        })
      : false;
  }

  const huntStallEvidence = sample?.huntStallEvidence;
  const huntStallMedia = huntStallEvidence?.media;
  match = assetName.match(
    /^hunt-stall-incident-media-(.+)-(raw|processed)\.(?:png|jpg|webp)$/,
  );
  if (match && Array.isArray(huntStallMedia)) {
    const media = huntStallMedia.find(
      (entry) =>
        typeof entry?.id === "string" &&
        createStableAssetNamePart(entry.id) === match[1],
    );
    if (!media) {
      return false;
    }
    const appended = appendAssetFailureOmission({
      evidence: huntStallEvidence,
      subjectId: media.id,
      prefix: "hunt-stall-asset",
      reason,
    });
    markEvidenceSelectionDegraded(huntStallEvidence, reason);
    return appended;
  }

  const skillEvidence = sample?.skillEvidence;
  const skillMedia = skillEvidence?.media;
  match = assetName.match(/^skill-incident-media-(.+)\.(?:png|jpg|webp)$/);
  if (match && Array.isArray(skillMedia)) {
    const media = skillMedia.find(
      (entry) =>
        typeof entry?.id === "string" &&
        createStableAssetNamePart(entry.id) === match[1],
    );
    if (!media) {
      return false;
    }
    const appended = appendAssetFailureOmission({
      evidence: skillEvidence,
      subjectId: media.id,
      prefix: "skill-asset",
      reason,
    });
    markEvidenceSelectionDegraded(skillEvidence, reason);
    return appended;
  }

  const specialCoreEvidence = sample?.specialCoreEvidence;
  const specialCoreMedia = specialCoreEvidence?.media;
  match = assetName.match(
    /^special-core-incident-media-(.+)\.(?:png|jpg|webp)$/,
  );
  if (match && Array.isArray(specialCoreMedia)) {
    const specialCoreEntry = specialCoreMedia.find(
      (entry) =>
        typeof entry?.id === "string" &&
        createStableAssetNamePart(entry.id) === match[1],
    );
    if (!specialCoreEntry) {
      return false;
    }
    const appended = appendAssetFailureOmission({
      evidence: specialCoreEvidence,
      subjectId:
        typeof specialCoreEntry.frameId === "string"
          ? specialCoreEntry.frameId
          : specialCoreEntry.id,
      prefix: "special-core-asset",
      reason,
    });
    markEvidenceSelectionDegraded(specialCoreEvidence, reason);
    return appended;
  }

  const boosterExpiryEvidence = sample?.boosterExpiryEvidence;
  const boosterExpiryMedia = boosterExpiryEvidence?.media;
  match = assetName.match(
    /^booster-expiry-incident-media-(.+)\.(?:png|jpg|webp)$/,
  );
  if (match && Array.isArray(boosterExpiryMedia)) {
    const boosterExpiryEntry = boosterExpiryMedia.find(
      (entry) =>
        typeof entry?.id === "string" &&
        createStableAssetNamePart(entry.id) === match[1],
    );
    if (!boosterExpiryEntry) {
      return false;
    }
    const appended = appendAssetFailureOmission({
      evidence: boosterExpiryEvidence,
      subjectId:
        typeof boosterExpiryEntry.frameId === "string"
          ? boosterExpiryEntry.frameId
          : boosterExpiryEntry.id,
      prefix: "booster-expiry-asset",
      reason,
    });
    markEvidenceSelectionDegraded(boosterExpiryEvidence, reason);
    return appended;
  }

  const ultimaRaidEquipmentEvidence =
    sample?.ultimaRaidEquipmentEvidence;
  const ultimaRaidEquipmentMedia =
    ultimaRaidEquipmentEvidence?.media;
  match = assetName.match(
    /^ultima-raid-equipment-incident-media-(.+)\.(?:png|jpg|webp)$/,
  );
  if (!match || !Array.isArray(ultimaRaidEquipmentMedia)) {
    return false;
  }
  const ultimaRaidEquipmentEntry = ultimaRaidEquipmentMedia.find(
    (entry) =>
      typeof entry?.id === "string" &&
      createStableAssetNamePart(entry.id) === match[1],
  );
  if (!ultimaRaidEquipmentEntry) {
    return false;
  }
  if (!isRecord(ultimaRaidEquipmentEvidence.budget)) {
    ultimaRaidEquipmentEvidence.budget = {};
  }
  ultimaRaidEquipmentEvidence.budget.droppedMediaCount =
    Number(ultimaRaidEquipmentEvidence.budget.droppedMediaCount || 0) + 1;
  markEvidenceSelectionDegraded(ultimaRaidEquipmentEvidence, reason);
  return true;
}

function markEvidenceSelectionDegraded(evidence, reason) {
  if (!isRecord(evidence?.selection)) {
    return;
  }
  evidence.selection.support = "partial";
  const degradationReasons = Array.isArray(
    evidence.selection.degradationReasons,
  )
    ? evidence.selection.degradationReasons
    : [];
  evidence.selection.degradationReasons = [
    ...new Set([...degradationReasons, reason]),
  ];
}

function appendAssetFailureOmission({
  evidence,
  subjectId,
  prefix,
  reason,
}) {
  if (!isRecord(evidence) || typeof subjectId !== "string") {
    return false;
  }
  if (!Array.isArray(evidence.omissions)) {
    evidence.omissions = [];
  }
  const omissionId = `${prefix}:${reason}:${createStableAssetNamePart(subjectId)}`;
  if (evidence.omissions.some((entry) => entry?.id === omissionId)) {
    return true;
  }
  evidence.omissions.push({
    id: omissionId,
    occurredAt:
      Number.isFinite(evidence.frozenAt) ? evidence.frozenAt : Date.now(),
    kind: "asset",
    reason,
    subjectIds: [subjectId],
    count: 1,
  });
  return true;
}

export function hasRequiredSampleImages(body) {
  const sample = body?.sample ?? {};
  const hasRuntimeSource = isImageDataUrl(sample.source?.dataUrl);
  if (
    hasRuntimeSource &&
    ["skill-issue", "buff-expiry-issue", "special-core-issue"].includes(body?.kind)
  ) {
    return true;
  }
  if (
    body?.kind === "skill-issue" &&
    Array.isArray(sample.skillEvidence?.media) &&
    sample.skillEvidence.media.some((entry) => isImageDataUrl(entry?.dataUrl))
  ) {
    return true;
  }
  if (
    body?.kind === "hunt-stall-issue" &&
    Array.isArray(sample.huntStallEvidence?.media) &&
    sample.huntStallEvidence.media.some(
      (entry) =>
        isImageDataUrl(entry?.rawDataUrl) ||
        isImageDataUrl(entry?.processedDataUrl),
    )
  ) {
    return true;
  }
  if (
    body?.kind === "special-core-issue" &&
    Array.isArray(sample.specialCoreEvidence?.media) &&
    sample.specialCoreEvidence.media.some((entry) =>
      isImageDataUrl(entry?.imageDataUrl),
    )
  ) {
    return true;
  }
  if (
    body?.kind === "booster-expiry-issue" &&
    Array.isArray(sample.boosterExpiryEvidence?.media) &&
    sample.boosterExpiryEvidence.media.some((entry) =>
      isImageDataUrl(entry?.imageDataUrl),
    )
  ) {
    return true;
  }
  if (
    (body?.kind === "ultima-raid-equipment-issue" ||
      body?.kind === "ultima-raid-boss-issue") &&
    Array.isArray(sample.ultimaRaidEquipmentEvidence?.media) &&
    sample.ultimaRaidEquipmentEvidence.media.some((entry) =>
      isImageDataUrl(entry?.dataUrl),
    )
  ) {
    return true;
  }
  if (
    body?.kind === "skill-issue" &&
    Array.isArray(sample.buffDuration?.candidateIcons) &&
    sample.buffDuration.candidateIcons.some((candidate) => isImageDataUrl(candidate?.imageDataUrl))
  ) {
    return true;
  }
  if (body?.kind === "special-core-issue") {
    return Boolean(sample.rawDataUrl);
  }
  if (!sample.rawDataUrl) {
    return false;
  }
  if (body?.kind === "booster-expiry-issue") {
    return true;
  }
  return Boolean(sample.processedDataUrl);
}

function isImageDataUrl(value) {
  return typeof value === "string" && value.startsWith("data:image/");
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function replaceStoredAsset(target, key, dataUrl) {
  if (!isRecord(target) || target[key] !== STORED_REPORT_ASSET_PLACEHOLDER) {
    return false;
  }

  target[key] = dataUrl;
  return true;
}

function toZeroBasedIndex(value) {
  const index = Number(value) - 1;
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function getImageDataUrlType(value) {
  if (value.startsWith("data:image/webp")) return "image/webp";
  if (value.startsWith("data:image/jpeg")) return "image/jpeg";
  return "image/png";
}

function getImageExtension(type) {
  if (type === "image/webp") return "webp";
  if (type === "image/jpeg") return "jpg";
  return "png";
}

function sanitizeAssetNamePart(value) {
  return String(value).replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 60) || "runtime";
}

function createStableAssetNamePart(value) {
  const text = String(value);
  const prefix = sanitizeAssetNamePart(text).slice(0, 42);
  return `${prefix}-${hashToken(text)}`;
}

function hashToken(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
