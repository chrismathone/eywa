/**
 * 모듈 저장 형식 v1이 알던 목록이다. 새 모듈을 추가해도 이 배열은 절대 바꾸지 않는다.
 * 일반판의 옛 저장 행은 `known`이 없으므로 이 목록까지만 봤다고 해석한다.
 */
export const MODULE_BASELINE_V1 = Object.freeze([
  "ecs",
  "mcs",
  "makeups",
  "seat_attendance",
  "textbooks",
  "shuttle",
  "inventory",
  "kiosk",
  "newcomers",
  "retention",
  "approvals",
  "class_review",
  "calendar",
  "classnote",
  "makeedu",
  "sheet_sync",
  "eie",
  "session_billing",
  "payroll",
  "staff_leaves",
]);

/** 현재 앱이 아는 모듈 목록. 새 모듈은 여기에만 더하고 위 v1 기준 목록은 그대로 둔다. */
export const MODULE_IDS = Object.freeze([...MODULE_BASELINE_V1]);

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** 현재 목록에 있는 id만 정의 순서로 돌려준다. */
export function normalizeModuleIds(raw, moduleIds = MODULE_IDS) {
  if (!Array.isArray(raw)) return [];
  const values = new Set(raw.filter((value) => typeof value === "string"));
  return moduleIds.filter((id) => values.has(id));
}

/**
 * `known`은 서버가 만든 완전한 목록이어야 한다. v1 id는 저장 누락·변조로 빠져도 다시 채워
 * 보강처럼 DB 가드가 저장값을 직접 보는 기존 모듈이 실효 차집합으로만 꺼지지 않게 한다.
 */
export function normalizeKnownModuleIds(raw, moduleIds = MODULE_IDS) {
  const current = new Set(moduleIds);
  const known = new Set(MODULE_BASELINE_V1.filter((id) => current.has(id)));
  if (Array.isArray(raw)) {
    for (const value of raw) if (typeof value === "string" && current.has(value)) known.add(value);
  }
  return moduleIds.filter((id) => known.has(id));
}

/**
 * 저장 원문을 앱·워커가 함께 쓰는 실효 꺼짐 목록으로 푼다.
 * 일반판만 `disabled ∪ (현재 목록 - 저장 당시 known)`을 적용하고, 침산은 known을 무시한다.
 */
export function effectiveDisabledModulesFromStored(stored, moduleIds = MODULE_IDS) {
  const root = isObject(stored) ? stored : {};
  const generic = root.preset === "generic";
  const modules = isObject(root.modules) ? root.modules : null;
  const defaultDisabled = generic ? moduleIds.filter((id) => id !== "makeups") : [];
  const disabled = normalizeModuleIds(Array.isArray(modules?.disabled) ? modules.disabled : defaultDisabled, moduleIds);
  if (!generic) return disabled;

  const known = new Set(normalizeKnownModuleIds(modules?.known, moduleIds));
  const off = new Set(disabled);
  for (const id of moduleIds) if (!known.has(id)) off.add(id);
  return moduleIds.filter((id) => off.has(id));
}

/** 해석 결과에 실을 저장 당시 known 목록. */
export function knownModulesFromStored(stored, moduleIds = MODULE_IDS) {
  const root = isObject(stored) ? stored : {};
  const modules = isObject(root.modules) ? root.modules : null;
  return normalizeKnownModuleIds(modules?.known, moduleIds);
}
