import { detectBuffs } from "./detector/detect-buffs.js?v=real-evidence-game-rect-10";

const SAMPLE_ROOT = "./test_cases/images";
const SAMPLE_FILES = [
  "3__static_001_스크린샷_2026-05-14_224642.png",
  "3__static_002_스크린샷_2026-05-14_224652.png",
  "3__static_003_스크린샷_2026-05-14_224701.png",
  "3__static_004_스크린샷_2026-05-14_224708.png",
  "3__static_005_스크린샷_2026-05-14_224715.png",
  "3__static_006_스크린샷_2026-05-14_224721.png",
  "3__static_007_스크린샷_2026-05-14_224728.png",
  "3__static_008_스크린샷_2026-05-14_224742.png",
  "3__static_009_스크린샷_2026-05-14_224750.png",
  "3__static_010_스크린샷_2026-05-14_224757.png",
  "3__static_011_스크린샷_2026-05-14_224803.png",
  "3__static_012_스크린샷_2026-05-14_224809.png",
  "3__static_013_스크린샷_2026-05-14_224820.png",
  "3__static_014_스크린샷_2026-05-14_224827.png",
  "3__static_015_스크린샷_2026-05-14_224834.png",
  "3__static_016_스크린샷_2026-05-14_224842.png",
  "3__static_017_스크린샷_2026-05-14_224847.png",
  "3__static_018_스크린샷_2026-05-14_224853.png",
  "3__static_019_스크린샷_2026-05-14_224917.png",
  "3__static_020_스크린샷_2026-05-14_224923.png",
  "3__static_021_스크린샷_2026-05-14_224927.png",
  "3__static_022_스크린샷_2026-05-14_224944.png",
  "3__static_023_스크린샷_2026-05-14_224955.png",
  "3__static_024_스크린샷_2026-05-14_225000.png",
  "3__static_025_스크린샷_2026-05-14_225120.png",
  "3__static_026_스크린샷_2026-05-14_225127.png",
  "3__static_027_스크린샷_2026-05-14_225132.png",
];

const elements = {
  startShareBtn: document.querySelector("#startShareBtn"),
  stopShareBtn: document.querySelector("#stopShareBtn"),
  imageInput: document.querySelector("#imageInput"),
  runSamplesBtn: document.querySelector("#runSamplesBtn"),
  debugToggle: document.querySelector("#debugToggle"),
  statusText: document.querySelector("#statusText"),
  countText: document.querySelector("#countText"),
  rowsText: document.querySelector("#rowsText"),
  sideText: document.querySelector("#sideText"),
  candidateText: document.querySelector("#candidateText"),
  timeText: document.querySelector("#timeText"),
  frameCanvas: document.querySelector("#frameCanvas"),
  overlayCanvas: document.querySelector("#overlayCanvas"),
  shareVideo: document.querySelector("#shareVideo"),
  emptyState: document.querySelector("#emptyState"),
  cropList: document.querySelector("#cropList"),
  cropMeta: document.querySelector("#cropMeta"),
  sampleResults: document.querySelector("#sampleResults"),
  sampleGallery: document.querySelector("#sampleGallery"),
};

const frameContext = elements.frameCanvas.getContext("2d", { willReadFrequently: true });
const overlayContext = elements.overlayCanvas.getContext("2d");
let shareStream = null;
let shareTimer = null;

elements.startShareBtn.addEventListener("click", startScreenShare);
elements.stopShareBtn.addEventListener("click", stopScreenShare);
elements.imageInput.addEventListener("change", handleImageUpload);
elements.runSamplesBtn.addEventListener("click", runSampleBatch);
elements.debugToggle.addEventListener("change", () => redrawCurrentOverlay());
window.addEventListener("resize", syncOverlayCss);

let lastResult = null;
renderSampleGallery();

window.mapleBuffApp = {
  runSample: async (fileName) => {
    const image = await loadImage(`${SAMPLE_ROOT}/${fileName}`);
    drawSourceToFrame(image, image.naturalWidth, image.naturalHeight);
    return processCurrentFrame(fileName);
  },
  getLastResult: () => lastResult,
};

async function startScreenShare() {
  stopScreenShare();
  setStatus("화면공유 요청 중");
  shareStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  elements.shareVideo.srcObject = shareStream;
  await elements.shareVideo.play();
  elements.startShareBtn.disabled = true;
  elements.stopShareBtn.disabled = false;
  setStatus("화면공유 처리 중");
  await processVideoFrame();
  shareTimer = window.setInterval(processVideoFrame, 1000);
}

function stopScreenShare() {
  if (shareTimer) {
    window.clearInterval(shareTimer);
    shareTimer = null;
  }
  if (shareStream) {
    for (const track of shareStream.getTracks()) {
      track.stop();
    }
    shareStream = null;
  }
  elements.startShareBtn.disabled = false;
  elements.stopShareBtn.disabled = true;
  setStatus("대기 중");
}

async function processVideoFrame() {
  const video = elements.shareVideo;
  if (!video.videoWidth || !video.videoHeight) return;
  drawSourceToFrame(video, video.videoWidth, video.videoHeight);
  processCurrentFrame("화면공유");
}

async function handleImageUpload(event) {
  stopScreenShare();
  const files = [...event.target.files];
  if (!files.length) return;
  elements.sampleResults.innerHTML = "";
  for (const file of files) {
    const image = await loadImage(URL.createObjectURL(file));
    drawSourceToFrame(image, image.naturalWidth, image.naturalHeight);
    processCurrentFrame(file.name);
  }
}

async function runSampleBatch() {
  stopScreenShare();
  elements.runSamplesBtn.disabled = true;
  elements.sampleResults.innerHTML = "";
  setStatus("샘플 실행 중");
  let pass = 0;

  for (const fileName of SAMPLE_FILES) {
    const image = await loadImage(`${SAMPLE_ROOT}/${fileName}`);
    drawSourceToFrame(image, image.naturalWidth, image.naturalHeight);
    const result = processCurrentFrame(fileName);
    const expected = 3;
    const ok = result.boxes.length === expected;
    if (ok) pass += 1;
    appendSampleResult(fileName, result, expected, ok);
    await nextFrame();
  }

  setStatus(`샘플 완료 ${pass}/${SAMPLE_FILES.length}`);
  elements.runSamplesBtn.disabled = false;
}

async function loadSampleByName(fileName) {
  stopScreenShare();
  const image = await loadImage(`${SAMPLE_ROOT}/${encodeURIComponent(fileName)}`);
  drawSourceToFrame(image, image.naturalWidth, image.naturalHeight);
  processCurrentFrame(fileName);
}

function processCurrentFrame(label) {
  const imageData = frameContext.getImageData(0, 0, elements.frameCanvas.width, elements.frameCanvas.height);
  const result = detectBuffs(imageData);
  lastResult = result;
  renderOverlay(result);
  renderCrops(result.boxes);
  renderStats(result, label);
  return result;
}

function drawSourceToFrame(source, width, height) {
  elements.frameCanvas.width = width;
  elements.frameCanvas.height = height;
  elements.overlayCanvas.width = width;
  elements.overlayCanvas.height = height;
  frameContext.clearRect(0, 0, width, height);
  frameContext.drawImage(source, 0, 0, width, height);
  elements.emptyState.hidden = true;
  syncOverlayCss();
}

function redrawCurrentOverlay() {
  if (lastResult) {
    renderOverlay(lastResult);
  }
}

function renderOverlay(result) {
  const canvas = elements.overlayCanvas;
  overlayContext.clearRect(0, 0, canvas.width, canvas.height);

  if (elements.debugToggle.checked) {
    overlayContext.save();
    overlayContext.strokeStyle = "rgba(255, 210, 85, 0.95)";
    overlayContext.lineWidth = Math.max(1, canvas.width / 1400);
    overlayContext.setLineDash([8, 6]);
    if (!result.unsupported) {
      strokeInside(overlayContext, result.roi);
    }
    overlayContext.setLineDash([]);
    overlayContext.strokeStyle = "rgba(85, 160, 255, 0.45)";
    for (const candidate of result.candidates) {
      strokeInside(overlayContext, candidate);
    }
    overlayContext.restore();
  }

  overlayContext.save();
  overlayContext.strokeStyle = "#58ff4c";
  overlayContext.lineWidth = 1;
  overlayContext.font = `${Math.max(11, Math.round(canvas.width / 140))}px ui-sans-serif`;
  overlayContext.textBaseline = "top";

  for (const box of result.boxes) {
    strokeInside(overlayContext, box);
    overlayContext.fillStyle = "#b7ff8d";
    overlayContext.fillText(`${box.row + 1}:${box.col + 1}`, box.x, Math.max(0, box.y - 14));
  }
  overlayContext.restore();
}

function strokeInside(context, rect) {
  context.strokeRect(
    Math.round(rect.x) + 0.5,
    Math.round(rect.y) + 0.5,
    Math.max(0, Math.round(rect.width) - 1),
    Math.max(0, Math.round(rect.height) - 1),
  );
}

function renderCrops(boxes) {
  elements.cropList.innerHTML = "";
  elements.cropMeta.textContent = `${boxes.length} items`;

  for (const box of boxes) {
    const item = document.createElement("div");
    item.className = "crop-item";
    const crop = document.createElement("canvas");
    crop.width = box.width;
    crop.height = box.height;
    crop.getContext("2d").drawImage(
      elements.frameCanvas,
      box.x,
      box.y,
      box.width,
      box.height,
      0,
      0,
      box.width,
      box.height,
    );
    const label = document.createElement("span");
    label.textContent = `r${box.row + 1} c${box.col + 1}`;
    item.append(crop, label);
    elements.cropList.append(item);
  }
}

function renderStats(result, label) {
  elements.statusText.textContent = result.unsupported ? `${label} - 지원하지 않는 해상도` : label;
  elements.countText.textContent = String(result.boxes.length);
  elements.rowsText.textContent = result.rowCounts.length ? result.rowCounts.join(" / ") : "-";
  elements.sideText.textContent = result.inferredSide ?? "-";
  elements.candidateText.textContent = String(result.candidates.length);
  elements.timeText.textContent = `${result.elapsedMs}ms`;
  document.body.dataset.lastDetection = JSON.stringify({
    boxes: result.boxes,
    candidates: result.candidates
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 80)
      .map((candidate) => ({
        x: candidate.x,
        y: candidate.y,
        side: candidate.side,
        score: Math.round(candidate.score * 1000) / 1000,
      })),
    rowCounts: result.rowCounts,
    inferredSide: result.inferredSide,
    candidateCount: result.candidates.length,
    unsupported: result.unsupported,
    unsupportedReason: result.unsupportedReason,
    clusters: result.debug?.sizeClusters ?? [],
    calibration: result.debug?.calibration ?? null,
  });
}

function appendSampleResult(fileName, result, expected, ok) {
  const row = document.createElement("div");
  row.className = `sample-row ${ok ? "ok" : "fail"}`;
  row.tabIndex = 0;
  row.role = "button";
  row.title = "이 샘플 다시 실행";
  row.addEventListener("click", () => loadSampleByName(fileName));
  const name = document.createElement("strong");
  name.textContent = fileName;
  const detail = document.createElement("span");
  detail.textContent = `${result.boxes.length}/${expected} | ${result.rowCounts.join(" / ") || "-"}`;
  row.append(name, detail);
  elements.sampleResults.append(row);
}

function renderSampleGallery() {
  elements.sampleGallery.innerHTML = "";
  for (const [index, fileName] of SAMPLE_FILES.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gallery-item";
    button.title = fileName;
    button.addEventListener("click", () => loadSampleByName(fileName));

    const image = document.createElement("img");
    image.loading = "lazy";
    image.alt = fileName;
    image.src = `${SAMPLE_ROOT}/${encodeURIComponent(fileName)}`;

    const label = document.createElement("span");
    label.textContent = `${String(index + 1).padStart(2, "0")} ${fileName}`;
    button.append(image, label);
    elements.sampleGallery.append(button);
  }
}

function syncOverlayCss() {
  const frameRect = elements.frameCanvas.getBoundingClientRect();
  const stageRect = elements.frameCanvas.parentElement.getBoundingClientRect();
  Object.assign(elements.overlayCanvas.style, {
    left: `${frameRect.left - stageRect.left}px`,
    top: `${frameRect.top - stageRect.top}px`,
    width: `${frameRect.width}px`,
    height: `${frameRect.height}px`,
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function setStatus(message) {
  elements.statusText.textContent = message;
}
