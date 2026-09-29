import { describe, expect, it } from "vitest";
import { itemCountOf, sanitizeAreas } from "./checklist";
import { CHECKLIST_PRESETS, presetOf, TEACHER_EVAL_AREAS } from "./presets";

describe("문항 세트 시작 문안", () => {
  it("강사평가 = 시트 3영역 15문항", () => {
    expect(TEACHER_EVAL_AREAS.map((a) => [a.title, a.items.length])).toEqual([
      ["수업", 6],
      ["업무", 6],
      ["학원행정사항", 3],
    ]);
    expect(itemCountOf(TEACHER_EVAL_AREAS)).toBe(15);
  });

  it("모든 문안이 저장 검증(sanitizeAreas)을 그대로 통과한다 — 잘리거나 버려지는 문항이 없다", () => {
    for (const p of CHECKLIST_PRESETS) expect(sanitizeAreas(p.areas)).toEqual(p.areas);
  });

  it("모르는 키·1은 기본 문안", () => {
    expect(presetOf("1").key).toBe("class");
    expect(presetOf(undefined).key).toBe("class");
    expect(presetOf("teacher").name).toBe("강사평가");
  });
});
