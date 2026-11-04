// scripts/_classnote/class-route-decide.mjs — 수학 발송 경로 판정(순수, 의존성 0 — Vitest).
//
// 원장 2026-09-29: 보고서 설정 '수학 발송 경로' = personal(기존 `(수학)이름` 1인 보드) · class(반 보드) ·
// pilot(고른 강사만 반 보드). 워커가 보고서마다 이 판정으로 경로를 정한다.
// 🔴 모르면 class(2026-11-04 — 1인 보드에 원아를 배정하지 않아 personal은 보낼 곳이 없다 · 원장 "앞으로 1인보드에 배정
//    시키지마 절대" · 앱 `classRouteAppliesTo`·DEFAULT_SETTINGS와 같은 기본). 저장된 personal·pilot은 그대로 따른다(화면이 바꾸게 안내).

/** 반 보드 경로 대상 과목 — 수학(math·subject_1)만. 영어는 그룹 반 레일이 따로다. */
export const CLASS_ROUTE_SUBJECTS = new Set(["math", "subject_1"]);

/**
 * 설정 원문(tenant_settings.data.report) → 정규화.
 * @param {{ classnoteMathRoute?: unknown, classnoteMathRoutePilot?: unknown } | null | undefined} report
 */
export function normalizeRouteConfig(report) {
  // 저장값이 없으면 class(2026-11-04 — 1인 보드에 원아를 배정하지 않아 personal은 보낼 곳이 없다 · 앱 DEFAULT_SETTINGS와 같은 기본).
  const route = ["personal", "class", "pilot"].includes(report?.classnoteMathRoute) ? report.classnoteMathRoute : "class";
  const pilot = Array.isArray(report?.classnoteMathRoutePilot)
    ? report.classnoteMathRoutePilot.filter((s) => typeof s === "string" && s.trim())
    : [];
  return { route, pilot: new Set(pilot) };
}

/**
 * 이 보고서의 경로.
 * - 수학이 아니면 personal(영어 등은 이 설정과 무관).
 * - class = 전원 반 보드 · pilot = 작성 강사(teacher_name 원문 일치)가 목록에 있을 때만 반 보드.
 * - 🔴 반 보드로 가야 하는데 **반 정보가 없으면**(보강 등) `needs_class` — 반을 **추측하지 않는다**.
 *   실제로 올릴 반은 아래 `pickRouteClass`가 정한다(원장 2026-09-30 — 보강 반이 곧 발송 반 · 보강 반이 없으면 `no_anchor`로
 *   **막는다**). 반별 경로에서 1인 보드로 돌아가는 길은 없다(2026-09-29의 "'보낼 반'이 빈 행은 1인 보드로"는 09-30에 바뀌었다 —
 *   1인 보드 원아 배정도 2026-11-02에 해제했다).
 * @returns {"personal" | "class" | "needs_class"}
 */
export function decideRoute(cfg, report) {
  if (!CLASS_ROUTE_SUBJECTS.has(report?.subject ?? "")) return "personal";
  const wantsClass = cfg.route === "class" || (cfg.route === "pilot" && cfg.pilot.has(report?.teacher_name ?? ""));
  if (!wantsClass) return "personal";
  return report?.class_id ? "class" : "needs_class";
}

/**
 * 반별 경로에서 **실제로 올릴 반 보드** 고르기 — 🔴 원장 2026-09-30: 보고서 반 = 출석부 반 = 발송 반.
 * 앱 [`sendClassGateRow`](../../src/features/onescreen/send-class.ts)와 **같은 판정**(앱·워커 일치 표가 잠근다):
 * - 정규 보고서(`class_id` 있음) = 그 반 보드가 살아 있으면 그 반. 죽었으면 **막는다**(`board_missing`) — 다른 반·1인 보드로
 *   보내지 않는다(원장 결정 4 · 반 보드 동기화가 필요하다).
 * - 보강 보고서(반 없음) = **보강 반**(0171a `makeup_class_id`)이 곧 발송 반이다.
 *   · 적힌 '보낼 반'(0303a `classnote_class_id`)이 보강 반과 다르면 **막는다**(`send_class_differs`) — 보고서 반 ≠ 발송 반.
 *   · 보강 반 보드가 살아 있으면 그 반. 죽었으면 막는다(`board_missing`).
 *   · 보강 반이 없으면('반 미정') 막는다(`no_anchor`) — 반을 추측하지 않는다.
 * 막힌 행은 워커가 failed + 한국어 사유로 둔다(`ROUTE_BLOCKED_MESSAGE`).
 * @param {{ route: "personal"|"class"|"needs_class", classId: string|null, classEligible: boolean,
 *           sendClassId?: string|null, makeupClassId?: string|null, makeupEligible?: boolean }} a
 * @returns {{ route: "personal"|"class"|"blocked", classId: string|null, via: "personal"|"class"|"makeup"|"blocked",
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
    return { route: "blocked", classId: a.makeupClassId, via: "blocked", reason: "send_class_differs" };
  return a.makeupEligible
    ? { route: "class", classId: a.makeupClassId, via: "makeup" }
    : { route: "blocked", classId: a.makeupClassId, via: "blocked", reason: "board_missing" };
}

/** 막힌 행의 사유(한국어) — 발송 콘솔·원스크린 C.N 카드가 그대로 보여 준다. */
export const ROUTE_BLOCKED_MESSAGE = {
  board_missing: "반 보드가 없어 발송하지 않았습니다(다른 반으로 보내지 않습니다) — '지금 반 보드 동기화'(수업보고서 발송 큐)를 누른 뒤 다시 보내 주세요",
  send_class_differs: "보낼 반이 보강 반과 달라 발송하지 않았습니다 — 원스크린에서 보강 반을 확인해 주세요",
  no_anchor: "보강 반이 정해지지 않아 발송하지 않았습니다 — 원스크린에서 보강 반을 골라 주세요",
};
