import { useRef, useState } from "react";
import { Download, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent } from "@/components/ui/card.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { toast } from "@/components/ui/toast.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";
import { BUILTIN_APPEARANCE_PRESETS } from "./presets.js";
import { useCustomAppearanceStore } from "./store.js";
import type { CustomBaseMode, CustomThemeColorOverrides } from "./types.js";
import type { Theme } from "@/useTheme.js";

const COLOR_FIELDS: Array<{
  key: keyof CustomThemeColorOverrides;
  label: string;
  hint: string;
}> = [
  { key: "background", label: "主界面底色", hint: "聊天窗口最底层的背景颜色" },
  { key: "sidebar", label: "左侧栏底色", hint: "项目和历史会话列表区域的背景" },
  { key: "card", label: "卡片与面板色", hint: "设置卡片、弹窗、工具条的表面色" },
  { key: "input", label: "输入框底色", hint: "底部发消息编辑框的背景颜色" },
  { key: "userBubble", label: "我的气泡底色", hint: "你发送出去的消息气泡底色" },
  { key: "brand", label: "主强调色", hint: "高亮按钮、选中边框与拖拽边界线颜色" },
  { key: "foreground", label: "主要文字色", hint: "普通正文与标题的颜色" },
  { key: "foregroundSubtle", label: "次要说明文字色", hint: "辅助提示、时间、说明小字颜色" },
  { key: "border", label: "分割线与边框色", hint: "卡片外框和区域之间的细线颜色" },
];

export function ThemeCustomizeCard({
  resolvedMode,
  setTheme,
}: {
  resolvedMode: CustomBaseMode;
  setTheme: (theme: Theme) => void;
}) {
  const config = useCustomAppearanceStore((state) => state.config);
  const updateConfig = useCustomAppearanceStore((state) => state.updateConfig);
  const setColor = useCustomAppearanceStore((state) => state.setColor);
  const applyPreset = useCustomAppearanceStore((state) => state.applyPreset);
  const importConfigJson = useCustomAppearanceStore((state) => state.importConfigJson);
  const resetAll = useCustomAppearanceStore((state) => state.resetAll);

  const [editingMode, setEditingMode] = useState<CustomBaseMode>(resolvedMode);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);

  const activePalette = editingMode === "dark" ? config.darkColors : config.lightColors;

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `zcode-appearance-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast("已导出当前外观配置文件", { variant: "success" });
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      if (importConfigJson(text)) {
        toast("外观配置导入成功", { variant: "success" });
      } else {
        toast("配置文件格式不正确", { variant: "warning" });
      }
    } catch {
      toast("读取配置文件失败", { variant: "warning" });
    }
  };

  const handleWallpaperFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      toast("图片太大了，建议选 4MB 以内的壁纸以免卡顿", { variant: "warning" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        updateConfig((prev) => ({
          ...prev,
          wallpaper: {
            ...prev.wallpaper,
            enabled: true,
            imageUrl: reader.result as string,
          },
        }));
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-ui-lg font-semibold text-foreground">个人主题配色与壁纸</h3>
          <p className="mt-1 text-ui-base leading-6 text-foreground-subtle">
            一键套用配色方案，或者分开微调底色、侧边栏、气泡和字体颜色。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImportFile}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-1.5 size-3.5" />
            导入配置
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-1.5 size-3.5" />
            导出备份
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              resetAll();
              toast("已恢复默认外观设置", { variant: "info" });
            }}
          >
            <RotateCcw className="mr-1.5 size-3.5" />
            全部还原
          </Button>
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        {BUILTIN_APPEARANCE_PRESETS.map((preset) => {
          const active = config.activePresetId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                const mode = applyPreset(preset.id);
                if (mode) {
                  setEditingMode(mode);
                  setTheme(mode === "dark" ? "zai-dark" : "zai-light");
                }
              }}
              className={`rounded-xl border p-3 text-left transition-colors ${
                active
                  ? "border-brand bg-accent"
                  : "border-border bg-card hover:bg-surface-hover"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-ui-base font-semibold text-foreground">{preset.name}</span>
                <span className="rounded bg-surface px-1.5 py-0.5 text-ui-xs text-foreground-subtle">
                  {preset.recommendedMode === "dark" ? "深色" : "浅色"}
                </span>
              </div>
              <p className="mt-1 text-ui-sm leading-5 text-foreground-subtle">
                {preset.description}
              </p>
            </button>
          );
        })}
      </div>

      <Card className="border border-border bg-card py-0 shadow-none">
        <CardContent className="space-y-0 px-0">
          <SettingsRow
            label="启用自定义颜色"
            description="关闭时完全跟随上方官方的深色/浅色模式。"
            control={
              <Switch
                checked={config.enableCustomColors}
                onCheckedChange={(checked) =>
                  updateConfig((prev) => ({
                    ...prev,
                    enableCustomColors: checked,
                  }))
                }
              />
            }
          />

          {config.enableCustomColors ? (
            <div className="border-t border-border px-4 py-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-ui-base font-medium text-foreground">
                  正在编辑：{editingMode === "light" ? "浅色模式配色" : "深色模式配色"}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={editingMode === "light" ? "default" : "outline"}
                    onClick={() => setEditingMode("light")}
                  >
                    浅色方案
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={editingMode === "dark" ? "default" : "outline"}
                    onClick={() => setEditingMode("dark")}
                  >
                    深色方案
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {COLOR_FIELDS.map((field) => {
                  const value = activePalette[field.key];
                  return (
                    <div
                      key={field.key}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-ui-sm font-medium text-foreground">
                          {field.label}
                        </div>
                        <div className="truncate text-ui-xs text-foreground-subtle">
                          {field.hint}
                        </div>
                      </div>
                      <label className="flex shrink-0 cursor-pointer items-center gap-1.5">
                        <input
                          type="color"
                          value={value.startsWith("#") && value.length === 7 ? value : "#38bdf8"}
                          onChange={(e) => setColor(editingMode, field.key, e.currentTarget.value)}
                          className="h-7 w-7 cursor-pointer rounded border border-border bg-transparent p-0"
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <SettingsRow
            label="背景壁纸与半透明玻璃感"
            description="选一张图片铺在最底层，聊天和侧栏会微微透出背景效果。"
            control={
              <Switch
                checked={config.wallpaper.enabled}
                onCheckedChange={(checked) =>
                  updateConfig((prev) => ({
                    ...prev,
                    wallpaper: { ...prev.wallpaper, enabled: checked },
                  }))
                }
              />
            }
          />

          {config.wallpaper.enabled ? (
            <div className="space-y-3 border-t border-border px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={wallpaperInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleWallpaperFile}
                />
                <Input
                  value={config.wallpaper.imageUrl.startsWith("data:") ? "(已选择本地图片)" : config.wallpaper.imageUrl}
                  placeholder="粘贴图片链接，或点右侧选择本地壁纸"
                  onChange={(e) => {
                    const nextUrl = e.currentTarget.value;
                    updateConfig((prev) => ({
                      ...prev,
                      wallpaper: { ...prev.wallpaper, imageUrl: nextUrl },
                    }));
                  }}
                  className="min-w-0 flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => wallpaperInputRef.current?.click()}
                >
                  选择本地图片
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="space-y-1 text-ui-sm text-foreground-subtle">
                  <div>背景模糊度：{config.wallpaper.blurPx}px</div>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    step={1}
                    value={config.wallpaper.blurPx}
                    onChange={(e) => {
                      const blurPx = Number(e.currentTarget.value);
                      updateConfig((prev) => ({
                        ...prev,
                        wallpaper: { ...prev.wallpaper, blurPx },
                      }));
                    }}
                    className="w-full"
                  />
                </label>
                <label className="space-y-1 text-ui-sm text-foreground-subtle">
                  <div>防刺眼遮罩深度：{Math.round(config.wallpaper.overlayOpacity * 100)}%</div>
                  <input
                    type="range"
                    min={0.25}
                    max={0.95}
                    step={0.05}
                    value={config.wallpaper.overlayOpacity}
                    onChange={(e) => {
                      const overlayOpacity = Number(e.currentTarget.value);
                      updateConfig((prev) => ({
                        ...prev,
                        wallpaper: { ...prev.wallpaper, overlayOpacity },
                      }));
                    }}
                    className="w-full"
                  />
                </label>
                <label className="space-y-1 text-ui-sm text-foreground-subtle">
                  <div>面板不透明度：{Math.round(config.wallpaper.surfaceOpacity * 100)}%</div>
                  <input
                    type="range"
                    min={0.5}
                    max={1}
                    step={0.05}
                    value={config.wallpaper.surfaceOpacity}
                    onChange={(e) => {
                      const surfaceOpacity = Number(e.currentTarget.value);
                      updateConfig((prev) => ({
                        ...prev,
                        wallpaper: { ...prev.wallpaper, surfaceOpacity },
                      }));
                    }}
                    className="w-full"
                  />
                </label>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
