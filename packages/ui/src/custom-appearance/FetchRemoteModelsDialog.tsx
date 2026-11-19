import { useMemo, useState } from "react";
import { LoaderCircle, RefreshCw, Search } from "lucide-react";
import type { RemoteProviderModelEntry } from "@zcode/shared";
import {
  THINKING_PRESET_IDS,
  buildThinkingProfileFromPreset,
  compileThinkingProfileToOptionSpec,
  inferThinkingProfileForModel,
  resolveDefaultThinkingFormat,
  type ThinkingPresetId,
  type ThinkingProfile,
} from "@zcode/shared/model-config";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";
import { formatModelContextWindowLabel } from "@/lib/tokenNumberFormat.js";

type FetchThinkingStrategy = "smart" | "builtin" | ThinkingPresetId;

export interface FetchRemoteModelImportItem {
  readonly modelId: string;
  readonly config: {
    readonly properties?: { readonly contextWindow?: number };
    readonly optionSpecs?: {
      readonly maxOutputTokens?: { readonly max?: number };
      readonly reasoningLevel?: {
        readonly values: readonly string[];
        readonly map: string;
      };
    };
  };
  readonly useRecommendedConfig: boolean;
}

function summarizeProfileRange(profile: ThinkingProfile): string {
  const first = profile.tiers[0]?.id;
  const last = profile.tiers.at(-1)?.id;
  if (!first) return "";
  if (profile.tiers.length === 1) return first;
  return `${first}..${last}`;
}

export function FetchRemoteModelsDialog({
  open,
  onOpenChange,
  loading,
  saving,
  error,
  endpointUrl,
  apiType,
  baseUrl,
  models,
  existingModelIds,
  onRetry,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  saving: boolean;
  error: string | null;
  endpointUrl: string | null;
  apiType?: string | null;
  baseUrl?: string | null;
  models: readonly RemoteProviderModelEntry[];
  existingModelIds: ReadonlySet<string>;
  onRetry: () => void;
  onConfirm: (items: readonly FetchRemoteModelImportItem[]) => void | Promise<void>;
}) {
  const { intl, locale } = useZCodeIntl();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [globalStrategy, setGlobalStrategy] = useState<FetchThinkingStrategy>("smart");
  const [perModelStrategy, setPerModelStrategy] = useState<
    Readonly<Record<string, FetchThinkingStrategy>>
  >({});

  const defaultFormat = useMemo(
    () => resolveDefaultThinkingFormat(apiType, baseUrl),
    [apiType, baseUrl],
  );

  const inferredById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof inferThinkingProfileForModel>>();
    for (const model of models) {
      map.set(
        model.id,
        inferThinkingProfileForModel({
          modelId: model.id,
          apiType,
          baseUrl,
          remoteEntry: model,
        }),
      );
    }
    return map;
  }, [apiType, baseUrl, models]);

  const resolveEffectiveProfile = (modelId: string): ThinkingProfile | null => {
    const strategy = perModelStrategy[modelId] ?? globalStrategy;
    if (strategy === "builtin") return null;
    if (strategy === "smart") {
      return inferredById.get(modelId)?.profile ?? null;
    }
    return buildThinkingProfileFromPreset(strategy, defaultFormat);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (saving) return;
    if (!nextOpen) {
      setSearchQuery("");
      setSelectedIds(new Set());
      setPerModelStrategy({});
    }
    onOpenChange(nextOpen);
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredModels = useMemo(() => {
    if (!normalizedQuery) return models;
    return models.filter(
      (model) =>
        model.id.toLowerCase().includes(normalizedQuery) ||
        (model.displayName?.toLowerCase().includes(normalizedQuery) ?? false) ||
        (model.ownedBy?.toLowerCase().includes(normalizedQuery) ?? false),
    );
  }, [models, normalizedQuery]);

  const selectableFilteredIds = useMemo(
    () => filteredModels.filter((model) => !existingModelIds.has(model.id)).map((model) => model.id),
    [existingModelIds, filteredModels],
  );

  const allFilteredSelected =
    selectableFilteredIds.length > 0 &&
    selectableFilteredIds.every((modelId) => selectedIds.has(modelId));

  const toggleModel = (modelId: string) => {
    if (existingModelIds.has(modelId) || saving) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    if (saving || selectableFilteredIds.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const id of selectableFilteredIds) next.delete(id);
      } else {
        for (const id of selectableFilteredIds) next.add(id);
      }
      return next;
    });
  };

  const selectedCount = selectedIds.size;

  const handleConfirm = async () => {
    if (selectedCount === 0 || saving) return;
    const orderedModels = models.filter(
      (model) => selectedIds.has(model.id) && !existingModelIds.has(model.id),
    );
    if (orderedModels.length === 0) return;

    const items: FetchRemoteModelImportItem[] = orderedModels.map((model) => {
      const profile = resolveEffectiveProfile(model.id);
      const reasoningLevel = profile ? compileThinkingProfileToOptionSpec(profile) : undefined;
      const properties =
        model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : undefined;
      const optionSpecs =
        model.maxOutputTokens !== undefined || reasoningLevel !== undefined
          ? {
              ...(model.maxOutputTokens !== undefined
                ? { maxOutputTokens: { max: model.maxOutputTokens } }
                : {}),
              ...(reasoningLevel ? { reasoningLevel } : {}),
            }
          : undefined;
      return {
        modelId: model.id,
        config: {
          ...(properties ? { properties } : {}),
          ...(optionSpecs ? { optionSpecs } : {}),
        },
        useRecommendedConfig: true,
      };
    });

    await onConfirm(items);
    setSearchQuery("");
    setSelectedIds(new Set());
    setPerModelStrategy({});
  };

  const formatStrategyLabel = (strategy: FetchThinkingStrategy): string => {
    if (strategy === "smart") {
      return intl.formatMessage({ id: "settings.modelProvider.fetchModelsThinkingStrategy.smart" });
    }
    if (strategy === "builtin") {
      return intl.formatMessage({
        id: "settings.modelProvider.fetchModelsThinkingStrategy.builtin",
      });
    }
    return intl.formatMessage({ id: `settings.modelProvider.thinking.preset.${strategy}` });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[min(48rem,calc(100vh-4rem))] max-w-2xl grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-clip"
        data-no-model-drag="true"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>
            {intl.formatMessage({ id: "settings.modelProvider.fetchModelsTitle" })}
          </DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: "settings.modelProvider.fetchModelsDescription" })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-foreground-subtlest"
                aria-hidden="true"
              />
              <Input
                {...TECHNICAL_INPUT_ATTRIBUTES}
                type="text"
                size="lg"
                className="pl-8"
                value={searchQuery}
                placeholder={intl.formatMessage({
                  id: "settings.modelProvider.fetchModelsSearchPlaceholder",
                })}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-ui-xs text-foreground-subtle">
                {intl.formatMessage({ id: "settings.modelProvider.fetchModelsThinkingStrategy" })}
              </span>
              <Select
                value={globalStrategy}
                onValueChange={(value) => {
                  setGlobalStrategy(value as FetchThinkingStrategy);
                  setPerModelStrategy({});
                }}
                disabled={saving}
              >
                <SelectTrigger size="lg" className="w-48 justify-between">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="smart">{formatStrategyLabel("smart")}</SelectItem>
                  <SelectItem value="builtin">{formatStrategyLabel("builtin")}</SelectItem>
                  {THINKING_PRESET_IDS.map((presetId) => (
                    <SelectItem key={presetId} value={presetId}>
                      {formatStrategyLabel(presetId)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-ui-sm text-foreground-subtle">
            <div className="min-w-0 truncate">
              {models.length > 0 ? (
                <span>
                  {intl.formatMessage(
                    { id: "settings.modelProvider.fetchModelsCount" },
                    { count: models.length },
                  )}
                  {endpointUrl ? ` · ${endpointUrl}` : ""}
                </span>
              ) : endpointUrl ? (
                <span className="font-mono">{endpointUrl}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {selectableFilteredIds.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={loading || saving}
                  onClick={toggleSelectAllFiltered}
                >
                  {intl.formatMessage({
                    id: allFilteredSelected
                      ? "settings.modelProvider.fetchModelsDeselectAll"
                      : "settings.modelProvider.fetchModelsSelectAll",
                  })}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={loading || saving}
                onClick={onRetry}
              >
                <RefreshCw
                  className={`size-3.5 ${loading ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                {intl.formatMessage({ id: "settings.modelProvider.fetchModelsRetry" })}
              </Button>
            </div>
          </div>
        </div>

        <div className="min-h-48 overflow-y-auto rounded-lg border border-border bg-surface">
          {loading ? (
            <div className="flex h-48 items-center justify-center gap-2 text-ui-base text-foreground-subtle">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              <span>{intl.formatMessage({ id: "settings.modelProvider.fetchModelsLoading" })}</span>
            </div>
          ) : error ? (
            <div className="flex h-48 flex-col items-center justify-center gap-3 px-4 text-center">
              <p className="max-w-full break-words text-ui-base text-destructive">{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                {intl.formatMessage({ id: "settings.modelProvider.fetchModelsRetry" })}
              </Button>
            </div>
          ) : models.length === 0 ? (
            <div className="flex h-48 items-center justify-center px-4 text-center text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "settings.modelProvider.fetchModelsEmpty" })}
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="flex h-48 items-center justify-center px-4 text-center text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "settings.modelProvider.fetchModelsNoMatch" })}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredModels.map((model) => {
                const alreadyAdded = existingModelIds.has(model.id);
                const checked = alreadyAdded || selectedIds.has(model.id);
                const resolvedProfile = resolveEffectiveProfile(model.id);
                const effectiveStrategy = perModelStrategy[model.id] ?? globalStrategy;
                const tierPill = resolvedProfile
                  ? resolvedProfile.tiers.length === 1
                    ? intl.formatMessage(
                        { id: "settings.modelProvider.reasoningFixedBadge" },
                        { level: resolvedProfile.tiers[0]!.id },
                      )
                    : `${intl.formatMessage(
                        { id: "settings.modelProvider.reasoningTiersBadge" },
                        { count: resolvedProfile.tiers.length },
                      )} · ${summarizeProfileRange(resolvedProfile)}`
                  : intl.formatMessage({
                      id: "settings.modelProvider.fetchModelsThinkingStrategy.builtin",
                    });

                return (
                  <div
                    key={model.id}
                    className={`flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                      alreadyAdded ? "opacity-60" : "hover:bg-hover"
                    }`}
                  >
                    <label
                      className={`flex min-w-0 flex-1 items-center gap-3 ${
                        alreadyAdded ? "cursor-default" : "cursor-pointer"
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={alreadyAdded || saving}
                        onCheckedChange={() => toggleModel(model.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate font-mono text-ui-base text-foreground">
                            {model.id}
                          </span>
                          {model.displayName ? (
                            <span className="truncate text-ui-xs text-foreground-subtle">
                              {model.displayName}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-ui-xs text-foreground-subtlest">
                          <span className="rounded bg-hover px-1.5 py-0.5 font-mono text-foreground-subtle">
                            {tierPill}
                          </span>
                          {model.contextWindow ? (
                            <span className="font-mono">
                              ctx {formatModelContextWindowLabel(model.contextWindow, locale)}
                            </span>
                          ) : null}
                          {model.maxOutputTokens ? (
                            <span className="font-mono">
                              out {formatModelContextWindowLabel(model.maxOutputTokens, locale)}
                            </span>
                          ) : null}
                          {model.ownedBy ? (
                            <span className="rounded bg-hover px-1.5 py-0.5">{model.ownedBy}</span>
                          ) : null}
                        </div>
                      </div>
                    </label>

                    {alreadyAdded ? (
                      <span className="shrink-0 rounded bg-hover px-1.5 py-0.5 text-ui-xs text-foreground-subtle">
                        {intl.formatMessage({
                          id: "settings.modelProvider.fetchModelsAlreadyAdded",
                        })}
                      </span>
                    ) : (
                      <Select
                        value={effectiveStrategy}
                        onValueChange={(value) => {
                          setPerModelStrategy((prev) => ({
                            ...prev,
                            [model.id]: value as FetchThinkingStrategy,
                          }));
                        }}
                        disabled={saving}
                      >
                        <SelectTrigger size="sm" className="w-32 shrink-0 justify-between text-ui-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="smart">
                            {intl.formatMessage({
                              id: "settings.modelProvider.fetchModelsThinkingStrategy.smart",
                            })}
                          </SelectItem>
                          <SelectItem value="builtin">
                            {intl.formatMessage({
                              id: "settings.modelProvider.fetchModelsThinkingStrategy.builtin",
                            })}
                          </SelectItem>
                          {THINKING_PRESET_IDS.map((presetId) => (
                            <SelectItem key={presetId} value={presetId}>
                              {formatStrategyLabel(presetId)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => handleOpenChange(false)}
          >
            {intl.formatMessage({ id: "settings.modelProvider.cancel" })}
          </Button>
          <Button
            type="button"
            disabled={selectedCount === 0 || saving || loading}
            onClick={() => void handleConfirm()}
          >
            {saving ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : null}
            {intl.formatMessage(
              { id: "settings.modelProvider.fetchModelsConfirm" },
              { count: selectedCount },
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
