import type { ReactNode } from "react";
import type { ModelConfigObject } from "@zcode/provider";
import type { ProviderModelDraftValues } from "@/settings/model-provider-section/ProviderModelMetadata.js";
import { ThinkingLevelProfileEditor } from "@/custom-appearance/index.js";

export function ModelSettingsGroup({
  group,
  children,
}: {
  group: "basic" | "tokens" | "modalities" | "capabilities" | "reasoning" | "advanced";
  children: ReactNode;
}) {
  return (
    <section className="space-y-4" data-model-settings-group={group}>
      {children}
    </section>
  );
}

export function ProviderModelReasoningSettings({
  providerApiType,
  draft,
  personalConfig,
  inheritedConfig,
  overrideFields,
  onDraftChange,
}: {
  providerApiType?: string | null;
  draft: ProviderModelDraftValues;
  personalConfig?: ModelConfigObject;
  inheritedConfig?: ModelConfigObject;
  overrideFields?: ReadonlySet<string>;
  onDraftChange: (patch: Partial<ProviderModelDraftValues>) => void;
}) {
  return (
    <ModelSettingsGroup group="reasoning">
      <ThinkingLevelProfileEditor
        apiType={providerApiType}
        values={draft.reasoningLevelValuesValue}
        mapValue={draft.reasoningLevelMapValue}
        inheritedMapValue={
          draft.useRecommendedConfigValue === false
            ? undefined
            : (inheritedConfig?.optionSpecs?.reasoningLevel?.map ?? undefined)
        }
        overriddenValues={
          overrideFields
            ? overrideFields.has("reasoningLevelValuesValue")
            : personalConfig?.optionSpecs?.reasoningLevel?.values !== undefined
        }
        overriddenMap={
          overrideFields
            ? overrideFields.has("reasoningLevelMapValue")
            : personalConfig?.optionSpecs?.reasoningLevel?.map !== undefined
        }
        onChange={onDraftChange}
      />
    </ModelSettingsGroup>
  );
}
