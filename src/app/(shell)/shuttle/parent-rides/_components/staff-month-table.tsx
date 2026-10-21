"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";
import { TONE_TEXT } from "@/lib/design/semantic-color";
import { MARK } from "@/features/shuttle/parent/month-mark";
import type { DirMark, MonthDay } from "@/features/shuttle/parent/parent-month";
import type { StaffMonth } from "@/features/shuttle/parent/staff-month";

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
const weekdayOf = (ymd: string) => WEEKDAY[new Date(`${ymd}T00:00:00Z`).getUTCDay()]!;

/** 등·하 한 칸 — 학부모 달력과 같은 기호·색(`MARK`). 평소대로·기록 없음은 흐린 점. */
function Mark({ dir, mark }: { dir: "등" | "하"; mark: DirMark }) {
  const m = mark ? MARK[mark] : null;
  return (
    <span className="flex items-center justify-center gap-0.5 leading-4" title={`${dir}원 ${m ? m.label : "평소대로"}`}>
      <span className="text-text-faint">{dir}</span>
      <span className={cn("font-bold", m ? m.tone : "text-line-strong")}>{m ? m.glyph : "·"}</span>
    </span>
  );
}

/** 칸 하나 — 누르면 그 아이의 그날 상세 모달. 쉬는 날은 누를 것이 없다. */
function Cell({ day, name, onOpen }: { day: MonthDay; name: string; onOpen: () => void }) {
  if (day.holiday) return <td className="bg-muted/60 border-line-faint border" title={day.holiday} />;
  return (
    <td className={cn("border-line-faint border p-0 text-center text-xs", day.isToday && "bg-primary/5")}>
      <button
        type="button"
        onClick={onOpen}
        title={`${name} ${day.date} 상세 보기`}
        className="hover:bg-primary/10 flex h-full min-h-11 w-full flex-col items-center justify-center px-0.5 py-0.5"
      >
        {day.absent ? (
          <span className={cn("font-bold", TONE_TEXT.caution)}>결석</span>
        ) : (
          <>
            <Mark dir="등" mark={day.in} />
            <Mark dir="하" mark={day.out} />
          </>
        )}
      </button>
    </td>
  );
}

/**
 * 직원 '학부모 등하원 → 월별' 표(사용자 2026-10-16 "각 학부모들이 월별에서 보는 걸 통합으로") — 아이 한 줄 × 그 달 평일.
 * 칸 하나 = 학부모 월별 달력 칸 하나(같은 판정 `buildParentMonth` · 같은 기호 `MARK`).
 * 🔑 칸을 누르면 그 아이의 그날 상세 모달(사용자 2026-10-16 "아이별 한눈에도 클릭하면 확실히") · 머리의 날짜를 누르면 그날 [일별]로 간다.
 * 📐 이름 칸은 왼쪽에 고정(가로로 밀어도 누구 줄인지 보인다) · 쉬는 날은 회색 · 오늘은 옅은 남색 · 줄 끝에 그 달 합계.
 */
export function StaffMonthTable({
  data,
  dayHrefs,
  onOpenCell,
}: {
  data: StaffMonth;
  dayHrefs: Record<string, string>;
  onOpenCell: (ymd: string, studentId: string) => void;
}) {
  const { days, rows } = data;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-text-dim flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {(Object.keys(MARK) as (keyof typeof MARK)[]).map((k) => (
          <span key={k} className="flex items-center gap-1">
            <span className={cn("font-bold", MARK[k].tone)}>{MARK[k].glyph}</span>
            {MARK[k].label}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className={cn("font-bold", TONE_TEXT.caution)}>결석</span>등·하원 모두 결석
        </span>
        <span className="flex items-center gap-1">
          <span className="text-line-strong font-bold">·</span>평소대로(기록 없음)
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden className="bg-muted inline-block size-3 rounded-sm" />쉬는 날
        </span>
      </p>

      {rows.length === 0 ? (
        <div className="border-line text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">이 달엔 셔틀을 타는 아이가 없습니다.</div>
      ) : (
        <div className="bg-card overflow-x-auto rounded-2xl shadow-[var(--shadow-card)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="bg-card sticky left-0 z-10 min-w-28 px-3 py-2 text-left text-xs font-bold">아이 ({rows.length}명)</th>
                {days.map((d) => (
                  <th
                    key={d.date}
                    className={cn("min-w-11 px-0.5 py-1 text-center text-xs font-bold", d.holiday && "bg-muted/60 text-text-faint", d.isToday && "bg-primary/10 text-primary")}
                    title={d.holiday ?? undefined}
                  >
                    <Link href={dayHrefs[d.date] ?? "#"} className="hover:text-primary flex flex-col items-center leading-4" title={`${d.date} 일별로 보기`}>
                      <span className="num">{d.day}</span>
                      <span className="text-text-faint font-medium">{weekdayOf(d.date)}</span>
                    </Link>
                  </th>
                ))}
                <th className="border-line border-l px-2 py-1 text-center text-xs font-bold whitespace-nowrap">탄 날</th>
                <th className="px-2 py-1 text-center text-xs font-bold whitespace-nowrap">미탑승</th>
                <th className="px-2 py-1 text-center text-xs font-bold whitespace-nowrap">안 탐</th>
                <th className="px-2 py-1 text-center text-xs font-bold whitespace-nowrap">결석</th>
                <th className="px-2 py-1 text-center text-xs font-bold whitespace-nowrap">변경</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-bg-soft/60">
                  <th scope="row" className="bg-card border-line-faint sticky left-0 z-10 border-y px-3 py-1 text-left">
                    <span className="block text-sm font-bold whitespace-nowrap">{r.name}</span>
                    {r.schoolGrade ? <span className="text-text-faint block text-xs whitespace-nowrap">{r.schoolGrade}</span> : null}
                  </th>
                  {r.cells.map((c) => (
                    <Cell key={c.date} day={c} name={r.name} onOpen={() => onOpenCell(c.date, r.id)} />
                  ))}
                  <td className={cn("num border-line border-l px-2 text-center font-bold", TONE_TEXT.positive)}>{r.summary.rodeDays}</td>
                  <td className={cn("num px-2 text-center", r.summary.missed ? cn("font-bold", TONE_TEXT.caution) : "text-text-faint")}>{r.summary.missed}</td>
                  <td className="num text-text-dim px-2 text-center">{r.summary.skipDays}</td>
                  <td className={cn("num px-2 text-center", r.summary.absentDays ? cn("font-bold", TONE_TEXT.caution) : "text-text-faint")}>{r.summary.absentDays}</td>
                  <td className={cn("num px-2 text-center", r.summary.changedDays ? cn("font-bold", TONE_TEXT.special) : "text-text-faint")}>{r.summary.changedDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
