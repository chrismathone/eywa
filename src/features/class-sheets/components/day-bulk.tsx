"use client";

// 하루치 일괄 입력 — 요일 머리(주간 시트)·반 머리(오늘 면)에 붙는 버튼 셋.
//
// 🔴 **교시 카드에서 요일 머리로 올라왔다**(원장 2026-08-14: *"가장 위의 수업에만 있으면 됨.
//    아래까지 필요없음"* → *"생각해보니까 요일 옆에 넣어도 될듯. 어차피 일괄이니까"*).
//    교시마다 같은 버튼 셋이 반복돼 시끄러웠고, 사람이 하려던 일은 애초에 "그 날 전부"였다.
//    덤으로 처음 요청("맨 위에서 누르면 나머지 교시도")이 확인창 없이 그냥 해결된다 — 범위가 곧 하루다.
//
// 🔴 **버튼 셋으로 갈랐다**(같은 날 지시). 종전엔 한 창에 계획·출결·태도가 다 들어 있어서, 제일 잦은
//    "전원 출석"조차 **창 열기 → 드롭다운 고르기 → 버튼 누르기** 세 동작이 들었다.
//     · `일괄 출석` = 창 없이 **한 번에**(값이 '출석' 하나뿐이라 고를 게 없다).
//     · `일괄 태도` = 5단 눈금에서 골라야 해 작은 창이 남는다.
//     · `계획`      = 평시/내신 × 교재·시간·진도·과제라 역시 창.
//    ⚠️ 지각·결석 **일괄은 없앴다** — 값 선택 단계를 되살리면 위 세 동작으로 돌아간다. 한 반 전체가
//       같은 지각·결석일 일이 없어(개별 셀 순환이 정석) 일괄의 실익이 없던 자리다.
//
// 계약은 종전 그대로다(교시 단위 → 하루 단위로 범위만 넓혔다):
//  · 대상 = **화면에 보이는 것**(로스터 = 표시 집합, 계획 = 이미 있는 줄).
//  · 🔴 **라벨은 '범위'(학생수×교시수)이고 '칸 수'가 아니다** — 원장 2026-08-18: *"학생수는 6인데
//    일괄출석은 12"* → *"수업 개수가 곱해져서 12구나. … 일괄 출석 학생수x수업수 로 표기, 합산하지 말고"*.
//    (2026-08-14의 "라벨 숫자 = 칸 수"를 뒤집은 결정이다. 실제로 기록되는 칸 수는 **누른 뒤 토스트**가
//    말한다 — 일괄 출석은 빈 칸만 채우므로 둘은 다를 수 있고, 그 차이를 툴팁이 미리 밝힌다.)
//  · 출결 일괄은 언제나 빈 칸만(비파괴) → 확인 불필요. 태도·계획은 덮어쓰기가 기본이라 덮일 값이 있으면
//    몇 건인지 숫자로 밝히고 확인을 받는다(침묵 금지).
//  · 개별 사실(학생별 진도·과제·특이사항)은 일괄 대상이 아니다 — 복제하면 거짓이 된다.
//  · 저장은 **교시별로** 나간다(0196a) — 뭉쳐 보내면 다른 교시 기록을 덮는다.
import { useState } from "react";
import { toast } from "sonner";
import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/ui/button";
import {
  bulkScopeLabel,
  countDayBulkStudents,
  countDayOpenSlots,
  countDayPlanCellOverwrites,
  countDayStatusOverwrites,
  countDayTargets,
  countDayTermLines,
  planDayBulkAttendance,
  planDayBulkPlanCells,
  planDayBulkStatus,
  PLAN_BULK_FIELDS,
  type DayBulkSlot,
  type DayBulkTarget,
  type PlanBulkField,
} from "../lib/bulk";
// 태도 선택지는 수학 수업보고서와 **같은 단일 소스**(원장 2026-08-06 "수학 수업보고서처럼").
import { ATTITUDE } from "@/features/onescreen/attitude";
import { FieldSelect } from "@/features/onescreen/components/field-select";
// 강사뷰 화면 언어(2026-09-03) — 버튼·툴팁만. 태도 **값**(ATTITUDE)은 DB에 저장되는 값이라 번역 금지.
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import type { BasicAttendance } from "../lib/mark-cycle";

const TERM_LABEL: Record<"regular" | "exam", string> = { regular: "평시", exam: "내신" };

const miniBtn = (on: boolean) =>
  `cursor-pointer rounded-full border px-2 py-0.5 text-xs transition ${
    on
      ? "border-primary bg-primary text-primary-foreground font-bold"
      : "border-line-strong text-text-dim hover:text-foreground hover:bg-bg-soft"
  }`;

/** 머리의 알약 버튼 셋 — 셋이 같은 모양이라야 한 줄로 읽힌다. */
const PILL =
  "border-line-strong text-foreground hover:text-primary hover:border-primary shrink-0 cursor-pointer rounded-full border px-2 py-0.5 text-xs font-bold disabled:cursor-default disabled:opacity-40 disabled:hover:text-foreground disabled:hover:border-line-strong";
const POPUP =
  "bg-card border-line-strong shadow-card flex max-h-[70vh] w-[268px] flex-col gap-2 overflow-y-auto rounded-lg border p-3 text-xs outline-none";

export function DayBulk({
  date,
  slots,
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
  /** 이 날의 교시 전부(계획 줄 포함). `scheduled=false`인 칸은 대상에서 빠진다. */
  slots: DayBulkSlot[];
  marks: Record<string, { status: string | null; progressNote: string | null }>;
  attendance: Record<
    string,
    { status: string; note: string | null; units: number | null; slot: string | null }
  >;
  canEdit: boolean;
  canMarkDate: boolean;
  /** '내신' 시기를 제안할지 — EiE(초등) 반은 내신이 없다(plan-table과 **같은 값**). */
  showExamTerm: boolean;
  /** 교시별로 나눠 저장한다(0196a) — 평평한 목록으로 뭉치지 말 것. */
  onBulkAttendance: (targets: DayBulkTarget[], status: BasicAttendance) => void;
  onBulkStatus: (targets: DayBulkTarget[], status: string | null) => void;
  onBulkPlanCells: (lineIds: string[], field: PlanBulkField, value: string) => void;
}) {
  // 화면 언어 — 관리자 풀셸에서 ECS를 열면 provider가 없어 한국어로 떨어진다(원장: 관리자뷰 불변).
  const t = useSheetT();
  const tf = useSheetTf();
  const [attitudeOpen, setAttitudeOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [term, setTerm] = useState<"regular" | "exam">("regular");
  const [planField, setPlanField] = useState<PlanBulkField>("textbook");
  const [planValue, setPlanValue] = useState("");
  const [planOnlyEmpty, setPlanOnlyEmpty] = useState(false);

  // 권한 없으면 컨트롤을 아예 렌더하지 않는다(누를 수 있는 것처럼 보였다가 서버가 거절하는 게 최악).
  if (!canEdit) return null;

  // 라벨의 **범위** — 학생수(교시 간 중복 없이) × 예정 교시수. 곱한 값은 적지 않는다(원장 2026-08-18).
  const studentCount = countDayBulkStudents(slots, { canEdit });
  const slotCount = countDayOpenSlots(slots);
  const scope = bulkScopeLabel(studentCount, slotCount);
  const scopeWords = `학생 ${studentCount}명 × 교시 ${slotCount}개`;
  const attendanceTargets = planDayBulkAttendance(slots, attendance, date, { canEdit, canMarkDate });
  const attendanceCount = countDayTargets(attendanceTargets);
  const statusTargets = planDayBulkStatus(slots, marks, date, { canEdit, onlyEmpty });
  const statusCount = countDayTargets(statusTargets);
  const overwrites = countDayStatusOverwrites(slots, marks, date, canEdit);
  const value = picked;

  // 내신을 안 그리는 반에서 term이 'exam'으로 굳으면 대상 0건인 채로 잠긴다 → 항상 평시로 되돌린다.
  const effectiveTerm = showExamTerm ? term : "regular";
  const termLineCount = countDayTermLines(slots, effectiveTerm, canEdit);
  const planTargets = planDayBulkPlanCells(slots, effectiveTerm, planField, {
    canEdit,
    onlyEmpty: planOnlyEmpty,
  });
  const planOverwrites = countDayPlanCellOverwrites(slots, effectiveTerm, planField, canEdit);
  const planFieldLabel = PLAN_BULK_FIELDS.find((f) => f.key === planField)?.label ?? "";

  /**
   * 일괄 출석 — **창도 확인도 없다**. 대상이 언제나 "아직 기록이 없는 칸"뿐이라(planBulkAttendance)
   * 되돌릴 게 없는 비파괴 동작이고, 그래서 한 번에 끝낸다. 이미 찍힌 출결·사유·시수는 손대지 않는다.
   */
  const applyPresent = () => {
    if (attendanceCount === 0) return;
    onBulkAttendance(attendanceTargets, "present");
    // 라벨은 범위(6×3), 토스트는 **실제로 기록된 칸 수** — 둘이 다른 게 정상이라 숫자를 여기서 밝힌다
    // (빈 칸만 채우므로 이미 찍힌 칸은 세지 않는다).
    toast.success(`출석 ${attendanceCount}칸 기록 — 이미 기록된 칸은 그대로 두었습니다`);
  };

  const applyStatus = () => {
    // 값이 없으면 적용 자체가 안 된다(버튼 disabled) — "아무것도 안 골랐는데 전원 태도 삭제"가
    // 기본 액션이 되면 안 된다. 일괄 지우기는 의도적으로 미제공(지우기는 개별 셀에서).
    if (statusCount === 0 || value === null) return;
    // 덮어쓰기 + 실제로 덮일 값이 있을 때만 확인(마찰 최소화 — 빈 칸만 채우기는 확인 없음).
    if (!onlyEmpty && overwrites > 0) {
      const ok = window.confirm(
        `이미 입력된 태도 ${overwrites}건을 "${value}"(으)로 덮어씁니다. 계속할까요?\n(기존 값을 남기려면 '빈 칸만 채우기'를 켜세요)`,
      );
      if (!ok) return;
    }
    onBulkStatus(statusTargets, value);
    setAttitudeOpen(false);
    setPicked(null);
  };

  const applyPlan = () => {
    const v = planValue.trim();
    // 빈 값으로 적용 = 전 줄 지우기 — 태도 일괄과 같은 이유로 막는다(지우기는 개별 셀에서).
    if (planTargets.length === 0 || v === "") return;
    if (!planOnlyEmpty && planOverwrites > 0) {
      const ok = window.confirm(
        `${TERM_LABEL[effectiveTerm]} ${planFieldLabel} ${planOverwrites}칸을 "${v}"(으)로 덮어씁니다. 계속할까요?\n(기존 값을 남기려면 '빈 칸만 채우기'를 켜세요)`,
      );
      if (!ok) return;
    }
    onBulkPlanCells(planTargets, planField, v);
    setPlanOpen(false);
    setPlanValue("");
  };

  return (
    // 좁은 머리에서도 버튼이 잘리지 않게 줄바꿈을 허용한다.
    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      <button
        type="button"
        className={PILL}
        disabled={attendanceCount === 0}
        onClick={applyPresent}
        title={
          attendanceCount > 0
            ? `${scopeWords} 범위 — 이 중 기록 없는 ${attendanceCount}칸만 출석으로 기록합니다(이미 기록된 칸은 그대로 둡니다)`
            : canMarkDate
              ? t("bulk.allDone")
              : // canMarkAttendanceByDate = 권한 AND 기간 — 원인을 단정하면 오표시(개별 툴팁과 동일 문구)
                t("bulk.noPerm")
        }
      >
        {t("bulk.attendance")}{scope ? ` ${scope}` : ""}
      </button>

      {/* 태도 — 셀과 같은 5단 눈금에서 골라야 해서 창이 남는다. */}
      <Popover.Root
        open={attitudeOpen}
        onOpenChange={(o) => {
          setAttitudeOpen(o);
          if (!o) setPicked(null);
        }}
      >
        <Popover.Trigger
          className={PILL}
          title={`이 날 태도를 한 번에 — ${scopeWords} 범위(실제로 채우는 칸 수는 아래 버튼에)`}
        >
          {t("bulk.attitude")}{scope ? ` ${scope}` : ""}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
            <Popover.Popup className={POPUP}>
              {/* 범위는 출석 라벨과 **같은 셈법**으로 적는다(한 줄에 두 셈법이 섞이면 더 헷갈린다). */}
              <p className="text-text-dim text-xs">
                학생 <b className="text-foreground num">{studentCount}</b>명 × 교시{" "}
                <b className="text-foreground num">{slotCount}</b>개
              </p>
              {/* ⚠️ 자유입력은 **없앴다**(원장 2026-08-06 "태도 직접 입력은 없애버려. ecs").
                  ECS 태도는 5단 눈금으로 고정 — 자유입력이 있으면 눈금 밖 값이 계속 새로 생겨
                  집계도 학부모 문장도 갈린다. 셀(FieldSelect)도 원래 자유입력이 없어 두 곳이 같아졌다.
                  옛 저장값('완'·'안침' 등)은 셀에서 '이전 표기'로 계속 보인다(쓴 게 사라지지 않는다). */}
              <FieldSelect
                options={ATTITUDE}
                value={picked}
                ariaLabel={t("bulk.attitude")}
                placeholder={t("bulk.attitudePlaceholder")}
                onSelect={setPicked}
              />
              <label className="text-text-dim flex cursor-pointer items-center gap-1.5 text-xs">
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
                className="w-full"
                disabled={statusCount === 0 || value === null}
                onClick={applyStatus}
              >
                {/* 🔴 수가 든 문구는 **문장 전체**를 사전에서(어순이 반대라 조각으로 못 잇는다). */}
                {value === null ? t("bulk.attitudeChoose") : tf("bulk.attitudeApply", { value, n: statusCount })}
              </Button>
              {/* 각주 — 위 입력칸과 **붙어 보이지 않게** 구분한다. 안 그러면 바로 위 태도 설명으로 읽힌다. */}
              <p className="bg-bg-soft text-text-dim rounded-md px-2 py-1.5 text-xs">
                ※ ‘특이사항’은 <b className="text-foreground">여기서 입력하지 않습니다</b> — 학생마다
                다른 기록이라 일괄 대상이 아니며, 학생 행의 맨 오른쪽 칸에 직접 적습니다.
              </p>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      {/* 수업계획(평시/내신) — 반 전체의 사실이라 일괄이 정상 작업이다. */}
      <Popover.Root
        open={planOpen}
        onOpenChange={(o) => {
          setPlanOpen(o);
          if (!o) setPlanValue("");
        }}
      >
        <Popover.Trigger className={PILL} title={t("bulk.planTitle")}>
          {t("bulk.plan")}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
            <Popover.Popup className={POPUP}>
              {/* ⚠️ 여기만 곱셈으로 못 적는다 — 계획 줄 수는 **교시마다 다를 수 있어** `N×M`이 거짓이 될
                  수 있다. 대신 몇 개 교시를 합친 수인지 옆에 밝혀 숫자의 출처를 보이게 한다. */}
              <p className="text-text-dim text-xs">
                이 날 {TERM_LABEL[effectiveTerm]} 계획{" "}
                <b className="text-foreground num">{termLineCount}</b>줄
                <span className="text-text-faint"> (교시 {slotCount}개 합계)</span>
              </p>
              {showExamTerm ? (
                <div className="flex gap-1">
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
              <div className="flex flex-wrap gap-1">
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
                className="border-line-strong text-foreground focus:border-primary bg-card w-full rounded-lg border px-1.5 py-1 text-xs outline-none"
                placeholder={`${TERM_LABEL[effectiveTerm]} ${planFieldLabel} 값`}
                value={planValue}
                aria-label={`${TERM_LABEL[effectiveTerm]} ${planFieldLabel} 일괄 입력`}
                onChange={(e) => setPlanValue(e.target.value)}
              />
              <label className="text-text-dim flex cursor-pointer items-center gap-1.5 text-xs">
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
                className="w-full"
                disabled={planTargets.length === 0 || planValue.trim() === ""}
                onClick={applyPlan}
              >
                {termLineCount === 0
                  ? `${TERM_LABEL[effectiveTerm]} 줄이 없습니다`
                  : `${planFieldLabel} 채우기 ${planTargets.length}줄`}
              </Button>
              {termLineCount === 0 ? (
                // 대상이 없는 이유를 밝힌다 — 일괄이 줄을 몰래 만들지 않는다는 계약(bulk.ts 주석)의 이면.
                <p className="text-text-dim text-xs">
                  계획 표의 ‘+ 줄 추가’로 줄을 먼저 만드세요(일괄은 있는 줄만 채웁니다).
                </p>
              ) : null}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </span>
  );
}
