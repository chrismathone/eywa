"use client";

/**
 * '맨 위 행 복사' 팝오버 — 첫 행의 **수업 내용**(진도·교재·오늘 과제)을 아래 행 전부에 붙인다.
 * 같은 수업을 들은 반은 진도가 대체로 같은데 학생마다 피커를 다시 열던 것을 없앤다(원장 2026-07-23).
 *
 * ⚠️ 무엇이 복사되는지 화면에 **명시**한다 — 점수·태도·학부모 문구까지 복사된다고 오해하면
 *    "왜 태도가 안 옮겨졌지"가 아니라 "왜 남의 평가가 붙었지"보다 더 나쁜 침묵의 오기록이 된다.
 */
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/ui/button";

export function CopyFirstRowPopover({
  firstLabel,
  targetCount,
  selectedCount,
  onCopy,
  disabled,
}: {
  firstLabel: string | null; // 맨 위 행 학생 이름(대상이 없으면 null)
  targetCount: number; // 아래 행 수(첫 행 제외)
  selectedCount: number;
  onCopy: (overwrite: boolean) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [overwrite, setOverwrite] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        disabled={disabled}
        className="text-text-dim hover:bg-bg-soft hover:text-foreground data-[popup-open]:bg-bg-soft inline-flex h-8 items-center rounded-lg px-2.5 text-[12.5px] font-bold transition-colors disabled:pointer-events-none disabled:opacity-50"
        title="맨 위 행의 진도·교재·오늘 과제를 아래 행에 그대로 복사"
      >
        맨 위 행 복사
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
          <Popover.Popup className="bg-card border-line shadow-card flex w-[300px] flex-col gap-2.5 rounded-lg border p-3 text-[12px] outline-none">
            <p className="text-text-dim text-[11px]">
              {firstLabel ? (
                <>
                  <span className="text-foreground font-bold">{firstLabel}</span> 행을 아래{" "}
                  <span className="text-foreground font-bold">{targetCount}</span>행에
                  {selectedCount ? " (선택 행)" : " (표시 전체)"} 복사합니다
                </>
              ) : (
                "복사할 행이 없습니다"
              )}
            </p>
            <div className="border-line bg-bg-soft rounded-md border px-2.5 py-2">
              <p className="text-foreground text-[11px] font-bold">복사되는 것</p>
              <p className="text-text-dim text-[11px]">진도 · 교재명 · 오늘 과제</p>
              <p className="text-text-faint mt-1 text-[11px]">
                점수 · 태도 · 과제 수행 · 학부모 문구는 <b>복사되지 않습니다</b>(학생마다 다른 기록)
              </p>
            </div>
            <p className="text-text-faint text-[11px]">
              발송 완료된 행과 다른 과목 행은 자동으로 제외됩니다
            </p>
            <div className="flex items-center justify-between">
              <label className="text-text-dim flex cursor-pointer items-center gap-1 text-[11px]">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={() => setOverwrite((v) => !v)}
                  className="accent-primary size-3.5"
                />
                이미 입력된 칸도 덮어쓰기
              </label>
              <Button
                size="sm"
                disabled={!firstLabel || targetCount === 0}
                onClick={() => {
                  onCopy(overwrite);
                  setOpen(false);
                }}
              >
                복사
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
