// scripts/_classnote/class-route-decide.mjs — 수학 발송 경로 판정(순수, 의존성 0 — Vitest).
//
// 수학 보고서는 **늘 반 보드**(aywa 반과 이름이 같은 ClassNote 반, 0302a 매칭 원아에게 1:1)로 간다.
// 🔴 2026-11-05 원장 *"이제 안쓰는 기능들 정리하고 반 보드 동기화만 남기면 될듯"* — 옛 보고서 설정 '수학 발송 경로'
//    (personal = `(수학)이름` 1인 보드 · pilot = 고른 강사만 반 보드, 2026-09-29~)를 걷었다. 1인 보드엔 원아를 배정하지 않아
//    (2026-11-04 원장 "앞으로 1인보드에 배정 시키지마 절대") 반별 말고는 보낼 곳이 없다. 설정값은 더 읽지 않는다
//    (앱 `classRouteActive`와 같은 규칙 — 모듈이 꺼진 학원은 앱이 큐에 넣지 않는다).

/** 반 보드 경로 대상 과목 — 수학(math·subject_1)만. 영어는 그룹 반 레일이 따로다. */
export const CLASS_ROUTE_SUBJECTS = new Set(["math", "subject_1"]);

/**
 * 이 보고서의 경로.
 * - 수학이 아니면 personal(영어 등은 이 판정과 무관 — 영어는 그룹 반 레일·원아 연결이 따로다).
 * - 수학 = 반 보드. 🔴 반 보드로 가야 하는데 **반 정보가 없으면**(보강) `needs_class` — 반을 **추측하지 않는다**.
 *   실제로 올릴 반은 아래 `pickRouteClass`가 정한다(원장 2026-09-30 — 보강 반이 곧 발송 반 · 보강 반이 없으면 `no_anchor`로
 *   **막는다**). 반별 경로에서 1인 보드로 돌아가는 길은 없다.
 * @param {{ subject?: string | null, class_id?: string | null }} report
 * @returns {"personal" | "class" | "needs_class"}
 */
export function decideRoute(report) {
  if (!CLASS_ROUTE_SUBJECTS.has(report?.subject ?? "")) return "personal";
  return report?.class_id ? "class" : "needs_class";
}

/**
 * 반별 경로에서 실제로 올릴 반 보드 고르기. 보강 출결 반과 전달 경로는 별도로 보존한다.
 * 앱 [`sendClassGateRow`](../../src/features/onescreen/send-class.ts)와 **같은 판정**(앱·워커 일치 표가 잠근다):
 * - 정규 보고서(`class_id` 있음) = 그 반 보드가 살아 있으면 그 반. 죽었으면 **막는다**(`board_missing`) — 다른 반·1인 보드로
 *   보내지 않는다(원장 결정 4 · 반 보드 동기화가 필요하다).
 * - 보강 보고서(반 없음): 보강 반은 출결 앵커이며 전달 반은 별도다(2026-11-12).
 *   · 전달 반이 다르면 수강·과목·배정 확인(sendEligible)을 통과해야 한다. 확인 못 하면 막는다.
 *   · 보강 반 보드가 살아 있으면 그 반. 죽었으면 막는다(`board_missing`).
 *   · 보강 반이 없으면('반 미정') 막는다(`no_anchor`) — 반을 추측하지 않는다.
 * 막힌 행은 워커가 failed + 한국어 사유로 둔다(`ROUTE_BLOCKED_MESSAGE`).
 * @param {{ route: "personal"|"class"|"needs_class", classId: string|null, classEligible: boolean,
 *           sendClassId?: string|null, makeupClassId?: string|null, makeupEligible?: boolean, sendEligible?: boolean }} a
 * @returns {{ route: "personal"|"class"|"blocked", classId: string|null, via: "personal"|"class"|"makeup"|"delivery"|"blocked",
 *             reason?: "board_missing"|"send_class_differs"|"no_anchor" }}
 */
export function pickRouteClass(a) {
  if (a.route === "personal") return { route: "personal", classId: a.classId ?? null, via: "personal" };
  if (a.classId) {
    return a.classEligible
      ? { route: "class", classId: a.classId, via: "class" }
      : { route: "blocked", classId: a.classId, via: "blocked", reason: "board_missing" };
  }
  if (!a.makeupClassId) return { route: "blocked", classId: null, via: "blocked", reason: "no_anchor" };
  if (a.sendClassId && a.sendClassId !== a.makeupClassId)
    return a.sendEligible === true
      ? { route: "class", classId: a.sendClassId, via: "delivery" }
      : { route: "blocked", classId: a.makeupClassId, via: "blocked", reason: "send_class_differs" };
  return a.makeupEligible
    ? { route: "class", classId: a.makeupClassId, via: "makeup" }
    : { route: "blocked", classId: a.makeupClassId, via: "blocked", reason: "board_missing" };
}

/** 막힌 행의 사유(한국어) — 발송 콘솔·원스크린 C.N 카드가 그대로 보여 준다. */
export const ROUTE_BLOCKED_MESSAGE = {
  board_missing: "반 보드가 없어 발송하지 않았습니다(다른 반으로 보내지 않습니다) — '지금 반 보드 동기화'(수업보고서 발송 큐)를 누른 뒤 다시 보내 주세요",
  send_class_differs: "선택한 반으로 이 학생의 보강 보고서를 보낼 수 없습니다 — 수강과 ClassNote 반 배정을 확인한 뒤 보낼 반을 다시 선택해 주세요",
  no_anchor: "보강 반이 정해지지 않아 발송하지 않았습니다 — 원스크린에서 보강 반을 골라 주세요",
};
