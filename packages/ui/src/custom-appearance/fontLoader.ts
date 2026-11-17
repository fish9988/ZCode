export type LocalFontLoadStatus = "idle" | "loading" | "ready" | "denied" | "unsupported";

export interface LocalFontEntry {
  family: string;
  isLikelyCjk: boolean;
  isLikelyMono: boolean;
}

interface LocalFontDataLike {
  family: string;
}

const CJK_FONT_NAME_HINTS = [
  "sarasa",
  "更纱",
  "noto sans sc",
  "noto serif sc",
  "source han",
  "思源",
  "lxgw",
  "霞鹜",
  "yahei",
  "雅黑",
  "pingfang",
  "苹方",
  "kaiti",
  "楷体",
  "songti",
  "宋体",
  "simsun",
  "simhei",
  "黑体",
  "fangsong",
  "仿宋",
  "wenquanyi",
  "harmonyos",
  "mi sans",
  "misans",
  "alibaba",
  "oppo sans",
  "youyuan",
  "幼圆",
  "heiti",
  "hiragino",
  "yu gothic",
  "meiryo",
];

const MONO_FONT_NAME_HINTS = [
  "mono",
  "code",
  "consolas",
  "courier",
  "cascadia",
  "jetbrains",
  "fira",
  "hack",
  "menlo",
  "monaco",
  "iosevka",
  "inconsolata",
  "victor",
  "sarasa term",
  "sarasa mono",
  "等宽",
];

export const FALLBACK_WESTERN_FONTS = [
  "Segoe UI",
  "Inter",
  "Roboto",
  "Georgia",
  "Calibri",
  "Arial",
  "Helvetica Neue",
  "Times New Roman",
];

export const FALLBACK_CJK_FONTS = [
  "Sarasa UI SC",
  "Sarasa Gothic SC",
  "Microsoft YaHei UI",
  "Microsoft YaHei",
  "LXGW WenKai",
  "Source Han Sans SC",
  "Source Han Serif SC",
  "PingFang SC",
  "Noto Sans CJK SC",
  "SimSun",
];

export const FALLBACK_MONO_FONTS = [
  "Sarasa Term SC",
  "Sarasa Mono SC",
  "Cascadia Code",
  "Cascadia Mono",
  "JetBrains Mono",
  "Fira Code",
  "Consolas",
  "Menlo",
  "Monaco",
];

function classifyFont(family: string): LocalFontEntry {
  const lower = family.toLowerCase();
  const hasCjkChar = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(family);
  const isLikelyCjk =
    hasCjkChar || CJK_FONT_NAME_HINTS.some((hint) => lower.includes(hint));
  const isLikelyMono = MONO_FONT_NAME_HINTS.some((hint) => lower.includes(hint));
  return { family, isLikelyCjk, isLikelyMono };
}

function buildFallbackEntries(): LocalFontEntry[] {
  const seen = new Set<string>();
  const all = [...FALLBACK_CJK_FONTS, ...FALLBACK_WESTERN_FONTS, ...FALLBACK_MONO_FONTS];
  const entries: LocalFontEntry[] = [];
  for (const family of all) {
    if (!seen.has(family)) {
      seen.add(family);
      entries.push(classifyFont(family));
    }
  }
  return entries;
}

export async function querySystemLocalFonts(): Promise<{
  status: LocalFontLoadStatus;
  fonts: LocalFontEntry[];
}> {
  const win = window as Window & {
    queryLocalFonts?: () => Promise<LocalFontDataLike[]>;
  };
  if (typeof win.queryLocalFonts !== "function") {
    return { status: "unsupported", fonts: buildFallbackEntries() };
  }

  try {
    const rawFonts = await win.queryLocalFonts();
    const families = new Set<string>();
    for (const item of rawFonts) {
      const name = item?.family?.trim();
      if (name) families.add(name);
    }

    if (families.size === 0) {
      return { status: "denied", fonts: buildFallbackEntries() };
    }

    const entries = Array.from(families)
      .map(classifyFont)
      .sort((a, b) => a.family.localeCompare(b.family, "zh-Hans-CN"));

    return { status: "ready", fonts: entries };
  } catch {
    return { status: "denied", fonts: buildFallbackEntries() };
  }
}

export function buildCssFontStack(
  westernFamily: string,
  cjkFamily: string,
  fallbackStack: string,
): string {
  const parts: string[] = [];
  const quote = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return "";
    if (/^[a-z-]+$/i.test(trimmed)) return trimmed;
    return `"${trimmed.replace(/"/g, '\\"')}"`;
  };

  const west = quote(westernFamily);
  const cjk = quote(cjkFamily);
  if (west) parts.push(west);
  if (cjk && cjk !== west) parts.push(cjk);
  parts.push(fallbackStack);
  return parts.join(", ");
}
