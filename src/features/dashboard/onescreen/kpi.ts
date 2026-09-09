/**
 * 한 화면 대시보드의 **상단 타일 숫자** — 순수 모듈(IO 없음, Vitest).
 *
 * 이 파일이 따로 있는 이유: 타일 넷 중 '오늘 출결'만 판정이 까다롭고, 그 판정이 틀리면 화면이
 * **거짓 안심**을 준다. 설계서 §2·§8이 못박은 것을 여기 한 곳에 담는다.
 */

import type { MetricValue } from "./live-plan";

/** 반 하나의 그날 출결 처리 현황(`ClassProcessing`에서 필요한 것만). */
export type ClassProgress = {
  classId: string;
  /** 활성 수강 학생 수(예정). */
  expected: number;
  /** 기록된 학생 수. */
  recorded: number;
};

export type TodayAttendance = {
  /**
   * 주숫자를 무엇으로 쓸까.
   * - `unmarked` = 아직 손도 안 댄 반이 있다 → **미기록 반 수**를 크게 적는다.
   * - `closed` = 시작한 반이 전부 기록됐다 → 그때서야 **출석률 %**를 적는다.
   * - `none` = 오늘 시작한 수업이 없다(이른 아침·휴일) → 숫자가 아니라 그 사실을 적는다.
   */
  mode: "unmarked" | "closed" | "none";
  /** 오늘 이미 시작한 반 수(분모). */
  startedClasses: number;
  /** 그중 한 명도 안 찍힌 반 수. */
  unmarkedClasses: number;
  /** 시작했지만 아직 다 못 찍은 반 수(부분 기록 포함). */
  inProgressClasses: number;
  /** 시작한 반 기준 기록/예정. */
  recorded: number;
  expected: number;
};

/**
 * 오늘 출결 타일.
 *
 * 🔴 **진행 중 출석률을 주숫자로 쓰지 않는다** — 121개 반 중 40개만 찍힌 %는 언제나 높아 보인다
 *    (안 찍힌 반의 결석이 아직 분자·분모 어디에도 없다). 아침 9시에 "출석률 98%"는 사실이 아니라
 *    **거짓 안심**이고, 그 시간에 원장이 봐야 하는 건 "아직 아무도 안 찍은 반이 몇 개인가"다.
 * 🔴 **아직 시작 안 한 교시를 분모에 넣지 않는다**(§8-2) — 넣으면 등원 시작 전부터 화면이 빨갛고,
 *    매일 아침 빨간 화면은 사흘이면 아무도 안 본다.
 * 🔴 **"오늘 수업이 없다"와 "다 찍었다"를 같은 초록으로 그리지 않는다**(§8-4) — `none`은 축하가 아니라
 *    그냥 오늘 잴 것이 없다는 뜻이다.
 */
export function todayAttendanceKpi(input: {
  /** 그날 반별 처리 현황. */
  processing: readonly ClassProgress[];
  /** 오늘 **이미 시작한** 반 id — 시간표에서 온다(`status !== "upcoming"`). */
  startedClassIds: ReadonlySet<string>;
}): TodayAttendance {
  const started = input.processing.filter((p) => input.startedClassIds.has(p.classId));
  // 예정 0명인 반(전원 퇴원·수강 없음)은 셀 것이 없다 — 분모에 넣으면 영영 안 채워지는 반이 남는다.
  const live = started.filter((p) => p.expected > 0);
  const expected = live.reduce((n, p) => n + p.expected, 0);
  // 🔴 `recorded`가 `expected`를 넘을 수 있다(보강 방문자가 그 반에 찍힌다) — 넘치면 잘라서 센다.
  //    안 자르면 "기록 > 예정"이 되어 출석률이 100%를 넘는다.
  const recorded = live.reduce((n, p) => n + Math.min(p.recorded, p.expected), 0);
  const unmarkedClasses = live.filter((p) => p.recorded === 0).length;
  const inProgressClasses = live.filter((p) => p.recorded < p.expected).length;
  const mode: TodayAttendance["mode"] =
    live.length === 0 ? "none" : unmarkedClasses > 0 ? "unmarked" : "closed";
  return {
    mode,
    startedClasses: live.length,
    unmarkedClasses,
    inProgressClasses,
    recorded,
    expected,
  };
}

/**
 * 마감된 뒤의 출석률(%) — `closed`가 아니면 **null**이다(모르는 것을 숫자로 적지 않는다).
 * 스냅샷의 `rate`를 그대로 쓰지 않는 이유: 그 값은 **찍힌 것만**으로 낸 비율이라 진행 중에도 값이 있다.
 */
export function closedAttendanceRate(
  today: TodayAttendance,
  snapshot: { rate: number; date: string } | null,
  todayYmd: string,
): number | null {
  if (today.mode !== "closed") return null;
  if (!snapshot || snapshot.date !== todayYmd) return null;
  return snapshot.rate;
}

/**
 * 타일의 왼쪽 3px 색 — 설계서 §2. 🔴 **색은 왼쪽 테두리에만** 쓴다(숫자를 물들이면 네 타일이
 * 신호등이 되어 정작 급한 하나가 안 보인다).
 */
export type TileTone = "positive" | "caution" | "critical" | "inert";

/** 오늘 출결 타일의 톤 — 미기록이 있으면 주의, 오래 남아 있으면 위험은 **목록**이 말한다. */
export function attendanceTone(today: TodayAttendance): TileTone {
  if (today.mode === "none") return "inert";
  if (today.mode === "closed") return "positive";
  return "caution";
}

/**
 * 값이 낡았거나(갱신 실패) 아예 못 읽었으면 톤을 죽인다 — 🔴 **실패를 초록으로 그리지 않는다**.
 * 조회가 안 되는데 "정상"으로 보이는 것이 이 화면의 최악이다.
 */
export function toneOf<T>(value: MetricValue<T> | null, tone: TileTone): TileTone {
  if (!value || value.stale) return "inert";
  return tone;
}
