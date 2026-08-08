export function bevelForSide(side) {
  return Math.max(2, Math.round(side * 0.11));
}

export function diagonalBevelScore(features, x, y, side, bevel) {
  let hits = 0;
  let total = 0;
  const samples = Math.max(3, bevel - 1);

  for (let step = 1; step <= samples; step += 1) {
    const points = [
      [x + step, y + bevel - step],
      [x + side - bevel + step - 1, y + step],
      [x + step, y + side - bevel + step - 1],
      [x + side - bevel + step - 1, y + side - step - 1],
    ];

    for (const [px, py] of points) {
      total += 1;
      if (isBorderEvidenceNear(features, px, py)) hits += 1;
    }
  }

  return hits / Math.max(1, total);
}

function isBorderEvidenceNear(features, x, y) {
  for (let dy = -1; dy <= 1; dy += 1) {
    const py = y + dy;
    if (py < 0 || py >= features.height) continue;
    for (let dx = -1; dx <= 1; dx += 1) {
      const px = x + dx;
      if (px < 0 || px >= features.width) continue;
      const index = py * features.width + px;
      if (features.borderDark[index] || (features.midDark[index] && features.edge[index] > 32)) return true;
    }
  }
  return false;
}
