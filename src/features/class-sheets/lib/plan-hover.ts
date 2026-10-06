/**
 * 달력 교시 줄의 **마우스 오버 = 지금 일정 ⇔ 원래 계획**(원장 2026-10-06 *"마우스 호버로 올리면 원래계획이랑 지금 < = > 원래계획
 * 이렇게 바로 볼 수 있게"*). 순수 모듈(Vitest로 잠금).
 *
 * 🔑 두 벌은 서버가 이미 계산한다(textbooks/server/month-plan.ts) — **원래 계획**(`baselineByCell`, 미루기 미반영)과
 *    **지금 일정**(`byCell`, 미룸·당김 반영 = [가져오기]가 옮기는 값). 여기서 다시 계산하지 않고 글로만 접는다.
 * 🔑 같으면 한 줄("원래 계획 = 지금"), 다르면 두 줄. 한쪽이 비면 '없음'(미룸으로 이 칸이 비었다는 사실 그대로).
 */
import type { PlannedLine } from "@/features/textbooks/plan-expand";

export type PlanHover =
  | { kind: "same"; plan: string }
  | { kind: "diff"; now: string; base: string };

/** 한 칸의 계획 줄들 → 비교용 한 줄 글. 줄이 여럿(영역이 여럿)이면 ` · `로 잇는다. */
export function planLinesText(lines: readonly PlannedLine[], lessonLabel: (n: number) => string): string {
  return lines
    .map((p) => [`${p.title} ${lessonLabel(p.lessonNo)}`, p.progress].filter(Boolean).join(" "))
    .join(" · ");
}

/**
 * 원래 계획과 지금 일정을 견준다. 둘 다 없으면 null(툴팁을 달지 않는다).
 * `scheduled`가 `undefined`면(옛 데이터 — 서버가 일정을 안 실었다) 비교할 수 없으니 null.
 */
export function planHoverOf(
  baseline: readonly PlannedLine[],
  scheduled: readonly PlannedLine[] | undefined,
  lessonLabel: (n: number) => string,
): PlanHover | null {
  if (scheduled === undefined) return null;
  if (baseline.length === 0 && scheduled.length === 0) return null;
  const base = planLinesText(baseline, lessonLabel);
  const now = planLinesText(scheduled, lessonLabel);
  return base === now ? { kind: "same", plan: base } : { kind: "diff", now, base };
}
