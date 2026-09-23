/**
 * **반 계획 보기**(인재원 영어 반 × 6영역, 월간 ↔ 주간 대조) — 판정 단일 소스(순수 · Vitest).
 *
 * 원장 2026-09-23: *"지금 반별로 접속해야 인재원 영어의 6개 항목을 월간 주간 볼 수 있는데, 이걸
 * 스프레드시트처럼 반을 기준으로 모든 항목을 볼 수 있도록 전용 페이지"* → 시안 5종 중 **C안(대조)** 채택.
 *
 * 한 칸 = (반, 영역) — 그 달 월간 목표와 그 주 주간 목표를 나란히 놓고 넷 중 하나로 가른다:
 *  · `same`      같은 교재로 진행(주간 교재가 비었으면 견줄 것이 없어 여기로 — 거짓 경보 금지)
 *  · `diff`      주간 교재가 월간과 다르다
 *  · `weekEmpty` 월간은 있는데 이번 주가 비어 있다
 *  · `none`      월간 목표가 없다
 *
 * 🔴 교재 비교는 [`sameBookName`](./goal-match.ts) 그대로다 — 월간 뷰의 '목표 밖 교재' 경고와 **같은 눈**으로
 *    봐야 한 화면은 같다는데 다른 화면은 다르다는 일이 없다(`그래머인사이드` ⊂ `그래머인사이드LV3`).
 * 🔴 **EiE는 대상이 아니다** — EiE 반의 왼쪽 표는 영역이 아니라 `In-class·Homework·Test`다([`goal-areas.ts`]).
 *    이 화면은 인재원 영어(+미분류, 비대칭 규약) 반만 세운다 — 그 거르기는 서버 조회가 한다.
 */
import { sameBookName } from "./goal-match";

/** 목표를 적은 사람 — 반 시트 왼쪽 계획 표의 두 구역. */
export type GoalOwner = "homeroom" | "assistant";
/**
 * 계획 보기 — 전체 / 담임 / 부담임(원장 2026-09-23 *"'전체/담임/부담임'으로 보기 확장"*).
 * 전체 = 두 사람 것을 한 칸에 함께(둘 다 있으면 `담)`·`부)`로 가른다 — 화면이 한다).
 */
export type GoalsBoardRole = "all" | GoalOwner;
export const GOALS_BOARD_ROLES: readonly GoalsBoardRole[] = ["all", "homeroom", "assistant"];
export const DEFAULT_GOALS_BOARD_ROLE: GoalsBoardRole = "homeroom";
const OWNERS: readonly GoalOwner[] = ["homeroom", "assistant"];

export function normalizeGoalsBoardRole(raw: unknown): GoalsBoardRole {
  return raw === "all" || raw === "assistant" ? raw : DEFAULT_GOALS_BOARD_ROLE;
}

/** 보기 단위 — 일간(월·주·일 세 줄, 기본) / 주간(월·주 두 줄). 원장 2026-09-23 MCS 진도맵 툴바 참고. */
export type GoalsBoardView = "day" | "week";
export const GOALS_BOARD_VIEWS: readonly GoalsBoardView[] = ["day", "week"];
export const DEFAULT_GOALS_BOARD_VIEW: GoalsBoardView = "day";
export function normalizeGoalsBoardView(raw: unknown): GoalsBoardView {
  return raw === "week" ? "week" : DEFAULT_GOALS_BOARD_VIEW;
}

export type GoalText = { textbook: string | null; targetProgress: string | null };
export type GoalCellState = "same" | "diff" | "weekEmpty" | "none";
export const GOAL_STATE_DOT: Record<GoalCellState, string> = {
  same: "bg-green",
  diff: "bg-amber",
  weekEmpty: "bg-neutral-fill",
  none: "",
};

/** 칸에 적힌 것이 있나 — 입력했다 지운 행(빈 문자열)은 없는 것과 같다. */
export function hasGoal(g: GoalText | null | undefined): g is GoalText {
  return !!g && (!!g.textbook?.trim() || !!g.targetProgress?.trim());
}

export function goalCellState(
  month: GoalText | null | undefined,
  week: GoalText | null | undefined,
): GoalCellState {
  if (!hasGoal(month)) return "none";
  if (!hasGoal(week)) return "weekEmpty";
  // 한쪽 교재가 비면 sameBookName이 true — "비교 불가"를 "다름"으로 읽지 않는다.
  return sameBookName(month.textbook, week.textbook) ? "same" : "diff";
}

export type GoalsBoardCounts = Record<GoalCellState, number>;

export function countGoalCells(states: readonly GoalCellState[]): GoalsBoardCounts {
  const out: GoalsBoardCounts = { same: 0, diff: 0, weekEmpty: 0, none: 0 };
  for (const s of states) out[s] += 1;
  return out;
}

/** 목표 행 → (반|영역) 키 맵. 한 반·한 역할·한 기간·한 영역은 유니크(0-row 또는 1-row). */
export type GoalRow = {
  class_id: string;
  scope: string;
  role: string;
  skill_area: string;
  textbook: string | null;
  target_progress: string | null;
};

export const goalKey = (classId: string, area: string) => `${classId}|${area}`;

/** 한 칸의 목표 — 누가 적었나와 함께. 배열 순서는 언제나 담임 → 부담임. */
export type RoleGoal = { role: GoalOwner; goal: GoalText };

/**
 * 목표 행 → (반|영역)별 `RoleGoal[]`(적힌 것만). `role`이 `all`이면 두 사람 것, 아니면 그 사람 것만.
 */
export function indexGoals(
  rows: readonly GoalRow[],
  role: GoalsBoardRole,
): { month: Map<string, RoleGoal[]>; week: Map<string, RoleGoal[]> } {
  const owners = role === "all" ? OWNERS : [role];
  const raw = { month: new Map<string, Partial<Record<GoalOwner, GoalText>>>(), week: new Map<string, Partial<Record<GoalOwner, GoalText>>>() };
  for (const r of rows) {
    if (!(owners as readonly string[]).includes(r.role)) continue;
    const target = r.scope === "month" ? raw.month : r.scope === "week" ? raw.week : null;
    if (!target) continue;
    const key = goalKey(r.class_id, r.skill_area);
    target.set(key, { ...target.get(key), [r.role]: { textbook: r.textbook, targetProgress: r.target_progress } });
  }
  const flatten = (m: Map<string, Partial<Record<GoalOwner, GoalText>>>) =>
    new Map(
      [...m].map(([k, v]) => [
        k,
        owners.flatMap((o) => (hasGoal(v[o]) ? [{ role: o, goal: v[o]! }] : [])),
      ]),
    );
  return { month: flatten(raw.month), week: flatten(raw.week) };
}

/**
 * 칸 상태 — 여러 사람 것이 있으면 **같은 사람**의 월간·주간을 먼저 견준다(담임 → 부담임).
 * 한 사람이 월간만, 다른 사람이 주간만 적었으면 둘을 견준다(적힌 사실끼리).
 */
export function goalCellStateOf(month: readonly RoleGoal[], week: readonly RoleGoal[]): GoalCellState {
  for (const m of month) {
    const w = week.find((x) => x.role === m.role);
    if (w) return goalCellState(m.goal, w.goal);
  }
  return goalCellState(month[0]?.goal, week[0]?.goal);
}

/**
 * **일간**(원장 2026-09-23 *"일간으로 입력해놓은것도 오늘날짜 기준으로 확인"*) — 그 날 반 시트에 적힌 계획 줄.
 * 칸에 적는 건 교재·진도뿐이다(쪽수·과제는 전문 툴팁). 빈 줄(입력했다 지운 줄)은 뺀다.
 * 🔴 **자리(JJ·LAB) 교시 줄은 뺀다** — 그 칸은 반 진도가 아니라 학생 개별 진도(인재원 SRS 등)라 반의
 *    월간·주간 목표와 나란히 놓을 축이 아니다(월간 뷰 '목표 밖 교재' 판정과 같은 규약, goal-match 🔴).
 */
export type DayLine = { textbook: string | null; progress: string | null; pageRange: string | null; homework: string | null };
export type PlanLineRow = {
  class_id: string;
  slot_start: string;
  skill_area: string;
  line_no: number;
  textbook: string | null;
  page_range: string | null;
  progress: string | null;
  homework: string | null;
};

const filled = (v: string | null | undefined) => !!v?.trim();

export function indexDayLines(
  rows: readonly PlanLineRow[],
  seatStartsByClass: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, DayLine[]> {
  const out = new Map<string, DayLine[]>();
  const sorted = [...rows].sort(
    (a, b) => a.slot_start.localeCompare(b.slot_start) || a.line_no - b.line_no,
  );
  for (const r of sorted) {
    if (seatStartsByClass.get(r.class_id)?.has(r.slot_start.slice(0, 5))) continue;
    if (![r.textbook, r.page_range, r.progress, r.homework].some(filled)) continue;
    const key = goalKey(r.class_id, r.skill_area);
    const arr = out.get(key) ?? [];
    arr.push({ textbook: r.textbook, progress: r.progress, pageRange: r.page_range, homework: r.homework });
    out.set(key, arr);
  }
  return out;
}
