import { isMergedStudent } from "@/features/students/merged";
import { isSystemBulkWithdrawal } from "@/features/withdrawals/system-bulk";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";

/**
 * 재원생 추이 — 월말(이번 달은 오늘)·연말(올해는 오늘) 시점의 재원생 수(원장 2026-09-29 *"재원생 수치: 연간, 월간 흐름을
 * 볼 수 있도록 추이그래프 추가 필요"*). 순수 함수(Vitest).
 *
 * 🔑 판정 = 운영실 '재원생' 카드와 같은 뜻을 **날짜 d에 되감아** 적용한다:
 *    등록일 ≤ d · 퇴원일이 없거나 d 뒤(퇴원 예약 포함) · 수강 기록이 있으면 첫 수강이 d까지 시작(실시간 재원생 —
 *    `notYetStartedStudentIds`와 같은 뜻) · 지금 상태가 재원 또는 퇴원(상담만 한 예비·휴원은 카드도 안 센다).
 *    → 오늘 점 = 카드 숫자(실측 2026-09-29 342 = 342).
 * ⚠️ 휴원 이력은 저장되지 않아 과거 달의 휴원생을 가를 수 없다 — 지금 휴원인 학생은 과거에도 빼고, 그때 휴원이었다가
 *    지금 재원인 학생은 과거에도 센다. 퇴원일을 모르는 시스템 정리분(`isSystemBulkWithdrawal`)은 통째로 뺀다
 *    (장부 날짜까지 재원으로 세면 3~6월이 부푼다).
 */
export type TrendStudent = {
  id: string;
  status: string;
  enrolledAt: string | null;
  withdrawnAt: string | null;
  /** 병합 표식을 읽는다 — 흡수된 쪽은 퇴원으로 남아 있어 세면 한 사람이 두 번 든다(퇴원관리·운영실과 같이 뺀다). */
  notes?: string | null;
};
/** `ended` = 끝난 수강이 있는 학생 — 시스템 정리분 판정 재료(퇴원관리 `loadEndedEnrollments`와 같은 뜻). */
export type TrendEnrollments = { firstStart: ReadonlyMap<string, string>; ended: ReadonlySet<string> };
export type TrendPoint = { key: string; label: string; date: string; count: number };

/** 한 학생이 날짜 d에 재원생으로 세어지는가(위 판정 한 벌 — `enrolledOn`·과목별 추이가 같이 쓴다). */
export function countedOn(s: TrendStudent, en: TrendEnrollments, d: string): boolean {
  const { firstStart, ended } = en;
  if (s.status !== "enrolled" && s.status !== "withdrawn") return false;
  if (isMergedStudent(s.notes)) return false;
  // 등록일이 빈 재원생 — 카드는 등록일을 안 본다. 첫 수강 시작일로 대신하고, 그것도 없으면 언제나 센다(오늘 칸 = 카드).
  const enrolled = s.enrolledAt?.slice(0, 10) ?? firstStart.get(s.id) ?? (s.status === "enrolled" ? "0000-00-00" : null);
  if (!enrolled || enrolled > d) return false;
  const out = s.withdrawnAt?.slice(0, 10);
  if (out && out <= d) return false;
  if (s.status === "withdrawn" && !out) return false; // 퇴원했는데 날짜가 없으면 언제까지 다녔는지 모른다
  if (s.status === "withdrawn" && isSystemBulkWithdrawal({ withdrawnAt: s.withdrawnAt, hasEnrollmentHistory: ended.has(s.id) })) return false;
  const first = firstStart.get(s.id);
  if (first && first > d) return false;
  return true;
}

export function enrolledOn(students: readonly TrendStudent[], en: TrendEnrollments, d: string): number {
  let n = 0;
  for (const s of students) if (countedOn(s, en, d)) n++;
  return n;
}

/** 과목별 추이 재료 — 수강 한 줄(반 과목 · 시작·종료일 · 반이동 여부). */
export type TrendEnrollment = { studentId: string; subject: string | null; start: string | null; end: string | null; transferred: boolean };

/**
 * **과목별 재원생 추이**(원장 2026-10-14 2단계 *"재원생 추이도 마찬가지(해당 과목 관리자는 나눠서 해당 과목만)"*) —
 * 날짜 d에 재원생으로 세어지는 학생 중 **그 과목 반 수강이 d에 걸려 있던** 학생 · 두 과목이면 양쪽 모두.
 * d에 끝나지 않은 수강이 하나도 없는 학생(반 배정 전 · 수강이 전부 끝난 재원생)은 '모름'이라 모든 과목에 든다 —
 * 재원생 KPI의 과목 값(`server.ts` students — 끝나지 않은 수강이 없으면 모두에게)과 같은 판정이다(적대 리뷰 2026-10-14).
 * 수강이 d에 걸렸는지는 수강 명단과 같은 규약(시작일 ≤ d, 비어 있으면 시작한 것 · 반이동은 종료일 전날까지, 일반 종료는
 * 종료일 포함 — `isEnrollmentEndedOn`). **오늘 점**(`today`)만은 KPI 조회와 같은 규약 — 종료일이 박힌 수강은 끝난 것
 * (KPI = `end_date is null` 행만, 재리뷰 2026-10-14: 반이동 예약처럼 종료일이 미래인 수강에서 오늘 점이 KPI보다 1 컸다).
 * ⚠️ 휴원 이력은 없어 지난 날짜를 되감을 수 없다 — 지금 휴원 중인 수강도 그대로 센다
 * (KPI는 휴원 수강을 빼므로, 휴원 수강만 남은 학생 몇 명은 오늘 점과 KPI가 다를 수 있다).
 */
export function subjectTrendOf(
  students: readonly TrendStudent[],
  en: TrendEnrollments,
  enrollments: readonly TrendEnrollment[],
  points: readonly { key: string; label: string; date: string }[],
  inSubject: (subject: string | null) => boolean,
  today?: string,
): TrendPoint[] {
  const byStudent = new Map<string, TrendEnrollment[]>();
  for (const e of enrollments) byStudent.set(e.studentId, [...(byStudent.get(e.studentId) ?? []), e]);
  return points.map((p) => {
    let count = 0;
    for (const s of students) {
      if (!countedOn(s, en, p.date)) continue;
      const live = (byStudent.get(s.id) ?? []).filter((e) => (p.date === today ? !e.end : !isEnrollmentEndedOn(e.end, p.date, e.transferred)));
      if (!live.length || live.some((e) => inSubject(e.subject) && (!e.start || e.start.slice(0, 10) <= p.date))) count++;
    }
    return { ...p, count };
  });
}

const lastDay = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
};
const shift = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1 + n, 1)).toISOString().slice(0, 7);
};

/** 최근 12개월 — 달마다 말일(이번 달은 오늘). */
export function monthlyPoints(today: string, count = 12): { key: string; label: string; date: string }[] {
  const month = today.slice(0, 7);
  return Array.from({ length: count }, (_, i) => {
    const key = shift(month, i - count + 1);
    const m = Number(key.slice(5));
    return { key, label: m === 1 || i === 0 ? `${key.slice(2, 4)}.${m}월` : `${m}월`, date: key === month ? today : lastDay(key) };
  });
}

/** 연도별 — `fromYear`부터 올해까지 연말(올해는 오늘). */
export function yearlyPoints(today: string, fromYear: number): { key: string; label: string; date: string }[] {
  const year = Number(today.slice(0, 4));
  const out: { key: string; label: string; date: string }[] = [];
  for (let y = Math.min(fromYear, year); y <= year; y++) {
    out.push({ key: String(y), label: `${y}년`, date: y === year ? today : `${y}-12-31` });
  }
  return out;
}

export function trendOf(
  students: readonly TrendStudent[],
  en: TrendEnrollments,
  points: readonly { key: string; label: string; date: string }[],
): TrendPoint[] {
  return points.map((p) => ({ ...p, count: enrolledOn(students, en, p.date) }));
}
