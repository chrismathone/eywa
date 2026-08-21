import type { ReviewDoc, ReviewEvaluator } from "./server/queries";

/**
 * 평가자 교체 판정 — 순수 함수(원장 2026-08-21 "평가 아직 안했으면 평가자 변경").
 * DB·검증(테넌트·재직)은 액션이 하고, "바꿔도 되는가 + 바꾸면 어떤 모양인가"만 여기서 결정한다.
 * 실패는 **한글 사유**(화면에 그대로), 성공은 새 evaluators/submissions.
 *
 * 🔴 이미 채점한 평가자는 거절 — 바꾸면 그 점수가 사라진다(불가역).
 * 🔴 선착순(open)은 지정 평가자가 없어 교체 대상 자체가 없다.
 */
export type ReplacePlan =
  | { error: string }
  | { evaluators: ReviewEvaluator[]; submissions: Record<string, ReviewDoc["submissions"][string]> };

export function planObserverReplacement(
  doc: Pick<ReviewDoc, "header" | "evaluators" | "submissions">,
  oldId: string,
  newUser: { id: string; name: string },
): ReplacePlan {
  if (!oldId || !newUser.id) return { error: "평가자 정보를 찾을 수 없습니다" };
  if (oldId === newUser.id) return { error: "같은 사람으로는 바꿀 수 없습니다" };
  if (doc.header?.observerMode === "open") {
    return { error: "선착순 평가는 평가자를 지정하지 않아 변경할 대상이 없습니다" };
  }

  const evaluators: ReviewEvaluator[] = Array.isArray(doc.evaluators) ? doc.evaluators : [];
  const target = evaluators.find((e) => e.id === oldId && e.kind === "observer");
  if (!target) return { error: "바꿀 평가자를 찾을 수 없습니다 — 새로고침 후 다시 시도하세요" };

  const submissions = { ...(doc.submissions ?? {}) };
  const oldSubmitted = !!submissions[oldId]?.scores?.some((v) => v > 0);
  if (oldSubmitted) return { error: "이미 채점을 마친 평가자는 변경할 수 없습니다" };

  if (newUser.id === doc.header?.teacherId) return { error: "평가 대상 강사는 평가자가 될 수 없습니다" };
  if (evaluators.some((e) => e.id === newUser.id)) return { error: "이미 이 평가의 평가자입니다" };

  const nextEvaluators = evaluators.map((e) =>
    e.id === oldId && e.kind === "observer"
      ? { id: newUser.id, name: newUser.name, kind: "observer" as const }
      : e,
  );
  delete submissions[oldId]; // 미채점이라 점수 없음 — 빈 슬롯 정리
  return { evaluators: nextEvaluators, submissions };
}
