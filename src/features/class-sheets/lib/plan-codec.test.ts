import { describe, expect, it } from "vitest";
import { isMeaningfulPlanLine, isPlanPatchField, normalizePlanText } from "./plan-codec";
import { buildSaveKey, validatePatchBatch } from "./save-keys";
import { dowKeyOf, normalizePeriodStart, normalizeSlotTime, weekDatesOf } from "./week";

describe("normalizePlanText — NULL/빈문자 공용 codec", () => {
  it("trim 후 빈 문자열은 null로 단일화", () => {
    expect(normalizePlanText("  ")).toBeNull();
    expect(normalizePlanText("")).toBeNull();
    expect(normalizePlanText(null)).toBeNull();
    expect(normalizePlanText(undefined)).toBeNull();
    expect(normalizePlanText(" Ch 1 ")).toBe("Ch 1");
  });
});

describe("isMeaningfulPlanLine — SQL ecs_is_meaningful_line 동치(0157a)", () => {
  // ⚠️ 이 픽스처는 SQL 함수와 같은 답을 내야 한다(복사 skip 판정). SQL 정의:
  //   nullif(btrim(coalesce(x,'')),'') is not null OR … (textbook/page_range/progress/homework)
  const CASES: Array<[Parameters<typeof isMeaningfulPlanLine>[0], boolean]> = [
    [{ textbook: null, pageRange: null, progress: null, homework: null }, false],
    [{ textbook: "", pageRange: "  ", progress: null, homework: "\t" }, false],
    [{ textbook: "능률 VOCA", pageRange: null, progress: null, homework: null }, true],
    [{ textbook: null, pageRange: "1-3", progress: null, homework: null }, true],
    [{ textbook: null, pageRange: null, progress: "Ch 1", homework: null }, true],
    [{ textbook: null, pageRange: null, progress: null, homework: "받아쓰기" }, true],
  ];
  it.each(CASES)("%j → %s", (input, expected) => {
    expect(isMeaningfulPlanLine(input)).toBe(expected);
  });
});

describe("PLAN_PATCH_FIELDS allowlist", () => {
  it("허용 5필드만 통과", () => {
    expect(isPlanPatchField("textbook")).toBe(true);
    expect(isPlanPatchField("skill_area")).toBe(true);
    expect(isPlanPatchField("line_no")).toBe(false); // 구조 필드 — RPC 전용
    expect(isPlanPatchField("term_mode")).toBe(false);
    expect(isPlanPatchField("tenant_id")).toBe(false);
  });
});

describe("validatePatchBatch — 런타임 형태 게이트", () => {
  const LINE = "11111111-2222-4333-8444-555555555555";
  const good = { lineId: LINE, field: "textbook", expectedValue: null, newValue: "A", clientRev: 1 };
  it("정상 배치 통과 + saveKey 보강", () => {
    const r = validatePatchBatch([good]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patches[0].saveKey).toBe(buildSaveKey(LINE, "textbook"));
  });
  it("허용 외 필드는 배치 거부", () => {
    expect(validatePatchBatch([{ ...good, field: "line_no" }]).ok).toBe(false);
    expect(validatePatchBatch([{ ...good, field: "updated_by" }]).ok).toBe(false);
  });
  it("UUID 아닌 lineId·비문자 값·과대 입력 거부", () => {
    expect(validatePatchBatch([{ ...good, lineId: "1 or 1=1" }]).ok).toBe(false);
    expect(validatePatchBatch([{ ...good, newValue: 3 }]).ok).toBe(false);
    expect(validatePatchBatch([{ ...good, newValue: "a".repeat(501) }]).ok).toBe(false);
  });
  it("빈 배치·비배열 거부", () => {
    expect(validatePatchBatch([]).ok).toBe(false);
    expect(validatePatchBatch("x").ok).toBe(false);
  });
});

describe("week 유틸", () => {
  it("dowKeyOf/weekDatesOf/normalizeSlotTime", () => {
    expect(dowKeyOf("2026-07-20")).toBe("mon");
    expect(dowKeyOf("2026-07-26")).toBe("sun");
    expect(weekDatesOf("2026-07-20")).toHaveLength(7);
    expect(weekDatesOf("2026-07-20")[6]).toBe("2026-07-26");
    expect(normalizeSlotTime("15:00:00")).toBe("15:00");
    expect(normalizeSlotTime("15:00")).toBe("15:00");
  });
  it("normalizePeriodStart — week=월요일, month=1일(DB CHECK 규약)", () => {
    expect(normalizePeriodStart("week", "2026-07-23")).toBe("2026-07-20");
    expect(normalizePeriodStart("month", "2026-07-23")).toBe("2026-07-01");
  });
});
