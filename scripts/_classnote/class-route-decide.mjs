// scripts/_classnote/class-route-decide.mjs — 수학 발송 경로 판정(순수, 의존성 0 — Vitest).
//
// 원장 2026-09-29: 보고서 설정 '수학 발송 경로' = personal(기존 `(수학)이름` 1인 보드) · class(반 보드) ·
// pilot(고른 강사만 반 보드). 워커가 보고서마다 이 판정으로 경로를 정한다.
// 🔴 모르면 personal(지금 동작 그대로) — 설정이 비거나 이상한 값이면 새 경로로 가지 않는다.

/** 반 보드 경로 대상 과목 — 수학(math·subject_1)만. 영어는 그룹 반 레일이 따로다. */
export const CLASS_ROUTE_SUBJECTS = new Set(["math", "subject_1"]);

/**
 * 설정 원문(tenant_settings.data.report) → 정규화.
 * @param {{ classnoteMathRoute?: unknown, classnoteMathRoutePilot?: unknown } | null | undefined} report
 */
export function normalizeRouteConfig(report) {
  const route = ["personal", "class", "pilot"].includes(report?.classnoteMathRoute) ? report.classnoteMathRoute : "personal";
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
 *   원장 결정(2026-09-29 "보낼 곳이 없으면 '선택'") = 원스크린에서 강사가 보낼 반을 고르는 A안.
 *   그 화면이 생기기 전까지 워커는 needs_class를 **기존 1인 보드**로 보낸다(학부모에게는 지금처럼 간다 — 길을 잃지 않는다).
 * @returns {"personal" | "class" | "needs_class"}
 */
export function decideRoute(cfg, report) {
  if (!CLASS_ROUTE_SUBJECTS.has(report?.subject ?? "")) return "personal";
  const wantsClass = cfg.route === "class" || (cfg.route === "pilot" && cfg.pilot.has(report?.teacher_name ?? ""));
  if (!wantsClass) return "personal";
  return report?.class_id ? "class" : "needs_class";
}
