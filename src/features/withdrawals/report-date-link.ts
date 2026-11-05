/**
 * 퇴원보고서 날짜 ↔ 퇴원관리 퇴원일(`students.withdrawn_at`) — **같은 퇴원 사건으로 보이는가**(순수 함수 · Vitest).
 *
 * 원장 2026-10-23 *"퇴원일자 통일 · 퇴원보고서 연동"* → 퇴원일은 고치지 않고(어느 날짜가 맞는지는 사람이 본다) 화면이 보고서
 * 날짜를 함께 보여 준다. 🔴 날짜가 다르다고 다 어긋남이 아니다(Codex 검토 2026-10-23): 보고서가 한 과목만 끝낸 기록이거나,
 * 보고서 뒤에 다시 다니다 나중에 퇴원한 학생이면 날짜가 다른 게 정상이다. 그래서 학생 연결만으로 같은 사건이라 단정하지 않고
 * 넷으로 가른다 — 화면은 `same_event`(같은 사건 후보)만 보이고, 어긋남 목록(CSV)은 전부를 유형별로 적는다.
 *
 * ⚠️ 이 파일은 import가 없다 — 운영 DB를 읽는 어긋남 목록 스크립트가 같은 판정을 그대로 불러 쓴다(판정이 두 벌이 되지 않게).
 */

export type ReportDateKind = "same_event" | "partial" | "reenrolled" | "returned" | "unknown";

export const REPORT_DATE_KIND_LABEL: Record<ReportDateKind, string> = {
  same_event: "같은 사건 후보",
  partial: "부분(과목) 종료",
  reenrolled: "재등록 뒤 다시 퇴원",
  returned: "재등록 뒤 재원 중",
  unknown: "관계 미확인",
};

/** 끝나지 않은 수강의 종료일 자리 — 어떤 실제 날짜보다 늦다(문자열 비교). */
const OPEN = "9999-12-31";

/** 학생의 수강 한 줄 — 과목은 반의 과목 키(모르면 null). 날짜는 `YYYY-MM-DD`. */
export type LinkEnrollment = { subject: string | null; startDate: string; endDate: string | null };

export type ReportDateInput = {
  /** 퇴원관리 퇴원일 — 🔴 학생이 **지금 퇴원 상태일 때만** 넘긴다(재원·휴원·예약이면 null). */
  withdrawnAt: string | null;
  /** 보고서 날짜(새 보고서 적용일 · 원본 종료일). 모르면 null. */
  reportDate: string | null;
  /** 보고서가 다룬 과목 키들. 비었으면 '모름'. */
  reportSubjects: readonly string[];
  /** 새 보고서가 스스로 '과목 수강종료'라고 적은 경우. 원본은 이 정보가 없다(false). */
  subjectEnd: boolean;
  enrollments: readonly LinkEnrollment[];
};

/**
 * 판정 순서(앞에서 걸리면 끝):
 *  1. 보고서 날짜가 없으면 → 관계 미확인
 *  2. 새 보고서가 과목 수강종료면 → 부분(과목) 종료
 *  3. 보고서 과목이 끝난 **뒤에도**(보고서 날짜·그 과목의 실제 종료일 중 늦은 날) 다른 과목 수강이 이어졌으면 → 부분(과목) 종료
 *  4. 보고서 날짜 **뒤에 시작한** 수강이 있으면 → 재등록(지금 퇴원이면 '다시 퇴원', 아니면 '재원 중')
 *  5. 지금 퇴원이 아니거나 · 수강 기록이 없거나 · 보고서 과목을 모르면 → 관계 미확인
 *  6. 보고서 과목이 **마지막 수강 과목**과 겹치면 → 같은 사건 후보, 아니면 관계 미확인
 */
export function classifyReportDate(input: ReportDateInput): ReportDateKind {
  return explainReportDate(input).kind;
}

/** 판정 + 그 까닭(어긋남 목록의 '근거' 칸 — 사람이 왜 그 유형인지 바로 보게). */
export function explainReportDate(input: ReportDateInput): { kind: ReportDateKind; reason: string } {
  const { withdrawnAt, reportDate, enrollments } = input;
  const subjects = input.reportSubjects.filter(Boolean);
  if (!reportDate) return { kind: "unknown", reason: "보고서 날짜 없음" };
  if (input.subjectEnd) return { kind: "partial", reason: "새 보고서가 과목 수강종료" };
  // '그 뒤에도 다른 과목을 다녔다'의 기준 = 보고서 날짜와 **보고서 과목 자신이 실제로 끝난 날** 중 늦은 날.
  // 보고서 날짜만 보면 두 과목이 같은 날 끝난 퇴원(과목별 원본이 한 장씩)이 전부 부분 종료로 갈린다(리뷰 2026-10-23).
  const ownEnd = enrollments
    .filter((e) => e.subject !== null && subjects.includes(e.subject))
    .reduce((max, e) => ((e.endDate ?? OPEN) > max ? (e.endDate ?? OPEN) : max), reportDate);
  if (
    subjects.length > 0 &&
    enrollments.some(
      (e) =>
        e.subject !== null &&
        !subjects.includes(e.subject) &&
        e.startDate <= reportDate &&
        (e.endDate ?? OPEN) > ownEnd,
    )
  )
    return { kind: "partial", reason: "보고서 과목이 끝난 뒤에도 다른 과목 수강" };
  if (enrollments.some((e) => e.startDate > reportDate))
    return { kind: withdrawnAt ? "reenrolled" : "returned", reason: "보고서 날짜 뒤에 시작한 수강 있음" };
  if (!withdrawnAt) return { kind: "unknown", reason: "지금 퇴원 상태 아님" };
  if (enrollments.length === 0) return { kind: "unknown", reason: "수강 기록 없음" };
  if (subjects.length === 0) return { kind: "unknown", reason: "보고서 과목 미기재" };
  return lastSubjects(enrollments).some((s) => subjects.includes(s))
    ? { kind: "same_event", reason: "마지막 수강 과목과 같음 · 보고서 뒤 새 수강 없음" }
    : { kind: "unknown", reason: "마지막 수강 과목과 다름" };
}

/** 가장 늦게 끝난(끝나지 않은 것 포함) 수강들의 과목 — 같은 날 둘이 끝났으면 둘 다. */
export function lastSubjects(enrollments: readonly LinkEnrollment[]): string[] {
  const last = enrollments.reduce((max, e) => ((e.endDate ?? OPEN) > max ? (e.endDate ?? OPEN) : max), "");
  return [
    ...new Set(
      enrollments
        .filter((e) => (e.endDate ?? OPEN) === last && e.subject !== null)
        .map((e) => e.subject as string),
    ),
  ];
}

/** 마지막 수강 종료일(끝나지 않은 수강만 있으면 null). */
export function lastEndDate(enrollments: readonly LinkEnrollment[]): string | null {
  const ends = enrollments.map((e) => e.endDate).filter((d): d is string => d !== null);
  return ends.length ? ends.reduce((a, b) => (b > a ? b : a)) : null;
}

/** 두 날짜의 차이(일) — `b - a`. 둘 중 하나라도 없으면 null. */
export function dayDiff(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const t = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

/** 화면이 퇴원일 옆에 보일 보고서 날짜 하나와, 카드에 펼칠 근거 줄들. */
export type ReportDateNote = { date: string; rows: { label: string; date: string }[] };

/**
 * 퇴원 상세 머리의 '퇴원보고서 마지막 수업일' — **같은 사건 후보**만 본다.
 * 그중 하나라도 퇴원일과 같으면 보일 게 없다(null). 다르면 가장 늦은 보고서 날짜를 보이고, 후보 전부를 근거로 싣는다.
 */
export function reportDateNote(
  withdrawnAt: string | null,
  enrollments: readonly LinkEnrollment[],
  reports: readonly (Omit<ReportDateInput, "withdrawnAt" | "enrollments"> & { label: string })[],
): ReportDateNote | null {
  if (!withdrawnAt) return null;
  const same = reports.filter(
    (r): r is typeof r & { reportDate: string } =>
      classifyReportDate({ ...r, withdrawnAt, enrollments }) === "same_event",
  );
  if (same.length === 0 || same.some((r) => r.reportDate === withdrawnAt)) return null;
  const rows = same
    .map((r) => ({ label: r.label, date: r.reportDate }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { date: rows[0].date, rows };
}
