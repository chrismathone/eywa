import { describe, it, expect } from "vitest";
import { buildSubjectMaps, subjectLabelRecord } from "./subjects";
import { DEFAULT_SETTINGS } from "./defaults";

const maps = buildSubjectMaps(DEFAULT_SETTINGS.operations.subjects);

describe("buildSubjectMaps — 레거시 과목 키 표시 폴백", () => {
  it("폐기된 highmath 키는 raw 노출('HIGHMATH') 대신 한글 라벨/색으로 폴백", () => {
    // ijw 베이스 복원 시 classes.subject='highmath'가 잔존할 수 있음(설정엔 subject_1로 통일).
    expect(maps.labelOf("highmath")).toBe("수학");
    expect(maps.colorOf("highmath")).toBe("primary");
    expect(subjectLabelRecord(DEFAULT_SETTINGS.operations.subjects).highmath).toBe("수학");
  });

  it("레거시 폴백 키는 선택지(options/filters)에 섞이지 않는다", () => {
    // 폴백은 labelOf/colorOf 표시용일 뿐 — 드롭다운·필터엔 설정 과목만.
    expect(maps.options.some((o) => o.value === "highmath")).toBe(false);
    expect(maps.filters.some((f) => f.value === "highmath")).toBe(false);
    // 수학(심화) 과목은 없앴다 — 수학 하나만 선택지에 있다.
    expect(maps.options.some((o) => o.value === "subject_1")).toBe(false);
  });

  it("폴백에도 없는 미등록 키는 raw key/neutral로 떨어진다", () => {
    expect(maps.labelOf("zzz_unknown")).toBe("zzz_unknown");
    expect(maps.colorOf("zzz_unknown")).toBe("neutral");
  });
});
