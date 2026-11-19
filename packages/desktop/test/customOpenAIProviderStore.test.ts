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

async function writeFileWithParents(file: string, content: string) {
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content, "utf-8");
}
