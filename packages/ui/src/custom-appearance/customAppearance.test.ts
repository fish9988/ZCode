// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { buildCssFontStack } from "./fontLoader.js";
import {
  BUILTIN_APPEARANCE_PRESETS,
  DEFAULT_CUSTOM_APPEARANCE_CONFIG,
} from "./presets.js";
import {
  CHAT_WIDTH_MAX_PX,
  CHAT_WIDTH_MIN_PX,
  normalizeCustomAppearanceConfig,
} from "./store.js";
import { applyCustomAppearanceToDocument } from "./styleEngine.js";

describe("custom-appearance", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-zcode-wide-code");
    document.documentElement.removeAttribute("data-zcode-compact-process");
    document.documentElement.removeAttribute("data-zcode-custom-width");
  });

  it("normalizes config and clamps chatMaxWidthPx bounds", () => {
    const tooSmall = normalizeCustomAppearanceConfig({
      layout: { chatMaxWidthPx: 200 },
    });
    expect(tooSmall.layout.chatMaxWidthPx).toBe(CHAT_WIDTH_MIN_PX);

    const tooLarge = normalizeCustomAppearanceConfig({
      layout: { chatMaxWidthPx: 9999 },
    });
    expect(tooLarge.layout.chatMaxWidthPx).toBe(CHAT_WIDTH_MAX_PX);

    const invalid = normalizeCustomAppearanceConfig("broken");
    expect(invalid).toEqual(DEFAULT_CUSTOM_APPEARANCE_CONFIG);
  });

  it("builds dual western + CJK font stack without duplicates", () => {
    expect(buildCssFontStack("Georgia", "Sarasa UI SC", "sans-serif")).toBe(
      'Georgia, "Sarasa UI SC", sans-serif',
    );
    expect(buildCssFontStack("Sarasa UI SC", "Sarasa UI SC", "sans-serif")).toBe(
      '"Sarasa UI SC", sans-serif',
    );
  });

  it("injects theme variables, fonts, chat width and respects safe mode for custom CSS", () => {
    const cfg = normalizeCustomAppearanceConfig({
      enableCustomColors: true,
      lightColors: { brand: "#123456" },
      fonts: {
        enabled: true,
        ui: { westernFamily: "Inter", cjkFamily: "Sarasa UI SC", weight: 500 },
        chat: {
          westernFamily: "Georgia",
          cjkFamily: "LXGW WenKai",
          weight: 500,
          fontSizePx: 15,
          lineHeight: 1.75,
        },
        mono: { westernFamily: "JetBrains Mono", cjkFamily: "Sarasa Term SC", weight: 400 },
      },
      layout: {
        chatMaxWidthPx: 1020,
        wideCodeBlocks: true,
        compactProcessCards: true,
      },
      customCss: {
        enabled: true,
        code: "body { opacity: 0.99; }",
      },
    });

    applyCustomAppearanceToDocument(cfg, "light", false);

    const varsStyle = document.getElementById("zcode-custom-appearance-vars");
    const cssStyle = document.getElementById("zcode-custom-css");

    expect(varsStyle?.textContent).toContain("--color-brand: #123456;");
    expect(varsStyle?.textContent).toContain('Inter, "Sarasa UI SC"');
    expect(varsStyle?.textContent).toContain('Georgia, "LXGW WenKai"');
    expect(varsStyle?.textContent).toContain("--zcode-chat-max-width: 1020px;");
    expect(varsStyle?.textContent).toContain(':not([data-centered-empty="true"])');
    expect(varsStyle?.textContent).toContain("calc(100% - 24rem)");
    expect(varsStyle?.textContent).toContain("--color-surface:");
    expect(document.documentElement.getAttribute("data-zcode-wide-code")).toBe("true");
    expect(document.documentElement.getAttribute("data-zcode-compact-process")).toBe("true");
    expect(cssStyle?.textContent).toContain("opacity: 0.99");

    // 开启安全模式后立即清空用户 CSS，但保留配置本身
    applyCustomAppearanceToDocument(cfg, "light", true);
    expect(document.getElementById("zcode-custom-css")?.textContent).toBe("");
  });

  it("includes Claude Code Desktop, Google M3, Microsoft Fluent 2, and Apple Liquid Glass dual-mode presets", () => {
    const ids = BUILTIN_APPEARANCE_PRESETS.map((p) => p.id);
    expect(ids).toContain("claude-code-desktop");
    expect(ids).toContain("google-m3-expressive");
    expect(ids).toContain("microsoft-fluent-2");
    expect(ids).toContain("apple-liquid-glass");

    for (const preset of BUILTIN_APPEARANCE_PRESETS) {
      expect(preset.patch.lightColors).toBeDefined();
      expect(preset.patch.darkColors).toBeDefined();
    }

    const claudeCfg = normalizeCustomAppearanceConfig({
      activePresetId: "claude-code-desktop",
      designLanguage: "claude",
      enableCustomColors: true,
      lightColors: BUILTIN_APPEARANCE_PRESETS.find((p) => p.id === "claude-code-desktop")!.patch.lightColors,
      darkColors: BUILTIN_APPEARANCE_PRESETS.find((p) => p.id === "claude-code-desktop")!.patch.darkColors,
    });
    applyCustomAppearanceToDocument(claudeCfg, "dark", false);
    expect(document.documentElement.getAttribute("data-zcode-design-language")).toBe("claude");
    expect(document.getElementById("zcode-custom-appearance-vars")?.textContent).toContain("#d97757");
  });
});
