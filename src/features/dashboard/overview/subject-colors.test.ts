import { describe, expect, it } from "vitest";
import { DASHBOARD_SUBJECT_COLORS as C, dashboardSubjectColor, dashboardCombinationColor, dashboardProgramColor } from "./subject-colors";

describe("dashboard subject colors", () => {
  const labels = { math: "수학", english: "영어", customMath: "수학(심화)", customEnglish: "인재원 영어", science: "과학" };
  it("표준 및 설정 과목과 영어의 두 프로그램을 같은 색으로 묶는다", () => {
    expect(dashboardSubjectColor("math", labels)).toBe(C.math);
    expect(dashboardSubjectColor("customMath", labels)).toBe(C.math);
    expect(dashboardSubjectColor("english", labels)).toBe(C.english);
    expect(dashboardSubjectColor("customEnglish", labels)).toBe(C.english);
    expect(dashboardProgramColor("eie")).toBe(C.english);
    expect(dashboardProgramColor("injaewon")).toBe(C.english);
  });
  it("두 수학 수강을 동시수강 보라로 잘못 분류하지 않는다", () => {
    expect(dashboardCombinationColor(["math", "customMath"], labels)).toBe(C.math);
    expect(dashboardCombinationColor(["customEnglish", "customMath"], labels)).toBe(C.both);
    expect(dashboardCombinationColor(["customMath", "customEnglish"], labels)).toBe(C.both);
    expect(dashboardCombinationColor(["science"], labels)).toBe(C.other);
  });
});
