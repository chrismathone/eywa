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
  isRepeatAbsenceDanger,
  RECAP_STATUS_LABEL,
  REPEAT_ABSENCE_MIN,
  slotsLabel,
  type RecapEvent,
  type RecapPartialClass,
  type RecapUnmarkedClass,
} from "@/features/attendance/recap/digest";
import { ABSENCE_REASON_LABEL } from "@/features/attendance/absence-reason";
import {
  isSubjectFilterActive,
  matchesSubjectFilter,
  SUBJECT_FILTER_ALL,
} from "@/features/attendance/live/view-prefs";
import type { RecapDay } from "@/features/attendance/recap/range";

export function RecapDayBlock({
  day,
  single,
  /** 과목 필터(2026-08-20). 좁히는 축은 이 화면의 단위인 **사건 줄**이다. */
  subject = SUBJECT_FILTER_ALL,
}: {
  day: RecapDay;
  single: boolean;
  subject?: string;
}) {
  const t = day.totals;
  const filtering = isSubjectFilterActive(subject);
  // 🔴 머리줄 숫자(`t.*`)는 **하루 전체 기준 그대로**다 — 레인만 좁히고 분모는 안 건드린다.
  const absences = day.absences.filter((e) => matchesSubjectFilter(subject, e.subject));
  const others = day.others.filter((e) => matchesSubjectFilter(subject, e.subject));
  const unmarked = day.unmarked.filter((c) => matchesSubjectFilter(subject, c.subject));
  // 사유가 확인돼 아래로 내려간 건수 — 레인 힌트가 "왜 순서가 이런지"를 말한다.
  const notified = absences.filter((e) => !e.settled && !e.urgent).length;
  return (
    <section className="space-y-3">
      {/* 하루짜리 요약에도 날짜를 적는다 — 페이지 제목은 "오늘 출결"이라 여기가 유일한 근거다. */}
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className={`font-bold ${single ? "text-base" : "text-base"}`}>{formatKoreanDate(day.date)}</h2>
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
        count={absences.length}
        hidden={day.absences.length - absences.length}
        tone="danger"
        empty={filtering ? "이 과목에는 결석 기록이 없습니다." : "결석 기록이 없습니다."}
        // 사전 통보(여행·휴가·병결)는 **빠지는 게 아니라 아래로 간다** — 그 사실을 힌트가 말한다.
        hint={
          notified > 0
            ? `조치가 끝나지 않은 건이 위로 옵니다 · 사유가 확인된 건(여행·휴가·병결) ${notified}건은 아래로`
            : "조치가 끝나지 않은 건이 위로 옵니다."
        }
        hideWhenEmpty={!single}
      >
        {absences.map((e) => (
          <EventRow key={`${e.studentId}@${e.classId}@${e.status}`} event={e} />
        ))}
      </Lane>

      <Lane
        title="지각·조퇴·보강"
        count={others.length}
        hidden={day.others.length - others.length}
        empty={filtering ? "이 과목에는 지각·조퇴·보강 기록이 없습니다." : "지각·조퇴·보강 기록이 없습니다."}
        hideWhenEmpty={!single}
      >
        {others.map((e) => (
          <EventRow key={`${e.studentId}@${e.classId}@${e.status}`} event={e} />
        ))}
      </Lane>

      <Lane
        title="출석부 미입력"
        count={unmarked.length}
        hidden={day.unmarked.length - unmarked.length}
        empty={filtering ? "이 과목은 모든 반이 출결을 입력했습니다." : "모든 반이 출결을 입력했습니다."}
        hint="반 이름을 누르면 그날 출석부가 열립니다."
        hideWhenEmpty={!single}
      >
        {unmarked.map((c) => (
          <UnmarkedRow key={c.classId} row={c} date={day.date} />
        ))}
      </Lane>
    </section>
  );
}

function Lane({
  title,
  count,
  /** 과목 필터로 안 그린 줄 수 — 0이 아니면 **감췄다는 사실을 적는다**(조용히 사라지면 안 된다). */
  hidden = 0,
  tone,
  empty,
  hint,
  hideWhenEmpty,
  children,
}: {
  title: string;
  count: number;
  hidden?: number;
  tone?: "danger";
  empty: string;
  hint?: string;
  hideWhenEmpty?: boolean;
  children: ReactNode;
}) {
  if (count === 0 && hidden === 0 && hideWhenEmpty) return null;
  return (
    <section className="space-y-2">
      <h3 className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-bold">{title}</span>
        <span className={`num text-sm ${tone === "danger" && count > 0 ? "text-danger" : "text-text-dim"}`}>
          {count}
        </span>
        {hidden > 0 ? (
          <span className="num text-text-faint text-xs">과목 필터로 {hidden}건 숨김</span>
        ) : null}
        {hint && count > 0 ? <span className="text-text-faint text-xs">{hint}</span> : null}
      </h3>
      {count === 0 ? (
        <p className="bg-card shadow-card text-text-faint rounded-2xl px-3 py-3 text-sm">{empty}</p>
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
      <span className={`${ATT_SOFT[event.status]} shrink-0 rounded-full px-2 py-0.5 text-xs font-bold`}>
        {RECAP_STATUS_LABEL[event.status]}
      </span>
      <span className="font-bold">{event.studentName}</span>
      {event.schoolGrade ? <span className="text-text-faint text-xs">{event.schoolGrade}</span> : null}
      <span className="text-text-dim text-xs">
        {event.className}
        <span className="text-text-faint"> · {subjects.labelOf(event.subject) || "과목 없음"}</span>
      </span>
      <span className="num text-text-dim text-xs">{slotsLabel(event.slots)}</span>
      {/* 담당이 교시마다 다르면 전부 적는다 — 첫 교시 담당만 두면 엉뚱한 강사에게 묻게 된다. */}
      <span className="text-text-faint text-xs">{handlersLabel(event.teacherNames)}</span>
      {event.recentAbsences && event.recentAbsences >= REPEAT_ABSENCE_MIN ? (
        // 창은 '지금 기준' 14일이다(0220a) — 요약 날짜가 오래됐어도 이 값은 오늘 기준이라 라벨로 밝힌다.
        // 🔴 사전 통보를 뺀 나머지가 문턱 미만이면 **톤만** 내린다(숫자는 그대로 — 감추면 다음 사람이
        //    같은 판단을 다시 할 수 없다).
        <span
          className={`num shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
            isRepeatAbsenceDanger(event.recentAbsences, event.recentPlanned)
              ? "bg-danger-soft text-danger"
              : "bg-bg-soft text-text-dim"
          }`}
          title={
            event.recentPlanned && event.recentPlanned > 0
              ? `최근 14일(오늘 기준) 결석 ${event.recentAbsences}회 중 ${event.recentPlanned}회는 미리 통보된 결석입니다`
              : "최근 14일(오늘 기준) 결석 횟수입니다"
          }
        >
          최근 14일 {event.recentAbsences}회
          {event.recentPlanned && event.recentPlanned > 0
            ? ` (사전 통보 ${event.recentPlanned}회)`
            : ""}
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
        ) : event.urgent ? (
          // 🔴 앰버는 **긴급만** 쓴다(원장 2026-08-20) — 여행·휴가 줄까지 세워 두면 연락이 안 된 결석이
          //    그 사이에 묻힌다. 실측 결석 메모 311건 중 272건이 사전 통보였다.
          <span className="text-amber font-bold">조치 미완료</span>
        ) : (event.status === "absent" || event.status === "excused") &&
          event.reasonKind !== "unknown" ? (
          // 사유가 확인된 미조치 — 줄은 남기고 색만 물러난다(빼면 "그날 결석이 몇이었나"가 깨진다).
          <span className="text-text-faint">{ABSENCE_REASON_LABEL[event.reasonKind]}</span>
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

/**
 * **빈 칸이 남은 출석부** 한 줄 — 출석부는 열렸는데 학생 몇 명이 안 찍힌 반
 * (원장 제보 2026-08-20: *"누가 입력안되었는지 체크가 안돼"*).
 *
 * 🔑 링크 규약은 `UnmarkedRow`와 **같다**(`/attendance/{날짜}/{반id}`) — 두 줄이 같은 곳으로 가야
 *    "여기서 찍으면 된다"가 한 가지 뜻으로 읽힌다.
 * ⚠️ 이름이 10명을 넘는 교시가 실재한다 — 접히게 두고(`flex-wrap`) 이름은 어절로 안 쪼갠다(`break-keep`).
 */
export function PartialRow({ row, date }: { row: RecapPartialClass; date: string }) {
  const subjects = useSubjectMaps();
  return (
    <li className="space-y-1 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <a
          href={`/attendance/${date}/${row.classId}`}
          className="hover:text-primary font-bold underline-offset-2 hover:underline"
        >
          {row.className}
        </a>
        <span className="text-text-faint text-xs">{subjects.labelOf(row.subject) || "과목 없음"}</span>
        <span className="text-text-faint text-xs">{handlersLabel(row.teacherNames)}</span>
        <span className="num text-amber ml-auto shrink-0 text-xs font-bold">
          빈 칸 {row.cells}개
        </span>
      </div>
      {/* 교시마다 누가 남았는지 — 이 줄이 이번 변경의 목적이다(반 이름만으론 확인이 안 됐다). */}
      <ul className="space-y-0.5">
        {row.slots.map((s) => (
          <li key={s.start} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="num text-text-dim shrink-0 text-xs">{s.start} —</span>
            <span className="text-text-dim text-xs break-keep">
              {s.students.map((x) => x.studentName).join(", ")}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}
