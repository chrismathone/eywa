// 급여명세서 '수업 내역' 지표 — 순수 계산(Vitest).
//
// 시트(프리랜서 강의용역수수료 명세서) 하단 블록을 그대로 재현한다:
//   [그 달]  수업인원 · 퇴원생 수 · 퇴원생 명단 · 퇴원생율
//   [연 누적] 누적수업인원 · 월 평균 수업인원
//
// 원본 시트는 이 값들을 강사별 출석부 시트에서 IMPORTRANGE로 끌어왔다(사람이 채우는 칸).
// aywa는 수강(enrollments) + 학생 상태에서 직접 낸다 — 사람이 안 채워도 되고, 틀릴 일도 없다.

/** 수강 1구간. endDate=null = 아직 재원. */
export type EnrollSpanRow = {
  studentId: string;
  startDate: string; // 'YYYY-MM-DD'
  endDate: string | null;
};

/** 'YYYY-MM' → 그 달의 [첫날, 말일] 문자열. */
export function monthRange(period: string): { first: string; last: string } {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { first: `${period}-01`, last: `${period}-${String(last).padStart(2, "0")}` };
}

/**
 * 그 달에 수업이 살아 있었는가 — 구간이 달과 **겹치기만** 하면 참.
 *
 * 🔑 종료일 당일까지 재원으로 친다(일반 종료 규약). `end < 월초`여야 비로소 빠진다 —
 *    `end <= 월초`로 쓰면 1일에 끝난 수강이 통째로 사라져 하루씩 어긋난다(실사고 이력 있는 지점).
 */
export function spanOverlapsMonth(row: EnrollSpanRow, period: string): boolean {
  const { first, last } = monthRange(period);
  if (row.startDate > last) return false;
  if (row.endDate && row.endDate < first) return false;
  return true;
}

/** 그 달 수업인원 — 중복 제거한 학생 id. */
export function studentIdsInMonth(rows: readonly EnrollSpanRow[], period: string): string[] {
  const set = new Set<string>();
  for (const r of rows) if (spanOverlapsMonth(r, period)) set.add(r.studentId);
  return [...set];
}

/** 'YYYY-MM' 목록 — from(포함) ~ to(포함). from > to면 빈 배열. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  if (!fy || !fm || !ty || !tm) return out;
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export type YearlyClassMetrics = {
  /** 연 누적 수업인원 — 그 해 한 번이라도 수업한 **고유 학생 수**. */
  cumulativeStudents: number;
  /** 월 평균 수업인원 — 수업이 있었던 달만 평균(0인 달은 아직 안 온 달이라 평균을 끌어내린다). */
  averageStudents: number;
  /** 월별 인원(그래프·검산용). */
  byMonth: { period: string; students: number }[];
};

/**
 * 연 누적 지표 — `year`의 1월부터 `throughPeriod`까지.
 *
 * ⚠️ 평균은 **인원이 0인 달을 빼고** 낸다. 그러지 않으면 3월에 명세서를 뽑을 때 4~12월의 0이
 *    분모에 들어가 평균이 1/4로 줄어든다(시트도 값이 있는 달만 평균한다 — 김은정 418/8 = 52.25).
 */
export function yearlyClassMetrics(
  rows: readonly EnrollSpanRow[],
  year: number,
  throughPeriod: string,
): YearlyClassMetrics {
  const months = monthsBetween(`${year}-01`, throughPeriod);
  const byMonth = months.map((period) => ({ period, students: studentIdsInMonth(rows, period).length }));
  const cumulative = new Set<string>();
  for (const period of months) for (const id of studentIdsInMonth(rows, period)) cumulative.add(id);
  const active = byMonth.filter((m) => m.students > 0);
  const averageStudents =
    active.length === 0 ? 0 : Math.round((active.reduce((s, m) => s + m.students, 0) / active.length) * 100) / 100;
  return { cumulativeStudents: cumulative.size, averageStudents, byMonth };
}

export type WithdrawalStats = {
  /** 그 달 퇴원한 학생 수(이 강사에게 배우던 학생 중). */
  count: number;
  /** 퇴원생 명단(이름). */
  names: string[];
  /** 퇴원생율 = 퇴원 ÷ 그 달 수업인원. 수업인원 0이면 null(0%로 지어내지 않는다). */
  rate: number | null;
  /** 퇴원일이 '시스템 일괄 도장'이라 실제 시점을 모르는 인원 — 위 count에서 **제외**된 수. */
  unknownDateCount: number;
};

/**
 * 그 달 퇴원 지표.
 *
 * 🔴 `excludeDates`(시스템 일괄 퇴원 도장일)에 걸린 학생은 세지 않는다 — 2026-07-10 하루에 119명이
 *    찍힌 것은 그날 그만둔 게 아니라 **이미 끝나 있던 학생들에게 일괄로 도장을 찍은 날**이다.
 *    그대로 세면 그 달 명세서의 퇴원생율이 통째로 거짓이 된다. 대신 몇 명을 뺐는지는 밝힌다.
 */
export function withdrawalStats(
  withdrawn: readonly { studentId: string; name: string; withdrawnAt: string | null }[],
  studentsThisMonth: readonly string[],
  period: string,
  excludeDates: readonly string[],
): WithdrawalStats {
  const inScope = new Set(studentsThisMonth);
  const excluded = new Set(excludeDates.map((d) => d.slice(0, 10)));
  let unknownDateCount = 0;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const w of withdrawn) {
    if (!w.withdrawnAt || !w.withdrawnAt.startsWith(period)) continue;
    if (!inScope.has(w.studentId)) continue;
    if (seen.has(w.studentId)) continue;
    seen.add(w.studentId);
    if (excluded.has(w.withdrawnAt.slice(0, 10))) {
      unknownDateCount += 1;
      continue;
    }
    names.push(w.name);
  }
  names.sort((a, b) => a.localeCompare(b, "ko"));
  return {
    count: names.length,
    names,
    rate: studentsThisMonth.length === 0 ? null : names.length / studentsThisMonth.length,
    unknownDateCount,
  };
}

/** 퇴원생율 표시 — 시트는 소수 둘째 자리 퍼센트("6.00%"). */
export function formatWithdrawalRate(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(2)}%`;
}
