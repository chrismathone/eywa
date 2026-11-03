"use client";

import type { OverviewData } from "@/features/dashboard/overview/model";
import {
  studentsEnrolledHref,
  studentsUnenrolledHref,
  withdrawalsMonthHref,
} from "@/features/dashboard/overview/kpi-links";
import { countWithdrawalPrograms } from "@/features/withdrawals/window";
import { EXIT_REPORT_RULE, countedEarlierTitle, countedMonthLabel, exitBasisRule, exitReportTitle } from "@/features/withdrawals/exit-basis";
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

/** 2단으로 펼 만큼 긴 명단인가 — 6줄부터. 카드(`popupWide`)와 팝업(2단 틀)이 같은 판정을 쓴다. */
export function withdrawalsPopupWide(data: OverviewData["withdrawals"] | null | undefined): boolean {
  return (data?.rows.length ?? 0) >= 6 || (data?.carried?.length ?? 0) >= 6;
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
  const title = exitReportTitle(data.month);
  const carried = data.carried ?? [];
  // 명단 = 열 맞춘 표(원장 2026-11-03 *"반까지 표시하고 열정렬해서 깔끔하게"*) · 길면 2단(*"스크롤 길게 하지말고 2단으로"*) — 앞 절반 왼쪽, 뒤 절반 오른쪽.
  // 2단이면 두 명단 모두 같은 틀에서 반씩 나눈다(1줄짜리는 왼쪽 단만) — 섹션마다 열 위치가 같다. 팝업이 좁으면 CSS가 1단으로 접는다.
  const split = withdrawalsPopupWide(data);
  const table = (rows: readonly ((typeof data.rows)[number] & { countMonth?: string })[], counted: boolean) => (
    <ul className={counted ? `${s.exitTable} ${s.exitTableCounted}` : s.exitTable}>
      <li className={s.exitHead} aria-hidden="true">
        <span>이름</span><span>구분</span><span>학교·학년</span><span>과목</span><span>반</span><span>마지막 수업일</span>
        {counted ? <span>센 달</span> : null}
      </li>
      {rows.map((r) => (
        <li key={r.eventKey ?? r.id} className={s.exitRow}>
          <NameCell href={canOpenStudent ? `/students/${r.id}` : null} title={r.name} ariaLabel={`${r.name} 원생 상세`}>
            {r.name}
          </NameCell>
          <span><Tag tone={r.kind === "subject-ended" ? "info" : "caution"}>{r.kind === "subject-ended" ? "수강종료" : "퇴원"}</Tag></span>
          <span className={s.exitCell} title={r.schoolGrade ?? undefined}>{r.schoolGrade ?? "—"}</span>
          <span className={s.exitCell} title={r.program ? programLabel(r.program, subjects, eieOn) : undefined} style={r.program ? { color: dashboardProgramColor(r.program) } : undefined}>
            {r.program ? programLabel(r.program, subjects, eieOn) : "기타·미상"}
          </span>
          <span className={s.exitCell} title={r.className}>{r.className ?? "—"}</span>
          <time dateTime={r.withdrawnAt}>{monthDay(r.withdrawnAt)}</time>
          {counted ? <span className={s.exitCounted} title={r.countMonth ? countedMonthLabel(r.countMonth) : undefined}>{r.countMonth ? `${Number(r.countMonth.slice(5, 7))}월` : "—"}</span> : null}
        </li>
      ))}
    </ul>
  );
  const halves = <T,>(rows: readonly T[]) => [rows.slice(0, Math.ceil(rows.length / 2)), rows.slice(Math.ceil(rows.length / 2))] as const;
  const twoColumns = (rows: readonly ((typeof data.rows)[number] & { countMonth?: string })[], counted: boolean) => {
    if (!split) return table(rows, counted);
    const [left, right] = halves(rows);
    return <div className={s.exitColumns}>{table(left, counted)}{right.length > 0 ? table(right, counted) : null}</div>;
  };
  return (
    <>
      <PopupTotal label={title} value={counts.total} unit="명" />
      <p className={s.popupSummary}>퇴원 {counts.total - endedCount}명 · 수강종료 {endedCount}명</p>
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
        <PopupEmpty>{title} 학생이 없습니다.</PopupEmpty>
      ) : (
        twoColumns(data.rows, false)
      )}
      {carried.length > 0 ? (
        <>
          <p className={s.popupGroup}>{countedEarlierTitle(data.month, carried.length, "명")} — 위 숫자에 들지 않습니다</p>
          {twoColumns(carried, true)}
        </>
      ) : null}
      {/* 퇴원이 어떤 기준으로 세지는지 — 원장 2026-11-03 *"아래쪽에도 그 내용을 적어놓고, 마지막 수업일 기준이라는 멘트와 수강료 납부 관련 멘트도"*. */}
      <p className={s.footnote}>{EXIT_REPORT_RULE}</p>
      <p className={s.footnote}>{exitBasisRule(data.month)}</p>
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
