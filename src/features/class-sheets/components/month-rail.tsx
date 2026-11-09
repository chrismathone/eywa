"use client";

import { skillAreaColorOf } from "@/features/owner/skill-areas";
import { SUBJECT_SOFT } from "@/features/owner/subjects";
import { slotKey } from "../lib/month-assemble";
import { holidayNameOn, isHolidayOn } from "../lib/holiday";
import { isOffGoalLine, type MonthGoalMap } from "../lib/goal-match";
import { SHEET_BOX_FRAME, SHEET_INPUT } from "../ui-box";
import type { ClassSheetMonthData, MonthPlanLine } from "../server/month-queries";
import type { GoalField, GoalRole } from "./use-month-goals";
import { sheetDowLabelByIndex, type SheetLang } from "@/features/teacher-view/i18n";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { writeLockedPlaceholder } from "@/lib/write-lock";

// 요일 글자는 사전 한 벌(`sheetDowLabelByIndex`) — 화면마다 표를 새로 만들면 글자가 갈린다.
const dowOf = (date: string, lang: SheetLang) =>
  sheetDowLabelByIndex(new Date(`${date}T00:00:00Z`).getUTCDay(), lang);

/**
 * 월간 **진도표** 보기 — 영역 × 수업일. 달력이 "그날 뭐 하지"라면 이 표는 "이 영역이 한 달 동안
 * 어디서 어디까지 갔나"에 답한다(실측: Vocab 13-15 → 20-22가 한 줄로 읽힌다).
 *
 * 🔴 첫 열에 **월간 목표 입력칸**이 그대로 있다 — 목표와 실제가 같은 줄에서 만나야 대조가 성립하고,
 *    원장 지시(*"월간뷰에서도 고칠 수 있게 · 서로 배선이 유기적으로"*)대로 여기서 고쳐도 같은 칸에 저장된다.
 *    그래서 이 보기에서는 위쪽 목표 스트립을 띄우지 않는다(같은 사실을 한 화면에 두 번 적지 않는다).
 * ⚠️ 어긋난 교재는 앰버, 그 **날짜 열 머리**도 앰버로 선다 — 달력의 "해당 요일 경고"와 같은 사실을
 *    이 표의 축(열)으로 옮긴 것이다.
 * ⚠️ 맨 아랫줄(그날 계획/배정 교시)은 **배정된 전 교시** 기준이라 자리 교시 토글을 따라가지 않는다.
 */
export function MonthRail({
  data,
  goals,
  display,
  canEdit,
  savedAt,
  onField,
  onOpenDay,
}: {
  data: ClassSheetMonthData;
  /**
   * **담임** 월간 목표 — 편집 대상이자 경고 기준이다.
   * ⚠️ 부담임 목표는 이 표에서 안 고친다(달력 보기의 스트립에서) — 진도표는 반 진도 대조용이라
   *    축이 담임이고, 여기에 역할 전환을 또 두면 같은 열이 무엇을 뜻하는지 흔들린다.
   */
  goals: MonthGoalMap;
  display: { homework: boolean; seat: boolean };
  canEdit: boolean;
  /** 마지막 저장 시각 — 이 보기엔 목표 스트립이 없어서 저장 피드백이 첫 열 머리에 붙는다. */
  savedAt: number | null;
  onField: (role: GoalRole, skillArea: string, field: GoalField, value: string) => void;
  /**
   * 날짜 열 머리를 누르면 그 날 계획을 그 자리에서 연다(달력의 더블클릭과 **같은 창**).
   * ⚠️ 여기선 **한 번만 눌러도** 열린다 — 달력 칸과 달리 이 머리엔 다투는 동작(주간 시트로 이동)이
   *    없어서, 더블클릭만 받으면 아무도 못 찾는 기능이 된다.
   */
  onOpenDay: (date: string) => void;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const lang = useSheetLang();
  const lockedTitle = canEdit ? undefined : writeLockedPlaceholder("ecs");
  // 열 = 계획 줄이 하나라도 있는 날(수업은 있는데 아무것도 안 쓴 날까지 세우면 표가 빈 열로 길어진다).
  // ⚠️ **지금 보여 줄 줄**로 센다 — 자리 교시에만 계획이 있는 날은 자리를 접었을 때 셀이 전부 비므로,
  //    `data.lines` 전체로 세면 아무것도 없는 열이 하나 선다.
  const days = [...new Set(data.lines.filter((l) => display.seat || !l.seat).map((l) => l.planDate))].sort();
  if (days.length === 0) {
    return (
      <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">
        {t("month.rail.empty.a")} <b className="text-foreground">{t("face.cal")}</b>{" "}
        {t("month.rail.empty.b")}
      </p>
    );
  }

  const cellsOf = (date: string, area: string): { line: MonthPlanLine; seat: boolean }[] => {
    const slots = data.slotsByDate[date] ?? [];
    const out: { line: MonthPlanLine; seat: boolean }[] = [];
    for (const slot of slots) {
      const seat = slot.seat !== null;
      if (seat && !display.seat) continue;
      for (const line of data.linesBySlot[slotKey(date, slot.slotStart)] ?? []) {
        if (line.skillArea === area) out.push({ line, seat });
      }
    }
    return out;
  };

  const offDays = new Set(
    data.lines.filter((l) => isOffGoalLine({ ...l, seat: l.seat }, goals)).map((l) => l.planDate),
  );

  return (
    <div className="border-line overflow-x-auto rounded-xl border">
      <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="border-line-faint bg-bg-soft sticky left-0 z-[4] min-w-[236px] border-r border-b px-2 py-1.5 text-left text-xs font-bold shadow-[1px_0_0_var(--line)]">
              {t("month.rail.goalHead")}
              <span className={`ml-2 font-semibold ${savedAt ? "text-green" : "text-text-faint"}`}>
                {t(savedAt ? "toolbar.saved" : "month.goal.sameAsWeek")}
              </span>
            </th>
            {days.map((date) => {
              // 🔴 휴일은 **열을 지우지 않는다** — 그 날 쓴 진도가 여기 그대로 서야 한다(원장 2026-09-01).
              //    톤은 월별 출석부와 같은 회색(`--att-weekend`)이고, 목표 밖 경고가 있으면 그쪽이 이긴다
              //    (경고는 고칠 일이 있다는 뜻이라 회색으로 덮으면 안 된다).
              const holiday = holidayNameOn(data.holidays, date);
              return (
                <th
                  key={date}
                  className={`border-line-faint sticky top-0 z-[2] border-r border-b p-0 text-left text-xs font-bold whitespace-nowrap ${
                    offDays.has(date)
                      ? "text-amber bg-amber-soft shadow-[inset_0_-2px_0_var(--amber)]"
                      : holiday
                        ? "bg-att-weekend"
                        : "bg-bg-soft"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onOpenDay(date)}
                    title={
                      holiday
                        ? `${tf(canEdit ? "month.cell.holiday.edit" : "month.cell.holiday.view", {
                            holiday,
                          })}`
                        : t(canEdit ? "month.cell.edit" : "month.cell.view")
                    }
                    // 날짜 머리는 본문 진도 줄(왼쪽)과 같은 축 — 버튼은 UA 기본이 가운데라 여기서 왼쪽을 준다(원장 2026-09-18).
                    className="hover:text-primary w-full cursor-pointer px-2 py-1.5 text-left font-bold"
                  >
                    {/* 휴일 글자 = 출석부 휴일 잉크(`text-att-holiday-ink`) — 공용 `text-danger`는 휴일 회색
                        (`--att-weekend`) 위에서 대비 3.75로 WCAG 4.5를 깼다(2026-09-14). */}
                    <span className={`num ${holiday && !offDays.has(date) ? "text-att-holiday-ink" : ""}`}>
                      {date.slice(5).replace("-", "/")}
                    </span>
                    <br />
                    {/* 휴일이면 요일 자리에 **공휴일명**을 적는다 — 열이 좁아 두 줄을 더 쓸 수 없고,
                        "이 날이 왜 회색인가"의 답이 요일보다 훨씬 유용하다. */}
                    <span
                      className={`font-semibold ${holiday && !offDays.has(date) ? "text-att-holiday-ink" : "text-text-faint"}`}
                    >
                      {holiday ?? dowOf(date, lang)}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {data.skillAreas.map((area) => {
            const goal = goals[area.key] ?? { textbook: null, targetProgress: null };
            return (
              <tr key={area.key}>
                <th className="border-line-faint sticky left-0 z-[3] min-w-[236px] border-r border-b bg-white px-2 py-1.5 text-left align-top font-normal shadow-[1px_0_0_var(--line)]">
                  <div className="flex flex-col gap-1">
                    <span
                      className={`${SHEET_BOX_FRAME} inline-flex h-5 w-[74px] items-center justify-center px-1 text-xs font-bold ${
                        SUBJECT_SOFT[skillAreaColorOf(data.skillAreas, area.key)]
                      }`}
                    >
                      {area.label}
                    </span>
                    <div className="grid grid-cols-[minmax(0,1fr)_62px] gap-1">
                      {/* 읽기 권한이면 비활성 + 쓰기를 권하는 자리 표시 글을 걷고 툴팁 안내(month-goal-strip.tsx와 같은 규칙). */}
                      <input
                        className={SHEET_INPUT}
                        defaultValue={goal.textbook ?? ""}
                        disabled={!canEdit}
                        placeholder={canEdit ? t("month.goal.book") : undefined}
                        title={lockedTitle}
                        aria-label={tf("month.goal.bookAria", { area: area.label })}
                        onChange={(e) => onField("homeroom", area.key, "textbook", e.target.value)}
                      />
                      <input
                        className={SHEET_INPUT}
                        defaultValue={goal.targetProgress ?? ""}
                        disabled={!canEdit}
                        title={lockedTitle}
                        placeholder={canEdit ? t("month.goal.target") : undefined}
                        aria-label={tf("month.goal.targetAria", { area: area.label })}
                        onChange={(e) => onField("homeroom", area.key, "targetProgress", e.target.value)}
                      />
                    </div>
                  </div>
                </th>
                {days.map((date) => {
                  const cells = cellsOf(date, area.key);
                  return (
                    <td
                      key={date}
                      className={`border-line-faint border-r border-b px-2 py-1.5 align-top ${
                        cells.length === 0 ? "bg-bg-soft/40" : offDays.has(date) ? "bg-amber-soft/40" : ""
                      }`}
                    >
                      {cells.map(({ line, seat }) => {
                        const off = isOffGoalLine({ ...line, seat }, goals);
                        return (
                          <div
                            key={line.id}
                            className={`border-line-faint flex max-w-[138px] min-w-[96px] flex-col border-t border-dashed pt-1 first:border-0 first:pt-0 ${
                              seat ? "opacity-70" : ""
                            }`}
                          >
                            {line.pageRange ? (
                              <span className="num text-xs font-bold">
                                {seat ? <span className="text-text-faint border-line mr-1 rounded border px-1 text-xs">{"JJ"}</span> : null}
                                {line.pageRange}
                              </span>
                            ) : null}
                            {line.progress ? <span className="text-text-dim text-xs">{line.progress}</span> : null}
                            <span
                              className={`truncate text-xs ${off ? "text-amber font-bold" : "text-text-faint"}`}
                              title={line.textbook ?? ""}
                            >
                              {line.textbook}
                            </span>
                            {display.homework && line.homework ? (
                              <span className="text-text-faint text-xs">
                                <b>{t("plan.col.homework")}</b> {line.homework}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th className="border-line-strong sticky left-0 z-[3] border-t border-r bg-white px-2 py-1.5 text-left text-xs font-normal shadow-[1px_0_0_var(--line)]">
              {t("month.rail.footer")}
            </th>
            {days.map((date) => {
              const slots = data.slotsByDate[date] ?? [];
              const filled = slots.filter((s) => (data.linesBySlot[slotKey(date, s.slotStart)]?.length ?? 0) > 0).length;
              // 🔴 휴일엔 앰버(재촉)를 쓰지 않는다 — 안 쓴 휴일은 작성률 분모에도 없다. 수는 사실이라 그대로 적는다.
              const short = filled < slots.length && !isHolidayOn(data.holidays, date);
              return (
                <td key={date} className="border-line-strong border-t px-2 py-1.5 text-left">
                  <span className={`num text-xs ${short ? "text-amber font-bold" : "text-text-faint"}`}>
                    {filled}/{slots.length}
                  </span>
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
