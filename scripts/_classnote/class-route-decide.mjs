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
 *   원장 결정(2026-09-29 "보낼 곳이 없으면 '선택'") = A안 — 원스크린 발송이 'ClassNote로 보낼 반'(0303a
 *   `classnote_class_id`: 메인 수업 또는 강사가 고른 반)을 적고, 워커는 그 반 보드로 보낸다. 그 칸이 빈 행
 *   (관리자 재발송처럼 그 단계를 안 지난 경로)은 **기존 1인 보드**로 보낸다(학부모에게는 지금처럼 간다 — 길을 잃지 않는다).
 * @returns {"personal" | "class" | "needs_class"}
 */
export function decideRoute(cfg, report) {
  if (!CLASS_ROUTE_SUBJECTS.has(report?.subject ?? "")) return "personal";
  const wantsClass = cfg.route === "class" || (cfg.route === "pilot" && cfg.pilot.has(report?.teacher_name ?? ""));
  if (!wantsClass) return "personal";
  return report?.class_id ? "class" : "needs_class";
}

/**
 * 반별 경로에서 **실제로 올릴 반 보드** 고르기(원장 2026-09-30).
 * - 보고서 반(class_id)에 살아 있는 반 보드가 있으면 그 반(종강이어도 연결이 남아 있으면 — *"클래스노트에 반이 살아있는 한은 계속"*).
 * - 없으면 앱이 정해 **적어 둔** '보낼 반'(0303a `classnote_class_id`)이 살아 있으면 그 반 — 앱의 최종 결정을 따른다
 *   (앱 `decideSendClass`가 보강 반을 1순위로 골라 적는다 · 강사가 경고를 보고 고른 반도 여기 적힌다).
 * - 🔴 적힌 값이 없거나 죽었고 반 없는 보강이면 **보강 추가 때 고른 반**(0171a `makeup_class_id`)이 살아 있을 때 그 반
 *   (원장 2026-09-30 *"애초에 보강 추가로 선택된 반에 보고서가 발송되면 되는거아닌가?"* — 적힌 값이 없던 옛 대기분).
 *   관리자 일괄 게이트(`sendClassGateRow`)와 같은 순서.
 * - 셋 다 없으면 기존 1인 보드(전환 전 대기분 등 1회성 폴백 — 원장 "그대로 두기").
 * @param {{ route: "personal"|"class"|"needs_class", classId: string|null, sendClassId: string|null|undefined,
 *           classEligible: boolean, sendEligible: boolean,
 *           makeupClassId?: string|null, makeupEligible?: boolean }} a
 * @returns {{ route: "personal"|"class", classId: string|null, via: "personal"|"class"|"makeup"|"send" }}
 */
export function pickRouteClass(a) {
  if (a.route === "personal") return { route: "personal", classId: a.classId ?? null, via: "personal" };
  if (a.route === "class" && a.classId && a.classEligible) return { route: "class", classId: a.classId, via: "class" };
  if (a.sendClassId && a.sendEligible) return { route: "class", classId: a.sendClassId, via: "send" };
  if (!a.classId && a.makeupClassId && a.makeupEligible) return { route: "class", classId: a.makeupClassId, via: "makeup" };
  return { route: "personal", classId: a.classId ?? null, via: "personal" };
}
