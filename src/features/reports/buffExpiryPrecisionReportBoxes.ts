import type { BuffExpiryBox } from "../../lib/buffExpiry/buffExpiryTypes";

export function serializeBuffExpiryPrecisionParserBox(box: {
  x: number;
  y: number;
  size: number;
  row: number;
  col: number;
  confidence: number;
  score: number;
}) {
  return {
    x: box.x,
    y: box.y,
    size: box.size,
    row: box.row,
    col: box.col,
    confidence: box.confidence,
    score: box.score,
  };
}

export function toBuffExpiryBox(box: {
  x: number;
  y: number;
  size: number;
  row: number;
  col: number;
  confidence: number;
}): BuffExpiryBox {
  return {
    x: box.x,
    y: box.y,
    width: box.size,
    height: box.size,
    confidence: box.confidence,
    side: box.size,
    row: box.row,
    col: box.col,
  };
}

export function serializeBuffExpiryPrecisionBox(box: {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  side?: number;
  row?: number;
  col?: number;
}) {
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    confidence: box.confidence,
    ...(typeof box.side === "number" ? { side: box.side } : {}),
    ...(typeof box.row === "number" ? { row: box.row } : {}),
    ...(typeof box.col === "number" ? { col: box.col } : {}),
  };
}

export function getBuffExpiryPrecisionBoxKey(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return `${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(box.width)}:${Math.round(box.height)}`;
}
