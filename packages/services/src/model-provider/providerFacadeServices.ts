import type { Event } from "@zcode/rpc";
import { ServiceChannels, isOfficialPlanProvider } from "@zcode/shared";
import {
  completeNewModelSelection,
  type ModelConfigObject,
  type ModelId,
  type ModelSelection,
  type ModelSelectionFacade,
  type ModelSelectionView,
  type ModelSelectionViewInput,
  type ProviderConfigObject,
  type ProviderId,
  type ProviderSettingsFacade,
  type ProviderSettingsCreationResult,
  type ModelConfigResolution,
  type ProviderSettingsView,
  type ResolveModelConfigInput,
  type SavePersonalModelDraftInput,
} from "@zcode/provider";
import { createServiceDescriptor } from "../descriptors.js";
import type { ModelConnectivityResult } from "@zcode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";

export type {
  ProviderSettingsProviderView,
  ModelSelectionView,
  ModelSelectionViewInput,
  ProviderSettingsView,
} from "@zcode/provider";

export interface IProviderSettingsService {
  readonly onDidChange: Event<ProviderSettingsView>;
  getView(): Promise<ProviderSettingsView>;
  refresh(reason: string): Promise<ProviderSettingsView>;
  createPersonalProvider(
    input?: Parameters<ProviderSettingsFacade["createPersonalProvider"]>[0],
  ): Promise<ProviderSettingsCreationResult>;
  resolveModelConfig(input: ResolveModelConfigInput): Promise<ModelConfigResolution>;
  savePersonalProviderOverlay(
    providerId: ProviderId,
    config: ProviderConfigObject,
    metadata?: Parameters<ProviderSettingsFacade["savePersonalProviderOverlay"]>[2],
  ): Promise<ProviderSettingsView>;
  deletePersonalProvider(providerId: ProviderId): Promise<ProviderSettingsView>;
  reorderPersonalProviders(providerIds: readonly ProviderId[]): Promise<ProviderSettingsView>;
  reorderPersonalModels(
    providerId: ProviderId,
    modelIds: readonly ModelId[],
  ): Promise<ProviderSettingsView>;
  addPersonalModel(
    providerId: ProviderId,
    modelId: ModelId,
    config: ModelConfigObject,
    useRecommendedConfig?: boolean,
  ): Promise<ProviderSettingsView>;
  renamePersonalModel(
    providerId: ProviderId,
    currentModelId: ModelId,
    nextModelId: ModelId,
  ): Promise<ProviderSettingsView>;
  deletePersonalModel(providerId: ProviderId, modelId: ModelId): Promise<ProviderSettingsView>;
  savePersonalModelDraft(input: SavePersonalModelDraftInput): Promise<ProviderSettingsView>;
  setPersonalModelEnabled(
    providerId: ProviderId,
    modelId: ModelId,
    enabled: boolean,
  ): Promise<ProviderSettingsView>;
  /** 测试已经保存并进入目标 Environment Registry 的正式 Model。 */
  testModelConnectivity(
    input: ProviderSettingsConnectivityRequest,
  ): Promise<ModelConnectivityResult>;
}

export const IProviderSettingsService = createServiceDescriptor<IProviderSettingsService>(
  ServiceChannels.ProviderSettings,
);

export interface ProviderSettingsConnectivityTestInput {
  readonly workspacePath: string;
  readonly workspaceIdentity?: string;
  readonly providerId: ProviderId;
  readonly modelId: ModelId;
}

export interface ProviderSettingsConnectivityRequest {
  readonly workspacePath: string;
  readonly workspaceIdentity?: string;
  readonly providerId: ProviderId;
  readonly modelId: ModelId;
}

export type ProviderSettingsConnectivityTester = (
  input: ProviderSettingsConnectivityTestInput,
) => Promise<ModelConnectivityResult>;

export interface IModelSelectionService {
  readonly onDidChange: Event<ModelSelectionView>;
  getView(input?: ModelSelectionViewInput): Promise<ModelSelectionView>;
}

export interface ModelSelectionConfiguredDefaultSource {
  read(): Promise<ModelSelection | undefined>;
  onDidChange?(listener: () => void): () => void;
}

export interface OfficialPlansPolicy {
  isEnabled(): Promise<boolean> | boolean;
  onDidChange?(listener: () => void): () => void;
}

/**
 * 订阅界面开关：关闭时把官方套餐 provider 从 Provider Settings View 中移除，
 * 从而一次性隐藏套餐卡片、额度条、升级入口与用量套餐页。与 OfficialPlansPolicy
 * 正交 —— 后者管套餐模型是否可用，本策略只管界面是否出现。
 */
export interface SubscriptionUiPolicy {
  isEnabled(): Promise<boolean> | boolean;
  onDidChange?(listener: () => void): () => void;
}

export const IModelSelectionService = createServiceDescriptor<IModelSelectionService>(
  ServiceChannels.ModelSelection,
);

export function createProviderSettingsService(
  facade: ProviderSettingsFacade,
  ensureReady: () => Promise<void> = async () => {},
  testConnectivity?: ProviderSettingsConnectivityTester,
  subscriptionUiPolicy?: SubscriptionUiPolicy,
): IProviderSettingsService & { dispose(): void } {
  const listeners = new Set<(view: ProviderSettingsView) => void>();
  let disposed = false;
  /**
   * 关闭订阅界面时把官方套餐 provider 从视图里过滤掉。
   * 必须作用在所有返回视图的路径上：UI 会把 mutation 返回值直接提交进共享快照，
   * 只过滤 getView 会让一次保存又把套餐卡片带回来。
   */
  const projectView = async (view: ProviderSettingsView): Promise<ProviderSettingsView> => {
    if (!subscriptionUiPolicy) return view;
    if (await subscriptionUiPolicy.isEnabled()) return view;
    const providers = Object.freeze(
      view.providers.filter(
        (provider) =>
          !isOfficialPlanProvider({
            providerId: provider.providerId,
            group: provider.effectiveConfig.group,
            access: provider.effectiveConfig.access,
          }),
      ),
    );
    const visibleProviderIds = new Set(providers.map((provider) => provider.providerId));
    return Object.freeze({
      revision: view.revision,
      providerTemplates: view.providerTemplates,
      providerOrder: Object.freeze(
        view.providerOrder.filter((providerId) => visibleProviderIds.has(providerId)),
      ),
      providers,
    });
  };
  const emit = (view: ProviderSettingsView): void => {
    if (disposed) return;
    void projectView(view).then(
      (projected) => {
        if (disposed) return;
        for (const listener of listeners) listener(projected);
      },
      () => {
        // 过滤失败时退回原始视图，避免一次读取异常吞掉所有 provider 变更事件。
        if (disposed) return;
        for (const listener of listeners) listener(view);
      },
    );
  };
  const disposeFacade = facade.onDidChange(emit);
  // 开关切换不需要等下一次 provider 变更：由策略主动重发当前视图。
  const disposePolicy = subscriptionUiPolicy?.onDidChange?.(() => emit(facade.getView()));

  return {
    onDidChange: (listener) => {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeFacade();
      disposePolicy?.();
      listeners.clear();
    },
    getView: async () => {
      await ensureReady();
      return projectView(facade.getView());
    },
    refresh: async (reason) => {
      await ensureReady();
      return projectView(await facade.refresh(reason));
    },
    createPersonalProvider: async (input) => {
      await ensureReady();
      const result = await facade.createPersonalProvider(input);
      return { ...result, view: await projectView(result.view) };
    },
    resolveModelConfig: async (input) => {
      await ensureReady();
      return facade.resolveModelConfig(input);
    },
    savePersonalProviderOverlay: async (providerId, config, metadata) => {
      await ensureReady();
      return projectView(await facade.savePersonalProviderOverlay(providerId, config, metadata));
    },
    deletePersonalProvider: async (providerId) => {
      await ensureReady();
      return projectView(await facade.deletePersonalProvider(providerId));
    },
    reorderPersonalProviders: async (providerIds) => {
      await ensureReady();
      return projectView(await facade.reorderPersonalProviders(providerIds));
    },
    reorderPersonalModels: async (providerId, modelIds) => {
      await ensureReady();
      return projectView(await facade.reorderPersonalModels(providerId, modelIds));
    },
    addPersonalModel: async (providerId, modelId, config, useRecommendedConfig) => {
      await ensureReady();
      return projectView(
        await facade.addPersonalModel(providerId, modelId, config, useRecommendedConfig),
      );
    },
    renamePersonalModel: async (providerId, currentModelId, nextModelId) => {
      await ensureReady();
      return projectView(await facade.renamePersonalModel(providerId, currentModelId, nextModelId));
    },
    deletePersonalModel: async (providerId, modelId) => {
      await ensureReady();
      return projectView(await facade.deletePersonalModel(providerId, modelId));
    },
    savePersonalModelDraft: async (input) => {
      await ensureReady();
      return projectView(await facade.savePersonalModelDraft(input));
    },
    setPersonalModelEnabled: async (providerId, modelId, enabled) => {
      await ensureReady();
      return projectView(await facade.setPersonalModelEnabled(providerId, modelId, enabled));
    },
    testModelConnectivity: async (input) => {
      await ensureReady();
      if (!testConnectivity) {
        throw new Error("当前 Environment 未装配模型连通性测试能力");
      }
      await facade.waitForProviderOperations(input.providerId);
      // 禁用对象仍存在于配置视图，但不进入执行 Registry；不能把未发布误报成配置丢失。
      // 只消费操作完成后的公共资格，不另查 Key、权益，也不替代目标 Environment 最终校验。
      const provider = facade
        .getView()
        .providers.find((item) => item.providerId === input.providerId);
      const model = provider?.models.find((item) => item.modelId === input.modelId);
      const unavailable =
        !provider || !provider.enabled
          ? "provider-unavailable"
          : !model || !model.enabled || model.issues.length > 0
            ? "model-unavailable"
            : !provider.executable
              ? "provider-unavailable"
              : !model.executable
                ? "model-unavailable"
                : undefined;
      if (unavailable) {
        return {
          success: false,
          error: {
            code: unavailable,
            message:
              unavailable === "provider-unavailable"
                ? "This provider is currently unavailable for connectivity testing."
                : "This model is currently unavailable for connectivity testing.",
          },
        };
      }
      return testConnectivity({
        workspacePath: input.workspacePath,
        ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
        providerId: input.providerId,
        modelId: input.modelId,
      });
    },
  };
}

export function createModelSelectionService(
  facade: ModelSelectionFacade,
  ensureReady: () => Promise<void> = async () => {},
  configuredDefaultSource?: ModelSelectionConfiguredDefaultSource,
  officialPlansPolicy?: OfficialPlansPolicy,
): IModelSelectionService & { dispose(): void } {
  const log = createServiceLogger("model-selection");
  let revision = 0;
  let disposed = false;
  const listeners = new Set<(view: ModelSelectionView) => void>();
  const getView = async (input?: ModelSelectionViewInput): Promise<ModelSelectionView> => {
    await ensureReady();
    if (disposed) throw new Error("ModelSelectionService 已 dispose");
    const [configuredDefault, officialPlansEnabled] = await Promise.all([
      configuredDefaultSource?.read(),
      officialPlansPolicy ? officialPlansPolicy.isEnabled() : true,
    ]);
    if (disposed) throw new Error("ModelSelectionService 已 dispose");
    const base = facade.getView(configuredDefault);
    if (revision < base.revision) revision = base.revision;
    const rawView = facade.getView(configuredDefault, revision, input);
    if (officialPlansEnabled) {
      return rawView;
    }

    const filteredProviders = Object.freeze(
      rawView.providers.filter(
        (provider) =>
          !isOfficialPlanProvider({
            providerId: provider.providerId,
            group: provider.config.group,
            access: provider.config.access,
          }),
      ),
    );
    const allowedProviderIds = new Set(filteredProviders.map((provider) => provider.providerId));

    let nextPreferred =
      rawView.preferredSelection && allowedProviderIds.has(rawView.preferredSelection.providerId)
        ? rawView.preferredSelection
        : undefined;
    if (!nextPreferred) {
      for (const provider of filteredProviders) {
        const firstModel = provider.models[0];
        if (!firstModel) continue;
        const candidate = completeNewModelSelection(
          { providers: filteredProviders },
          { providerId: provider.providerId, modelId: firstModel.modelId },
        );
        if (candidate) {
          nextPreferred = Object.freeze(candidate);
          break;
        }
      }
    }

    const nextEffective =
      rawView.effectiveSelection && !allowedProviderIds.has(rawView.effectiveSelection.providerId)
        ? null
        : rawView.effectiveSelection;
    const nextIssue =
      rawView.effectiveSelection && !allowedProviderIds.has(rawView.effectiveSelection.providerId)
        ? ("provider-not-found" as const)
        : rawView.selectionIssue;

    return Object.freeze({
      revision: rawView.revision,
      providers: filteredProviders,
      ...(nextPreferred ? { preferredSelection: nextPreferred } : {}),
      ...(nextEffective !== undefined ? { effectiveSelection: nextEffective } : {}),
      ...(nextIssue !== undefined ? { selectionIssue: nextIssue } : {}),
    });
  };
  const emit = (): void => {
    if (disposed) return;
    revision += 1;
    void getView().then(
      (view) => {
        if (disposed) return;
        for (const listener of listeners) listener(view);
      },
      (error: unknown) => {
        // Registry 事件触发的异步 View 重建没有 owner；Host dispose 后它仍会继续
        // 读取已释放的配置仓库，并形成未处理 rejection。dispose 是明确的取消边界；仅在服务
        // 仍存活时记录真实读取失败。
        if (disposed) return;
        log.warn(undefined, `ModelSelection View 刷新失败: ${String(error)}`);
      },
    );
  };
  const disposeFacade = facade.onDidChange(emit);
  const disposeConfiguredDefault = configuredDefaultSource?.onDidChange?.(emit);
  const disposeOfficialPlansPolicy = officialPlansPolicy?.onDidChange?.(emit);

  return {
    onDidChange: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    getView,
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeFacade();
      disposeConfiguredDefault?.();
      disposeOfficialPlansPolicy?.();
      listeners.clear();
    },
  };
}
