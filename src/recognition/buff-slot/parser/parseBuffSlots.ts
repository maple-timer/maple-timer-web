import { extractBuffIcons } from "./extractBuffIcons.js";
import type { ExtractBuffIconsOptions, ExtractBuffIconsResult, ImageLike } from "./types.js";
import {
  extractBuffIconsWithDl,
  invalidateBuffSlotDlParserRuntime,
  isBuffSlotDlParserEnvironmentSupported,
} from "./dlBuffIconDetector.js";
import {
  BUFF_SLOT_DL_MODEL,
  type BuffSlotDlModel,
} from "./dlBuffIconModel.js";
import {
  DEFAULT_PRECISION_PARSER_RUNTIME_SELECTION,
  PRECISION_PARSER_ONNX_RUNTIME_VERSION,
  type PrecisionParserRuntimeProvenance,
  type PrecisionParserRuntimeSelection,
} from "../../../contracts/recognition/precisionParserRuntime.js";
import {
  createPrecisionParserDiagnosticEvent,
  PrecisionParserDiagnosticError,
  type PrecisionParserDiagnosticEvent,
} from "../../../contracts/recognition/precisionParserDiagnostics.js";

export type BuffSlotParserEngine = "auto" | "rule" | "dl";

export const BUFF_SLOT_RULE_PARSER_VERSION = "buff-icon-parser-3b71088";
export const BUFF_SLOT_DL_PARSER_VERSION = BUFF_SLOT_DL_MODEL.id;
export const BUFF_SLOT_AUTO_PARSER_VERSION = `${BUFF_SLOT_RULE_PARSER_VERSION}+${BUFF_SLOT_DL_PARSER_VERSION}`;

export type ParseBuffSlotsOptions = ExtractBuffIconsOptions & {
  engine?: BuffSlotParserEngine;
  fallbackToRule?: boolean;
  runtimeSelection?: PrecisionParserRuntimeSelection;
  onDiagnostic?: (event: PrecisionParserDiagnosticEvent) => void;
};

export type ParseBuffSlotsResult = ExtractBuffIconsResult & {
  engine: "rule" | "dl";
  parserVersion: string;
  fallbackReason?: string;
  runtime?: PrecisionParserRuntimeProvenance;
};

export type BuffSlotAnalysis = Pick<
  ParseBuffSlotsResult,
  "icons" | "boxes" | "engine" | "parserVersion" | "fallbackReason"
> & Pick<ParseBuffSlotsResult, "runtime">;

const DL_RETRY_BASE_DELAY_MS = 5_000;
const DL_RETRY_MAX_DELAY_MS = 60_000;

type DlFailureState = {
  reason: string;
  failureCount: number;
  retryAt: number;
};

const dlFailureStates = new Map<
  PrecisionParserRuntimeSelection["executionProvider"],
  DlFailureState
>();

export async function parseBuffSlots(
  image: ImageLike,
  options: ParseBuffSlotsOptions = {},
): Promise<ParseBuffSlotsResult> {
  const engine = options.engine ?? "auto";
  const {
    engine: _engine,
    fallbackToRule: _fallbackToRule,
    runtimeSelection: _runtimeSelection,
    onDiagnostic,
    ...extractOptions
  } = options;
  if (engine === "rule") {
    return parseWithRule(image, extractOptions);
  }

  const fallbackToRule = options.fallbackToRule ?? engine === "auto";
  const runtimeSelection = options.runtimeSelection ?? DEFAULT_PRECISION_PARSER_RUNTIME_SELECTION;
  const unavailableReason = getDlUnavailableReason(extractOptions, runtimeSelection);
  if (unavailableReason) {
    if (!fallbackToRule) {
      if (unavailableReason === "dl-buff-parser-webgpu-unavailable") {
        const diagnostic = createPrecisionParserDiagnosticEvent({
          stage: "webgpu-api",
          status: "failed",
          code: "webgpu-api-unavailable",
          technicalMessage: unavailableReason,
          details: {
            secureContext: globalThis.isSecureContext,
          },
        });
        onDiagnostic?.(diagnostic);
        throw new PrecisionParserDiagnosticError(
          unavailableReason,
          diagnostic,
        );
      }
      throw new Error(unavailableReason);
    }
    return parseWithRule(image, extractOptions, unavailableReason);
  }

  try {
    const { model, ...result } = await extractBuffIconsWithDl(
      image,
      extractOptions,
      runtimeSelection.executionProvider,
      onDiagnostic,
    );
    dlFailureStates.delete(runtimeSelection.executionProvider);
    return {
      ...result,
      engine: "dl",
      parserVersion: model.id,
      runtime: createRuntimeProvenance(runtimeSelection, model),
    };
  } catch (error) {
    const reason = toFallbackReason(error);
    if (isTransientDlRuntimeFailure(reason)) {
      recordDlRuntimeFailure(reason, runtimeSelection.executionProvider);
      invalidateBuffSlotDlParserRuntime(runtimeSelection.executionProvider);
    }
    if (!fallbackToRule) {
      throw error;
    }
    return parseWithRule(image, extractOptions, reason);
  }
}

function parseWithRule(
  image: ImageLike,
  options: ExtractBuffIconsOptions,
  fallbackReason?: string,
): ParseBuffSlotsResult {
  return {
    ...extractBuffIcons(image, options),
    engine: "rule",
    parserVersion: BUFF_SLOT_RULE_PARSER_VERSION,
    fallbackReason,
  };
}

function getDlUnavailableReason(
  options: ParseBuffSlotsOptions,
  runtimeSelection: PrecisionParserRuntimeSelection,
): string | null {
  if (options.inputMode === "croppedRoi" || options.roi) {
    return "dl-buff-parser-full-frame-only";
  }
  if (!isBuffSlotDlParserEnvironmentSupported(runtimeSelection.executionProvider)) {
    return runtimeSelection.executionProvider === "webgpu"
      ? "dl-buff-parser-webgpu-unavailable"
      : "dl-buff-parser-wasm-unavailable";
  }
  const failureState = dlFailureStates.get(runtimeSelection.executionProvider);
  if (failureState && Date.now() < failureState.retryAt) {
    return failureState.reason;
  }
  return null;
}

function createRuntimeProvenance(
  runtimeSelection: PrecisionParserRuntimeSelection,
  model: BuffSlotDlModel,
): PrecisionParserRuntimeProvenance {
  return {
    recognitionEngine: "dl",
    parserVersion: model.id,
    modelId: model.id,
    modelInputWidth: model.inputWidth,
    modelInputHeight: model.inputHeight,
    onnxRuntimeVersion: PRECISION_PARSER_ONNX_RUNTIME_VERSION,
    executionProvider: runtimeSelection.executionProvider,
    selectionSource: runtimeSelection.selectionSource,
    wasmThreads: runtimeSelection.executionProvider === "wasm" ? 1 : null,
  };
}

function recordDlRuntimeFailure(
  reason: string,
  executionProvider: PrecisionParserRuntimeSelection["executionProvider"],
): void {
  const failureCount =
    (dlFailureStates.get(executionProvider)?.failureCount ?? 0) + 1;
  const retryDelay = Math.min(
    DL_RETRY_BASE_DELAY_MS * 2 ** (failureCount - 1),
    DL_RETRY_MAX_DELAY_MS,
  );
  dlFailureStates.set(executionProvider, {
    reason,
    failureCount,
    retryAt: Date.now() + retryDelay,
  });
}

function isTransientDlRuntimeFailure(reason: string): boolean {
  return ![
    "dl-buff-parser-full-frame-only",
    "dl-buff-parser-webgpu-unavailable",
    "Invalid image dimensions.",
    "Image data must be RGBA data with width * height * 4 entries.",
  ].includes(reason);
}

export function resetBuffSlotDlParserFailureState(): void {
  dlFailureStates.clear();
}

function toFallbackReason(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "dl-buff-parser-error";
}
