import { useMemo, useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import {
  CANONICAL_THINKING_LEVELS,
  THINKING_FORMATS,
  THINKING_PRESET_IDS,
  buildThinkingProfileFromPreset,
  buildTierEntryForFormat,
  compileThinkingProfileToOptionSpec,
  convertThinkingProfileFormat,
  defaultThinkingBudgetForLevel,
  parseOptionSpecToThinkingProfile,
  resolveDefaultThinkingFormat,
  type CanonicalThinkingLevel,
  type StructuredThinkingFormat,
  type ThinkingFormat,
  type ThinkingPresetId,
  type ThinkingProfile,
  type ThinkingTierAction,
  type ThinkingTierEntry,
} from "@zcode/shared/model-config";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";
import { thoughtLevelLabelId } from "@/chat-input-toolbar/thoughtLevelLabels.js";
import { ModelConfigHelp } from "@/settings/model-provider-section/ModelConfigHelp.js";
import { JsonSlotEditor } from "@/settings/model-provider-section/ProviderModelMetadataFields.js";

const EFFORT_FORMATS = new Set<StructuredThinkingFormat>([
  "openai",
  "openai-responses",
  "openrouter",
  "anthropic-adaptive",
  "deepseek",
]);

function allowedActionsForFormat(format: StructuredThinkingFormat): readonly ThinkingTierAction[] {
  if (format === "noop") return ["omit"];
  if (format === "anthropic-budget") return ["budget", "disabled", "omit"];
  if (format === "qwen") return ["enabled", "budget", "disabled", "omit"];
  if (format === "zai" || format === "qwen-chat-template") return ["enabled", "disabled", "omit"];
  return ["value", "disabled", "omit"];
}

function canonicalOrderIndex(levelId: string): number {
  const lower = levelId.trim().toLowerCase();
  const direct = CANONICAL_THINKING_LEVELS.indexOf(lower as CanonicalThinkingLevel);
  if (direct >= 0) return direct;
  if (lower === "none" || lower === "disabled") return 0;
  if (lower === "enabled") return 4;
  return -1;
}

function insertCanonicalTier(
  tiers: readonly ThinkingTierEntry[],
  level: CanonicalThinkingLevel,
  format: StructuredThinkingFormat,
): ThinkingTierEntry[] {
  const nextEntry = buildTierEntryForFormat(level, format);
  const targetRank = CANONICAL_THINKING_LEVELS.indexOf(level);
  const next = [...tiers];
  let insertAt = next.length;
  for (let i = 0; i < next.length; i += 1) {
    const rank = canonicalOrderIndex(next[i]!.id);
    if (rank >= 0 && rank > targetRank) {
      insertAt = i;
      break;
    }
  }
  next.splice(insertAt, 0, nextEntry);
  return next;
}

/**
 * Pi 风格可视化思考强度编辑器：
 * - 支持 1/2/3/4/5/6/7 档快捷预设与空洞开关条；
 * - 支持任意自定义档位名及「界面档位名 ≠ 上游参数值」独立映射；
 * - 支持 10 种协议格式一键编译为 ZCode 受限 CEL，并保留高级 CEL 直编入口。
 */
export function ThinkingLevelProfileEditor({
  apiType,
  values,
  mapValue,
  inheritedMapValue,
  overriddenValues,
  overriddenMap,
  onChange,
}: {
  apiType?: string | null;
  values: readonly string[];
  mapValue: string;
  inheritedMapValue?: string;
  overriddenValues: boolean;
  overriddenMap: boolean;
  onChange: (patch: {
    reasoningLevelValuesValue?: readonly string[];
    reasoningLevelMapValue?: string;
  }) => void;
}) {
  const { intl } = useZCodeIntl();
  const [newCustomName, setNewCustomName] = useState("");
  const [showAdvancedCel, setShowAdvancedCel] = useState(false);

  const effectiveMap = mapValue.trim() || inheritedMapValue?.trim() || "";
  const profile = useMemo<ThinkingProfile>(
    () => parseOptionSpecToThinkingProfile(values, effectiveMap, apiType),
    [apiType, effectiveMap, values],
  );
  const isCustomCel = profile.format === "custom-cel";
  const activeStructuredFormat: StructuredThinkingFormat = isCustomCel
    ? resolveDefaultThinkingFormat(apiType)
    : profile.format;

  const commitProfile = (nextProfile: ThinkingProfile) => {
    const compiled = compileThinkingProfileToOptionSpec(nextProfile);
    onChange({
      reasoningLevelValuesValue: compiled.values,
      reasoningLevelMapValue: compiled.map,
    });
  };

  const handleApplyPreset = (presetId: ThinkingPresetId) => {
    const baseFormat =
      presetId === "off-1"
        ? "noop"
        : activeStructuredFormat === "noop"
          ? resolveDefaultThinkingFormat(apiType)
          : activeStructuredFormat;
    commitProfile(buildThinkingProfileFromPreset(presetId, baseFormat));
  };

  const handleFormatChange = (nextFormat: ThinkingFormat) => {
    if (nextFormat === "custom-cel") {
      setShowAdvancedCel(true);
    }
    commitProfile(convertThinkingProfileFormat(profile, nextFormat));
  };

  const handleToggleCanonical = (level: CanonicalThinkingLevel) => {
    const format = activeStructuredFormat;
    const existingIndex = profile.tiers.findIndex(
      (tier) => tier.id.trim().toLowerCase() === level,
    );
    if (existingIndex >= 0) {
      if (profile.tiers.length <= 1) return;
      const nextTiers = profile.tiers.filter((_, index) => index !== existingIndex);
      commitProfile({ format, tiers: nextTiers });
      return;
    }
    const nextTiers = insertCanonicalTier(profile.tiers, level, format);
    commitProfile({ format, tiers: nextTiers });
  };

  const handleUpdateTier = (index: number, patch: Partial<ThinkingTierEntry>) => {
    const format = activeStructuredFormat;
    const nextTiers = profile.tiers.map((tier, idx) => (idx === index ? { ...tier, ...patch } : tier));
    commitProfile({ format, tiers: nextTiers });
  };

  const handleRenameTier = (index: number, nextRawName: string) => {
    const trimmed = nextRawName.trim();
    if (!trimmed) return;
    if (profile.tiers.some((tier, idx) => idx !== index && tier.id === trimmed)) return;
    const current = profile.tiers[index];
    if (!current || current.id === trimmed) return;
    // 若原先 wireValue 跟随旧档位名，则同步更新；若用户自定义过不同上游名，则保留上游名。
    const shouldSyncWire =
      current.action === "value" && (!current.wireValue || current.wireValue === current.id);
    handleUpdateTier(index, {
      id: trimmed,
      ...(shouldSyncWire ? { wireValue: trimmed } : {}),
    });
  };

  const handleMoveTier = (from: number, to: number) => {
    if (to < 0 || to >= profile.tiers.length || from === to) return;
    const nextTiers = [...profile.tiers];
    const [moved] = nextTiers.splice(from, 1);
    nextTiers.splice(to, 0, moved!);
    commitProfile({ format: activeStructuredFormat, tiers: nextTiers });
  };

  const handleDeleteTier = (index: number) => {
    if (profile.tiers.length <= 1) return;
    const nextTiers = profile.tiers.filter((_, idx) => idx !== index);
    commitProfile({ format: activeStructuredFormat, tiers: nextTiers });
  };

  const handleAddCustomTier = () => {
    const trimmed = newCustomName.trim();
    if (!trimmed) return;
    if (profile.tiers.some((tier) => tier.id === trimmed)) return;
    const nextEntry = buildTierEntryForFormat(trimmed, activeStructuredFormat);
    commitProfile({
      format: activeStructuredFormat,
      tiers: [...profile.tiers, nextEntry],
    });
    setNewCustomName("");
  };

  const formatCanonicalLabel = (level: CanonicalThinkingLevel) => {
    const labelId = thoughtLevelLabelId(level);
    return labelId ? intl.formatMessage({ id: labelId }) : level;
  };

  const allowedActions = allowedActionsForFormat(activeStructuredFormat);
  const celExpanded = showAdvancedCel || isCustomCel;

  return (
    <div className="space-y-3" data-thinking-profile-editor="true">
      {/* 标题与快捷档位预设 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-ui-base text-foreground-subtle">
          <div className="inline-flex items-center">
            <span>{intl.formatMessage({ id: "settings.modelProvider.reasoningLevelsOrdered" })}</span>
            <ModelConfigHelp field="reasoningLevelsOrdered" />
          </div>
          <span className="font-mono text-ui-xs text-foreground-subtlest">
            {intl.formatMessage(
              { id: "settings.modelProvider.reasoningTiersBadge" },
              { count: values.length },
            )}
          </span>
        </div>

        <div className="space-y-1">
          <div className="text-ui-xs text-foreground-subtlest">
            {intl.formatMessage({ id: "settings.modelProvider.thinking.presetLabel" })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {THINKING_PRESET_IDS.map((presetId) => (
              <Button
                key={presetId}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-md px-2 text-ui-xs"
                onClick={() => handleApplyPreset(presetId)}
              >
                {intl.formatMessage({ id: `settings.modelProvider.thinking.preset.${presetId}` })}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* 协议格式选择 */}
      <div className="space-y-1">
        <label className="block text-ui-xs text-foreground-subtlest">
          {intl.formatMessage({ id: "settings.modelProvider.thinking.formatLabel" })}
        </label>
        <Select
          value={profile.format}
          onValueChange={(next) => handleFormatChange(next as ThinkingFormat)}
        >
          <SelectTrigger size="default" className="w-full justify-between">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THINKING_FORMATS.map((fmt) => (
              <SelectItem key={fmt} value={fmt}>
                {intl.formatMessage({ id: `settings.modelProvider.thinking.format.${fmt}` })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isCustomCel ? (
        <div className="rounded-lg border border-border bg-surface px-3 py-2 text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "settings.modelProvider.thinking.customCelNotice" })}
        </div>
      ) : null}

      {/* Pi 7 档快选开关条 */}
      <div className="space-y-1">
        <div className="text-ui-xs text-foreground-subtlest">
          {intl.formatMessage({ id: "settings.modelProvider.thinking.quickStripLabel" })}
        </div>
        <div className="flex flex-wrap gap-1.5" data-thinking-canonical-strip="true">
          {CANONICAL_THINKING_LEVELS.map((level) => {
            const active = profile.tiers.some((tier) => tier.id.trim().toLowerCase() === level);
            const cannotDisable = active && profile.tiers.length <= 1;
            return (
              <button
                key={level}
                type="button"
                disabled={cannotDisable}
                aria-pressed={active}
                onClick={() => handleToggleCanonical(level)}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-ui-xs transition-colors disabled:opacity-50",
                  active
                    ? "border-primary bg-primary/10 font-medium text-foreground"
                    : "border-border bg-surface text-foreground-subtle hover:bg-hover",
                )}
              >
                <span className="font-mono">{level}</span>
                <span className="text-foreground-subtlest">({formatCanonicalLabel(level)})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 逐档排序与上游参数值映射表 */}
      {!isCustomCel ? (
        <div className="space-y-2 rounded-lg border border-border bg-surface p-2.5">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-2 px-1 text-ui-xs text-foreground-subtlest">
            <span className="w-11" />
            <span>{intl.formatMessage({ id: "settings.modelProvider.thinking.tierNameColumn" })}</span>
            <span>
              {intl.formatMessage({ id: "settings.modelProvider.thinking.wireActionColumn" })}
            </span>
            <span className="w-7" />
          </div>

          <div className="space-y-1.5" data-personal-override={overriddenValues}>
            {profile.tiers.map((tier, index) => (
              <ThinkingTierRow
                key={`${tier.id}-${index}`}
                tier={tier}
                index={index}
                total={profile.tiers.length}
                format={activeStructuredFormat}
                allowedActions={allowedActions}
                onRename={(nextName) => handleRenameTier(index, nextName)}
                onActionChange={(nextAction) => {
                  handleUpdateTier(index, {
                    action: nextAction,
                    ...(nextAction === "value" && !tier.wireValue ? { wireValue: tier.id } : {}),
                    ...(nextAction === "budget" && !tier.budgetTokens
                      ? { budgetTokens: defaultThinkingBudgetForLevel(tier.id) }
                      : {}),
                  });
                }}
                onWireValueChange={(wireValue) => handleUpdateTier(index, { wireValue })}
                onBudgetChange={(budgetTokens) => handleUpdateTier(index, { budgetTokens })}
                onMoveUp={() => handleMoveTier(index, index - 1)}
                onMoveDown={() => handleMoveTier(index, index + 1)}
                onDelete={() => handleDeleteTier(index)}
              />
            ))}
          </div>

          {/* 添加任意自定义档位 */}
          <div className="flex items-center gap-2 pt-1">
            <Input
              {...TECHNICAL_INPUT_ATTRIBUTES}
              type="text"
              size="sm"
              className="flex-1 font-mono"
              value={newCustomName}
              placeholder={intl.formatMessage({
                id: "settings.modelProvider.thinking.addCustomPlaceholder",
              })}
              onChange={(event) => setNewCustomName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAddCustomTier();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                !newCustomName.trim() ||
                profile.tiers.some((tier) => tier.id === newCustomName.trim())
              }
              onClick={handleAddCustomTier}
            >
              <PlusIcon className="size-3.5" aria-hidden="true" />
              {intl.formatMessage({ id: "settings.modelProvider.thinking.addCustomAction" })}
            </Button>
          </div>
        </div>
      ) : null}

      {/* 折叠式高级 CEL 预览 / 直接编辑 */}
      <div className="space-y-2" data-model-reasoning-level-map-editor="true">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-ui-xs text-foreground-subtle hover:text-foreground"
          onClick={() => setShowAdvancedCel((open) => !open)}
        >
          {celExpanded ? (
            <ChevronDownIcon className="size-3.5" aria-hidden="true" />
          ) : (
            <ChevronRightIcon className="size-3.5" aria-hidden="true" />
          )}
          <span>{intl.formatMessage({ id: "settings.modelProvider.thinking.advancedCelToggle" })}</span>
        </button>

        {celExpanded ? (
          <JsonSlotEditor
            label={intl.formatMessage({ id: "settings.modelProvider.reasoningLevelMapping" })}
            labelHelp={<ModelConfigHelp field="reasoningLevelMapping" />}
            value={mapValue}
            effectiveValue={inheritedMapValue}
            overridden={overriddenMap}
            onChange={(reasoningLevelMapValue) => onChange({ reasoningLevelMapValue })}
          />
        ) : null}
      </div>
    </div>
  );
}

function ThinkingTierRow({
  tier,
  index,
  total,
  format,
  allowedActions,
  onRename,
  onActionChange,
  onWireValueChange,
  onBudgetChange,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  tier: ThinkingTierEntry;
  index: number;
  total: number;
  format: StructuredThinkingFormat;
  allowedActions: readonly ThinkingTierAction[];
  onRename: (nextName: string) => void;
  onActionChange: (nextAction: ThinkingTierAction) => void;
  onWireValueChange: (wireValue: string) => void;
  onBudgetChange: (budgetTokens: number | undefined) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const { intl } = useZCodeIntl();
  const [nameDraft, setNameDraft] = useState(tier.id);
  const [wireDraft, setWireDraft] = useState(tier.wireValue ?? tier.id);
  const [budgetDraft, setBudgetDraft] = useState(
    tier.budgetTokens !== undefined ? String(tier.budgetTokens) : "",
  );

  // 当外部因为预设/排序改变 tier 时同步输入框
  const [syncedTierKey, setSyncedTierKey] = useState(
    `${tier.id}|${tier.wireValue ?? ""}|${tier.budgetTokens ?? ""}`,
  );
  const currentTierKey = `${tier.id}|${tier.wireValue ?? ""}|${tier.budgetTokens ?? ""}`;
  if (syncedTierKey !== currentTierKey) {
    setSyncedTierKey(currentTierKey);
    setNameDraft(tier.id);
    setWireDraft(tier.wireValue ?? tier.id);
    setBudgetDraft(tier.budgetTokens !== undefined ? String(tier.budgetTokens) : "");
  }

  const showWireInput = EFFORT_FORMATS.has(format) && tier.action === "value";
  const showBudgetInput = tier.action === "budget";

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-2">
      <div className="flex items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-5 p-0 text-foreground-subtlest"
          disabled={index === 0}
          aria-label={intl.formatMessage({ id: "settings.modelProvider.thinking.moveUp" })}
          onClick={onMoveUp}
        >
          <ArrowUpIcon className="size-3" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-5 p-0 text-foreground-subtlest"
          disabled={index === total - 1}
          aria-label={intl.formatMessage({ id: "settings.modelProvider.thinking.moveDown" })}
          onClick={onMoveDown}
        >
          <ArrowDownIcon className="size-3" aria-hidden="true" />
        </Button>
      </div>

      <Input
        {...TECHNICAL_INPUT_ATTRIBUTES}
        type="text"
        size="sm"
        className="font-mono"
        value={nameDraft}
        onChange={(event) => setNameDraft(event.target.value)}
        onBlur={() => {
          const trimmed = nameDraft.trim();
          if (!trimmed) {
            setNameDraft(tier.id);
            return;
          }
          onRename(trimmed);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onRename(nameDraft.trim());
          }
        }}
      />

      <div className="flex min-w-0 items-center gap-1.5">
        {allowedActions.length > 1 ? (
          <Select
            value={tier.action}
            onValueChange={(next) => onActionChange(next as ThinkingTierAction)}
          >
            <SelectTrigger size="sm" className="w-28 shrink-0 justify-between">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allowedActions.map((action) => (
                <SelectItem key={action} value={action}>
                  {intl.formatMessage({ id: `settings.modelProvider.thinking.action.${action}` })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="inline-flex h-7 items-center rounded-md border border-border bg-input px-2 font-mono text-ui-xs text-foreground-subtle">
            {intl.formatMessage({ id: `settings.modelProvider.thinking.action.${tier.action}` })}
          </span>
        )}

        {showWireInput ? (
          <Input
            {...TECHNICAL_INPUT_ATTRIBUTES}
            type="text"
            size="sm"
            className="min-w-0 flex-1 font-mono"
            value={wireDraft}
            placeholder={intl.formatMessage({
              id: "settings.modelProvider.thinking.wireValuePlaceholder",
            })}
            onChange={(event) => {
              setWireDraft(event.target.value);
            }}
            onBlur={() => {
              const trimmed = wireDraft.trim() || tier.id;
              setWireDraft(trimmed);
              onWireValueChange(trimmed);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                const trimmed = wireDraft.trim() || tier.id;
                setWireDraft(trimmed);
                onWireValueChange(trimmed);
              }
            }}
          />
        ) : null}

        {showBudgetInput ? (
          <Input
            {...TECHNICAL_INPUT_ATTRIBUTES}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            size="sm"
            className="min-w-0 flex-1 font-mono"
            value={budgetDraft}
            placeholder={intl.formatMessage({
              id: "settings.modelProvider.thinking.budgetPlaceholder",
            })}
            onChange={(event) => setBudgetDraft(event.target.value)}
            onBlur={() => {
              const parsed = Number(budgetDraft.trim());
              if (Number.isInteger(parsed) && parsed > 0) {
                onBudgetChange(parsed);
              } else {
                const fallback = tier.budgetTokens ?? defaultThinkingBudgetForLevel(tier.id);
                setBudgetDraft(String(fallback));
                onBudgetChange(fallback);
              }
            }}
          />
        ) : null}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7 text-foreground-subtle"
        disabled={total <= 1}
        aria-label={intl.formatMessage({ id: "settings.modelProvider.reasoningLevelDelete" })}
        onClick={onDelete}
      >
        <Trash2Icon className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}
