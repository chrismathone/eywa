/**
 * MCS 로스터 판정 — **누가 이 시트에 서는가**. 순수(Vitest).
 *
 * 원장 2026-08-31: *"퇴원생 이런거 잘보고 현재 수업중인 학생만 나와야해. 반이동 이런것도 잘 보고."*
 * 원장 2026-09-01(갱신): *"중간에 나가면 퇴원처리형식으로 회색 줄로 남기는게 합리적. 중간에 들어와도
 * 마찬가지. 출석부랑 비슷하게."* → **행에서 지우지 않고 남긴다.** 달 중간에 나간 학생을 통째로 빼면
 * 그 학생이 실제로 다닌 날의 기록까지 사라져 그 달 시트가 거짓이 된다(실측 2026-08: 그렇게 감춘 행이
 * 52개, 그 안에 **이미 작성된 기록 113칸**이 들어 있었다).
 *
 * 🔴 **끝나는 길이 셋이고 셋 다 봐야 한다.**
 *    ① 수강 종료(`enrollments.end_date`) ② **반이동 전출**(`is_transferred` — 종료일 **당일에** 끝난다:
 *    그날은 이미 새 반이다) ③ **학원 퇴원**(`students.withdrawn_at` — 수강에 종료일이 안 찍힌 채
 *    퇴원하는 경우가 있어 수강만 보면 안 걸린다). 실효 종료일 = ①과 ③ 중 **이른** 것.
 *
 * 🔴 **판정이 둘이고 쓰는 자리가 다르다.**
 *    · `isOnMathRosterAnyDay` = **행을 세울까**(그 달 수업일 중 하루라도 명단이면 세운다).
 *    · `isOnMathRoster(…, date)` = **그 칸이 켜질까**(날짜별). 수강 밖 날짜는 `cell-state.ts`가
 *      `off-roster`로 꺼서 회색으로 남고, 작성률 분모에도 안 들어간다.
 *    둘을 한 판정으로 합치면 달 중간 입·퇴반이 "다 보이거나 다 안 보이거나"가 된다.
 *
 * ⚠️ `on_hold`(휴원)는 여기서 보지 않는다 — 휴원은 시간이 아니라 상태이고 명단엔 남는 게 규약이다
 *    (`enrollmentPhaseOn` 주석). 출결 대상 판정과는 쓰는 자리가 다르다.
 */
import { addDays, monthRange } from "@/lib/date-kst";
import type { EnrollSpan } from "@/features/attendance/enrollment-span";

export type MathEnrollmentWindow = {
  startDate: string | null;
  endDate: string | null;
  /** 반이동 전출 — 옛 반에선 종료일 당일에 끝난다. */
  isTransferred: boolean;
};

/**
 * 그 달 화면의 로스터 기준일 — `오늘`을 그 달 안으로 접는다.
 * 과거 달 → 말일 · 이번 달 → 오늘 · 미래 달 → 1일.
 *
 * 이제 이 값은 **행을 세우는 기준이 아니라** "지금도 다니나"(회색 처리 여부)를 정하는 데 쓴다.
 */
export function rosterAnchorOf(month: string, today: string): string {
  const { from, to } = monthRange(month);
  if (today < from) return from;
  if (today > to) return to;
  return today;
}

/** 학원 퇴원을 반영한 **실효 종료일** — 수강 종료와 퇴원일 중 이른 것. */
export function effectiveEndDate(endDate: string | null, withdrawnAt: string | null): string | null {
  if (!endDate) return withdrawnAt;
  if (!withdrawnAt) return endDate;
  return endDate < withdrawnAt ? endDate : withdrawnAt;
}

/**
 * 수강 구간을 **출석부와 같은 모양**(`EnrollSpan`, 끝 포함)으로 편다 — 날짜 판정과 신입·퇴원·반이동
 * 표식이 **같은 구간**을 읽게 하는 단일 소스.
 *
 * 🔴 전출(`isTransferred`)은 종료일 **하루 전**이 마지막 날이다(그날은 이미 새 반). 출석부는 원본
 *    `end_date`를 그대로 끝으로 쓰지만 MCS는 이 규약이 더 엄격하다 — 그래서 여기서 하루를 당긴다.
 *    부수 효과로 반이동 판정이 **더 정확해진다**: 반이동 RPC는 `옛 반.end_date = 새 반.start_date`로
 *    저장하므로, 당기지 않으면 `transferTo`의 "나간 다음날 이후 시작" 조건에 걸리지 않아 진짜
 *    반이동이 '퇴원'으로 표시된다.
 * ⚠️ `startDate`가 없는 행은 근거로 쓰지 않는다(언제부터인지 모르는 것을 "다닌다"로 읽지 않는다).
 *    그래서 구간이 **하나도 없으면 명단이 아니다** — 출석부 `isEnrolledOn`의 "구간 없음 = 표시 안 함"
 *    (fail-open)과 반대 방향이므로, 이 파일 밖에서 그 함수로 MCS 구간을 판정하지 말 것.
 */
export function mathSpansOf(
  enrollments: readonly MathEnrollmentWindow[],
  withdrawnAt: string | null,
): EnrollSpan[] {
  const out: EnrollSpan[] = [];
  for (const e of enrollments) {
    if (e.startDate == null) continue;
    const end = effectiveEndDate(e.endDate, withdrawnAt);
    const last = end == null ? null : e.isTransferred ? addDays(end, -1) : end;
    // 시작하기도 전에 끝난 구간(당일 전출 등) — 켜질 칸이 하나도 없으므로 담지 않는다.
    if (last != null && last < e.startDate) continue;
    out.push({ start: e.startDate, end: last });
  }
  return out;
}

function spanCovers(spans: readonly EnrollSpan[], date: string): boolean {
  return spans.some((s) => s.start <= date && (s.end === null || date <= s.end));
}

/**
 * 기준일에 이 반 명단인가 — **칸 하나**의 판정. 구간이 여럿이면 하나라도 걸리면 명단(나갔다 돌아온 경우).
 */
export function isOnMathRoster(
  enrollments: readonly MathEnrollmentWindow[],
  withdrawnAt: string | null,
  date: string,
): boolean {
  return spanCovers(mathSpansOf(enrollments, withdrawnAt), date);
}

/**
 * 그 달 **수업일 중 하루라도** 명단이었나 — 행을 세우는 판정(원장 2026-09-01).
 *
 * 🔴 달의 모든 날이 아니라 **수업일**로 본다 — 수업이 없는 주말에만 걸쳐 있던 수강까지 세우면
 *    켜지는 칸이 하나도 없는 빈 회색 줄이 생긴다. 이 판정을 통과한 행은 반드시 칸이 ≥1개다.
 */
export function isOnMathRosterAnyDay(
  enrollments: readonly MathEnrollmentWindow[],
  withdrawnAt: string | null,
  dates: readonly string[],
): boolean {
  const spans = mathSpansOf(enrollments, withdrawnAt);
  if (spans.length === 0) return false;
  return dates.some((d) => spanCovers(spans, d));
}

/**
 * 기준일에서 본 이 학생의 자리 — **회색으로 가라앉힐지**를 정한다.
 *
 * 🔴 `on`이 아닌 것을 한 덩어리로 묶으면 **아직 안 들어온 신입이 퇴원과 같은 회색**이 된다.
 *    (이번 달 20일에 첫 수업인 학생을 1일에 열면 그 사람은 '나간 사람'처럼 보인다.)
 * 🔴 뒤집어, "앞으로 온다"는 **이 시트가 그리는 수업일 안에서만** 참이다. 다음 달 재등록까지
 *    `upcoming`으로 세면 8/12에 나간 학생이 8월 시트에서 회색이 안 되고 헤더가 "시작 예정 1명"이라고
 *    적는다 — 표식은 `퇴원 08-12`인데 줄은 멀쩡한 모순(적대적 재리뷰 2026-09-01). 그래서 `dates`를
 *    받아 **그 안에 다시 켜지는 칸이 있을 때만** `upcoming`이다.
 * ⚠️ 나갔다 **같은 달에** 다시 들어오는 학생은 그대로 `upcoming`(그 달 칸이 다시 켜진다).
 */
export type MathRosterPhase =
  /** 기준일에 명단이다. */
  | "on"
  /** 아직 시작 전(그 달 안에 들어온다). */
  | "upcoming"
  /** 이미 나갔다 — 회색 줄로 남긴다. */
  | "ended";

export function rosterPhaseOf(
  enrollments: readonly MathEnrollmentWindow[],
  withdrawnAt: string | null,
  date: string,
  /** 이 시트가 그리는 수업일 — `isOnMathRosterAnyDay`에 넘긴 것과 **같은 배열**. */
  dates: readonly string[],
): MathRosterPhase {
  const spans = mathSpansOf(enrollments, withdrawnAt);
  if (spanCovers(spans, date)) return "on";
  return dates.some((d) => d > date && spanCovers(spans, d)) ? "upcoming" : "ended";
}

/**
 * 화면이 "학생 N명"이라고 적을 때 쓰는 **분해된 수** — 단일 소스.
 *
 * 🔴 행 수를 그대로 "학생 N명"이라고 적으면 **거짓말이 된다.** 행에는 이 달 중 나간 사람과 아직 안
 *    들어온 사람이 섞여 있어서, 실측 2026-08 기준 68개 반 중 25개가 부풀고 `[특강]중2-2 문제 풀이반`은
 *    **현재 재원 0명인데 헤더가 "학생 7명"**이라고 적혔다(적대적 리뷰 2026-09-01).
 * ⚠️ 카드와 시트가 **같은 함수**로 세야 한다 — 한쪽만 고치면 "카드 4명인데 열면 5줄"이 된다.
 */
export function countRosterPhases(phases: readonly MathRosterPhase[]): {
  /** 기준일 현재 재원 — 화면이 "학생 N명"이라고 부르는 수. */
  on: number;
  /** 아직 안 들어옴(그 달 안에 온다). */
  upcoming: number;
  /** 이 달 중 나갔다 — 회색 줄. */
  ended: number;
  /** on이 아닌 행(회색·예정) 합. `on + extra` = 시트 줄 수. */
  extra: number;
} {
  let on = 0;
  let upcoming = 0;
  let ended = 0;
  for (const p of phases) {
    if (p === "on") on += 1;
    else if (p === "upcoming") upcoming += 1;
    else ended += 1;
  }
  return { on, upcoming, ended, extra: upcoming + ended };
}

/**
 * "+N"이 무엇인지 풀어 적는 조각 — 카드 툴팁과 시트 헤더가 **이 배열을 함께** 쓴다.
 *
 * ⚠️ 문구를 각자 짓지 말 것. 한쪽이 "이 달 중 시작 예정"이고 다른 쪽이 "시작 예정"이면
 *    같은 수를 다른 이름으로 부르는 꼴이라 읽는 사람이 두 화면을 대조하지 못한다.
 */
export function rosterExtraParts(counts: { upcoming: number; ended: number }): string[] {
  const parts: string[] = [];
  if (counts.ended > 0) parts.push(`이 달 중 종료 ${counts.ended}명`);
  if (counts.upcoming > 0) parts.push(`이 달 중 시작 예정 ${counts.upcoming}명`);
  return parts;
}

/** "학생 4명 +1"의 꼬리표(카드 툴팁) — 없으면 null. 조각은 `rosterExtraParts` 단일 소스. */
export function rosterExtraTitle(counts: { on: number; upcoming: number; ended: number }): string | null {
  const parts = rosterExtraParts(counts);
  if (parts.length === 0) return null;
  return `현재 재원 ${counts.on}명 · ${parts.join(" · ")} — 시트엔 회색 줄로 남습니다`;
}
