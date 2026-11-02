"use client";

import { useRef, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";

/**
 * 수강기간 칸의 특강 라벨 — 평소엔 라벨만, 마우스를 올리거나 누르면 특강 목록이 겹판으로 뜬다
 * (원장 2026-11-02 *"누르거나 마우스 갖다대면 오버레이식으로"*). 겹판은 포털이라 보고서 표에 잘리지 않는다.
 */
export function SpecialCourses({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // 마우스가 라벨 위에 있으면 떠 있는 겹판을 누름으로 닫지 않는다 — 호버로 뜬 뒤 눌러도 그대로("누르거나"). 터치는 눌러서 여닫는다.
  const hovering = useRef(false);
  return <Popover.Root open={open} onOpenChange={(next, details) => {
    if (!next && details.reason === "trigger-press" && hovering.current) return;
    setOpen(next);
  }}>
    <Popover.Trigger openOnHover delay={100} closeDelay={100}
      onPointerEnter={e => { hovering.current = e.pointerType !== "touch"; }} onPointerLeave={() => { hovering.current = false; }}
      className="border-primary/30 bg-primary/10 text-primary cursor-pointer rounded border px-1.5 py-0.5 text-xs font-medium">
      {label}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} className="z-50">
        <Popover.Popup aria-label="수강한 특강" className="border-border bg-card max-w-(--available-width) space-y-1 rounded-md border p-2 text-left font-normal shadow-lg outline-none">
          {children}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
