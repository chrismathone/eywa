"use client";

import Link from "next/link";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { skillAreaColorOf } from "@/features/owner/skill-areas";
import { SUBJECT_SOFT } from "@/features/owner/subjects";
import { mondayOf } from "@/features/timetable/lib/week";
import { cellDateOf, DOW_ORDER } from "../lib/month";
import { slotKey } from "../lib/month-assemble";
import { isOffGoalLine, type MonthGoalMap } from "../lib/goal-match";
import { EyIcon } from "@/components/icons/eywa-icons";
import { SHEET_BOX_FRAME } from "../ui-box";
import type { ClassSheetMonthData } from "../server/month-queries";

const DOW_KO: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };

/**
 * 월간 **달력** 보기 — 그 반이 실제로 도는 요일만 열로 세운다(주 행 × 수업 요일 열).
 * 원장 확정(2026-08-31): 처음 열면 이 보기.
 *
 * 🔴 목표와 어긋난 날은 **칸 테두리·배지·그 줄**을 앰버로 짚는다(*"해당 요일에 경고 처리"*).
 *    판정은 [`goal-match`](../lib/goal-match.ts) 하나뿐이라 진도표·목표 스트립과 답이 갈리지 않는다.
 * ⚠️ 경고 기준은 **담임 목표**다 — 반의 진도 목표는 담임이 세우고, 부담임 칸은 보조 기록이다
 *    (실측 `class_sheet_goals` assistant 행 0건). 스트립에서 부담임 탭을 봐도 경고는 안 흔들린다.
 * ⚠️ 칸을 누르면 그 주 주간 시트로 간다 — 고치는 자리는 지금도 거기 하나다(월간은 읽는 화면).
 */
export function MonthCalendar({
  data,
  goals,
  display,
}: {
  data: ClassSheetMonthData;
  /** 담임 월간 목표(경고 기준). */
  goals: MonthGoalMap;
  display: { homework: boolean; seat: boolean };
}) {
  const dows = data.dows.filter((d) => DOW_ORDER.includes(d));
  if (dows.length === 0) {
    return (
      <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">
        이 달에는 수업이 없습니다.
      </p>
    );
  }
  const cols = `44px repeat(${dows.length}, minmax(0, 1fr))`;
  // 수업이 하나도 없는 주는 행 자체를 안 만든다 — 8월처럼 1일이 토요일이면 첫 주가 통째로 빈 띠가 된다.
  const weeksWithClass = data.weeks.filter((w) => w.dates.some((d) => (data.slotsByDate[d]?.length ?? 0) > 0));

  return (
    <div className="grid gap-1.5">
      <div className="grid gap-1.5" style={{ gridTemplateColumns: cols }}>
        <div />
        {dows.map((dow) => (
          <div key={dow} className="bg-bg-soft flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-bold">
            {DOW_KO[dow]}요일
          </div>
        ))}
      </div>

      {weeksWithClass.map((week) => (
        <div key={week.monday} className="grid items-stretch gap-1.5" style={{ gridTemplateColumns: cols }}>
          <div
            className="border-line-faint text-text-faint flex items-center justify-center border-r text-[11.5px] font-bold"
            // 수업이 없는 주는 행이 없어서 번호가 건너뛸 수 있다 — 이 숫자는 '그 달의 몇째 주'다.
            title={`${Number(data.month.slice(5))}월 ${week.index}째 주 (${week.monday} 시작)`}
          >
            <span className="num">{week.index}</span>주
          </div>
          {dows.map((dow) => {
            const date = cellDateOf(week, dow, data.month);
            if (!date) {
              return <div key={dow} className="border-line rounded-[10px] border border-dashed bg-[#fafbfc]" />;
            }
            return (
              <DayCell
                key={dow}
                date={date}
                data={data}
                goals={goals}
                display={display}
                skillAreas={data.skillAreas}
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
}: {
  date: string;
  data: ClassSheetMonthData;
  goals: MonthGoalMap;
  display: { homework: boolean; seat: boolean };
  skillAreas: SkillAreaSetting[];
}) {
  const allSlots = data.slotsByDate[date] ?? [];
  const shown = allSlots.filter((s) => display.seat || s.seat === null);
  // 🔴 배지 숫자는 **배정된 전 교시** 기준(표시 토글과 무관) — 접는 것만으로 좋아 보이면 안 된다.
  const unwritten = allSlots.filter((s) => (data.linesBySlot[slotKey(date, s.slotStart)]?.length ?? 0) === 0).length;
  const offGoal = allSlots.reduce((n, slot) => {
    const lines = data.linesBySlot[slotKey(date, slot.slotStart)] ?? [];
    return n + lines.filter((l) => isOffGoalLine({ ...l, seat: slot.seat !== null }, goals)).length;
  }, 0);
  const isToday = date === data.today;

  if (allSlots.length === 0) {
    return <div className="border-line rounded-[10px] border bg-[#fafbfc]" />;
  }

  return (
    <Link
      href={`/ecs/${data.classId}?week=${mondayOf(date)}&day=${date}`}
      title="누르면 이 날이 열린 채로 주간 시트로 갑니다"
      className={`flex min-w-0 flex-col gap-1.5 rounded-[10px] border bg-white px-2 py-1.5 transition ${
        offGoal > 0
          ? "border-amber shadow-[0_0_0_1px_var(--amber)] hover:shadow-[0_0_0_2px_var(--amber)]"
          : isToday
            ? "border-primary shadow-[0_0_0_1px_var(--primary)]"
            : "border-line hover:border-primary hover:shadow-[0_0_0_1px_var(--primary)]"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className="num text-[13px] font-bold">{date.slice(5).replace("-", "/")}</span>
        <span className="ml-auto flex gap-1">
          {isToday ? (
            <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-[10.5px] leading-4 font-bold">
              오늘
            </span>
          ) : null}
          {unwritten > 0 ? (
            <span className="border-amber/40 bg-amber-soft text-amber num rounded-full border px-1.5 text-[10.5px] leading-4 font-bold">
              미작성 {unwritten}
            </span>
          ) : offGoal === 0 && !isToday ? (
            <span
              className="border-green/30 bg-green-soft text-green inline-flex items-center rounded-full border px-1.5 leading-4"
              title="이 날은 배정된 교시에 계획이 다 있습니다"
            >
              <EyIcon name="check" size={11} />
            </span>
          ) : null}
          {offGoal > 0 ? (
            <span className="bg-amber num rounded-full px-1.5 text-[10.5px] leading-4 font-bold text-white">
              목표 밖 {offGoal}
            </span>
          ) : null}
        </span>
      </div>

      {shown.map((slot) => {
        const lines = data.linesBySlot[slotKey(date, slot.slotStart)] ?? [];
        const seat = slot.seat !== null;
        return (
          <div key={slot.slotStart} className="border-line-faint grid grid-cols-[46px_minmax(0,1fr)] gap-1.5 border-t border-dashed pt-1 first:border-0 first:pt-0">
            <span
              className="text-text-faint num pt-0.5 text-[11px] font-bold"
              // 교시 이름은 학원설정이 단일 소스 — 칸이 좁아 본문엔 못 적고 툴팁으로 준다.
              title={data.periodLabelBySlot[slotKey(date, slot.slotStart)] ?? undefined}
            >
              {slot.slotStart}
              {seat ? <span className="block">{slot.seat}</span> : null}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              {lines.length === 0 ? (
                <span className="border-amber/45 text-amber self-start rounded border border-dashed px-1.5 text-[10.5px] leading-4 font-bold">
                  미작성 · {slot.teacherLabel ?? "담당 미지정"}
                </span>
              ) : (
                lines.map((line) => {
                  const off = isOffGoalLine({ ...line, seat }, goals);
                  return (
                    <div
                      key={line.id}
                      className={`grid min-w-0 grid-cols-[74px_minmax(0,1fr)] items-baseline gap-1.5 ${
                        off ? "border-amber -ml-2 border-l-[3px] pl-1.5" : ""
                      }`}
                    >
                      <span
                        className={`${SHEET_BOX_FRAME} inline-flex h-5 w-full items-center justify-center truncate px-1 text-[12px] font-bold ${
                          SUBJECT_SOFT[skillAreaColorOf(skillAreas, line.skillArea)]
                        }`}
                      >
                        {skillAreas.find((a) => a.key === line.skillArea)?.label ?? line.skillArea}
                      </span>
                      <div className="min-w-0 text-[12px]">
                        <span className={`font-bold ${off ? "text-amber" : ""}`}>{line.textbook}</span>
                        {line.pageRange ? <span className="text-text-faint num"> {line.pageRange}</span> : null}
                        {line.progress ? <div className="text-text-dim">{line.progress}</div> : null}
                        {display.homework && line.homework ? (
                          <div className="text-text-faint text-[11.5px]">과제 {line.homework}</div>
                        ) : null}
                        {off ? (
                          <div className="text-amber text-[11px] font-bold">
                            월간 목표: {goals[line.skillArea]?.textbook}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
              {lines.length > 0 && !lines.some((l) => l.progress) ? (
                <span className="border-line-strong text-text-faint self-start rounded border border-dashed px-1.5 text-[10.5px] leading-4 font-bold">
                  교재만 · 진도 미기입
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </Link>
  );
}
