/**
 * 출결의 **강사 귀속 축이 화면마다 갈라지는 것**을 막는 회귀 테스트 (2026-08-18).
 *
 * 배경: 축이 셋(담임 `classes.teacher_id` / 교시 담당 `class_schedules.teacher_id` / 입력자
 * `attendance_records.recorded_by`)인데 화면마다 다른 축을 골라 썼다.
 *  · 월간 출석부  = 담임뿐  → 교시 담당 강사의 출석부가 통째로 비었다(Florence Park: 담임 0반·교시 5반).
 *  · 당일 출결 보드 = 교시 담당 → 없으면 담임(맞는 규칙인데 **인라인**이라 다른 화면이 못 따라 썼다).
 * → 규칙은 `teacher-axis.ts` 한 곳에만 두고, 표시·스코프 소비처는 전부 그 모듈을 거친다.
 *
 * ⚠️ **일부러 대상에서 뺀 곳 = 돈**(`server/teacher-money.ts` · `payroll/server/payslip-queries.ts`).
 *    금액·정산액은 여전히 **담임 축**이다 — 시트 대조로 맞춰 둔 프리랜서 4인 금액과 골든마스터가
 *    그 집합에 걸려 있어서다(`teaching-scope-single-source.test.ts`의 같은 예외와 짝). 교시 축 배분은
 *    별건이고, 그 사실은 출석부 합계 줄(moneyNote)이 화면에 밝힌다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const AXIS_MODULE = "@/features/attendance/teacher-axis";

/** 주석은 규칙을 **설명**하는 자리라 검사에서 뺀다(경고 주석 자체가 위반으로 걸리면 안 된다). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const CONSUMERS = [
  join("src", "features", "attendance", "server", "queries.ts"),
  join("src", "features", "attendance", "live", "server", "load.ts"),
  join("src", "app", "(shell)", "attendance", "page.tsx"),
];

describe("출결 강사 귀속 축 단일 소스", () => {
  it.each(CONSUMERS)("%s — 축 모듈을 import한다", (rel) => {
    const src = readFileSync(join(process.cwd(), rel), "utf8");
    expect(
      src.includes(AXIS_MODULE) || src.includes("./teacher-axis-queries"),
      `${rel}: 강사 축은 ${AXIS_MODULE} 한 곳에서만 정한다 — 화면마다 따로 고르면 같은 출결이 화면마다 다른 사람의 것이 된다`,
    ).toBe(true);
  });

  it("당일 출결 보드에 인라인 담임 폴백이 남아 있지 않다", () => {
    const code = stripComments(
      readFileSync(join(process.cwd(), "src", "features", "attendance", "live", "server", "load.ts"), "utf8"),
    ).replace(/\s+/g, " ");
    expect(
      /teacher_id\s*\?\?\s*klass\.teacher_id/.test(code),
      "슬롯 담당 → 담임 폴백 규칙은 taughtByForSlot(teacher-axis)만 안다. 여기에 다시 적으면 자리(LAB·JJ) 예외가 갈라진다",
    ).toBe(false);
  });

  it("월간 출석부가 강사 스코프를 SQL 담임 필터로 되돌리지 않았다", () => {
    const code = stripComments(
      readFileSync(join(process.cwd(), "src", "features", "attendance", "server", "queries.ts"), "utf8"),
    ).replace(/\s+/g, " ");
    expect(
      /classesQuery\s*=\s*classesQuery\.eq\(\s*["']teacher_id["']/.test(code),
      "반 목록을 담임으로 좁히면 교시 담당 강사의 출석부가 다시 빈다 — 좁히는 일은 classTeacherIdsInRange가 한다",
    ).toBe(false);
  });

  it("돈(정산·명세서)은 담임 축을 그대로 쓴다 — 의도적 예외라 축 모듈을 안 거친다", () => {
    for (const rel of [
      join("src", "features", "attendance", "server", "teacher-money.ts"),
      join("src", "features", "payroll", "server", "payslip-queries.ts"),
    ]) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src.includes(AXIS_MODULE), `${rel}: 돈 축을 옮기려면 골든마스터부터 설명할 것`).toBe(false);
    }
  });
});
