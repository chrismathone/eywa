/**
 * 시간표 쪽이 맡는 과목 칸(강사 순서 · 통합뷰 그룹 · 보관함)의 **저장 전 다듬기** — 순수(Vitest).
 *
 * 🔴 다듬기와 보관함 도장은 **중앙 저장이 방금 읽은 값으로** 정한다. 화면용 서버 액션(saveIntegrationGroups)에만 두면
 *    저장 액션을 직접 부르는 요청이 빈 줄·중복 배정·남의 이름 도장을 그대로 저장할 수 있다.
 *  · 강사 순서: 앞뒤 공백·빈 값·중복 제거(먼저 나온 것이 이긴다). 다 비면 그 칸을 지운다.
 *  · 그룹(줄): 제목 없는 줄 제거 · 줄 사이 반 중복 제거(먼저 나온 줄이 갖는다 — 화면 렌더 규칙과 같은 순서).
 *  · 보관함: 같은 규칙 + 이름 없는 항목 제거. '누가·언제'는 **요청이 보낸 값을 믿지 않는다** —
 *    내용이 그대로인 항목은 저장돼 있던 도장을 유지하고, 새로 생겼거나 바뀐 항목만 지금 저장하는 사람·시각을 찍는다.
 */
import type { SubjectFieldsPatch } from "./operations-slice";
import type { IntegrationGroupPresetSetting, IntegrationGroupSetting, SubjectSetting } from "./settings-types";

export function sanitizeGroups(groups: readonly IntegrationGroupSetting[]): IntegrationGroupSetting[] {
  const seen = new Set<string>();
  return groups
    .map((g) => ({ ...g, title: g.title.trim() }))
    .filter((g) => g.title)
    .map((g) => ({
      id: g.id,
      title: g.title,
      classIds: g.classIds.filter((id) => (seen.has(id) ? false : (seen.add(id), true))),
    }));
}

export function sanitizeTeacherOrder(order: readonly string[]): string[] {
  const seen = new Set<string>();
  return order.map((n) => n.trim()).filter((n) => n && !seen.has(n) && (seen.add(n), true));
}

type PresetBody = Pick<IntegrationGroupPresetSetting, "id" | "name" | "groups" | "showOthers" | "othersTitle">;

/** 도장을 뺀 보관함 항목(다듬은 값). 이름이 비면 null — 목록에서 고를 수 없는 유령 항목이 된다. */
export function cleanPreset(preset: PresetBody): PresetBody | null {
  const name = preset.name.trim();
  if (!name) return null;
  const othersTitle = preset.othersTitle?.trim() || undefined;
  return {
    id: preset.id,
    name,
    groups: sanitizeGroups(preset.groups),
    ...(preset.showOthers === undefined ? {} : { showOthers: preset.showOthers }),
    ...(othersTitle ? { othersTitle } : {}),
  };
}

// ⚠️ 객체를 그대로 stringify하면 키 순서에 걸린다 — 저장본은 jsonb라 키가 재정렬돼 돌아오므로, "안 바뀐 항목"이
//    매번 바뀐 걸로 잡혀 저장 시각이 계속 갱신된다. 배열로 눕혀 순서를 못박는다.
const presetBody = (p: PresetBody) =>
  JSON.stringify([p.name, (p.groups ?? []).map((g) => [g.id, g.title, g.classIds ?? []]), p.showOthers !== false, p.othersTitle ?? ""]);

/** 보관함에 도장을 찍는다 — 내용이 그대로면 기존 도장, 아니면 지금 저장하는 사람·시각. */
export function stampPresets(
  incoming: readonly PresetBody[],
  stored: readonly IntegrationGroupPresetSetting[],
  stamp: { by: string | undefined; at: string },
): IntegrationGroupPresetSetting[] {
  const storedById = new Map(stored.map((p) => [p.id, p]));
  return incoming.flatMap((raw) => {
    const cleaned = cleanPreset(raw);
    if (!cleaned) return [];
    const before = storedById.get(cleaned.id);
    const unchanged = before && presetBody(before) === presetBody(cleaned);
    const mark = unchanged ? { savedBy: before.savedBy, savedAt: before.savedAt } : { savedBy: stamp.by, savedAt: stamp.at };
    return [{ ...cleaned, ...(mark.savedBy ? { savedBy: mark.savedBy } : {}), ...(mark.savedAt ? { savedAt: mark.savedAt } : {}) }];
  });
}

/**
 * 요청 조각을 저장할 값으로 — `freshSubject` = 방금 읽은 그 과목 행(보관함 도장의 기준).
 * `null`(지우기)과 안 보낸 칸(그대로 두기)은 그대로 통과한다.
 */
export function normalizeSubjectFields(
  fields: SubjectFieldsPatch,
  freshSubject: SubjectSetting,
  stamp: { by: string | undefined; at: string },
): SubjectFieldsPatch {
  const out: SubjectFieldsPatch = { ...fields };
  if (Array.isArray(fields.teacherViewOrder)) {
    const order = sanitizeTeacherOrder(fields.teacherViewOrder);
    out.teacherViewOrder = order.length ? order : null;
  }
  if (Array.isArray(fields.integrationGroups)) out.integrationGroups = sanitizeGroups(fields.integrationGroups);
  if (typeof fields.integrationOthersTitle === "string") out.integrationOthersTitle = fields.integrationOthersTitle.trim() || null;
  if (Array.isArray(fields.integrationGroupPresets)) {
    out.integrationGroupPresets = stampPresets(fields.integrationGroupPresets, freshSubject.integrationGroupPresets ?? [], stamp);
  }
  return out;
}
