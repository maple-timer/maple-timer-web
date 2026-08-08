const MODEL_CACHE = new WeakMap();

const DEFAULT_ROI = { x: 1, y: 4, width: 30, height: 23 };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundTo(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function imageInput(input, options = {}) {
  const data = input?.data ?? input;
  const width = Number(input?.width ?? options.width ?? 32);
  const height = Number(input?.height ?? options.height ?? 32);
  if (!data || typeof data.length !== "number") {
    throw new TypeError("Input must be an ImageData-like object or an RGBA array.");
  }
  if (data.length < width * height * 4) {
    throw new TypeError("RGBA input data is shorter than width * height * 4.");
  }
  return { data, width, height };
}

function defaultMaskProfiles() {
  return [
    {
      name: "cooldown-yellow",
      minAlpha: 0.45,
      minRed: 0.32,
      minGreen: 0.28,
      maxBlue: 0.64,
      minYellowDelta: 0.05,
      minChroma: 0.07,
    },
    {
      name: "bright-yellow",
      minAlpha: 0.45,
      minRed: 0.42,
      minGreen: 0.38,
      maxBlue: 0.72,
      minYellowDelta: 0.02,
      minChroma: 0.04,
    },
    {
      name: "dim-yellow",
      minAlpha: 0.45,
      minRed: 0.25,
      minGreen: 0.24,
      maxBlue: 0.58,
      minYellowDelta: 0.09,
      minChroma: 0.06,
    },
  ];
}

function prepareLayers(rawLayers = []) {
  return rawLayers.map((layer) => ({
    weights: prepareLayerWeights(layer),
    bias: prepareLayerBias(layer),
    activation: layer.activation ?? "relu",
  }));
}

function prepareLayerWeights(layer) {
  if (!layer.weightsQ) {
    return layer.weights.map((row) => Float32Array.from(row));
  }
  const rows = Number(layer.rows ?? 0);
  const cols = Number(layer.cols ?? 0);
  const values = decodeQuantizedFloatArray(layer.weightsQ, rows * cols, Number(layer.scale ?? 1000));
  const weights = [];
  for (let row = 0; row < rows; row += 1) {
    weights.push(values.subarray(row * cols, (row + 1) * cols));
  }
  return weights;
}

function prepareLayerBias(layer) {
  if (!layer.biasQ) {
    return Float32Array.from(layer.bias);
  }
  const rows = Number(layer.rows ?? 0);
  return decodeQuantizedFloatArray(layer.biasQ, rows, Number(layer.scale ?? 1000));
}

function decodeQuantizedFloatArray(encoded, expectedLength, scale) {
  const bytes = decodeBase64Bytes(encoded);
  if (bytes.byteLength < expectedLength * 2) {
    throw new TypeError("Encoded center ROI OCR layer is shorter than expected.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(expectedLength);
  for (let index = 0; index < expectedLength; index += 1) {
    out[index] = view.getInt16(index * 2, true) / scale;
  }
  return out;
}

function decodeBase64Bytes(encoded) {
  if (typeof atob === "function") {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(encoded, "base64"));
  }
  throw new TypeError("Base64 decoding is not available in this runtime.");
}

function prepareHead(rawHead) {
  if (!rawHead || rawHead.kind === "constant") {
    return {
      kind: "constant",
      value: Number(rawHead?.value ?? 0),
    };
  }
  return {
    kind: "mlp",
    classes: (rawHead.classes ?? []).map((value) => String(value)),
    layers: prepareLayers(rawHead.layers ?? []),
  };
}

function prepareModel(model) {
  if (!model || typeof model !== "object") {
    throw new TypeError("A center ROI OCR v4 model object is required.");
  }
  const cached = MODEL_CACHE.get(model);
  if (cached) {
    return cached;
  }
  const heads = {};
  for (const [key, head] of Object.entries(model.heads ?? {})) {
    heads[key] = prepareHead(head);
  }
  const prepared = {
    roi: {
      x: Number(model.centerRoi?.x ?? DEFAULT_ROI.x),
      y: Number(model.centerRoi?.y ?? DEFAULT_ROI.y),
      width: Number(model.centerRoi?.width ?? DEFAULT_ROI.width),
      height: Number(model.centerRoi?.height ?? DEFAULT_ROI.height),
    },
    maskProfiles: Array.isArray(model.maskProfiles) ? model.maskProfiles : defaultMaskProfiles(),
    route: {
      classes: model.route?.classes ?? ["none", "s1", "s2", "s3", "m4"],
      layers: prepareLayers(model.route?.layers ?? []),
    },
    heads,
    confidence: {
      defaultMinConfidence: Number(model.confidence?.defaultMinConfidence ?? 0),
      scoreScale: Number(model.confidence?.scoreScale ?? 2.2),
      marginScale: Number(model.confidence?.marginScale ?? 0.8),
    },
  };
  MODEL_CACHE.set(model, prepared);
  return prepared;
}

function pixelMatchesProfile(red, green, blue, alpha, profile) {
  if (alpha < Number(profile.minAlpha ?? 0.45)) {
    return false;
  }
  const maxRgb = Math.max(red, green, blue);
  const minRgb = Math.min(red, green, blue);
  const yellowDelta = (red + green) / 2 - blue;
  return (
    red >= Number(profile.minRed ?? 0) &&
    green >= Number(profile.minGreen ?? 0) &&
    blue <= Number(profile.maxBlue ?? 1) &&
    yellowDelta >= Number(profile.minYellowDelta ?? 0) &&
    maxRgb - minRgb >= Number(profile.minChroma ?? 0)
  );
}

function maskForProfile(image, prepared, profile) {
  const { data, width, height } = image;
  const { roi } = prepared;
  const mask = new Uint8Array(roi.width * roi.height);
  let maskPixels = 0;
  for (let y = 0; y < roi.height; y += 1) {
    const sourceY = roi.y + y;
    if (sourceY < 0 || sourceY >= height) {
      continue;
    }
    for (let x = 0; x < roi.width; x += 1) {
      const sourceX = roi.x + x;
      if (sourceX < 0 || sourceX >= width) {
        continue;
      }
      const offset = (sourceY * width + sourceX) * 4;
      const red = data[offset] / 255;
      const green = data[offset + 1] / 255;
      const blue = data[offset + 2] / 255;
      const alpha = data[offset + 3] / 255;
      if (pixelMatchesProfile(red, green, blue, alpha, profile)) {
        mask[y * roi.width + x] = 1;
        maskPixels += 1;
      }
    }
  }
  return { mask, maskPixels, profileName: profile.name ?? "profile" };
}

function featureForImage(image, prepared) {
  const masks = prepared.maskProfiles.map((profile) => maskForProfile(image, prepared, profile));
  const length = masks.reduce((sum, maskDoc) => sum + maskDoc.mask.length, 0);
  const feature = new Float32Array(length);
  let offset = 0;
  for (const maskDoc of masks) {
    for (let index = 0; index < maskDoc.mask.length; index += 1) {
      feature[offset] = maskDoc.mask[index];
      offset += 1;
    }
  }
  return { feature, masks };
}

function runLayer(input, layer) {
  const out = new Float32Array(layer.bias.length);
  for (let row = 0; row < layer.weights.length; row += 1) {
    const weights = layer.weights[row];
    let value = layer.bias[row];
    for (let index = 0; index < weights.length; index += 1) {
      value += weights[index] * input[index];
    }
    out[row] = layer.activation === "relu" ? Math.max(0, value) : value;
  }
  return out;
}

function runNetwork(input, layers) {
  let state = input;
  for (const layer of layers) {
    state = runLayer(state, layer);
  }
  return state;
}

function softmax(logits) {
  let maxLogit = -Infinity;
  for (const value of logits) {
    maxLogit = Math.max(maxLogit, value);
  }
  const out = new Float32Array(logits.length);
  let sum = 0;
  for (let index = 0; index < logits.length; index += 1) {
    const value = Math.exp(logits[index] - maxLogit);
    out[index] = value;
    sum += value;
  }
  if (sum > 0) {
    for (let index = 0; index < out.length; index += 1) {
      out[index] /= sum;
    }
  }
  return out;
}

function classifyRoute(feature, prepared) {
  const probabilities = softmax(runNetwork(feature, prepared.route.layers));
  let bestIndex = 0;
  for (let index = 1; index < probabilities.length; index += 1) {
    if (probabilities[index] > probabilities[bestIndex]) {
      bestIndex = index;
    }
  }
  return {
    routeClass: prepared.route.classes[bestIndex],
    confidence: probabilities[bestIndex],
    probabilities,
  };
}

function headProbabilities(head, feature) {
  if (!head || head.kind === "constant") {
    return [{ digit: String(Number(head?.value ?? 0)), probability: 1, score: 0 }];
  }
  const probabilities = softmax(runNetwork(feature, head.layers));
  return head.classes
    .map((digit, index) => {
      const probability = Math.max(1e-6, probabilities[index]);
      return {
        digit,
        probability,
        score: -Math.log(probability),
      };
    })
    .sort((left, right) => left.score - right.score);
}

function parseCandidate(routeClass, digits) {
  if (routeClass === "m4") {
    if (digits.length !== 3) {
      return null;
    }
    const minutes = Number(digits[0]);
    const tens = Number(digits[1]);
    const ones = Number(digits[2]);
    if (tens > 5) {
      return null;
    }
    const totalSeconds = minutes * 60 + tens * 10 + ones;
    if (totalSeconds < 1 || totalSeconds > 599) {
      return null;
    }
    return {
      text: `${minutes}:${tens}${ones}`,
      totalSeconds,
      format: "minutes-seconds",
      textRegion: "center",
    };
  }
  const text = digits.join("");
  if (!/^[0-9]+$/.test(text)) {
    return null;
  }
  if (text.length > 1 && text.startsWith("0")) {
    return null;
  }
  const totalSeconds = Number(text);
  if (!Number.isInteger(totalSeconds) || totalSeconds < 1 || totalSeconds > 600) {
    return null;
  }
  return {
    text: String(totalSeconds),
    totalSeconds,
    format: "seconds",
    textRegion: "center",
  };
}

function routePositions(routeClass) {
  if (routeClass === "s1") {
    return 1;
  }
  if (routeClass === "s2") {
    return 2;
  }
  if (routeClass === "s3" || routeClass === "m4") {
    return 3;
  }
  return 0;
}

function combineDigitOptions(routeClass, optionsByPosition, maxCandidatePool) {
  const out = [];
  function visit(position, digits, score, probability) {
    if (position >= optionsByPosition.length) {
      const parsed = parseCandidate(routeClass, digits);
      if (parsed) {
        out.push({
          ...parsed,
          score: score / Math.max(1, digits.length),
          probability,
        });
      }
      return;
    }
    for (const option of optionsByPosition[position]) {
      visit(
        position + 1,
        [...digits, option.digit],
        score + option.score,
        probability * option.probability,
      );
      if (out.length > maxCandidatePool * 16) {
        return;
      }
    }
  }
  visit(0, [], 0, 1);
  out.sort((left, right) => left.score - right.score);
  return out;
}

function confidenceFromCandidates(candidates, routeConfidence, prepared) {
  if (!candidates || candidates.length === 0) {
    return { confidence: 0, status: "missing" };
  }
  const best = candidates[0].score;
  const second = candidates.length > 1 ? candidates[1].score : best + prepared.confidence.marginScale;
  const quality = clamp(1 - best / prepared.confidence.scoreScale, 0, 1);
  const margin = clamp((second - best) / prepared.confidence.marginScale, 0, 1);
  const confidence = clamp(0.52 * quality + 0.28 * margin + 0.2 * routeConfidence, 0, 0.99);
  if (confidence >= 0.82) {
    return { confidence: roundTo(confidence, 4), status: "high" };
  }
  if (confidence >= 0.62) {
    return { confidence: roundTo(confidence, 4), status: "medium" };
  }
  return { confidence: roundTo(confidence, 4), status: "low" };
}

export function scoreCenterRoiOcrV4Candidates(input, model, options = {}) {
  const prepared = prepareModel(model);
  const image = imageInput(input, options);
  const { feature, masks } = featureForImage(image, prepared);
  const route = classifyRoute(feature, prepared);
  const routeClass = options.routeClass ?? route.routeClass;

  if (routeClass === "none") {
    return {
      candidates: [],
      route,
      debug: {
        masks: masks.map((maskDoc) => ({
          profileName: maskDoc.profileName,
          maskPixels: maskDoc.maskPixels,
        })),
      },
    };
  }

  const positions = routePositions(routeClass);
  const maxDigitOptions = Math.max(1, Number(options.maxDigitOptions ?? 10));
  const optionsByPosition = [];
  for (let position = 0; position < positions; position += 1) {
    const head = prepared.heads[`${routeClass}:${position}`];
    optionsByPosition.push(headProbabilities(head, feature).slice(0, maxDigitOptions));
  }
  const maxCandidatePool = Math.max(1, Number(options.maxCandidatePool ?? 1000));
  const candidates = combineDigitOptions(routeClass, optionsByPosition, maxCandidatePool);
  const maxCandidates = Math.max(1, Number(options.maxCandidates ?? 5));
  return {
    candidates: candidates.slice(0, maxCandidates).map((candidate) => ({
      ...candidate,
      score: roundTo(candidate.score, 5),
      probability: roundTo(candidate.probability, 6),
    })),
    route,
    debug: {
      routeClass,
      masks: masks.map((maskDoc) => ({
        profileName: maskDoc.profileName,
        maskPixels: maskDoc.maskPixels,
      })),
    },
  };
}

export function recognizeCenterRoiOcrV4(input, model, options = {}) {
  const prepared = prepareModel(model);
  const { candidates, route, debug } = scoreCenterRoiOcrV4Candidates(input, model, options);
  const { confidence, status } = confidenceFromCandidates(candidates, route.confidence, prepared);
  const minConfidence = Number(options.minConfidence ?? prepared.confidence.defaultMinConfidence);
  const best = candidates[0] ?? null;
  if (!best || confidence < minConfidence) {
    return {
      kind: "none",
      text: null,
      totalSeconds: null,
      format: "none",
      textRegion: best ? "center" : "none",
      confidence,
      status,
      bestGuess: best,
      candidates,
      route,
      debug,
    };
  }
  return {
    kind: "exact",
    text: best.text,
    totalSeconds: best.totalSeconds,
    expectedSeconds: best.totalSeconds,
    expectedSecondsMin: best.totalSeconds,
    expectedSecondsMax: best.totalSeconds,
    format: best.format,
    textRegion: "center",
    confidence,
    status,
    candidates,
    route,
    debug,
  };
}

export default {
  recognizeCenterRoiOcrV4,
  scoreCenterRoiOcrV4Candidates,
};
