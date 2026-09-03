import { describe, expect, it } from "vitest";
import { AUDIT_RESULTS, AUDIT_RESULT_LABEL, auditResultMeta } from "./audit-result";
import { BUILTIN_CATEGORIES, BUILTIN_CATEGORY_MAPS, assetCategoryLabel, buildCategoryMaps } from "./category";
import { LOAN_STATUSES, LOAN_STATUS_LABEL, loanStatusMeta } from "./loan-status";
import { ASSET_STATUSES, ASSET_STATUS_LABEL, assetStatusLabel, assetStatusMeta, countable, needsAction } from "./status";
import { DASH, UNKNOWN_LABEL, dashIfEmpty, nullIfUnknown, unknownIfEmpty } from "./unknown-value";

const HANGUL = /[가-힣]/;

describe("재고관리 enum — 모든 키에 한글 라벨(raw 코드 노출 금지)", () => {
  it("자산 상태 7종", () => {
    for (const k of ASSET_STATUSES) expect(ASSET_STATUS_LABEL[k]).toMatch(HANGUL);
    expect(assetStatusLabel("on_loan")).toBe("대여중");
  });
  it("내장 분류 7종 + 접두(0247a 시드의 원본이자 표가 없을 때의 폴백)", () => {
    for (const c of BUILTIN_CATEGORIES) {
      expect(c.key === "tv" ? "TV" : c.label).toMatch(c.key === "tv" ? /TV/ : HANGUL);
      // DB CHECK(`^[A-Z][A-Z0-9]{0,3}$`)와 같은 모양이어야 시드가 통과한다.
      expect(c.codePrefix).toMatch(/^[A-Z][A-Z0-9]{0,3}$/);
      expect(c.key).toMatch(/^[a-z][a-z0-9_]{0,31}$/);
    }
    // 키·라벨·접두는 학원 안에서 유일해야 한다(0247a 유니크 3종).
    for (const f of ["key", "label", "codePrefix"] as const) {
      expect(new Set(BUILTIN_CATEGORIES.map((c) => c[f])).size).toBe(BUILTIN_CATEGORIES.length);
    }
    expect(BUILTIN_CATEGORY_MAPS.labelOf("laptop")).toBe("노트북");
    expect(BUILTIN_CATEGORY_MAPS.prefixOf("laptop")).toBe("NB");
    expect(assetCategoryLabel("laptop")).toBe("노트북");
  });
  it("분류 맵 — 라벨/키(공백 무시) 둘 다 받고, 순서는 sortOrder", () => {
    const maps = buildCategoryMaps([
      { key: "headset", label: "헤드셋", codePrefix: "HS", sortOrder: 80 },
      { key: "laptop", label: "노트북", codePrefix: "NB", sortOrder: 20 },
    ]);
    expect(maps.list.map((c) => c.key)).toEqual(["laptop", "headset"]);
    expect(maps.keyOfInput(" 헤드 셋 ")).toBe("headset");
    expect(maps.keyOfInput("HEADSET")).toBe("headset");
    expect(maps.keyOfInput("냉장고")).toBeUndefined();
    expect(maps.has("laptop")).toBe(true);
    expect(maps.has("desktop")).toBe(false);
    // 모르는 키는 원문 그대로(화면이 죽지 않게) · 접두는 폴백
    expect(maps.labelOf("desktop")).toBe("desktop");
    expect(maps.prefixOf("desktop")).toBe("C1");
    expect(maps.labelOf(null)).toBe("");
  });
  it("대여 상태 4종 · 실사 결과 3종", () => {
    for (const k of LOAN_STATUSES) expect(LOAN_STATUS_LABEL[k]).toMatch(HANGUL);
    for (const k of AUDIT_RESULTS) expect(AUDIT_RESULT_LABEL[k]).toMatch(HANGUL);
  });
  it("모르는 값은 원문 폴백 — 화면이 죽지 않는다", () => {
    expect(assetStatusLabel("weird")).toBe("weird");
    expect(assetCategoryLabel("weird")).toBe("weird");
    expect(assetStatusMeta("weird").tone).toBe("inert");
    expect(loanStatusMeta("weird").tone).toBe("inert");
    expect(auditResultMeta("weird").tone).toBe("inert");
  });
});

describe("의미색 캐논 — 상태는 tone으로", () => {
  it("사용중=green · 대여중=blue · 분실=danger · 폐기=neutral", () => {
    expect(assetStatusMeta("in_use").color).toBe("green");
    expect(assetStatusMeta("on_loan").color).toBe("blue");
    expect(assetStatusMeta("lost").color).toBe("danger");
    expect(assetStatusMeta("disposed").color).toBe("neutral");
    expect(assetStatusMeta("unregistered").color).toBe("purple");
  });
  it("대여 회수불가=danger · 실사 미확인=danger · 보류=amber", () => {
    expect(loanStatusMeta("unreturnable").color).toBe("danger");
    expect(auditResultMeta("missing").color).toBe("danger");
    expect(auditResultMeta("hold").color).toBe("amber");
  });
});

describe("needsAction / countable — 스탯·칩·목록이 같은 판정", () => {
  it("lost·check·unregistered·repair = true", () => {
    for (const s of ["lost", "check", "unregistered", "repair"]) expect(needsAction(s)).toBe(true);
  });
  it("in_use·on_loan·disposed = false", () => {
    for (const s of ["in_use", "on_loan", "disposed"]) expect(needsAction(s)).toBe(false);
  });
  it("전체 자산 분모는 폐기만 뺀다", () => {
    expect(countable("disposed")).toBe(false);
    for (const s of ASSET_STATUSES.filter((s) => s !== "disposed")) expect(countable(s)).toBe(true);
  });
});

describe("미기재 규약", () => {
  it("표식은 null로 접는다(문자열 '미기재'를 저장하지 않는다)", () => {
    for (const v of ["미기재", "모델확인필요", "제조사 확인필요", "—", "", "  ", null, undefined]) {
      expect(nullIfUnknown(v)).toBeNull();
    }
    expect(nullIfUnknown(" LG ")).toBe("LG");
    // '확인필요'(단독)는 값이다 — L-0035의 대여자.
    expect(nullIfUnknown("확인필요")).toBe("확인필요");
  });
  it("모르는 칸은 미기재, 비어도 되는 칸은 —", () => {
    expect(unknownIfEmpty(null)).toBe(UNKNOWN_LABEL);
    expect(unknownIfEmpty("LG")).toBe("LG");
    expect(dashIfEmpty(null)).toBe(DASH);
    expect(dashIfEmpty("김태건")).toBe("김태건");
  });
});
