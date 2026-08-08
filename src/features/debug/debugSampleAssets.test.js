import { describe, expect, it } from "vitest";

import {
  createZipBlob,
  crc32,
  decodeDataUrl,
  extensionFromContentType,
  extensionFromDataUrl,
  inferImageExtension,
  readDataUrlBytes,
  sanitizeDebugSampleFileName,
  textToBytes,
} from "../../../public/debug-tools/debug-sample-assets.mjs";

async function readBlobBytes(blob) {
  if (typeof blob.arrayBuffer === "function") {
    return new Uint8Array(await blob.arrayBuffer());
  }
  if (typeof FileReader !== "undefined") {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }
  throw new Error("Blob byte reading is unavailable in this test environment.");
}

describe("debug sample browser asset utilities", () => {
  it("sanitizes filenames without losing a fallback", () => {
    expect(sanitizeDebugSampleFileName("최근 알림: 유니온/부?.png")).toBe(
      "최근-알림-유니온-부-.png",
    );
    expect(sanitizeDebugSampleFileName("   ")).toBe("image");
  });

  it("infers common image extensions from content type, data URL, and URL", () => {
    expect(extensionFromContentType("image/jpeg")).toBe("jpg");
    expect(extensionFromDataUrl("data:image/svg+xml,%3Csvg%3E%3C/svg%3E")).toBe(
      "svg",
    );
    expect(inferImageExtension("https://example.test/a/icon.jpeg?v=1")).toBe(
      "jpg",
    );
  });

  it("decodes base64 and percent-encoded data URLs", () => {
    expect(Array.from(readDataUrlBytes("data:text/plain;base64,SGk="))).toEqual([
      72, 105,
    ]);

    const decoded = decodeDataUrl("data:image/svg+xml,%3Csvg%3E%3C/svg%3E");
    expect(decoded.extension).toBe("svg");
    expect(decoded.bytes.length).toBeGreaterThan(0);
  });

  it("creates a minimal zip blob with local and central directory records", async () => {
    const blob = createZipBlob(
      [
        { name: "sample.json", bytes: textToBytes("{}") },
        { name: "manifest.txt", bytes: textToBytes("images: 0") },
      ],
      { now: new Date("2026-06-10T00:00:00Z") },
    );
    const bytes = await readBlobBytes(blob);
    const view = new DataView(bytes.buffer);

    expect(blob.type).toBe("application/zip");
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
  });

  it("keeps CRC32 compatible with zip records", () => {
    expect(crc32(textToBytes("123456789"))).toBe(0xcbf43926);
  });
});
