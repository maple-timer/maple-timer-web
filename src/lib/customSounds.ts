import type { AlertSound } from "./sounds";
import {
  createCustomAlertSoundId,
  getCustomAlertSoundRecordId,
  isCustomAlertSoundId,
} from "./customSoundIds";

const CUSTOM_SOUNDS_DB_NAME = "maple-timer.custom-sounds";
const CUSTOM_SOUNDS_DB_VERSION = 1;
const CUSTOM_SOUNDS_STORE = "sounds";

export const MAX_CUSTOM_SOUND_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_CUSTOM_SOUND_TRIM_MS = 15_000;
export const MIN_CUSTOM_SOUND_TRIM_MS = 500;

const ALLOWED_CUSTOM_SOUND_EXTENSIONS = new Set(["mp3", "m4a", "mp4", "wav", "ogg"]);
const ALLOWED_CUSTOM_SOUND_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/ogg",
]);

export type CustomAlertSoundMetadata = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
  createdAt: string;
  updatedAt: string;
};

export type CustomAlertSoundRecord = CustomAlertSoundMetadata & {
  blob: Blob;
};

export type CustomSoundTrim = {
  trimStartMs: number;
  trimEndMs: number;
};

export type SaveCustomAlertSoundInput = {
  blob: Blob;
  fileName?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
};

type CustomSoundsDbRecord = CustomAlertSoundRecord;

let dbPromise: Promise<IDBDatabase> | null = null;

export { createCustomAlertSoundId, getCustomAlertSoundRecordId, isCustomAlertSoundId };

export function validateCustomSoundFile(file: File): string | null {
  if (file.size > MAX_CUSTOM_SOUND_FILE_SIZE_BYTES) {
    return "알림음 파일은 5MB 이하만 업로드할 수 있습니다.";
  }

  const extension = getFileExtension(file.name);
  const hasAllowedType = file.type ? ALLOWED_CUSTOM_SOUND_MIME_TYPES.has(file.type) : false;
  const hasAllowedExtension = extension ? ALLOWED_CUSTOM_SOUND_EXTENSIONS.has(extension) : false;

  if (!hasAllowedType && !hasAllowedExtension) {
    return "mp3, m4a, wav, ogg 파일만 업로드할 수 있습니다.";
  }

  return null;
}

export function normalizeCustomSoundName(name: unknown, fileName?: string): string {
  const candidate = typeof name === "string" ? name.trim() : "";
  if (candidate) {
    return candidate.slice(0, 60);
  }

  const baseName = fileName ? fileName.replace(/\.[^/.]+$/, "").trim() : "";
  return (baseName || "내 알림음").slice(0, 60);
}

export function normalizeCustomSoundTrim(
  durationMs: number,
  trimStartMs: unknown,
  trimEndMs: unknown,
): CustomSoundTrim {
  const safeDurationMs = Math.max(MIN_CUSTOM_SOUND_TRIM_MS, Math.round(durationMs));
  const maxEndMs = safeDurationMs;
  const rawStart = Number(trimStartMs);
  const rawEnd = Number(trimEndMs);
  let start = Number.isFinite(rawStart) ? Math.round(rawStart) : 0;
  let end = Number.isFinite(rawEnd) ? Math.round(rawEnd) : Math.min(maxEndMs, MAX_CUSTOM_SOUND_TRIM_MS);

  start = Math.max(0, Math.min(start, Math.max(0, maxEndMs - MIN_CUSTOM_SOUND_TRIM_MS)));
  end = Math.max(start + MIN_CUSTOM_SOUND_TRIM_MS, Math.min(end, maxEndMs));

  if (end - start > MAX_CUSTOM_SOUND_TRIM_MS) {
    end = Math.min(maxEndMs, start + MAX_CUSTOM_SOUND_TRIM_MS);
    if (end - start > MAX_CUSTOM_SOUND_TRIM_MS) {
      start = Math.max(0, end - MAX_CUSTOM_SOUND_TRIM_MS);
    }
  }

  return { trimStartMs: start, trimEndMs: end };
}

export function customSoundMetadataToAlertSound(sound: CustomAlertSoundMetadata): AlertSound {
  return {
    id: createCustomAlertSoundId(sound.id),
    label: `[내 알림음] ${sound.name}`,
    src: "",
  };
}

export async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
  const AudioContextConstructor = getAudioContextConstructor();
  if (!AudioContextConstructor) {
    throw new Error("이 브라우저는 알림음 파일 분석을 지원하지 않습니다.");
  }

  const context = new AudioContextConstructor();
  try {
    const buffer = await blob.arrayBuffer();
    return await context.decodeAudioData(buffer.slice(0));
  } catch {
    throw new Error("재생할 수 있는 오디오 파일이 아닙니다.");
  } finally {
    void context.close().catch(() => undefined);
  }
}

export function buildWaveformPeaks(audioBuffer: AudioBuffer, bucketCount = 120): number[] {
  const channelCount = Math.max(1, audioBuffer.numberOfChannels);
  const sampleCount = audioBuffer.length;
  const bucketSize = Math.max(1, Math.floor(sampleCount / bucketCount));
  const peaks: number[] = [];
  let maxPeak = 0;

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const start = bucketIndex * bucketSize;
    const end = Math.min(sampleCount, start + bucketSize);
    let peak = 0;

    for (let channel = 0; channel < channelCount; channel += 1) {
      const data = audioBuffer.getChannelData(channel);
      for (let index = start; index < end; index += 1) {
        peak = Math.max(peak, Math.abs(data[index] ?? 0));
      }
    }

    peaks.push(peak);
    maxPeak = Math.max(maxPeak, peak);
  }

  if (maxPeak <= 0) {
    return peaks.map(() => 0.08);
  }

  return peaks.map((peak) => Math.max(0.08, peak / maxPeak));
}

export async function loadCustomAlertSoundMetadata(): Promise<CustomAlertSoundMetadata[]> {
  const db = await openCustomSoundsDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CUSTOM_SOUNDS_STORE, "readonly");
    const request = transaction.objectStore(CUSTOM_SOUNDS_STORE).getAll();
    request.onerror = () => reject(request.error ?? new Error("사용자 알림음을 읽지 못했습니다."));
    request.onsuccess = () => {
      const records = (request.result as CustomSoundsDbRecord[]).map(stripCustomSoundBlob);
      resolve(records.sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
    };
  });
}

export async function getCustomAlertSoundRecord(
  soundIdOrId: string | null | undefined,
): Promise<CustomAlertSoundRecord | null> {
  const id = getCustomAlertSoundRecordId(soundIdOrId);
  if (!id) {
    return null;
  }

  const db = await openCustomSoundsDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CUSTOM_SOUNDS_STORE, "readonly");
    const request = transaction.objectStore(CUSTOM_SOUNDS_STORE).get(id);
    request.onerror = () => reject(request.error ?? new Error("사용자 알림음을 읽지 못했습니다."));
    request.onsuccess = () => resolve((request.result as CustomAlertSoundRecord | undefined) ?? null);
  });
}

export async function saveCustomAlertSound(
  input: SaveCustomAlertSoundInput,
): Promise<CustomAlertSoundMetadata> {
  const db = await openCustomSoundsDb();
  const now = new Date().toISOString();
  const trim = normalizeCustomSoundTrim(input.durationMs, input.trimStartMs, input.trimEndMs);
  const record: CustomAlertSoundRecord = {
    id: createCustomSoundRecordId(),
    name: normalizeCustomSoundName(input.name, input.fileName),
    mimeType: input.mimeType || input.blob.type || "audio/*",
    size: input.size ?? input.blob.size,
    durationMs: Math.round(input.durationMs),
    trimStartMs: trim.trimStartMs,
    trimEndMs: trim.trimEndMs,
    createdAt: now,
    updatedAt: now,
    blob: input.blob,
  };

  await putCustomSoundRecord(db, record);
  return stripCustomSoundBlob(record);
}

export async function updateCustomAlertSound(
  soundIdOrId: string,
  patch: Partial<Pick<CustomAlertSoundMetadata, "name" | "trimStartMs" | "trimEndMs">>,
): Promise<CustomAlertSoundMetadata> {
  const record = await getCustomAlertSoundRecord(soundIdOrId);
  if (!record) {
    throw new Error("수정할 사용자 알림음을 찾지 못했습니다.");
  }

  const trim = normalizeCustomSoundTrim(
    record.durationMs,
    patch.trimStartMs ?? record.trimStartMs,
    patch.trimEndMs ?? record.trimEndMs,
  );
  const nextRecord: CustomAlertSoundRecord = {
    ...record,
    name: normalizeCustomSoundName(patch.name ?? record.name),
    trimStartMs: trim.trimStartMs,
    trimEndMs: trim.trimEndMs,
    updatedAt: new Date().toISOString(),
  };
  const db = await openCustomSoundsDb();
  await putCustomSoundRecord(db, nextRecord);
  return stripCustomSoundBlob(nextRecord);
}

export async function deleteCustomAlertSound(soundIdOrId: string): Promise<boolean> {
  const id = getCustomAlertSoundRecordId(soundIdOrId);
  if (!id) {
    return false;
  }

  const db = await openCustomSoundsDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CUSTOM_SOUNDS_STORE, "readwrite");
    const request = transaction.objectStore(CUSTOM_SOUNDS_STORE).delete(id);
    request.onerror = () => reject(request.error ?? new Error("사용자 알림음을 삭제하지 못했습니다."));
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("사용자 알림음을 삭제하지 못했습니다."));
  });
}

function putCustomSoundRecord(db: IDBDatabase, record: CustomAlertSoundRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CUSTOM_SOUNDS_STORE, "readwrite");
    const request = transaction.objectStore(CUSTOM_SOUNDS_STORE).put(record);
    request.onerror = () => reject(request.error ?? new Error("사용자 알림음을 저장하지 못했습니다."));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("사용자 알림음을 저장하지 못했습니다."));
  });
}

function openCustomSoundsDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("이 브라우저는 사용자 알림음 저장을 지원하지 않습니다."));
  }

  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(CUSTOM_SOUNDS_DB_NAME, CUSTOM_SOUNDS_DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("사용자 알림음 저장소를 열지 못했습니다."));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CUSTOM_SOUNDS_STORE)) {
        const store = db.createObjectStore(CUSTOM_SOUNDS_STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

  return dbPromise;
}

function stripCustomSoundBlob(record: CustomAlertSoundRecord): CustomAlertSoundMetadata {
  const { blob: _blob, ...metadata } = record;
  return metadata;
}

function getAudioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") {
    return typeof AudioContext === "undefined" ? undefined : AudioContext;
  }

  return (
    window.AudioContext ??
    (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  );
}

function getFileExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index + 1).toLowerCase() : "";
}

function createCustomSoundRecordId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}
