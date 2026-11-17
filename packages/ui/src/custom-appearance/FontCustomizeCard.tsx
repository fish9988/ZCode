import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent } from "@/components/ui/card.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";
import {
  buildCssFontStack,
  FALLBACK_CJK_FONTS,
  FALLBACK_MONO_FONTS,
  FALLBACK_WESTERN_FONTS,
  querySystemLocalFonts,
  type LocalFontEntry,
  type LocalFontLoadStatus,
} from "./fontLoader.js";
import { useCustomAppearanceStore } from "./store.js";

const WEIGHT_OPTIONS = [
  { value: 300, label: "300 · 细体 (Light)" },
  { value: 400, label: "400 · 常规 (Regular)" },
  { value: 500, label: "500 · 适中 (Medium，高分屏推荐)" },
  { value: 600, label: "600 · 半粗 (SemiBold，清晰护眼)" },
  { value: 700, label: "700 · 粗体 (Bold)" },
];

function FontFamilyPicker({
  label,
  value,
  placeholder,
  options,
  datalistId,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: string[];
  datalistId: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ui-sm font-medium text-foreground">{label}</span>
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-ui-xs text-foreground-subtle hover:text-foreground"
          >
            恢复默认
          </button>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Select
          value={value || "__default__"}
          onValueChange={(next) => onChange(next === "__default__" ? "" : next)}
        >
          <SelectTrigger size="lg" className="w-1/2 min-w-0 justify-between">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="__default__">跟随系统默认</SelectItem>
            {options.map((family) => (
              <SelectItem key={family} value={family}>
                {family}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          list={datalistId}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.currentTarget.value)}
          className="w-1/2 min-w-0"
        />
        <datalist id={datalistId}>
          {options.map((family) => (
            <option key={family} value={family} />
          ))}
        </datalist>
      </div>
    </div>
  );
}

export function FontCustomizeCard() {
  const fonts = useCustomAppearanceStore((state) => state.config.fonts);
  const updateConfig = useCustomAppearanceStore((state) => state.updateConfig);

  const [loadStatus, setLoadStatus] = useState<LocalFontLoadStatus>("idle");
  const [localFonts, setLocalFonts] = useState<LocalFontEntry[]>([]);

  const loadLocalFonts = useCallback(async () => {
    setLoadStatus("loading");
    const result = await querySystemLocalFonts();
    setLoadStatus(result.status);
    setLocalFonts(result.fonts);
  }, []);

  useEffect(() => {
    void loadLocalFonts();
  }, [loadLocalFonts]);

  const allFamilies =
    localFonts.length > 0
      ? localFonts.map((f) => f.family)
      : Array.from(
          new Set([...FALLBACK_CJK_FONTS, ...FALLBACK_WESTERN_FONTS, ...FALLBACK_MONO_FONTS]),
        );

  const cjkOptions =
    localFonts.length > 0
      ? [
          ...localFonts.filter((f) => f.isLikelyCjk).map((f) => f.family),
          ...localFonts.filter((f) => !f.isLikelyCjk).map((f) => f.family),
        ]
      : FALLBACK_CJK_FONTS;

  const monoOptions =
    localFonts.length > 0
      ? [
          ...localFonts.filter((f) => f.isLikelyMono).map((f) => f.family),
          ...localFonts.filter((f) => !f.isLikelyMono).map((f) => f.family),
        ]
      : FALLBACK_MONO_FONTS;

  const previewChatStack = buildCssFontStack(
    fonts.chat.westernFamily,
    fonts.chat.cjkFamily,
    "system-ui, sans-serif",
  );

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-ui-lg font-semibold text-foreground">界面与聊天字体</h3>
          <p className="mt-1 text-ui-base leading-6 text-foreground-subtle">
            自动读取你电脑已安装的字体，把菜单、AI 聊天正文和代码块分成三套独立字体。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loadStatus === "loading"}
          onClick={() => void loadLocalFonts()}
        >
          <RefreshCw
            className={`mr-1.5 size-3.5 ${loadStatus === "loading" ? "animate-spin" : ""}`}
          />
          {loadStatus === "ready"
            ? `已读取 ${localFonts.length} 个本机字体`
            : loadStatus === "denied"
              ? "点击授权读取本机字体"
              : "重新扫描本机字体"}
        </Button>
      </div>

      <Card className="border border-border bg-card py-0 shadow-none">
        <CardContent className="space-y-0 px-0">
          <SettingsRow
            label="启用独立字体设定"
            description="打开后可自由搭配电脑里的中文/英文字体和字重。"
            control={
              <Switch
                checked={fonts.enabled}
                onCheckedChange={(checked) =>
                  updateConfig((prev) => ({
                    ...prev,
                    fonts: { ...prev.fonts, enabled: checked },
                  }))
                }
              />
            }
          />

          {fonts.enabled ? (
            <div className="space-y-5 border-t border-border px-4 py-4">
              <div className="space-y-3">
                <div className="text-ui-base font-semibold text-foreground">
                  1. 软件界面字体（左侧栏、按钮、菜单）
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FontFamilyPicker
                    label="英文字体 / 数字"
                    value={fonts.ui.westernFamily}
                    placeholder="如 Segoe UI、Inter"
                    options={allFamilies}
                    datalistId="zcode-font-ui-west"
                    onChange={(westernFamily) =>
                      updateConfig((prev) => ({
                        ...prev,
                        fonts: { ...prev.fonts, ui: { ...prev.fonts.ui, westernFamily } },
                      }))
                    }
                  />
                  <FontFamilyPicker
                    label="中文字体"
                    value={fonts.ui.cjkFamily}
                    placeholder="如 Sarasa UI SC、微软雅黑"
                    options={cjkOptions}
                    datalistId="zcode-font-ui-cjk"
                    onChange={(cjkFamily) =>
                      updateConfig((prev) => ({
                        ...prev,
                        fonts: { ...prev.fonts, ui: { ...prev.fonts.ui, cjkFamily } },
                      }))
                    }
                  />
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-ui-sm text-foreground-subtle">界面字重：</span>
                  <Select
                    value={String(fonts.ui.weight)}
                    onValueChange={(value) =>
                      updateConfig((prev) => ({
                        ...prev,
                        fonts: { ...prev.fonts, ui: { ...prev.fonts.ui, weight: Number(value) } },
                      }))
                    }
                  >
                    <SelectTrigger size="sm" className="w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEIGHT_OPTIONS.map((w) => (
                        <SelectItem key={w.value} value={String(w.value)}>
                          {w.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3 border-t border-border pt-4">
                <div className="text-ui-base font-semibold text-foreground">
                  2. 聊天正文字体（AI 回复、我的气泡、输入框）
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FontFamilyPicker
                    label="英文字体 / 符号"
                    value={fonts.chat.westernFamily}
                    placeholder="如 Georgia、Segoe UI"
                    options={allFamilies}
                    datalistId="zcode-font-chat-west"
                    onChange={(westernFamily) =>
                      updateConfig((prev) => ({
                        ...prev,
                        fonts: { ...prev.fonts, chat: { ...prev.fonts.chat, westernFamily } },
                      }))
                    }
                  />
                  <FontFamilyPicker
                    label="中文字体"
                    value={fonts.chat.cjkFamily}
                    placeholder="如 Sarasa UI SC、霞鹜文楷"
                    options={cjkOptions}
                    datalistId="zcode-font-chat-cjk"
                    onChange={(cjkFamily) =>
                      updateConfig((prev) => ({
                        ...prev,
                        fonts: { ...prev.fonts, chat: { ...prev.fonts.chat, cjkFamily } },
                      }))
                    }
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1">
                    <span className="text-ui-sm text-foreground-subtle">正文字重</span>
                    <Select
                      value={String(fonts.chat.weight)}
                      onValueChange={(value) =>
                        updateConfig((prev) => ({
                          ...prev,
                          fonts: {
                            ...prev.fonts,
                            chat: { ...prev.fonts.chat, weight: Number(value) },
                          },
                        }))
                      }
                    >
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WEIGHT_OPTIONS.map((w) => (
                          <SelectItem key={w.value} value={String(w.value)}>
                            {w.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="space-y-1 text-ui-sm text-foreground-subtle">
                    <div>聊天字号：{fonts.chat.fontSizePx}px</div>
                    <input
                      type="range"
                      min={12}
                      max={22}
                      step={1}
                      value={fonts.chat.fontSizePx}
                      onChange={(e) => {
                        const fontSizePx = Number(e.currentTarget.value);
                        updateConfig((prev) => ({
                          ...prev,
                          fonts: { ...prev.fonts, chat: { ...prev.fonts.chat, fontSizePx } },
                        }));
                      }}
                      className="w-full"
                    />
                  </label>
                  <label className="space-y-1 text-ui-sm text-foreground-subtle">
                    <div>行距：{fonts.chat.lineHeight.toFixed(2)}</div>
                    <input
                      type="range"
                      min={1.35}
                      max={2.1}
                      step={0.05}
                      value={fonts.chat.lineHeight}
                      onChange={(e) => {
                        const lineHeight = Number(e.currentTarget.value);
                        updateConfig((prev) => ({
                          ...prev,
                          fonts: { ...prev.fonts, chat: { ...prev.fonts.chat, lineHeight } },
                        }));
                      }}
                      className="w-full"
                    />
                  </label>
                </div>

                <div
                  className="rounded-lg border border-border bg-surface p-3 text-foreground"
                  style={{
                    fontFamily: previewChatStack,
                    fontSize: `${fonts.chat.fontSizePx}px`,
                    lineHeight: fonts.chat.lineHeight,
                    fontWeight: fonts.chat.weight,
                  }}
                >
                  预览效果：Hello ZCode！中英混排的笔画粗细、行间距与 <strong>粗体文字</strong>{" "}
                  实际阅读观感一目了然。
                </div>
              </div>

              <div className="space-y-3 border-t border-border pt-4">
                <div className="text-ui-base font-semibold text-foreground">
                  3. 代码等宽字体（代码块、路径与终端输出）
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FontFamilyPicker
                    label="代码西文字体"
                    value={fonts.mono.westernFamily}
                    placeholder="如 JetBrains Mono、Cascadia Code"
                    options={monoOptions}
                    datalistId="zcode-font-mono-west"
                    onChange={(westernFamily) =>
                      updateConfig((prev) => ({
                        ...prev,
                        fonts: { ...prev.fonts, mono: { ...prev.fonts.mono, westernFamily } },
                      }))
                    }
                  />
                  <FontFamilyPicker
                    label="代码内中文搭配"
                    value={fonts.mono.cjkFamily}
                    placeholder="如 Sarasa Term SC、微软雅黑"
                    options={cjkOptions}
                    datalistId="zcode-font-mono-cjk"
                    onChange={(cjkFamily) =>
                      updateConfig((prev) => ({
                        ...prev,
                        fonts: { ...prev.fonts, mono: { ...prev.fonts.mono, cjkFamily } },
                      }))
                    }
                  />
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
