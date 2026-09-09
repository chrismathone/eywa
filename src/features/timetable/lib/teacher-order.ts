/**
 * 기본뷰 **강사 열 순서** — 요일 묶음(월목/화금/수…)마다, 사람마다 다르게 저장하는 순수 규칙.
 *
 * 원장 2026-09-08: *"선생님 순서를 드래그해서 이동시키고 싶어. 드래그하면 선생님 열 전체가 월목 / 화금 / 수
 * 그룹 내에서 이동가능하게"* + *"개인마다 뷰 저장시키고"*.
 *
 * 🔴 두 축을 섞지 말 것: 학원설정의 '강사 순서'(`saveTeacherViewOrder`, 테넌트 단위)는 **강사뷰(teacher-grid)**의
 *    순서다. 기본뷰(weekday-group-tables)는 그전까지 **가나다순뿐**이었고, 이 모듈이 주는 순서는 **계정 귀속**
 *    (`users.ui_prefs.timetable.teacherOrder`)이라 사람마다 다르다 — 데스크와 원장이 같은 화면을 다른 순서로 본다.
 * 🔑 순서는 **정렬 힌트**다 — 저장된 목록에 없는 강사(신규)는 뒤에 가나다순으로 붙는다. 사라진 강사 이름이 목록에
 *    남아 있어도 해가 없다(화면에 없는 이름은 정렬에 안 걸린다).
 * ⚠️ 키는 **과목 → 요일 묶음(`mon-thu`) → 이름 배열**. 묶음마다 따로 두는 이유: 같은 강사가 월목에선 셋째,
 *    화금에선 첫째일 수 있다(그룹 안에서만 옮기라는 지시가 곧 이 구조다).
 */
export type TeacherOrderByGroup = Record<string, string[]>;
export type TeacherOrderPref = Record<string, TeacherOrderByGroup>;

/** 요일 묶음의 저장 키 — `["mon","thu"]` → `mon-thu`. 그룹 정의(`GroupDef.days`)에서 파생하므로 별도 id가 없다. */
export function teacherGroupKey(days: readonly string[]): string {
  return days.join("-");
}

/**
 * 이름 목록을 저장 순서로 정렬한다. 저장에 있는 이름이 먼저(저장 순), 없는 이름은 뒤에 가나다순.
 * ⚠️ 입력을 변형하지 않는다(새 배열).
 */
export function sortTeachersByOrder(names: readonly string[], order?: readonly string[] | null): string[] {
  const idx = new Map((order ?? []).map((n, i) => [n, i] as const));
  return [...names].sort((a, b) => {
    const ia = idx.get(a);
    const ib = idx.get(b);
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    return a.localeCompare(b, "ko");
  });
}

/**
 * `name`을 `target`의 앞/뒤로 옮긴 새 목록. 같은 이름이거나 대상이 없으면 그대로(복사본).
 * 🔑 결과는 **그 묶음의 전체 순서**다 — 화면에 있는 이름을 전부 담아 저장해야 다음 렌더가 같은 순서를 낸다.
 */
export function moveTeacher(
  list: readonly string[],
  name: string,
  target: string,
  place: "before" | "after",
): string[] {
  if (name === target) return [...list];
  const without = list.filter((n) => n !== name);
  const ti = without.indexOf(target);
  if (ti < 0) return [...list];
  const at = place === "before" ? ti : ti + 1;
  return [...without.slice(0, at), name, ...without.slice(at)];
}

/** jsonb에서 읽은 값을 타입으로 — 모양이 어긋난 조각은 버린다(예외 없음). 전부 비면 null. */
export function parseTeacherOrderPref(raw: unknown): TeacherOrderPref | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: TeacherOrderPref = {};
  for (const [subject, groups] of Object.entries(raw as Record<string, unknown>)) {
    if (!groups || typeof groups !== "object" || Array.isArray(groups)) continue;
    const g: TeacherOrderByGroup = {};
    for (const [key, list] of Object.entries(groups as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const names = list.filter((n): n is string => typeof n === "string" && n.trim() !== "");
      if (names.length > 0) g[key] = [...new Set(names)];
    }
    if (Object.keys(g).length > 0) out[subject] = g;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * 부분 병합 — 화면은 한 과목·한 묶음만 저장해 오므로 **그 묶음 키만** 갈아끼운다(다른 과목·묶음 보존).
 * 빈 배열은 "그 묶음 초기화"(키 삭제). `patch === null`은 전부 초기화.
 */
export function mergeTeacherOrderPref(
  current: TeacherOrderPref | null,
  patch: TeacherOrderPref | null,
): TeacherOrderPref | null {
  if (patch === null) return null;
  const out: TeacherOrderPref = {};
  for (const [s, g] of Object.entries(current ?? {})) out[s] = { ...g };
  for (const [subject, groups] of Object.entries(patch)) {
    const g = { ...(out[subject] ?? {}) };
    for (const [key, list] of Object.entries(groups)) {
      if (list.length === 0) delete g[key];
      else g[key] = [...list];
    }
    if (Object.keys(g).length === 0) delete out[subject];
    else out[subject] = g;
  }
  return Object.keys(out).length > 0 ? out : null;
}
