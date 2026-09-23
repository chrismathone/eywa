import { describe, expect, it } from "vitest";
import { flatLessons } from "@/features/onescreen/curriculum";
import { demoMathLesson } from "./math-refresh";

describe("데모 수학 진도", () => {
  it("실제 수학 교과 차시를 사용하고 같은 날짜는 매일 재실행해도 같은 진도다", () => {
    const september = demoMathLesson("중1", "2026-09-23");
    const october = demoMathLesson("중1", "2026-10-05");
    expect(flatLessons("중1")).toContain(september);
    expect(flatLessons("중1")).toContain(october);
    expect(flatLessons("중1").indexOf(october!)).toBeGreaterThan(flatLessons("중1").indexOf(september!));
    expect(demoMathLesson("중1", "2026-09-23")).toBe(september);
  });

  it("지원하지 않는 학년은 임의 차시를 만들지 않는다", () => {
    expect(demoMathLesson("알 수 없음", "2026-09-23")).toBeNull();
  });
});
