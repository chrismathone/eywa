import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { usedRowSubjectsOf } from "./week-grid-row-mode";

/**
 * 🔴 픽스처 = **실제 학원설정 과목 모양**(injaewon 2026-09-11 조회 — 수학·과학·국어는 `defaultView` 미설정,
 *    영어만 `integrated`). 지어낸 설정으로 잠그면 실제와 어긋나도 초록으로 통과한다.
 */
const INJAEWON_SUBJECTS = [
  { key: "math", label: "수학" },
  { key: "english", label: "영어", defaultView: "integrated" },
  { key: "science", label: "과학" },
  { key: "korean", label: "국어" },
];

describe("usedRowSubjectsOf — '수업 있는 교시만' 그리는 과목 = 처음 여는 뷰가 통합뷰인 과목", () => {
  it("🔴 실제 설정 → 영어 하나(수학·과학·국어는 기본뷰 규칙 = 교시표 전부)", () => {
    expect(usedRowSubjectsOf(INJAEWON_SUBJECTS)).toEqual(["english"]);
  });

  it("기본뷰·강사뷰·모르는 값(손편집 jsonb `rooms`)은 빠진다 — 판정은 subjectDefaultView 허용 목록", () => {
    const subjects = [
      { key: "math", defaultView: "basic" },
      { key: "english", defaultView: "teacher" },
      { key: "subject_1", defaultView: "rooms" },
      { key: "subject_2", defaultView: "integrated" },
    ];
    expect(usedRowSubjectsOf(subjects)).toEqual(["subject_2"]);
  });

  it("설정이 없으면 빈 목록 — 전 과목 교시표 전부(설정 도입 전 동작)", () => {
    expect(usedRowSubjectsOf(undefined)).toEqual([]);
    expect(usedRowSubjectsOf([])).toEqual([]);
  });
});

/**
 * 🔴 배선 — 도출이 서버 컴포넌트 안에 있으면 `[]`로 바꿔도 tsc·vitest가 초록이다(적대 리뷰 2026-09-11). 학원설정 →
 *    수업 탭 → 격자 카드 → 표 → `buildSubjectPeriodGrid(…, rowMode)`까지 값이 흘러가는지 구조로 잠근다.
 *    한 곳이라도 끊기면 영어 격자가 다시 교시표 15줄을 그리고 다른 체계의 빈 행이 사이사이 낀다.
 */
describe("🔴 행 구성 배선 — 학원설정 → 수업 탭 → 격자", () => {
  const read = (...p: string[]) =>
    readFileSync(join(process.cwd(), "src", "app", "(shell)", "students", "[id]", "_tabs", ...p), "utf8");

  it("수업 탭이 학원설정 과목 목록으로 도출해 격자 카드에 넘긴다", () => {
    const src = read("classes-tab.tsx");
    expect(src).toMatch(/\busedRowSubjects\s*=\s*usedRowSubjectsOf\(\s*settings\.operations\.subjects\s*\)/);
    expect(src).toMatch(/<StudentWeekGrid\b[^>]*\busedRowSubjects=\{usedRowSubjects\}/);
  });

  it("격자 카드가 과목별 모드를 그 목록에서 정해 표에 넘긴다", () => {
    const src = read("student-week-grid.tsx");
    expect(src).toMatch(/\bmodeOf\s*=\s*\([^)]*\)[^=]*=>\s*\(?\s*usedRowSubjects\.includes\(\s*\w+\s*\)\s*\?\s*"used"\s*:\s*"all"/);
    expect(src).toMatch(/\browMode=\{modeOf\(active\)\}/);
  });

  it("표가 평일·주말 두 격자 모두에 그 모드를 쓴다", () => {
    const calls = read("student-period-grid.tsx").match(/buildSubjectPeriodGrid\([^)]*\)/g) ?? [];
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c).toMatch(/,\s*rowMode\s*\)$/);
  });
});
