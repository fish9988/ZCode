import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACP_STATUS_TOOL_NAME,
  COMPRESS_TOOL_NAME,
  DECOMPRESS_TOOL_NAME,
  SEARCH_CONTEXT_TOOL_NAME,
  blockById,
  blockDocs,
  buildStatusReport,
  collectBlockContent,
  createCore,
  createInitialState,
  defaultConfig,
  defaultCountTokens,
  markBlockRestoredInline,
  messageDocs,
  parseBlockIdArg,
  parseCompressArgs,
  refForRaw,
  searchBlocks,
  type CompressionCore,
  type CompressionState,
  type Config as AcpConfig,
  type CoreMessage,
  type MessageInput,
} from "acp-kernel";
import type { Logger, SessionEntryInfo, SessionId, SessionStorePort } from "@zcode/contracts";
import {
  resolveEffectiveCompressionWindow,
  type AutoCompactPolicyConfig,
} from "../compact/policy.js";
import {
  coreMessagesToRuntimeEntries,
  runtimeEntriesToCoreMessages,
} from "./acp-message-bridge.js";
import {
  SESSION_ENTRY_ACP_COMPRESSION_STATE,
  type AcpCompressToolResult,
  type AcpDecompressToolResult,
  type AcpPrepareTurnInput,
  type AcpPrepareTurnResult,
  type AcpSearchContextToolResult,
  type AcpSessionController,
  type AcpStatusToolResult,
} from "./contract.js";

interface PersistedAcpStatePayload {
  readonly version: 1;
  readonly branchGeneration: number;
  readonly cleared?: boolean;
  readonly state?: CompressionState;
}

const MAX_INLINE_DECOMPRESS_CHARS = 32_000;

function acpEntryIdForSession(sessionId: SessionId): string {
  return `${sessionId}:runtime-acp-compression-state`;
}

function buildAcpConfig(
  compactConfig: AutoCompactPolicyConfig | undefined,
  modelContextWindow: number,
  modelEffectiveWindow?: number | null,
): AcpConfig {
  const effectiveWindow = resolveEffectiveCompressionWindow({
    contextWindow: modelContextWindow,
    effectiveContextWindow: modelEffectiveWindow,
    defaultEffectiveContextWindow: compactConfig?.defaultEffectiveContextWindow,
  });
  const bili = compactConfig?.billionContext;
  const minPct = bili?.minContextLimitPct ?? 0.45;
  const maxPct = Math.max(minPct, bili?.maxContextLimitPct ?? 0.75);
  const emergencyPct = Math.max(maxPct, bili?.emergencyThresholdPct ?? 0.95);
  const growthFloor = bili?.growthFloorTokens ?? 50_000;
  return defaultConfig(effectiveWindow, {
    nudge: {
      minContextLimitPct: minPct,
      maxContextLimitPct: maxPct,
      emergencyThresholdPct: emergencyPct,
      growthFloor,
      growthCap: Math.max(growthFloor, 50_000),
      frequency: 5,
      iterationThreshold: 15,
      force: "soft",
      growthRatio: 0.05,
      minGrowthFloor: Math.min(20_000, Math.floor(growthFloor * 0.5)),
      minGrowthRatio: 0.45,
      tier2GrowthMultiplier: 1.5,
      requireUsageSampleForPressure: false,
      maxEstimateHoldRounds: 2,
    },
    preserveRecentMessages: bili?.preserveRecentMessages ?? 3,
    preserveRecentTokens: bili?.preserveRecentTokens ?? 20_000,
    protectedTools: [
      COMPRESS_TOOL_NAME,
      DECOMPRESS_TOOL_NAME,
      SEARCH_CONTEXT_TOOL_NAME,
      ACP_STATUS_TOOL_NAME,
    ],
  });
}

function resolveNudgeProtocol(apiType?: string): "anthropic" | "openai" | "responses" {
  if (apiType === "anthropic-messages") return "anthropic";
  if (apiType === "openai-responses") return "responses";
  return "openai";
}

export function createAcpSessionController(options: {
  readonly sessionId: SessionId;
  readonly getCompactConfig: () => AutoCompactPolicyConfig | undefined;
  readonly getSessionStore?: () => SessionStorePort | undefined;
  readonly logger?: Logger;
}): AcpSessionController {
  const core: CompressionCore = createCore();
  let state: CompressionState = createInitialState();
  let currentBranchGeneration = 0;
  let lastCoreMessages: CoreMessage[] = [];
  let lastConfig: AcpConfig = buildAcpConfig(options.getCompactConfig(), 200_000);
  let lastTokenCount = 0;

  const persistState = async (
    sessionStore: SessionStorePort | undefined,
    cleared = false,
  ): Promise<void> => {
    if (!sessionStore?.saveSessionEntry) return;
    const now = Date.now();
    const payload: PersistedAcpStatePayload = cleared
      ? { version: 1, branchGeneration: currentBranchGeneration, cleared: true }
      : { version: 1, branchGeneration: currentBranchGeneration, state };
    try {
      await sessionStore.saveSessionEntry({
        id: acpEntryIdForSession(options.sessionId),
        sessionID: options.sessionId,
        type: SESSION_ENTRY_ACP_COMPRESSION_STATE,
        touchSession: false,
        time: { created: now, updated: now },
        data: payload,
      });
    } catch (error) {
      options.logger?.warn("Failed to persist acp-kernel compression state", {
        event: "acp.state.persist_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return {
    isEnabled(): boolean {
      return options.getCompactConfig()?.engine === "billion-context";
    },

    async loadFromStore(
      sessionStore: SessionStorePort | undefined,
      branchGeneration: number,
    ): Promise<void> {
      currentBranchGeneration = branchGeneration;
      if (!sessionStore?.sessionEntries) return;
      try {
        const entries = await sessionStore.sessionEntries({
          sessionID: options.sessionId,
          type: SESSION_ENTRY_ACP_COMPRESSION_STATE,
        });
        const latest = entries.at(-1);
        const data = latest?.data as PersistedAcpStatePayload | undefined;
        if (
          data &&
          data.version === 1 &&
          !data.cleared &&
          data.branchGeneration === branchGeneration &&
          data.state
        ) {
          state = data.state;
          return;
        }
      } catch (error) {
        options.logger?.warn("Failed to load acp-kernel compression state; starting fresh", {
          event: "acp.state.load_failed",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
      state = createInitialState();
    },

    async resetForRewind(
      sessionStore: SessionStorePort | undefined,
      branchGeneration: number,
    ): Promise<void> {
      currentBranchGeneration = branchGeneration;
      state = createInitialState();
      lastCoreMessages = [];
      await persistState(sessionStore ?? options.getSessionStore?.(), true);
    },

    buildForkEntry(forkedSessionId: SessionId): SessionEntryInfo | null {
      if (state.blocks.length === 0 && Object.keys(state.messageRefs).length === 0) {
        return null;
      }
      const now = Date.now();
      return {
        id: acpEntryIdForSession(forkedSessionId),
        sessionID: forkedSessionId,
        type: SESSION_ENTRY_ACP_COMPRESSION_STATE,
        touchSession: false,
        time: { created: now, updated: now },
        data: {
          version: 1,
          branchGeneration: 0,
          state: structuredClone(state),
        } satisfies PersistedAcpStatePayload,
      };
    },

    async prepareTurnEntries(
      input: AcpPrepareTurnInput,
      sessionStore?: SessionStorePort,
    ): Promise<AcpPrepareTurnResult> {
      const compactConfig = input.compactConfig ?? options.getCompactConfig();
      const config = buildAcpConfig(
        compactConfig,
        input.model.properties.contextWindow,
        input.model.properties.effectiveContextWindow,
      );
      lastConfig = config;
      lastTokenCount = input.tokenCount;

      const mapping = runtimeEntriesToCoreMessages(input.entries);
      lastCoreMessages = mapping.coreMessages;

      const turnResult = core.processTurn({
        messages: mapping.coreMessages,
        state,
        config,
        tokenCount: input.tokenCount,
        tokenCountSource: input.tokenCountSource,
        renderTags: "text-only",
      });
      state = turnResult.state;
      await persistState(sessionStore ?? options.getSessionStore?.());

      const projected = coreMessagesToRuntimeEntries({
        mapping,
        renderedMessages: turnResult.messages,
        nudge: turnResult.nudge,
        protocol: resolveNudgeProtocol(input.model.providerId),
      });
      return {
        entries: projected.entries,
        nudgeInjected: projected.nudgeInjected,
        activeBlockCount: state.blocks.filter((b) => b.active).length,
      };
    },

    async executeCompress(input: unknown, toolCallId?: string): Promise<AcpCompressToolResult> {
      const parsed = parseCompressArgs(input, { callId: toolCallId });
      if (!parsed.diagnostics.ok || parsed.ranges.length === 0) {
        const reason =
          parsed.diagnostics.invalidReasons?.join("; ") ||
          `Unable to parse compress ranges (${parsed.diagnostics.kind}).`;
        return {
          ok: false,
          blocksCreated: 0,
          tokensCompressed: 0,
          summaryText: reason,
          errors: [reason],
          warnings: [],
        };
      }

      const applied = core.applyCompression({
        ranges: parsed.ranges,
        messages: lastCoreMessages,
        state,
        config: lastConfig,
      });
      state = applied.state;
      await persistState(options.getSessionStore?.());

      const { blocksCreated, tokensCompressed, errors, warnings } = applied.result;
      const lines: string[] = [];
      if (blocksCreated > 0) {
        lines.push(
          `Compressed ${blocksCreated} range(s), reclaiming ~${tokensCompressed.toLocaleString()} tokens. Active blocks: ${state.blocks.filter((b) => b.active).length}.`,
        );
      }
      if (warnings.length > 0) {
        lines.push(`Warnings:\n- ${warnings.join("\n- ")}`);
      }
      if (errors.length > 0) {
        lines.push(`Errors:\n- ${errors.join("\n- ")}`);
      }
      return {
        ok: blocksCreated > 0 || errors.length === 0,
        blocksCreated,
        tokensCompressed,
        summaryText: lines.join("\n") || "No ranges compressed.",
        errors,
        warnings,
      };
    },

    async executeDecompress(input: {
      readonly blockId: string;
      readonly toFile?: boolean;
      readonly full?: boolean;
    }): Promise<AcpDecompressToolResult> {
      const blockId = parseBlockIdArg(input.blockId) ?? input.blockId.trim();
      const block = blockById(state, blockId);
      if (!block) {
        return {
          ok: false,
          blockId,
          mode: input.toFile ? "file" : "inline",
          content: "",
          messageCount: 0,
          error: `Block ${blockId} not found. Run acp_status to inspect active blocks.`,
        };
      }

      const collected = collectBlockContent(state, block, lastCoreMessages, {
        full: input.full === true,
      });
      const shouldWriteFile =
        input.toFile === true || collected.text.length > MAX_INLINE_DECOMPRESS_CHARS;

      if (shouldWriteFile) {
        const outDir = join(tmpdir(), "zcode-acp-decompress");
        mkdirSync(outDir, { recursive: true });
        const safeId = blockId.replace(/[^a-zA-Z0-9_-]/gu, "_");
        const filePath = join(outDir, `${options.sessionId}-${safeId}-${Date.now()}.txt`);
        writeFileSync(filePath, collected.text, "utf8");
        return {
          ok: true,
          blockId,
          mode: "file",
          filePath,
          content: `Decompressed ${blockId} (${collected.count} items, ${collected.text.length} chars) to ${filePath}. Use Read or Grep on this file without bloating prompt cache.`,
          messageCount: collected.count,
        };
      }

      const marked = markBlockRestoredInline(state, blockId);
      state = marked.state;
      await persistState(options.getSessionStore?.());
      return {
        ok: true,
        blockId,
        mode: "inline",
        content: collected.text || `(Block ${blockId} contains no recoverable text.)`,
        messageCount: collected.count,
      };
    },

    async executeSearchContext(input: {
      readonly query: string;
      readonly limit?: number;
    }): Promise<AcpSearchContextToolResult> {
      const query = input.query.trim();
      const limit = Math.max(1, Math.min(20, input.limit ?? 8));
      const blockOwnerByMessageId = new Map<string, { blockId: string; tier: number }>();
      for (const block of state.blocks) {
        if (!block.active) continue;
        for (const msgId of block.effectiveMessageIds) {
          blockOwnerByMessageId.set(msgId, { blockId: block.blockId, tier: block.tier });
        }
      }
      const msgInputs: MessageInput[] = [];
      for (const msg of lastCoreMessages) {
        if (msg.role !== "user" && msg.role !== "assistant" && msg.role !== "tool") continue;
        const text = msg.text?.trim();
        if (!text) continue;
        const ref = refForRaw(state.messageRefs, msg.id) ?? msg.id;
        const owner = blockOwnerByMessageId.get(msg.id);
        msgInputs.push({
          ref,
          role: msg.role,
          text,
          ...(owner ? { blockId: owner.blockId, tier: owner.tier } : {}),
        });
      }
      const docs = [...blockDocs(state), ...messageDocs(msgInputs)];
      const matches = searchBlocks(docs, query, { limit });
      if (matches.length === 0) {
        return {
          ok: true,
          query,
          matchCount: 0,
          summaryText: `No matches found for "${query}" across ${state.blocks.length} compressed block(s) and visible history.`,
        };
      }
      const formatted = matches
        .map((match, idx) => {
          const snippet = match.preview.replace(/\s+/gu, " ").trim().slice(0, 300);
          const ownerTag = match.blockId && match.kind === "message" ? ` in ${match.blockId}` : "";
          return `${idx + 1}. [${match.kind} ${match.ref}${ownerTag}] (score ${match.score.toFixed(2)}): ${snippet}`;
        })
        .join("\n");
      return {
        ok: true,
        query,
        matchCount: matches.length,
        summaryText: `Found ${matches.length} match(es) for "${query}":\n${formatted}`,
      };
    },

    async executeStatus(input: {
      readonly scope?: "compressed" | "uncompressed";
      readonly view?: "ranges" | "messages";
      readonly tool?: string;
      readonly sort?: "size" | "time" | "tool" | "age";
      readonly limit?: number;
    }): Promise<AcpStatusToolResult> {
      const report = buildStatusReport(state, lastCoreMessages, defaultCountTokens, {
        scope: input.scope,
        view: input.view,
        tool: input.tool,
        sort: input.sort,
        limit: input.limit,
        config: lastConfig,
        originalMessages: lastCoreMessages,
        meta: { host: "zcode-native-acp" },
      });
      const header = `Context meter: ~${lastTokenCount.toLocaleString()} / ${lastConfig.modelContextLimit.toLocaleString()} effective tokens`;
      return {
        ok: true,
        report: `${header}\n${report}`,
      };
    },
  };
}
