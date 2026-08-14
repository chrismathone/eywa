/**
 * 휴가 **신청 일수** 계산 — 순수 함수. 잔여 초과 판정(= 신청 거절)의 근거가 되는 숫자라
 * 신청자가 손으로 못 고치게 **여기서만** 만든다(입력값은 날짜와 종류뿐).
 *
 * ⚠️ 규칙(2026-08-14 v1 가정): **일요일은 세지 않는다.** 학원은 토요일도 운영해(주말 교시가 있다)
 *    "주말 제외"로 뭉뚱그리면 토요일 연차가 공짜가 된다. 일요일만 빼는 게 지금 학원 운영과 가장
 *    가까운 근사다. 🔴 **바꿀 땐 이 함수 한 곳만** 고치면 화면·검증·표시가 함께 따라온다
 *    (학원 휴원일 목록은 아직 소비하지 않는다 — `operations.holidays`가 실데이터로 비어 있어
 *     연결해도 동작이 없고, 학생 휴원일 ≠ 직원 휴무일이라 의미도 다르다).
 */

import { weekdayIndexOf } from "@/lib/date-kst";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 휴가 종류 — 연차(하루 단위) / 반차(0.5일, 하루만). */
export const LEAVE_KINDS = ["annual", "half"] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];

export function isLeaveKind(v: string): v is LeaveKind {
  return (LEAVE_KINDS as readonly string[]).includes(v);
}

const SUNDAY = 0;

/**
 * 차감 일수. 반차는 0.5일(하루만), 연차는 시작~종료 중 **일요일을 뺀** 날 수.
 * 형식 오류·역순 범위·반차인데 여러 날 = 0(호출부가 검증 메시지로 거른다).
 */
export function countLeaveDays(start: string, end: string, kind: LeaveKind): number {
  if (!YMD.test(start) || !YMD.test(end) || end < start) return 0;
  if (kind === "half") return start === end ? 0.5 : 0;

  let days = 0;
  let cursor = start;
  // 최대 366회 — 신청 범위 상한(1년)을 넘는 입력은 아래 validate가 먼저 거른다.
  for (let i = 0; cursor <= end && i < 400; i += 1) {
    if (weekdayIndexOf(cursor) !== SUNDAY) days += 1;
    cursor = nextDay(cursor);
  }
  return days;
}

function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** 신청 범위 상한 — 한 건이 한 달을 넘으면 연차 구간(1년)을 걸치기 쉬워 실수로 본다. */
const MAX_SPAN_DAYS = 31;

/**
 * 신청 폼 검증 — 통과하면 null, 아니면 **한글 메시지**(화면에 그대로 띄운다).
 * 연차 구간(입사일 기준 1년)을 걸치는 신청은 거른다: 두 구간에서 나눠 차감해야 하는데
 * 한 건으로는 표현할 수 없다(조용히 한쪽에서만 빼면 잔여가 틀어진다).
 */
export function validateLeaveRange(args: {
  start: string;
  end: string;
  kind: LeaveKind;
  /** 시작일이 속한 연차 구간의 끝(YYYY-MM-DD). 없으면 구간 검사를 건너뛴다. */
  periodEnd?: string | null;
}): string | null {
  const { start, end, kind, periodEnd } = args;
  if (!YMD.test(start) || !YMD.test(end)) return "휴가 날짜를 선택하세요";
  if (end < start) return "종료일이 시작일보다 앞섭니다";
  if (kind === "half" && start !== end) return "반차는 하루만 신청할 수 있습니다";

  const span = countCalendarDays(start, end);
  if (span > MAX_SPAN_DAYS) return `한 번에 신청할 수 있는 기간은 최대 ${MAX_SPAN_DAYS}일입니다`;
  if (periodEnd && end > periodEnd) {
    return `연차 사용 기간(${periodEnd}까지)을 넘습니다 — 기간을 나눠 신청하세요`;
  }

  if (countLeaveDays(start, end, kind) <= 0) {
    return "신청 기간에 차감할 날이 없습니다(일요일은 연차에서 빠집니다)";
  }
  return null;
}

/** 달력일 수(시작·종료 포함) — 범위 상한 검사용. */
function countCalendarDays(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / 86_400_000) + 1;
}

/** 일수 표기 — 0.5는 "0.5일", 정수는 "3일"(불필요한 소수점 제거). */
export function formatLeaveDays(days: number): string {
  return `${Number.isInteger(days) ? days : days.toFixed(1)}일`;
}
