import { describe, expect, it } from "vitest";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { sheetUiText } from "./interface-text";

describe("teacher-view interface labels", () => {
  it("uses English for fixed copy and keeps Korean unchanged", () => {
    for (const [ko, en] of [["검색", "Search"], ["원생목록으로", "Back to students"], ["1교시", "Period 1"]]) {
      expect(sheetUiText("en", ko)).toBe(en);
      expect(sheetUiText("ko", ko)).toBe(ko);
    }
  });
  it("preserves configured subject values, colors and custom names in English", () => {
    const settings = [{ key: "english", label: "영어", color: "rose" as const }, { key: "subject_1", label: "수학(심화)", color: "primary" as const }, { key: "subject_2", label: "Creative Club", color: "green" as const }].map((subject) => ({ ...subject, weekdayGrouping: "", testMax: 100 }));
    const ko = buildSubjectMaps(settings);
    const en = buildSubjectMaps(settings, "en");
    expect(en.options).toEqual(settings.map(({ key, label }) => ({ value: key, label: label === "영어" ? "English" : label === "수학(심화)" ? "Advanced Math" : label })));
    expect(en.filters[0]).toEqual({ value: "all", label: "All" });
    expect(en.colorOf("english")).toBe(ko.colorOf("english"));
    expect(ko.labelOf("english")).toBe("영어");
    expect(sheetUiText("en", "사용자가 직접 적은 메모")).toBe("사용자가 직접 적은 메모");
  });
});
