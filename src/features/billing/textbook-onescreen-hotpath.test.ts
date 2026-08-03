/**
 * 🔴 **원스크린 로스터가 타는 교재 쿼리에 "아직 DB에 없을 수 있는 컬럼"을 넣지 않는다** — 회귀 방지.
 *
 * 2026-08-03 실사고: 교재요청 기능에 `classnote_notice_id`(0174a)를 더하면서 이 쿼리의 select에도 넣고
 * **마이그레이션보다 앱을 먼저 배포**했다. 컬럼이 없으니 PostgREST가 400을 냈고, `fetchInChunks`는
 * (규약대로) 에러를 삼키지 않고 throw한다 → `getTeacherRoster`가 통째로 실패 → **강사 원스크린이 전원 먹통.**
 * 사무실 화면 하나가 에러 나는 것과 급이 다르다: 강사 전원이 그날 수업을 마감하지 못한다.
 *
 * 그래서 이 경로(`getTextbookOrdersForStudents`)는 **교재 자동입력에 필요한 최소 컬럼만** 조회한다.
 * 새 컬럼이 필요하면 그 값을 쓰는 화면이 자기 쿼리로 읽을 것.
 *
 * ⚠️ 더 근본적인 규칙(사람이 지켜야 하는 것): **새 컬럼을 select에 넣는 코드는 그 마이그레이션이
 *    적용된 뒤에 배포한다.** 순서를 지키면 이런 사고 자체가 안 난다(ClassNote 레일에서 이미 정한 규약).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** 이 경로에 **금지**된 컬럼 — 0174a 이후 추가분. 새 컬럼을 더하면 여기에도 이름을 적을 것. */
const FORBIDDEN_IN_HOTPATH = ["classnote_notice_id"];

describe("원스크린 교재 쿼리(핫패스)", () => {
  const src = readFileSync(
    join(process.cwd(), "src", "features", "billing", "server", "textbook-queries.ts"),
    "utf8",
  );

  /** `getTextbookOrdersForStudents` 본문만 잘라낸다(파일 전체를 보면 다른 쿼리의 컬럼까지 걸린다). */
  const body = (() => {
    const start = src.indexOf("export async function getTextbookOrdersForStudents");
    expect(start, "getTextbookOrdersForStudents를 찾지 못했다").toBeGreaterThan(-1);
    const rest = src.slice(start + 1);
    const next = rest.search(/\nexport (async function|function|const|type) /);
    return next === -1 ? rest : rest.slice(0, next);
  })();

  /** 주석은 규칙을 **설명**하는 자리다 — 검사에서 뺀다(경고 주석 자체가 위반으로 걸리지 않게). */
  const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  for (const col of FORBIDDEN_IN_HOTPATH) {
    it(`select에 ${col}을 넣지 않는다 — 컬럼이 없으면 강사 원스크린이 통째로 죽는다`, () => {
      expect(
        code.includes(col),
        `${col}이 이 쿼리에 들어가면, 그 마이그레이션이 적용되기 전 배포에서 강사 전원의 원스크린이 500이 된다.\n` +
          `이 값이 필요하면 그 값을 쓰는 화면이 자기 쿼리로 읽을 것.`,
      ).toBe(false);
    });
  }

  it("교재 자동입력에 필요한 컬럼은 그대로 있다(과잉 삭제 방지)", () => {
    for (const col of ["book_name", "student_id", "teacher_name", "created_by", "price"]) {
      expect(code, `${col}이 빠지면 교재 자동입력·소유 판정이 깨진다`).toContain(col);
    }
  });
});
