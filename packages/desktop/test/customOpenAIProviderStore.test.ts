import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFailClosedAccountProviderConfigSnapshot,
  ModelConfig,
  ModelConfigRules,
  ProviderConfigMap,
  ProviderConfigResolver,
  ProviderConfigService,
  ProviderRegistry,
  ProviderRegistryService,
  ProviderSettingsFacade,
  type ProviderConfigLayerSnapshot,
} from "@zcode/provider";
import {
  buildRemoteModelsCandidateUrls,
  buildRemoteModelsRequestHeaders,
  createProviderSettingsService,
  fetchRemoteProviderModels,
  parseRemoteModelsPayload,
} from "@zcode/services";
import {
  appSettingsPatchSchema,
  appSettingsSchema,
} from "@zcode/shared";
import {
  THINKING_PRESET_IDS,
  buildThinkingProfileFromPreset,
  clampReasoningLevel,
  compileModelOptionMap,
  compileThinkingProfileToOptionSpec,
  inferThinkingProfileForModel,
  parseOptionSpecToThinkingProfile,
  type ThinkingProfile,
} from "@zcode/shared/model-config";
import { decodeProviderConfigFile } from "@zcode/provider-node";

describe("custom OpenAI Provider E2E seed", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("只写版本化 Personal Config，不再制造旧 Provider 事实来源", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "zcode-provider-seed-"));
    const cliConfigFile = join(homeDir, ".zcode", "cli", "config.json");
    await writeFileWithParents(
      cliConfigFile,
      JSON.stringify({ mcp: { example: { command: "example" } } }),
    );
    vi.stubEnv("ZCODE_E2E_HOME_DIR", homeDir);
    vi.stubEnv("E2E_PROVIDER_RUNTIME_BASE_URL", "http://127.0.0.1:43123");

    const { seedCustomOpenAIChatCompletionsProvider } =
      await import("./e2e/helpers/custom-openai-provider-store.js");
    await seedCustomOpenAIChatCompletionsProvider({
      providerId: "e2e-openai",
      providerName: "E2E OpenAI",
      modelId: "e2e-model",
      inputModalities: ["text", "image"],
    });

    const personalConfig = JSON.parse(
      await readFile(join(homeDir, ".zcode", "v2", "provider_config.json"), "utf-8"),
    ) as { config: { modelConfigRules: unknown } };
    const personal = decodeProviderConfigFile(personalConfig);
    const resolved = new ProviderConfigResolver().resolve({
      zcodeBuiltinProviders: new ProviderConfigMap(),
      accountProviders: new ProviderConfigMap(),
      zcodeBuiltinModelRules: new ModelConfigRules(),
      personalProviders: personal.providers,
      personalModels: personal.models,
    });
    expect(resolved.issues).toEqual([]);
    expect(
      new ProviderRegistry(resolved.registryProviders).validateSelection({
        providerId: "e2e-openai",
        modelId: "e2e-model",
        options: { reasoningLevel: "disabled" },
      }),
    ).toEqual({ ok: true });
    expect(personalConfig).toMatchObject({
      schemaVersion: 1,
      config: {
        providerConfigRules: {
          providerRules: [
            {
              providerId: "e2e-openai",
              providerName: "E2E OpenAI",
              config: {
                access: { type: "api-key", apiKey: "e2e-fixture-key" },
                api: {
                  type: "openai-chat-completions",
                  baseUrl: "http://127.0.0.1:43123",
                },
                personalModelIds: ["e2e-model"],
              },
            },
          ],
        },
      },
    });
    expect(personalConfig.config.modelConfigRules).toEqual(
      expect.objectContaining({
        providerModelRules: expect.arrayContaining([
          expect.objectContaining({
            providerId: "e2e-openai",
            modelId: "e2e-model",
            config: expect.objectContaining({
              properties: expect.objectContaining({
                inputFormat: expect.objectContaining({ supportsImage: true }),
              }),
            }),
          }),
        ]),
      }),
    );

    await expect(stat(join(homeDir, ".zcode", "v2", "model-providers.json"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
    expect(JSON.parse(await readFile(cliConfigFile, "utf-8"))).toEqual({
      mcp: { example: { command: "example" } },
    });

    const { readModelProviders } = await import("./e2e/helpers/desktop-app.js");
    expect(await readModelProviders()).toEqual([
      expect.objectContaining({
        id: "e2e-openai",
        name: "E2E OpenAI",
        apiKey: "e2e-fixture-key",
        endpoints: expect.objectContaining({ baseURL: "http://127.0.0.1:43123" }),
        models: [
          expect.objectContaining({
            id: "e2e-model",
            contextWindow: 200_000,
            maxOutputTokens: 32_000,
            modalities: expect.objectContaining({ input: ["text", "image"] }),
          }),
        ],
      }),
    ]);
  });

  it("E2E 观察保留 Coding Plan API Key，而不把已保存凭据投影为空", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "zcode-provider-key-read-"));
    vi.stubEnv("ZCODE_E2E_HOME_DIR", homeDir);
    await writeFileWithParents(
      join(homeDir, ".zcode", "v2", "provider_config.json"),
      JSON.stringify({
        schemaVersion: 1,
        config: {
          providerConfigRules: {
            providerRules: [
              {
                providerId: "example-plan",
                templateId: "example-template",
                providerName: "Example Plan",
                config: {
                  group: "standard-personal",
                  access: { type: "zhipu-coding-plan-api-key", apiKey: "e2e-plan-key" },
                  personalModelIds: [],
                },
              },
            ],
          },
          modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
        },
      }),
    );
    const { readModelProvider } = await import("./e2e/helpers/desktop-app.js");
    expect(await readModelProvider("example-plan")).toMatchObject({
      id: "example-plan",
      apiKey: "e2e-plan-key",
    });
  });

  it("E2E 诊断不再读取旧 Provider Store", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "zcode-provider-read-"));
    await writeFileWithParents(
      join(homeDir, ".zcode", "v2", "model-providers.json"),
      JSON.stringify([
        {
          id: "legacy-provider",
          name: "Legacy Provider",
          models: [],
        },
      ]),
    );
    vi.stubEnv("ZCODE_E2E_HOME_DIR", homeDir);

    const { readModelProviders } = await import("./e2e/helpers/desktop-app.js");
    expect(await readModelProviders()).toEqual([]);
  });
});

describe("third-party remote model discovery and batch add", () => {
  it("builds protocol-aware /models candidate URLs and strips accidental endpoint suffixes", () => {
    expect(buildRemoteModelsCandidateUrls("http://34.58.122.12:8317/v1/", "openai-chat-completions")).toEqual([
      "http://34.58.122.12:8317/v1/models",
    ]);
    expect(buildRemoteModelsCandidateUrls("http://34.58.122.12:8317", "openai-chat-completions")).toEqual([
      "http://34.58.122.12:8317/v1/models",
      "http://34.58.122.12:8317/models",
    ]);
    expect(
      buildRemoteModelsCandidateUrls("http://34.58.122.12:8317/v1/chat/completions", "openai-chat-completions"),
    ).toEqual(["http://34.58.122.12:8317/v1/models"]);
    expect(buildRemoteModelsCandidateUrls("https://open.bigmodel.cn/api/paas/v4", "openai-chat-completions")).toEqual([
      "https://open.bigmodel.cn/api/paas/v4/models",
    ]);
    expect(buildRemoteModelsCandidateUrls("https://api.anthropic.com", "anthropic-messages")).toEqual([
      "https://api.anthropic.com/v1/models",
      "https://api.anthropic.com/models",
    ]);
    expect(buildRemoteModelsCandidateUrls("http://34.58.122.12:8317/v1", "anthropic-messages")).toEqual([
      "http://34.58.122.12:8317/v1/models",
    ]);
  });

  it("separates OpenAI Bearer headers from Anthropic headers", () => {
    const openaiHeaders = buildRemoteModelsRequestHeaders({
      apiType: "openai-chat-completions",
      apiKey: "080908",
    });
    expect(openaiHeaders).toEqual({
      Accept: "application/json",
      Authorization: "Bearer 080908",
    });

    const anthropicHeaders = buildRemoteModelsRequestHeaders({
      apiType: "anthropic-messages",
      apiKey: "080908",
    });
    expect(anthropicHeaders).toEqual({
      Accept: "application/json",
      "x-api-key": "080908",
      "anthropic-version": "2023-06-01",
    });
  });

  it("parses OpenAI, Anthropic, Gemini-style, and string-array /models payloads with deduplication", () => {
    expect(
      parseRemoteModelsPayload({
        object: "list",
        data: [
          { id: "gpt-5.6-luna", owned_by: "openai" },
          { id: "gpt-5.6-luna", owned_by: "duplicate" },
          {
            id: "claude-opus-4-6-thinking",
            display_name: "Claude Opus 4.6 (Thinking)",
            owned_by: "antigravity",
            max_input_tokens: 200000,
            max_tokens: 64000,
          },
        ],
      }),
    ).toEqual([
      { id: "gpt-5.6-luna", ownedBy: "openai" },
      {
        id: "claude-opus-4-6-thinking",
        displayName: "Claude Opus 4.6 (Thinking)",
        ownedBy: "antigravity",
        contextWindow: 200000,
        maxOutputTokens: 64000,
      },
    ]);

    expect(
      parseRemoteModelsPayload({
        models: [{ name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro" }, "custom-llm"],
      }),
    ).toEqual([
      { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
      { id: "custom-llm" },
    ]);
  });

  it("falls back on 404 from root URL and fails fast on 401", async () => {
    const calls: string[] = [];
    const fallbackResult = await fetchRemoteProviderModels({
      apiType: "openai-chat-completions",
      baseUrl: "http://34.58.122.12:8317",
      apiKey: "080908",
      fetchImpl: async (input) => {
        const url = String(input);
        calls.push(url);
        if (calls.length === 1) {
          return new Response(JSON.stringify({ error: { message: "Not Found" } }), { status: 404 });
        }
        return new Response(JSON.stringify({ data: [{ id: "deepseek-v4.1-flash" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    expect(calls).toEqual([
      "http://34.58.122.12:8317/v1/models",
      "http://34.58.122.12:8317/models",
    ]);
    expect(fallbackResult).toEqual({
      endpointUrl: "http://34.58.122.12:8317/models",
      models: [{ id: "deepseek-v4.1-flash" }],
    });

    const authCalls: string[] = [];
    await expect(
      fetchRemoteProviderModels({
        apiType: "openai-chat-completions",
        baseUrl: "http://34.58.122.12:8317",
        apiKey: "bad",
        fetchImpl: async (input) => {
          authCalls.push(String(input));
          return new Response(JSON.stringify({ error: { message: "Invalid key" } }), { status: 401 });
        },
      }),
    ).rejects.toThrow("HTTP 401: Invalid key");
    expect(authCalls).toEqual(["http://34.58.122.12:8317/v1/models"]);
  });

  it("fetches models using saved provider credentials and batch-adds models in one transaction", async () => {
    let personalSnapshot: ProviderConfigLayerSnapshot = {
      revision: "p0",
      providers: new ProviderConfigMap(),
      models: new ModelConfigRules(),
      providerOrder: [],
    };
    let rev = 0;
    const listeners = new Set<(reason: string) => void>();
    const personalRepo = {
      read: async () => personalSnapshot,
      onDidChange: (listener: (reason: string) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      update: async (transform: (current: ProviderConfigLayerSnapshot) => Omit<ProviderConfigLayerSnapshot, "revision">) => {
        const next = transform(personalSnapshot);
        rev += 1;
        personalSnapshot = { ...next, revision: `p${rev}` };
        for (const l of listeners) l("updated");
        return personalSnapshot;
      },
    };
    const builtinSnapshot: ProviderConfigLayerSnapshot = {
      revision: "b0",
      providers: new ProviderConfigMap(),
      models: new ModelConfigRules([
        {
          type: "model",
          modelMatch: ".*",
          config: ModelConfig.fromData({
            enabled: true,
            properties: {
              contextWindow: 128000,
              inputFormat: { supportsText: true, supportsImage: false, supportsVideo: false, supportsAudio: false, supportsPdf: false },
              outputFormat: { supportsText: true },
              supportsToolCall: true,
              supportsJsonSchemaOutput: false,
              supportsNativeWebSearch: false,
              supportsMidConversationSystem: false,
              requiresMfjsToolSchema: false,
            },
            optionSpecs: {
              maxOutputTokens: { max: 32000, map: "{}" },
              reasoningLevel: { values: ["disabled", "enabled"], map: "{}" },
            },
          }),
        },
      ]),
    };
    const configService = new ProviderConfigService({
      zcodeBuiltinSource: { read: async () => builtinSnapshot, onDidChange: () => () => {} },
      personalRepository: personalRepo,
    });
    const registryService = new ProviderRegistryService({
      configSource: configService,
      accountSource: {
        read: async () => createFailClosedAccountProviderConfigSnapshot(await configService.read()),
        onDidChange: () => () => {},
      },
    });
    await registryService.start();
    const facade = new ProviderSettingsFacade(registryService, {
      createPersonalProvider: (input) => configService.createPersonalProvider(input),
      savePersonalProviderOverlay: (id, cfg, mem, meta) =>
        configService.savePersonalProviderOverlay(id, cfg, mem, meta),
      deletePersonalProvider: (id) => configService.deletePersonalProvider(id),
      reorderPersonalProviders: (ids) => configService.reorderPersonalProviders(ids),
      reorderPersonalModels: (id, mids, mem) => configService.reorderPersonalModels(id, mids, mem),
      addPersonalModel: configService.addPersonalModel.bind(configService),
      addPersonalModels: configService.addPersonalModels.bind(configService),
      renamePersonalModel: (id, cur, next, mem) => configService.renamePersonalModel(id, cur, next, mem),
      deletePersonalModel: (id, mid, mem) => configService.deletePersonalModel(id, mid, mem),
      setPersonalModelEnabled: (id, mid, en, mem) => configService.setPersonalModelEnabled(id, mid, en, mem),
      savePersonalModelDraft: (id, o, n, cfg, r, u, mem) =>
        configService.savePersonalModelDraft(id, o, n, cfg, r, u, mem),
      refresh: (reason) => registryService.refresh(reason),
    });

    let seenAuth = "";
    const settingsService = createProviderSettingsService(
      facade,
      async () => {},
      undefined,
      undefined,
      async (_input, init) => {
        seenAuth = new Headers(init?.headers).get("authorization") ?? "";
        return new Response(
          JSON.stringify({ data: [{ id: "gpt-5.6-luna" }, { id: "deepseek-v4.1-flash" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );

    try {
      const created = await settingsService.createPersonalProvider({ providerName: "My Relay" });
      await settingsService.savePersonalProviderOverlay(created.providerId, {
        api: { type: "openai-chat-completions", baseUrl: "http://34.58.122.12:8317/v1" },
        access: { type: "api-key", apiKey: "080908" },
      });

      const fetched = await settingsService.fetchRemoteModels({
        providerId: created.providerId,
        apiType: "openai-chat-completions",
        baseUrl: "http://34.58.122.12:8317/v1",
      });
      expect(seenAuth).toBe("Bearer 080908");
      expect(fetched.models.map((m) => m.id)).toEqual(["gpt-5.6-luna", "deepseek-v4.1-flash"]);

      const view = await settingsService.addPersonalModels(
        created.providerId,
        fetched.models.map((m) => ({ modelId: m.id, config: {}, useRecommendedConfig: true })),
      );
      const provider = view.providers.find((p) => p.providerId === created.providerId);
      expect(provider?.models.map((m) => m.modelId)).toEqual([
        "gpt-5.6-luna",
        "deepseek-v4.1-flash",
      ]);
      expect(provider?.issues).toEqual([]);
      expect(provider?.models.map((m) => m.issues)).toEqual([[], []]);
      expect(provider?.models.every((m) => m.executable && m.selectable)).toBe(true);

      // Re-adding existing + one new model skips existing without error
      const view2 = await settingsService.addPersonalModels(created.providerId, [
        { modelId: "gpt-5.6-luna", config: {}, useRecommendedConfig: true },
        { modelId: "gemini-3-flash", config: {}, useRecommendedConfig: true },
      ]);
      expect(view2.providers.find((p) => p.providerId === created.providerId)?.models.map((m) => m.modelId)).toEqual([
        "gpt-5.6-luna",
        "deepseek-v4.1-flash",
        "gemini-3-flash",
      ]);
    } finally {
      settingsService.dispose();
      registryService.dispose();
    }
  });
});

describe("Pi-style thinking level profiles, CEL round-trip, and smart inference", () => {
  it("compiles and round-trips all presets (1 to 7 tiers) and custom wire-name mappings", () => {
    for (const presetId of THINKING_PRESET_IDS) {
      const profile = buildThinkingProfileFromPreset(presetId, "openai");
      const spec = compileThinkingProfileToOptionSpec(profile);
      const program = compileModelOptionMap(spec.map, "reasoningLevel");
      for (const value of spec.values) {
        expect(() => program.evaluate(value)).not.toThrow();
      }
      const parsed = parseOptionSpecToThinkingProfile(spec.values, spec.map, "openai-chat-completions");
      expect(parsed.format).toBe(profile.format);
      expect(parsed.tiers.map((t) => t.id)).toEqual(profile.tiers.map((t) => t.id));
    }

    // 3-tier custom names with distinct upstream wire values + omit for "instant"
    const customProfile: ThinkingProfile = {
      format: "openai",
      tiers: [
        { id: "instant", action: "omit" },
        { id: "balanced", action: "value", wireValue: "medium" },
        { id: "deep", action: "value", wireValue: "xhigh" },
      ],
    };
    const customSpec = compileThinkingProfileToOptionSpec(customProfile);
    const customProgram = compileModelOptionMap(customSpec.map, "reasoningLevel");
    expect(customProgram.evaluate("instant")).toEqual({});
    expect(customProgram.evaluate("balanced")).toEqual({ reasoning_effort: "medium" });
    expect(customProgram.evaluate("deep")).toEqual({ reasoning_effort: "xhigh" });

    const roundTripped = parseOptionSpecToThinkingProfile(
      customSpec.values,
      customSpec.map,
      "openai-chat-completions",
    );
    expect(roundTripped).toEqual(customProfile);
  });

  it("compiles and decompiles every structured thinkingFormat accurately", () => {
    const cases: { profile: ThinkingProfile; apiType: string; sampleLevel: string; expectedPatch: Record<string, unknown> }[] = [
      {
        apiType: "openai-responses",
        sampleLevel: "xhigh",
        expectedPatch: { reasoning: { effort: "max" } },
        profile: {
          format: "openai-responses",
          tiers: [
            { id: "off", action: "omit" },
            { id: "high", action: "value", wireValue: "high" },
            { id: "xhigh", action: "value", wireValue: "max" },
          ],
        },
      },
      {
        apiType: "openai-chat-completions",
        sampleLevel: "off",
        expectedPatch: { reasoning: { enabled: false } },
        profile: {
          format: "openrouter",
          tiers: [
            { id: "off", action: "disabled" },
            { id: "high", action: "value", wireValue: "high" },
          ],
        },
      },
      {
        apiType: "anthropic-messages",
        sampleLevel: "xhigh",
        expectedPatch: { thinking: { type: "adaptive" }, output_config: { effort: "max" } },
        profile: {
          format: "anthropic-adaptive",
          tiers: [
            { id: "off", action: "disabled" },
            { id: "low", action: "value", wireValue: "low" },
            { id: "xhigh", action: "value", wireValue: "max" },
          ],
        },
      },
      {
        apiType: "anthropic-messages",
        sampleLevel: "medium",
        expectedPatch: { thinking: { type: "enabled", budget_tokens: 10240 } },
        profile: {
          format: "anthropic-budget",
          tiers: [
            { id: "off", action: "disabled" },
            { id: "low", action: "budget", budgetTokens: 4096 },
            { id: "medium", action: "budget", budgetTokens: 10240 },
          ],
        },
      },
      {
        apiType: "openai-chat-completions",
        sampleLevel: "max",
        expectedPatch: { thinking: { type: "enabled" }, reasoning_effort: "max" },
        profile: {
          format: "deepseek",
          tiers: [
            { id: "disabled", action: "disabled" },
            { id: "low", action: "value", wireValue: "low" },
            { id: "max", action: "value", wireValue: "max" },
          ],
        },
      },
      {
        apiType: "openai-chat-completions",
        sampleLevel: "enabled",
        expectedPatch: { thinking: { type: "enabled" } },
        profile: {
          format: "zai",
          tiers: [
            { id: "disabled", action: "disabled" },
            { id: "enabled", action: "enabled" },
          ],
        },
      },
      {
        apiType: "openai-chat-completions",
        sampleLevel: "high",
        expectedPatch: { enable_thinking: true, thinking_budget: 24576 },
        profile: {
          format: "qwen",
          tiers: [
            { id: "off", action: "disabled" },
            { id: "high", action: "budget", budgetTokens: 24576 },
          ],
        },
      },
      {
        apiType: "openai-chat-completions",
        sampleLevel: "enabled",
        expectedPatch: { chat_template_kwargs: { enable_thinking: true } },
        profile: {
          format: "qwen-chat-template",
          tiers: [
            { id: "disabled", action: "disabled" },
            { id: "enabled", action: "enabled" },
          ],
        },
      },
    ];

    for (const item of cases) {
      const spec = compileThinkingProfileToOptionSpec(item.profile);
      const program = compileModelOptionMap(spec.map, "reasoningLevel");
      expect(program.evaluate(item.sampleLevel)).toEqual(item.expectedPatch);
      const parsed = parseOptionSpecToThinkingProfile(spec.values, spec.map, item.apiType);
      expect(parsed).toEqual(item.profile);
    }

    // Complex 4-field ZCode default CEL falls back cleanly to custom-cel without losing text
    const compositeCel =
      '{ "thinking": { "type": "enabled" }, "enable_thinking": true, "reasoning_effort": reasoningLevel }';
    const customParsed = parseOptionSpecToThinkingProfile(["disabled", "enabled"], compositeCel, "openai-chat-completions");
    expect(customParsed.format).toBe("custom-cel");
    expect(customParsed.customCel).toBe(compositeCel);
  });

  it("extracts server-advertised reasoning levels and infers real third-party model families", () => {
    const parsedRemote = parseRemoteModelsPayload({
      data: [
        {
          id: "proxy-custom-1",
          supported_reasoning_effort: ["none", "medium", "turbo"],
          supports_reasoning: true,
        },
        {
          id: "openrouter-model",
          supported_parameters: ["temperature", "reasoning"],
        },
      ],
    });
    expect(parsedRemote[0]).toMatchObject({
      id: "proxy-custom-1",
      reasoningLevels: ["none", "medium", "turbo"],
      supportsReasoning: true,
    });
    expect(parsedRemote[1]).toMatchObject({
      id: "openrouter-model",
      supportsReasoning: true,
    });

    const fromRemote = inferThinkingProfileForModel({
      modelId: "proxy-custom-1",
      apiType: "openai-chat-completions",
      remoteEntry: parsedRemote[0],
    });
    expect(fromRemote.source).toBe("remote-metadata");
    expect(fromRemote.profile?.tiers.map((t) => t.id)).toEqual(["none", "medium", "turbo"]);

    expect(
      inferThinkingProfileForModel({ modelId: "gpt-5.6-luna", apiType: "openai-chat-completions" })
        .profile?.tiers.map((t) => t.id),
    ).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);

    expect(
      inferThinkingProfileForModel({ modelId: "gemini-4-hydrogen", apiType: "openai-chat-completions" })
        .profile?.tiers.map((t) => t.id),
    ).toEqual(["low", "medium", "high", "xhigh"]);

    expect(
      inferThinkingProfileForModel({ modelId: "gemini-4-neon-xhigh", apiType: "openai-chat-completions" }),
    ).toMatchObject({
      source: "model-rule",
      profile: {
        format: "openai",
        tiers: [
          { id: "low", action: "value", wireValue: "low" },
          { id: "medium", action: "value", wireValue: "medium" },
          { id: "high", action: "value", wireValue: "high" },
          { id: "xhigh", action: "value", wireValue: "xhigh" },
        ],
      },
    });

    expect(
      inferThinkingProfileForModel({ modelId: "gpt-oss-120b-medium", apiType: "openai-chat-completions" })
        .profile?.tiers.map((t) => t.id),
    ).toEqual(["low", "medium", "high"]);

    expect(
      inferThinkingProfileForModel({ modelId: "claude-sonnet-4-6", apiType: "anthropic-messages" })
        .profile,
    ).toMatchObject({
      format: "anthropic-adaptive",
      tiers: [
        { id: "off", action: "disabled" },
        { id: "low", action: "value", wireValue: "low" },
        { id: "medium", action: "value", wireValue: "medium" },
        { id: "high", action: "value", wireValue: "high" },
        { id: "max", action: "value", wireValue: "max" },
      ],
    });

    expect(
      inferThinkingProfileForModel({ modelId: "qwen3.8-omni-flash", apiType: "openai-chat-completions" })
        .profile?.tiers.map((t) => t.id),
    ).toEqual(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

    expect(
      inferThinkingProfileForModel({ modelId: "gpt-image-1.5", apiType: "openai-chat-completions" }),
    ).toEqual({
      source: "non-thinking",
      profile: { format: "noop", tiers: [{ id: "off", action: "omit" }] },
    });
  });

  it("clamps thinking levels across models with different tier counts", () => {
    expect(clampReasoningLevel("xhigh", ["low", "medium", "high"])).toBe("high");
    expect(clampReasoningLevel("minimal", ["none", "low", "medium", "high"])).toBe("low");
    expect(clampReasoningLevel("off", ["disabled", "enabled"])).toBe("disabled");
    expect(clampReasoningLevel("high", ["disabled", "enabled"])).toBe("enabled");
    expect(clampReasoningLevel("medium", ["none", "high", "max"])).toBe("high");
    expect(clampReasoningLevel(undefined, ["low", "high"])).toBe("high");
  });

  it("persists contextCompression settings and per-model effectiveContextWindow cleanly", () => {
    const patch = appSettingsPatchSchema.parse({
      contextCompression: {
        engine: "billion-context",
        defaultEffectiveContextWindow: 500_000,
        thresholdRatio: 0.6,
        retainRatio: 0.2,
        biliMinContextLimitPct: 0.45,
        biliMaxContextLimitPct: 0.75,
      },
    });
    const full = appSettingsSchema.parse(patch);
    expect(full.contextCompression).toMatchObject({
      engine: "billion-context",
      defaultEffectiveContextWindow: 500_000,
      thresholdRatio: 0.6,
      retainRatio: 0.2,
    });
    expect(
      appSettingsPatchSchema.parse({ contextCompression: { thresholdRatio: 0.4 } })
        .contextCompression?.thresholdRatio,
    ).toBe(0.4);

    const modelCfg = ModelConfig.fromData({
      enabled: true,
      properties: {
        contextWindow: 1_000_000,
        effectiveContextWindow: 300_000,
        inputFormat: {
          supportsText: true,
          supportsImage: false,
          supportsVideo: false,
          supportsAudio: false,
          supportsPdf: false,
        },
        outputFormat: { supportsText: true },
        supportsToolCall: true,
        supportsJsonSchemaOutput: false,
        supportsNativeWebSearch: false,
        supportsMidConversationSystem: false,
        requiresMfjsToolSchema: false,
      },
      optionSpecs: {
        maxOutputTokens: { max: 64_000, map: "{}" },
        reasoningLevel: { values: ["low", "high"], map: '{ "reasoning_effort": reasoningLevel }' },
      },
    });
    expect(modelCfg.validateComplete()).toEqual([]);
    expect(modelCfg.toJSON().properties?.effectiveContextWindow).toBe(300_000);
  });
});

async function writeFileWithParents(file: string, content: string) {
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content, "utf-8");
}
