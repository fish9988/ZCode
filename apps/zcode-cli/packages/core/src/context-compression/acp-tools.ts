import { z } from "zod";
import {
  ACP_STATUS_TOOL_NAME,
  ACP_STATUS_TOOL_OPENAI,
  COMPRESS_TOOL_NAME,
  COMPRESS_TOOL_OPENAI,
  DECOMPRESS_TOOL_NAME,
  DECOMPRESS_TOOL_OPENAI,
  SEARCH_CONTEXT_TOOL_NAME,
  SEARCH_CONTEXT_TOOL_OPENAI,
} from "acp-kernel";
import type { JsonSchema } from "@zcode/contracts";
import type { ToolEntry, ToolExecutionContext } from "../tool/types.js";

const ACP_TOOL_TIMEOUT_MS = 10_000;
const ACP_TOOL_MAX_BYTES = 64_000;

function requirePort(context: ToolExecutionContext) {
  if (!context.acpContextCompressionPort) {
    throw new Error(
      "Billion-Context (acp-kernel) compression engine is not active in this session.",
    );
  }
  return context.acpContextCompressionPort;
}

function buildToolCommon(name: string, description: string, readOnly: boolean) {
  const sideEffectScope = readOnly ? ("none" as const) : ("session" as const);
  return {
    metadata: {
      name,
      description,
      readOnly,
      destructive: false,
      concurrentSafe: readOnly,
      timeoutMs: ACP_TOOL_TIMEOUT_MS,
      maxOutputBytes: ACP_TOOL_MAX_BYTES,
      sideEffectScope,
      riskLevel: "low" as const,
      needsApproval: false,
      allowedInPlanMode: true,
      shouldDefer: false,
    },
    permission: {
      permission: `acp_${name}`,
      reason: `Billion-Context ${name} operates only on in-session context compression state`,
      riskLevel: "low" as const,
      sideEffectScope,
      needsApproval: false,
      patternSources: ["toolName"] as Array<"toolName">,
      alwaysAllowPatternSources: ["toolName"] as Array<"toolName">,
      denyPriority: "beforeAsk" as const,
    },
    resultBudget: {
      maxInlineBytes: ACP_TOOL_MAX_BYTES,
      maxModelBytes: ACP_TOOL_MAX_BYTES,
      strategy: "truncate" as const,
      preview: {
        maxBytes: ACP_TOOL_MAX_BYTES,
        direction: "head" as const,
      },
    },
    timeout: {
      kind: "timed" as const,
      defaultMs: ACP_TOOL_TIMEOUT_MS,
      maxMs: ACP_TOOL_TIMEOUT_MS,
      allowCallOverride: false,
    },
    cancellation: {
      supported: false,
      cleanup: "none" as const,
      userVisibleMessage: `ACP ${name} runs synchronously in session state and cannot be cancelled`,
    },
    trace: {
      required: true as const,
      propagateToAdapters: false,
      recordInput: "summary" as const,
      recordOutput: "summary" as const,
    },
  };
}

export const acpCompressTool: ToolEntry = {
  capability: "Fold completed conversation ranges into recoverable summary blocks (acp-kernel)",
  ...buildToolCommon(COMPRESS_TOOL_NAME, COMPRESS_TOOL_OPENAI.function.description, false),
  inputSchema: COMPRESS_TOOL_OPENAI.function.parameters as unknown as JsonSchema,
  outputSchema: {
    type: "object",
    properties: { summary: { type: "string" } },
    required: ["summary"],
  },
  runtimeInputSchema: z.record(z.string(), z.unknown()),
  runtimeOutputSchema: z.object({ summary: z.string() }),
  async handler(input, context) {
    const port = requirePort(context);
    const result = await port.executeCompress(input);
    return { summary: result.summaryText };
  },
  formatModelContent(output) {
    return (output as { summary: string }).summary;
  },
};

export const acpDecompressTool: ToolEntry = {
  capability: "Restore a previously compressed summary block on demand (acp-kernel)",
  ...buildToolCommon(DECOMPRESS_TOOL_NAME, DECOMPRESS_TOOL_OPENAI.function.description, false),
  inputSchema: DECOMPRESS_TOOL_OPENAI.function.parameters as unknown as JsonSchema,
  outputSchema: {
    type: "object",
    properties: {
      content: { type: "string" },
      filePath: { type: "string" },
    },
    required: ["content"],
  },
  runtimeInputSchema: z.object({
    blockId: z.string().min(1),
    toFile: z.boolean().optional(),
    full: z.boolean().optional(),
  }),
  runtimeOutputSchema: z.object({
    content: z.string(),
    filePath: z.string().optional(),
  }),
  async handler(input, context) {
    const port = requirePort(context);
    const parsed = input as { blockId: string; toFile?: boolean; full?: boolean };
    const result = await port.executeDecompress(parsed);
    if (!result.ok && result.error) {
      return { content: result.error };
    }
    return {
      content: result.content,
      ...(result.filePath ? { filePath: result.filePath } : {}),
    };
  },
  formatModelContent(output) {
    return (output as { content: string }).content;
  },
};

export const acpSearchContextTool: ToolEntry = {
  capability: "Search keywords across compressed summaries and folded history (acp-kernel)",
  ...buildToolCommon(
    SEARCH_CONTEXT_TOOL_NAME,
    SEARCH_CONTEXT_TOOL_OPENAI.function.description,
    true,
  ),
  inputSchema: SEARCH_CONTEXT_TOOL_OPENAI.function.parameters as unknown as JsonSchema,
  outputSchema: {
    type: "object",
    properties: { summary: { type: "string" } },
    required: ["summary"],
  },
  runtimeInputSchema: z.object({
    query: z.string().min(1),
    limit: z.number().int().positive().max(50).optional(),
  }),
  runtimeOutputSchema: z.object({ summary: z.string() }),
  async handler(input, context) {
    const port = requirePort(context);
    const parsed = input as { query: string; limit?: number };
    const result = await port.executeSearchContext(parsed);
    return { summary: result.summaryText };
  },
  formatModelContent(output) {
    return (output as { summary: string }).summary;
  },
};

export const acpStatusTool: ToolEntry = {
  capability: "Inspect context token budget, active summary blocks, and compressible ranges",
  ...buildToolCommon(ACP_STATUS_TOOL_NAME, ACP_STATUS_TOOL_OPENAI.function.description, true),
  inputSchema: ACP_STATUS_TOOL_OPENAI.function.parameters as unknown as JsonSchema,
  outputSchema: {
    type: "object",
    properties: { report: { type: "string" } },
    required: ["report"],
  },
  runtimeInputSchema: z.object({
    scope: z.enum(["compressed", "uncompressed"]).optional(),
    view: z.enum(["ranges", "messages"]).optional(),
    tool: z.string().optional(),
    sort: z.enum(["size", "time", "tool", "age"]).optional(),
    limit: z.number().int().positive().max(200).optional(),
  }),
  runtimeOutputSchema: z.object({ report: z.string() }),
  async handler(input, context) {
    const port = requirePort(context);
    const parsed = input as {
      scope?: "compressed" | "uncompressed";
      view?: "ranges" | "messages";
      tool?: string;
      sort?: "size" | "time" | "tool" | "age";
      limit?: number;
    };
    const result = await port.executeStatus(parsed);
    return { report: result.report };
  },
  formatModelContent(output) {
    return (output as { report: string }).report;
  },
};

export const ACP_CONTEXT_TOOLS: readonly ToolEntry[] = [
  acpCompressTool,
  acpDecompressTool,
  acpSearchContextTool,
  acpStatusTool,
];
