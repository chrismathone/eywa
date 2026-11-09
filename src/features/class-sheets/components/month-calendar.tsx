"use client";

import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { skillAreaColorOf } from "@/features/owner/skill-areas";
import { SUBJECT_SOFT } from "@/features/owner/subjects";
import { cellDateOf, DOW_ORDER } from "../lib/month";
import { hasClassOnDate } from "../face-nav";
import { slotKey, unwrittenCountOf } from "../lib/month-assemble";
import { holidayNameOn } from "../lib/holiday";
// 요일 글자·문구는 화면 언어를 따른다 — 요일 표는 주간 시트 알약과 **같은 한 벌**이다.
import { sheetDowLabel } from "@/features/teacher-view/i18n";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { teacherNameFor } from "@/features/teacher-view/teacher-name";
import { useTeacherNames } from "@/features/teacher-view/teacher-names-context";
import { isOffGoalLine, type MonthGoalMap } from "../lib/goal-match";
import { EyIcon } from "@/components/icons/aywa-icons";
import { SHEET_BOX_FRAME } from "../ui-box";
import type { ClassSheetMonthData } from "../server/month-queries";
import { compareCell } from "@/features/textbooks/plan-compare";
import { getSlotPlanCompare } from "@/features/textbooks/server/compare-actions";
import { canShiftCell } from "../lib/shift-visible";
import type { ShiftWhich } from "./shift-confirm";
import { PlanCompareButton } from "./plan-compare-dialog";


/**
 * 월간 **달력** 보기 — 그 반이 실제로 도는 요일만 열로 세운다(주 행 × 수업 요일 열).
 * 원장 확정(2026-08-31): 처음 열면 이 보기.
 *
 * 🔴 목표와 어긋난 날은 **칸 테두리·배지·그 줄**을 앰버로 짚는다(*"해당 요일에 경고 처리"*).
 *    판정은 [`goal-match`](../lib/goal-match.ts) 하나뿐이라 진도표·목표 스트립과 답이 갈리지 않는다.
 * ⚠️ 경고 기준은 **담임 목표**다 — 반의 진도 목표는 담임이 세우고, 부담임 칸은 보조 기록이다
 *    (실측 `class_sheet_goals` assistant 행 0건). 스트립에서 부담임 탭을 봐도 경고는 안 흔들린다.
 * 🔴 칸을 누르면 **그 날 계획을 이 화면에서 연다** — 동작은 그것 하나뿐이다.
 *    2026-09-01까지는 한 번 누르면 그 주 주간 시트로 가고 더블클릭이어야 편집 창이 열렸는데, 첫 클릭이
 *    이미 페이지를 떠나 버려서 이동을 240ms 미뤄 두는 편법이 필요했고 그래서 더블클릭이 뻑뻑했다
 *    (원장 *"클릭시 주간으로 가는데 더블클릭시 수정하는데 애로사항이 있음. 클릭 주간 이동은 기능
 *    삭제할것. 상단에 주간 선택이 있으니 해당 기능으로 대체."*).
 * ⚠️ 그래서 이 칸은 **링크가 아니라 버튼**이다 — 갈 곳이 없으므로 `href`를 되살리지 말 것(되살리는
 *    순간 미루기 편법도 함께 돌아온다). 주간 시트로 가는 문은 상단 `주간 | 달력 | 진도표` 전환이다.
 * 🔴 버튼이라 **`items-stretch`를 반드시 적는다** — 브라우저 기본 스타일이 `button`에
 *    `align-items: flex-start`를 걸고 Tailwind preflight엔 그 리셋이 없다. 빼면 세로 flex인 이 칸의
 *    속줄이 칸 폭을 안 채워서 **머리 줄의 `ml-auto`가 죽고**(배지가 날짜 옆에 붙는다) 교시 구분
 *    점선도 내용 폭까지만 그려진다. `<a>`일 땐 그 기본 스타일이 없어 저절로 stretch였다.
 * ⚠️ 더블클릭해도 탈은 없다 — 두 번째 클릭은 이미 열린 창이 받는다.
 * ⚠️ 버튼이라 탭·엔터로도 열린다(전엔 키보드로는 편집 창에 닿을 길이 아예 없었다).
 */
export function MonthCalendar({
  data,
  goals,
  display,
  onOpenDay,
  onShift,
}: {
  data: ClassSheetMonthData;
  /** 담임 월간 목표(경고 기준). */
  goals: MonthGoalMap;
  display: { homework: boolean; seat: boolean };
  /** 칸 클릭 — 그 날 계획을 이 화면에서 연다. */
  onOpenDay: (date: string) => void;
  /**
   * 회차 미루기·당기기(0282a). **없으면 버튼이 안 뜬다** — 누를 수 없는 버튼을 세우지 않는다.
   */
  onShift?: (date: string, slotStart: string, kind: "skip" | "advance", which?: ShiftWhich) => void;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const lang = useSheetLang();
  const dows = data.dows.filter((d) => DOW_ORDER.includes(d));
  if (dows.length === 0) {
    return (
      <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">
        {t("month.noClasses")}
      </p>
    );
  }
  const cols = `44px repeat(${dows.length}, minmax(0, 1fr))`;
  // 수업이 하나도 없는 주는 행 자체를 안 만든다 — 8월처럼 1일이 토요일이면 첫 주가 통째로 빈 띠가 된다.
  // ⚠️ 판정은 [face-nav](../face-nav.ts) 한 곳 — 여기서 다시 적으면 **달력이 안 그리는 주로**
  //    상단 '주간'이 보내는 상태가 된다(둘이 같은 판정을 써야 한다).
  const weeksWithClass = data.weeks.filter((w) => w.dates.some((d) => hasClassOnDate(data.slotsByDate, d)));

  return (
    <div className="grid gap-1.5">
      <div className="grid gap-1.5" style={{ gridTemplateColumns: cols }}>
        <div />
        {dows.map((dow) => (
          <div key={dow} className="bg-bg-soft flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold">
            {tf("month.dowFull", { dow: sheetDowLabel(dow, lang) })}
          </div>
        ))}
      </div>

      {weeksWithClass.map((week) => (
        <div key={week.monday} className="grid items-stretch gap-1.5" style={{ gridTemplateColumns: cols }}>
          <div
            className="border-line-faint text-text-faint flex items-center justify-center border-r text-xs font-bold"
            // 수업이 없는 주는 행이 없어서 번호가 건너뛸 수 있다 — 이 숫자는 '그 달의 몇째 주'다.
            title={tf("month.weekTitle", {
              m: Number(data.month.slice(5)),
              w: week.index,
              date: week.monday,
            })}
          >
            <span className="num">{week.index}</span>
            {t("month.weekUnit")}
          </div>
          {dows.map((dow) => {
            const date = cellDateOf(week, dow);
            if (!date) {
              return <div key={dow} className="border-line rounded-[10px] border border-dashed bg-bg-soft/50" />;
            }
            return (
              <DayCell
                key={dow}
                date={date}
                data={data}
                goals={goals}
                display={display}
                skillAreas={data.skillAreas}
                onOpenDay={onOpenDay}
                onShift={onShift}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function DayCell({
  date,
  data,
  goals,
  display,
  skillAreas,
  onOpenDay,
  onShift,
}: {
  date: string;
  data: ClassSheetMonthData;
  goals: MonthGoalMap;
  display: { homework: boolean; seat: boolean };
  skillAreas: SkillAreaSetting[];
  onOpenDay: (date: string) => void;
  /** 회차 미루기·당기기(0282a) — 없으면 버튼이 안 뜬다. */
  onShift?: (date: string, slotStart: string, kind: "skip" | "advance", which?: ShiftWhich) => void;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const lang = useSheetLang();
  // 강사 라벨 → 영어 이름(표에 없으면 한국어 그대로) — 판정은 `teacherNameFor` 한 곳이다.
  const teacherNames = useTeacherNames();
  const allSlots = data.slotsByDate[date] ?? [];
  const shown = allSlots.filter((s) => display.seat || s.seat === null);
  /**
   * 🔴 배지 숫자는 **배정된 전 교시** 기준(표시 토글과 무관) — 접는 것만으로 좋아 보이면 안 된다.
   * 🔴 판정은 [`unwrittenCountOf`](../lib/month-assemble.ts) 단일 소스다 — 여기서 다시 세면 툴바
   *    작성률과 배지가 휴일을 서로 다르게 읽는다(**휴일엔 `미작성 N`이 안 뜬다** — 의무가 없다).
   */
  const holiday = holidayNameOn(data.holidays, date);
  const hasLines = (d: string, t: string) => (data.linesBySlot[slotKey(d, t)]?.length ?? 0) > 0;
  // 재촉("미작성 N") — **휴일이면 0**. 의무가 없는 날을 앰버로 세우지 않는다.
  const unwritten = unwrittenCountOf(allSlots, date, hasLines, data.holidays);
  // 사실("이 날 계획이 다 있나") — 휴일 규약을 **빼고** 센다. 아래 초록 체크는 재촉이 아니라 확인이라,
  // 계획이 하나도 없는 휴일에 "다 있습니다"라고 하면 그건 그냥 거짓말이다.
  const missing = unwrittenCountOf(allSlots, date, hasLines);
  const offGoal = allSlots.reduce((n, slot) => {
    const lines = data.linesBySlot[slotKey(date, slot.slotStart)] ?? [];
    return n + lines.filter((l) => isOffGoalLine({ ...l, seat: slot.seat !== null }, goals)).length;
  }, 0);
  const isToday = date === data.today;

  if (allSlots.length === 0) {
    return <div className="border-line rounded-[10px] border bg-bg-soft/50" />;
  }

  return (
    <button
      type="button"
      // ⚠️ 편집 권한이 없으면 "고칩니다"라고 하지 않는다 — 눌러 보기 전엔 모르는 거짓 약속이 된다.
      // 🔴 휴일이어도 **누르면 그 날 계획이 열린다**(원장 2026-09-01 *"입력은 가능하도록"*) — 톤만 회색이다.
      title={
        holiday
          ? tf(data.canEdit ? "month.cell.holiday.edit" : "month.cell.holiday.view", { holiday })
          : t(data.canEdit ? "month.cell.edit" : "month.cell.view")
      }
      onClick={() => onOpenDay(date)}
      className={`flex min-w-0 cursor-pointer flex-col items-stretch gap-1.5 rounded-[10px] border px-2 py-1.5 text-left transition ${
        // 회색 톤은 월별 출석부와 **같은 토큰**(`--att-weekend`) — 새 색을 만들지 않는다(의미색 캐논).
        holiday ? "bg-att-weekend" : "bg-white"
      } ${
        offGoal > 0
          ? "border-amber shadow-[0_0_0_1px_var(--amber)] hover:shadow-[0_0_0_2px_var(--amber)]"
          : isToday
            ? "border-primary shadow-[0_0_0_1px_var(--primary)]"
            : "border-line hover:border-primary hover:shadow-[0_0_0_1px_var(--primary)]"
      }`}
    >
      <div className="flex items-center gap-1.5">
        {/* 휴일 글자 = 출석부 휴일 잉크(`text-att-holiday-ink`) — 공용 `text-danger`는 휴일 회색
            (`--att-weekend`) 위에서 대비 3.75로 WCAG 4.5를 깼다(2026-09-14). */}
        <span className={`num text-sm font-bold ${holiday ? "text-att-holiday-ink" : ""}`}>
          {date.slice(5).replace("-", "/")}
        </span>
        {/* 공휴일명 — 이름이 곧 사유다. 좁은 칸이라 넘치면 줄인다(전문은 칸 title). */}
        {holiday ? (
          <span className="text-att-holiday-ink min-w-0 shrink truncate text-xs font-bold">{holiday}</span>
        ) : null}
        <span className="ml-auto flex shrink-0 gap-1">
          {isToday ? (
            <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-xs leading-4 font-bold">
              {t("nav.face.today")}
            </span>
          ) : null}
          {unwritten > 0 ? (
            <span className="border-amber/40 bg-amber-soft text-amber num rounded-full border px-1.5 text-xs leading-4 font-bold">
              {tf("month.unwrittenN", { n: unwritten })}
            </span>
          ) : missing === 0 && offGoal === 0 && !isToday ? (
            <span
              className="border-green/30 bg-green-soft text-green inline-flex items-center rounded-full border px-1.5 leading-4"
              title={t("month.allWritten.title")}
            >
              <EyIcon name="check" size={11} />
            </span>
          ) : null}
          {offGoal > 0 ? (
            <span className="bg-amber num rounded-full px-1.5 text-xs leading-4 font-bold text-white">
              {tf("month.offGoalN", { n: offGoal })}
            </span>
          ) : null}
        </span>
      </div>

      {shown.map((slot) => {
        const lines = data.linesBySlot[slotKey(date, slot.slotStart)] ?? [];
        const seat = slot.seat !== null;
        // 월간계획(교재 배정에서 계산) — 아직 실제가 없는 칸에만 쓴다(아래).
        const cellKey = slotKey(date, slot.slotStart);
        const planned = data.plannedBySlot[cellKey] ?? [];
        // 🔑 원래 계획 ↔ 실제 판정(원장 2026-09-28) — 칩에 판정을 적어 **열지 않아도** 보이게 한다.
        //    평시 줄만 견준다(배정은 평시 축뿐). 판정은 plan-compare 단일 소스(현황 페이지와 같은 답).
        const verdict =
          planned.length > 0
            ? compareCell({
                baseline: planned,
                actual: lines.filter((l) => l.termMode === "regular"),
                lessonIndex: data.lessonIndex,
                isFuture: date > data.today,
              })
            : null;
        return (
          <div key={slot.slotStart} className="border-line-faint grid grid-cols-[46px_minmax(0,1fr)] gap-1.5 border-t border-dashed pt-1 first:border-0 first:pt-0">
            <span
              className="text-text-faint num pt-0.5 text-xs font-bold"
              // 교시 이름은 학원설정이 단일 소스 — 칸이 좁아 본문엔 못 적고 툴팁으로 준다.
              title={data.periodLabelBySlot[slotKey(date, slot.slotStart)] ?? undefined}
            >
              {slot.slotStart}
              {seat ? <span className="block">{slot.seat}</span> : null}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              {verdict ? (
                <PlanCompareButton
                  inButton
                  size="sm"
                  date={date}
                  slotStart={slot.slotStart}
                  known={verdict}
                  load={() => getSlotPlanCompare({ classId: data.classId, date, slotStart: slot.slotStart })}
                />
              ) : null}
              {lines.length === 0 ? (
                <>
                  {/* 🔴 휴일엔 '미작성'이라 부르지 않는다 — 안 쓴 게 아니라 쓸 의무가 없던 것이다(앰버=재촉). */}
                  <span
                    className={`self-start rounded border border-dashed px-1.5 text-xs leading-4 font-bold ${
                      holiday ? "border-line-strong text-text-faint" : "border-amber/45 text-amber"
                    }`}
                  >
                    {t(holiday ? "month.noPlan" : "month.unwritten")} ·{" "}
                    {teacherNameFor(slot.teacherLabel, teacherNames, lang) ?? t("month.noTeacher")}
                  </span>
                  {/* 🔴 **월간계획은 실제가 아니다**(원장 2026-09-22) — 아직 안 쓴 칸에만, 무채색으로,
                      `계획` 표식을 달아 보여 준다. 실제가 한 줄이라도 있으면 안 그린다(이미 한 수업이다).
                      교재 배정이 오늘 이후 칸엔 이걸(일정) 실제에 함께 넣으니(2026-10-22) 여기 남는 건 빈 칸·지난 칸뿐이다. */}
                  {planned.map((p, i) => (
                    <div key={`${p.skillArea}|${p.lessonNo}|${i}`} className="text-text-faint flex min-w-0 gap-1 text-xs">
                      <span className="border-line-strong shrink-0 rounded border border-dashed px-1 font-bold">
                        {t("month.plannedTag")}
                      </span>
                      <span className="min-w-0 truncate">
                        <span className="font-bold">{p.title}</span>
                        <span className="num"> {tf("month.plannedNo", { n: p.lessonNo })}</span>
                        {p.progress ? <span> · {p.progress}</span> : null}
                      </span>
                    </div>
                  ))}
                </>
              ) : (
                lines.map((line) => {
                  const off = isOffGoalLine({ ...line, seat }, goals);
                  return (
                    <div
                      key={line.id}
                      className={`grid min-w-0 grid-cols-[74px_minmax(0,1fr)] items-baseline gap-1.5 ${
                        off ? "bg-amber-soft -mx-1 rounded px-1" : ""
                      }`}
                    >
                      <span
                        className={`${SHEET_BOX_FRAME} inline-flex h-5 w-full items-center justify-center truncate px-1 text-xs font-bold ${
                          SUBJECT_SOFT[skillAreaColorOf(skillAreas, line.skillArea)]
                        }`}
                      >
                        {skillAreas.find((a) => a.key === line.skillArea)?.label ?? line.skillArea}
                      </span>
                      <div className="min-w-0 text-xs">
                        <span className={`font-bold ${off ? "text-amber" : ""}`}>{line.textbook}</span>
                        {line.pageRange ? <span className="text-text-faint num"> {line.pageRange}</span> : null}
                        {line.progress ? <div className="text-text-dim">{line.progress}</div> : null}
                        {display.homework && line.homework ? (
                          <div className="text-text-faint text-xs">
                            {tf("month.homeworkLine", { v: line.homework })}
                          </div>
                        ) : null}
                        {off ? (
                          <div className="text-amber text-xs font-bold">
                            {tf("month.goalLine", { book: goals[line.skillArea]?.textbook ?? "" })}
                          </div>
                        ) : null}
                        {/* 🔑 **줄마다** 미룸·당김(원장 2026-10-20 *"수업이 2개면 각각 미룸, 당김"*) — 그 줄의 교재
                            한 차수만 움직이고 같은 칸의 다른 줄은 그대로다. 내용이 적힌 평시 줄에만(`canShiftCell`). */}
                        {onShift && data.canEdit && canShiftCell([line]) ? (
                          <ShiftChips
                            kinds={["skip", "advance"]}
                            onPress={(kind) => onShift(date, slot.slotStart, kind, { lineId: line.id })}
                          />
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
              {/* 🔴 **회차 미루기·당기기**(원장 2026-09-22 → 2026-10-15 *"미루는 거기 복사하고 한주씩 쭉 밀기"*):
                  **실제 진도**가 밀리거나 당겨진다(`setLessonShift`). 버튼은 **줄마다**(위, 원장 2026-10-20 *"수업이
                  2개면 각각"*) — 지난 날짜에도 세운다("지난주에 못 나갔다"를 뒤늦게 미루는 게 정상 흐름이다).
                  🔑 **계획만 있는 칸엔 [당김]만**(원장 2026-10-20 *"계획만 있을 경우 미룸버튼은 없고 당겨서 전수업 한시간씩
                     당겨지게"*) — 이 칸의 미룸을 걷어 뒤 수업이 한 칸씩 올라와 채운다(버려지는 차수 없음, `fill`).
                     미룰 진도가 없는 칸이라 [미룸]은 없다. 누르면 확인 창 → 실행 → 토스트 [되돌리기](`month-client`).
                  ⚠️ **미뤄 비운 칸에만**(`shiftBySlot` = 미룸) — 아직 안 가져온 칸·사람이 지운 칸에 세우면 걷을 미룸이
                     없어 서버가 거절한다(적대적 리뷰 2026-10-20: 앞으로의 칸마다 누를 수 없는 버튼이 깔렸다). */}
              {onShift && data.canEdit && planned.length > 0 && !canShiftCell(lines) && data.shiftBySlot[cellKey] === "skip" ? (
                <ShiftChips
                  kinds={["advance"]}
                  titleOf={() => t("month.shift.fill.title")}
                  onPress={() => onShift(date, slot.slotStart, "advance", { fill: true })}
                />
              ) : null}
              {lines.length > 0 && !lines.some((l) => l.progress) ? (
                <span className="border-line-strong text-text-faint self-start rounded border border-dashed px-1.5 text-xs leading-4 font-bold">
                  {t("month.bookOnly")}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </button>
  );
}

/**
 * 미룸·당김 알약 — 날짜 칸이 이미 native button이라 **중첩 button을 못 쓴다**(SSR 파서가 깨져 달력 조각이 셸 밖에
 * 남는다) → `PlanCompareButton`과 같은 `span[role=button]` 형태. 칸 클릭(그 날 열기)으로 새지 않게 막는다.
 */
function ShiftChips({
  kinds,
  onPress,
  titleOf,
}: {
  kinds: readonly ("skip" | "advance")[];
  onPress: (kind: "skip" | "advance") => void;
  titleOf?: (kind: "skip" | "advance") => string;
}) {
  const t = useSheetT();
  return (
    <div className="mt-0.5 flex flex-wrap gap-1">
      {kinds.map((kind) => (
        <span
          key={kind}
          role="button"
          tabIndex={0}
          title={titleOf ? titleOf(kind) : t(kind === "skip" ? "month.shift.skip.title" : "month.shift.advance.title")}
          onClick={(e) => {
            e.stopPropagation();
            onPress(kind);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              if (!e.repeat) onPress(kind);
            }
          }}
          onKeyUp={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
            }
          }}
          className="border-line text-text-faint hover:border-primary hover:text-foreground focus-visible:outline-primary cursor-pointer rounded-full border px-1.5 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {t(kind === "skip" ? "month.shift.skip" : "month.shift.advance")}
        </span>
      ))}
    </div>
  );
}
