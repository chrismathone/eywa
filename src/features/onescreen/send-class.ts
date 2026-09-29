/**
 * 반 정보 없는 보강 보고서의 **'ClassNote로 보낼 반'** 판정(순수 · Vitest).
 *
 * 원장 2026-09-29: 수학 반별 발송이면 보고서의 반 = ClassNote 반 보드인데, 보강 보고서는 반이 비어 있다.
 * → *"메인 수업으로 … 보고서가 가장 많이 발송되는 수업 또는 가장 많은 출결을 하는 수업"* ·
 *   *"'선택해서 보내도록'이 가장 베스트지. 길 잃는것보다 낫다. 보낼 곳이 없으면 '선택'"*.
 * 순서: 후보(그 학생이 다니는 반 보드 대상 수학 반)가 하나면 그 반 → 보낸 보고서가 가장 많은 반 →
 * 동률이면 출결이 가장 많은 반 → 그래도 동률이면 **정하지 않는다**(강사가 고른다).
 * ⚠️ 경로 판정은 워커 [`class-route-decide.mjs`](../../../scripts/_classnote/class-route-decide.mjs)와 **같은 규칙**이어야 한다
 *    (.mjs라 import로 공유하지 못해 옮겨 적었다 — send-class.test.ts가 같은 표를 고정한다).
 */

export const SEND_CLASS_SUBJECTS: ReadonlySet<string> = new Set(["math", "subject_1"]);

/** 이 강사의 수학 보고서가 반 보드로 가는가(보고서 설정 '수학 발송 경로'). 모르는 값 = 아니다(기존 방식). */
export function classRouteAppliesTo(
  report: { classnoteMathRoute?: string | null; classnoteMathRoutePilot?: readonly string[] | null },
  teacherName: string | null | undefined,
): boolean {
  if (report.classnoteMathRoute === "class") return true;
  if (report.classnoteMathRoute === "pilot") return (report.classnoteMathRoutePilot ?? []).includes(teacherName ?? "");
  return false;
}

/** 이 보고서에 '보낼 반'이 필요한가 — 수학 · 반 없음 · 반별 경로 대상 강사. */
export function needsSendClass(input: { subject?: string | null; classId?: string | null }, routeApplies: boolean): boolean {
  return routeApplies && !input.classId && SEND_CLASS_SUBJECTS.has(input.subject ?? "");
}

/**
 * 메인 수업 고르기. 정할 수 없으면 null(= 강사가 고른다).
 * @param candidates 후보 반 id(반 보드 대상 반만)
 * @param sent 반별 ClassNote로 보낸 보고서 수
 * @param attended 반별 출결 기록 수
 */
export function pickMainClass(
  candidates: readonly string[],
  sent: Readonly<Record<string, number>>,
  attended: Readonly<Record<string, number>>,
): string | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  const top = (score: (id: string) => number, ids: readonly string[]) => {
    const best = Math.max(...ids.map(score));
    return ids.filter((id) => score(id) === best);
  };
  const bySent = top((id) => sent[id] ?? 0, candidates);
  if (bySent.length === 1) return bySent[0]!;
  const byAtt = top((id) => attended[id] ?? 0, bySent);
  return byAtt.length === 1 ? byAtt[0]! : null;
}
