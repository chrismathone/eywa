import { isMergedStudent } from "@/features/students/merged";
import { isSystemBulkWithdrawal } from "@/features/withdrawals/system-bulk";

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

export function enrolledOn(students: readonly TrendStudent[], en: TrendEnrollments, d: string): number {
  const { firstStart, ended } = en;
  let n = 0;
  for (const s of students) {
    if (s.status !== "enrolled" && s.status !== "withdrawn") continue;
    if (isMergedStudent(s.notes)) continue;
    // 등록일이 빈 재원생 — 카드는 등록일을 안 본다. 첫 수강 시작일로 대신하고, 그것도 없으면 언제나 센다(오늘 칸 = 카드).
    const enrolled = s.enrolledAt?.slice(0, 10) ?? firstStart.get(s.id) ?? (s.status === "enrolled" ? "0000-00-00" : null);
    if (!enrolled || enrolled > d) continue;
    const out = s.withdrawnAt?.slice(0, 10);
    if (out && out <= d) continue;
    if (s.status === "withdrawn" && !out) continue; // 퇴원했는데 날짜가 없으면 언제까지 다녔는지 모른다
    if (s.status === "withdrawn" && isSystemBulkWithdrawal({ withdrawnAt: s.withdrawnAt, hasEnrollmentHistory: ended.has(s.id) })) continue;
    const first = firstStart.get(s.id);
    if (first && first > d) continue;
    n++;
  }
  return n;
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
