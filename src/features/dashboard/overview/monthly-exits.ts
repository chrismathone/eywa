import type { OverviewData, WithdrawalKpiRow } from "./model";
import type { SubjectEndedRow } from "@/features/withdrawals/server/queries";
import type { WindowWithdrawal } from "@/features/withdrawals/server/window";
import { inWithdrawalWindow, withdrawalProgram } from "@/features/withdrawals/window";
import { countedEarlier } from "@/features/withdrawals/exit-basis";
import type { ProgramSubject } from "@/features/students/enrollment/program";

type Detail = SubjectEndedRow["endedDetail"][number];

/**
 * 이미 퇴원 줄로 선 것 — `학생|과목`(그 과목만 건너뛴다) 또는 학생 id(과목을 모르는 퇴원 줄 — 그 학생 전부를 건너뛴다).
 * 🔴 학생 단위로 건너뛰면, 수학을 먼저 끊고(수강종료) 같은 달에 영어까지 퇴원한 학생의 수학 줄이 운영실에서만 사라진다(퇴원관리와 숫자가
 *    갈린다 — 2026-11-11 퇴원생의 먼저 끊은 과목을 수강종료로 세면서 드러남).
 */
export function withdrawnKeysOf(rows: readonly { id: string; subject?: string | null }[]): Set<string> {
  return new Set(rows.map((r) => (r.subject ? `${r.id}|${r.subject}` : r.id)));
}

/** 수강종료 줄들을 KPI 줄로 — 숫자 쪽(`includeSubjectEnds`)과 '앞 달로 센' 쪽(`carriedSubjectEnds`)이 같은 모양으로 만든다. */
function subjectEndRows(
  subjectEnded: readonly SubjectEndedRow[],
  skipIds: ReadonlySet<string>,
  pick: (detail: Detail) => boolean,
  subjects: readonly ProgramSubject[],
  schoolGrade: (school: string | null, grade: string | null) => string | null,
): { row: WithdrawalKpiRow; countAt: string | null }[] {
  const out: { row: WithdrawalKpiRow; countAt: string | null }[] = [];
  for (const s of subjectEnded) {
    if (skipIds.has(s.id)) continue;
    const ended = s.endedDetail.filter(d => !d.isTransferred && !skipIds.has(`${s.id}|${d.subject}`) && pick(d))
      .sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? "") || a.subject.localeCompare(b.subject));
    for (const detail of ended) {
      if (!detail.endedAt) continue;
      out.push({ countAt: detail.countAt, row: { id: s.id, eventKey: `${s.id}|${detail.subject}`, name: s.name,
        subject: detail.subject,
        schoolGrade: schoolGrade(s.school, s.grade), withdrawnAt: detail.endedAt,
        program: withdrawalProgram({ lastClassSubject: detail.subject, lastClassEnglishTrack: detail.englishTrack }, subjects),
        kind: "subject-ended", className: detail.className ?? undefined } });
    }
  }
  return out;
}

const byDateDesc = <T extends WithdrawalKpiRow>(a: T, b: T) =>
  b.withdrawnAt.localeCompare(a.withdrawnAt) || a.name.localeCompare(b.name, "ko") || (a.eventKey ?? a.id).localeCompare(b.eventKey ?? b.id);

/** 과목 전체 종료만 더하며 반이동은 제외한다. 퇴원 줄이 이미 센 학생·과목은 다시 세지 않는다(다른 과목은 센다). */
export function includeSubjectEnds(
  withdrawn: OverviewData["withdrawals"]["rows"],
  subjectEnded: readonly SubjectEndedRow[],
  window: { from: string; to: string },
  subjects: readonly ProgramSubject[],
  schoolGrade: (school: string | null, grade: string | null) => string | null,
): OverviewData["withdrawals"]["rows"] {
  const withdrawnIds = withdrawnKeysOf(withdrawn);
  // 달 판정 = 그 과목 수업료를 낸 마지막 달(`countAt`, 원장 2026-10-29) · 보이는 날짜는 종료일 그대로.
  const extra = subjectEndRows(subjectEnded, withdrawnIds,
    d => inWithdrawalWindow({ withdrawnAt: d.countAt ?? d.endedAt, systemBulk: false }, window.from, window.to), subjects, schoolGrade)
    .map((e) => e.row);
  return [...withdrawn.map(row => ({ ...row, kind: "withdrawn" as const })), ...extra].sort(byDateDesc);
}

/**
 * 창 안에 **처리**했지만 앞 달로 센 수강종료(원장 2026-11-03 — 숫자엔 들지 않고 팝업이 따로 밝힌다). 판정은 `countedEarlier`(퇴원관리와 같은 함수).
 * `withdrawnIds` = 퇴원 쪽(센 줄·앞 달로 센 줄 모두)에 이미 선 `학생|과목`(또는 과목 모르는 학생 id — `withdrawnKeysOf`) — 숫자 쪽과 같은 규칙으로 겹쳐 세지 않는다.
 */
export function carriedSubjectEnds(
  withdrawnIds: ReadonlySet<string>,
  subjectEnded: readonly SubjectEndedRow[],
  window: { from: string; to: string },
  subjects: readonly ProgramSubject[],
  schoolGrade: (school: string | null, grade: string | null) => string | null,
): (WithdrawalKpiRow & { countMonth: string })[] {
  return subjectEndRows(subjectEnded, withdrawnIds,
    d => countedEarlier({ date: d.endedAt, countDate: d.countAt }, window.from, window.to), subjects, schoolGrade)
    .map(({ row, countAt }) => ({ ...row, countMonth: (countAt ?? "").slice(0, 7) }))
    .sort(byDateDesc);
}

/**
 * KPI '퇴원&수업종료' 줄 조립 — `rows` = 창(보여 줄 달 1일 ~ min(말일, 오늘) · `exitReportMonth`)으로 **센**(수업료를 낸 마지막 달) 퇴원·과목 전체 종료, 퇴원은 끝난 과목마다 한 줄.
 * `carried` = 창 안에 퇴원·종료했지만 앞 달로 센 줄(원장 2026-11-03) — 숫자엔 들지 않는다. 판정은 퇴원관리와 같은 `countedEarlier`.
 * `withdrawn`은 `getWithdrawalsInWindow(…, { keepProcessedFrom: 창 시작 })`로 받아야 6개월보다 앞 달로 센 퇴원(오래 휴원 뒤 퇴원)도 빠지지 않는다.
 */
export function monthWithdrawalRows(
  withdrawn: readonly WindowWithdrawal[],
  subjectEnded: readonly SubjectEndedRow[],
  win: { from: string; to: string },
  subjects: readonly ProgramSubject[],
  schoolGrade: (school: string | null, grade: string | null) => string | null,
): Pick<OverviewData["withdrawals"], "rows" | "carried"> {
  const toRows = (row: WindowWithdrawal): WithdrawalKpiRow[] => (row.exitClasses.length ? row.exitClasses : [{
    subject: row.lastClassSubject,
    englishTrack: row.lastClassEnglishTrack,
    className: row.lastClassName,
  }]).map((klass) => ({
    id: row.id,
    eventKey: `${row.id}|${klass.subject ?? "unknown"}`,
    name: row.name,
    schoolGrade: schoolGrade(row.school, row.grade),
    withdrawnAt: row.withdrawnAt,
    className: klass.className ?? undefined,
    subject: klass.subject,
    program: withdrawalProgram({ lastClassSubject: klass.subject, lastClassEnglishTrack: klass.englishTrack }, subjects),
  }));
  const counted = withdrawn.filter((row) =>
    // 퇴원월 = 수강료를 낸 마지막 달(`exitDate`, 원장 2026-10-29) — 퇴원관리 '이번 달'과 같은 판정.
    inWithdrawalWindow({ withdrawnAt: row.exitDate, systemBulk: false }, win.from, win.to),
  );
  const carriedWithdrawn = withdrawn.filter((row) => countedEarlier({ date: row.withdrawnAt, countDate: row.exitDate }, win.from, win.to));
  const withdrawnIds = withdrawnKeysOf([...counted, ...carriedWithdrawn].flatMap(toRows));
  return {
    rows: includeSubjectEnds(counted.flatMap(toRows), subjectEnded, win, subjects, schoolGrade),
    carried: [
      ...carriedWithdrawn.flatMap((row) => toRows(row).map((r) => ({ ...r, kind: "withdrawn" as const, countMonth: row.exitDate.slice(0, 7) }))),
      ...carriedSubjectEnds(withdrawnIds, subjectEnded, win, subjects, schoolGrade),
    ].sort(byDateDesc),
  };
}
