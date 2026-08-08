import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as ort from "onnxruntime-web/wasm";
import { PNG } from "pngjs";
import {
  createRuntimeSpecialCoreMatcherV2,
  type SpecialCoreDeepV2PolicyArtifact,
  type SpecialCorePositiveGateArtifact,
} from "../src/recognition/special-core/specialCoreDeepV2Runtime";

type FixtureCase = {
  id: string;
  file: string;
  sha256: string;
  expectedKind: "target" | "unknown";
  expectedReason:
    | "base_and_positive_gate_passed"
    | "near_exact_positive_prototype_rescue"
    | "below_base_threshold"
    | "below_positive_gate_threshold";
};

type FixtureManifest = {
  bundleId: string;
  modelVersion: string;
  upstreamCommit: string;
  cases: FixtureCase[];
};

type OrtSessionOptionsWithExternalData = Parameters<typeof ort.InferenceSession.create>[1] & {
  externalData?: readonly { path: string; data: Uint8Array }[];
};

const startedAt = performance.now();
const repoRoot = process.cwd();
const bundleRoot = resolve(repoRoot, "public/models/special-core-deep-v2");
const fixtureRoot = resolve(
  repoRoot,
  "debug-samples/test-resources/special-core/matcher-v2",
);
const policy = await readJson<SpecialCoreDeepV2PolicyArtifact>(
  resolve(bundleRoot, "policy.json"),
);
const gate = await readJson<SpecialCorePositiveGateArtifact>(
  resolve(bundleRoot, policy.files.positiveGate),
);
const manifest = await readJson<FixtureManifest>(resolve(fixtureRoot, "manifest.json"));

assert.equal(policy.bundleId, manifest.bundleId);
assert.equal(policy.modelVersion, manifest.modelVersion);
assert.equal(gate.targetId, "specialCore");

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

const modelBytes = new Uint8Array(await readFile(resolve(bundleRoot, policy.files.onnx)));
const externalDataBytes = new Uint8Array(
  await readFile(resolve(bundleRoot, policy.files.onnxData)),
);
const session = await ort.InferenceSession.create(modelBytes, {
  executionProviders: ["wasm"],
  graphOptimizationLevel: "all",
  externalData: [{ path: policy.files.onnxData, data: externalDataBytes }],
} as OrtSessionOptionsWithExternalData);

let inferenceCalls = 0;
try {
  const matcher = createRuntimeSpecialCoreMatcherV2({
    policy,
    positiveGate: gate,
    runInference: async (request) => {
      inferenceCalls += 1;
      const input = new ort.Tensor("float32", request.data, request.dims);
      let outputs: Awaited<ReturnType<typeof session.run>> | null = null;
      try {
        outputs = await session.run({ [session.inputNames[0] ?? "input"]: input });
        const logits = outputs[request.logitsOutputName]?.data;
        const embedding = outputs[request.embeddingOutputName]?.data;
        assert.ok(logits instanceof Float32Array, "special-core audit logits missing");
        assert.ok(embedding instanceof Float32Array, "special-core audit embedding missing");
        return {
          logits: Float32Array.from(logits),
          embedding: Float32Array.from(embedding),
        };
      } finally {
        input.dispose();
        Object.values(outputs ?? {}).forEach((tensor) => tensor.dispose());
      }
    },
  });
  const images = await Promise.all(
    manifest.cases.map(async (fixture) => {
      const bytes = await readFile(resolve(fixtureRoot, fixture.file));
      assert.equal(sha256(bytes), fixture.sha256, `${fixture.id} fixture hash mismatch`);
      const png = PNG.sync.read(bytes);
      assert.equal(png.width, 32, `${fixture.id} width mismatch`);
      assert.equal(png.height, 32, `${fixture.id} height mismatch`);
      return {
        width: png.width,
        height: png.height,
        data: new Uint8ClampedArray(png.data),
      };
    }),
  );
  const results = await matcher.matchBatch(images);
  assert.equal(inferenceCalls, 1, "special-core audit must batch all fixtures");
  manifest.cases.forEach((fixture, index) => {
    const identity = results[index]?.identity;
    assert.ok(identity, `${fixture.id} result missing`);
    assert.equal(identity.kind, fixture.expectedKind, `${fixture.id} identity mismatch`);
    assert.equal(
      identity.decisionReason,
      fixture.expectedReason,
      `${fixture.id} decision mismatch`,
    );
    assert.equal(identity.bundleId, manifest.bundleId);
    assert.equal(identity.modelVersion, manifest.modelVersion);
  });

  console.log(JSON.stringify({
    ok: true,
    bundleId: manifest.bundleId,
    modelVersion: manifest.modelVersion,
    upstreamCommit: manifest.upstreamCommit,
    fixtureCount: manifest.cases.length,
    inferenceCalls,
    elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
    decisions: manifest.cases.map((fixture, index) => ({
      id: fixture.id,
      kind: results[index]?.identity.kind,
      reason: results[index]?.identity.decisionReason,
      score: round(results[index]?.identity.score),
      gateScore: round(results[index]?.identity.gateScore),
    })),
  }, null, 2));
} finally {
  await session.release();
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function round(value: number | undefined): number | null {
  return value === undefined ? null : Math.round(value * 1000) / 1000;
}
