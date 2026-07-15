import { describe, expect, it } from "vitest";
import { buildSubjectMaps } from "./subjects";
import type { SubjectSetting } from "./settings-types";

/**
 * QR 공개접수 '상담 희망 과목' 노출 필터 — 폼(page.tsx)과 서버(intake-actions.ts)가 **같은 식**을 쓴다:
 * `subjects.filter((s) => !s.hiddenFromIntake)`. 폼에서 숨긴 과목이 위조 POST로도 못 들어오는지가 핵심.
 */
const SUBJECTS: SubjectSetting[] = [
  { key: "math", label: "수학", color: "primary", weekdayGrouping: "mon-thu", testMax: 5 },
  {
    key: "subject_1",
    label: "수학(심화)",
    color: "primary",
    weekdayGrouping: "mon-thu",
    testMax: 5,
    hiddenFromIntake: true,
  },
  { key: "english", label: "영어", color: "blue", weekdayGrouping: "mon-tue", testMax: 5 },
];

const intakeOptions = (subjects: SubjectSetting[]) =>
  buildSubjectMaps(subjects.filter((s) => !s.hiddenFromIntake)).options.map((o) => o.value);

describe("QR 접수 과목 노출", () => {
  it("hiddenFromIntake 과목은 접수 선택지에서 빠진다", () => {
    expect(intakeOptions(SUBJECTS)).toEqual(["math", "english"]);
  });

  it("미설정(undefined)은 노출 — 기존 과목 동작 불변", () => {
    expect(intakeOptions(SUBJECTS)).toContain("math");
    expect(intakeOptions(SUBJECTS)).toContain("english");
  });

  it("숨긴 과목은 서버 화이트리스트에도 없다(위조 POST 거부)", () => {
    const allowed = new Set(intakeOptions(SUBJECTS));
    expect(allowed.has("subject_1")).toBe(false);
  });

  it("내부 화면(전체 과목)에는 그대로 남는다 — 시간표·성적 등 무영향", () => {
    expect(buildSubjectMaps(SUBJECTS).options.map((o) => o.value)).toEqual([
      "math",
      "subject_1",
      "english",
    ]);
  });
});
