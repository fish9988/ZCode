import { buildCssFontStack } from "./fontLoader.js";
import type { CustomAppearanceConfig, CustomBaseMode } from "./types.js";

const VARS_STYLE_ID = "zcode-custom-appearance-vars";
const USER_CSS_STYLE_ID = "zcode-custom-css";
const WALLPAPER_LAYER_ID = "zcode-custom-wallpaper-layer";

const DEFAULT_SANS_FALLBACK =
  'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif';
const DEFAULT_MONO_FALLBACK =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Microsoft YaHei UI", "PingFang SC", monospace';

function hexToSurfaceColor(hexOrCss: string, opacity: number): string {
  const pct = Math.round(Math.min(1, Math.max(0.2, opacity)) * 100);
  if (pct >= 99) return hexOrCss;
  return `color-mix(in srgb, ${hexOrCss} ${pct}%, transparent)`;
}

function buildAppearanceCss(config: CustomAppearanceConfig, resolvedMode: CustomBaseMode): string {
  const blocks: string[] = [];
  const palette = resolvedMode === "dark" ? config.darkColors : config.lightColors;
  const wallpaperActive = config.wallpaper.enabled && config.wallpaper.imageUrl.trim().length > 0;
  const surfaceAlpha = wallpaperActive ? config.wallpaper.surfaceOpacity : 1;

  if (config.enableCustomColors || wallpaperActive) {
    const bgColor = config.enableCustomColors
      ? palette.background
      : resolvedMode === "dark"
        ? "#17181c"
        : "#f8f8f8";
    const sidebarColor = config.enableCustomColors
      ? palette.sidebar
      : resolvedMode === "dark"
        ? "#111215"
        : "#f0f0f0";
    const cardColor = config.enableCustomColors
      ? palette.card
      : resolvedMode === "dark"
        ? "#202227"
        : "#ffffff";
    const inputColor = config.enableCustomColors
      ? palette.input
      : resolvedMode === "dark"
        ? "#23252b"
        : "#ffffff";
    const userBubbleColor = config.enableCustomColors
      ? palette.userBubble
      : resolvedMode === "dark"
        ? "#2a2d35"
        : "#ececee";

    const colorVars: string[] = [
      `--color-background: ${hexToSurfaceColor(bgColor, wallpaperActive ? Math.max(0.35, surfaceAlpha - 0.15) : 1)};`,
      `--color-panel: ${hexToSurfaceColor(cardColor, surfaceAlpha)};`,
      `--color-header: ${hexToSurfaceColor(cardColor, surfaceAlpha)};`,
      `--color-sidebar: ${hexToSurfaceColor(sidebarColor, wallpaperActive ? Math.max(0.4, surfaceAlpha - 0.1) : 1)};`,
      `--color-card: ${hexToSurfaceColor(cardColor, surfaceAlpha)};`,
      `--color-popover: ${cardColor};`,
      `--color-input: ${hexToSurfaceColor(inputColor, Math.min(1, surfaceAlpha + 0.06))};`,
      `--color-input-focused: ${inputColor};`,
      `--color-user-message-bubble: ${hexToSurfaceColor(userBubbleColor, Math.min(1, surfaceAlpha + 0.05))};`,
      `--color-terminal-bg: ${hexToSurfaceColor(bgColor, surfaceAlpha)};`,
    ];

    if (config.enableCustomColors) {
      colorVars.push(
        `--color-brand: ${palette.brand};`,
        `--color-primary: ${palette.brand};`,
        `--color-resize-handle: ${palette.brand};`,
        `--color-foreground: ${palette.foreground};`,
        `--color-foreground-subtle: ${palette.foregroundSubtle};`,
        `--color-border: ${palette.border};`,
        `--color-card-border: ${palette.border};`,
        `--color-popover-border: ${palette.border};`,
        `--color-input-border: ${palette.border};`,
        `--color-selected: color-mix(in srgb, ${palette.brand} 14%, transparent);`,
        `--color-accent: color-mix(in srgb, ${palette.brand} 12%, transparent);`,
      );
    }

    blocks.push(`:root:root, :root.theme-zai-light, :root.theme-zai-dark {\n  ${colorVars.join("\n  ")}\n}`);
  }

  if (config.enableCustomColors && config.designLanguage !== "default") {
    if (config.designLanguage === "claude") {
      blocks.push(
        `[data-zcode-design-language="claude"] .chat-composer-input-surface {\n  border-radius: 18px;\n  border: 1px solid var(--color-border);\n  box-shadow: ${
          resolvedMode === "dark"
            ? "0 4px 16px rgb(0 0 0 / 28%), 0 1px 3px rgb(0 0 0 / 14%)"
            : "0 4px 18px rgb(20 20 19 / 8%), 0 1px 3px rgb(20 20 19 / 4%)"
        };\n}\n[data-zcode-design-language="claude"] [data-v4-user-input-bubble="true"] {\n  border-radius: 14px;\n}\n[data-zcode-design-language="claude"] [data-streamdown="code-block"] {\n  border-radius: 12px;\n}`,
      );
    } else if (config.designLanguage === "m3") {
      blocks.push(
        `[data-zcode-design-language="m3"] .chat-composer-input-surface {\n  border-radius: 24px;\n  box-shadow: 0 2px 12px color-mix(in srgb, var(--color-brand) 8%, transparent);\n}\n[data-zcode-design-language="m3"] [data-v4-user-input-bubble="true"] {\n  border-radius: 20px;\n  border-color: transparent;\n}\n[data-zcode-design-language="m3"] [data-streamdown="code-block"] {\n  border-radius: 16px;\n}`,
      );
    } else if (config.designLanguage === "fluent") {
      blocks.push(
        `[data-zcode-design-language="fluent"] .chat-composer-input-surface {\n  border-radius: 10px;\n  border: 1px solid var(--color-border);\n  box-shadow: 0 2px 6px rgb(0 0 0 / 6%);\n}\n[data-zcode-design-language="fluent"] .chat-composer-input-surface:focus-within {\n  border-bottom: 2px solid var(--color-brand);\n}\n[data-zcode-design-language="fluent"] [data-v4-user-input-bubble="true"] {\n  border-radius: 8px;\n}`,
      );
    } else if (config.designLanguage === "liquid-glass") {
      blocks.push(
        `[data-zcode-design-language="liquid-glass"] .chat-composer-input-surface {\n  border-radius: 20px;\n  backdrop-filter: blur(18px) saturate(160%);\n  border: 1px solid color-mix(in srgb, var(--color-foreground) 12%, transparent);\n  box-shadow: inset 0 1px 0 ${
          resolvedMode === "dark" ? "rgb(255 255 255 / 12%)" : "rgb(255 255 255 / 70%)"
        }, 0 8px 24px rgb(0 0 0 / ${resolvedMode === "dark" ? "26%" : "8%"});\n}\n[data-zcode-design-language="liquid-glass"] [data-v4-user-input-bubble="true"] {\n  border-radius: 18px;\n  backdrop-filter: blur(14px) saturate(140%);\n  box-shadow: inset 0 1px 0 ${
          resolvedMode === "dark" ? "rgb(255 255 255 / 10%)" : "rgb(255 255 255 / 65%)"
        };\n}`,
      );
    }
  }

  if (config.fonts.enabled) {
    const uiHasCustom =
      config.fonts.ui.westernFamily.trim() !== "" || config.fonts.ui.cjkFamily.trim() !== "";
    const chatHasCustom =
      config.fonts.chat.westernFamily.trim() !== "" || config.fonts.chat.cjkFamily.trim() !== "";
    const monoHasCustom =
      config.fonts.mono.westernFamily.trim() !== "" || config.fonts.mono.cjkFamily.trim() !== "";

    if (uiHasCustom || config.fonts.ui.weight !== 400) {
      const uiStack = uiHasCustom
        ? buildCssFontStack(
            config.fonts.ui.westernFamily,
            config.fonts.ui.cjkFamily,
            DEFAULT_SANS_FALLBACK,
          )
        : DEFAULT_SANS_FALLBACK;
      blocks.push(
        `:root:root {\n  --font-sans: ${uiStack};\n}\nbody, #root {\n  font-family: ${uiStack};\n  font-weight: ${config.fonts.ui.weight};\n}`,
      );
    }

    if (monoHasCustom || config.fonts.mono.weight !== 400) {
      const monoStack = monoHasCustom
        ? buildCssFontStack(
            config.fonts.mono.westernFamily,
            config.fonts.mono.cjkFamily,
            DEFAULT_MONO_FALLBACK,
          )
        : DEFAULT_MONO_FALLBACK;
      blocks.push(
        `:root:root {\n  --font-mono: ${monoStack};\n}\ncode, pre, kbd, samp, .font-mono {\n  font-family: ${monoStack};\n  font-weight: ${config.fonts.mono.weight};\n}`,
      );
    }

    const chatStack = chatHasCustom
      ? buildCssFontStack(
          config.fonts.chat.westernFamily,
          config.fonts.chat.cjkFamily,
          uiHasCustom
            ? buildCssFontStack(
                config.fonts.ui.westernFamily,
                config.fonts.ui.cjkFamily,
                DEFAULT_SANS_FALLBACK,
              )
            : DEFAULT_SANS_FALLBACK,
        )
      : "";

    const chatProps: string[] = [
      `font-size: ${config.fonts.chat.fontSizePx}px;`,
      `line-height: ${config.fonts.chat.lineHeight};`,
      `font-weight: ${config.fonts.chat.weight};`,
    ];
    if (chatStack) {
      chatProps.unshift(`font-family: ${chatStack};`);
    }

    blocks.push(
      `[data-conversation-selectable="true"],\n[data-conversation-selectable="true"] p,\n[data-conversation-selectable="true"] li,\n[data-conversation-selectable="true"] blockquote,\n[data-v4-user-input-bubble="true"],\n[data-testid="v4-composer-input"],\n[data-testid="v4-composer-input"] [contenteditable="true"] {\n  ${chatProps.join("\n  ")}\n}`,
    );
  }

  if (config.layout.chatMaxWidthPx !== null) {
    const px = config.layout.chatMaxWidthPx;
    blocks.push(
      `:root:root {\n  --zcode-chat-max-width: ${px}px;\n}\n[data-v4-timeline-content-column="true"],\n[data-v4-composer-dock-content="true"],\n[data-zcode-resize-frame="true"] {\n  max-width: min(calc(100% - 2rem), var(--zcode-chat-max-width)) !important;\n  width: 100% !important;\n}\n@container conversation (width >= 1280px) {\n  [data-v4-timeline-content-column="true"][class*="-translate-x-42"],\n  [data-v4-composer-dock-content="true"][class*="-translate-x-42"],\n  [data-zcode-resize-frame="true"][class*="-translate-x-42"] {\n    max-width: min(calc(100% - 24rem), var(--zcode-chat-max-width)) !important;\n  }\n}`,
    );
  }

  if (config.layout.wideCodeBlocks) {
    blocks.push(
      `[data-zcode-wide-code="true"] [data-conversation-selectable="true"] > div > p,\n[data-zcode-wide-code="true"] [data-conversation-selectable="true"] > div > ul,\n[data-zcode-wide-code="true"] [data-conversation-selectable="true"] > div > ol,\n[data-zcode-wide-code="true"] [data-conversation-selectable="true"] > div > blockquote {\n  max-width: 72ch;\n}`,
    );
  }

  if (config.layout.compactProcessCards) {
    blocks.push(
      `[data-zcode-compact-process="true"] [data-v4-turn-unit="true"] [data-slot="collapsible"] {\n  margin-block: 2px;\n}\n[data-zcode-compact-process="true"] [data-v4-turn-unit="true"] [data-slot="collapsible-trigger"] {\n  padding-block: 3px;\n  font-size: calc(var(--ui-font-size, 14px) - 2px);\n  opacity: 0.86;\n}`,
    );
  }

  return blocks.join("\n\n");
}

function ensureStyleElement(id: string): HTMLStyleElement {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  } else if (document.head.lastElementChild !== el) {
    document.head.appendChild(el);
  }
  return el;
}

function syncWallpaperLayer(config: CustomAppearanceConfig, resolvedMode: CustomBaseMode) {
  const active = config.wallpaper.enabled && config.wallpaper.imageUrl.trim().length > 0;
  let layer = document.getElementById(WALLPAPER_LAYER_ID);

  if (!active) {
    if (layer) layer.remove();
    return;
  }

  if (!layer) {
    layer = document.createElement("div");
    layer.id = WALLPAPER_LAYER_ID;
    layer.setAttribute("aria-hidden", "true");
    layer.style.position = "fixed";
    layer.style.inset = "0";
    layer.style.zIndex = "-1";
    layer.style.pointerEvents = "none";
    layer.style.overflow = "hidden";

    const img = document.createElement("div");
    img.dataset.role = "image";
    img.style.position = "absolute";
    img.style.inset = "-24px";
    img.style.backgroundSize = "cover";
    img.style.backgroundPosition = "center";

    const overlay = document.createElement("div");
    overlay.dataset.role = "overlay";
    overlay.style.position = "absolute";
    overlay.style.inset = "0";

    layer.append(img, overlay);
    document.body.prepend(layer);
  }

  const imgEl = layer.querySelector<HTMLElement>('[data-role="image"]');
  const overlayEl = layer.querySelector<HTMLElement>('[data-role="overlay"]');
  if (imgEl) {
    const safeUrl = config.wallpaper.imageUrl.replace(/"/g, '\\"');
    imgEl.style.backgroundImage = `url("${safeUrl}")`;
    imgEl.style.filter = `blur(${config.wallpaper.blurPx}px)`;
  }
  if (overlayEl) {
    const baseRgb = resolvedMode === "dark" ? "16, 17, 21" : "248, 249, 251";
    overlayEl.style.backgroundColor = `rgba(${baseRgb}, ${config.wallpaper.overlayOpacity})`;
  }
}

export function applyCustomAppearanceToDocument(
  config: CustomAppearanceConfig,
  resolvedMode: CustomBaseMode,
  safeModeActive: boolean,
): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  if (config.layout.wideCodeBlocks) {
    root.setAttribute("data-zcode-wide-code", "true");
  } else {
    root.removeAttribute("data-zcode-wide-code");
  }
  if (config.layout.compactProcessCards) {
    root.setAttribute("data-zcode-compact-process", "true");
  } else {
    root.removeAttribute("data-zcode-compact-process");
  }
  if (config.layout.chatMaxWidthPx !== null) {
    root.setAttribute("data-zcode-custom-width", "true");
  } else {
    root.removeAttribute("data-zcode-custom-width");
  }
  root.setAttribute("data-zcode-design-language", config.designLanguage);

  syncWallpaperLayer(config, resolvedMode);

  const varsStyle = ensureStyleElement(VARS_STYLE_ID);
  const nextVarsCss = buildAppearanceCss(config, resolvedMode);
  if (varsStyle.textContent !== nextVarsCss) {
    varsStyle.textContent = nextVarsCss;
  }

  const cssStyle = ensureStyleElement(USER_CSS_STYLE_ID);
  const nextUserCss = !safeModeActive && config.customCss.enabled ? config.customCss.code : "";
  if (cssStyle.textContent !== nextUserCss) {
    cssStyle.textContent = nextUserCss;
  }
}
