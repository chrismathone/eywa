/**
 * MCS **목표 레일** — `Start ─ Plan ─ Now ─ End` 네 점을 한 줄에 놓는 판정. 순수(Vitest).
 *
 * 원장이 가져온 옛 수학 프로그램 초안(2026-09-02, able "반별 진도 현황"·"학생 개별 진도 현황")의 핵심은
 * 그림 하나다 — 과정의 시작(Start)과 끝(End) 사이에 **오늘 계획상 있어야 할 자리(Plan)** 와 **실제로
 * 있는 자리(Now)** 를 함께 찍고, 둘의 차이를 "N블럭 빠름/느림"으로 적는다. 우리 자리에 옮기면
 *  · 과정   = 그 달 **목표 구간**(math_month_goals의 목표 블록가 End, 달이 시작될 때의 위치가 Start)
 *  · 블럭   = 커리큘럼 **블록**(글로벌 위치 1칸 = 블록 1개, curriculum-position.ts)
 *  · Plan   = Start에서 End까지를 **그 달 수업일 수로 등분**해 지난 수업일만큼 나간 자리
 *  · Now    = 이 달 마지막 기록의 위치
 *
 * 🔴 **모르면 판정하지 않는다** — 목표가 없거나(End 없음) 위치가 한 번도 안 잡혔으면(Now 없음) 레일은
 *    회색이고 차이는 적지 않는다. "목표를 안 적었다"가 "느리다"로 둔갑하면 거짓 재촉이다(ECS goal-match와
 *    같은 규약). 아직 수업이 한 번도 안 지난 달도 판정하지 않는다(`not-started`).
 * 🔴 **차이 1블록는 소음이다** — 수학 반은 한 달에 4~9번 도는데 한 블록를 두 번에 나눠 하는 게 정상이라
 *    (progress-stall.ts 실측: 직전과 같은 진도가 학생 절반) ±1은 `on`(계획대로)으로 본다.
 * ⚠️ 위치를 여기서 풀지 않는다 — 커리큘럼 매칭은 **서버가 한 번**(`lesson-position.ts`) 하고 이 파일은 숫자만
 *    받는다(같은 판정을 두 곳에서 하지 않는다). 🔴 트랙(현행·선행)으로 레일을 가르지 않는다 — 위치는 학년 관통
 *    글로벌 값이라 한 줄로 충분하고, 갈랐더니 다음 학년 목표가 "목표 없음"으로 보였다(2026-09-02).
 */

export type RailTrack = "current" | "ahead";

export type RailPoint = {
  /** YYYY-MM-DD */
  date: string;
  /** 커리큘럼 글로벌 위치(그날 가장 뒤 블록). */
  position: number;
};

export type GoalRailInput = {
  /** 달이 시작되기 전 마지막 위치(이 트랙). 없으면 null → 이 달 첫 기록이 Start가 된다. */
  startBefore: number | null;
  /** 이 달 목표 위치(목표 블록 중 가장 뒤). 없거나 커리큘럼에 못 맞추면 null. */
  goalEnd: number | null;
  /** 이 달 기록 중 위치가 잡힌 날들(오름차순이 아니어도 된다). */
  points: readonly RailPoint[];
  /** 그 달 이 반의 수업일(열과 같은 목록). */
  dayDates: readonly string[];
  /** 오늘(KST). */
  today: string;
};

export type GoalRailStatus =
  /** 위치가 한 번도 안 잡혔다 — 레일을 그릴 수 없다. */
  | "no-data"
  /** 목표가 없다 — Start→Now만 그린다(경고 아님). */
  | "no-goal"
  /** 목표가 시작 위치보다 앞이거나 같다 — 견줄 구간이 없다(경고 아님, 목표를 다시 보라는 뜻). */
  | "goal-behind"
  /** 아직 이 달 수업이 한 번도 안 지났다 — 판정하지 않는다. */
  | "not-started"
  /** 목표에 이미 닿았다. */
  | "done"
  | "ahead"
  | "on"
  | "behind";

export type GoalRail = {
  start: number | null;
  now: number | null;
  /** Now를 준 기록의 날짜(이 달 기록이 없어 Start를 그대로 쓰면 null). */
  nowDate: string | null;
  end: number | null;
  /** 오늘 계획상 있어야 할 위치(Start~End 사이, 수업일 등분). 목표가 없으면 null. */
  plan: number | null;
  /** (Now − Start) / (End − Start), 0~100. 목표가 없으면 null. */
  progressPct: number | null;
  /** Now − Plan(블록). 양수=빠름 · 음수=느림. 판정 불가면 null. */
  diff: number | null;
  /** Now − Start(블록) — 목표가 없어도 "이 달 얼마나 움직였나"는 말할 수 있다. */
  moved: number | null;
  status: GoalRailStatus;
  elapsedDays: number;
  totalDays: number;
};

/** |diff| 가 이 값 이하면 `on`. */
export const RAIL_TOLERANCE = 1;

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function buildGoalRail(input: GoalRailInput): GoalRail {
  const totalDays = input.dayDates.length;
  const elapsedDays = input.dayDates.filter((d) => d <= input.today).length;
  const base: GoalRail = {
    start: null,
    now: null,
    nowDate: null,
    end: input.goalEnd,
    plan: null,
    progressPct: null,
    diff: null,
    moved: null,
    status: "no-data",
    elapsedDays,
    totalDays,
  };

  // 오늘까지의 기록만 — 미리 적힌 미래 기록이 있어도 "지금 어디"는 오늘 기준이다.
  const points = [...input.points]
    .filter((p) => p.date <= input.today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.position - b.position));

  const start = input.startBefore ?? points[0]?.position ?? null;
  if (start == null) return base;
  // Now = 마지막 기록. 복습으로 되돌아간 날이면 그대로 뒤로 간다(사실이 이긴다 — 최댓값으로 부풀리지 않는다).
  const last = points.length > 0 ? points[points.length - 1]! : null;
  const now = last ? last.position : start;
  const nowDate = last ? last.date : null;
  const moved = now - start;
  const seen: GoalRail = { ...base, start, now, nowDate, moved };

  if (input.goalEnd == null) {
    return { ...seen, status: "no-goal" };
  }
  const end = input.goalEnd;
  if (end <= start) {
    return { ...seen, status: "goal-behind" };
  }
  const span = end - start;
  const progressPct = clampPct((moved / span) * 100);
  if (now >= end) {
    return { ...seen, plan: end, progressPct: 100, diff: now - end, status: "done" };
  }
  if (elapsedDays === 0 || totalDays === 0) {
    return { ...seen, plan: start, progressPct, status: "not-started" };
  }
  const plan = start + Math.round((span * elapsedDays) / totalDays);
  const diff = now - plan;
  const status: GoalRailStatus =
    diff > RAIL_TOLERANCE ? "ahead" : diff < -RAIL_TOLERANCE ? "behind" : "on";
  return { ...seen, plan, progressPct, diff, status };
}

/**
 * 레일 위 좌표(0~100) — Start=0 · End=100. 목표가 없으면 Start→Now 구간을 통째로 그리기 위해
 * `moved`를 20블록 가득으로 본다(종전 진도 레일과 같은 눈금 — 한 달에 20블록 넘게 나가는 일은 드물다).
 */
export function railX(rail: GoalRail, position: number | null): number | null {
  if (position == null || rail.start == null) return null;
  const span = rail.end != null && rail.end > rail.start ? rail.end - rail.start : 20;
  return clampPct(((position - rail.start) / span) * 100);
}

/** 상태 한글 라벨 — 화면마다 문구를 새로 짓지 않는다(고정열 레일·툴바 집계가 같은 표를 읽는다). */
export const RAIL_STATUS_LABEL: Record<GoalRailStatus, string> = {
  "no-data": "위치 미상",
  "no-goal": "목표 없음",
  "goal-behind": "목표가 현재보다 앞이 아님",
  "not-started": "아직 수업 전",
  done: "목표 도달",
  ahead: "계획보다 빠름",
  on: "계획대로",
  behind: "계획보다 느림",
};

/** "+3블록 빠름" · "2블록 느림" · "계획대로" — 차이 문구 한 벌. 판정 불가면 null. */
export function railDiffLabel(rail: GoalRail): string | null {
  if (rail.diff == null) return null;
  if (rail.status === "done") return rail.diff > 0 ? `목표 도달 (+${rail.diff}블록)` : "목표 도달";
  if (rail.status === "on") return "계획대로";
  return rail.diff > 0 ? `${rail.diff}블록 빠름` : `${Math.abs(rail.diff)}블록 느림`;
}
