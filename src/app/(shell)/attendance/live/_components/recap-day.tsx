"use client";

/**
 * 요약 탭의 **하루 블록** — 금·토·일을 한 화면에 놓되 날짜를 뭉개지 않는다
 * (원장 2026-08-19 *"내용도 금토 구분해서 정리하고"*). "언제 빠졌나"가 사라지면 전화할 때 할 말이 없다.
 */
import type { ReactNode } from "react";
import { formatKoreanDate } from "@/lib/date-kst";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { ATT_SOFT } from "@/features/attendance/status-color";
import { OUTCOME_LABEL } from "@/features/attendance/live/queue";
import {
  handlersLabel,
  RECAP_STATUS_LABEL,
  slotsLabel,
  type RecapEvent,
  type RecapUnmarkedClass,
} from "@/features/attendance/recap/digest";
import type { RecapDay } from "@/features/attendance/recap/range";

export function RecapDayBlock({ day, single }: { day: RecapDay; single: boolean }) {
  const t = day.totals;
  return (
    <section className="space-y-3">
      {/* 하루짜리 요약에도 날짜를 적는다 — 페이지 제목은 "오늘 출결"이라 여기가 유일한 근거다. */}
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className={`font-bold ${single ? "text-[15px]" : "text-base"}`}>{formatKoreanDate(day.date)}</h2>
        {day.holiday ? (
          <span className="text-text-faint text-xs">휴원일 · {day.holiday}</span>
        ) : (
          <span className="num text-text-faint text-xs">
            {t.slots}교시 · 결석 {t.absent + t.excused} · 지각 {t.late} · 입력 {t.recorded}/{t.cells}칸
          </span>
        )}
      </header>

      {/* 🔑 사흘치를 한 화면에 놓을 땐 **빈 레인을 접는다** — "결석 없음" 카드가 날짜마다 3장씩
          쌓이면 정작 결석이 있는 줄이 묻힌다. 그 사실은 바로 위 머리줄의 숫자가 이미 말한다.
          하루짜리 요약에선 그대로 둔다(빈 화면이 고장으로 읽히면 안 된다). */}
      <Lane
        title="결석·공결"
        count={day.absences.length}
        tone="danger"
        empty="결석 기록이 없습니다."
        hint="조치가 끝나지 않은 건이 위로 옵니다."
        hideWhenEmpty={!single}
      >
        {day.absences.map((e) => (
          <EventRow key={`${e.studentId}@${e.classId}@${e.status}`} event={e} />
        ))}
      </Lane>

      <Lane
        title="지각·조퇴·보강"
        count={day.others.length}
        empty="지각·조퇴·보강 기록이 없습니다."
        hideWhenEmpty={!single}
      >
        {day.others.map((e) => (
          <EventRow key={`${e.studentId}@${e.classId}@${e.status}`} event={e} />
        ))}
      </Lane>

      <Lane
        title="출석부 미입력"
        count={day.unmarked.length}
        empty="모든 반이 출결을 입력했습니다."
        hint="반 이름을 누르면 그날 출석부가 열립니다."
        hideWhenEmpty={!single}
      >
        {day.unmarked.map((c) => (
          <UnmarkedRow key={c.classId} row={c} date={day.date} />
        ))}
      </Lane>
    </section>
  );
}

function Lane({
  title,
  count,
  tone,
  empty,
  hint,
  hideWhenEmpty,
  children,
}: {
  title: string;
  count: number;
  tone?: "danger";
  empty: string;
  hint?: string;
  hideWhenEmpty?: boolean;
  children: ReactNode;
}) {
  if (count === 0 && hideWhenEmpty) return null;
  return (
    <section className="space-y-2">
      <h3 className="flex items-baseline gap-2">
        <span className="text-sm font-bold">{title}</span>
        <span className={`num text-sm ${tone === "danger" && count > 0 ? "text-danger" : "text-text-dim"}`}>
          {count}
        </span>
        {hint && count > 0 ? <span className="text-text-faint text-[11px]">{hint}</span> : null}
      </h3>
      {count === 0 ? (
        <p className="bg-card shadow-card text-text-faint rounded-2xl px-3 py-3 text-[13px]">{empty}</p>
      ) : (
        <ul className="bg-card shadow-card divide-line divide-y rounded-2xl">{children}</ul>
      )}
    </section>
  );
}

function EventRow({ event }: { event: RecapEvent }) {
  const subjects = useSubjectMaps();
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
      <span className={`${ATT_SOFT[event.status]} shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold`}>
        {RECAP_STATUS_LABEL[event.status]}
      </span>
      <span className="font-bold">{event.studentName}</span>
      {event.schoolGrade ? <span className="text-text-faint text-[11px]">{event.schoolGrade}</span> : null}
      <span className="text-text-dim text-xs">
        {event.className}
        <span className="text-text-faint"> · {subjects.labelOf(event.subject) || "과목 없음"}</span>
      </span>
      <span className="num text-text-dim text-xs">{slotsLabel(event.slots)}</span>
      {/* 담당이 교시마다 다르면 전부 적는다 — 첫 교시 담당만 두면 엉뚱한 강사에게 묻게 된다. */}
      <span className="text-text-faint text-xs">{handlersLabel(event.teacherNames)}</span>
      {event.recentAbsences && event.recentAbsences >= 2 ? (
        // 창은 '지금 기준' 14일이다(0220a) — 요약 날짜가 오래됐어도 이 값은 오늘 기준이라 라벨로 밝힌다.
        <span className="bg-danger-soft text-danger num shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold">
          최근 14일 {event.recentAbsences}회
        </span>
      ) : null}
      {event.note ? <span className="text-text-dim text-xs">“{event.note}”</span> : null}
      <span className="ml-auto shrink-0 text-xs">
        {event.settled ? (
          <span className="text-text-faint">
            {event.followup?.state === "dismissed"
              ? "해당 없음"
              : event.followup?.outcome
                ? (OUTCOME_LABEL[event.followup.outcome] ?? "확인")
                : "확인"}
            {event.followup?.handledByName ? ` · ${event.followup.handledByName}` : ""}
          </span>
        ) : event.status === "absent" || event.status === "excused" ? (
          <span className="text-amber-strong font-bold">조치 미완료</span>
        ) : null}
      </span>
    </li>
  );
}

/**
 * 미입력 출석부 한 줄 — 반 이름이 **그날 출석부 링크**다.
 * 🔑 "입력이 덜 된 강사" 줄을 펼쳤을 때도 **이 컴포넌트 그대로** 쓴다(같은 정보·같은 링크 규약).
 *    별도 표기를 만들면 두 자리가 조용히 갈린다.
 */
export function UnmarkedRow({ row, date }: { row: RecapUnmarkedClass; date: string }) {
  const subjects = useSubjectMaps();
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
      <a
        href={`/attendance/${date}/${row.classId}`}
        className="hover:text-primary font-bold underline-offset-2 hover:underline"
      >
        {row.className}
      </a>
      <span className="text-text-faint text-xs">{subjects.labelOf(row.subject) || "과목 없음"}</span>
      <span className="num text-text-dim text-xs">{slotsLabel(row.slots)}</span>
      <span className="text-text-faint text-xs">{handlersLabel(row.teacherNames)}</span>
      <span className="num text-text-dim ml-auto shrink-0 text-xs">학생 {row.expected}명</span>
    </li>
  );
}
