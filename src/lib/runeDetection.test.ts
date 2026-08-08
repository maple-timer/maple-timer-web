import { describe, expect, it } from "vitest";
import { passesRuneCandidateFinalGate } from "./runeCandidateGate";
import { detectRuneInMinimap } from "./runeDetection";

function createBlankImage(width = 120, height = 80) {
  const imageData = new ImageData(width, height);
  for (let index = 0; index < imageData.data.length; index += 4) {
    imageData.data[index] = 24;
    imageData.data[index + 1] = 31;
    imageData.data[index + 2] = 38;
    imageData.data[index + 3] = 255;
  }
  return imageData;
}

function createNeutralImage(width = 120, height = 80) {
  const imageData = new ImageData(width, height);
  for (let index = 0; index < imageData.data.length; index += 4) {
    imageData.data[index] = 112;
    imageData.data[index + 1] = 118;
    imageData.data[index + 2] = 124;
    imageData.data[index + 3] = 255;
  }
  return imageData;
}

function setPixel(imageData: ImageData, x: number, y: number, color: [number, number, number]) {
  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) {
    return;
  }
  const index = (y * imageData.width + x) * 4;
  imageData.data[index] = color[0];
  imageData.data[index + 1] = color[1];
  imageData.data[index + 2] = color[2];
  imageData.data[index + 3] = 255;
}

function drawDiamond(
  imageData: ImageData,
  centerX: number,
  centerY: number,
  radius: number,
  color: [number, number, number] = [150, 86, 255],
) {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if (Math.abs(x - centerX) + Math.abs(y - centerY) <= radius) {
        setPixel(imageData, x, y, color);
      }
    }
  }
}

function drawRuneIcon(imageData: ImageData, centerX: number, centerY: number, radius: number) {
  drawDiamond(imageData, centerX, centerY, radius + 3, [206, 204, 218]);
  drawDiamond(imageData, centerX, centerY, radius + 1, [42, 34, 50]);
  drawDiamond(imageData, centerX, centerY, radius, [190, 82, 255]);
}

function drawDownscaledRuneIcon(imageData: ImageData, left: number, top: number) {
  drawDiamond(imageData, left + 3, top + 3, 6, [206, 204, 218]);
  drawDiamond(imageData, left + 3, top + 3, 4, [42, 34, 50]);

  const rowWidths = [3, 4, 6, 5, 2, 1];
  rowWidths.forEach((width, row) => {
    const rowLeft = left + Math.floor((6 - width) / 2);
    for (let x = rowLeft; x < rowLeft + width; x += 1) {
      setPixel(imageData, x, top + row, [190, 82, 255]);
    }
  });
}

function drawBroadShoulderDownscaledRuneIcon(imageData: ImageData, left: number, top: number) {
  drawDiamond(imageData, left + 3, top + 3, 6, [206, 204, 218]);
  drawDiamond(imageData, left + 3, top + 3, 4, [42, 34, 50]);

  const rowWidths = [3, 4, 6, 5, 3, 1];
  rowWidths.forEach((width, row) => {
    const rowLeft = left + Math.floor((6 - width) / 2);
    for (let x = rowLeft; x < rowLeft + width; x += 1) {
      setPixel(imageData, x, top + row, [190, 82, 255]);
    }
  });
}

function drawReportedBroadTopRuneIcon(imageData: ImageData, left: number, top: number) {
  drawDiamond(imageData, left + 5, top + 5, 8, [206, 204, 218]);
  drawDiamond(imageData, left + 5, top + 5, 6, [42, 34, 50]);

  const rowWidths = [4, 5, 9, 9, 10, 9, 8, 5, 4, 3];
  rowWidths.forEach((width, row) => {
    const rowLeft = left + Math.floor((10 - width) / 2);
    for (let x = rowLeft; x < rowLeft + width; x += 1) {
      setPixel(imageData, x, top + row, [190, 82, 255]);
    }
  });
}

function drawPaleRoundedRuneIcon(imageData: ImageData, left: number, top: number) {
  drawDiamond(imageData, left + 6, top + 6, 10, [206, 204, 218]);
  drawDiamond(imageData, left + 6, top + 6, 8, [42, 34, 50]);

  const rowWidths = [3, 3, 7, 9, 10, 13, 13, 13, 10, 9, 7, 5, 3];
  rowWidths.forEach((width, row) => {
    const rowLeft = left + Math.floor((13 - width) / 2);
    for (let x = rowLeft; x < rowLeft + width; x += 1) {
      setPixel(imageData, x, top + row, [255, 174, 254]);
    }
  });
}

function drawCompactRoundedReportedRuneIcon(imageData: ImageData, left: number, top: number) {
  drawDiamond(imageData, left + 5, top + 6, 9, [206, 204, 218]);
  drawDiamond(imageData, left + 5, top + 6, 7, [42, 34, 50]);

  const rowWidths = [1, 2, 6, 5, 9, 10, 10, 9, 5, 6, 2, 1];
  rowWidths.forEach((width, row) => {
    const rowLeft = left + Math.floor((10 - width) / 2);
    for (let x = rowLeft; x < rowLeft + width; x += 1) {
      setPixel(imageData, x, top + row, [190, 82, 255]);
    }
  });
}

function drawCompressedTinyRuneIcon(imageData: ImageData, left: number, top: number) {
  const rowWidths = [4, 6, 6, 6, 6, 6, 2];
  rowWidths.forEach((width, row) => {
    const rowLeft = left + Math.floor((6 - width) / 2);
    for (let x = rowLeft; x < rowLeft + width; x += 1) {
      setPixel(imageData, x, top + row, row < 3 ? [190, 82, 255] : [170, 80, 222]);
    }
  });

  for (let y = top - 2; y <= top + 8; y += 1) {
    for (let x = left - 2; x <= left + 8; x += 1) {
      if (x >= left && x <= left + 5 && y >= top && y <= top + 6) {
        continue;
      }
      const distance = Math.abs(x - (left + 3)) + Math.abs(y - (top + 3));
      if (distance >= 5 && distance <= 7) {
        setPixel(imageData, x, y, [190, 188, 202]);
      }
      if (distance === 8) {
        setPixel(imageData, x, y, [34, 28, 42]);
      }
    }
  }
}

function drawLineAttachedReportedRuneIcon(imageData: ImageData, left: number, top: number) {
  drawReportedBroadTopRuneIcon(imageData, left, top);
  for (let y = top + 13; y <= top + 15; y += 1) {
    for (let x = left - 12; x <= left + 27; x += 1) {
      setPixel(imageData, x, y, [118, 80, 210]);
    }
  }
}

function drawInvertedTriangle(
  imageData: ImageData,
  centerX: number,
  centerY: number,
  radius: number,
  color: [number, number, number],
) {
  for (let y = 0; y <= radius; y += 1) {
    const halfWidth = radius - y;
    for (let x = centerX - halfWidth; x <= centerX + halfWidth; x += 1) {
      setPixel(imageData, x, centerY + y, color);
    }
  }
}

function drawRuneLikeInvertedTriangleIcon(
  imageData: ImageData,
  centerX: number,
  centerY: number,
  radius: number,
) {
  drawInvertedTriangle(imageData, centerX, centerY - 3, radius + 3, [206, 204, 218]);
  drawInvertedTriangle(imageData, centerX, centerY - 1, radius + 1, [42, 34, 50]);
  drawInvertedTriangle(imageData, centerX, centerY, radius, [190, 82, 255]);
}

function drawTinyRuneLikeInvertedTriangleIcon(
  imageData: ImageData,
  left: number,
  top: number,
) {
  drawDiamond(imageData, left + 3, top + 3, 6, [206, 204, 218]);
  drawDiamond(imageData, left + 3, top + 3, 4, [42, 34, 50]);

  const rowWidths = [6, 5, 4, 3, 2, 1];
  rowWidths.forEach((width, row) => {
    const rowLeft = left + Math.floor((6 - width) / 2);
    for (let x = rowLeft; x < rowLeft + width; x += 1) {
      setPixel(imageData, x, top + row, [190, 82, 255]);
    }
  });
}

function drawBroadBottomRuneColoredFragment(imageData: ImageData, left: number, top: number) {
  drawDiamond(imageData, left + 4, top + 3, 7, [206, 204, 218]);
  drawDiamond(imageData, left + 4, top + 3, 5, [42, 34, 50]);

  const rowWidths = [2, 2, 9, 9, 8, 8, 2];
  rowWidths.forEach((width, row) => {
    const rowLeft = left + Math.floor((9 - width) / 2);
    for (let x = rowLeft; x < rowLeft + width; x += 1) {
      setPixel(imageData, x, top + row, [190, 82, 255]);
    }
  });
}

function drawLowerOutlinedRuneColoredFragment(imageData: ImageData, left: number, top: number) {
  const rowWidths = [3, 4, 6, 5, 3, 1];
  rowWidths.forEach((width, row) => {
    const rowLeft = left + Math.floor((6 - width) / 2);
    for (let x = rowLeft; x < rowLeft + width; x += 1) {
      setPixel(imageData, x, top + row, [190, 82, 255]);
    }
  });

  for (let y = top + 3; y <= top + 8; y += 1) {
    for (let x = left - 2; x <= left + 7; x += 1) {
      if (y > top + 5 || x <= left || x >= left + 5) {
        setPixel(imageData, x, y, [206, 204, 218]);
      }
    }
  }

  drawDiamond(imageData, left + 3, top + 3, 4, [42, 34, 50]);
  rowWidths.forEach((width, row) => {
    const rowLeft = left + Math.floor((6 - width) / 2);
    for (let x = rowLeft; x < rowLeft + width; x += 1) {
      setPixel(imageData, x, top + row, [190, 82, 255]);
    }
  });
}

function drawWideRuneColoredFragment(imageData: ImageData, left: number, top: number) {
  const lightRows = [7, 11, 15, 19, 21, 19, 15, 11, 7];
  const darkRows = [5, 9, 13, 17, 19, 17, 13, 9, 5];
  const coreRows = [5, 9, 13, 15, 15, 15, 13, 9, 5];

  lightRows.forEach((width, row) => {
    const rowLeft = left + Math.floor((21 - width) / 2);
    for (let x = rowLeft; x < rowLeft + width; x += 1) {
      setPixel(imageData, x, top + row, [206, 204, 218]);
    }
  });
  darkRows.forEach((width, row) => {
    const rowLeft = left + Math.floor((21 - width) / 2);
    for (let x = rowLeft; x < rowLeft + width; x += 1) {
      setPixel(imageData, x, top + row, [42, 34, 50]);
    }
  });
  coreRows.forEach((width, row) => {
    const rowLeft = left + 3 + Math.floor((15 - width) / 2);
    for (let x = rowLeft; x < rowLeft + width; x += 1) {
      setPixel(imageData, x, top + row, [190, 82, 255]);
    }
  });
}

function drawCompactLightOutlinedRuneForGate(imageData: ImageData, centerX: number, centerY: number) {
  for (let y = centerY - 7; y <= centerY + 7; y += 1) {
    for (let x = centerX - 7; x <= centerX + 7; x += 1) {
      const distance = Math.abs(x - centerX) + Math.abs(y - centerY);
      if (distance <= 5) {
        setPixel(imageData, x, y, [190, 82, 255]);
      } else if (distance <= 7) {
        setPixel(imageData, x, y, [206, 204, 218]);
      }
    }
  }

  [
    [centerX - 6, centerY],
    [centerX - 6, centerY - 1],
    [centerX + 6, centerY],
    [centerX + 6, centerY + 1],
    [centerX, centerY - 6],
    [centerX - 1, centerY - 5],
  ].forEach(([x, y]) => setPixel(imageData, x, y, [42, 34, 50]));
}

function drawCompactBrightOutlinedRuneForGate(imageData: ImageData, centerX: number, centerY: number) {
  for (let y = centerY - 7; y <= centerY + 7; y += 1) {
    for (let x = centerX - 7; x <= centerX + 7; x += 1) {
      const distance = Math.abs(x - centerX) + Math.abs(y - centerY);
      if (distance <= 5) {
        setPixel(imageData, x, y, [190, 82, 255]);
      } else if (distance <= 7) {
        setPixel(imageData, x, y, [206, 204, 218]);
      }
    }
  }
}

function drawOneSidedBrightOutlineFragmentForGate(
  imageData: ImageData,
  centerX: number,
  centerY: number,
) {
  for (let y = centerY - 7; y <= centerY + 7; y += 1) {
    for (let x = centerX - 7; x <= centerX + 7; x += 1) {
      const distance = Math.abs(x - centerX) + Math.abs(y - centerY);
      if (distance <= 5) {
        setPixel(imageData, x, y, [190, 82, 255]);
      } else if (distance <= 7 && x <= centerX - 3) {
        setPixel(imageData, x, y, [206, 204, 218]);
      }
    }
  }
}

function drawCircle(
  imageData: ImageData,
  centerX: number,
  centerY: number,
  radius: number,
  color: [number, number, number] = [162, 110, 244],
) {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) {
        setPixel(imageData, x, y, color);
      }
    }
  }
}

describe("runeDetection", () => {
  it("detects a purple outlined rune icon candidate", () => {
    const imageData = createBlankImage();
    drawRuneIcon(imageData, 62, 36, 12);

    const result = detectRuneInMinimap(imageData);

    expect(result.detected).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.58);
    expect(result.candidates[0]).toMatchObject({
      x: 50,
      y: 24,
      width: 25,
      height: 25,
      source: "component",
    });
  });

  it("does not treat small purple guild dots as rune candidates", () => {
    const imageData = createBlankImage();
    drawCircle(imageData, 34, 42, 4);
    drawCircle(imageData, 78, 38, 4);

    const result = detectRuneInMinimap(imageData);

    expect(result.detected).toBe(false);
  });

  it("detects the small minimap-sized rune diamond", () => {
    const imageData = createBlankImage();
    drawRuneIcon(imageData, 62, 36, 4);

    const result = detectRuneInMinimap(imageData);

    expect(result.detected).toBe(true);
    expect(result.candidates[0]).toMatchObject({
      x: 58,
      y: 32,
      width: 9,
      height: 9,
    });
  });

  it("detects a downscaled rune icon whose purple core has a flat top", () => {
    const imageData = createBlankImage();
    drawDownscaledRuneIcon(imageData, 58, 32);

    const result = detectRuneInMinimap(imageData);

    expect(result.detected).toBe(true);
    expect(result.candidates[0]).toMatchObject({
      x: 58,
      y: 32,
      width: 6,
      height: 6,
    });
  });

  it("detects a tiny minimap rune with a broad lower shoulder", () => {
    const imageData = createBlankImage();
    drawBroadShoulderDownscaledRuneIcon(imageData, 58, 32);

    const result = detectRuneInMinimap(imageData);

    expect(result.detected).toBe(true);
    expect(result.candidates[0]).toMatchObject({
      x: 58,
      y: 32,
      width: 6,
      height: 6,
    });
  });

  it("detects a real minimap rune shape with a slightly broad top shoulder", () => {
    const imageData = createBlankImage(275, 111);
    drawReportedBroadTopRuneIcon(imageData, 129, 43);

    const result = detectRuneInMinimap(imageData);

    expect(result.detected).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.58);
    expect(result.candidates[0]).toMatchObject({
      x: 129,
      y: 43,
      width: 10,
      height: 10,
    });
  });

  it("detects a pale magenta minimap rune with a rounded center shoulder", () => {
    const imageData = createBlankImage(358, 144);
    drawPaleRoundedRuneIcon(imageData, 276, 65);

    const result = detectRuneInMinimap(imageData);

    expect(result.detected).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.58);
    expect(result.candidates[0]).toMatchObject({
      x: 276,
      y: 65,
      width: 13,
      height: 13,
    });
  });

  it("detects a compact rounded minimap rune from feedback", () => {
    const imageData = createBlankImage(283, 125);
    drawCompactRoundedReportedRuneIcon(imageData, 183, 40);

    const result = detectRuneInMinimap(imageData);

    expect(result.detected).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.58);
    expect(result.candidates[0]).toMatchObject({
      x: 183,
      y: 40,
      width: 10,
      height: 12,
    });
  });

  it("detects a compressed tiny rune with preserved outline context", () => {
    const imageData = createBlankImage(171, 109);
    drawCompressedTinyRuneIcon(imageData, 74, 64);

    const result = detectRuneInMinimap(imageData);

    expect(result.detected).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.58);
  });

  it("rescues a rune when purple minimap lines are attached below it", () => {
    const imageData = createBlankImage(272, 135);
    drawLineAttachedReportedRuneIcon(imageData, 128, 43);

    const result = detectRuneInMinimap(imageData);

    expect(result.detected).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.58);
    expect(result.candidates[0]).toMatchObject({
      x: 128,
      y: 43,
      width: 10,
      height: 10,
    });
  });

  it("rejects a bright purple diamond without the rune outline layers", () => {
    const imageData = createBlankImage();
    drawDiamond(imageData, 62, 36, 4, [190, 82, 255]);

    const result = detectRuneInMinimap(imageData);

    expect(result.detected).toBe(false);
  });

  it("accepts compact high-confidence runes with full light outline support", () => {
    const imageData = createBlankImage();
    drawCompactLightOutlinedRuneForGate(imageData, 65, 45);

    expect(
      passesRuneCandidateFinalGate(imageData, {
        x: 60,
        y: 40,
        width: 11,
        height: 11,
        pixelCount: 61,
        confidence: 0.99,
        cnnScore: 0.99,
      }),
    ).toBe(true);
  });

  it("accepts compact very high-confidence runes with balanced bright outline support", () => {
    const imageData = createNeutralImage();
    drawCompactBrightOutlinedRuneForGate(imageData, 65, 45);

    expect(
      passesRuneCandidateFinalGate(imageData, {
        x: 60,
        y: 40,
        width: 11,
        height: 11,
        pixelCount: 61,
        confidence: 0.999,
        cnnScore: 0.999,
      }),
    ).toBe(true);
  });

  it("rejects compact bright outline fragments without a balanced outer ring", () => {
    const imageData = createNeutralImage();
    drawOneSidedBrightOutlineFragmentForGate(imageData, 65, 45);

    expect(
      passesRuneCandidateFinalGate(imageData, {
        x: 60,
        y: 40,
        width: 11,
        height: 11,
        pixelCount: 61,
        confidence: 0.999,
        cnnScore: 0.999,
      }),
    ).toBe(false);
  });

  it("rejects rune-colored inverted triangle icons", () => {
    const imageData = createBlankImage();
    drawRuneLikeInvertedTriangleIcon(imageData, 62, 34, 7);

    const result = detectRuneInMinimap(imageData);

    expect(result.detected).toBe(false);
  });

  it("rejects tiny rune-colored inverted triangle icons", () => {
    const imageData = createBlankImage();
    drawTinyRuneLikeInvertedTriangleIcon(imageData, 58, 32);

    const result = detectRuneInMinimap(imageData);

    expect(result.detected).toBe(false);
  });

  it("rejects one-sided broad rune-colored minimap fragments", () => {
    const imageData = createBlankImage();
    drawBroadBottomRuneColoredFragment(imageData, 58, 32);

    const result = detectRuneInMinimap(imageData);

    expect(result.detected).toBe(false);
  });

  it("rejects rune-colored fragments that only borrow lower outline pixels", () => {
    const imageData = createBlankImage();
    drawLowerOutlinedRuneColoredFragment(imageData, 58, 32);

    const result = detectRuneInMinimap(imageData);

    expect(result.detected).toBe(false);
  });

  it("rejects wide purple fragments that are not diamond-like runes", () => {
    const imageData = createBlankImage();
    drawWideRuneColoredFragment(imageData, 52, 32);

    const result = detectRuneInMinimap(imageData);

    expect(result.detected).toBe(false);
  });

  it("rejects dark purple map background fragments", () => {
    const imageData = createBlankImage();
    drawDiamond(imageData, 62, 36, 8, [82, 44, 92]);

    const result = detectRuneInMinimap(imageData);

    expect(result.detected).toBe(false);
  });

  it("rejects narrow vertical purple UI fragments", () => {
    const imageData = createBlankImage();
    for (let y = 32; y <= 50; y += 1) {
      for (let x = 6; x <= 12; x += 1) {
        setPixel(imageData, x, y, [150, 86, 255]);
      }
    }

    const result = detectRuneInMinimap(imageData);

    expect(result.detected).toBe(false);
  });
});
