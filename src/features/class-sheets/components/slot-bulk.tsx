"use client";

// 교시 카드의 일괄 입력 — 원스크린 '일괄 입력' 팝오버의 계약을 그대로 따른다.
//  · 대상 = **이 카드에 보이는 것**(로스터 = 표시 집합, 계획 = 그 카드에 이미 있는 줄).
//  · 라벨에 **실제 동작 대상 수**를 밝힌다("전원"이라 써놓고 5명 중 2명만 되는 거짓말 금지).
//  · 출석 일괄은 언제나 빈 칸만(비파괴) → 확인 불필요. 상태·계획 일괄은 덮어쓰기가 기본이라
//    덮일 값이 있으면 확인을 받고, 몇 건이 덮이는지 숫자로 밝힌다(침묵 금지).
//  · 개별 사실(학생별 개인 진도·과제)은 일괄 대상이 아니다 — 학생마다 다른 기록이라 복제하면 거짓이 된다.
//    반대로 **수업계획(평시/내신)은 반 전체의 사실**이라 6영역에 같은 교재를 넣는 게 정상 작업이다.
//
// ⚠️ 자리는 교시 카드 **머리(우측)**다(원장 2026-08-06). 로스터 표 위에 있을 땐 계획 표를 지나 한참
//    내려가야 보였고, 계획 일괄까지 담게 된 지금은 계획 표보다 아래 있는 게 순서상 어긋난다.
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/ui/button";
import {
  countPlanCellOverwrites,
  countStatusOverwrites,
  planBulkAttendance,
  planBulkPlanCells,
  planBulkStatus,
  planLinesOfTerm,
  PLAN_BULK_FIELDS,
  STATUS_CHIPS,
  type BulkPlanRow,
  type BulkRosterRow,
  type PlanBulkField,
} from "../lib/bulk";
import { statusTone, STATUS_TONE_CLASS } from "../lib/status-tone";

const TERM_LABEL: Record<"regular" | "exam", string> = { regular: "평시", exam: "내신" };

const miniBtn = (on: boolean) =>
  `cursor-pointer rounded-full border px-2 py-0.5 text-[12px] transition ${
    on
      ? "border-foreground bg-foreground text-background font-bold"
      : "border-line-strong text-text-dim hover:text-foreground hover:bg-bg-soft"
  }`;

export function SlotBulk({
  date,
  slotStart,
  roster,
  lines,
  marks,
  attendance,
  canEdit,
  canMarkDate,
  showExamTerm,
  onBulkAttendance,
  onBulkStatus,
  onBulkPlanCells,
}: {
  date: string;
  slotStart: string;
  roster: BulkRosterRow[];
  /** 이 교시의 계획 줄 — 계획 일괄의 대상. 줄이 없으면 그 시기 버튼은 0건으로 잠긴다. */
  lines: BulkPlanRow[];
  marks: Record<string, { status: string | null; progressNote: string | null }>;
  attendance: Record<string, string>;
  canEdit: boolean;
  canMarkDate: boolean;
  /** '내신' 시기를 제안할지 — EiE(초등) 반은 내신이 없다(plan-table과 **같은 값**). */
  showExamTerm: boolean;
  onBulkAttendance: (studentIds: string[]) => void;
  onBulkStatus: (studentIds: string[], status: string | null) => void;
  onBulkPlanCells: (lineIds: string[], field: PlanBulkField, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [free, setFree] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [term, setTerm] = useState<"regular" | "exam">("regular");
  const [planField, setPlanField] = useState<PlanBulkField>("textbook");
  const [planValue, setPlanValue] = useState("");
  const [planOnlyEmpty, setPlanOnlyEmpty] = useState(false);

  // 권한 없으면 컨트롤을 아예 렌더하지 않는다(누를 수 있는 것처럼 보였다가 서버가 거절하는 게 최악).
  if (!canEdit) return null;

  const attendanceTargets = planBulkAttendance(roster, attendance, date, { canEdit, canMarkDate });
  const statusTargets = planBulkStatus(roster, marks, date, slotStart, { canEdit, onlyEmpty });
  const overwrites = countStatusOverwrites(roster, marks, date, slotStart, canEdit);
  const value = free.trim() !== "" ? free.trim() : picked;

  // 내신을 안 그리는 반에서 term이 'exam'으로 굳으면 대상 0건인 채로 잠긴다 → 항상 평시로 되돌린다.
  const effectiveTerm = showExamTerm ? term : "regular";
  const termLines = planLinesOfTerm(lines, effectiveTerm, canEdit);
  const planTargets = planBulkPlanCells(lines, effectiveTerm, planField, {
    canEdit,
    onlyEmpty: planOnlyEmpty,
  });
  const planOverwrites = countPlanCellOverwrites(lines, effectiveTerm, planField, canEdit);
  const planFieldLabel = PLAN_BULK_FIELDS.find((f) => f.key === planField)?.label ?? "";

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

  const applyPlan = () => {
    const v = planValue.trim();
    // 빈 값으로 적용 = 전 줄 지우기 — 상태 일괄과 같은 이유로 막는다(지우기는 개별 셀에서).
    if (planTargets.length === 0 || v === "") return;
    if (!planOnlyEmpty && planOverwrites > 0) {
      const ok = window.confirm(
        `${TERM_LABEL[effectiveTerm]} ${planFieldLabel} ${planOverwrites}칸을 "${v}"(으)로 덮어씁니다. 계속할까요?\n(기존 값을 남기려면 '빈 칸만 채우기'를 켜세요)`,
      );
      if (!ok) return;
    }
    onBulkPlanCells(planTargets, planField, v);
    setOpen(false);
    setPlanValue("");
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setFree("");
          setPicked(null);
          setPlanValue("");
        }
      }}
    >
      <Popover.Trigger
        className="border-line-strong text-text-dim hover:text-primary hover:border-primary shrink-0 cursor-pointer rounded-full border px-2 py-0.5 text-[12px] font-bold"
        title="이 교시의 출석·상태와 수업계획(평시/내신)을 한 번에 입력"
      >
        일괄 입력
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
          <Popover.Popup className="bg-card border-line-strong shadow-card flex max-h-[70vh] w-[268px] flex-col gap-2 overflow-y-auto rounded-lg border p-3 text-[12px] outline-none">
            <p className="text-text-dim text-[12px]">
              이 교시 <b className="text-foreground num">{roster.length}</b>명 · 계획{" "}
              <b className="text-foreground num">{lines.length}</b>줄
            </p>

            {/* ── 수업계획(평시/내신) ─ 계획 표가 카드에서 로스터보다 위라 여기서도 먼저 놓는다. */}
            <div className="border-line-strong border-t pt-2">
              <p className="text-text-dim mb-1 text-[11px] font-bold">수업계획</p>
              {showExamTerm ? (
                <div className="mb-1.5 flex gap-1">
                  {(["regular", "exam"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={miniBtn(effectiveTerm === t)}
                      onClick={() => setTerm(t)}
                    >
                      {TERM_LABEL[t]}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="mb-1.5 flex flex-wrap gap-1">
                {PLAN_BULK_FIELDS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className={miniBtn(planField === f.key)}
                    onClick={() => setPlanField(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <input
                className="border-line-strong text-foreground focus:border-primary w-full rounded-lg border bg-transparent px-1.5 py-1 text-[12px] outline-none"
                placeholder={`${TERM_LABEL[effectiveTerm]} ${planFieldLabel} 값`}
                value={planValue}
                aria-label={`${TERM_LABEL[effectiveTerm]} ${planFieldLabel} 일괄 입력`}
                onChange={(e) => setPlanValue(e.target.value)}
              />
              <label className="text-text-dim mt-1.5 flex cursor-pointer items-center gap-1.5 text-[12px]">
                <input
                  type="checkbox"
                  className="cursor-pointer"
                  checked={planOnlyEmpty}
                  onChange={(e) => setPlanOnlyEmpty(e.target.checked)}
                />
                빈 칸만 채우기
              </label>
              <Button
                type="button"
                size="sm"
                className="mt-1.5 w-full"
                disabled={planTargets.length === 0 || planValue.trim() === ""}
                onClick={applyPlan}
              >
                {termLines.length === 0
                  ? `${TERM_LABEL[effectiveTerm]} 줄이 없습니다`
                  : `${planFieldLabel} 채우기 ${planTargets.length}줄`}
              </Button>
              {termLines.length === 0 ? (
                // 대상이 없는 이유를 밝힌다 — 일괄이 줄을 몰래 만들지 않는다는 계약(bulk.ts 주석)의 이면.
                <p className="text-text-dim mt-1 text-[11px]">
                  계획 표의 ‘+ 줄 추가’로 줄을 먼저 만드세요(일괄은 있는 줄만 채웁니다).
                </p>
              ) : null}
            </div>

            <div className="border-line-strong border-t pt-2">
              <p className="text-text-dim mb-1 text-[11px] font-bold">출석</p>
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
              <p className="text-text-dim mt-1 text-[11px]">
                {canMarkDate
                  ? "이미 기록된 학생은 그대로 둡니다(출석부 기록 보존)."
                  : // canMarkAttendanceByDate = 권한 AND 기간 — 원인을 단정하면 오표시(개별 툴팁과 동일 문구)
                    "출석 입력 권한이 없거나 수정 기간이 지났습니다."}
              </p>
            </div>

            <div className="border-line-strong border-t pt-2">
              <p className="text-text-dim mb-1 text-[11px] font-bold">상태</p>
              <div className="flex flex-wrap gap-1">
                {STATUS_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className={`cursor-pointer rounded-full border px-2 py-0.5 text-[12px] ${
                      picked === chip
                        ? "border-foreground bg-foreground text-background font-bold"
                        : STATUS_TONE_CLASS[statusTone(chip)]
                    }`}
                    onClick={() => setPicked((v) => (v === chip ? null : chip))}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <input
                className="border-line-strong text-foreground focus:border-primary mt-1.5 w-full rounded-lg border bg-transparent px-1.5 py-1 text-[12px] outline-none"
                placeholder="직접 입력"
                value={free}
                aria-label="상태 직접 입력"
                onChange={(e) => {
                  setFree(e.target.value);
                  // 자유입력이 우선 적용되므로 칩 하이라이트가 남으면 "칩이 적용된다"는 거짓 표시가 된다
                  if (e.target.value.trim() !== "") setPicked(null);
                }}
              />
              <label className="text-text-dim mt-1.5 flex cursor-pointer items-center gap-1.5 text-[12px]">
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

            <p className="text-text-dim text-[11px]">
              학생별 ‘개인 진도 · 과제’는 학생마다 다른 기록이라 일괄 대상이 아닙니다.
            </p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
