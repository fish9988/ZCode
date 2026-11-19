import type {
  FetchRemoteProviderModelsResult,
  ModelConnectivityResult,
  RemoteProviderModelEntry,
} from "@zcode/shared";
import type { ProviderApiType } from "@zcode/provider";
import type { ProviderSettingsConnectivityTester } from "./providerFacadeServices.js";

const REMOTE_MODELS_FETCH_TIMEOUT_MS = 15_000;
const ANTHROPIC_VERSION_HEADER = "2023-06-01";
const ACCIDENTAL_ENDPOINT_SUFFIX_RE = /\/(?:chat\/completions|responses|messages|models)$/iu;
const VERSIONED_PATH_SUFFIX_RE = /\/v\d+(?:alpha|beta)?(?:\/[^/]+)?$/iu;

interface FormalModelConnectivityInput {
  readonly workspacePath: string;
  readonly workspaceIdentity?: string;
  readonly selection: {
    readonly providerId: string;
    readonly modelId: string;
  };
}

type FormalModelConnectivityExecutor = (
  input: FormalModelConnectivityInput,
) => Promise<{ readonly success: true }>;

/**
 * 设置页只负责把已经落盘并进入 Registry 的 ModelSelection 交给目标 Environment。
 * Provider 鉴权、headers、reasoning 映射和流消费全部由正式 Model 执行链负责。
 */
export function createProviderSettingsConnectivityTester(dependencies: {
  readonly testModelConnectivity: FormalModelConnectivityExecutor;
}): ProviderSettingsConnectivityTester {
  return async (input) => {
    try {
      await dependencies.testModelConnectivity({
        workspacePath: input.workspacePath,
        ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
        selection: {
          providerId: input.providerId,
          modelId: input.modelId,
        },
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  };
}

export function buildRemoteModelsCandidateUrls(
  rawBaseUrl: string,
  apiType: ProviderApiType,
): string[] {
  const trimmed = rawBaseUrl.trim();
  if (!trimmed) {
    throw new Error("Base URL is required to fetch models.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid Base URL: ${trimmed}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported Base URL protocol: ${parsed.protocol}`);
  }

  let pathname = parsed.pathname.replace(/\/+$/u, "");
  pathname = pathname.replace(ACCIDENTAL_ENDPOINT_SUFFIX_RE, "");
  const base = `${parsed.origin}${pathname}`;
  const search = parsed.search;

  const rawCandidates: string[] = [];
  if (apiType === "anthropic-messages") {
    if (pathname.toLowerCase().endsWith("/v1")) {
      rawCandidates.push(`${base}/models${search}`);
    } else {
      rawCandidates.push(`${base}/v1/models${search}`, `${base}/models${search}`);
    }
  } else if (pathname === "") {
    rawCandidates.push(`${base}/v1/models${search}`, `${base}/models${search}`);
  } else if (VERSIONED_PATH_SUFFIX_RE.test(pathname)) {
    rawCandidates.push(`${base}/models${search}`);
  } else {
    rawCandidates.push(`${base}/models${search}`, `${base}/v1/models${search}`);
  }

  return [...new Set(rawCandidates)];
}

export function buildRemoteModelsRequestHeaders(options: {
  readonly apiType: ProviderApiType;
  readonly apiKey?: string;
  readonly customHeaders?: Readonly<Record<string, string>>;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (options.customHeaders) {
    for (const [key, value] of Object.entries(options.customHeaders)) {
      if (key.trim() && value !== undefined) {
        headers[key] = value;
      }
    }
  }
  const hasHeader = (name: string) =>
    Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());

  const trimmedKey = options.apiKey?.trim();
  if (options.apiType === "anthropic-messages") {
    if (trimmedKey && !hasHeader("x-api-key")) {
      headers["x-api-key"] = trimmedKey;
    }
    if (!hasHeader("anthropic-version")) {
      headers["anthropic-version"] = ANTHROPIC_VERSION_HEADER;
    }
  } else if (trimmedKey && !hasHeader("authorization")) {
    headers.Authorization = `Bearer ${trimmedKey}`;
  }
  return headers;
}

function toPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseNonEmptyStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const str = asNonEmptyString(item);
    if (!str || seen.has(str)) continue;
    seen.add(str);
    result.push(str);
  }
  return result.length > 0 ? result : undefined;
}

function extractRemoteReasoningMetadata(record: Record<string, unknown>): {
  readonly reasoningLevels?: readonly string[];
  readonly supportsReasoning?: boolean;
} {
  const reasoningObj =
    record.reasoning && typeof record.reasoning === "object" && !Array.isArray(record.reasoning)
      ? (record.reasoning as Record<string, unknown>)
      : undefined;
  const thinkingObj =
    record.thinking && typeof record.thinking === "object" && !Array.isArray(record.thinking)
      ? (record.thinking as Record<string, unknown>)
      : undefined;

  const reasoningLevels =
    parseNonEmptyStringArray(record.supported_reasoning_effort) ??
    parseNonEmptyStringArray(record.supported_reasoning_efforts) ??
    parseNonEmptyStringArray(record.reasoning_efforts) ??
    parseNonEmptyStringArray(record.reasoning_levels) ??
    parseNonEmptyStringArray(record.thinking_levels) ??
    parseNonEmptyStringArray(reasoningObj?.levels) ??
    parseNonEmptyStringArray(reasoningObj?.efforts) ??
    parseNonEmptyStringArray(thinkingObj?.levels);

  let supportsReasoning: boolean | undefined;
  if (typeof record.supports_reasoning === "boolean") {
    supportsReasoning = record.supports_reasoning;
  } else if (typeof record.reasoning === "boolean") {
    supportsReasoning = record.reasoning;
  } else if (typeof reasoningObj?.supported === "boolean") {
    supportsReasoning = reasoningObj.supported;
  } else if (typeof thinkingObj?.supported === "boolean") {
    supportsReasoning = thinkingObj.supported;
  } else if (Array.isArray(record.supported_parameters)) {
    const params = record.supported_parameters.map((entry) =>
      typeof entry === "string" ? entry.toLowerCase() : "",
    );
    if (params.includes("reasoning") || params.includes("include_reasoning")) {
      supportsReasoning = true;
    }
  }

  return {
    ...(reasoningLevels ? { reasoningLevels } : {}),
    ...(supportsReasoning !== undefined ? { supportsReasoning } : {}),
  };
}

export function parseRemoteModelsPayload(payload: unknown): RemoteProviderModelEntry[] {
  const rawList: unknown[] | undefined = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? Array.isArray((payload as { data?: unknown }).data)
        ? (payload as { data: unknown[] }).data
        : Array.isArray((payload as { models?: unknown }).models)
          ? (payload as { models: unknown[] }).models
          : undefined
      : undefined;

  if (!rawList) {
    throw new Error("Unexpected /models response format: expected a data or models array.");
  }

  const seen = new Set<string>();
  const models: RemoteProviderModelEntry[] = [];
  for (const item of rawList) {
    if (typeof item === "string") {
      const id = item.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      models.push({ id });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const rawName = asNonEmptyString(record.name);
    const id =
      asNonEmptyString(record.id) ??
      asNonEmptyString(record.model) ??
      (rawName?.startsWith("models/") ? rawName.slice("models/".length).trim() : rawName);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const displayName =
      asNonEmptyString(record.display_name) ??
      asNonEmptyString(record.displayName) ??
      (rawName && rawName !== id && !rawName.startsWith("models/") ? rawName : undefined);
    const ownedBy = asNonEmptyString(record.owned_by) ?? asNonEmptyString(record.ownedBy);
    const contextWindow = toPositiveInteger(
      record.max_input_tokens ??
        record.context_length ??
        record.context_window ??
        record.input_token_limit ??
        record.inputTokenLimit,
    );
    const maxOutputTokens = toPositiveInteger(
      record.max_tokens ??
        record.max_output_tokens ??
        record.output_token_limit ??
        record.outputTokenLimit,
    );
    const reasoningMetadata = extractRemoteReasoningMetadata(record);

    models.push({
      id,
      ...(displayName && displayName !== id ? { displayName } : {}),
      ...(ownedBy ? { ownedBy } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...reasoningMetadata,
    });
  }
  return models;
}

function extractHttpErrorMessage(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as {
      message?: unknown;
      error?: { message?: unknown } | string;
    };
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error.trim();
    }
    if (
      parsed.error &&
      typeof parsed.error === "object" &&
      typeof parsed.error.message === "string" &&
      parsed.error.message.trim()
    ) {
      return parsed.error.message.trim();
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    // 非 JSON 响应体取截断文本即可。
  }
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}...` : trimmed;
}

export async function fetchRemoteProviderModels(input: {
  readonly apiType: ProviderApiType;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly customHeaders?: Readonly<Record<string, string>>;
  readonly fetchImpl?: typeof fetch;
}): Promise<FetchRemoteProviderModelsResult> {
  const candidates = buildRemoteModelsCandidateUrls(input.baseUrl, input.apiType);
  const headers = buildRemoteModelsRequestHeaders({
    apiType: input.apiType,
    apiKey: input.apiKey,
    customHeaders: input.customHeaders,
  });
  const fetchFn = input.fetchImpl ?? globalThis.fetch;

  let lastError: Error | null = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const url = candidates[index]!;
    const hasFallback = index < candidates.length - 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REMOTE_MODELS_FETCH_TIMEOUT_MS);
    try {
      const response = await fetchFn(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      const bodyText = await response.text();
      if (!response.ok) {
        const detail = extractHttpErrorMessage(bodyText);
        const message = detail
          ? `HTTP ${response.status}: ${detail}`
          : `HTTP ${response.status} ${response.statusText}`.trim();
        lastError = new Error(message);
        if (hasFallback && (response.status === 404 || response.status === 405)) {
          continue;
        }
        throw lastError;
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(bodyText);
      } catch {
        lastError = new Error("Response from /models is not valid JSON.");
        if (hasFallback) continue;
        throw lastError;
      }
      const models = parseRemoteModelsPayload(parsedJson);
      return {
        endpointUrl: url,
        models,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request timed out after ${REMOTE_MODELS_FETCH_TIMEOUT_MS / 1000}s`);
      }
      if (error === lastError) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!hasFallback) {
        throw lastError;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error("Failed to fetch remote models.");
}

export type { ModelConnectivityResult };
