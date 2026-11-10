import { describe, it, expect } from "vitest";
import { buildSubjectMaps, subjectColorOfRow, subjectKeyOfName, subjectLabelRecord } from "./subjects";
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

describe("과목 행 색 — 학원설정 단일 소스(subjectColorOfRow)", () => {
  const rowMaps = buildSubjectMaps([
    { key: "math", label: "수학", color: "blue" },
    { key: "subject_1", label: "수학(심화)", color: "gold" },
    { key: "english", label: "영어", color: "rose" },
  ] as never);

  it("과목 키가 있는 행은 그 키의 설정 색", () => {
    expect(subjectColorOfRow(rowMaps, { subjectKey: "english", name: "아무 이름" })).toBe("rose");
  });
  it("키가 없는 행(옛 행·데모)은 이름 속 설정 라벨로 — 긴 라벨 먼저", () => {
    expect(subjectColorOfRow(rowMaps, { name: "수학 (상)" })).toBe("blue");
    expect(subjectColorOfRow(rowMaps, { name: "수학(심화) A" })).toBe("gold");
    expect(subjectKeyOfName("고1 영어", rowMaps.options)).toBe("english");
  });
  it("설정에 없는 이름은 neutral(코드에 과목 색을 두지 않는다)", () => {
    expect(subjectKeyOfName("과학", rowMaps.options)).toBe("");
    expect(subjectColorOfRow(rowMaps, { name: "과학" })).toBe("neutral");
  });
});
