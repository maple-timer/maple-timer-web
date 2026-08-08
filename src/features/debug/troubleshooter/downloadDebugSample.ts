import type { TroubleshooterViewModel } from "./model";
import {
  createZipBlob,
  decodeDataUrl,
  sanitizeDebugSampleFileName,
  textToBytes,
} from "./debugSampleArchive";

export async function downloadDebugSampleBundle(view: TroubleshooterViewModel) {
  const images = collectImageDataUrls(view.rawSample);
  const files: Array<{ name: string; bytes: Uint8Array }> = [
    {
      name: "sample.json",
      bytes: textToBytes(JSON.stringify(view.rawSample, null, 2)),
    },
  ];
  const manifest = [
    "Maple Timer debug sample",
    `sample: ${view.metadata.sampleId}`,
    `feature: ${view.feature}`,
    `images: ${images.length}`,
    "",
  ];

  images.forEach((image, index) => {
    const decoded = decodeDataUrl(image.src);
    const safePath = sanitizeDebugSampleFileName(image.path, `image-${index + 1}`);
    const fileName = `images/${String(index + 1).padStart(2, "0")}-${safePath}.${decoded.extension || "png"}`;
    files.push({ name: fileName, bytes: decoded.bytes });
    manifest.push(fileName, `  payload: ${image.path}`, "");
  });
  files.push({ name: "manifest.txt", bytes: textToBytes(manifest.join("\n")) });

  const blob = createZipBlob(files);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `maple-timer-sample-${sanitizeDebugSampleFileName(view.metadata.sampleId, "sample")}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

function collectImageDataUrls(value: unknown) {
  const images: Array<{ path: string; src: string }> = [];
  const seen = new Set<string>();

  function visit(current: unknown, path: string) {
    if (typeof current === "string" && current.startsWith("data:image/")) {
      if (!seen.has(current)) {
        seen.add(current);
        images.push({ path, src: current });
      }
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}.${index}`));
      return;
    }
    if (!current || typeof current !== "object") return;
    Object.entries(current as Record<string, unknown>).forEach(([key, item]) =>
      visit(item, `${path}.${key}`),
    );
  }

  visit(value, "sample");
  return images;
}
