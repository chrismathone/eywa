import { isMergedStudent } from "@/features/students/status/merged";
import { isSystemBulkWithdrawal } from "@/features/withdrawals/system-bulk";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { billedExitSubjects, billedOn } from "./trend-billing";
export { monthlyPoints, weeklyPoints, yearlyPoints } from "./trend-points";

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
 *    (장부 날짜까지 재원으로 세면 3~6월이 부푼다). 수업 기록 없는 장부 정리(`isBookkeepingOnlyExit`)도 같은 이유로 통째로 뺀다.
 *    수업 기록이 있는 장부 정리는 청구가 지점을 덮은 달부터 **청구가 살아 있는 달에만** 센다(원장 2026-10-20 — `trend-billing.ts`).
 */
export type TrendStudent = {
  id: string;
  status: string;
  enrolledAt: string | null;
  withdrawnAt: string | null;
  /** 병합 표식을 읽는다 — 흡수된 쪽은 퇴원으로 남아 있어 세면 한 사람이 두 번 든다(퇴원관리·운영실과 같이 뺀다). */
  notes?: string | null;
  /** 병합 판정을 미리 한 값(원본 캐시가 메모 칸을 싣지 않게 — `isMergedStudent(notes)`와 같은 뜻). */
  merged?: boolean;
  /** 장부 정리 메모(`isCleanupExit`) — 퇴원 학생이고 끝난 수강이 없을 때만 뺀다(`isBookkeepingOnlyExit`와 같은 판정). */
  cleanup?: boolean;
};
/**
 * `ended` = 끝난 수강이 있는 학생 — 시스템 정리분 판정 재료(퇴원관리 `loadEndedEnrollments`와 같은 뜻).
 * `billing` = 청구가 지점을 덮기 시작한 달(YYYY-MM · `loadCleanupBilling`) · 오늘 · 장부 정리 학생마다 청구가 살아 있는 달 — 있으면
 *   장부 정리 학생은 그 달부터 오늘 전까지 청구가 살아 있는 달에만 센다(원장 2026-10-20).
 */
export type TrendBilling = { from: string; today: string; months: ReadonlyMap<string, readonly string[]> };
export type TrendEnrollments = { firstStart: ReadonlyMap<string, string>; ended: ReadonlySet<string>; billing?: TrendBilling };
export type TrendPoint = { key: string; label: string; date: string; count: number };

/** 한 학생이 날짜 d에 재원생으로 세어지는가(위 판정 한 벌 — `enrolledOn`·과목별 추이가 같이 쓴다). */
export function countedOn(s: TrendStudent, en: TrendEnrollments, d: string): boolean {
  const { firstStart, ended } = en;
  if (s.status !== "enrolled" && s.status !== "withdrawn") return false;
  if (s.merged || isMergedStudent(s.notes)) return false;
  // 등록일이 빈 재원생 — 카드는 등록일을 안 본다. 첫 수강 시작일로 대신하고, 그것도 없으면 언제나 센다(오늘 칸 = 카드).
  const enrolled = s.enrolledAt?.slice(0, 10) ?? firstStart.get(s.id) ?? (s.status === "enrolled" ? "0000-00-00" : null);
  if (!enrolled || enrolled > d) return false;
  const first = firstStart.get(s.id);
  if (first && first > d) return false;
  if (s.status === "withdrawn" && s.cleanup) {
    // 수업 기록 없는 장부 정리는 통째로 뺀다 — 수업 없이 장부에만 있던 학생이라 정리한 날까지 재원으로 세면 그날 퇴원이 몰려
    // 보인다(원장 2026-10-15).
    if (!ended.has(s.id)) return false;
    // 수업 기록이 있으면 청구 기록이 있는 달엔 청구가 살아 있는 달에만 센다(원장 2026-10-20) — 그 밖의 날은 아래 퇴원일 규칙.
    const billed = billedOn(s, en, d);
    if (billed !== null) return billed;
  }
  const out = s.withdrawnAt?.slice(0, 10);
  if (out && out <= d) return false;
  if (s.status === "withdrawn" && !out) return false; // 퇴원했는데 날짜가 없으면 언제까지 다녔는지 모른다
  if (s.status === "withdrawn" && isSystemBulkWithdrawal({ withdrawnAt: s.withdrawnAt, hasEnrollmentHistory: ended.has(s.id) })) return false;
  return true;
}

export function enrolledOn(students: readonly TrendStudent[], en: TrendEnrollments, d: string): number {
  let n = 0;
  for (const s of students) if (countedOn(s, en, d)) n++;
  return n;
}

/** 과목별·강좌수 추이 재료 — 수강 한 줄(반 과목 · 시작·종료일 · 반이동 여부 · 강좌수용 반 id·휴원·영어 프로그램 — `course-trend.ts`). */
export type TrendEnrollment = { studentId: string; subject: string | null; start: string | null; end: string | null; transferred: boolean; classId?: string | null; onHold?: boolean; englishTrack?: string | null };

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
      const rows = byStudent.get(s.id) ?? [];
      // 오늘 점 = 운영실 칸 조회와 같은 줄(종료일 없음 · **휴원 아님** — `fetchActiveEnrolledEnrollments`). 지난 날짜는 휴원 이력이 없어 되감지 못한다.
      const live = rows.filter((e) => (p.date === today ? !e.end && !e.onHold : !isEnrollmentEndedOn(e.end, p.date, e.transferred)));
      const started = (e: TrendEnrollment) => !e.start || e.start.slice(0, 10) <= p.date;
      const billed = live.some(started) ? null : billedExitSubjects(s, rows, en, p.date); // 장부 정리를 청구로 센 날 — 퇴원 무렵 과목
      if (billed) {
        if (!billed.length || billed.some((x) => inSubject(x))) count++;
        continue;
      }
      if (!live.length || live.some((e) => inSubject(e.subject) && started(e))) count++;
    }
    return { ...p, count };
  });
}

/** 수강 구성 — 영어만 · 동시수강(영어+수학) · 수학만 · 기타 과목만. 미수강은 세지 않는다. */
export type MixKey = "englishOnly" | "both" | "mathOnly" | "otherOnly";
export const MIX_KEYS: readonly MixKey[] = ["englishOnly", "both", "mathOnly", "otherOnly"];

export type TrendBreakdown = {
  /** 과목 키 → 그날 그 과목 반 수강이 **걸려 있고 시작한** 재원생(두 과목이면 양쪽). */
  bySubject: Record<string, TrendPoint[]>;
  mix: Record<MixKey, TrendPoint[]>;
  /** 재원생으로 세어지는데 그날 걸린 수강이 하나도 없는 학생 — 어느 과목에도 넣지 않는다(화면이 신뢰 구간을 가르는 데 쓴다). */
  unknown: TrendPoint[];
};

/**
 * **과목별 · 수강 구성 추이**(원장 2026-10-20 원생 통계) — 날짜 d에 재원생으로 세어지는 학생(`countedOn`)을 그날 **걸려 있고 시작한**
 * 수강으로 가른다. 수강이 걸렸는지는 `subjectTrendOf`와 같은 규약(반이동은 종료일 전날까지 · 일반 종료는 종료일 포함 ·
 * **오늘 점**은 종료일 없는 수강만 — KPI 조회와 같은 결).
 * 🔴 `subjectTrendOf`(운영실 과목 관리자용)와 다른 점 = 그날 걸린 수강이 없는 학생을 **모든 과목에 넣지 않는다**. 통계 화면은
 *    과목별 흐름을 보는 자리라, 수강 기록이 옮겨지지 않은 옛 퇴원생이 모든 과목에 한꺼번에 더해지면 없던 과목에 수십 명이 선다
 *    (실측 2026-10-20: 국어·과학이 2025-02에 165명 → 2026-01에 0명). 그런 학생 수는 `unknown`으로 따로 돌려준다.
 * 수강 구성: 영어 묶음과 수학 묶음이 둘 다면 동시수강, 하나면 영어만·수학만, 둘 다 없고 다른 과목만 있으면 기타 과목만.
 * `groupOf` = 과목 묶음 판정(`subjectGroupOf` — 운영실 '동시 수강'과 같은 함수를 호출부가 넘긴다).
 */
export function breakdownTrendOf(
  students: readonly TrendStudent[],
  en: TrendEnrollments,
  enrollments: readonly TrendEnrollment[],
  points: readonly { key: string; label: string; date: string }[],
  subjectKeys: readonly string[],
  groupOf: (subject: string | null) => string | null,
  today?: string,
): TrendBreakdown {
  const byStudent = new Map<string, TrendEnrollment[]>();
  for (const e of enrollments) byStudent.set(e.studentId, [...(byStudent.get(e.studentId) ?? []), e]);
  const out: TrendBreakdown = {
    bySubject: Object.fromEntries(subjectKeys.map((k) => [k, [] as TrendPoint[]])),
    mix: { englishOnly: [], both: [], mathOnly: [], otherOnly: [] },
    unknown: [],
  };
  for (const p of points) {
    const subjectCounts = new Map<string, number>();
    const mixCounts: Record<MixKey, number> = { englishOnly: 0, both: 0, mathOnly: 0, otherOnly: 0 };
    let unknown = 0;
    for (const s of students) {
      if (!countedOn(s, en, p.date)) continue;
      const subjects = new Set<string>();
      const rows = byStudent.get(s.id) ?? [];
      for (const e of rows) {
        // 오늘 점은 휴원 수강도 뺀다 — 운영실 '과목별 수강'·'재원생 구성'(휴원 수강만 있는 학생 = 미수강)과 같은 줄(리뷰 2026-10-21).
        const live = p.date === today ? !e.end && !e.onHold : !isEnrollmentEndedOn(e.end, p.date, e.transferred);
        if (!live || (e.start && e.start.slice(0, 10) > p.date) || !e.subject) continue;
        subjects.add(e.subject);
      }
      if (subjects.size === 0) for (const x of billedExitSubjects(s, rows, en, p.date) ?? []) subjects.add(x);
      if (subjects.size === 0) {
        unknown++;
        continue;
      }
      let english = false;
      let math = false;
      let other = false;
      for (const subject of subjects) {
        subjectCounts.set(subject, (subjectCounts.get(subject) ?? 0) + 1);
        const group = groupOf(subject);
        if (group === "english") english = true;
        else if (group === "math") math = true;
        else if (group) other = true;
      }
      if (english && math) mixCounts.both++;
      else if (english) mixCounts.englishOnly++;
      else if (math) mixCounts.mathOnly++;
      else if (other) mixCounts.otherOnly++;
    }
    for (const k of subjectKeys) out.bySubject[k]!.push({ ...p, count: subjectCounts.get(k) ?? 0 });
    for (const k of MIX_KEYS) out.mix[k].push({ ...p, count: mixCounts[k] });
    out.unknown.push({ ...p, count: unknown });
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
