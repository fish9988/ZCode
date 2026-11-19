import { useMemo, useState } from "react";
import { encodeCustomModelValue, decodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";
import { useModelSelectionServiceView } from "@/hooks/useModelSelectionView.js";
import { useServices } from "@/hooks/useServices.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { isOfficialPlanProvider, type ModelSelection } from "@zcode/shared";
import {
  TID_SETTINGS_DEFAULT_MODEL_REASONING_TRIGGER,
  TID_SETTINGS_DEFAULT_MODEL_TRIGGER,
  TID_SETTINGS_OFFICIAL_PLANS_SWITCH,
  TID_SETTINGS_PREFER_DEFAULT_MODEL_SWITCH,
  TID_SETTINGS_SUBSCRIPTION_UI_SWITCH,
} from "@zcode/shared/test-ids";
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
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const AUTO_MODEL_VALUE = "__auto__";

/**
 * 模型设置分区顶部的四行规范设置项：默认模型、新对话优先、官方 Plan、订阅界面。
 * 每行都登记在 settingsSearchIndex 中，searchId 与翻译 id 相同。
 */
export function DefaultModelAndOfficialPlanBar() {
  const { intl } = useZCodeIntl();
  const services = useServices();
  const { settings, update } = useSettings();
  const modelSelectionRead = useModelSelectionServiceView(services.modelSelectionService);
  const [saving, setSaving] = useState(false);

  const officialPlansEnabled = settings?.officialPlansEnabled !== false;
  const subscriptionUiEnabled = settings?.subscriptionUiEnabled !== false;
  const preferDefaultModelForNewTasks = settings?.preferDefaultModelForNewTasks !== false;
  const configuredDefault = settings?.defaultModelSelection ?? null;

  const view =
    modelSelectionRead.state.status === "ready" ? modelSelectionRead.state.view : null;
  // 视图未就绪时也要有稳定引用：直接写 `?? []` 会每次渲染新建数组，
  // 让下面的 useMemo 每帧重算（lint: exhaustive-deps 不稳定依赖）。
  const providers = useMemo(() => view?.providers ?? [], [view]);

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

  const updateSettingsSafely = async (patch: Parameters<typeof update>[0], failureId: string) => {
    setSaving(true);
    try {
      await update(patch);
    } catch (error) {
      toast(intl.formatMessage({ id: failureId }), { variant: "warning" });
      void error;
    } finally {
      setSaving(false);
    }
  };

  const handleDefaultModelChange = async (value: string) => {
    if (value === AUTO_MODEL_VALUE) {
      await updateSettingsSafely(
        { defaultModelSelection: null },
        "settings.defaultModel.saveError",
      );
      toast(intl.formatMessage({ id: "settings.defaultModel.cleared" }), { variant: "success" });
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

    await updateSettingsSafely(
      { defaultModelSelection: nextSelection },
      "settings.defaultModel.saveError",
    );
    toast(
      intl.formatMessage({ id: "settings.defaultModel.saved" }, { model: decoded.modelName }),
      { variant: "success" },
    );
  };

  const handleReasoningChange = async (level: string) => {
    if (!configuredDefault) return;
    await updateSettingsSafely(
      {
        defaultModelSelection: {
          providerId: configuredDefault.providerId,
          modelId: configuredDefault.modelId,
          options: { reasoningLevel: level },
        },
      },
      "settings.defaultModel.saveError",
    );
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

    await updateSettingsSafely(patch, "settings.officialPlans.saveError");
    toast(
      intl.formatMessage({
        id: nextEnabled ? "settings.officialPlans.enabled" : "settings.officialPlans.disabled",
      }),
      { variant: "success" },
    );
  };

  const handleToggleSubscriptionUi = async (nextEnabled: boolean) => {
    await updateSettingsSafely({ subscriptionUiEnabled: nextEnabled }, "settings.subscriptionUi.saveError");
    toast(
      intl.formatMessage({
        id: nextEnabled
          ? "settings.subscriptionUi.enabled"
          : "settings.subscriptionUi.disabled",
      }),
      { variant: "success" },
    );
  };

  const configuredIsUnavailable = Boolean(configuredDefault && view && !matchedProviderAndModel);
  const defaultModelLabel = intl.formatMessage({ id: "settings.defaultModel" });

  return (
    <SettingsGroupCard>
      <SettingsRow
        searchId="settings.defaultModel"
        label={defaultModelLabel}
        description={intl.formatMessage({ id: "settings.defaultModelDescription" })}
        controlLayout="wide"
        control={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Select
              value={selectedModelValue}
              onValueChange={(value) => {
                void handleDefaultModelChange(value);
              }}
              disabled={saving || modelSelectionRead.state.status === "loading"}
            >
              <SelectTrigger
                size="lg"
                className="w-60 min-w-0 justify-between"
                aria-label={defaultModelLabel}
                data-testid={TID_SETTINGS_DEFAULT_MODEL_TRIGGER}
              >
                <SelectValue placeholder={intl.formatMessage({ id: "settings.defaultModel.auto" })} />
              </SelectTrigger>
              <SelectContent className="max-h-80" position="popper" align="end" sideOffset={4}>
                <SelectItem value={AUTO_MODEL_VALUE}>
                  {intl.formatMessage({ id: "settings.defaultModel.autoOption" })}
                </SelectItem>
                {configuredIsUnavailable && configuredDefault ? (
                  <SelectItem
                    value={encodeCustomModelValue(
                      configuredDefault.providerId,
                      configuredDefault.modelId,
                    )}
                  >
                    {intl.formatMessage(
                      { id: "settings.defaultModel.unavailable" },
                      { model: configuredDefault.modelId },
                    )}
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
                <SelectTrigger
                  size="lg"
                  className="w-28 min-w-0 justify-between"
                  aria-label={intl.formatMessage({ id: "settings.defaultModel.reasoning" })}
                  data-testid={TID_SETTINGS_DEFAULT_MODEL_REASONING_TRIGGER}
                >
                  <SelectValue
                    placeholder={intl.formatMessage({ id: "settings.defaultModel.reasoning" })}
                  />
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
        }
      />

      {configuredDefault ? (
        <SettingsRow
          searchId="settings.preferDefaultModel"
          label={intl.formatMessage({ id: "settings.preferDefaultModel" })}
          description={intl.formatMessage({ id: "settings.preferDefaultModelDescription" })}
          control={
            <Switch
              checked={preferDefaultModelForNewTasks}
              onCheckedChange={(checked) => {
                void updateSettingsSafely(
                  { preferDefaultModelForNewTasks: checked },
                  "settings.preferDefaultModel.saveError",
                );
              }}
              disabled={saving}
              aria-label={intl.formatMessage({ id: "settings.preferDefaultModel" })}
              data-testid={TID_SETTINGS_PREFER_DEFAULT_MODEL_SWITCH}
            />
          }
        />
      ) : null}

      <SettingsRow
        searchId="settings.officialPlans"
        label={intl.formatMessage({ id: "settings.officialPlans" })}
        description={intl.formatMessage({ id: "settings.officialPlansDescription" })}
        control={
          <Switch
            checked={officialPlansEnabled}
            onCheckedChange={(checked) => {
              void handleToggleOfficialPlans(checked);
            }}
            disabled={saving}
            aria-label={intl.formatMessage({ id: "settings.officialPlans" })}
            data-testid={TID_SETTINGS_OFFICIAL_PLANS_SWITCH}
          />
        }
      />

      <SettingsRow
        searchId="settings.subscriptionUi"
        label={intl.formatMessage({ id: "settings.subscriptionUi" })}
        description={intl.formatMessage({ id: "settings.subscriptionUiDescription" })}
        control={
          <Switch
            checked={subscriptionUiEnabled}
            onCheckedChange={(checked) => {
              void handleToggleSubscriptionUi(checked);
            }}
            disabled={saving}
            aria-label={intl.formatMessage({ id: "settings.subscriptionUi" })}
            data-testid={TID_SETTINGS_SUBSCRIPTION_UI_SWITCH}
          />
        }
      />
    </SettingsGroupCard>
  );
}
