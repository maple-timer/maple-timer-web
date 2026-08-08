export function sanitizeDebugSampleFileName(value, fallback = "image") {
  const sanitized = String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return sanitized || fallback;
}

export function textToBytes(value) {
  return new TextEncoder().encode(String(value));
}

export function extensionFromContentType(contentType) {
  const normalized = String(contentType || "").toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("svg")) return "svg";
  return "";
}

export function extensionFromDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:image\/([^;,]+)/i);
  const type = match?.[1]?.toLowerCase();
  if (type === "jpeg") return "jpg";
  if (type === "svg+xml") return "svg";
  return type || "png";
}

export function inferImageExtension(src) {
  const match = String(src || "").match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
  const extension = match?.[1]?.toLowerCase();
  if (!extension) return "";
  if (extension === "jpeg") return "jpg";
  return ["png", "jpg", "webp", "gif", "svg"].includes(extension)
    ? extension
    : "";
}

export function readDataUrlBytes(dataUrl) {
  return decodeDataUrl(dataUrl).bytes;
}

export function decodeDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) {
    throw new Error("잘못된 data URL입니다.");
  }

  const contentType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || "";

  if (isBase64) {
    const binary = atob(payload.replace(/\s/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return {
      bytes,
      contentType,
      extension: extensionFromContentType(contentType),
    };
  }

  return {
    bytes: textToBytes(decodeURIComponent(payload)),
    contentType,
    extension: extensionFromContentType(contentType),
  };
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function getDosTimestamp(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { dosTime, dosDate };
}

export function createZipBlob(files, options = {}) {
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;
  const { dosTime, dosDate } = getDosTimestamp(options.now || new Date());

  for (const file of files) {
    const nameBytes = textToBytes(file.name);
    const data =
      file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
    const fileCrc = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, fileCrc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);
    chunks.push(localHeader, data);

    centralDirectory.push({
      nameBytes,
      crc: fileCrc,
      size: data.length,
      offset,
      dosTime,
      dosDate,
    });
    offset += localHeader.length + data.length;
  }

  const centralStart = offset;
  for (const entry of centralDirectory) {
    const header = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, entry.dosTime, true);
    view.setUint16(14, entry.dosDate, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.size, true);
    view.setUint32(24, entry.size, true);
    view.setUint16(28, entry.nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, entry.offset, true);
    header.set(entry.nameBytes, 46);
    chunks.push(header);
    offset += header.length;
  }

  const centralSize = offset - centralStart;
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, centralDirectory.length, true);
  endView.setUint16(10, centralDirectory.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralStart, true);
  endView.setUint16(20, 0, true);
  chunks.push(end);

  return new Blob(chunks, { type: "application/zip" });
}
