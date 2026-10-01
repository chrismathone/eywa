import { norm } from "../match";
import type { ClassMapping, MasterClass, MasterEnrollment } from "./types";

/** EiE classification comes from the stored program, never a numeric level-name guess. */
export function buildClassMappings(
  sheetNames: string[],
  active: MasterClass[],
  current: MasterEnrollment[],
  resolved: Map<string, string[]>,
  counts: Map<string, number>,
  bindings: Record<string, string>,
): ClassMapping[] {
  const rosters = new Map(active.map((c) => [c.id, new Set<string>()]));
  for (const e of current) rosters.get(e.classId)?.add(e.studentId);
  const mappings = sheetNames.map((sheetName): ClassMapping => {
    const explicit = Object.hasOwn(bindings, sheetName);
    const exact = active.filter((c) => norm(c.className) === norm(sheetName));
    const students = new Set(resolved.get(sheetName) ?? []);
    const scores = active
      .map((c) => ({
        c,
        n: [...rosters.get(c.id)!].filter((id) => students.has(id)).length,
      }))
      .filter((x) => x.n)
      .sort((a, b) => b.n - a.n);
    const best = scores[0];
    const unique = best && (!scores[1] || scores[1].n < best.n);
    const suggested = unique && best.n >= 2 ? best : null;
    let klass = explicit
      ? active.find((c) => c.id === bindings[sheetName])
      : exact.length === 1
        ? exact[0]
        : undefined;
    let method: ClassMapping["method"] = explicit
      ? "manual"
      : klass
        ? "name"
        : "unmapped";
    let manualReason: string | null = null;
    const complete =
      students.size > 0 && students.size === counts.get(sheetName);
    const strong =
      suggested &&
      complete &&
      suggested.n > students.size / 2 &&
      suggested.n > rosters.get(suggested.c.id)!.size / 2;
    if (
      !explicit &&
      best &&
      best.n >= 2 &&
      !unique &&
      (!klass || klass.track === "eie")
    ) {
      klass = undefined;
      method = "unmapped";
      manualReason =
        "명단이 같은 수로 겹치는 반이 여러 개여서 자동 연결하지 않았습니다.";
    } else if (!explicit && suggested && suggested.c.id !== klass?.id) {
      if (
        suggested.c.track === "eie" &&
        strong &&
        (!klass || klass.track === "eie")
      ) {
        klass = suggested.c;
        method = "roster";
      } else {
        manualReason = !complete
          ? "학생 연결이 미확정이거나 명단에 중복이 있어 자동 연결하지 않았습니다."
          : suggested.c.track !== "eie" || (klass && klass.track !== "eie")
            ? "EiE로 등록된 같은 프로그램의 반인지 자동 확정할 수 없습니다."
            : "시트와 기존 반 양쪽에서 과반수가 일치하지 않아 진급 전 반을 확정할 수 없습니다.";
        klass = undefined;
        method = "unmapped";
      }
    }
    if (!klass && !manualReason)
      manualReason = explicit
        ? "연결할 활성 영어 반을 선택해 주세요."
        : best && !unique
          ? "명단이 같은 수로 겹치는 반이 여러 개여서 자동 연결하지 않았습니다."
          : "이름 또는 명단으로 연결할 기존 반을 확정하지 못했습니다.";
    return {
      sheetName,
      classId: klass?.id ?? null,
      currentName: klass?.className ?? null,
      explicit,
      method,
      manualReason,
      suggestedId: suggested?.c.id ?? null,
      suggestedName: suggested?.c.className ?? null,
      evidence: suggested
        ? `시트 ${counts.get(sheetName) ?? students.size}명 · 기존 반 ${rosters.get(suggested.c.id)!.size}명 중 ${suggested.n}명 일치`
        : "",
    };
  });
  // A manual choice wins. Competing automatic choices must not silently attach two histories to one ID.
  const claims = new Map<string, ClassMapping[]>();
  for (const m of mappings)
    if (m.classId) claims.set(m.classId, [...(claims.get(m.classId) ?? []), m]);
  for (const group of claims.values())
    if (group.length > 1)
      for (const m of group)
        if (!m.explicit) {
          m.classId = null;
          m.currentName = null;
          m.method = "unmapped";
          m.manualReason = `같은 기존 반이 ${group.map((v) => v.sheetName).join(" / ")}에 겹쳐 연결됩니다. 원래 반을 직접 선택해 주세요.`;
        }
  return mappings;
}
