"use client";

import type { OverviewData } from "@/features/dashboard/overview/model";
import {
  studentsEnrolledHref,
  withdrawalsMonthHref,
} from "@/features/dashboard/overview/kpi-links";
import { countWithdrawalPrograms } from "@/features/withdrawals/window";
import { PROGRAMS, programLabel, type ProgramSubject } from "@/features/students/program";
import { CountList, NameCell, PopupEmpty, PopupTotal, Tag, monthDay } from "./kpi-popup-parts";
import s from "./overview.module.css";

/** 재원생 팝업 — 프로그램별 인원(겹침) + 수강 없음. 숫자는 카드와 같은 `students` 영역 값. */
export function StudentsPopup({
  data,
  subjects,
  canOpen,
}: {
  data: OverviewData["students"] | null | undefined;
  subjects: ProgramSubject[];
  canOpen: boolean;
}) {
  if (!data) return <PopupEmpty>재원생 정보를 불러오지 못했습니다.</PopupEmpty>;
  const { programs } = data;
  return (
    <>
      <PopupTotal label="재원생" value={data.enrolled} unit="명" />
      <CountList
        rows={[
          ...PROGRAMS.map((program) => ({
            key: program,
            label: programLabel(program, subjects),
            value: programs[program],
            href: canOpen && programs[program] > 0 ? studentsEnrolledHref(program) : null,
          })),
          ...(programs.otherOnly > 0
            ? [{ key: "other", label: "그 외 과목만", value: programs.otherOnly }]
            : []),
          { key: "none", label: "수강 없음", value: programs.noEnrollment, note: "휴원 수강만 있는 학생 포함" },
        ]}
      />
      <p className={s.footnote}>
        한 학생이 여러 프로그램을 들으면 각 프로그램에 모두 셉니다 — 합계가 재원생 수보다 클 수 있습니다.
      </p>
    </>
  );
}

/** 퇴원생 팝업 — 프로그램별 인원(합 = 퇴원생 수) + 명단. */
export function WithdrawalsPopup({
  data,
  subjects,
  canFilter,
  canOpenStudent,
}: {
  data: OverviewData["withdrawals"] | null | undefined;
  subjects: ProgramSubject[];
  canFilter: boolean;
  canOpenStudent: boolean;
}) {
  if (!data) return <PopupEmpty>퇴원 정보를 불러오지 못했습니다.</PopupEmpty>;
  const counts = countWithdrawalPrograms(data.rows);
  return (
    <>
      <PopupTotal label={`${Number(data.month.slice(5))}월 퇴원생`} value={counts.total} unit="명" />
      <CountList
        rows={[
          ...PROGRAMS.map((program) => ({
            key: program,
            label: programLabel(program, subjects),
            value: counts[program],
            href: canFilter && counts[program] > 0 ? withdrawalsMonthHref(data.month, program) : null,
          })),
          ...(counts.other > 0 ? [{ key: "other", label: "기타·미상", value: counts.other }] : []),
        ]}
      />
      {data.rows.length === 0 ? (
        <PopupEmpty>이번 달 퇴원생이 없습니다.</PopupEmpty>
      ) : (
        <ul className={s.kpiList}>
          {data.rows.map((row) => (
            <li key={row.id} className={s.kpiListRow}>
              <NameCell
                href={canOpenStudent ? `/students/${row.id}` : null}
                title={row.name}
                ariaLabel={`${row.name} 원생 상세`}
              >
                {row.name}
              </NameCell>
              <span className={s.kpiListMeta}>
                {[row.schoolGrade, row.program ? programLabel(row.program, subjects) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <time dateTime={row.withdrawnAt}>{monthDay(row.withdrawnAt)}</time>
            </li>
          ))}
        </ul>
      )}
      <p className={s.footnote}>프로그램은 마지막 수강 반 기준 · 시스템 정리(퇴원일 미상)는 제외합니다.</p>
    </>
  );
}

/** 오늘첫수업 팝업 — 첫 등원 / 새 과목. */
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
        첫 등원 {first}명 · 새 과목 {rows.length - first}명
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
              <span className={s.kpiListMeta}>
                {row.subjects.map((key) => subjectLabels[key] ?? "기타 과목").join(" · ")}
              </span>
              <Tag tone={row.kind === "first" ? "info" : "muted"}>
                {row.kind === "first" ? "첫 등원" : "새 과목"}
              </Tag>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
