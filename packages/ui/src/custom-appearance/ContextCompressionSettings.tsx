import { useState } from "react";
import {
  DEFAULT_CONTEXT_COMPRESSION_SETTINGS,
  type ContextCompressionEngineMode,
  type ContextCompressionSettings as ContextCompressionSettingsValue,
} from "@zcode/shared";
import { useSettings } from "@/hooks/useSettingService.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { Switch } from "@/components/ui/switch.js";
import { toast } from "@/components/ui/toast.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";

const ENGINE_OPTIONS: readonly ContextCompressionEngineMode[] = [
  "dsh-compact",
  "billion-context",
  "legacy",
  "disabled",
];

const WINDOW_PRESETS: readonly { readonly label: string; readonly tokens: number | null }[] = [
  { label: "128K", tokens: 128_000 },
  { label: "200K", tokens: 200_000 },
  { label: "300K", tokens: 300_000 },
  { label: "500K", tokens: 500_000 },
  { label: "Auto", tokens: null },
];

function parsePositiveInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parsePercent(raw: string, min: number, max: number): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  const ratio = parsed > 1 ? parsed / 100 : parsed;
  if (ratio < min || ratio > max) return null;
  return Math.round(ratio * 100) / 100;
}

/**
 * 设置 → 行为与工具 → 上下文压缩配置卡：
 * - 切换压缩引擎（dsh-compact 默认 / billion-context (acp-kernel) / legacy / disabled）
 * - 全局默认有效压缩窗口（单模型可在模型编辑弹窗独立覆盖）
 * - 各引擎核心调优参数与 MIT 出处说明
 */
export function ContextCompressionSettings() {
  const { intl } = useZCodeIntl();
  const { settings, update } = useSettings();
  const [saving, setSaving] = useState(false);

  const current: ContextCompressionSettingsValue = {
    ...DEFAULT_CONTEXT_COMPRESSION_SETTINGS,
    ...settings?.contextCompression,
  };
  const engine: ContextCompressionEngineMode = current.engine ?? "dsh-compact";

  const [windowInput, setWindowInput] = useState(
    current.defaultEffectiveContextWindow ? String(current.defaultEffectiveContextWindow) : "",
  );
  const [syncedWindow, setSyncedWindow] = useState(current.defaultEffectiveContextWindow ?? null);
  if (syncedWindow !== (current.defaultEffectiveContextWindow ?? null)) {
    setSyncedWindow(current.defaultEffectiveContextWindow ?? null);
    setWindowInput(
      current.defaultEffectiveContextWindow ? String(current.defaultEffectiveContextWindow) : "",
    );
  }

  const patchCompression = async (patch: Partial<ContextCompressionSettingsValue>) => {
    setSaving(true);
    try {
      const next: ContextCompressionSettingsValue = {
        ...settings?.contextCompression,
        ...patch,
      };
      // 保持 dsh-compact 的 retainRatio < thresholdRatio 不变式
      const threshold = next.thresholdRatio ?? DEFAULT_CONTEXT_COMPRESSION_SETTINGS.thresholdRatio;
      const retain = next.retainRatio ?? DEFAULT_CONTEXT_COMPRESSION_SETTINGS.retainRatio;
      if (retain >= threshold) {
        next.retainRatio = Math.max(0.05, Math.round((threshold - 0.05) * 100) / 100);
      }
      await update({ contextCompression: next });
    } catch {
      toast(intl.formatMessage({ id: "settings.contextCompression.saveError" }), {
        variant: "warning",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsGroupCard>
      <SettingsRow
        searchId="settings.contextCompression"
        label={intl.formatMessage({ id: "settings.contextCompression.engine" })}
        description={intl.formatMessage({ id: "settings.contextCompression.engineDescription" })}
        detail={
          engine === "billion-context" ? (
            <p className="text-ui-xs leading-5 text-foreground-subtle">
              {intl.formatMessage({ id: "settings.contextCompression.biliAttribution" })}{" "}
              <a
                href="https://github.com/ranxianglei/billion-context"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                github.com/ranxianglei/billion-context
              </a>{" "}
              /{" "}
              <a
                href="https://github.com/ranxianglei/acp-kernel"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                acp-kernel
              </a>
            </p>
          ) : engine === "dsh-compact" ? (
            <p className="text-ui-xs leading-5 text-foreground-subtle">
              {intl.formatMessage({ id: "settings.contextCompression.dshSummary" })}
            </p>
          ) : null
        }
        control={
          <Select
            value={engine}
            disabled={saving}
            onValueChange={(value) => {
              void patchCompression({ engine: value as ContextCompressionEngineMode });
            }}
          >
            <SelectTrigger size="lg" className="w-[260px] min-w-0 justify-between">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENGINE_OPTIONS.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {intl.formatMessage({ id: `settings.contextCompression.engine.${mode}` })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {engine !== "disabled" ? (
        <SettingsRow
          searchId="settings.contextCompression.defaultEffectiveWindow"
          label={intl.formatMessage({ id: "settings.contextCompression.defaultEffectiveWindow" })}
          description={intl.formatMessage({
            id: "settings.contextCompression.defaultEffectiveWindowDescription",
          })}
          controlLayout="wide"
          control={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {WINDOW_PRESETS.map((preset) => {
                const active = (current.defaultEffectiveContextWindow ?? null) === preset.tokens;
                return (
                  <Button
                    key={preset.label}
                    type="button"
                    size="sm"
                    variant={active ? "secondary" : "outline"}
                    disabled={saving}
                    onClick={() => {
                      void patchCompression({ defaultEffectiveContextWindow: preset.tokens });
                    }}
                  >
                    {preset.tokens === null
                      ? intl.formatMessage({ id: "settings.contextCompression.unlimited" })
                      : preset.label}
                  </Button>
                );
              })}
              <Input
                {...TECHNICAL_INPUT_ATTRIBUTES}
                type="text"
                inputMode="numeric"
                size="sm"
                className="w-28 font-mono"
                disabled={saving}
                value={windowInput}
                placeholder={intl.formatMessage({
                  id: "settings.contextCompression.unlimited",
                })}
                onChange={(event) => setWindowInput(event.target.value)}
                onBlur={() => {
                  const trimmed = windowInput.trim();
                  if (!trimmed) {
                    if (current.defaultEffectiveContextWindow != null) {
                      void patchCompression({ defaultEffectiveContextWindow: null });
                    }
                    return;
                  }
                  const parsed = parsePositiveInt(trimmed);
                  if (parsed !== null && parsed !== current.defaultEffectiveContextWindow) {
                    void patchCompression({ defaultEffectiveContextWindow: parsed });
                  } else {
                    setWindowInput(
                      current.defaultEffectiveContextWindow
                        ? String(current.defaultEffectiveContextWindow)
                        : "",
                    );
                  }
                }}
              />
            </div>
          }
        />
      ) : null}

      {engine === "dsh-compact" ? (
        <>
          <SettingsRow
            label={intl.formatMessage({ id: "settings.contextCompression.dshThresholds" })}
            description={intl.formatMessage({
              id: "settings.contextCompression.dshThresholdsDescription",
            })}
            controlLayout="wide"
            control={
              <div className="flex flex-wrap items-center justify-end gap-2">
                <label className="flex items-center gap-1.5 text-ui-xs text-foreground-subtle">
                  <span>
                    {intl.formatMessage({ id: "settings.contextCompression.thresholdRatio" })}
                  </span>
                  <NumericSettingInput
                    value={Math.round((current.thresholdRatio ?? 0.6) * 100)}
                    suffix="%"
                    disabled={saving}
                    onCommit={(raw) => {
                      const ratio = parsePercent(raw, 0.3, 0.95);
                      if (ratio !== null) void patchCompression({ thresholdRatio: ratio });
                    }}
                  />
                </label>
                <label className="flex items-center gap-1.5 text-ui-xs text-foreground-subtle">
                  <span>
                    {intl.formatMessage({ id: "settings.contextCompression.retainRatio" })}
                  </span>
                  <NumericSettingInput
                    value={Math.round((current.retainRatio ?? 0.2) * 100)}
                    suffix="%"
                    disabled={saving}
                    onCommit={(raw) => {
                      const ratio = parsePercent(raw, 0.05, 0.5);
                      if (ratio !== null) void patchCompression({ retainRatio: ratio });
                    }}
                  />
                </label>
              </div>
            }
          />
          <SettingsRow
            label={intl.formatMessage({ id: "settings.contextCompression.recoverOnOverflow" })}
            description={intl.formatMessage({
              id: "settings.contextCompression.recoverOnOverflowDescription",
            })}
            control={
              <Switch
                checked={current.recoverOnOverflow !== false}
                disabled={saving}
                onCheckedChange={(checked) => {
                  void patchCompression({ recoverOnOverflow: checked });
                }}
              />
            }
          />
        </>
      ) : null}

      {engine === "dsh-compact" || engine === "legacy" ? (
        <SettingsRow
          label={intl.formatMessage({ id: "settings.contextCompression.microcompact" })}
          description={intl.formatMessage({
            id: "settings.contextCompression.microcompactDescription",
          })}
          control={
            <Switch
              checked={current.microcompactEnabled === true}
              disabled={saving}
              onCheckedChange={(checked) => {
                void patchCompression({ microcompactEnabled: checked });
              }}
            />
          }
        />
      ) : null}

      {engine === "billion-context" ? (
        <>
          <SettingsRow
            label={intl.formatMessage({ id: "settings.contextCompression.biliBands" })}
            description={intl.formatMessage({
              id: "settings.contextCompression.biliBandsDescription",
            })}
            controlLayout="wide"
            control={
              <div className="flex flex-wrap items-center justify-end gap-2">
                <label className="flex items-center gap-1.5 text-ui-xs text-foreground-subtle">
                  <span>{intl.formatMessage({ id: "settings.contextCompression.biliMinPct" })}</span>
                  <NumericSettingInput
                    value={Math.round((current.biliMinContextLimitPct ?? 0.45) * 100)}
                    suffix="%"
                    disabled={saving}
                    onCommit={(raw) => {
                      const ratio = parsePercent(raw, 0.2, 0.85);
                      if (ratio !== null) void patchCompression({ biliMinContextLimitPct: ratio });
                    }}
                  />
                </label>
                <label className="flex items-center gap-1.5 text-ui-xs text-foreground-subtle">
                  <span>{intl.formatMessage({ id: "settings.contextCompression.biliMaxPct" })}</span>
                  <NumericSettingInput
                    value={Math.round((current.biliMaxContextLimitPct ?? 0.75) * 100)}
                    suffix="%"
                    disabled={saving}
                    onCommit={(raw) => {
                      const ratio = parsePercent(raw, 0.4, 0.95);
                      if (ratio !== null) void patchCompression({ biliMaxContextLimitPct: ratio });
                    }}
                  />
                </label>
                <label className="flex items-center gap-1.5 text-ui-xs text-foreground-subtle">
                  <span>
                    {intl.formatMessage({ id: "settings.contextCompression.biliGrowthFloor" })}
                  </span>
                  <NumericSettingInput
                    value={current.biliGrowthFloorTokens ?? 50_000}
                    widthClass="w-24"
                    disabled={saving}
                    onCommit={(raw) => {
                      const parsed = parsePositiveInt(raw);
                      if (parsed !== null && parsed >= 5_000 && parsed <= 500_000) {
                        void patchCompression({ biliGrowthFloorTokens: parsed });
                      }
                    }}
                  />
                </label>
              </div>
            }
          />
          <SettingsRow
            label={intl.formatMessage({ id: "settings.contextCompression.biliProtect" })}
            description={intl.formatMessage({
              id: "settings.contextCompression.biliProtectDescription",
            })}
            controlLayout="wide"
            control={
              <div className="flex flex-wrap items-center justify-end gap-2">
                <label className="flex items-center gap-1.5 text-ui-xs text-foreground-subtle">
                  <span>
                    {intl.formatMessage({ id: "settings.contextCompression.biliPreserveMessages" })}
                  </span>
                  <NumericSettingInput
                    value={current.biliPreserveRecentMessages ?? 3}
                    widthClass="w-16"
                    disabled={saving}
                    onCommit={(raw) => {
                      const parsed = parsePositiveInt(raw);
                      if (parsed !== null && parsed >= 1 && parsed <= 20) {
                        void patchCompression({ biliPreserveRecentMessages: parsed });
                      }
                    }}
                  />
                </label>
                <label className="flex items-center gap-1.5 text-ui-xs text-foreground-subtle">
                  <span>
                    {intl.formatMessage({ id: "settings.contextCompression.biliPreserveTokens" })}
                  </span>
                  <NumericSettingInput
                    value={current.biliPreserveRecentTokens ?? 20_000}
                    widthClass="w-24"
                    disabled={saving}
                    onCommit={(raw) => {
                      const parsed = parsePositiveInt(raw);
                      if (parsed !== null && parsed >= 1_000 && parsed <= 200_000) {
                        void patchCompression({ biliPreserveRecentTokens: parsed });
                      }
                    }}
                  />
                </label>
              </div>
            }
          />
        </>
      ) : null}
    </SettingsGroupCard>
  );
}

function NumericSettingInput({
  value,
  suffix,
  widthClass = "w-16",
  disabled,
  onCommit,
}: {
  value: number;
  suffix?: string;
  widthClass?: string;
  disabled?: boolean;
  onCommit: (raw: string) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(String(value));
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Input
        {...TECHNICAL_INPUT_ATTRIBUTES}
        type="text"
        inputMode="numeric"
        size="sm"
        disabled={disabled}
        className={`${widthClass} font-mono text-right`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit(draft);
          }
        }}
      />
      {suffix ? <span className="font-mono text-ui-xs text-foreground-subtlest">{suffix}</span> : null}
    </span>
  );
}
