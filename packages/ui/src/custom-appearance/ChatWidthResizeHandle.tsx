import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/components/lib/utils.js";
import {
  CHAT_WIDTH_DEFAULT_PX,
  CHAT_WIDTH_MAX_PX,
  CHAT_WIDTH_MIN_PX,
  useCustomAppearanceStore,
} from "./store.js";

const HOVER_REVEAL_DELAY_MS = 150;

export function ChatWidthResizeHandle({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const enableResizeHandle = useCustomAppearanceStore(
    (state) => state.config.layout.enableResizeHandle,
  );
  const chatMaxWidthPx = useCustomAppearanceStore(
    (state) => state.config.layout.chatMaxWidthPx,
  );
  const setChatMaxWidthPx = useCustomAppearanceStore((state) => state.setChatMaxWidthPx);

  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [liveWidthPx, setLiveWidthPx] = useState<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const dragRef = useRef<{
    startX: number;
    startWidth: number;
    lastWidth: number;
  } | null>(null);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearHoverTimer(), [clearHoverTimer]);

  const measureCurrentWidth = useCallback(() => {
    const container = containerRef.current;
    if (container) {
      const contentColumn = container.querySelector<HTMLElement>(
        '[data-v4-timeline-content-column="true"]',
      );
      const measured = contentColumn?.getBoundingClientRect().width;
      if (measured && measured > 200) {
        return Math.round(measured);
      }
    }
    return chatMaxWidthPx ?? CHAT_WIDTH_DEFAULT_PX;
  }, [chatMaxWidthPx, containerRef]);

  const handlePointerEnter = useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      setHovered(true);
    }, HOVER_REVEAL_DELAY_MS);
  }, [clearHoverTimer]);

  const handlePointerLeave = useCallback(() => {
    clearHoverTimer();
    if (!dragRef.current) {
      setHovered(false);
    }
  }, [clearHoverTimer]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const startWidth = measureCurrentWidth();
      dragRef.current = {
        startX: event.clientX,
        startWidth,
        lastWidth: startWidth,
      };
      setDragging(true);
      setLiveWidthPx(startWidth);

      const previousUserSelect = document.body.style.userSelect;
      const previousCursor = document.body.style.cursor;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "ew-resize";

      const onPointerMove = (moveEvent: PointerEvent) => {
        const current = dragRef.current;
        if (!current) return;
        const deltaX = moveEvent.clientX - current.startX;
        const rawNext = current.startWidth - deltaX * 2;
        const clamped = Math.round(
          Math.min(CHAT_WIDTH_MAX_PX, Math.max(CHAT_WIDTH_MIN_PX, rawNext)),
        );
        current.lastWidth = clamped;
        setLiveWidthPx(clamped);
        document.documentElement.style.setProperty("--zcode-chat-max-width", `${clamped}px`);
        document.documentElement.setAttribute("data-zcode-custom-width", "true");
      };

      const finishDrag = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", finishDrag);
        window.removeEventListener("pointercancel", finishDrag);
        document.body.style.userSelect = previousUserSelect;
        document.body.style.cursor = previousCursor;

        const current = dragRef.current;
        dragRef.current = null;
        setDragging(false);
        setHovered(false);
        setLiveWidthPx(null);

        if (current) {
          setChatMaxWidthPx(current.lastWidth);
        }
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", finishDrag);
      window.addEventListener("pointercancel", finishDrag);
    },
    [measureCurrentWidth, setChatMaxWidthPx],
  );

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      document.documentElement.style.removeProperty("--zcode-chat-max-width");
      setChatMaxWidthPx(null);
      setLiveWidthPx(null);
    },
    [setChatMaxWidthPx],
  );

  if (!enableResizeHandle) return null;

  const isVisible = hovered || dragging;

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整聊天区域宽度（双击恢复默认）"
        title="拖动调整聊天栏宽度 · 双击还原默认"
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        className={cn(
          "pointer-events-auto group/resize-handle absolute top-1/4 -left-1.5 z-30 flex h-1/2 w-3 cursor-ew-resize items-center justify-center",
          "transition-opacity duration-150",
          isVisible ? "opacity-100" : "opacity-0",
        )}
      >
        <div
          className={cn(
            "h-full w-[2px] rounded-full transition-colors duration-150",
            dragging
              ? "bg-[var(--color-resize-handle)] shadow-[0_0_8px_var(--color-resize-handle)]"
              : "bg-[var(--color-border-hover)] group-hover/resize-handle:bg-[var(--color-resize-handle)]",
          )}
        />
        {isVisible ? (
          <div className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-0.5 text-ui-xs font-medium text-popover-foreground shadow-sm">
            {liveWidthPx ?? chatMaxWidthPx ?? "默认"}
            {liveWidthPx !== null || chatMaxWidthPx !== null ? " px" : ""}
            <span className="ml-1.5 text-foreground-subtle">双击还原</span>
          </div>
        ) : null}
      </div>
      {dragging ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/4 -right-2 z-30 h-1/2 w-[2px] rounded-full bg-[var(--color-resize-handle)] opacity-70"
        />
      ) : null}
    </>
  );
}
