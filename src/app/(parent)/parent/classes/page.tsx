import type { CSSProperties } from "react";
import { redirect } from "next/navigation";

import { formatKoreanDate, kstToday } from "@/lib/date-kst";
import { loadParentTimetables } from "@/features/classes/server/parent-timetable-data";
import type { TimetableDayRow } from "@/features/classes/parent-timetable";
import { parentPortalAvailable } from "@/features/shuttle/parent/server/parent-availability";
import { getParentViewer } from "@/features/shuttle/parent/server/parent-viewer";
import { loadAcademyHolidays, restDayName } from "@/features/shuttle/parent/server/rest-days";
import { weekDates } from "@/features/shuttle/parent/parent-rides";
import { dayLabel, type DayCode } from "@/features/shuttle/types";

export async function generateMetadata() {
  const viewer = await getParentViewer();
  return { title: viewer && (await parentPortalAvailable(viewer)) ? "수업 시간표" : "학부모" };
}

/**
 * 학부모 탭 3 '수업 시간표' — 연결된 아이마다 **이번 주 월~금, 수업이 몇 시에 시작하고 끝나는지**(사용자 2026-10-02).
 * 🔑 주는 등하원 화면과 같은 `weekDates`(주말에 열면 다음 주) · 판정은 순수 함수 `buildChildTimetable`
 *    (그 날짜에 수강 중 + 그 날짜에 유효한 배치 · 이어지는 교시는 한 줄).
 * 🔑 쉬는 날(법정공휴일 · 학원 휴원일)은 등하원 화면과 같은 판정으로 "학원이 쉬어요".
 * 🔑 모양은 격자 — 위에 월~금, 왼쪽에 시각, 수업은 그 시각 자리에 선다(`WeekGrid`).
 * 🔴 보기만 한다 — 강사·강의실·다른 아이 정보는 싣지 않는다.
 */
export default async function ParentClassesPage() {
  const viewer = await getParentViewer();
  if (!viewer) redirect("/home");
  if (!(await parentPortalAvailable(viewer))) return null;
  const today = kstToday();
  const week = weekDates(today);
  const [tables, academyHolidays] = await Promise.all([
    loadParentTimetables(viewer, viewer.children.map((c) => c.id), week),
    loadAcademyHolidays(viewer.tenantId),
  ]);

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-lg font-bold">수업 시간표</h1>
        <span className="text-text-dim text-xs">
          {formatKoreanDate(week[0]!.ymd).replace(/^\d{4}년 /, "")} ~ {formatKoreanDate(week[4]!.ymd).replace(/^\d{4}년 /, "")}
        </span>
      </div>

      {viewer.children.length === 0 ? (
        <p className="border-line text-text-dim rounded-2xl border border-dashed p-6 text-center text-sm">
          연결된 자녀가 없습니다. 학원에 문의해 주세요.
        </p>
      ) : tables === null ? (
        <p className="bg-card text-text-dim rounded-2xl p-6 text-center text-sm shadow-[var(--shadow-card)]">
          시간표를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.
        </p>
      ) : (
        viewer.children.map((c) => (
          <section key={c.id} className="bg-card rounded-2xl px-1.5 py-2 shadow-[var(--shadow-card)]">
            <h2 className="px-1.5 text-base font-bold">
              {c.name} <span className="text-text-dim text-sm font-medium">{c.schoolGrade}</span>
            </h2>
            <WeekGrid rows={tables.get(c.id) ?? []} today={today} restOf={(ymd) => restDayName(academyHolidays, ymd)} />
          </section>
        ))
      )}
    </>
  );
}

/**
 * 보이는 시간 범위 — **오후 2시 ~ 밤 9시** 고정(사용자 2026-10-02). 그 밖에 수업이 있으면 그만큼만 넓힌다(수업이 잘려 안 보이면 안 된다).
 * 한 시간의 높이는 화면 높이에 맞춰 최대로 — 위 고정 영역(약 15rem)을 뺀 높이를 시간 수로 나눈다(하한 3rem).
 * 칸 안 글자는 폰 폭에서 한 열이 65px 남짓이라 이 격자 한정으로 작게 쓴다.
 */
const VIEW_START_HOUR = 14;
const VIEW_END_HOUR = 21;
/** 수업 상자의 최소 높이 — 수업이 짧아도 시각 두 줄 · 과목 · 반 이름이 들어갈 만큼은 유지한다(사용자 2026-10-02). */
const BLOCK_MIN_H = "3.75rem";
const CELL_TEXT = { fontSize: 10, lineHeight: 1.25 } as const;
/**
 * 시각은 **오전/오후 12시간제**로 적는다 — 아이들이 보는 화면이라 16·17시는 헷갈린다(사용자 2026-10-02).
 * 눈금 = "오후 / 2시" 두 줄, 상자 = "4:20 ~ 6:10"(오전·오후는 눈금이 말한다).
 */
const meridiem = (h: number) => (h < 12 ? "오전" : "오후");
const hour12 = (h: number) => (h % 12 === 0 ? 12 : h % 12);
const clock12 = (hm: string) => `${hour12(Number(hm.slice(0, 2)))}:${hm.slice(3, 5)}`;
const minutesOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/**
 * 시간표 격자 — 위에 월~금, 왼쪽에 시각, 수업은 **그 시각 자리에 그 길이만큼** 선다(사용자 2026-10-02
 * *"월금을 위로 올리고 시간별로 … 그 시간에 맞는 내용"*). 세로 범위는 오후 2시 ~ 밤 9시(위 상수) — 수업이 없는 주에도 빈 격자를 그린다.
 */
function WeekGrid({ rows, today, restOf }: { rows: TimetableDayRow[]; today: string; restOf: (ymd: string) => string | null }) {
  const blocks = rows.flatMap((r) => r.blocks);
  const startHour = Math.min(VIEW_START_HOUR, ...blocks.map((b) => Math.floor(minutesOf(b.start) / 60)));
  const endHour = Math.max(VIEW_END_HOUR, ...blocks.map((b) => Math.ceil(minutesOf(b.end) / 60)));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  /** 시각 → 위에서부터의 거리(시간 단위 × 한 시간 높이). */
  const at = (h: number) => `calc(var(--hour) * ${h})`;
  const hoursFrom = (hm: string) => (minutesOf(hm) - startHour * 60) / 60;
  const colHeight = at(hours.length);
  const hourVar = { "--hour": `max(3rem, calc((100dvh - 15rem) / ${hours.length}))` } as CSSProperties;
  return (
    <div className="mt-1 grid grid-cols-[1.75rem_repeat(5,minmax(0,1fr))]" style={hourVar}>
      <span />
      {rows.map((r) => {
        const isToday = r.ymd === today;
        const rest = restOf(r.ymd);
        return (
          <div key={r.day} className={`pb-1 text-center ${rest ? "text-danger" : isToday ? "text-primary" : ""}`}>
            <p className="text-sm font-bold">{isToday ? "오늘" : dayLabel(r.day as DayCode)}</p>
            <p className="num" style={CELL_TEXT}>
              {Number(r.ymd.slice(5, 7))}/{Number(r.ymd.slice(8, 10))}
            </p>
          </div>
        );
      })}

      {/* 시각 눈금 — 오후 2시 … 오후 9시(맨 위·맨 아래도 적는다). 아래로 여유를 둔다(마지막 숫자가 잘리지 않게). */}
      <div className="relative mb-2" style={{ height: colHeight }}>
        {[...hours, endHour].map((h, i) => (
          <span
            key={h}
            className="text-text-dim absolute right-1 flex -translate-y-1/2 flex-col items-end"
            style={{ ...CELL_TEXT, lineHeight: 1.1, top: at(i) }}
          >
            <span>{meridiem(h)}</span>
            <b className="num text-foreground">{hour12(h)}시</b>
          </span>
        ))}
      </div>
      {rows.map((r) => {
        const rest = restOf(r.ymd);
        return (
          <div
            key={r.day}
            className={`border-line relative border-b border-l ${rest ? "bg-att-weekend" : ""}`}
            style={{ height: colHeight }}
          >
            {/* 정시 가로선 */}
            {hours.map((h, i) => (
              <span key={h} className="border-line absolute inset-x-0 border-t" style={{ top: at(i) }} />
            ))}
            {rest ? (
              <p className="text-danger absolute inset-x-0 top-1/2 -translate-y-1/2 px-0.5 text-center font-bold break-keep" style={CELL_TEXT}>
                학원이 쉬어요
                <br />
                {rest}
              </p>
            ) : (
              r.blocks.map((b) => (
                <div
                  key={`${b.classId}|${b.start}`}
                  className="bg-primary/10 border-primary absolute inset-x-0.5 overflow-hidden rounded-md border px-1 py-0.5 break-keep"
                  style={{ ...CELL_TEXT, top: at(hoursFrom(b.start)), height: `calc(${at(hoursFrom(b.end) - hoursFrom(b.start))} - 2px)`, minHeight: BLOCK_MIN_H }}
                >
                  <p className="num font-bold">{clock12(b.start)}</p>
                  <p className="num font-bold">~ {clock12(b.end)}</p>
                  {b.subjectLabel ? <p className="text-primary font-bold">{b.subjectLabel}</p> : null}
                  <p>{b.className}</p>
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}
