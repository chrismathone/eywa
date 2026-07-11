import { describe, it, expect } from "vitest";
import { consultationsSchema } from "./settings-types";
import { DEFAULT_SETTINGS } from "./defaults";
import { resolveSettings } from "./resolve";

// 학생상담 양식(템플릿) 스키마 — saveOwnerSection이 이 스키마로 검증하므로 저장 경로의 순수 방어선.
describe("consultationsSchema", () => {
  it("기본 프리셋(4종)이 스키마를 통과하고 기본양식은 정확히 1개", () => {
    const r = consultationsSchema.safeParse(DEFAULT_SETTINGS.consultations);
    expect(r.success).toBe(true);
    const defaults = DEFAULT_SETTINGS.consultations.templates.filter((t) => t.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].key).toBe("general");
  });

  it("빈 문자열 범주/대상은 null로 정규화된다", () => {
    const r = consultationsSchema.parse({
      templates: [{ key: "t1", name: "빈값", body: "", category: "", audience: "", isDefault: false }],
    });
    expect(r.templates[0].category).toBeNull();
    expect(r.templates[0].audience).toBeNull();
  });

  it("잘못된 범주 값은 거부", () => {
    const r = consultationsSchema.safeParse({
      templates: [{ key: "t1", name: "x", body: "", category: "invalid", audience: null, isDefault: false }],
    });
    expect(r.success).toBe(false);
  });

  it("기본양식이 둘 이상이면 거부", () => {
    const r = consultationsSchema.safeParse({
      templates: [
        { key: "a", name: "A", body: "", category: null, audience: null, isDefault: true },
        { key: "b", name: "B", body: "", category: null, audience: null, isDefault: true },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("양식 ID(key) 중복이면 거부", () => {
    const r = consultationsSchema.safeParse({
      templates: [
        { key: "dup", name: "A", body: "", category: null, audience: null, isDefault: false },
        { key: "dup", name: "B", body: "", category: null, audience: null, isDefault: false },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("이름이 비면 거부(원장 실수 방어)", () => {
    const r = consultationsSchema.safeParse({
      templates: [{ key: "t1", name: "", body: "내용", category: null, audience: null, isDefault: false }],
    });
    expect(r.success).toBe(false);
  });

  it("저장값 없으면 resolveSettings가 기본 프리셋을 채운다(orphan 방지)", () => {
    const r = resolveSettings(null, { name: "X" });
    expect(r.consultations.templates).toEqual(DEFAULT_SETTINGS.consultations.templates);
  });

  it("저장된 양식 배열은 교체된다(deepMerge 배열 규칙)", () => {
    const templates = [
      { key: "only", name: "단일 양식", body: "■ 내용:", category: "academic" as const, audience: "student" as const, isDefault: true },
    ];
    const r = resolveSettings({ consultations: { templates } }, { name: "X" });
    expect(r.consultations.templates).toEqual(templates);
  });
});
