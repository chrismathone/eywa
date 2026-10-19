"use client";

import { Popover } from "@base-ui/react/popover";
import { useState, type ReactNode, type RefObject } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF } from "@/components/toolbar-controls";

/**
 * 판 툴바의 펼침 단추(색·테두리·정렬·병합·행열) — 고르면 닫히고 **판으로 초점이 돌아간다**(바로 이어 칠 수 있게).
 * 메뉴(Menu)가 아니라 팝오버인 이유: 안에 색 고르기 입력칸·두 단계 선택(선 모양 → 어디에)이 들어간다.
 */
export function ToolPopover({
  label,
  title,
  focusRef,
  disabled = false,
  children,
}: {
  label: ReactNode;
  title: string;
  focusRef: RefObject<HTMLElement | null>;
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        disabled={disabled}
        title={title}
        className={`${TOOLBAR_CHIP} ${TOOLBAR_CHIP_OFF} gap-1 disabled:opacity-50`}
        onMouseDown={(e) => e.preventDefault()}
      >
        {label}
        <EyIcon name="chevronDown" size={14} className="opacity-60" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-[60]">
          <Popover.Popup
            finalFocus={focusRef}
            className="bg-card border-line shadow-card max-w-[calc(100vw-2rem)] rounded-xl border p-1.5 text-left outline-none"
          >
            {children(() => setOpen(false))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** 팝오버 안 한 줄 항목. */
export function ToolItem({ children, onPick, active = false }: { children: ReactNode; onPick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`hover:bg-bg-soft flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm whitespace-nowrap ${active ? "text-primary font-bold" : ""}`}
    >
      {children}
    </button>
  );
}

/** 팝오버 안 묶음 제목. */
export function ToolGroupLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-1.5 pb-0.5 text-xs font-bold opacity-70">{children}</div>;
}
