#!/usr/bin/env node
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  SUPPORTERS_KV_KEY,
  normalizeSupportersPayload,
} from "../functions/api/_shared/supporters-store.js";

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const inputPath = resolve(args.find((arg) => !arg.startsWith("-")) ?? "data/supporters.json");

async function main() {
  const input = await readInputJson(inputPath);
  const normalized = normalizeSupportersPayload(input);
  if (normalized.error) {
    throw new Error(`Invalid supporters file: ${normalized.error}`);
  }

  const payload = {
    supporters: normalized.supporters,
    updatedAt: new Date().toISOString(),
  };

  if (isDryRun) {
    console.log(JSON.stringify(payload, null, 2));
    console.log(`Dry run: validated ${payload.supporters.length} supporters.`);
    return;
  }

  const tempDir = await mkdtemp(join(tmpdir(), "maple-timer-supporters-"));
  const payloadPath = join(tempDir, "supporters.json");
  await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const result = spawnSync(
    "npx",
    [
      "wrangler",
      "kv",
      "key",
      "put",
      SUPPORTERS_KV_KEY,
      "--binding",
      "SUPPORTERS",
      "--path",
      payloadPath,
      "--remote",
    ],
    {
      cwd: resolve("."),
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    throw new Error(`wrangler kv key put failed with exit code ${result.status}`);
  }

  console.log(`Uploaded ${payload.supporters.length} supporters to ${SUPPORTERS_KV_KEY}.`);
}

async function readInputJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
