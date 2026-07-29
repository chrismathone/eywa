"use client";

// 교시 카드 로스터의 일괄 입력 — 원스크린 '일괄 입력' 팝오버의 계약을 그대로 따른다.
//  · 대상 = **이 카드에 보이는 로스터**(표시 집합 = 일괄 집합).
//  · 라벨에 **실제 동작 대상 수**를 밝힌다("전원"이라 써놓고 5명 중 2명만 되는 거짓말 금지).
//  · 출석 일괄은 언제나 빈 칸만(비파괴) → 확인 불필요. 상태 일괄은 덮어쓰기가 기본이라
//    덮일 값이 있으면 확인을 받고, 몇 건이 덮이는지 숫자로 밝힌다(침묵 금지).
//  · 개별 사실(개인 진도·과제)은 일괄 대상이 아니다 — 학생마다 다른 기록이라 복제하면 거짓이 된다.
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/ui/button";
import {
  planBulkAttendance,
  planBulkStatus,
  countStatusOverwrites,
  STATUS_CHIPS,
  type BulkRosterRow,
} from "../lib/bulk";

export function RosterBulk({
  date,
  slotStart,
  roster,
  marks,
  attendance,
  canEdit,
  canMarkDate,
  onBulkAttendance,
  onBulkStatus,
}: {
  date: string;
  slotStart: string;
  roster: BulkRosterRow[];
  marks: Record<string, { status: string | null; progressNote: string | null }>;
  attendance: Record<string, string>;
  canEdit: boolean;
  canMarkDate: boolean;
  onBulkAttendance: (studentIds: string[]) => void;
  onBulkStatus: (studentIds: string[], status: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [free, setFree] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [onlyEmpty, setOnlyEmpty] = useState(false);

  // 권한 없으면 컨트롤을 아예 렌더하지 않는다(누를 수 있는 것처럼 보였다가 서버가 거절하는 게 최악).
  if (!canEdit) return null;

  const attendanceTargets = planBulkAttendance(roster, attendance, date, { canEdit, canMarkDate });
  const statusTargets = planBulkStatus(roster, marks, date, slotStart, { canEdit, onlyEmpty });
  const overwrites = countStatusOverwrites(roster, marks, date, slotStart, canEdit);
  const value = free.trim() !== "" ? free.trim() : picked;

  const applyStatus = () => {
    // 값이 없으면 적용 자체가 안 된다(버튼 disabled) — "아무것도 안 골랐는데 전원 상태 삭제"가
    // 기본 액션이 되면 안 된다. 일괄 지우기는 의도적으로 미제공(지우기는 개별 셀에서).
    if (statusTargets.length === 0 || value === null) return;
    // 덮어쓰기 + 실제로 덮일 값이 있을 때만 확인(마찰 최소화 — 빈 칸만 채우기는 확인 없음).
    if (!onlyEmpty && overwrites > 0) {
      const ok = window.confirm(
        `이미 입력된 상태 ${overwrites}건을 "${value}"(으)로 덮어씁니다. 계속할까요?\n(기존 값을 남기려면 '빈 칸만 채우기'를 켜세요)`,
      );
      if (!ok) return;
    }
    onBulkStatus(statusTargets, value);
    setOpen(false);
    setFree("");
    setPicked(null);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setFree("");
          setPicked(null);
        }
      }}
    >
      <Popover.Trigger
        className="text-text-faint hover:text-primary cursor-pointer text-[11px]"
        title="이 교시 학생 전체에 출석·상태를 한 번에 입력"
      >
        일괄 입력
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
          <Popover.Popup className="bg-card border-line shadow-card flex w-[240px] flex-col gap-2 rounded-lg border p-3 text-[12px] outline-none">
            <p className="text-text-dim text-[11px]">
              이 교시 <b className="text-foreground num">{roster.length}</b>명
            </p>

            <div className="border-line border-t pt-2">
              <p className="text-text-faint mb-1 text-[10px] font-bold">출석</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full"
                disabled={attendanceTargets.length === 0}
                onClick={() => {
                  onBulkAttendance(attendanceTargets);
                  setOpen(false);
                }}
              >
                미체크 {attendanceTargets.length}명 출석
              </Button>
              <p className="text-text-faint mt-1 text-[10px]">
                {canMarkDate
                  ? "이미 기록된 학생은 그대로 둡니다(출석부 기록 보존)."
                  : // canMarkAttendanceByDate = 권한 AND 기간 — 원인을 단정하면 오표시(개별 툴팁과 동일 문구)
                    "출석 입력 권한이 없거나 수정 기간이 지났습니다."}
              </p>
            </div>

            <div className="border-line border-t pt-2">
              <p className="text-text-faint mb-1 text-[10px] font-bold">상태</p>
              <div className="flex flex-wrap gap-1">
                {STATUS_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className={`cursor-pointer rounded-full border px-2 py-0.5 text-[11px] ${
                      picked === chip
                        ? "border-foreground bg-foreground text-background"
                        : "border-line text-text-dim"
                    }`}
                    onClick={() => setPicked((v) => (v === chip ? null : chip))}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <input
                className="border-line mt-1.5 w-full rounded-lg border bg-transparent px-1.5 py-1 text-[11px] outline-none"
                placeholder="직접 입력"
                value={free}
                aria-label="상태 직접 입력"
                onChange={(e) => {
                  setFree(e.target.value);
                  // 자유입력이 우선 적용되므로 칩 하이라이트가 남으면 "칩이 적용된다"는 거짓 표시가 된다
                  if (e.target.value.trim() !== "") setPicked(null);
                }}
              />
              <label className="text-text-dim mt-1.5 flex cursor-pointer items-center gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  className="cursor-pointer"
                  checked={onlyEmpty}
                  onChange={(e) => setOnlyEmpty(e.target.checked)}
                />
                빈 칸만 채우기
              </label>
              <Button
                type="button"
                size="sm"
                className="mt-1.5 w-full"
                disabled={statusTargets.length === 0 || value === null}
                onClick={applyStatus}
              >
                {value === null ? "상태를 선택하세요" : `"${value}" 적용 ${statusTargets.length}명`}
              </Button>
            </div>

            <p className="text-text-faint text-[10px]">
              개인 진도 · 과제는 학생마다 다른 기록이라 일괄 대상이 아닙니다.
            </p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
