import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const inputPath = resolve(process.argv[2] ?? "");
if (!process.argv[2] || process.argv.includes("--help") || process.argv.includes("-h")) {
  printUsage();
  process.exit(process.argv[2] ? 0 : 1);
}
if (!existsSync(inputPath)) {
  throw new Error(`Missing event JSON: ${inputPath}`);
}

const outputPath = resolve(process.argv[3] ?? join(dirname(inputPath), "buff-expiry-video-events.html"));
const outputDir = dirname(outputPath);
const eventReport = JSON.parse(readFileSync(inputPath, "utf8"));
const auditReport = loadJsonIfExists(join(dirname(inputPath), "buff-expiry-current-video-audit.json"));

writeFileSync(outputPath, renderHtml(eventReport, auditReport, outputDir));
console.log(`HTML: ${outputPath}`);

function renderHtml(report, audit, outputDir) {
  const videos = Array.isArray(report.videos) ? report.videos : [];
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Buff Expiry Video Events</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --panel: #ffffff;
      --panel-subtle: #f8fafc;
      --text: #172033;
      --muted: #667085;
      --line: #d9e0ec;
      --accent: #2563eb;
      --warn-bg: #fff8e6;
      --warn-line: #f0c66b;
      --shadow: 0 10px 32px rgba(15, 23, 42, 0.08);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.45;
    }
    main {
      width: min(1280px, calc(100% - 40px));
      margin: 28px auto 48px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 28px;
      letter-spacing: 0;
    }
    h2 {
      margin: 28px 0 12px;
      font-size: 20px;
      letter-spacing: 0;
    }
    h3 {
      margin: 0 0 10px;
      font-size: 15px;
      letter-spacing: 0;
    }
    .muted { color: var(--muted); }
    .video {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 18px;
      margin-top: 18px;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      color: var(--muted);
      margin-bottom: 14px;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin: 14px 0;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: var(--panel-subtle);
    }
    .label {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 4px;
    }
    .value {
      font-size: 22px;
      font-weight: 700;
    }
    .notice {
      background: var(--warn-bg);
      border: 1px solid var(--warn-line);
      border-radius: 8px;
      padding: 12px;
      margin: 14px 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    th, td {
      padding: 9px 10px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
      text-align: left;
    }
    th {
      background: #eef3fb;
      font-size: 12px;
      color: #405168;
      white-space: nowrap;
    }
    tr:last-child td { border-bottom: 0; }
    .event-kind {
      display: inline-flex;
      align-items: center;
      min-width: 64px;
      justify-content: center;
      border-radius: 999px;
      padding: 3px 8px;
      background: #e6f0ff;
      color: #1e4fbf;
      font-weight: 700;
      font-size: 12px;
    }
    .event-icon {
      display: inline-flex;
      width: 44px;
      height: 44px;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #111827;
      overflow: hidden;
    }
    .event-icon img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      image-rendering: pixelated;
    }
    .event-icon-list {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      min-width: 96px;
    }
    .frame-icons {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .frame-icon {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 4px 6px;
      background: #fff;
      color: var(--text);
    }
    .frame-icon img {
      width: 28px;
      height: 28px;
      object-fit: contain;
      image-rendering: pixelated;
      background: #111827;
      border-radius: 4px;
    }
    .frame-icon span {
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
    }
    .thumb-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    figure {
      margin: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-subtle);
      overflow: hidden;
    }
    figure img {
      display: block;
      width: 100%;
      height: auto;
      background: #0f172a;
    }
    figcaption {
      padding: 8px 10px;
      color: var(--muted);
      font-size: 12px;
    }
    a {
      color: var(--accent);
      text-decoration: none;
    }
    a:hover { text-decoration: underline; }
    .empty {
      padding: 20px;
      border: 1px dashed var(--line);
      border-radius: 8px;
      color: var(--muted);
      background: var(--panel-subtle);
    }
  </style>
</head>
<body>
  <main>
    <h1>Buff Expiry Video Events</h1>
    <div class="muted">Alert lead seconds: ${escapeHtml(String(report.alertLeadSeconds ?? "-"))}</div>
    ${videos.map((video) => renderVideo(video, audit, outputDir)).join("\n")}
  </main>
</body>
</html>
`;
}

function renderVideo(video, audit, outputDir) {
  const manifest = loadVideoManifest(video.frameDir);
  const auditVideo = audit?.videos?.find((item) => item.id === video.id) ?? null;
  const title = manifest?.title ?? video.title ?? video.id;
  const events = Array.isArray(video.events) ? video.events : [];
  const confirmedCount = events.filter((event) => event.kind === "confirmed").length;
  const alertCount = events.filter((event) => event.kind === "alerted").length;
  const recognizedCount = events.filter((event) => event.kind === "recognized").length;
  const acceptedTotal = sumAcceptedCounts(auditVideo?.acceptedCounts);
  const frames = manifest?.frames ?? [];
  const sampleFrames = selectSampleFrames(frames, events);
  const sourceUrl = manifest?.sourceUrl;
  const sourceLine = sourceUrl
    ? `<span>Source: <a href="${escapeAttr(sourceUrl)}">${escapeHtml(sourceUrl)}</a></span>`
    : "";

  return `<section class="video">
    <h2>${escapeHtml(title)}</h2>
    <div class="meta">
      <span>ID: ${escapeHtml(video.id ?? "-")}</span>
      <span>Frames: ${formatNumber(video.frameCount)}</span>
      <span>Avg boxes: ${formatNumber(video.boxCountAverage)}</span>
      <span>Unsupported: ${formatNumber(video.unsupportedFrames)}</span>
      ${sourceLine}
    </div>
    <div class="cards">
      ${metricCard("인식 이벤트", recognizedCount)}
      ${metricCard("확정 이벤트", confirmedCount)}
      ${metricCard("알림 이벤트", alertCount)}
      ${metricCard("Accepted matches", acceptedTotal)}
      ${metricCard("Final tracks", video.finalTracks?.length ?? 0)}
      ${metricCard("Pending", video.finalPendingTracks?.length ?? 0)}
    </div>
    ${renderAcceptedCounts(auditVideo?.acceptedCounts)}
    ${events.length ? renderEventTable(events, outputDir, manifest, video.frameDir) : renderEmptyState(auditVideo)}
    ${renderSampleFrames(sampleFrames, outputDir, video.frameDir, events)}
  </section>`;
}

function metricCard(label, value) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${formatNumber(value)}</div></div>`;
}

function renderAcceptedCounts(counts) {
  if (!counts) {
    return "";
  }
  const rows = Object.entries(counts);
  if (!rows.length) {
    return "";
  }
  return `<h3>Accepted Match Counts</h3>
  <table>
    <thead><tr><th>Buff</th><th>Count</th></tr></thead>
    <tbody>
      ${rows.map(([buffId, count]) => `<tr><td>${escapeHtml(buffId)}</td><td>${formatNumber(count)}</td></tr>`).join("\n")}
    </tbody>
  </table>`;
}

function renderEmptyState(auditVideo) {
  const acceptedTotal = sumAcceptedCounts(auditVideo?.acceptedCounts);
  const detail = acceptedTotal === 0
    ? "버프칸은 검출됐지만 현재 지원 버프 countdown accepted match가 없어서 확정/알림 이벤트도 없습니다."
    : "accepted match는 있었지만 확정 또는 알림 이벤트로 이어지지 않았습니다.";
  return `<div class="notice">
    <strong>이벤트 없음</strong><br>
    ${escapeHtml(detail)}
  </div>`;
}

function renderEventTable(events, outputDir, manifest, frameDir) {
  return `<h3>Event Timeline</h3>
  <table>
    <thead>
      <tr><th>Time</th><th>Event</th><th>Icon</th><th>Buff</th><th>Detail</th><th>Frame</th></tr>
    </thead>
    <tbody>
      ${events.map((event) => renderEventRow(event, outputDir, manifest, frameDir)).join("\n")}
    </tbody>
  </table>`;
}

function renderEventRow(event, outputDir, manifest, frameDir) {
  const frame = findFrameAtSecond(manifest?.frames ?? [], event.second);
  const frameLink = frame ? renderFrameLink(frame, outputDir, frameDir, "frame") : "-";
  if (event.kind === "recognized") {
    return `<tr>
      <td>${formatTime(event.second)}</td>
      <td><span class="event-kind">인식</span></td>
      <td>${renderEventIcon(event.iconFile, outputDir, "recognized icon")}</td>
      <td>${escapeHtml(event.label ?? event.buffId ?? "-")}</td>
      <td>${formatNumber(event.detectedSeconds)}s, expires ${formatTime(event.expiresSecond)}, score ${formatNumber(event.score)}, ${escapeHtml(event.reason ?? "-")}/${escapeHtml(event.strength ?? "-")}</td>
      <td>${frameLink}</td>
    </tr>`;
  }
  if (event.kind === "confirmed") {
    const trigger = event.triggerIconFile
      ? `, ${renderRelativeLink(join(outputDir, event.triggerIconFile), outputDir, "trigger")}`
      : "";
    return `<tr>
      <td>${formatTime(event.second)}</td>
      <td><span class="event-kind">확정</span></td>
      <td>${renderEventIcon(event.triggerIconFile, outputDir, "trigger icon")}</td>
      <td>${escapeHtml(event.label ?? event.buffId ?? "-")}</td>
      <td>${formatNumber(event.detectedSeconds)}s, expires ${formatTime(event.expiresSecond)}${trigger}</td>
      <td>${frameLink}</td>
    </tr>`;
  }
  if (event.kind === "cluster-confirmed") {
    return `<tr>
      <td>${formatTime(event.second)}</td>
      <td><span class="event-kind">클러스터</span></td>
      <td>-</td>
      <td>${escapeHtml(event.clusterId ?? "-")}</td>
      <td>expires ${formatTime(event.centerExpiresSecond)}, alert ${formatTime(event.alertSecond)}, inliers ${formatNumber(event.inlierCount)}/${formatNumber(event.observationCount)}, slots ${formatNumber(event.distinctSlotCount)}, buffs ${formatNumber(event.distinctBuffCount)}</td>
      <td>${frameLink}</td>
    </tr>`;
  }
  if (event.kind === "member-confirmed") {
    const trigger = event.triggerIconFile
      ? `, ${renderRelativeLink(join(outputDir, event.triggerIconFile), outputDir, "trigger")}`
      : "";
    return `<tr>
      <td>${formatTime(event.second)}</td>
      <td><span class="event-kind">멤버</span></td>
      <td>${renderEventIcon(event.triggerIconFile, outputDir, "cluster member icon")}</td>
      <td>${escapeHtml(event.label ?? event.buffId ?? "-")}</td>
      <td>${formatNumber(event.detectedSeconds)}s, expires ${formatTime(event.expiresSecond)}, cluster ${escapeHtml(event.clusterId ?? "-")}${trigger}</td>
      <td>${frameLink}</td>
    </tr>`;
  }
  const buffNames = (event.tracks ?? []).map((track) => track.label ?? track.buffId).join(", ");
  const detail = (event.tracks ?? [])
    .map((track) => `${track.label ?? track.buffId} remaining ${track.remainingSeconds}s, expires ${formatTime(track.expiresSecond)}`)
    .join("<br>");
  return `<tr>
    <td>${formatTime(event.second)}</td>
    <td><span class="event-kind">알림</span></td>
    <td>${renderAlertIcons(event.tracks ?? [], outputDir)}</td>
    <td>${escapeHtml(buffNames || "-")}</td>
    <td>${detail || "-"}</td>
    <td>${frameLink}</td>
  </tr>`;
}

function renderEventIcon(iconFile, outputDir, alt) {
  if (!iconFile) {
    return "-";
  }
  const href = toRelativeUrl(join(outputDir, iconFile), outputDir);
  return `<a class="event-icon" href="${href}"><img src="${href}" alt="${escapeAttr(alt)}"></a>`;
}

function renderAlertIcons(tracks, outputDir) {
  const iconTracks = tracks.filter((track) => track.iconFile);
  if (!iconTracks.length) {
    return "-";
  }
  return `<div class="event-icon-list">
    ${iconTracks.map((track) => renderEventIcon(track.iconFile, outputDir, track.label ?? track.buffId ?? "alert icon")).join("\n")}
  </div>`;
}

function renderSampleFrames(frames, outputDir, frameDir, events) {
  if (!frames.length) {
    return "";
  }
  return `<h3>Sample Frames</h3>
  <div class="thumb-grid">
    ${frames.map((frame) => renderSampleFigure(frame, outputDir, frameDir, events)).join("\n")}
  </div>`;
}

function renderSampleFigure(frame, outputDir, frameDir, events) {
  const src = toRelativeUrl(resolve(frameDir, frame.file), outputDir);
  const relatedIcons = selectFrameIconEvents(events, frame.second);
  return `<figure>
    <a href="${src}"><img src="${src}" alt="Frame at ${formatTime(frame.second)}"></a>
    <figcaption>
      ${formatTime(frame.second)} · ${escapeHtml(basename(frame.file))}
      ${renderFrameIcons(relatedIcons, outputDir)}
    </figcaption>
  </figure>`;
}

function selectFrameIconEvents(events, second) {
  const targetSecond = Math.round(Number(second));
  return events
    .filter((event) => Math.round(Number(event.second)) === targetSecond)
    .map((event) => ({
      kind: event.kind,
      label: event.label ?? event.buffId ?? event.tracks?.map((track) => track.label).join(", ") ?? "-",
      iconFile: event.kind === "confirmed" || event.kind === "member-confirmed"
        ? event.triggerIconFile
        : event.iconFile,
      tracks: event.tracks,
    }))
    .flatMap((event) => {
      if (Array.isArray(event.tracks)) {
        return event.tracks
          .filter((track) => track.iconFile)
          .map((track) => ({
            kind: event.kind,
            label: track.label ?? track.buffId ?? event.label,
            iconFile: track.iconFile,
          }));
      }
      return event.iconFile ? [event] : [];
    });
}

function renderFrameIcons(events, outputDir) {
  if (!events.length) {
    return "";
  }
  return `<div class="frame-icons">
    ${events.map((event) => renderFrameIcon(event, outputDir)).join("\n")}
  </div>`;
}

function renderFrameIcon(event, outputDir) {
  const href = toRelativeUrl(join(outputDir, event.iconFile), outputDir);
  const kind = event.kind === "confirmed" ? "확정" : "인식";
  return `<a class="frame-icon" href="${href}">
    <img src="${href}" alt="${escapeAttr(`${kind} ${event.label}`)}">
    <span>${escapeHtml(kind)} · ${escapeHtml(event.label)}</span>
  </a>`;
}

function renderFrameLink(frame, outputDir, frameDir, label) {
  return renderRelativeLink(resolve(frameDir, frame.file), outputDir, label);
}

function renderRelativeLink(path, outputDir, label) {
  return `<a href="${toRelativeUrl(path, outputDir)}">${escapeHtml(label)}</a>`;
}

function selectSampleFrames(frames, events) {
  if (!frames.length) {
    return [];
  }
  const bySecond = new Map(frames.map((frame) => [Math.round(frame.second), frame]));
  const selected = new Map();
  for (const event of events) {
    const frame = findFrameAtSecond(frames, event.second);
    if (frame) {
      selected.set(frame.file, frame);
    }
  }
  if (!selected.size) {
    const seconds = [
      0,
      Math.round(frames.at(-1).second * 0.25),
      Math.round(frames.at(-1).second * 0.5),
      Math.round(frames.at(-1).second * 0.75),
      Math.round(frames.at(-1).second),
    ];
    for (const second of seconds) {
      const frame = bySecond.get(second) ?? findFrameAtSecond(frames, second);
      if (frame) {
        selected.set(frame.file, frame);
      }
    }
  }
  return [...selected.values()].slice(0, 12);
}

function findFrameAtSecond(frames, second) {
  if (!frames.length || !Number.isFinite(Number(second))) {
    return null;
  }
  const target = Number(second);
  return frames.reduce((best, frame) => {
    if (!best) {
      return frame;
    }
    return Math.abs(frame.second - target) < Math.abs(best.second - target) ? frame : best;
  }, null);
}

function loadVideoManifest(frameDir) {
  const manifestPath = join(frameDir, "manifest.json");
  return loadJsonIfExists(manifestPath);
}

function loadJsonIfExists(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function sumAcceptedCounts(counts) {
  return Object.values(counts ?? {}).reduce((sum, count) => sum + Number(count || 0), 0);
}

function formatNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return escapeHtml(String(value ?? "-"));
  }
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 }).format(value);
}

function formatTime(second) {
  if (!Number.isFinite(Number(second))) {
    return "-";
  }
  const roundedSecond = Math.max(0, Math.round(Number(second)));
  const minutes = Math.floor(roundedSecond / 60);
  const seconds = roundedSecond % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function toRelativeUrl(path, outputDir) {
  return relative(outputDir, path)
    .split("/")
    .join("/")
    .split("\\")
    .join("/")
    .split("/")
    .map((part) => part === ".." ? part : encodeURIComponent(part))
    .join("/");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function printUsage() {
  console.log(`Usage:
  node scripts/render-buff-expiry-video-events-html.mjs <buff-expiry-video-events.json> [output.html]
`);
}
