"use client";

import { Pill } from "@/components/atoms/pill";
import { WEEKDAY_KO, formatMdW, weekdayOf } from "../calendar";
import { dayDescription, dayStatusLabel } from "../day-schedule";
import type { DayView, WeekView } from "../derive";
import { weekdaySlots } from "../focus";
import { STATUS_LABEL, STATUS_PILL } from "../palette";
import { DetailRow } from "./detail-lists";
import { useProgressMap } from "./map-state";

/** 주간 — 월~일 일곱 줄(달 밖·기록 없는 날도 자리를 남긴다: 요일 위치가 흔들리지 않게). */
export function WeekList({ week }: { week: WeekView }) {
  const { focus, selectDay } = useProgressMap();
  return (
    <ul className="flex flex-col gap-0.5">
      {weekdaySlots(week).map((d, i) => {
        if (!d) {
          return (
            <li key={`empty-${i}`} className="text-text-dim grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 px-2 py-1.5 text-sm">
              <span className="font-medium">{WEEKDAY_KO[(i + 1) % 7]}</span>
              <span className="text-xs">이 달 밖</span>
            </li>
          );
        }
        const r = d.record;
        return (
          <DetailRow key={d.date} on={focus.day === d.date} onClick={() => selectDay(d.date)} label={`${formatMdW(d.date)} ${dayDescription(d)}`}>
            <span className={`${d.holidayName ? "text-danger" : d.noClassReason ? "text-neutral-fill" : "text-foreground"} num text-sm font-bold`}>
              {formatMdW(d.date)}
              {d.isToday ? <span className="text-primary ml-1 text-xs font-bold">오늘</span> : null}
            </span>
            <span className="text-foreground min-w-0 truncate text-sm font-medium">
              {d.noClassReason ? d.holidayName ?? d.noClassReason : r ? r.subChapter || r.chapter : "기록 없음"}
              {!d.noClassReason && d.holidayName ? <span className="text-danger ml-1.5 text-xs">{d.holidayName}</span> : null}
              {!d.noClassReason && r?.note ? <span className="text-text-dim ml-1.5 text-xs">{r.note}</span> : null}
            </span>
            <span className="num text-sm whitespace-nowrap">
              {r && d.plannedPages > 0 ? (
                <>
                  <span className="text-text-dim">p.{r.startPage}~{r.endPage}</span>{" "}
                  <span className="text-foreground font-bold">
                    {d.donePages} / {d.plannedPages}쪽
                  </span>
                </>
              ) : (
                <span className="text-text-dim">—</span>
              )}
            </span>
            <Pill color={d.noClassReason ? d.holidayName ? "danger" : "neutral" : STATUS_PILL[d.status]}>{dayStatusLabel(d)}</Pill>
          </DetailRow>
        );
      })}
    </ul>
  );
}

/** 일간 — 그날 학습 내용 한 장 + 앞·뒷날 이동. */
export function DayCard({ day, week }: { day: DayView; week: WeekView }) {
  const { progress, selectDay } = useProgressMap();
  const r = day.record;
  const all = progress.dailyProgress;
  const idx = all.findIndex((x) => x.date === day.date);
  const prev = idx > 0 ? all[idx - 1] : null;
  const next = idx >= 0 && idx < all.length - 1 ? all[idx + 1] : null;
  const nav = (
    <div className="flex items-center gap-2">
      <button type="button" disabled={!prev} onClick={() => prev && selectDay(prev.date)} className="text-primary text-xs font-bold disabled:opacity-40">
        ‹ {prev ? formatMdW(prev.date) : "이전"}
      </button>
      <span className="text-text-dim text-xs">·</span>
      <button type="button" disabled={!next} onClick={() => next && selectDay(next.date)} className="text-primary text-xs font-bold disabled:opacity-40">
        {next ? formatMdW(next.date) : "다음"} ›
      </button>
    </div>
  );
  if (!r || day.noClassReason) {
    return (
      <div className="flex flex-col gap-2">
        {day.holidayName ? <div><Pill color="danger">{day.holidayName}</Pill></div> : null}
        <p className="text-text-dim text-sm">
          {WEEKDAY_KO[weekdayOf(day.date)]}요일 · {day.noClassReason ? `수업이 없는 날입니다. (${day.noClassReason})` : `기록도 계획도 없는 날입니다. (${week.index}주)`}
        </p>
        {nav}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill color={STATUS_PILL[day.status]} size="md">
          {STATUS_LABEL[day.status]}
        </Pill>
        {day.holidayName ? <Pill color="danger" size="md">{day.holidayName}</Pill> : null}
        {day.isToday ? <span className="text-primary text-xs font-bold">오늘</span> : null}
        <span className="ml-auto">{nav}</span>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-text-dim font-medium">교재</dt>
        <dd className="text-foreground font-bold">{r.bookName}</dd>
        <dt className="text-text-dim font-medium">단원</dt>
        <dd className="text-foreground break-keep">
          <span className="font-bold">{r.chapter}</span>
          {r.subChapter ? <span className="text-text-dim"> › {r.subChapter}</span> : null}
        </dd>
        <dt className="text-text-dim font-medium">계획 쪽</dt>
        <dd className="text-foreground num">{day.plannedPages > 0 ? `p.${r.startPage}~${r.endPage} (${day.plannedPages}쪽)` : "새 쪽 없음"}</dd>
        <dt className="text-text-dim font-medium">완료 쪽</dt>
        <dd className="text-foreground num font-bold">
          {day.plannedPages > 0 ? (day.donePages > 0 ? `p.${r.completedPage} (${day.donePages} / ${day.plannedPages}쪽 · ${Math.round((day.donePages / day.plannedPages) * 100)}%)` : "아직 없음") : "—"}
        </dd>
        {r.note ? (
          <>
            <dt className="text-text-dim font-medium">메모</dt>
            <dd className="text-foreground">{r.note}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
