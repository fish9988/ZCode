import {
  DEFAULT_ZCODE_MODEL_CONTEXT_BUDGET_STRATEGY as DEFAULT_BUDGET_STRATEGY,
  type ContextCompressionEngineMode,
} from "@zcode/shared";
import type { CompactModelMessage } from "./manual.js";
import { estimateMessageTokens, hasEnoughMessagesToCompact } from "./manual.js";
import type { LocalMicrocompactPolicyConfig } from "./microcompact.js";

export const DEFAULT_COMPACT_CONTEXT_WINDOW = 200_000;
// 正常请求默认输出已收敛到 32K，auto compact 必须预留同一目标；
// 否则请求预算和压缩窗口会继续按两套常量计算。
export const DEFAULT_AUTOCOMPACT_OUTPUT_RESERVE_TOKENS = 32_000;
export const PREFLIGHT_AUTOCOMPACT_OUTPUT_RESERVE_TOKENS = 21_000;
export const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000;
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000;
export const DEFAULT_AUTOCOMPACT_THRESHOLD_PERCENT = 100;
export const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3;
export const DEFAULT_DSH_COMPACT_THRESHOLD_RATIO = 0.75;
export const DEFAULT_DSH_COMPACT_RETAIN_RATIO = 0.2;

export interface BillionContextRuntimeConfig {
  minContextLimitPct?: number;
  maxContextLimitPct?: number;
  growthFloorTokens?: number;
  preserveRecentMessages?: number;
  preserveRecentTokens?: number;
  emergencyThresholdPct?: number;
}

export interface AutoCompactPolicyConfig {
  enabled?: boolean;
  /** 压缩引擎模式；实时会话默认由 runtime-config/server-operations 设为 "dsh-compact"。 */
  engine?: ContextCompressionEngineMode;
  contextWindow?: number;
  /** 单模型或全局覆盖的有效压缩窗口上限（<= contextWindow）。 */
  effectiveContextWindow?: number;
  /** 全局默认有效压缩窗口上限；单模型未配置 effectiveContextWindow 时生效。 */
  defaultEffectiveContextWindow?: number | null;
  maxOutputTokens?: number;
  modelContextBudgetStrategy?: "legacy" | "preflight-v1";
  summaryReserveTokens?: number;
  bufferTokens?: number;
  thresholdPercentOverride?: number;
  /** dsh-compact 触发比例（0.50–0.95，默认 0.75）。 */
  thresholdRatio?: number;
  /** dsh-compact 保留最近上下文比例（0.05–0.50，默认 0.20）。 */
  retainRatio?: number;
  /** 溢出时是否尝试压缩恢复（默认 true）。 */
  recoverOnOverflow?: boolean;
  /** 单步溢出恢复重试次数上限（默认 1）。 */
  maxOverflowRetries?: number;
  maxConsecutiveFailures?: number;
  microcompact?: LocalMicrocompactPolicyConfig;
  billionContext?: BillionContextRuntimeConfig;
}

export type AutoCompactTokenSource = "estimate" | "provider_usage";

export interface AutoCompactTokenOverride {
  baseTokenCount?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  contextUsageTokenCount?: number;
  incrementalTokenCount?: number;
  outputTokens?: number;
  source: Extract<AutoCompactTokenSource, "provider_usage">;
  tokenCount: number;
}

export interface AutoCompactDecision {
  shouldCompact: boolean;
  tokenCount: number;
  tokenSource: AutoCompactTokenSource;
  estimatedTokenCount: number;
  providerCacheReadTokens?: number;
  providerCacheWriteTokens?: number;
  providerBaseTokenCount?: number;
  providerContextUsageTokenCount?: number;
  providerIncrementalTokenCount?: number;
  providerOutputTokens?: number;
  threshold: number;
  contextWindow: number;
  effectiveContextWindow: number;
  maxOutputTokens?: number;
  modelContextBudgetStrategy: "legacy" | "preflight-v1";
  outputReserveTokens: number;
  thresholdPercent: number;
  reason:
    | "disabled"
    | "not_enough_messages"
    | "circuit_breaker"
    | "below_threshold"
    | "above_threshold";
}

/**
 * 解析当前模型的有效压缩窗口：
 * min(model.effectiveContextWindow ?? defaultEffectiveContextWindow ?? contextWindow, contextWindow)。
 */
export function resolveEffectiveCompressionWindow(config: {
  readonly contextWindow?: number;
  readonly effectiveContextWindow?: number | null;
  readonly defaultEffectiveContextWindow?: number | null;
} = {}): number {
  const hardWindow = positiveInt(config.contextWindow) ?? DEFAULT_COMPACT_CONTEXT_WINDOW;
  const preferred =
    positiveInt(config.effectiveContextWindow ?? undefined) ??
    positiveInt(config.defaultEffectiveContextWindow ?? undefined);
  if (preferred === undefined || preferred <= 0) return hardWindow;
  return Math.min(preferred, hardWindow);
}

export function resolveDshCompactRatios(config: AutoCompactPolicyConfig = {}): {
  readonly thresholdRatio: number;
  readonly retainRatio: number;
} {
  const thresholdRatio = clampRatio(
    config.thresholdRatio,
    DEFAULT_DSH_COMPACT_THRESHOLD_RATIO,
    0.5,
    0.95,
  );
  const rawRetain = clampRatio(config.retainRatio, DEFAULT_DSH_COMPACT_RETAIN_RATIO, 0.05, 0.5);
  const retainRatio = Math.min(rawRetain, Math.max(0.05, thresholdRatio - 0.05));
  return { thresholdRatio, retainRatio };
}

export function getEffectiveContextWindowSize(config: AutoCompactPolicyConfig = {}): number {
  const contextWindow = resolveEffectiveCompressionWindow(config);
  // provider 的 context window 是 input + output 共享窗口；自动压缩只能让出输入侧，
  // 因此阈值分母必须先扣掉当前模型允许的 output token，而不是继续吃完整 contextWindow。
  const reserve = Math.min(getAutoCompactOutputReserveTokens(config), contextWindow);
  return Math.max(0, contextWindow - reserve);
}

export function getAutoCompactOutputReserveTokens(config: AutoCompactPolicyConfig = {}): number {
  const maxOutputTokens = positiveInt(config.maxOutputTokens);
  // 旧 legacy 分支为完整模型输出预留窗口，既过早压缩又要求远端选择；现在统一保留至多 21K。
  return Math.min(
    maxOutputTokens ?? DEFAULT_AUTOCOMPACT_OUTPUT_RESERVE_TOKENS,
    PREFLIGHT_AUTOCOMPACT_OUTPUT_RESERVE_TOKENS,
  );
}

export function getAutoCompactThreshold(config: AutoCompactPolicyConfig = {}): number {
  const effectiveContextWindow = getEffectiveContextWindowSize(config);
  const buffer = positiveInt(config.bufferTokens) ?? AUTOCOMPACT_BUFFER_TOKENS;
  const legacyThreshold = Math.max(0, effectiveContextWindow - buffer);
  if (config.engine === "dsh-compact") {
    const windowBudget = resolveEffectiveCompressionWindow(config);
    const { thresholdRatio } = resolveDshCompactRatios(config);
    return Math.min(legacyThreshold, Math.floor(windowBudget * thresholdRatio));
  }
  return legacyThreshold;
}

export function shouldAutoCompact(input: {
  messages: readonly CompactModelMessage[];
  config?: AutoCompactPolicyConfig;
  consecutiveFailures?: number;
  tokenOverride?: AutoCompactTokenOverride;
  /** 调用方按存储的条目判断历史是否够压缩；不传时按 messages 判断。 */
  hasEnoughHistory?: boolean;
}): AutoCompactDecision {
  const config = input.config ?? {};
  const contextWindow = resolveEffectiveCompressionWindow(config);
  const effectiveContextWindow = getEffectiveContextWindowSize(config);
  const outputReserveTokens = Math.min(getAutoCompactOutputReserveTokens(config), contextWindow);
  const threshold = getAutoCompactThreshold(config);
  const thresholdPercent =
    config.engine === "dsh-compact"
      ? Math.round(resolveDshCompactRatios(config).thresholdRatio * 100)
      : DEFAULT_AUTOCOMPACT_THRESHOLD_PERCENT;
  const estimatedTokenCount = estimateMessageTokens(input.messages);
  const tokenCount = input.tokenOverride?.tokenCount ?? estimatedTokenCount;
  const tokenSource = input.tokenOverride?.source ?? "estimate";
  const common = {
    contextWindow,
    effectiveContextWindow,
    estimatedTokenCount,
    providerCacheReadTokens: input.tokenOverride?.cacheReadTokens,
    providerCacheWriteTokens: input.tokenOverride?.cacheWriteTokens,
    maxOutputTokens: positiveInt(config.maxOutputTokens),
    modelContextBudgetStrategy: DEFAULT_BUDGET_STRATEGY,
    outputReserveTokens,
    providerBaseTokenCount: input.tokenOverride?.baseTokenCount,
    providerContextUsageTokenCount: input.tokenOverride?.contextUsageTokenCount,
    providerIncrementalTokenCount: input.tokenOverride?.incrementalTokenCount,
    providerOutputTokens: input.tokenOverride?.outputTokens,
    threshold,
    thresholdPercent,
    tokenCount,
    tokenSource,
  } satisfies Omit<AutoCompactDecision, "reason" | "shouldCompact">;

  if (
    config.enabled === false ||
    config.engine === "disabled" ||
    config.engine === "billion-context"
  ) {
    return { ...common, shouldCompact: false, reason: "disabled" };
  }

  if (!(input.hasEnoughHistory ?? hasEnoughMessagesToCompact(input.messages))) {
    return {
      ...common,
      shouldCompact: false,
      reason: "not_enough_messages",
    };
  }

  const maxFailures =
    positiveInt(config.maxConsecutiveFailures) ?? MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES;
  if ((input.consecutiveFailures ?? 0) >= maxFailures) {
    return {
      ...common,
      shouldCompact: false,
      reason: "circuit_breaker",
    };
  }

  if (tokenCount < threshold) {
    return {
      ...common,
      shouldCompact: false,
      reason: "below_threshold",
    };
  }

  return { ...common, shouldCompact: true, reason: "above_threshold" };
}

function positiveInt(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function clampRatio(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
