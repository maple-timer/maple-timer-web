// @ts-nocheck
// Dependency-free JS runtime for the fixed bottom-right cooldown seconds CNN.
//
// Scope:
// - Input must already be one 32x32 RGBA buff icon crop.
// - Current model classes are NULL and seconds 1..28.
// - This is separate from center cooldown OCR and bottom-right remaining-count OCR.

const MODEL_CACHE = new WeakMap();

const DEFAULT_ROI = { x: 8, y: 10, width: 24, height: 22 };

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

function prepareConv(rawLayer) {
  const outChannels = rawLayer.weight.length;
  const inChannels = rawLayer.weight[0].length;
  const kernelHeight = rawLayer.weight[0][0].length;
  const kernelWidth = rawLayer.weight[0][0][0].length;
  const weight = new Float32Array(outChannels * inChannels * kernelHeight * kernelWidth);
  let offset = 0;
  for (let out = 0; out < outChannels; out += 1) {
    for (let input = 0; input < inChannels; input += 1) {
      for (let y = 0; y < kernelHeight; y += 1) {
        for (let x = 0; x < kernelWidth; x += 1) {
          weight[offset] = rawLayer.weight[out][input][y][x];
          offset += 1;
        }
      }
    }
  }
  return {
    weight,
    bias: Float32Array.from(rawLayer.bias),
    outChannels,
    inChannels,
    kernelHeight,
    kernelWidth,
    padding: Number(rawLayer.padding ?? 0),
  };
}

function prepareDense(rawLayer) {
  return {
    weight: rawLayer.weight.map((row) => Float32Array.from(row)),
    bias: Float32Array.from(rawLayer.bias),
  };
}

function prepareModel(model) {
  if (!model || typeof model !== "object") {
    throw new TypeError("A bottom-right cooldown CNN model object is required.");
  }
  const cached = MODEL_CACHE.get(model);
  if (cached) return cached;
  const prepared = {
    classes: model.classes ?? ["NULL", ...Array.from({ length: 28 }, (_, index) => String(index + 1))],
    roi: {
      x: Number(model.roi?.x ?? DEFAULT_ROI.x),
      y: Number(model.roi?.y ?? DEFAULT_ROI.y),
      width: Number(model.roi?.width ?? DEFAULT_ROI.width),
      height: Number(model.roi?.height ?? DEFAULT_ROI.height),
    },
    conv1: prepareConv(model.layers.conv1),
    conv2: prepareConv(model.layers.conv2),
    fc1: prepareDense(model.layers.fc1),
    fc2: prepareDense(model.layers.fc2),
    confidence: {
      defaultMinConfidence: Number(model.confidence?.defaultMinConfidence ?? 0),
      high: Number(model.confidence?.high ?? 0.88),
      medium: Number(model.confidence?.medium ?? 0.62),
    },
  };
  MODEL_CACHE.set(model, prepared);
  return prepared;
}

function featureForImage(image, prepared) {
  const { data, width, height } = image;
  const { roi } = prepared;
  const channels = 4;
  const feature = new Float32Array(channels * roi.height * roi.width);
  for (let y = 0; y < roi.height; y += 1) {
    const sourceY = roi.y + y;
    for (let x = 0; x < roi.width; x += 1) {
      const sourceX = roi.x + x;
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      if (sourceX >= 0 && sourceX < width && sourceY >= 0 && sourceY < height) {
        const offset = (sourceY * width + sourceX) * 4;
        red = data[offset] / 255;
        green = data[offset + 1] / 255;
        blue = data[offset + 2] / 255;
        alpha = data[offset + 3] / 255;
      }
      const luma = 0.299 * red + 0.587 * green + 0.114 * blue;
      const maxRgb = Math.max(red, green, blue);
      const minRgb = Math.min(red, green, blue);
      const sat = maxRgb - minRgb;
      const offset = y * roi.width + x;
      feature[offset] = luma;
      feature[roi.height * roi.width + offset] = 1 - luma;
      feature[2 * roi.height * roi.width + offset] = alpha >= 0.45 && luma <= 0.34 && sat <= 0.82 ? 1 : 0;
      feature[3 * roi.height * roi.width + offset] = alpha;
    }
  }
  return { data: feature, channels, height: roi.height, width: roi.width };
}

function conv2d(input, layer) {
  const inputChannels = input.channels;
  const height = input.height;
  const width = input.width;
  const outputChannels = layer.outChannels;
  const kernelHeight = layer.kernelHeight;
  const kernelWidth = layer.kernelWidth;
  const padding = layer.padding;
  const output = new Float32Array(outputChannels * height * width);
  const inputPlane = height * width;
  const kernelPlane = kernelHeight * kernelWidth;
  const outputPlane = height * width;
  for (let outChannel = 0; outChannel < outputChannels; outChannel += 1) {
    const outWeightOffset = outChannel * inputChannels * kernelPlane;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let value = layer.bias[outChannel];
        for (let inChannel = 0; inChannel < inputChannels; inChannel += 1) {
          const inputOffset = inChannel * inputPlane;
          const weightOffset = outWeightOffset + inChannel * kernelPlane;
          for (let ky = 0; ky < kernelHeight; ky += 1) {
            const sourceY = y + ky - padding;
            if (sourceY < 0 || sourceY >= height) continue;
            for (let kx = 0; kx < kernelWidth; kx += 1) {
              const sourceX = x + kx - padding;
              if (sourceX < 0 || sourceX >= width) continue;
              value += layer.weight[weightOffset + ky * kernelWidth + kx] * input.data[inputOffset + sourceY * width + sourceX];
            }
          }
        }
        output[outChannel * outputPlane + y * width + x] = Math.max(0, value);
      }
    }
  }
  return { data: output, channels: outputChannels, height, width };
}

function maxPool2x2(input) {
  const channels = input.channels;
  const outHeight = Math.floor(input.height / 2);
  const outWidth = Math.floor(input.width / 2);
  const output = new Float32Array(channels * outHeight * outWidth);
  const inputPlane = input.height * input.width;
  const outputPlane = outHeight * outWidth;
  for (let channel = 0; channel < channels; channel += 1) {
    const inputOffset = channel * inputPlane;
    const outputOffset = channel * outputPlane;
    for (let y = 0; y < outHeight; y += 1) {
      for (let x = 0; x < outWidth; x += 1) {
        const y0 = y * 2;
        const x0 = x * 2;
        output[outputOffset + y * outWidth + x] = Math.max(
          input.data[inputOffset + y0 * input.width + x0],
          input.data[inputOffset + (y0 + 1) * input.width + x0],
          input.data[inputOffset + y0 * input.width + x0 + 1],
          input.data[inputOffset + (y0 + 1) * input.width + x0 + 1],
        );
      }
    }
  }
  return { data: output, channels, height: outHeight, width: outWidth };
}

function flatten(input) {
  return input.data;
}

function dense(input, layer, relu = false) {
  const output = new Float32Array(layer.bias.length);
  for (let row = 0; row < layer.weight.length; row += 1) {
    const weights = layer.weight[row];
    let value = layer.bias[row];
    for (let index = 0; index < weights.length; index += 1) {
      value += weights[index] * input[index];
    }
    output[row] = relu ? Math.max(0, value) : value;
  }
  return output;
}

function runNetwork(feature, prepared) {
  let state = conv2d(feature, prepared.conv1);
  state = maxPool2x2(state);
  state = conv2d(state, prepared.conv2);
  state = maxPool2x2(state);
  const hidden = dense(flatten(state), prepared.fc1, true);
  return dense(hidden, prepared.fc2, false);
}

function softmax(logits) {
  let maxLogit = -Infinity;
  for (const value of logits) maxLogit = Math.max(maxLogit, value);
  const output = new Float32Array(logits.length);
  let sum = 0;
  for (let index = 0; index < logits.length; index += 1) {
    const value = Math.exp(logits[index] - maxLogit);
    output[index] = value;
    sum += value;
  }
  if (sum > 0) {
    for (let index = 0; index < output.length; index += 1) output[index] /= sum;
  }
  return output;
}

function statusForConfidence(confidence, prepared) {
  if (confidence >= prepared.confidence.high) return "high";
  if (confidence >= prepared.confidence.medium) return "medium";
  return "low";
}

function candidateFromClass(className, probability) {
  if (className === "NULL") {
    return {
      text: null,
      totalSeconds: null,
      expectedSeconds: null,
      format: "none",
      textRegion: "none",
      probability,
    };
  }
  const seconds = Number(className);
  return {
    text: className,
    totalSeconds: seconds,
    expectedSeconds: seconds,
    format: "seconds",
    textRegion: "bottom-right",
    probability,
  };
}

export function scoreBottomRightCooldownCnnCandidates(input, model, options = {}) {
  const prepared = prepareModel(model);
  const image = imageInput(input, options);
  const feature = featureForImage(image, prepared);
  const logits = runNetwork(feature, prepared);
  const probabilities = softmax(logits);
  const candidates = prepared.classes
    .map((className, index) => ({
      ...candidateFromClass(className, probabilities[index]),
      className,
      classIndex: index,
      score: -Math.log(Math.max(1e-9, probabilities[index])),
    }))
    .sort((left, right) => right.probability - left.probability);
  const maxCandidates = Math.max(1, Number(options.maxCandidates ?? 5));
  return {
    candidates: candidates.slice(0, maxCandidates).map((candidate) => ({
      ...candidate,
      probability: roundTo(candidate.probability, 6),
      score: roundTo(candidate.score, 5),
    })),
    debug: {
      roi: prepared.roi,
    },
  };
}

export function recognizeBottomRightCooldownCnn(input, model, options = {}) {
  const prepared = prepareModel(model);
  const { candidates, debug } = scoreBottomRightCooldownCnnCandidates(input, model, options);
  const best = candidates[0] ?? null;
  const confidence = best ? best.probability : 0;
  const minConfidence = Number(options.minConfidence ?? prepared.confidence.defaultMinConfidence);
  const status = best ? statusForConfidence(confidence, prepared) : "missing";
  if (!best || confidence < minConfidence || best.className === "NULL") {
    return {
      kind: "none",
      text: null,
      totalSeconds: null,
      expectedSeconds: null,
      format: "none",
      textRegion: best?.className === "NULL" ? "none" : "bottom-right",
      confidence: roundTo(confidence, 4),
      status: best ? status : "missing",
      bestGuess: best,
      candidates,
      debug,
    };
  }
  return {
    kind: "exact",
    text: best.text,
    totalSeconds: best.totalSeconds,
    expectedSeconds: best.expectedSeconds,
    format: "seconds",
    textRegion: "bottom-right",
    confidence: roundTo(confidence, 4),
    status,
    candidates,
    debug,
  };
}

export default {
  recognizeBottomRightCooldownCnn,
  scoreBottomRightCooldownCnnCandidates,
};
