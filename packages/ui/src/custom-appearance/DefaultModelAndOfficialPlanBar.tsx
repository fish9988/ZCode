import { useMemo, useState } from "react";
import { encodeCustomModelValue, decodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";
import { useModelSelectionServiceView } from "@/hooks/useModelSelectionView.js";
import { useServices } from "@/hooks/useServices.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { isOfficialPlanProvider, type ModelSelection } from "@zcode/shared";
import { Switch } from "@/components/ui/switch.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { toast } from "@/components/ui/toast.js";
import { Sparkles, ShieldOff } from "lucide-react";

const AUTO_MODEL_VALUE = "__auto__";

export function DefaultModelAndOfficialPlanBar() {
  const services = useServices();
  const { settings, update } = useSettings();
  const modelSelectionRead = useModelSelectionServiceView(services.modelSelectionService);
  const [saving, setSaving] = useState(false);

  const officialPlansEnabled = settings?.officialPlansEnabled !== false;
  const preferDefaultModelForNewTasks = settings?.preferDefaultModelForNewTasks !== false;
  const configuredDefault = settings?.defaultModelSelection ?? null;

  const view =
    modelSelectionRead.state.status === "ready" ? modelSelectionRead.state.view : null;
  const providers = view?.providers ?? [];

  const selectedModelValue = configuredDefault
    ? encodeCustomModelValue(configuredDefault.providerId, configuredDefault.modelId)
    : AUTO_MODEL_VALUE;

  const matchedProviderAndModel = useMemo(() => {
    if (!configuredDefault) return null;
    const provider = providers.find((p) => p.providerId === configuredDefault.providerId);
    const model = provider?.models.find((m) => m.modelId === configuredDefault.modelId);
    return provider && model ? { provider, model } : null;
  }, [configuredDefault, providers]);

  const reasoningLevels = useMemo(
    () => matchedProviderAndModel?.model.config.optionSpecs.reasoningLevel.values ?? [],
    [matchedProviderAndModel],
  );

  const selectedReasoningLevel =
    configuredDefault?.options?.reasoningLevel &&
    reasoningLevels.includes(configuredDefault.options.reasoningLevel)
      ? configuredDefault.options.reasoningLevel
      : (reasoningLevels.at(-1) ?? "");

  const hasCustomModelAvailable = useMemo(
    () =>
      providers.some(
        (p) =>
          !isOfficialPlanProvider({
            providerId: p.providerId,
            group: p.config.group,
            access: p.config.access,
          }) && p.models.length > 0,
      ),
    [providers],
  );

  const updateSettingsSafely = async (patch: Parameters<typeof update>[0]) => {
    setSaving(true);
    try {
      await update(patch);
    } catch (error) {
      toast(error instanceof Error ? error.message : "保存模型默认设置失败", {
        variant: "warning",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDefaultModelChange = async (value: string) => {
    if (value === AUTO_MODEL_VALUE) {
      await updateSettingsSafely({ defaultModelSelection: null });
      toast("已恢复为自动选择默认模型", { variant: "success" });
      return;
    }

    const decoded = decodeCustomModelValue(value);
    if (!decoded || !decoded.modelName) return;
    const provider = providers.find((p) => p.providerId === decoded.providerId);
    const model = provider?.models.find((m) => m.modelId === decoded.modelName);
    const levels = model?.config.optionSpecs.reasoningLevel.values ?? [];
    const reasoningLevel = levels.at(-1);

    const nextSelection: ModelSelection = {
      providerId: decoded.providerId,
      modelId: decoded.modelName,
      ...(reasoningLevel ? { options: { reasoningLevel } } : {}),
    };

    await updateSettingsSafely({ defaultModelSelection: nextSelection });
    toast(`已将「${decoded.modelName}」设为全局默认模型`, { variant: "success" });
  };

  const handleReasoningChange = async (level: string) => {
    if (!configuredDefault) return;
    await updateSettingsSafely({
      defaultModelSelection: {
        providerId: configuredDefault.providerId,
        modelId: configuredDefault.modelId,
        options: { reasoningLevel: level },
      },
    });
  };

  const handleToggleOfficialPlans = async (nextEnabled: boolean) => {
    const patch: Parameters<typeof update>[0] = {
      officialPlansEnabled: nextEnabled,
    };

    if (!nextEnabled && configuredDefault) {
      const configuredProvider = providers.find(
        (p) => p.providerId === configuredDefault.providerId,
      );
      const pointsToOfficial = isOfficialPlanProvider({
        providerId: configuredDefault.providerId,
        group: configuredProvider?.config.group,
        access: configuredProvider?.config.access,
      });
      if (pointsToOfficial) {
        patch.defaultModelSelection = null;
      }
    }

    await updateSettingsSafely(patch);
    toast(
      nextEnabled
        ? "已启用智谱官方 Plan（BigModel / Start Plan）"
        : "已关闭智谱官方 Plan，聊天时将仅使用自定义供应商",
      { variant: "success" },
    );
  };

  const configuredIsUnavailable = Boolean(configuredDefault && view && !matchedProviderAndModel);

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2 text-ui-base font-medium text-foreground">
            <Sparkles className="size-4 text-primary" />
            <span>默认模型</span>
          </div>
          <p className="text-ui-sm text-foreground-subtle">
            指定新建对话时的全局默认模型；选「自动」则按当前可用列表顺位选择。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={selectedModelValue}
            onValueChange={(value) => {
              void handleDefaultModelChange(value);
            }}
            disabled={saving || modelSelectionRead.state.status === "loading"}
          >
            <SelectTrigger className="w-60 min-w-0 justify-between">
              <SelectValue placeholder="自动选择默认模型" />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              <SelectItem value={AUTO_MODEL_VALUE}>自动选择（按列表顺序）</SelectItem>
              {configuredIsUnavailable && configuredDefault ? (
                <SelectItem
                  value={encodeCustomModelValue(
                    configuredDefault.providerId,
                    configuredDefault.modelId,
                  )}
                >
                  {configuredDefault.modelId}（已停用或不可用）
                </SelectItem>
              ) : null}
              {providers
                .filter((provider) => provider.models.length > 0)
                .map((provider) => {
                  const groupLabel = provider.providerName?.trim() || provider.providerId;
                  return (
                    <SelectGroup key={provider.providerId}>
                      <SelectLabel>{groupLabel}</SelectLabel>
                      {provider.models.map((model) => {
                        const value = encodeCustomModelValue(provider.providerId, model.modelId);
                        return (
                          <SelectItem key={value} value={value}>
                            {groupLabel} · {model.modelId}
                          </SelectItem>
                        );
                      })}
                    </SelectGroup>
                  );
                })}
            </SelectContent>
          </Select>

          {reasoningLevels.length > 0 ? (
            <Select
              value={selectedReasoningLevel}
              onValueChange={(value) => {
                void handleReasoningChange(value);
              }}
              disabled={saving}
            >
              <SelectTrigger className="w-28 min-w-0 justify-between">
                <SelectValue placeholder="思考强度" />
              </SelectTrigger>
              <SelectContent>
                {reasoningLevels.map((level) => (
                  <SelectItem key={level} value={level}>
                    {level}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </div>

      {configuredDefault ? (
        <div className="flex items-center justify-between gap-4 border-t border-border/70 pt-3">
          <div className="min-w-0">
            <div className="text-ui-base font-medium text-foreground">
              新对话始终优先使用此默认模型
            </div>
            <p className="text-ui-sm text-foreground-subtle">
              开启后，每次新开对话直接用上述默认模型；关闭则优先沿用该项目上次使用过的模型。
            </p>
          </div>
          <Switch
            checked={preferDefaultModelForNewTasks}
            onCheckedChange={(checked) => {
              void updateSettingsSafely({ preferDefaultModelForNewTasks: checked });
            }}
            disabled={saving}
            aria-label="新对话始终优先使用此默认模型"
          />
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-4 border-t border-border/70 pt-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2 text-ui-base font-medium text-foreground">
            <ShieldOff className="size-4 text-foreground-subtle" />
            <span>启用智谱官方 Plan（BigModel / Start Plan）</span>
          </div>
          <p className="text-ui-sm text-foreground-subtle">
            关闭后将从模型选择器、默认推荐和回退中完全隐藏 BigModel / Start Plan / Z.ai 官方套餐，仅使用自定义供应商。
          </p>
          {!officialPlansEnabled && !hasCustomModelAvailable ? (
            <p className="pt-1 text-ui-sm text-amber-600 dark:text-amber-400">
              提示：当前尚未检测到可用的自定义供应商模型，请在下方添加并启用至少一个自定义供应商后再开始对话。
            </p>
          ) : null}
        </div>
        <Switch
          checked={officialPlansEnabled}
          onCheckedChange={(checked) => {
            void handleToggleOfficialPlans(checked);
          }}
          disabled={saving}
          aria-label="启用智谱官方 Plan"
        />
      </div>
    </div>
  );
}
