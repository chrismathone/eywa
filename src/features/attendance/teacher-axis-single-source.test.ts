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
  // 결석 통보 접수 미리보기(2026-08-19) — 칸마다 "누가 가르치나"를 적는 화면이라 같은 축을 거쳐야 한다.
  // (담임을 직접 적었다가 교시마다 담당이 다른 영어 반에서 둘 다 담임 이름으로 표시된 회귀가 있었다.)
  join("src", "features", "attendance", "intake", "server", "queries.ts"),
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

  /**
   * 담임 시작일 필터(2026-08-19)가 **표시 축 밖으로 새지 않는지**.
   * 새는 방향이 셋이라 셋 다 잠근다: ① 교시 담당 반 ② 반별 보기 ③ 급여 별지(돈).
   */
  describe("담임 시작일 필터 — 적용 범위", () => {
    const page = readFileSync(join(process.cwd(), "src", "app", "(shell)", "attendance", "page.tsx"), "utf8");

    it("🔴 담임 폴백으로 잡힌 반에만 건다 — 교시 담당 반은 그 사람이 실제로 가르쳤다", () => {
      expect(
        /teacherRoles\.get\(c\.id\)\s*===\s*"homeroom"/.test(page),
        "담임 시작일 필터가 역할을 안 보고 걸리고 있습니다 — 교시 담당(slot)·겸임(both) 반까지 가리면 " +
          "2026-08-18에 넓힌 '교시 담당 강사도 자기 출석부를 본다'가 도로 깨집니다.",
      ).toBe(true);
    });

    it("🔴 반별 보기·급여 별지에는 안 넘긴다 — 반 관점에선 그 기록이 맞고 돈 축은 담임 그대로다", () => {
      // 반별 보기 호출(3인자)에 since가 붙지 않았는지.
      expect(
        /getMonthlyAttendanceMatrix\(month,\s*effectiveClassId,\s*viewPrefs\.periodMode\)/.test(page),
        "반별 보기 호출에 담임 시작일이 붙었습니다 — 반의 책은 그 반 전체를 세는 게 맞습니다.",
      ).toBe(true);
      const payslip = readFileSync(
        join(process.cwd(), "src", "app", "(print)", "payroll", "[teacherId]", "payslip", "page.tsx"),
        "utf8",
      );
      expect(
        /getMonthlyAttendanceMatrix\(period,\s*c\.id,\s*"month"\)/.test(payslip),
        "급여 별지 호출에 강사 스코프·담임 시작일이 붙었습니다 — 돈 축은 담임 그대로가 확정입니다(골든마스터).",
      ).toBe(true);
    });

    it("파생(수업보고서)도 같은 경계를 본다 — 수기만 빼면 파생이 그 칸을 되살린다", () => {
      const queries = stripComments(
        readFileSync(join(process.cwd(), "src", "features", "attendance", "server", "queries.ts"), "utf8"),
      ).replace(/\s+/g, " ");
      expect(
        /!scopeSince \|\| d\.date >= scopeSince/.test(queries),
        "파생 등원일이 담임 시작일을 안 봅니다 — JJ2A는 8/3~8/10에 전임이 쓴 보고서가 14건 있어 " +
          "수기 기록을 빗금으로 빼도 그 칸이 '출석'으로 되살아납니다.",
      ).toBe(true);
    });
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
