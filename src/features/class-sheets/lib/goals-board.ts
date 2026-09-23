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

export type GoalsBoardRole = "homeroom" | "assistant";
export const GOALS_BOARD_ROLES: readonly GoalsBoardRole[] = ["homeroom", "assistant"];
export const DEFAULT_GOALS_BOARD_ROLE: GoalsBoardRole = "homeroom";

export function normalizeGoalsBoardRole(raw: unknown): GoalsBoardRole {
  return raw === "assistant" ? "assistant" : DEFAULT_GOALS_BOARD_ROLE;
}

export type GoalText = { textbook: string | null; targetProgress: string | null };
export type GoalCellState = "same" | "diff" | "weekEmpty" | "none";

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

export function indexGoals(
  rows: readonly GoalRow[],
  role: GoalsBoardRole,
): { month: Map<string, GoalText>; week: Map<string, GoalText> } {
  const month = new Map<string, GoalText>();
  const week = new Map<string, GoalText>();
  for (const r of rows) {
    if (r.role !== role) continue;
    const target = r.scope === "month" ? month : r.scope === "week" ? week : null;
    if (!target) continue;
    target.set(goalKey(r.class_id, r.skill_area), {
      textbook: r.textbook,
      targetProgress: r.target_progress,
    });
  }
  return { month, week };
}
