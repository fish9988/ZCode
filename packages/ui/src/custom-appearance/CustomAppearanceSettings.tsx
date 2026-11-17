import type { Theme } from "@/useTheme.js";
import type { CustomBaseMode } from "./types.js";
import { FontCustomizeCard } from "./FontCustomizeCard.js";
import { LayoutAndCssCard } from "./LayoutAndCssCard.js";
import { ThemeCustomizeCard } from "./ThemeCustomizeCard.js";

export function CustomAppearanceSettings({
  resolvedMode,
  setTheme,
}: {
  resolvedMode: CustomBaseMode;
  setTheme: (theme: Theme) => void;
}) {
  return (
    <div className="space-y-6">
      <ThemeCustomizeCard resolvedMode={resolvedMode} setTheme={setTheme} />
      <FontCustomizeCard />
      <LayoutAndCssCard />
    </div>
  );
}
