"use client";

/**
 * 어제 출결 요약(관리자용) — **결정론 집계만** 그린다. AI 정리 카드는 그 위에 얹히는 부가물이라
 * 없거나 실패해도 이 화면은 온전하다(원장 2026-08-19: *"팩트만을 가지고"*).
 *
 * 화면 순서 = 관리자가 손댈 순서다: ① 오늘 처리할 것(조치 안 끝난 결석) ② 그 밖의 출결 사건
 * ③ 아예 안 열린 출석부(강사에게 요청) ④ 강사별 입력. 숫자만 크게 띄우고 명단을 접지 않는다 —
 * "결석 18건"만 보이고 누구인지 다음 화면에 있으면 결국 아무도 안 본다.
 */
import type { ReactNode } from "react";
import { EmptyState } from "@/components/empty-state";
import { BigStat } from "@/components/atoms/big-stat";
import { CalendarDays } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { ATT_SOFT } from "@/features/attendance/status-color";
import { OUTCOME_LABEL } from "@/features/attendance/live/queue";
import {
  RECAP_STATUS_LABEL,
  slotsLabel,
  type DayRecap,
  type RecapEvent,
} from "@/features/attendance/recap/digest";
import { RecapAiCard, type RecapAiState } from "./recap-ai-card";

export function RecapView({
  recap,
  date,
  isToday,
  ai,
}: {
  recap: DayRecap;
  date: string;
  /** 오늘을 요약하면 아직 끝나지 않은 하루다 — 숫자가 확정이 아님을 화면이 먼저 말한다. */
  isToday: boolean;
  ai: RecapAiState;
}) {
  const t = recap.totals;
  const absentTotal = t.absent + t.excused;
  const otherTotal = t.late + t.earlyLeave + t.makeup;

  if (t.slots === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="그날은 수업이 없습니다"
        description="시간표에 열린 교시가 없어 요약할 출결이 없습니다."
      />
    );
  }

  return (
    <div className="space-y-5">
      {isToday ? (
        <p className="bg-amber-soft text-amber-strong rounded-2xl px-3 py-2 text-[13px] font-medium">
          오늘은 아직 진행 중입니다 — 아래 숫자는 지금까지 입력된 것까지입니다.
        </p>
      ) : null}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <BigStat
          label="결석·공결"
          value={absentTotal}
          unit="건"
          tone={t.absentPending > 0 ? "danger" : "green"}
          icon={<EyIcon name="userX" size={16} />}
          valueClass={absentTotal > 0 ? "text-danger" : undefined}
          sub={t.absentPending > 0 ? `조치 미완료 ${t.absentPending}건` : "모두 확인 완료"}
        />
        <BigStat
          label="지각·조퇴·보강"
          value={otherTotal}
          unit="건"
          tone="amber"
          icon={<EyIcon name="clock" size={16} />}
          sub={`지각 ${t.late} · 조퇴 ${t.earlyLeave} · 보강 ${t.makeup}`}
        />
        <BigStat
          label="출석부 미입력"
          value={t.unmarkedClasses}
          unit="반"
          tone={t.unmarkedClasses > 0 ? "amber" : "green"}
          icon={<EyIcon name="clipboardList" size={16} />}
          sub={t.unmarkedClasses > 0 ? `학생 ${t.unmarkedStudents}명이 기록 없음` : "전 반 입력 완료"}
        />
        {/* ⚠️ 기록이 0건이면 "0%"는 사실이 아니다 — 입력률이 0인 게 아니라 아무도 안 찍은 것이다
            (월간 출석부 LiveStats와 같은 규약). */}
        <BigStat
          label="출결 입력"
          value={t.inputRate ?? "—"}
          unit={t.inputRate == null ? "기록 없음" : "%"}
          tone={t.inputRate != null && t.inputRate >= 90 ? "green" : "amber"}
          icon={<EyIcon name="percent" size={16} />}
          sub={`${t.cells}칸 중 ${t.recorded}칸 · 반 ${t.classes}개 ${t.slots}교시`}
        />
      </section>

      <RecapAiCard date={date} state={ai} />

      <Section
        title="결석·공결"
        count={recap.absences.length}
        tone="danger"
        empty="어제 결석은 없었습니다."
        hint="조치가 끝나지 않은 건이 위로 옵니다."
      >
        {recap.absences.map((e) => (
          <EventRow key={`${e.studentId}@${e.classId}@${e.status}`} event={e} />
        ))}
      </Section>

      <Section title="지각·조퇴·보강" count={recap.others.length} empty="지각·조퇴·보강 기록이 없습니다.">
        {recap.others.map((e) => (
          <EventRow key={`${e.studentId}@${e.classId}@${e.status}`} event={e} />
        ))}
      </Section>

      <Section
        title="출석부 미입력"
        count={recap.unmarked.length}
        empty="모든 반이 출결을 입력했습니다."
        hint="반 이름을 누르면 그날 출석부가 열립니다."
      >
        {recap.unmarked.map((c) => (
          <UnmarkedRow key={c.classId} row={c} date={date} />
        ))}
      </Section>

      <TeacherLines recap={recap} />
    </div>
  );
}

function Section({
  title,
  count,
  tone,
  empty,
  hint,
  children,
}: {
  title: string;
  count: number;
  tone?: "danger";
  empty: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-baseline gap-2">
        <span className="text-sm font-bold">{title}</span>
        <span className={`num text-sm ${tone === "danger" && count > 0 ? "text-danger" : "text-text-dim"}`}>
          {count}
        </span>
        {hint && count > 0 ? <span className="text-text-faint text-[11px]">{hint}</span> : null}
      </h2>
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
      <span className="text-text-faint text-xs">{event.teacherName}</span>
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

function UnmarkedRow({ row, date }: { row: DayRecap["unmarked"][number]; date: string }) {
  const subjects = useSubjectMaps();
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
      <a href={`/attendance/${date}/${row.classId}`} className="hover:text-primary font-bold underline-offset-2 hover:underline">
        {row.className}
      </a>
      <span className="text-text-faint text-xs">{subjects.labelOf(row.subject) || "과목 없음"}</span>
      <span className="num text-text-dim text-xs">{slotsLabel(row.slots)}</span>
      <span className="text-text-faint text-xs">{row.slotTeacherLabel ?? row.teacherName}</span>
      <span className="num text-text-dim ml-auto shrink-0 text-xs">학생 {row.expected}명</span>
    </li>
  );
}

/** 강사별 입력 — **덜 찍은 사람만** 보인다. 다 찍은 사람 줄까지 세우면 조치할 줄이 묻힌다. */
function TeacherLines({ recap }: { recap: DayRecap }) {
  const behind = recap.teachers.filter((t) => t.cells > 0 && t.recorded < t.cells);
  if (behind.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="flex items-baseline gap-2">
        <span className="text-sm font-bold">입력이 덜 된 강사</span>
        <span className="num text-text-dim text-sm">{behind.length}</span>
      </h2>
      <ul className="bg-card shadow-card divide-line divide-y rounded-2xl">
        {behind.map((t) => (
          <li key={t.teacherName} className="flex items-center gap-x-2 px-3 py-2 text-sm">
            <span className="font-bold">{t.teacherName}</span>
            <span className="num text-text-dim ml-auto text-xs">
              {t.cells}칸 중 {t.recorded}칸
            </span>
            {t.unmarkedClasses > 0 ? (
              <span className="num text-amber-strong shrink-0 text-xs font-bold">
                미입력 {t.unmarkedClasses}반
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
