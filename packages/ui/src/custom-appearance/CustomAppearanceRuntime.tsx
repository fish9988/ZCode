import { useEffect } from "react";
import { toast } from "@/components/ui/toast.js";
import { resolveTheme, type Theme } from "@/useTheme.js";
import { useCustomAppearanceStore } from "./store.js";
import { applyCustomAppearanceToDocument } from "./styleEngine.js";

export function CustomAppearanceRuntime({ theme }: { theme: Theme }) {
  const config = useCustomAppearanceStore((state) => state.config);
  const safeModeActive = useCustomAppearanceStore((state) => state.safeModeActive);
  const toggleSafeMode = useCustomAppearanceStore((state) => state.toggleSafeMode);
  const syncFromStorage = useCustomAppearanceStore((state) => state.syncFromStorage);

  const resolvedMode = resolveTheme(theme);

  useEffect(() => {
    applyCustomAppearanceToDocument(config, resolvedMode, safeModeActive);
  }, [config, resolvedMode, safeModeActive]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyCustomAppearanceToDocument(config, resolveTheme("system"), safeModeActive);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [config, safeModeActive, theme]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === "zcode-custom-appearance-v1") {
        syncFromStorage();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [syncFromStorage]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const hasPrimaryModifier = event.ctrlKey || event.metaKey;
      if (hasPrimaryModifier && event.shiftKey && event.altKey && event.code === "KeyR") {
        event.preventDefault();
        const nextSafe = !useCustomAppearanceStore.getState().safeModeActive;
        toggleSafeMode(nextSafe);
        toast(
          nextSafe
            ? "已开启外观安全模式：自定义 CSS 已临时停用（再按一次恢复）"
            : "已退出外观安全模式：自定义 CSS 已恢复生效",
          { variant: "info" },
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSafeMode]);

  return null;
}
