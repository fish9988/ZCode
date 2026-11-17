import { ShieldAlert, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent } from "@/components/ui/card.js";
import { Switch } from "@/components/ui/switch.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";
import { CUSTOM_CSS_SNIPPETS } from "./presets.js";
import {
  CHAT_WIDTH_DEFAULT_PX,
  CHAT_WIDTH_MAX_PX,
  CHAT_WIDTH_MIN_PX,
  useCustomAppearanceStore,
} from "./store.js";

const WIDTH_PRESETS: Array<{ label: string; value: number | null }> = [
  { label: "自动", value: null },
  { label: "紧凑 760px", value: 760 },
  { label: "舒适 960px", value: 960 },
  { label: "宽屏 1200px", value: 1200 },
  { label: "超宽 1480px", value: 1480 },
];

export function LayoutAndCssCard() {
  const layout = useCustomAppearanceStore((state) => state.config.layout);
  const customCss = useCustomAppearanceStore((state) => state.config.customCss);
  const safeModeActive = useCustomAppearanceStore((state) => state.safeModeActive);
  const updateConfig = useCustomAppearanceStore((state) => state.updateConfig);
  const setChatMaxWidthPx = useCustomAppearanceStore((state) => state.setChatMaxWidthPx);
  const toggleSafeMode = useCustomAppearanceStore((state) => state.toggleSafeMode);

  return (
    <div className="min-w-0 space-y-6">
      <div className="min-w-0 space-y-3">
        <div>
          <h3 className="text-ui-lg font-semibold text-foreground">对话栏宽度与阅读体验</h3>
          <p className="mt-1 text-ui-base leading-6 text-foreground-subtle">
            可以直接在这里拉宽对话区，也可以把鼠标停在聊天框左边缘中间的隐藏边界上左右拖拽。
          </p>
        </div>

        <Card className="border border-border bg-card py-0 shadow-none">
          <CardContent className="space-y-0 px-0">
            <SettingsRow
              label="启用隐藏的半高拉伸边界"
              description="只在对话栏左侧中间留一半高度，悬停 0.15 秒才显现，双击可一键还原默认宽度。"
              control={
                <Switch
                  checked={layout.enableResizeHandle}
                  onCheckedChange={(checked) =>
                    updateConfig((prev) => ({
                      ...prev,
                      layout: { ...prev.layout, enableResizeHandle: checked },
                    }))
                  }
                />
              }
            />

            <div className="space-y-3 border-t border-border px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-ui-base font-medium text-foreground">
                  当前对话宽度：{layout.chatMaxWidthPx === null ? "跟随官方自适应" : `${layout.chatMaxWidthPx} px`}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {WIDTH_PRESETS.map((preset) => {
                    const active = layout.chatMaxWidthPx === preset.value;
                    return (
                      <Button
                        key={preset.label}
                        type="button"
                        size="sm"
                        variant={active ? "default" : "outline"}
                        onClick={() => setChatMaxWidthPx(preset.value)}
                      >
                        {preset.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
              <input
                type="range"
                min={CHAT_WIDTH_MIN_PX}
                max={CHAT_WIDTH_MAX_PX}
                step={10}
                value={layout.chatMaxWidthPx ?? CHAT_WIDTH_DEFAULT_PX}
                onChange={(e) => setChatMaxWidthPx(Number(e.currentTarget.value))}
                className="w-full"
              />
            </div>

            <SettingsRow
              label="宽屏下只拉宽代码和表格"
              description="对话拉得很宽时，普通文字仍保持在舒适阅读宽度内，防止看长文串行；代码块与表格则占满全部宽度。"
              control={
                <Switch
                  checked={layout.wideCodeBlocks}
                  onCheckedChange={(checked) =>
                    updateConfig((prev) => ({
                      ...prev,
                      layout: { ...prev.layout, wideCodeBlocks: checked },
                    }))
                  }
                />
              }
            />

            <SettingsRow
              label="思考与工具卡片紧凑模式"
              description="缩小 AI 思考过程与调用工具卡片的上下留白，让长对话更专注于最终回答。"
              control={
                <Switch
                  checked={layout.compactProcessCards}
                  onCheckedChange={(checked) =>
                    updateConfig((prev) => ({
                      ...prev,
                      layout: { ...prev.layout, compactProcessCards: checked },
                    }))
                  }
                />
              }
            />
          </CardContent>
        </Card>
      </div>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-ui-lg font-semibold text-foreground">自定义 CSS 覆盖</h3>
            <p className="mt-1 text-ui-base leading-6 text-foreground-subtle">
              贴入自定义样式即可实时生效。按 Ctrl+Shift+Alt+R（Mac 为 Cmd+Shift+Alt+R）可随时紧急关闭。
            </p>
          </div>
          {safeModeActive ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => toggleSafeMode(false)}
            >
              <ShieldAlert className="mr-1.5 size-3.5" />
              安全模式中 · 点此恢复 CSS
            </Button>
          ) : null}
        </div>

        <Card className="border border-border bg-card py-0 shadow-none">
          <CardContent className="space-y-0 px-0">
            <SettingsRow
              label="启用自定义 CSS"
              description="如果写错样式导致界面显示异常，直接关掉这个开关就能立刻恢复原样。"
              control={
                <Switch
                  checked={customCss.enabled}
                  onCheckedChange={(checked) =>
                    updateConfig((prev) => ({
                      ...prev,
                      customCss: { ...prev.customCss, enabled: checked },
                    }))
                  }
                />
              }
            />

            <div className="space-y-3 border-t border-border px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1 text-ui-sm text-foreground-subtle">
                  <Sparkles className="size-3.5" />
                  常用片段一键添加：
                </span>
                {CUSTOM_CSS_SNIPPETS.map((snippet) => (
                  <Button
                    key={snippet.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      updateConfig((prev) => ({
                        ...prev,
                        customCss: {
                          ...prev.customCss,
                          enabled: true,
                          code: prev.customCss.code.trim()
                            ? `${prev.customCss.code.trimEnd()}\n\n${snippet.code}`
                            : snippet.code,
                        },
                      }))
                    }
                  >
                    + {snippet.label}
                  </Button>
                ))}
              </div>

              <textarea
                value={customCss.code}
                onChange={(e) => {
                  const code = e.currentTarget.value;
                  updateConfig((prev) => ({
                    ...prev,
                    customCss: { ...prev.customCss, code },
                  }));
                }}
                rows={8}
                spellCheck={false}
                placeholder={`/* 在这里写你的 CSS 覆盖样式，例如：\n[data-v4-user-input-bubble="true"] {\n  border-radius: 18px;\n}\n*/`}
                className="w-full rounded-lg border border-input-border bg-input p-3 font-mono text-ui-sm leading-5 text-foreground placeholder:text-foreground-subtlest focus:border-input-border-focused"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
