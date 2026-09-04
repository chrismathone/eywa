import { describe, expect, it } from "vitest";
import {
  absenceReasonLabelFor,
  lateReasonLabelFor,
  REASON_LABEL_TABLES,
} from "./reason-label";

describe("출결 사유 표시 라벨", () => {
  it("한국어는 저장값 그대로 — 한 글자도 안 바뀐다", () => {
    for (const v of REASON_LABEL_TABLES.absence.presets) {
      expect(absenceReasonLabelFor(v, "ko")).toBe(v);
    }
    for (const v of REASON_LABEL_TABLES.late.presets) {
      expect(lateReasonLabelFor(v, "ko")).toBe(v);
    }
  });

  it("🔴 프리셋 전건에 영어 표기가 있다 — 빠지면 그 칩만 한글로 남는다", () => {
    for (const [axis, { presets, en }] of Object.entries(REASON_LABEL_TABLES)) {
      for (const v of presets) {
        expect(en[v], `${axis} 프리셋 "${v}"의 영어 표기가 없다`).toBeTruthy();
      }
    }
  });

  it("영어 표기끼리 겹치지 않는다 — 두 칩이 같은 말이면 무엇을 골랐는지 모른다", () => {
    for (const [axis, { en }] of Object.entries(REASON_LABEL_TABLES)) {
      const values = Object.values(en);
      expect(new Set(values).size, `${axis} 영어 표기 중복`).toBe(values.length);
    }
  });

  it("표에 없는 값(자유 입력·옛 메모)은 원문 그대로", () => {
    expect(absenceReasonLabelFor("차가 막혀서", "en")).toBe("차가 막혀서");
    expect(lateReasonLabelFor("동생 데려다줌", "en")).toBe("동생 데려다줌");
  });

  it("빈 값은 null — 빈 알약을 그리지 않는다", () => {
    for (const lang of ["ko", "en"] as const) {
      expect(absenceReasonLabelFor(null, lang)).toBeNull();
      expect(absenceReasonLabelFor("  ", lang)).toBeNull();
      expect(lateReasonLabelFor(undefined, lang)).toBeNull();
    }
  });

  it("앞뒤 공백은 떼고 본다 — 저장된 메모에 공백이 섞여 있어도 표를 탄다", () => {
    expect(absenceReasonLabelFor(" 여행 ", "en")).toBe("Trip");
  });
});
