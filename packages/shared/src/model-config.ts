import { z } from "zod";
import { compileModelOptionMap } from "@zcode/model-option-map";
import { sparseShape } from "./config-schema.js";

export { compileModelOptionMap };

function optionMapSchema(variableName: "reasoningLevel" | "maxOutputTokens") {
  return z
    .string()
    .min(1)
    .superRefine((source, context) => {
      try {
        compileModelOptionMap(source, variableName);
      } catch (error) {
        context.addIssue({
          code: "custom",
          message: error instanceof Error ? error.message : "Option map 无法编译",
        });
      }
    });
}

export const completeEnumOptionSpecDataSchema = z
  .object({
    /** 按语义强度从低到高排列；首项是辅助调用可选的最低公开档位。 */
    values: z
      .array(
        z
          .string()
          .refine((value) => value.trim().length > 0, "reasoningLevel.values 必须是非空字符串"),
      )
      .min(1, "reasoningLevel.values 不能为空")
      .refine((values) => new Set(values).size === values.length, "reasoningLevel.values 不能重复")
      .readonly(),
    map: optionMapSchema("reasoningLevel"),
  })
  .strict();

export const completeLimitOptionSpecDataSchema = z
  .object({
    max: z.number().int().positive(),
    map: optionMapSchema("maxOutputTokens"),
  })
  .strict();

export const enumOptionSpecDataSchema = z
  .object(sparseShape(completeEnumOptionSpecDataSchema.shape))
  .strict();
export const limitOptionSpecDataSchema = z
  .object(sparseShape(completeLimitOptionSpecDataSchema.shape))
  .strict();

export const completeModelInputFormatDataSchema = z
  .object({
    supportsText: z.boolean(),
    supportsImage: z.boolean(),
    supportsVideo: z.boolean(),
    supportsAudio: z.boolean(),
    supportsPdf: z.boolean(),
  })
  .strict();
export const completeModelOutputFormatDataSchema = z.object({ supportsText: z.boolean() }).strict();
export const modelInputFormatDataSchema = z
  .object(sparseShape(completeModelInputFormatDataSchema.shape))
  .strict();
export const modelOutputFormatDataSchema = z
  .object(sparseShape(completeModelOutputFormatDataSchema.shape))
  .strict();

export const completeModelPropertiesDataSchema = z
  .object({
    requiresMfjsToolSchema: z.boolean(),
    contextWindow: z.number().int().positive(),
    /** 可选有效压缩上限（最佳工作窗口，如 1M 模型设 300K/500K）；缺省跟随全局或 contextWindow。 */
    effectiveContextWindow: z.number().int().positive().nullish(),
    inputFormat: completeModelInputFormatDataSchema,
    outputFormat: completeModelOutputFormatDataSchema,
    supportsToolCall: z.boolean(),
    supportsJsonSchemaOutput: z.boolean(),
    supportsNativeWebSearch: z.boolean(),
    supportsMidConversationSystem: z.boolean(),
  })
  .strict();
export const modelPropertiesDataSchema = z
  .object({
    ...sparseShape(completeModelPropertiesDataSchema.shape),
    inputFormat: modelInputFormatDataSchema.nullable().optional(),
    outputFormat: modelOutputFormatDataSchema.nullable().optional(),
  })
  .strict();

export const completeModelOptionSpecsDataSchema = z
  .object({
    reasoningLevel: completeEnumOptionSpecDataSchema,
    maxOutputTokens: completeLimitOptionSpecDataSchema,
  })
  .strict();
export const modelOptionSpecsDataSchema = z
  .object({
    ...sparseShape(completeModelOptionSpecsDataSchema.shape),
    reasoningLevel: enumOptionSpecDataSchema.nullable().optional(),
    maxOutputTokens: limitOptionSpecDataSchema.nullable().optional(),
  })
  .strict();

export const completeModelConfigDataSchema = z
  .object({
    enabled: z.boolean(),
    properties: completeModelPropertiesDataSchema,
    optionSpecs: completeModelOptionSpecsDataSchema,
  })
  .strict();
export const modelConfigDataSchema = z
  .object({
    ...sparseShape(completeModelConfigDataSchema.shape),
    properties: modelPropertiesDataSchema.nullable().optional(),
    optionSpecs: modelOptionSpecsDataSchema.nullable().optional(),
  })
  .strict();

// 跨层只共享数据合同；Provider 行为类与 IO 不进入公共 Schema。
export type ModelInputFormatData = z.infer<typeof completeModelInputFormatDataSchema>;
export type ModelOutputFormatData = z.infer<typeof completeModelOutputFormatDataSchema>;
export type ModelPropertiesData = z.infer<typeof completeModelPropertiesDataSchema>;
export type EnumOptionSpecData = z.infer<typeof completeEnumOptionSpecDataSchema>;
export type LimitOptionSpecData = z.infer<typeof completeLimitOptionSpecDataSchema>;
export type ModelOptionSpecsData = z.infer<typeof completeModelOptionSpecsDataSchema>;

// ---------------------------------------------------------------------------
// Pi 风格多档位思考强度配置、CEL 双向编译/求值反编译与智能推断
// ---------------------------------------------------------------------------

export const CANONICAL_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type CanonicalThinkingLevel = (typeof CANONICAL_THINKING_LEVELS)[number];

export const THINKING_FORMATS = [
  "openai", "openai-responses", "openrouter", "anthropic-adaptive", "anthropic-budget",
  "deepseek", "zai", "qwen", "qwen-chat-template", "noop", "custom-cel",
] as const;
export type ThinkingFormat = (typeof THINKING_FORMATS)[number];
export type StructuredThinkingFormat = Exclude<ThinkingFormat, "custom-cel">;
export type ThinkingTierAction = "value" | "budget" | "enabled" | "disabled" | "omit";

export interface ThinkingTierEntry {
  /** 写入 reasoningLevel.values 的档位名（可为标准名或任意自定义名）。 */
  readonly id: string;
  readonly action: ThinkingTierAction;
  /** action === "value" 时实际发送给上游的强度字符串；缺省回落为 id。 */
  readonly wireValue?: string;
  /** action === "budget" 时发送的思考 token 预算。 */
  readonly budgetTokens?: number;
}

export interface ThinkingProfile {
  readonly format: ThinkingFormat;
  readonly tiers: readonly ThinkingTierEntry[];
  /** format === "custom-cel" 时保留的原始受限 CEL 表达式。 */
  readonly customCel?: string;
}

export const THINKING_PRESET_IDS = [
  "off-1", "toggle-2", "tiers-3", "tiers-4", "tiers-5", "tiers-6", "tiers-7",
] as const;
export type ThinkingPresetId = (typeof THINKING_PRESET_IDS)[number];

export interface InferredThinkingProfile {
  /** null 表示沿用 ZCode 内置推荐规则，不写入个人思考强度覆盖。 */
  readonly profile: ThinkingProfile | null;
  readonly source: "remote-metadata" | "model-rule" | "fixed-suffix" | "non-thinking" | "builtin";
}

export const DEFAULT_THINKING_BUDGETS: Readonly<Record<string, number>> = {
  minimal: 1024, low: 4096, medium: 10240, high: 24576, xhigh: 49152, max: 65536, ultra: 98304,
  enabled: 16384, on: 16384, think: 16384, deep: 32768,
};

const OFF_LEVEL_ALIASES = new Set(["disabled", "false", "no", "none", "nothink", "no-think", "no_think", "off"]);
const CANONICAL_ALIAS_INDEX: Readonly<Record<string, number>> = {
  off: 0, none: 0, disabled: 0, false: 0, no: 0, nothink: 0, "no-think": 0, no_think: 0,
  minimal: 1, low: 2, medium: 3, adaptive: 3, auto: 3,
  high: 4, enabled: 4, enable: 4, on: 4, true: 4,
  xhigh: 5, "extra-high": 5, extra_high: 5, max: 6, ultra: 6,
};

export function isOffThinkingLevel(value: string): boolean {
  return OFF_LEVEL_ALIASES.has(value.trim().toLowerCase());
}

export function defaultThinkingBudgetForLevel(levelId: string): number {
  const normalized = levelId.trim().toLowerCase();
  return DEFAULT_THINKING_BUDGETS[normalized] ?? 16384;
}

export function resolveDefaultThinkingFormat(
  apiType?: string | null,
  baseUrl?: string | null,
): StructuredThinkingFormat {
  if (apiType === "anthropic-messages") return "anthropic-adaptive";
  if (apiType === "openai-responses") return "openai-responses";
  if (baseUrl && /openrouter\.ai/iu.test(baseUrl)) return "openrouter";
  return "openai";
}

export function buildTierEntryForFormat(
  levelId: string,
  format: StructuredThinkingFormat,
  wireValueOverride?: string,
): ThinkingTierEntry {
  const id = levelId.trim();
  const isOff = isOffThinkingLevel(id);
  if (format === "noop") {
    return { id, action: "omit" };
  }
  if (format === "zai" || format === "qwen" || format === "qwen-chat-template") {
    return { id, action: isOff ? "disabled" : "enabled" };
  }
  if (format === "anthropic-budget") {
    return isOff
      ? { id, action: "disabled" }
      : { id, action: "budget", budgetTokens: defaultThinkingBudgetForLevel(id) };
  }
  if (
    format === "anthropic-adaptive" ||
    format === "deepseek" ||
    format === "openrouter"
  ) {
    if (isOff) {
      return { id, action: "disabled" };
    }
    const wire = wireValueOverride ?? (id.toLowerCase() === "enabled" ? "high" : id);
    return { id, action: "value", wireValue: wire };
  }
  // openai / openai-responses
  if (isOff) {
    const wire = wireValueOverride ?? (id.toLowerCase() === "off" || id.toLowerCase() === "disabled" ? "none" : id);
    return { id, action: "value", wireValue: wire };
  }
  const wire = wireValueOverride ?? (id.toLowerCase() === "enabled" ? "high" : id);
  return { id, action: "value", wireValue: wire };
}

const PRESET_LEVELS: Readonly<Record<Exclude<ThinkingPresetId, "off-1">, readonly string[]>> = {
  "toggle-2": ["disabled", "enabled"],
  "tiers-3": ["low", "medium", "high"],
  "tiers-4": ["none", "low", "medium", "high"],
  "tiers-5": ["none", "low", "medium", "high", "xhigh"],
  "tiers-6": ["off", "minimal", "low", "medium", "high", "xhigh"],
  "tiers-7": CANONICAL_THINKING_LEVELS,
};

export function buildThinkingProfileFromPreset(
  presetId: ThinkingPresetId,
  format: StructuredThinkingFormat,
): ThinkingProfile {
  if (presetId === "off-1") {
    return { format: "noop", tiers: [{ id: "off", action: "omit" }] };
  }
  const effectiveFormat: StructuredThinkingFormat =
    presetId === "toggle-2" && format === "noop" ? "openai" : format;
  return {
    format: effectiveFormat,
    tiers: PRESET_LEVELS[presetId].map((id) => buildTierEntryForFormat(id, effectiveFormat)),
  };
}

export function convertThinkingProfileFormat(
  profile: ThinkingProfile,
  nextFormat: ThinkingFormat,
): ThinkingProfile {
  if (nextFormat === "custom-cel") {
    const compiled =
      profile.format === "custom-cel" && profile.customCel
        ? profile.customCel
        : compileThinkingProfileToOptionSpec(profile).map;
    return {
      format: "custom-cel",
      tiers: profile.tiers,
      customCel: compiled,
    };
  }
  return {
    format: nextFormat,
    tiers: profile.tiers.map((tier) => {
      if (nextFormat === "noop") return { id: tier.id, action: "omit" };
      if (tier.action === "omit") {
        // 保留用户显式省略参数的意图（除纯 noop/toggle 切回外）
        return profile.format === "noop"
          ? buildTierEntryForFormat(tier.id, nextFormat)
          : { id: tier.id, action: "omit" };
      }
      const preservedWire =
        tier.action === "value" && tier.wireValue?.trim() ? tier.wireValue.trim() : undefined;
      if (nextFormat === "anthropic-budget") {
        return tier.action === "disabled" || isOffThinkingLevel(tier.id)
          ? { id: tier.id, action: "disabled" }
          : {
              id: tier.id,
              action: "budget",
              budgetTokens: tier.budgetTokens ?? defaultThinkingBudgetForLevel(tier.id),
            };
      }
      if (tier.action === "disabled") {
        if (nextFormat === "openai" || nextFormat === "openai-responses") {
          return { id: tier.id, action: "value", wireValue: "none" };
        }
        return { id: tier.id, action: "disabled" };
      }
      return buildTierEntryForFormat(tier.id, nextFormat, preservedWire);
    }),
  };
}

function celString(value: string): string {
  return JSON.stringify(value);
}

function renderTierObjectCel(
  format: StructuredThinkingFormat,
  tier: ThinkingTierEntry,
): string {
  if (format === "noop" || tier.action === "omit") {
    return "{}";
  }
  const wire = (tier.wireValue?.trim() || tier.id).trim();
  const budget =
    typeof tier.budgetTokens === "number" &&
    Number.isInteger(tier.budgetTokens) &&
    tier.budgetTokens > 0
      ? tier.budgetTokens
      : defaultThinkingBudgetForLevel(tier.id);

  switch (format) {
    case "openai":
      if (tier.action === "disabled") return `{ "reasoning_effort": "none" }`;
      return `{ "reasoning_effort": ${celString(wire)} }`;
    case "openai-responses":
      if (tier.action === "disabled") return `{ "reasoning": { "effort": "none" } }`;
      return `{ "reasoning": { "effort": ${celString(wire)} } }`;
    case "openrouter":
      if (tier.action === "disabled") return `{ "reasoning": { "enabled": false } }`;
      return `{ "reasoning": { "effort": ${celString(wire)} } }`;
    case "anthropic-adaptive":
      if (tier.action === "disabled") return `{ "thinking": { "type": "disabled" } }`;
      return `{ "thinking": { "type": "adaptive" }, "output_config": { "effort": ${celString(wire)} } }`;
    case "anthropic-budget":
      if (tier.action === "disabled") return `{ "thinking": { "type": "disabled" } }`;
      return `{ "thinking": { "type": "enabled", "budget_tokens": ${budget} } }`;
    case "deepseek":
      if (tier.action === "disabled") return `{ "thinking": { "type": "disabled" } }`;
      return `{ "thinking": { "type": "enabled" }, "reasoning_effort": ${celString(wire)} }`;
    case "zai":
      return tier.action === "disabled"
        ? `{ "thinking": { "type": "disabled" } }`
        : `{ "thinking": { "type": "enabled" } }`;
    case "qwen":
      if (tier.action === "disabled") return `{ "enable_thinking": false }`;
      if (tier.action === "budget") {
        return `{ "enable_thinking": true, "thinking_budget": ${budget} }`;
      }
      return `{ "enable_thinking": true }`;
    case "qwen-chat-template":
      return tier.action === "disabled"
        ? `{ "chat_template_kwargs": { "enable_thinking": false } }`
        : `{ "chat_template_kwargs": { "enable_thinking": true } }`;
  }
}

function renderIdentityExpressionCel(format: StructuredThinkingFormat): string | null {
  switch (format) {
    case "openai":
      return `{ "reasoning_effort": reasoningLevel }`;
    case "openai-responses":
    case "openrouter":
      return `{ "reasoning": { "effort": reasoningLevel } }`;
    case "anthropic-adaptive":
      return `{ "thinking": { "type": "adaptive" }, "output_config": { "effort": reasoningLevel } }`;
    case "deepseek":
      return `{ "thinking": { "type": "enabled" }, "reasoning_effort": reasoningLevel }`;
    default:
      return null;
  }
}

export function compileThinkingProfileToOptionSpec(profile: ThinkingProfile): {
  readonly values: readonly string[];
  readonly map: string;
} {
  const dedupedTiers: ThinkingTierEntry[] = [];
  const seen = new Set<string>();
  for (const tier of profile.tiers) {
    const id = tier.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    dedupedTiers.push({ ...tier, id });
  }
  const tiers =
    dedupedTiers.length > 0 ? dedupedTiers : [{ id: "off", action: "omit" as const }];
  const values = tiers.map((tier) => tier.id);

  if (profile.format === "custom-cel") {
    return {
      values,
      map: profile.customCel?.trim() || "{}",
    };
  }

  const format = profile.format;
  if (format === "noop") {
    return { values, map: "{}" };
  }

  // 快速路径：检查所有 value 档位是否满足 wireValue === id，可生成简洁可读的 CEL。
  const identityExpr = renderIdentityExpressionCel(format);
  if (identityExpr) {
    const nonIdentity = tiers.filter(
      (tier) => tier.action !== "value" || (tier.wireValue?.trim() || tier.id) !== tier.id,
    );
    if (nonIdentity.length === 0) {
      return { values, map: identityExpr };
    }
    if (nonIdentity.length < tiers.length) {
      const grouped = new Map<string, string[]>();
      for (const tier of nonIdentity) {
        const objCel = renderTierObjectCel(format, tier);
        const list = grouped.get(objCel) ?? [];
        list.push(tier.id);
        grouped.set(objCel, list);
      }
      const clauses = [...grouped.entries()].map(([objCel, ids]) => {
        const cond = ids.map((id) => `reasoningLevel == ${celString(id)}`).join(" || ");
        return `${cond} ? ${objCel}`;
      });
      return {
        values,
        map: `${clauses.join(" : ")} : ${identityExpr}`,
      };
    }
  }

  // 通用路径：按求值对象聚合相同输出，生成顶层为 object / conditional-of-objects 的受限 CEL。
  const groups: { objCel: string; ids: string[] }[] = [];
  for (const tier of tiers) {
    const objCel = renderTierObjectCel(format, tier);
    const existing = groups.find((group) => group.objCel === objCel);
    if (existing) {
      existing.ids.push(tier.id);
    } else {
      groups.push({ objCel, ids: [tier.id] });
    }
  }
  if (groups.length === 1) {
    return { values, map: groups[0]!.objCel };
  }
  const parts: string[] = [];
  for (let index = 0; index < groups.length - 1; index += 1) {
    const group = groups[index]!;
    const cond = group.ids.map((id) => `reasoningLevel == ${celString(id)}`).join(" || ");
    parts.push(`${cond} ? ${group.objCel}`);
  }
  parts.push(groups.at(-1)!.objCel);
  return {
    values,
    map: parts.join(" : "),
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === allowed.length && allowed.every((key) => key in record);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isThinkingTypePatch(patch: Record<string, unknown>, type: string): boolean {
  return (
    hasExactKeys(patch, ["thinking"]) &&
    isPlainRecord(patch.thinking) &&
    hasExactKeys(patch.thinking, ["type"]) &&
    patch.thinking.type === type
  );
}

/**
 * 通过复用 @zcode/model-option-map 真实求值器反编译现有 (values, map)，
 * 无损识别 Pi 风格协议格式与每档独立映射；无法归类的复杂 CEL 自动回落 custom-cel。
 */
export function parseOptionSpecToThinkingProfile(
  values: readonly string[],
  map: string | undefined,
  apiType?: string | null,
): ThinkingProfile {
  const cleanValues = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  const trimmedMap = map?.trim() ?? "";
  if (cleanValues.length === 0 || !trimmedMap) {
    const fallbackFormat = resolveDefaultThinkingFormat(apiType);
    return {
      format: "custom-cel",
      tiers: cleanValues.map((id) => buildTierEntryForFormat(id, fallbackFormat)),
      customCel: trimmedMap,
    };
  }

  let evaluated: { id: string; patch: Record<string, unknown> }[];
  try {
    const program = compileModelOptionMap(trimmedMap, "reasoningLevel");
    evaluated = cleanValues.map((id) => ({
      id,
      patch: program.evaluate(id) as Record<string, unknown>,
    }));
  } catch {
    return {
      format: "custom-cel",
      tiers: cleanValues.map((id) => ({ id, action: "value", wireValue: id })),
      customCel: trimmedMap,
    };
  }

  const nonEmpty = evaluated.filter((item) => Object.keys(item.patch).length > 0);
  if (nonEmpty.length === 0) {
    return { format: "noop", tiers: evaluated.map(({ id }) => ({ id, action: "omit" })) };
  }

  const mapTiers = (
    mapper: (id: string, patch: Record<string, unknown>) => ThinkingTierEntry,
  ): ThinkingTierEntry[] =>
    evaluated.map(({ id, patch }) =>
      Object.keys(patch).length === 0 ? { id, action: "omit" } : mapper(id, patch),
    );

  // 1) openai: { reasoning_effort }
  if (
    nonEmpty.every(
      ({ patch }) =>
        hasExactKeys(patch, ["reasoning_effort"]) && typeof patch.reasoning_effort === "string",
    )
  ) {
    return {
      format: "openai",
      tiers: mapTiers((id, patch) => ({
        id,
        action: "value",
        wireValue: String(patch.reasoning_effort),
      })),
    };
  }

  // 2) openai-responses / openrouter: { reasoning: { effort } | { enabled: false } }
  if (
    nonEmpty.every(({ patch }) => {
      if (!hasExactKeys(patch, ["reasoning"]) || !isPlainRecord(patch.reasoning)) return false;
      const r = patch.reasoning;
      return (
        (hasExactKeys(r, ["effort"]) && typeof r.effort === "string") ||
        (hasExactKeys(r, ["enabled"]) && r.enabled === false)
      );
    })
  ) {
    const hasDisabledBool = nonEmpty.some(
      ({ patch }) => (patch.reasoning as Record<string, unknown>).enabled === false,
    );
    const format: StructuredThinkingFormat = hasDisabledBool
      ? "openrouter"
      : apiType === "openai-responses"
        ? "openai-responses"
        : "openrouter";
    return {
      format,
      tiers: mapTiers((id, patch) => {
        const r = patch.reasoning as Record<string, unknown>;
        return r.enabled === false
          ? { id, action: "disabled" }
          : { id, action: "value", wireValue: String(r.effort) };
      }),
    };
  }

  // 3) anthropic-adaptive
  if (
    nonEmpty.some(({ patch }) => "output_config" in patch) &&
    nonEmpty.every(
      ({ patch }) =>
        isThinkingTypePatch(patch, "disabled") ||
        (hasExactKeys(patch, ["thinking", "output_config"]) &&
          isPlainRecord(patch.thinking) &&
          hasExactKeys(patch.thinking, ["type"]) &&
          patch.thinking.type === "adaptive" &&
          isPlainRecord(patch.output_config) &&
          hasExactKeys(patch.output_config, ["effort"]) &&
          typeof patch.output_config.effort === "string"),
    )
  ) {
    return {
      format: "anthropic-adaptive",
      tiers: mapTiers((id, patch) =>
        "output_config" in patch
          ? {
              id,
              action: "value",
              wireValue: String((patch.output_config as Record<string, unknown>).effort),
            }
          : { id, action: "disabled" },
      ),
    };
  }

  // 4) anthropic-budget
  if (
    nonEmpty.some(({ patch }) => isPlainRecord(patch.thinking) && "budget_tokens" in patch.thinking) &&
    nonEmpty.every(({ patch }) => {
      if (!hasExactKeys(patch, ["thinking"]) || !isPlainRecord(patch.thinking)) return false;
      const t = patch.thinking;
      return (
        (hasExactKeys(t, ["type"]) && t.type === "disabled") ||
        (hasExactKeys(t, ["type", "budget_tokens"]) &&
          t.type === "enabled" &&
          isPositiveInt(t.budget_tokens))
      );
    })
  ) {
    return {
      format: "anthropic-budget",
      tiers: mapTiers((id, patch) => {
        const t = patch.thinking as Record<string, unknown>;
        return t.type === "disabled"
          ? { id, action: "disabled" }
          : { id, action: "budget", budgetTokens: Number(t.budget_tokens) };
      }),
    };
  }

  // 5) deepseek
  if (
    nonEmpty.some(({ patch }) => "reasoning_effort" in patch) &&
    nonEmpty.every(
      ({ patch }) =>
        isThinkingTypePatch(patch, "disabled") ||
        (hasExactKeys(patch, ["thinking", "reasoning_effort"]) &&
          isPlainRecord(patch.thinking) &&
          hasExactKeys(patch.thinking, ["type"]) &&
          patch.thinking.type === "enabled" &&
          typeof patch.reasoning_effort === "string"),
    )
  ) {
    return {
      format: "deepseek",
      tiers: mapTiers((id, patch) =>
        "reasoning_effort" in patch
          ? { id, action: "value", wireValue: String(patch.reasoning_effort) }
          : { id, action: "disabled" },
      ),
    };
  }

  // 6) zai
  if (
    nonEmpty.every(
      ({ patch }) => isThinkingTypePatch(patch, "enabled") || isThinkingTypePatch(patch, "disabled"),
    )
  ) {
    return {
      format: "zai",
      tiers: mapTiers((id, patch) => ({
        id,
        action:
          (patch.thinking as Record<string, unknown>).type === "disabled" ? "disabled" : "enabled",
      })),
    };
  }

  // 7) qwen
  if (
    nonEmpty.every(
      ({ patch }) =>
        (hasExactKeys(patch, ["enable_thinking"]) && typeof patch.enable_thinking === "boolean") ||
        (hasExactKeys(patch, ["enable_thinking", "thinking_budget"]) &&
          patch.enable_thinking === true &&
          isPositiveInt(patch.thinking_budget)),
    )
  ) {
    return {
      format: "qwen",
      tiers: mapTiers((id, patch) =>
        patch.enable_thinking === false
          ? { id, action: "disabled" }
          : isPositiveInt(patch.thinking_budget)
            ? { id, action: "budget", budgetTokens: patch.thinking_budget }
            : { id, action: "enabled" },
      ),
    };
  }

  // 8) qwen-chat-template
  if (
    nonEmpty.every(
      ({ patch }) =>
        hasExactKeys(patch, ["chat_template_kwargs"]) &&
        isPlainRecord(patch.chat_template_kwargs) &&
        hasExactKeys(patch.chat_template_kwargs, ["enable_thinking"]) &&
        typeof patch.chat_template_kwargs.enable_thinking === "boolean",
    )
  ) {
    return {
      format: "qwen-chat-template",
      tiers: mapTiers((id, patch) => ({
        id,
        action: (patch.chat_template_kwargs as Record<string, unknown>).enable_thinking
          ? "enabled"
          : "disabled",
      })),
    };
  }

  return {
    format: "custom-cel",
    tiers: evaluated.map(({ id }) => ({ id, action: "value", wireValue: id })),
    customCel: trimmedMap,
  };
}

/**
 * 借鉴 Pi 的 clampThinkingLevel：跨不同档位模型切换时按 7 档语义阶梯寻找最接近的可用档位。
 */
export function clampReasoningLevel(
  requestedLevel: string | undefined,
  availableValues: readonly string[],
): string | undefined {
  if (availableValues.length === 0) return undefined;
  if (!requestedLevel) return availableValues.at(-1);
  if (availableValues.includes(requestedLevel)) return requestedLevel;

  const normalizedRequested = requestedLevel.trim().toLowerCase();
  const exactCaseInsensitive = availableValues.find(
    (value) => value.trim().toLowerCase() === normalizedRequested,
  );
  if (exactCaseInsensitive) return exactCaseInsensitive;

  const requestedRank = CANONICAL_ALIAS_INDEX[normalizedRequested];
  if (requestedRank === undefined) return availableValues.at(-1);

  const rankedAvailable = availableValues
    .map((value, index) => ({
      value,
      index,
      rank: CANONICAL_ALIAS_INDEX[value.trim().toLowerCase()],
    }))
    .filter((entry): entry is { value: string; index: number; rank: number } => entry.rank !== undefined);

  if (rankedAvailable.length === 0) return availableValues.at(-1);

  const sameRank = rankedAvailable.find((entry) => entry.rank === requestedRank);
  if (sameRank) return sameRank.value;

  // 优先向更高一档靠拢，其次向更低一档回退（与 Pi clampThinkingLevel 一致）
  const higher = rankedAvailable
    .filter((entry) => entry.rank > requestedRank)
    .sort((a, b) => a.rank - b.rank)[0];
  if (higher) return higher.value;

  const lower = rankedAvailable
    .filter((entry) => entry.rank < requestedRank)
    .sort((a, b) => b.rank - a.rank)[0];
  return lower?.value ?? availableValues.at(-1);
}

const NON_THINKING_MODEL_RE =
  /(?:^|[/:_-])(?:gpt-image|dall-e|whisper|tts|text-embedding|embedding|moderation|omni-moderation|nano-banana|codex-auto-review)(?:$|[/:._-])|(?:^|[/:_-])image(?:$|[/:._-])/iu;

const FIXED_SUFFIX_RE = /-(minimal|low|medium|high|xhigh)$/iu;

function makeFamilyProfile(
  levels: readonly string[],
  format: StructuredThinkingFormat,
  wireOverrides?: Readonly<Record<string, string>>,
): ThinkingProfile {
  return {
    format,
    tiers: levels.map((id) => buildTierEntryForFormat(id, format, wireOverrides?.[id])),
  };
}

interface ThinkingFamilyRule {
  readonly pattern: RegExp;
  readonly levels: readonly string[];
  readonly format?: (apiType: string | null | undefined, defaultFormat: StructuredThinkingFormat) => StructuredThinkingFormat;
}

const THINKING_FAMILY_RULES: readonly ThinkingFamilyRule[] = [
  // OpenAI GPT-5.6 / GPT-6 / GPT-5.x / o-series
  { pattern: /(?:gpt-5\.6|gpt-6-luna|gpt-6\.1-terra)/iu, levels: ["none", "low", "medium", "high", "xhigh", "max"] },
  { pattern: /(?:gpt-6-astra|gpt-6\.1-sol)/iu, levels: ["low", "medium", "high", "xhigh", "max"] },
  { pattern: /gpt-6-chat-thinking/iu, levels: ["low", "medium", "high", "xhigh"] },
  { pattern: /gpt-5\.[45]-pro/iu, levels: ["medium", "high", "xhigh"] },
  { pattern: /gpt-5\.[23]-codex|gpt-5\.5/iu, levels: ["low", "medium", "high", "xhigh"] },
  { pattern: /gpt-5\.[124]/iu, levels: ["none", "low", "medium", "high", "xhigh"] },
  { pattern: /(?:^|[/:_-])gpt-5(?:$|-(?:mini|nano))/iu, levels: ["minimal", "low", "medium", "high"] },
  { pattern: /(?:^|[/:_-])o[134](?:$|[/:._-])/iu, levels: ["low", "medium", "high"] },
  // Anthropic Claude 5 / 4.6 / 3.7–4.5
  { pattern: /claude-(?:opus|sonnet|fable|mythos|haiku)-5/iu, levels: ["low", "medium", "high", "xhigh", "max"], format: (api, def) => (api === "anthropic-messages" ? "anthropic-adaptive" : def) },
  { pattern: /claude-(?:opus|sonnet)-4[.-]6/iu, levels: ["off", "low", "medium", "high", "max"], format: (api, def) => (api === "anthropic-messages" ? "anthropic-adaptive" : def) },
  { pattern: /claude-(?:3[.-]7|(?:opus|sonnet|haiku)-4(?:[.-][015])?(?:$|[/:._-]))/iu, levels: ["off", "minimal", "low", "medium", "high"], format: (api, def) => (api === "anthropic-messages" ? "anthropic-budget" : def) },
  // Google Gemini 4 / 3 / 2.5
  { pattern: /gemini-4/iu, levels: ["low", "medium", "high", "xhigh"], format: (api, def) => (api === "anthropic-messages" ? "anthropic-budget" : def) },
  { pattern: /gemini-(?:2\.5|3(?:\.\d+)?)-flash/iu, levels: ["none", "minimal", "low", "medium", "high"], format: (api, def) => (api === "anthropic-messages" ? "anthropic-budget" : def) },
  { pattern: /gemini-(?:2\.5|3(?:\.\d+)?)-pro/iu, levels: ["minimal", "low", "medium", "high"], format: (api, def) => (api === "anthropic-messages" ? "anthropic-budget" : def) },
  // DeepSeek
  { pattern: /deepseek-(?:v4|flash)/iu, levels: ["disabled", "low", "high", "max"], format: (api, def) => (api === "openai-chat-completions" ? "deepseek" : def) },
  { pattern: /deepseek-(?:r1|reasoner)/iu, levels: ["enabled"], format: () => "noop" },
  { pattern: /deepseek-v3\.[12]/iu, levels: ["disabled", "enabled"], format: (api, def) => (api === "openai-chat-completions" ? "zai" : def) },
  // Qwen
  { pattern: /qwen3\.8-omni/iu, levels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"] },
  { pattern: /qwen3\.8/iu, levels: ["low", "medium", "xhigh"] },
  { pattern: /(?:qwen3(?:\.[0-7])?|qwq)/iu, levels: ["disabled", "enabled"], format: (api, def) => (api === "openai-chat-completions" ? "qwen" : def) },
  // Grok / GLM / Kimi / MiniMax
  { pattern: /grok-4\.[67]/iu, levels: ["low", "medium", "high", "xhigh"] },
  { pattern: /grok-3-mini/iu, levels: ["low", "high"] },
  { pattern: /glm-5\.3|kimi-k3/iu, levels: ["low", "high", "max"] },
  { pattern: /glm-5\.2/iu, levels: ["disabled", "high", "max"] },
  { pattern: /minimax-m3\.1/iu, levels: ["low", "medium", "high", "xhigh", "max"] },
  { pattern: /glm-(?:4\.[567]|5(?:\.[01])?(?:$|-turbo|-v))|kimi-k2/iu, levels: ["disabled", "enabled"], format: (api, def) => (api === "openai-chat-completions" ? "zai" : def) },
];

/**
 * 按「服务端元数据 > 非思考模型 > 代理固定后缀 > 主流模型家族规则」推断 Pi 风格思考强度配置。
 */
export function inferThinkingProfileForModel(input: {
  readonly modelId: string;
  readonly apiType?: string | null;
  readonly baseUrl?: string | null;
  readonly remoteEntry?: {
    readonly reasoningLevels?: readonly string[];
    readonly supportsReasoning?: boolean;
  };
}): InferredThinkingProfile {
  const lower = input.modelId.trim().toLowerCase();
  const defaultFormat = resolveDefaultThinkingFormat(input.apiType, input.baseUrl);

  const advertisedLevels = [
    ...new Set((input.remoteEntry?.reasoningLevels ?? []).map((v) => v.trim()).filter(Boolean)),
  ];
  if (advertisedLevels.length > 0) {
    return { source: "remote-metadata", profile: makeFamilyProfile(advertisedLevels, defaultFormat) };
  }
  if (input.remoteEntry?.supportsReasoning === false) {
    return { source: "remote-metadata", profile: { format: "noop", tiers: [{ id: "off", action: "omit" }] } };
  }
  if (NON_THINKING_MODEL_RE.test(lower)) {
    return { source: "non-thinking", profile: { format: "noop", tiers: [{ id: "off", action: "omit" }] } };
  }
  for (const rule of THINKING_FAMILY_RULES) {
    if (rule.pattern.test(lower)) {
      const format = rule.format ? rule.format(input.apiType, defaultFormat) : defaultFormat;
      return { source: "model-rule", profile: makeFamilyProfile(rule.levels, format) };
    }
  }
  // 代理网关常见默认强度后缀（如 *-medium / *-high / *-xhigh）：仅代表不传参数时的默认强度，
  // 仍支持显式传入 reasoning_effort 切换多档，因此按后缀上限推导多档而非锁死为单档。
  const suffixMatch = lower.match(FIXED_SUFFIX_RE);
  if (suffixMatch) {
    const suffix = suffixMatch[1]!.toLowerCase();
    const levels =
      suffix === "xhigh"
        ? ["low", "medium", "high", "xhigh"]
        : suffix === "minimal"
          ? ["minimal", "low", "medium", "high"]
          : ["low", "medium", "high"];
    return {
      source: "fixed-suffix",
      profile: makeFamilyProfile(levels, defaultFormat),
    };
  }
  return { source: "builtin", profile: null };
}
