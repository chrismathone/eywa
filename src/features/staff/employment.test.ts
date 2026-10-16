import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasFreelancePart, isMixedEmployment, MIXED_EMPLOYMENT, parseWorkDays, workDaysLabel } from "./employment";
import { EMPLOYMENT_TYPES } from "./resume";

/**
 * 계약구분 '혼합'(근로 + 용역) — 원장 2026-10-16 이성우 선생님 *"초중은 급여 고등은 프리"* → *"반반 계약을 따로 표기하는 칸 추가"*.
 * 용역 몫은 프리랜서처럼 출석부 실급여·명세서를 타고(대상 학년만), 근로 몫은 근로 요일만 강사평가 근태를 센다.
 */
describe("계약구분 판정", () => {
  it("이력서 선택지에 '혼합'이 있다(계약구분은 이력서가 단일 소스)", () => {
    expect(EMPLOYMENT_TYPES).toContain(MIXED_EMPLOYMENT);
  });
  it("실급여·프리랜서 명세서를 타는 계약 = 프리랜서 · 혼합", () => {
    expect([hasFreelancePart("프리랜서"), hasFreelancePart("혼합"), hasFreelancePart("정규직"), hasFreelancePart("아르바이트"), hasFreelancePart(null)])
      .toEqual([true, true, false, false, false]);
    expect([isMixedEmployment("혼합"), isMixedEmployment("프리랜서"), isMixedEmployment(undefined)]).toEqual([true, false, false]);
  });
  it("근로 요일 = 아는 요일만 월→일 순서로 · 모르는 값이 섞이면 거절(조용히 버리지 않는다)", () => {
    expect(parseWorkDays(["fri", "mon", "thu", "tue", "mon"])).toEqual(["mon", "tue", "thu", "fri"]);
    expect(parseWorkDays([])).toEqual([]);
    expect(parseWorkDays(["monday"])).toBeNull();
    expect(parseWorkDays("mon")).toBeNull();
    expect(workDaysLabel(["mon", "tue", "thu", "fri"])).toBe("월·화·목·금");
    expect(workDaysLabel(undefined)).toBe("");
  });
});

/**
 * 🔴 프리랜서 판정은 `hasFreelancePart` 한 곳 — `=== "프리랜서"`를 새로 적으면 혼합 계약 선생님의 명세서·실급여가 그 자리에서만 빠진다.
 * 예외는 강사평가 '프리랜서 근태 만점'(혼합은 근로 요일을 센다 — 일부러 프리랜서만)과 판정 모듈 자신.
 */
describe("가드 — 프리랜서 직접 비교 금지", () => {
  const ALLOWED = new Set(["src/features/staff/employment.ts", "src/features/teacher-portfolio/model/source-items.ts"]);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path.replace(/\\/g, "/"));
    }
  };
  walk("src");
  // 비교 연산자 · DB 필터(.eq/.neq/.in의 employment_type) · switch case — 따옴표 종류와 상관없이.
  const DIRECT = /(===|!==)\s*["'`]프리랜서["'`]|["'`]프리랜서["'`]\s*(===|!==)|employment_type["'`]\s*,\s*["'`[]?프리랜서|case\s+["'`]프리랜서["'`]/;
  it("hasFreelancePart 밖에서 계약구분을 '프리랜서'와 직접 견주지 않는다", () => {
    const hits = files.filter((f) => !ALLOWED.has(f) && DIRECT.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
  it("가드가 실제로 잡는다(자기 시험)", () => {
    for (const bad of ['x === "프리랜서"', "x !== '프리랜서'", '.eq("employment_type", "프리랜서")', "case '프리랜서':"]) expect(DIRECT.test(bad)).toBe(true);
    expect(DIRECT.test('["정규직", "아르바이트", "프리랜서"]')).toBe(false);
  });
});
