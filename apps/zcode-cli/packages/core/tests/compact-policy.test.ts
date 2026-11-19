import { existsSync, readFileSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CompactTrigger, type Model, type SessionEntryInfo, type SessionId } from "@zcode/contracts";

import {
  estimateMessageTokens,
  getAutoCompactOutputReserveTokens,
  getAutoCompactThreshold,
  getEffectiveContextWindowSize,
  resolveEffectiveCompressionWindow,
  shouldAutoCompact,
} from "../src/compact/index.js";
import {
  DSH_SUMMARIZATION_SYSTEM_PROMPT,
  appendDshFileOperationsToSummary,
  buildDshCompactSummaryRequest,
  coreMessagesToRuntimeEntries,
  createAcpSessionController,
  pruneToolResultText,
  resolveDshSummaryMaxOutputTokens,
  runtimeEntriesToCoreMessages,
  stripSupermemoryBlocks,
} from "../src/context-compression/index.js";
import { selectCompactEntries } from "../src/runtime/helpers/compact-selection.js";
import type { RuntimeMessageEntry } from "../src/agent/message-history.js";
import {
  resolveModelStepMaxOutputTokens,
  resolveNormalRequestMaxOutputTokens,
} from "../src/runtime/methods/model-token-limits.js";

const ENOUGH_MESSAGES = [
  { role: "user" as const, content: "old context" },
  { role: "assistant" as const, content: "old answer" },
];

describe("auto compact policy", () => {
  it("counts reasoning blocks in the local fallback estimate", () => {
    expect(
      estimateMessageTokens([
        {
          role: "assistant",
          content: [{ type: "reasoning", text: "r".repeat(40) }],
        },
      ]),
    ).toBe(14);
    expect(
      estimateMessageTokens([
        {
          role: "assistant",
          content: [
            { type: "text", text: "text" },
            { type: "reasoning", text: "think" },
          ],
        },
      ]),
    ).toBe(4);
  });

  it("uses reasoning-inclusive fallback only when provider usage is unavailable", () => {
    const messages = [
      { role: "user" as const, content: "u" },
      {
        role: "assistant" as const,
        content: [{ type: "reasoning" as const, text: "r".repeat(4_000) }],
      },
    ];
    const config = {
      bufferTokens: 1_000,
      contextWindow: 3_000,
      maxOutputTokens: 1_000,
      modelContextBudgetStrategy: "preflight-v1" as const,
    };

    expect(shouldAutoCompact({ config, messages })).toMatchObject({
      estimatedTokenCount: 1_335,
      reason: "above_threshold",
      shouldCompact: true,
      tokenCount: 1_335,
      tokenSource: "estimate",
    });
    expect(
      shouldAutoCompact({
        config,
        messages,
        tokenOverride: { source: "provider_usage", tokenCount: 999 },
      }),
    ).toMatchObject({
      estimatedTokenCount: 1_335,
      reason: "below_threshold",
      shouldCompact: false,
      tokenCount: 999,
      tokenSource: "provider_usage",
    });
  });

  it("uses explicit output token reserve when it is below the compact cap", () => {
    const config = {
      contextWindow: 200_000,
      maxOutputTokens: 16_000,
    };

    expect(getAutoCompactOutputReserveTokens(config)).toBe(16_000);
    expect(getEffectiveContextWindowSize(config)).toBe(184_000);
    expect(getAutoCompactThreshold(config)).toBe(171_000);
  });

  it("uses small effective output limits without raising them to the default", () => {
    const config = {
      contextWindow: 200_000,
      maxOutputTokens: 8_000,
    };

    expect(getAutoCompactOutputReserveTokens(config)).toBe(8_000);
    expect(getEffectiveContextWindowSize(config)).toBe(192_000);
    expect(getAutoCompactThreshold(config)).toBe(179_000);
  });

  it("defaults to preflight-v1 when the effective output target is unknown", () => {
    const config = {
      contextWindow: 200_000,
    };

    expect(getEffectiveContextWindowSize(config)).toBe(179_000);
    expect(getAutoCompactThreshold(config)).toBe(166_000);
  });

  it("OTB06 兼容 legacy 输入也使用 21k reserve 和 94k threshold", () => {
    const config = {
      contextWindow: 128_000,
      maxOutputTokens: 64_000,
      modelContextBudgetStrategy: "legacy" as const,
    };

    expect(getAutoCompactOutputReserveTokens(config)).toBe(21_000);
    expect(getEffectiveContextWindowSize(config)).toBe(107_000);
    expect(getAutoCompactThreshold(config)).toBe(94_000);
  });

  it("OTB08 defaults to preflight-v1, preserves 21k, and removes the 95 percent threshold", () => {
    const config = {
      contextWindow: 128_000,
      maxOutputTokens: 64_000,
    };

    expect(getAutoCompactOutputReserveTokens(config)).toBe(21_000);
    expect(getEffectiveContextWindowSize(config)).toBe(107_000);
    expect(getAutoCompactThreshold(config)).toBe(94_000);
    expect(
      shouldAutoCompact({
        config,
        messages: ENOUGH_MESSAGES,
        tokenOverride: { source: "provider_usage", tokenCount: 94_000 },
      }),
    ).toMatchObject({
      effectiveContextWindow: 107_000,
      modelContextBudgetStrategy: "preflight-v1",
      outputReserveTokens: 21_000,
      shouldCompact: true,
      threshold: 94_000,
      thresholdPercent: 100,
    });
  });

  it("keeps output reserves below 21k unchanged for preflight-v1", () => {
    const config = {
      contextWindow: 128_000,
      maxOutputTokens: 16_000,
      modelContextBudgetStrategy: "preflight-v1" as const,
    };

    expect(getAutoCompactOutputReserveTokens(config)).toBe(16_000);
    expect(getEffectiveContextWindowSize(config)).toBe(112_000);
    expect(getAutoCompactThreshold(config)).toBe(99_000);
  });

  it("兼容 legacy 输入仍以 preflight 阈值压缩并记录真实策略", () => {
    const below = shouldAutoCompact({
      config: {
        contextWindow: 128_000,
        maxOutputTokens: 32_000,
        modelContextBudgetStrategy: "legacy",
      },
      messages: ENOUGH_MESSAGES,
      tokenOverride: {
        source: "provider_usage",
        tokenCount: 93_999,
      },
    });
    const above = shouldAutoCompact({
      config: {
        contextWindow: 128_000,
        maxOutputTokens: 32_000,
        modelContextBudgetStrategy: "legacy",
      },
      messages: ENOUGH_MESSAGES,
      tokenOverride: {
        source: "provider_usage",
        tokenCount: 94_000,
      },
    });

    expect(below).toMatchObject({
      effectiveContextWindow: 107_000,
      outputReserveTokens: 21_000,
      reason: "below_threshold",
      threshold: 94_000,
    });
    expect(above).toMatchObject({
      reason: "above_threshold",
      shouldCompact: true,
      thresholdPercent: 100,
      modelContextBudgetStrategy: "preflight-v1",
    });
  });

  it("旧 percent override 不再改变统一算法", () => {
    expect(
      getAutoCompactThreshold({
        contextWindow: 200_000,
        maxOutputTokens: 32_000,
        modelContextBudgetStrategy: "legacy",
        thresholdPercentOverride: 50,
      }),
    ).toBe(166_000);
  });

  it("surfaces provider context usage as the token count truth source", () => {
    const decision = shouldAutoCompact({
      config: {
        contextWindow: 200_000,
        maxOutputTokens: 131_072,
      },
      messages: ENOUGH_MESSAGES,
      tokenOverride: {
        contextUsageTokenCount: 170_000,
        incrementalTokenCount: 1_000,
        source: "provider_usage",
        tokenCount: 171_000,
      },
    });

    expect(decision).toMatchObject({
      providerContextUsageTokenCount: 170_000,
      providerIncrementalTokenCount: 1_000,
      reason: "above_threshold",
      shouldCompact: true,
      tokenCount: 171_000,
    });
  });
});

describe("normal request output target", () => {
  it.each([
    { caseId: "OTB01", expected: 32_000, modelLimit: undefined },
    { caseId: "OTB02", expected: 16_000, modelLimit: 16_000 },
    { caseId: "OTB03", expected: 64_000, modelLimit: 64_000 },
    { caseId: "invalid zero", expected: 32_000, modelLimit: 0 },
    { caseId: "invalid negative", expected: 32_000, modelLimit: -1 },
    { caseId: "invalid non-finite", expected: 32_000, modelLimit: Number.NaN },
  ])("$caseId resolves model limit $modelLimit to $expected", ({ expected, modelLimit }) => {
    expect(
      resolveNormalRequestMaxOutputTokens({
        modelMaxOutputTokens: modelLimit,
      }),
    ).toBe(expected);
  });

  it.each([
    { available: 62_999, expected: 62_999 },
    { available: 3_000, expected: 3_000 },
    { available: 2_999, expected: 2_999 },
    { available: 1, expected: 1 },
    { available: 0, expected: 64_000 },
    { available: -1, expected: 64_000 },
  ])("preflight-v1 sends the positive available budget $available", ({ available, expected }) => {
    expect(
      resolveModelStepMaxOutputTokens({
        baselineMaxOutputTokens: 64_000,
        contextWindow: 128_000,
        estimatedCurrentUsage: 127_000 - available,
        modelContextBudgetStrategy: "preflight-v1",
      }),
    ).toBe(expected);
  });

  it("legacy 也应用 preflight cap，非法估算仍保留 baseline", () => {
    const common = {
      baselineMaxOutputTokens: 64_000,
      contextWindow: 128_000,
    };
    expect(
      resolveModelStepMaxOutputTokens({
        ...common,
        estimatedCurrentUsage: 64_001,
        modelContextBudgetStrategy: "legacy",
      }),
    ).toBe(62_999);
    expect(
      resolveModelStepMaxOutputTokens({
        ...common,
        estimatedCurrentUsage: Number.NaN,
        modelContextBudgetStrategy: "preflight-v1",
      }),
    ).toBe(64_000);
  });

  it("defaults a missing strategy to the preflight-v1 model-step cap", () => {
    expect(
      resolveModelStepMaxOutputTokens({
        baselineMaxOutputTokens: 64_000,
        contextWindow: 128_000,
        estimatedCurrentUsage: 64_001,
        modelContextBudgetStrategy: undefined,
      }),
    ).toBe(62_999);
  });

  it("keeps provider-specific reasoning out of the Core preflight calculation", () => {
    expect(
      resolveModelStepMaxOutputTokens({
        baselineMaxOutputTokens: 64_000,
        contextWindow: 128_000,
        estimatedCurrentUsage: 116_000,
        modelContextBudgetStrategy: "preflight-v1",
      }),
    ).toBe(11_000);
  });
});

describe("dsh-compact default engine & per-model effective context window", () => {
  it("resolves effective compression window from per-model cap, global default, and hard contextWindow", () => {
    expect(
      resolveEffectiveCompressionWindow({
        contextWindow: 1_000_000,
        effectiveContextWindow: 500_000,
        defaultEffectiveContextWindow: 300_000,
      }),
    ).toBe(500_000);

    expect(
      resolveEffectiveCompressionWindow({
        contextWindow: 1_000_000,
        defaultEffectiveContextWindow: 300_000,
      }),
    ).toBe(300_000);

    // Never exceeds hard contextWindow
    expect(
      resolveEffectiveCompressionWindow({
        contextWindow: 200_000,
        effectiveContextWindow: 500_000,
      }),
    ).toBe(200_000);
  });

  it("applies 60% default threshold (configurable 30%–95%) in dsh-compact mode against effectiveContextWindow", () => {
    expect(
      getAutoCompactThreshold({
        engine: "dsh-compact",
        contextWindow: 1_000_000,
        effectiveContextWindow: 500_000,
      }),
    ).toBe(300_000);

    expect(
      getAutoCompactThreshold({
        engine: "dsh-compact",
        contextWindow: 1_000_000,
        effectiveContextWindow: 500_000,
        thresholdRatio: 0.4,
      }),
    ).toBe(200_000);

    expect(
      getAutoCompactThreshold({
        engine: "dsh-compact",
        contextWindow: 1_000_000,
        effectiveContextWindow: 300_000,
        thresholdRatio: 0.8,
      }),
    ).toBe(240_000);

    // billion-context and disabled modes disable stock auto-compact
    for (const engine of ["billion-context", "disabled"] as const) {
      const decision = shouldAutoCompact({
        messages: ENOUGH_MESSAGES,
        config: { engine, contextWindow: 200_000 },
        tokenOverride: { source: "provider_usage", tokenCount: 190_000 },
      });
      expect(decision.shouldCompact).toBe(false);
      expect(decision.reason).toBe("disabled");
    }
  });

  it("ports pi-dsh-compact head-4096+tail-1024 pruning, supermemory stripping, 8-section prompt, and file tracking", () => {
    // Unicode code-point safe head+tail pruning (no surrogate pair split)
    const headPart = "😀".repeat(4096);
    const midPart = "M".repeat(3000);
    const tailPart = "T".repeat(1024);
    const pruned = pruneToolResultText(headPart + midPart + tailPart);
    expect(pruned.startsWith(headPart)).toBe(true);
    expect(pruned.endsWith(tailPart)).toBe(true);
    expect(pruned).toContain("[... tool result middle pruned ...]");
    expect(pruned).not.toContain(midPart);

    // Supermemory block stripping
    expect(
      stripSupermemoryBlocks("请修复压缩<supermemory>\nRetrieved memory noise\n</supermemory>"),
    ).toBe("请修复压缩");

    // End-to-end DSH summary request construction
    const longLog = `${"H".repeat(4096)}${"M".repeat(2500)}${"ERR: exit code 1".padStart(1024, "T")}`;
    const entriesForSummary: RuntimeMessageEntry[] = [
      {
        message: { role: "system", content: "agent system prompt should be excluded" },
        metadata: { source: "context_prefix" },
      },
      {
        message: {
          role: "user",
          content:
            "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n## Primary Request and Intent\n- Prior goal\n\n<read-files>\nREADME.md\n</read-files>\n<modified-files>\nlegacy.ts\n</modified-files>",
        },
        metadata: { source: "legacy_synthetic", compactBoundary: { boundaryId: "cmp_old" } },
      },
      {
        message: {
          role: "user",
          content: "Install CPAMP<supermemory>memory noise</supermemory>",
        },
      },
      {
        message: {
          role: "assistant",
          content: [
            { type: "reasoning", text: "secret internal chain of thought" },
            { type: "text", text: "Reading files and applying edits" },
          ],
          toolCalls: [
            { id: "tc_1", name: "Read", input: { file_path: "src/config.yaml" } },
            { id: "tc_2", name: "Read", input: { file_path: "assets/diagram.png" } },
            { id: "tc_3", name: "Edit", input: { file_path: "src/config.yaml" } },
            { id: "tc_4", name: "Write", input: { file_path: "scripts/start.cmd" } },
          ],
        },
      },
      {
        message: {
          role: "tool",
          toolCallId: "tc_1",
          toolName: "Bash",
          isError: true,
          content: longLog,
        },
      },
    ];

    const req = buildDshCompactSummaryRequest({
      entriesForSummary,
      customInstructions: "preserve admin key",
    });

    expect(req.messages[0]).toEqual({ role: "system", content: DSH_SUMMARIZATION_SYSTEM_PROMPT });
    const userPrompt = req.messages[1].content;
    expect(userPrompt).toContain("<compacted-summary>\n## Primary Request and Intent\n- Prior goal");
    expect(userPrompt).toContain("[User]: Install CPAMP");
    expect(userPrompt).not.toContain("memory noise");
    expect(userPrompt).not.toContain("secret internal chain of thought");
    expect(userPrompt).toContain("[Tool result (Bash) [ERROR]]:");
    expect(userPrompt).toContain("[... tool result middle pruned ...]");
    expect(userPrompt).toContain("ERR: exit code 1");
    expect(userPrompt).toContain("## Primary Request and Intent");
    expect(userPrompt).toContain("## Critical Context");
    expect(userPrompt).toContain("Additional user focus: preserve admin key");

    // File tracking double-insurance: modified deduplicated out of read, images filtered out, prior files inherited
    expect(req.fileLists.readFiles).toEqual(["README.md"]);
    expect(req.fileLists.modifiedFiles).toEqual(["legacy.ts", "scripts/start.cmd", "src/config.yaml"]);

    const finalSummary = appendDshFileOperationsToSummary(
      "## Primary Request and Intent\n- Install CPAMP",
      req.fileLists,
    );
    expect(finalSummary).toContain("<read-files>\nREADME.md\n</read-files>");
    expect(finalSummary).toContain(
      "<modified-files>\nlegacy.ts\nscripts/start.cmd\nsrc/config.yaml\n</modified-files>",
    );
    // Idempotent if already appended
    expect(appendDshFileOperationsToSummary(finalSummary, req.fileLists)).toBe(finalSummary);

    // Output token cap matches pi-dsh-compact
    expect(resolveDshSummaryMaxOutputTokens(65_536)).toBe(32_768);
    expect(resolveDshSummaryMaxOutputTokens(8_192)).toBe(8_192);
    expect(resolveDshSummaryMaxOutputTokens(undefined)).toBe(16_384);
  });

  it("retains ~20% trailing rounds in dsh-compact without splitting tool pairs", () => {
    const makeRound = (idx: number, chars: number): RuntimeMessageEntry[] => [
      { message: { role: "user", content: `u${idx}: ${"x".repeat(chars)}` } },
      {
        message: {
          role: "assistant",
          content: `a${idx}: ${"y".repeat(chars)}`,
          toolCalls: [{ id: `tc_${idx}`, name: "Read", input: { file_path: `/f${idx}.ts` } }],
        },
      },
      {
        message: {
          role: "tool",
          toolCallId: `tc_${idx}`,
          toolName: "Read",
          content: `out${idx}: ${"z".repeat(chars)}`,
        },
      },
    ];
    // 5 rounds, each ~300 tokens (3 * 400 chars / 4 = ~300 tokens)
    const entries: RuntimeMessageEntry[] = [
      ...makeRound(1, 400),
      ...makeRound(2, 400),
      ...makeRound(3, 400),
      ...makeRound(4, 400),
      ...makeRound(5, 400),
    ];

    const selected = selectCompactEntries({
      entries,
      trigger: CompactTrigger.Auto,
      retainBudgetTokens: 1_000,
    });
    // Should preserve 2 trailing assistant-started rounds ([a4, t4, u5] + [a5, t5]) without splitting tool pairs
    expect(selected.groupsPreserved).toBe(2);
    expect(selected.preservedEntries).toHaveLength(5);
    expect(selected.entriesForSummary).toHaveLength(10);
  });
});

describe("native billion-context (acp-kernel) session controller", () => {
  it("projects turns, compresses ranges, searches folded history, decompresses inline/toFile, persists and rewinds", async () => {
    const storedEntries: SessionEntryInfo[] = [];
    const sessionStore = {
      saveSessionEntry: async (entry: SessionEntryInfo) => {
        const idx = storedEntries.findIndex((e) => e.id === entry.id);
        if (idx >= 0) storedEntries[idx] = entry;
        else storedEntries.push(entry);
      },
      sessionEntries: async (query: { sessionID: SessionId; type?: string }) =>
        storedEntries.filter(
          (e) => e.sessionID === query.sessionID && (!query.type || e.type === query.type),
        ),
    } as unknown as Parameters<ReturnType<typeof createAcpSessionController>["loadFromStore"]>[0];

    const compactConfig = {
      engine: "billion-context" as const,
      defaultEffectiveContextWindow: 300_000,
      billionContext: {
        minContextLimitPct: 0.45,
        maxContextLimitPct: 0.75,
        growthFloorTokens: 20_000,
        preserveRecentMessages: 2,
        preserveRecentTokens: 1_000,
      },
    };
    const fakeModel = {
      providerId: "openai-chat-completions",
      modelId: "gemini-4-neon-xhigh",
      properties: {
        contextWindow: 1_000_000,
        effectiveContextWindow: 500_000,
      },
    } as unknown as Model;

    const controller = createAcpSessionController({
      sessionId: "sess_acp_test" as SessionId,
      getCompactConfig: () => compactConfig,
      getSessionStore: () => sessionStore,
    });
    expect(controller.isEnabled()).toBe(true);

    const bigBody = "The secret port is 8317 and database schema uses sqlite WAL mode. ".repeat(120);
    const entries: RuntimeMessageEntry[] = [
      { message: { role: "system", content: "You are ZCode." }, metadata: { source: "context_prefix" } },
      { message: { role: "user", content: "Start investigating the gateway config." } },
      { message: { role: "assistant", content: `Step 1 findings: ${bigBody}` } },
      { message: { role: "user", content: `More logs: ${bigBody}` } },
      { message: { role: "assistant", content: `Step 2 analysis: ${bigBody}` } },
      { message: { role: "user", content: "Now check the auth middleware." } },
      { message: { role: "assistant", content: "Checked auth middleware, looks good." } },
      { message: { role: "user", content: "Final question on current edit." } },
    ];

    const turn1 = await controller.prepareTurnEntries(
      {
        entries,
        model: fakeModel,
        compactConfig,
        tokenCount: 10_000,
        tokenCountSource: "estimate",
      },
      sessionStore,
    );
    expect(turn1.entries.some((e) => !("kind" in e && e.kind === "attachment") && e.message.role === "system" && String(e.message.content).includes("ACP TAGS"))).toBe(true);
    expect(storedEntries).toHaveLength(1);

    const statusBefore = await controller.executeStatus({});
    expect(statusBefore.ok).toBe(true);
    expect(statusBefore.report).toContain("500,000 effective tokens");

    // Compress m00001..m00004
    const compressed = await controller.executeCompress({
      content:
        "m00001-m00004 Gateway Investigation\nInvestigated gateway config: port is 8317, database uses SQLite WAL mode, logs verified clean.",
    });
    expect(compressed.ok).toBe(true);
    expect(compressed.blocksCreated).toBe(1);

    // Search finds content inside compressed summary & original folded messages
    const searchRes = await controller.executeSearchContext({ query: "8317 WAL" });
    expect(searchRes.ok).toBe(true);
    expect(searchRes.matchCount).toBeGreaterThan(0);

    // Decompress inline and toFile
    const inlineDec = await controller.executeDecompress({ blockId: "b1", toFile: false });
    expect(inlineDec.ok).toBe(true);
    expect(inlineDec.content).toContain("8317");

    const fileDec = await controller.executeDecompress({ blockId: "b1", toFile: true });
    expect(fileDec.ok).toBe(true);
    expect(fileDec.mode).toBe("file");
    expect(fileDec.filePath).toBeDefined();
    expect(existsSync(fileDec.filePath!)).toBe(true);
    expect(readFileSync(fileDec.filePath!, "utf8")).toContain("8317");
    rmSync(fileDec.filePath!, { force: true });

    // Cold resume reloads persisted block state from session_entry
    const resumed = createAcpSessionController({
      sessionId: "sess_acp_test" as SessionId,
      getCompactConfig: () => compactConfig,
      getSessionStore: () => sessionStore,
    });
    await resumed.loadFromStore(sessionStore, 0);
    const turn2 = await resumed.prepareTurnEntries(
      {
        entries,
        model: fakeModel,
        compactConfig,
        tokenCount: 10_000,
        tokenCountSource: "estimate",
      },
      sessionStore,
    );
    expect(turn2.activeBlockCount).toBe(1);

    // Fork entry carries state
    const forkEntry = resumed.buildForkEntry("sess_acp_child" as SessionId);
    expect(forkEntry).not.toBeNull();

    // Rewind resets branch state cleanly
    await resumed.resetForRewind(sessionStore, 1);
    const turn3 = await resumed.prepareTurnEntries(
      {
        entries,
        model: fakeModel,
        compactConfig,
        tokenCount: 10_000,
        tokenCountSource: "estimate",
      },
      sessionStore,
    );
    expect(turn3.activeBlockCount).toBe(0);
  });

  it("keeps tool-call/result strictly paired without duplicating multi-tool assistant bursts", () => {
    const entries: RuntimeMessageEntry[] = [
      { message: { role: "system", content: "You are ZCode." }, metadata: { source: "context_prefix" } },
      { message: { role: "user", content: "Inspect and compress." } },
      {
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call_compress", name: "compress", input: { content: "m00001-m00002 s" } },
            { id: "call_bash", name: "Bash", input: { command: "ls" } },
            { id: "call_read", name: "Read", input: { file_path: "a.ts" } },
          ],
        },
      },
      { message: { role: "tool", toolCallId: "call_compress", toolName: "compress", content: "ok" } },
      { message: { role: "tool", toolCallId: "call_bash", toolName: "Bash", content: "fileA" } },
      { message: { role: "tool", toolCallId: "call_read", toolName: "Read", content: "const x = 1;" } },
    ];

    const mapping = runtimeEntriesToCoreMessages(entries);

    // 1. Full round-trip: multi-tool burst must emit ONE assistant entry (no bogus text duplicates)
    const full = coreMessagesToRuntimeEntries({
      mapping,
      renderedMessages: mapping.coreMessages,
    });
    const fullAssistant = full.entries.filter(
      (e) => !("kind" in e && e.kind === "attachment") && e.message.role === "assistant",
    );
    expect(fullAssistant).toHaveLength(1);
    expect(
      !("kind" in fullAssistant[0]! && fullAssistant[0]!.kind === "attachment") &&
        fullAssistant[0]!.message.toolCalls?.map((tc) => tc.id),
    ).toEqual(["call_compress", "call_bash", "call_read"]);

    // 2. Partial fold: Bash & Read results folded, only compress survives -> strip dangling Bash/Read calls
    const onlyCompressRendered = mapping.coreMessages.filter(
      (m) => m.toolCallId !== "call_bash" && m.toolCallId !== "call_read",
    );
    const partial = coreMessagesToRuntimeEntries({
      mapping,
      renderedMessages: onlyCompressRendered,
    });
    const partialAssistant = partial.entries.filter(
      (e) => !("kind" in e && e.kind === "attachment") && e.message.role === "assistant",
    );
    const partialTools = partial.entries.filter(
      (e) => !("kind" in e && e.kind === "attachment") && e.message.role === "tool",
    );
    expect(partialAssistant).toHaveLength(1);
    expect(
      !("kind" in partialAssistant[0]! && partialAssistant[0]!.kind === "attachment") &&
        partialAssistant[0]!.message.toolCalls?.map((tc) => tc.id),
    ).toEqual(["call_compress"]);
    expect(partialTools).toHaveLength(1);

    // 3. Hide consumed compress call+result -> keep Bash & Read paired, no dangling compress call
    const hideCompressRendered = mapping.coreMessages.filter(
      (m) => m.toolCallId !== "call_compress",
    );
    const hiddenCompress = coreMessagesToRuntimeEntries({
      mapping,
      renderedMessages: hideCompressRendered,
    });
    const hcAssistant = hiddenCompress.entries.filter(
      (e) => !("kind" in e && e.kind === "attachment") && e.message.role === "assistant",
    );
    expect(hcAssistant).toHaveLength(1);
    expect(
      !("kind" in hcAssistant[0]! && hcAssistant[0]!.kind === "attachment") &&
        hcAssistant[0]!.message.toolCalls?.map((tc) => tc.id),
    ).toEqual(["call_bash", "call_read"]);
  });
});
