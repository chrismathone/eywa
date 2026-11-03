"use client";

import type { OverviewData } from "@/features/dashboard/overview/model";
import {
  studentsEnrolledHref,
  studentsUnenrolledHref,
  withdrawalsMonthHref,
} from "@/features/dashboard/overview/kpi-links";
import { countWithdrawalPrograms } from "@/features/withdrawals/window";
import { countedEarlierTitle, countedMonthLabel, exitBasisRule } from "@/features/withdrawals/exit-basis";
import { programLabel, visiblePrograms, type ProgramSubject } from "@/features/students/enrollment/program";
import { dashboardProgramColor, dashboardCombinationColor } from "@/features/dashboard/overview/subject-colors";
import { CountList, NameCell, PopupEmpty, PopupTotal, Tag, monthDay } from "./kpi-popup-parts";
import s from "./overview.module.css";

/** 재원생 팝업 — 프로그램별 인원(겹침) + 수강 없음. 숫자는 카드와 같은 `students` 영역 값. */
export function StudentsPopup({
  data,
  subjects,
  canOpen,
  eieOn = true,
}: {
  data: OverviewData["students"] | null | undefined;
  subjects: ProgramSubject[];
  canOpen: boolean;
  /** EiE 구분을 쓰는 학원인가(스냅샷 `eie`). 끄면 'EiE' 줄을 빼고 '인재원 영어'를 그 학원 영어 과목 이름으로. */
  eieOn?: boolean;
}) {
  if (!data) return <PopupEmpty>재원생 정보를 불러오지 못했습니다.</PopupEmpty>;
  const { programs } = data;
  return (
    <>
      <PopupTotal label="재원생" value={data.enrolled} unit="명" />
      <CountList
        rows={[
          ...visiblePrograms(eieOn).map((program) => ({
            key: program,
            label: programLabel(program, subjects, eieOn),
            value: programs[program],
            color: dashboardProgramColor(program),
            href: canOpen && programs[program] > 0 ? studentsEnrolledHref(program) : null,
          })),
          ...(programs.otherOnly > 0
            ? [{ key: "other", label: "그 외 과목만", value: programs.otherOnly }]
            : []),
          { key: "none", label: "미수강", value: programs.noEnrollment, note: "휴원 수강만 있는 학생 포함",
            href: canOpen && programs.noEnrollment > 0 ? studentsUnenrolledHref() : null },
        ]}
      />
      <p className={s.footnote}>
        한 학생이 여러 프로그램을 들으면 각 프로그램에 모두 셉니다 — 합계가 재원생 수보다 클 수 있습니다.
      </p>
    </>
  );
}

/** 퇴원·과목 전체 종료 팝업 — 유형별 인원 + 프로그램별 인원 + 명단. */
export function WithdrawalsPopup({
  data,
  subjects,
  canFilter,
  canOpenStudent,
  eieOn = true,
}: {
  data: OverviewData["withdrawals"] | null | undefined;
  subjects: ProgramSubject[];
  canFilter: boolean;
  canOpenStudent: boolean;
  eieOn?: boolean;
}) {
  if (!data) return <PopupEmpty>퇴원 정보를 불러오지 못했습니다.</PopupEmpty>;
  const counts = countWithdrawalPrograms(data.rows);
  const endedCount = data.rows.filter(row => row.kind === "subject-ended").length;
  const monthNo = Number(data.month.slice(5));
  const carried = data.carried ?? [];
  // 한 줄 — 이름 · 퇴원/수강종료 · 학년·프로그램 · 날짜(퇴원일·종료일). '앞 달로 센' 줄은 날짜 뒤에 센 달을 붙인다.
  const row = (r: (typeof data.rows)[number], counted?: string) => (
    <li key={r.eventKey ?? r.id} className={s.kpiListRow}>
      <NameCell href={canOpenStudent ? `/students/${r.id}` : null} title={r.name} ariaLabel={`${r.name} 원생 상세`}>
        {r.name}
      </NameCell>
      <Tag tone={r.kind === "subject-ended" ? "info" : "caution"}>{r.kind === "subject-ended" ? "수강종료" : "퇴원"}</Tag>
      <span className={s.kpiListMeta} title={r.className} style={r.program ? { color: dashboardProgramColor(r.program) } : undefined}>
        {[r.schoolGrade, r.program ? programLabel(r.program, subjects, eieOn) : null].filter(Boolean).join(" · ")}
      </span>
      <time dateTime={r.withdrawnAt}>{monthDay(r.withdrawnAt)}{counted ? ` ${r.kind === "subject-ended" ? "종료" : "퇴원"} · ${counted}` : ""}</time>
    </li>
  );
  return (
    <>
      <PopupTotal label={`${monthNo}월로 센 퇴원&수업종료`} value={counts.total} unit="명" />
      <p className={s.popupSummary}>퇴원 {counts.total - endedCount}명 · 수강종료 {endedCount}명</p>
      {/* 원장 2026-11-03 — 11월 1일에 처리한 4건이 10월분까지만 내 10월로 세져 '0명'이 오류처럼 보였다. 기준을 숫자 바로 아래에 적는다. */}
      <p className={s.popupSummary}>{exitBasisRule(data.month)}</p>
      <CountList
        rows={[
          ...visiblePrograms(eieOn).map((program) => ({
            key: program,
            label: programLabel(program, subjects, eieOn),
            value: counts[program],
            color: dashboardProgramColor(program),
            href: canFilter && counts[program] > 0 ? withdrawalsMonthHref(data.month, program) : null,
          })),
          ...(counts.other > 0 ? [{ key: "other", label: "기타·미상", value: counts.other }] : []),
        ]}
      />
      {data.rows.length === 0 ? (
        <PopupEmpty>{monthNo}월로 센 퇴원·수업종료 학생이 없습니다.</PopupEmpty>
      ) : (
        <ul className={s.kpiList}>{data.rows.map((r) => row(r))}</ul>
      )}
      {carried.length > 0 ? (
        <>
          <p className={s.popupGroup}>{countedEarlierTitle(data.month, carried.length, "명")} — 위 숫자에 들지 않습니다</p>
          <ul className={s.kpiList}>{carried.map((r) => row(r, countedMonthLabel(r.countMonth)))}</ul>
        </>
      ) : null}
      <p className={s.footnote}>과목 수업을 모두 종료한 학생 포함 · 반이동·특강 종료·퇴원일 미상 제외 · 여러 과목을 함께 종료하면 과목마다 1명씩 셉니다.</p>
    </>
  );
}

/** 오늘첫수업 팝업 — 첫 등원 / 처음 듣는 과목(다니던 학생이 처음 듣는 과목 묶음 · 2026-10-21 '새 과목'에서 이름만 바꿈 — 원장 *"새 과목은 뭐야? 알아들을 수 없음"*). */
export function FirstClassPopup({
  rows,
  subjectLabels,
  canOpen,
}: {
  rows: OverviewData["firstClass"] | null | undefined;
  subjectLabels: Record<string, string>;
  canOpen: boolean;
}) {
  if (!rows) return <PopupEmpty>첫 수업 정보를 불러오지 못했습니다.</PopupEmpty>;
  const first = rows.filter((row) => row.kind === "first").length;
  return (
    <>
      <PopupTotal label="오늘 첫 수업" value={rows.length} unit="명" />
      <p className={s.popupSummary}>
        첫 등원 {first}명 · 처음 듣는 과목 {rows.length - first}명
      </p>
      {rows.length === 0 ? (
        <PopupEmpty>오늘 첫 수업 학생이 없습니다.</PopupEmpty>
      ) : (
        <ul className={s.kpiList}>
          {rows.map((row) => (
            <li key={row.studentId} className={s.kpiListRow}>
              <NameCell
                href={canOpen ? `/students/${row.studentId}` : null}
                title={row.name}
                ariaLabel={`${row.name} 원생 상세`}
              >
                {row.name}
              </NameCell>
              <span className={s.kpiListMeta} style={{ color: dashboardCombinationColor(row.subjects, subjectLabels) }}>
                {row.subjects.map((key) => subjectLabels[key] ?? "기타 과목").join(" · ")}
              </span>
              <Tag tone={row.kind === "first" ? "info" : "muted"}>
                {row.kind === "first" ? "첫 등원" : "처음 듣는 과목"}
              </Tag>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
