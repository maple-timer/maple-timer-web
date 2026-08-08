import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const port = 5189;
const videoPaths = process.argv.slice(2);

if (!videoPaths.length) {
  console.error("Usage: node scripts/profile-hunt-stall-videos.mjs <video.mp4> ...");
  process.exit(1);
}

for (const videoPath of videoPaths) {
  if (!existsSync(videoPath)) {
    console.error(`Missing video: ${videoPath}`);
    process.exit(1);
  }
}

function startVite() {
  const child = spawn(
    "npm",
    ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BROWSER: "none" },
    },
  );

  let ready = false;
  const readyPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for Vite dev server"));
    }, 20_000);

    const handleOutput = (chunk) => {
      const text = chunk.toString();
      if (text.includes("Local:") || text.includes(`127.0.0.1:${port}`)) {
        ready = true;
        clearTimeout(timeout);
        resolve();
      }
    };

    child.stdout.on("data", handleOutput);
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      if (text.includes("EADDRINUSE")) {
        clearTimeout(timeout);
        reject(new Error(`Port ${port} is already in use`));
      }
      handleOutput(chunk);
    });
    child.on("exit", (code) => {
      if (!ready) {
        clearTimeout(timeout);
        reject(new Error(`Vite exited before ready: ${code}`));
      }
    });
  });

  return { child, readyPromise };
}

async function loadPlaywrightChromium() {
  const npxRoot = join(homedir(), ".npm", "_npx");
  const candidates = existsSync(npxRoot)
    ? readdirSync(npxRoot)
        .map((dir) => join(npxRoot, dir, "node_modules", "playwright", "index.mjs"))
        .filter((modulePath) => existsSync(modulePath))
        .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
    : [];

  const [modulePath] = candidates;
  if (!modulePath) {
    throw new Error("Playwright module not found. Run `npx playwright --version` first.");
  }

  const playwright = await import(pathToFileURL(modulePath).href);
  return playwright.chromium;
}

function percentile(values, p) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function avg(values) {
  if (!values.length) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value) {
  return value === null || value === undefined ? null : Math.round(value * 10) / 10;
}

function summarizeSamples(samples) {
  const performanceValues = (key) =>
    samples
      .map((sample) => sample.performance?.[key])
      .filter((value) => typeof value === "number" && Number.isFinite(value));
  const frameDeltas = samples.flatMap((sample) => sample.rafDeltas ?? []);

  return {
    samples: samples.length,
    readable: samples.filter((sample) => sample.recognizedText).length,
    avgTotalMs: round(avg(performanceValues("totalMs"))),
    p95TotalMs: round(percentile(performanceValues("totalMs"), 95)),
    maxTotalMs: round(Math.max(...performanceValues("totalMs"), 0)),
    avgLoopMs: round(avg(performanceValues("loopMs"))),
    p95LoopMs: round(percentile(performanceValues("loopMs"), 95)),
    avgFrameReadMs: round(avg(performanceValues("selectedFrameReadMs"))),
    avgOcrMs: round(avg(performanceValues("selectedOcrMs"))),
    avgBarEstimateMs: round(avg(performanceValues("barEstimateMs"))),
    avgCandidateCount: round(avg(performanceValues("candidateCount"))),
    maxRafDeltaMs: round(Math.max(...frameDeltas, 0)),
  };
}

const { child: vite, readyPromise } = startVite();
let browser;

try {
  await readyPromise;
  const chromium = await loadPlaywrightChromium();
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.setContent(`
    <html>
      <body>
        <input id="video-file" type="file" accept="video/mp4" />
        <video id="video" muted playsinline preload="auto"></video>
      </body>
    </html>
  `);

  const results = [];
  for (const videoPath of videoPaths) {
    await page.setInputFiles("#video-file", videoPath);
    const result = await page.evaluate(async (sampleIntervalSeconds) => {
      const { createHuntStallOcrEngine } = await import("/src/lib/huntStallOcrEngine.ts");
      const input = document.querySelector("#video-file");
      const video = document.querySelector("#video");
      const file = input.files?.[0];
      if (!file) {
        throw new Error("No video file selected");
      }

      const url = URL.createObjectURL(file);
      video.src = url;
      await new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("video metadata timeout")), 15_000);
        video.onloadedmetadata = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        video.onerror = () => {
          window.clearTimeout(timeout);
          reject(new Error("video load failed"));
        };
      });

      const seekTo = (time) =>
        new Promise((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error(`seek timeout at ${time}`)), 15_000);
          video.onseeked = () => {
            window.clearTimeout(timeout);
            resolve();
          };
          video.currentTime = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.05));
        });

      const runRafMonitor = () => {
        const deltas = [];
        let running = true;
        let last = performance.now();
        const tick = (now) => {
          deltas.push(now - last);
          last = now;
          if (running) {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
        return {
          stop: () => {
            running = false;
            return deltas;
          },
        };
      };

      const engine = createHuntStallOcrEngine();
      const samples = [];
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const sampleTimes = [];
      for (let time = 0; time <= duration; time += sampleIntervalSeconds) {
        sampleTimes.push(time);
      }
      if (!sampleTimes.length || sampleTimes[sampleTimes.length - 1] < duration - 0.2) {
        sampleTimes.push(Math.max(0, duration - 0.1));
      }

      for (const time of sampleTimes) {
        await seekTo(time);
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        const raf = runRafMonitor();
        const startedAt = performance.now();
        const sample = await engine.sample(video, false);
        const loopMs = Math.round((performance.now() - startedAt) * 10) / 10;
        const rafDeltas = raf.stop();
        samples.push({
          time: Math.round(time * 10) / 10,
          recognizedText: sample.snapshot.recognizedText,
          confidence: sample.snapshot.confidence,
          foregroundRatio: sample.snapshot.foregroundRatio,
          debugText: sample.snapshot.debugText,
          performance: {
            ...(sample.snapshot.performance ?? {}),
            loopMs,
          },
          rafDeltas,
        });
      }

      URL.revokeObjectURL(url);
      return {
        name: file.name,
        duration,
        width: video.videoWidth,
        height: video.videoHeight,
        samples,
      };
    }, 1);
    results.push(result);
  }

  const report = results.map((result) => ({
    name: result.name,
    durationSeconds: round(result.duration),
    size: `${result.width}x${result.height}`,
    summary: summarizeSamples(result.samples),
    slowestSamples: [...result.samples]
      .sort((a, b) => (b.performance?.loopMs ?? 0) - (a.performance?.loopMs ?? 0))
      .slice(0, 5)
      .map((sample) => ({
        time: sample.time,
        text: sample.recognizedText,
        loopMs: sample.performance?.loopMs ?? null,
        totalMs: sample.performance?.totalMs ?? null,
        frameReadMs: sample.performance?.selectedFrameReadMs ?? null,
        ocrMs: sample.performance?.selectedOcrMs ?? null,
        barMs: sample.performance?.barEstimateMs ?? null,
        candidates: sample.performance?.candidateCount ?? null,
      })),
  }));

  console.log(JSON.stringify(report, null, 2));
} finally {
  if (browser) {
    await browser.close();
  }
  vite.kill("SIGTERM");
}
