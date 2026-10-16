"use client";

import { cn } from "@/lib/utils";
import { TONE_TEXT } from "@/lib/design/semantic-color";
import { MARK } from "@/features/shuttle/parent/month-mark";
import type { StaffCalendarDay } from "@/features/shuttle/parent/staff-month";

const HEAD = ["월", "화", "수", "목", "금"];
/** 칸 하나에 이름을 몇 명까지 적나 — 넘치면 "외 N명". */
const SHOW_NAMES = 3;

function Names({ glyph, tone, label, names }: { glyph: string; tone: string; label: string; names: string[] }) {
  if (names.length === 0) return null;
  const head = names.slice(0, SHOW_NAMES).join(", ");
  const more = names.length > SHOW_NAMES ? ` 외 ${names.length - SHOW_NAMES}명` : "";
  return (
    <p className="text-xs leading-4 break-keep" title={`${label}: ${names.join(", ")}`}>
      <span className={cn("font-bold", tone)}>
        {glyph} {label} {names.length}
      </span>{" "}
      <span className="text-text-dim">
        {head}
        {more}
      </span>
    </p>
  );
}

/**
 * 직원 '학부모 등하원 → 월별' 달력(사용자 2026-10-16 "월별에서 캘린더식으로 넣어서 좀 더 가시성 있게") — 월~금 칸마다 그날 학원 전체.
 * 칸 = 탄 아이 수 + **챙길 일만 이름으로**(미탑승 · 결석 · 안 탐 · 변경). 평소대로 탄 아이는 이름을 적지 않는다(칸이 이름으로 덮이지 않게).
 * 기호·색은 학부모 달력과 같은 `MARK`. 바뀐 게 없는 날은 빈칸으로 둔다("평소대로" 글자 없음, 사용자 2026-10-16).
 * 칸을 누르면 그날 상세 모달(`StaffMonthDayDialog`)이 뜬다 — 일별로 가는 길은 모달 안 [그날 일별로 보기].
 */
export function StaffMonthCalendar({ weeks, onOpenDay }: { weeks: StaffCalendarDay[][]; onOpenDay: (ymd: string) => void }) {
  return (
    <div className="bg-card overflow-hidden rounded-2xl shadow-[var(--shadow-card)]">
      <div className="border-line-faint grid grid-cols-5 border-b">
        {HEAD.map((h) => (
          <div key={h} className="text-text-dim py-1.5 text-center text-xs font-bold">
            {h}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]?.date} className="border-line-faint grid grid-cols-5 border-b last:border-b-0">
          {week.map((d) => {
            if (!d.inMonth) return <div key={d.date} className="bg-bg-soft/40 border-line-faint min-h-24 border-r last:border-r-0" />;
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => onOpenDay(d.date)}
                title={`${d.date} 상세 보기`}
                className={cn(
                  "border-line-faint hover:bg-bg-soft flex min-h-24 min-w-0 flex-col gap-0.5 border-r p-1.5 text-left last:border-r-0",
                  d.holiday && "bg-muted/60",
                  d.isToday && "bg-primary/5 ring-primary ring-2 ring-inset",
                )}
              >
                <span className="flex items-baseline gap-1">
                  <span className={cn("num text-sm font-bold", d.isToday && "text-primary")}>{d.day}</span>
                  {d.isToday ? <span className="text-primary text-xs font-bold">오늘</span> : null}
                  {d.holiday ? <span className="text-text-faint truncate text-xs">{d.holiday}</span> : null}
                </span>
                {d.holiday ? null : (
                  <>
                    {d.rode > 0 ? (
                      <p className={cn("text-xs leading-4 font-bold", MARK.rode.tone)}>
                        {MARK.rode.glyph} 탔음 {d.rode}명
                      </p>
                    ) : null}
                    <Names glyph={MARK.missed.glyph} tone={MARK.missed.tone} label="미탑승" names={d.missed} />
                    <Names glyph="" tone={TONE_TEXT.caution} label="결석" names={d.absent} />
                    <Names glyph={MARK.skip.glyph} tone={MARK.skip.tone} label="안 탐" names={d.skip} />
                    <Names glyph={MARK.changed.glyph} tone={MARK.changed.tone} label="변경" names={d.changed} />
                  </>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
