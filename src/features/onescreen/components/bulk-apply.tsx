"use client";

/**
 * 값 일괄 입력 팝오버(1-2) — 선택(없으면 표시 전체) 행에 태도·과제·교재·오늘 과제를 한 번에 채운다.
 * 빈 필드는 적용하지 않음(값 지우기 아님 — 지우기는 개별 셀에서). 기본=덮어쓰기, "빈 칸만" 체크 시 비어있는 칸만.
 * edutrix 스프레드시트의 "범위 선택→값 붙여넣기"를 eywa 방식(체크 행+한 번 적용)으로 대체.
 */
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/ui/button";
import type { BulkPatch } from "../grid";
import { PillGroup } from "./pill-group";

export function BulkApplyPopover({
  targetCount,
  selectedCount,
  attitudes,
  homeworks,
  onApply,
  disabled,
}: {
  targetCount: number; // 적용 대상 행 수(선택 없으면 표시 전체)
  selectedCount: number; // 체크된 행 수(라벨용)
  attitudes: readonly string[];
  homeworks: readonly string[];
  onApply: (patch: BulkPatch, onlyEmpty: boolean) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [attitude, setAttitude] = useState<string | null>(null);
  const [homework, setHomework] = useState<string | null>(null);
  const [textbook, setTextbook] = useState("");
  const [homeworkToday, setHomeworkToday] = useState("");
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const hasAny = !!(attitude || homework || textbook.trim() || homeworkToday.trim());

  const reset = () => {
    // 닫을 때 초기화 — 이전 입력 잔존이 다음 일괄 적용 실수로 이어지지 않게.
    setAttitude(null);
    setHomework(null);
    setTextbook("");
    setHomeworkToday("");
  };
  const apply = () => {
    // ⚠️ 선택 행이 없으면 **표시 전체**가 대상이라, 이미 개별 입력한 태도/과제를 통째 덮어쓸 수 있다(#4 확정).
    //    "빈 칸만"이 꺼져 있으면(덮어쓰기 모드) 전체 대상일 때 한 번 확인한다(실수 방지, 되돌리기 없음).
    if (selectedCount === 0 && !onlyEmpty) {
      if (
        !window.confirm(
          `선택한 행이 없어 표시된 ${targetCount}행 전체에 적용됩니다. 이미 입력한 값도 덮어씁니다. 계속할까요?\n(빈 칸만 채우려면 '빈 칸만 채우기'를 켜세요)`,
        )
      )
        return;
    }
    onApply(
      { attitude: attitude ?? undefined, homework: homework ?? undefined, textbook, homeworkToday },
      onlyEmpty,
    );
    setOpen(false);
    reset();
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <Popover.Trigger
        disabled={disabled}
        className="text-text-dim hover:bg-bg-soft hover:text-foreground data-[popup-open]:bg-bg-soft inline-flex h-8 items-center rounded-md px-2.5 text-[12.5px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50"
        title="선택(없으면 표시 전체) 행에 같은 값을 한 번에 채우기"
      >
        값 일괄 입력
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
          <Popover.Popup className="bg-card border-line shadow-card flex w-[300px] flex-col gap-2.5 rounded-md border p-3 text-[12px] outline-none">
            <p className="text-text-dim text-[11px]">
              대상 <span className="text-foreground font-bold">{targetCount}</span>행
              {selectedCount ? " (선택 행)" : " (표시 전체)"} · 채운 필드만 적용됩니다
            </p>
            <div>
              <p className="micro text-text-faint mb-1">태도</p>
              <PillGroup
                size="sm"
                options={attitudes}
                value={attitude}
                onSelect={(a) => setAttitude((cur) => (cur === a ? null : a))}
                ariaLabel="일괄 태도"
              />
            </div>
            <div>
              <p className="micro text-text-faint mb-1">과제</p>
              <PillGroup
                size="sm"
                options={homeworks}
                value={homework}
                onSelect={(h) => setHomework((cur) => (cur === h ? null : h))}
                ariaLabel="일괄 과제"
              />
            </div>
            <input
              type="text"
              value={textbook}
              onChange={(e) => setTextbook(e.target.value)}
              placeholder="교재명 (비우면 적용 안 함)"
              aria-label="일괄 교재명"
              className="border-line bg-card focus:border-primary h-8 w-full rounded-sm border px-2 text-[12px] outline-none"
            />
            <input
              type="text"
              value={homeworkToday}
              onChange={(e) => setHomeworkToday(e.target.value)}
              placeholder="오늘 과제 (비우면 적용 안 함)"
              aria-label="일괄 오늘 과제"
              className="border-line bg-card focus:border-primary h-8 w-full rounded-sm border px-2 text-[12px] outline-none"
            />
            <div className="flex items-center justify-between">
              <label className="text-text-dim flex cursor-pointer items-center gap-1 text-[11px]">
                <input
                  type="checkbox"
                  checked={onlyEmpty}
                  onChange={() => setOnlyEmpty((v) => !v)}
                  className="accent-primary size-3.5"
                />
                빈 칸만 채우기
              </label>
              <Button size="sm" onClick={apply} disabled={!hasAny}>
                적용
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
