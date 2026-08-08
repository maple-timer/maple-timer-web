import {
  createPrecisionParserDiagnosticEvent,
  PrecisionParserDiagnosticError,
  type PrecisionParserDiagnosticDetail,
  type PrecisionParserDiagnosticEvent,
} from "../../../contracts/recognition/precisionParserDiagnostics";

type WebGpuDeviceLike = {
  destroy?: () => void;
};

type WebGpuFeatureSetLike = {
  has: (feature: string) => boolean;
};

type WebGpuDeviceDescriptorLike = {
  requiredFeatures?: string[];
};

type WebGpuAdapterInfoLike = {
  vendor?: unknown;
  architecture?: unknown;
  device?: unknown;
  description?: unknown;
};

type WebGpuAdapterLike = {
  info?: WebGpuAdapterInfoLike;
  features?: WebGpuFeatureSetLike;
  requestDevice: (
    descriptor?: WebGpuDeviceDescriptorLike,
  ) => Promise<WebGpuDeviceLike>;
};

type WebGpuLike = {
  requestAdapter: () => Promise<WebGpuAdapterLike | null>;
};

type NavigatorWithWebGpu = {
  gpu?: WebGpuLike;
};

export type PrecisionWebGpuDevice = {
  device: WebGpuDeviceLike;
  adapterDetails: Record<string, PrecisionParserDiagnosticDetail>;
  features: {
    shaderF16Supported: boolean;
    shaderF16Enabled: boolean;
    subgroupsSupported: boolean;
    subgroupsEnabled: boolean;
  };
};

export async function requestPrecisionWebGpuDevice({
  navigatorLike = globalThis.navigator as NavigatorWithWebGpu | undefined,
  secureContext = globalThis.isSecureContext,
  requiredFeatures = [],
  optionalFeatures = [],
  onDiagnostic,
}: {
  navigatorLike?: NavigatorWithWebGpu;
  secureContext?: boolean;
  requiredFeatures?: readonly string[];
  optionalFeatures?: readonly string[];
  onDiagnostic?: (event: PrecisionParserDiagnosticEvent) => void;
} = {}): Promise<PrecisionWebGpuDevice> {
  emit(onDiagnostic, {
    stage: "webgpu-api",
    status: "checking",
    details: { secureContext },
  });
  const gpu = navigatorLike?.gpu;
  if (!gpu) {
    throw fail(onDiagnostic, {
      stage: "webgpu-api",
      code: "webgpu-api-unavailable",
      technicalMessage: "navigator.gpu is unavailable in the analysis worker",
      details: { secureContext },
    });
  }
  emit(onDiagnostic, {
    stage: "webgpu-api",
    status: "passed",
    details: { secureContext },
  });

  emit(onDiagnostic, { stage: "gpu-adapter", status: "checking" });
  let adapter: WebGpuAdapterLike | null;
  try {
    adapter = await gpu.requestAdapter();
  } catch (error) {
    throw fail(onDiagnostic, {
      stage: "gpu-adapter",
      code: "gpu-adapter-request-failed",
      technicalMessage: getErrorMessage(error),
    });
  }
  if (!adapter) {
    throw fail(onDiagnostic, {
      stage: "gpu-adapter",
      code: "gpu-adapter-unavailable",
      technicalMessage: "navigator.gpu.requestAdapter() returned null",
    });
  }
  const unsupportedFeatures = requiredFeatures.filter(
    (feature) => !adapter.features?.has(feature),
  );
  const requestedFeatures = unique([
    ...requiredFeatures,
    ...optionalFeatures.filter((feature) => adapter.features?.has(feature)),
    ...OPTIONAL_WEBGPU_FEATURES.filter((feature) => adapter.features?.has(feature)),
  ]);
  const shaderF16Supported = Boolean(adapter.features?.has("shader-f16"));
  const subgroupsSupported = Boolean(adapter.features?.has("subgroups"));
  const adapterDetails = {
    ...getAdapterDetails(adapter.info),
    shaderF16Supported,
    subgroupsSupported,
    requiredFeatures: requiredFeatures.join(",") || "none",
    optionalFeatures: optionalFeatures.join(",") || "none",
  };
  emit(onDiagnostic, {
    stage: "gpu-adapter",
    status: "passed",
    details: adapterDetails,
  });

  emit(onDiagnostic, { stage: "gpu-device", status: "checking" });
  if (unsupportedFeatures.length > 0) {
    throw fail(onDiagnostic, {
      stage: "gpu-device",
      code: "gpu-required-feature-unavailable",
      technicalMessage: `required WebGPU feature unavailable: ${unsupportedFeatures.join(", ")}`,
      details: adapterDetails,
    });
  }
  let device: WebGpuDeviceLike;
  try {
    device = await adapter.requestDevice({ requiredFeatures: requestedFeatures });
  } catch (error) {
    throw fail(onDiagnostic, {
      stage: "gpu-device",
      code: "gpu-device-request-failed",
      technicalMessage: getErrorMessage(error),
      details: adapterDetails,
    });
  }
  emit(onDiagnostic, {
    stage: "gpu-device",
    status: "passed",
    details: {
      ...adapterDetails,
      shaderF16Enabled: requestedFeatures.includes("shader-f16"),
      subgroupsEnabled: requestedFeatures.includes("subgroups"),
    },
  });

  const shaderF16Enabled = requestedFeatures.includes("shader-f16");
  const subgroupsEnabled = requestedFeatures.includes("subgroups");
  return {
    device,
    adapterDetails: {
      ...adapterDetails,
      shaderF16Enabled,
      subgroupsEnabled,
    },
    features: {
      shaderF16Supported,
      shaderF16Enabled,
      subgroupsSupported,
      subgroupsEnabled,
    },
  };
}

const OPTIONAL_WEBGPU_FEATURES = ["subgroups"] as const;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function emit(
  onDiagnostic: ((event: PrecisionParserDiagnosticEvent) => void) | undefined,
  event: Omit<PrecisionParserDiagnosticEvent, "code" | "technicalMessage" | "details"> &
    Partial<Pick<PrecisionParserDiagnosticEvent, "code" | "technicalMessage" | "details">>,
): PrecisionParserDiagnosticEvent {
  const normalized = createPrecisionParserDiagnosticEvent(event);
  onDiagnostic?.(normalized);
  return normalized;
}

function fail(
  onDiagnostic: ((event: PrecisionParserDiagnosticEvent) => void) | undefined,
  event: Omit<PrecisionParserDiagnosticEvent, "status" | "code" | "technicalMessage" | "details"> & {
    code: string;
    technicalMessage: string;
    details?: PrecisionParserDiagnosticEvent["details"];
  },
): PrecisionParserDiagnosticError {
  const diagnostic = emit(onDiagnostic, { ...event, status: "failed" });
  return new PrecisionParserDiagnosticError(event.technicalMessage, diagnostic);
}

function getAdapterDetails(
  info: WebGpuAdapterInfoLike | undefined,
): Record<string, PrecisionParserDiagnosticDetail> {
  const details: Record<string, PrecisionParserDiagnosticDetail> = {};
  for (const key of ["vendor", "architecture", "device", "description"] as const) {
    const value = info?.[key];
    if (typeof value === "string" && value) {
      details[key] = value;
    }
  }
  return details;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return typeof error === "string" && error ? error : "unknown WebGPU error";
}
