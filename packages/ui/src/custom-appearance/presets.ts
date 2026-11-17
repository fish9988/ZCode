import type {
  AppearancePreset,
  CustomAppearanceConfig,
  CustomThemeColorOverrides,
} from "./types.js";

export const DEFAULT_LIGHT_COLORS: CustomThemeColorOverrides = {
  background: "#f8f8f8",
  sidebar: "#f0f0f0",
  card: "#ffffff",
  input: "#ffffff",
  userBubble: "#ececee",
  brand: "#0066dd",
  foreground: "#171717",
  foregroundSubtle: "#5c5c5c",
  border: "#e2e2e5",
};

export const DEFAULT_DARK_COLORS: CustomThemeColorOverrides = {
  background: "#17181c",
  sidebar: "#111215",
  card: "#202227",
  input: "#23252b",
  userBubble: "#2a2d35",
  brand: "#38bdf8",
  foreground: "#e5e7eb",
  foregroundSubtle: "#9ca3af",
  border: "#2e313a",
};

export const DEFAULT_CUSTOM_APPEARANCE_CONFIG: CustomAppearanceConfig = {
  version: 1,
  activePresetId: "zcode-native",
  enableCustomColors: false,
  lightColors: { ...DEFAULT_LIGHT_COLORS },
  darkColors: { ...DEFAULT_DARK_COLORS },
  wallpaper: {
    enabled: false,
    imageUrl: "",
    blurPx: 14,
    overlayOpacity: 0.78,
    surfaceOpacity: 0.88,
  },
  fonts: {
    enabled: false,
    ui: {
      westernFamily: "",
      cjkFamily: "",
      weight: 400,
    },
    chat: {
      westernFamily: "",
      cjkFamily: "",
      weight: 400,
      fontSizePx: 14,
      lineHeight: 1.65,
    },
    mono: {
      westernFamily: "",
      cjkFamily: "",
      weight: 400,
    },
  },
  layout: {
    chatMaxWidthPx: null,
    enableResizeHandle: true,
    wideCodeBlocks: false,
    compactProcessCards: false,
  },
  customCss: {
    enabled: true,
    code: "",
  },
};

export const BUILTIN_APPEARANCE_PRESETS: AppearancePreset[] = [
  {
    id: "zcode-native",
    name: "ZCode 原生默认",
    description: "还原官方原始配色与布局，只保留字体和拉宽等独立调节。",
    recommendedMode: "dark",
    patch: {
      enableCustomColors: false,
      lightColors: { ...DEFAULT_LIGHT_COLORS },
      darkColors: { ...DEFAULT_DARK_COLORS },
    },
  },
  {
    id: "glacier-mica",
    name: "冰川云母 · 清透浅色",
    description: "微冷灰蓝底色配合纯白对话卡片，层次分明，久看白底不刺眼。",
    recommendedMode: "light",
    patch: {
      enableCustomColors: true,
      lightColors: {
        background: "#f4f6fa",
        sidebar: "#eaeef5",
        card: "#ffffff",
        input: "#ffffff",
        userBubble: "#e4ecf7",
        brand: "#1a67d2",
        foreground: "#18202c",
        foregroundSubtle: "#5a6678",
        border: "#dce2ec",
      },
    },
  },
  {
    id: "forest-eye-care",
    name: "护眼森系 · 柔绿纸感",
    description: "极淡鼠尾草绿底色搭配低对比边框，长时间阅读与写文档更护眼。",
    recommendedMode: "light",
    patch: {
      enableCustomColors: true,
      lightColors: {
        background: "#f1f6f2",
        sidebar: "#e5eee7",
        card: "#f9fcfa",
        input: "#ffffff",
        userBubble: "#dfece2",
        brand: "#2b7a53",
        foreground: "#1c2b22",
        foregroundSubtle: "#566b5e",
        border: "#d0e0d5",
      },
    },
  },
  {
    id: "warm-obsidian",
    name: "温润深夜 · 柔和暗色",
    description: "去掉死黑与生硬纯白字，改用暖炭灰底色和柔亮字体，夜间更舒服。",
    recommendedMode: "dark",
    patch: {
      enableCustomColors: true,
      darkColors: {
        background: "#18191e",
        sidebar: "#131418",
        card: "#21232a",
        input: "#24262e",
        userBubble: "#2b2f3a",
        brand: "#60a5fa",
        foreground: "#e4e6eb",
        foregroundSubtle: "#9aa1b0",
        border: "#2e323d",
      },
    },
  },
];

export const CUSTOM_CSS_SNIPPETS: Array<{
  id: string;
  label: string;
  code: string;
}> = [
  {
    id: "soft-bubbles",
    label: "圆润用户气泡 + 微阴影",
    code: `[data-v4-user-input-bubble="true"] {\n  border-radius: 16px;\n  box-shadow: 0 2px 10px rgb(0 0 0 / 5%);\n}`,
  },
  {
    id: "relax-spacing",
    label: "加大 AI 回复段落间距",
    code: `[data-conversation-selectable="true"] p {\n  margin-block: 0.7em;\n}`,
  },
  {
    id: "code-card-radius",
    label: "代码块更圆润边界",
    code: `[data-streamdown="code-block"] {\n  border-radius: 12px;\n  overflow: hidden;\n}`,
  },
];
