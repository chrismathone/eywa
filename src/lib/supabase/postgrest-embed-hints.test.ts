/**
 * `lesson_reports` → `classes` 임베드에 **FK 이름이 붙어 있는지** 강제하는 회귀 테스트.
 *
 * 배경(2026-08-03 프로덕션): 0171a가 `makeup_class_id`(보강 앵커)를 더하면서 lesson_reports→classes
 * FK가 **2개**가 됐다. 그 순간 보고서 목록의 힌트 없는 `classes(class_name)` 임베드를 PostgREST가
 * 해석하지 못해 **HTTP 300 PGRST201**로 쿼리 전체가 실패했고, 목록이 "총 0건"으로 비면서 영문 원문이
 * 그대로 토스트에 떴다. 컬럼 하나를 더한 **다른 세션의 마이그레이션**이 이 화면을 끈 것이라,
 * 사람이 기억해서 막을 수 있는 종류가 아니다 — 주석 말고 테스트로 잠근다.
 *
 * 규칙: `from("lesson_reports")`를 쓰는 파일에서 `classes(` 임베드는 **항상 `classes!<FK이름>(`** 형태.
 *
 * ⚠️ **정렬 문자열은 반대다** — `order=classes(class_name)`에 `!FK`를 넣으면 order 파서가 '!'를 못 읽어
 *    PGRST100(400)이 난다. select만 힌트로 확정하면 정렬은 그 임베드를 가리켜 정상 동작한다(둘 다 실측).
 *    정렬 스펙은 [report-filters.ts]에 있고 그 파일은 lesson_reports를 직접 조회하지 않으므로
 *    이 스캔 대상이 아니다 — 두 규칙이 서로 밟지 않는다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ⚠️ `withFileTypes`로 순회한다 — 엔트리마다 statSync를 부르면 src 전체 스캔이 7초를 넘어
//    vitest 기본 타임아웃(5s)에 걸린다(실측). 디렉터리 판정은 dirent가 이미 갖고 있다.
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) sourceFiles(join(dir, entry.name), out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
      out.push(join(dir, entry.name));
  }
  return out;
}

/** 주석은 규칙을 **설명**하는 자리라 검사에서 뺀다(경고 주석 자체가 위반으로 걸리지 않게). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("lesson_reports → classes 임베드는 FK를 명시한다", () => {
  it("힌트 없는 classes( 임베드가 남아 있지 않다", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      const src = stripComments(readFileSync(file, "utf8"));
      if (!src.includes('from("lesson_reports")')) continue;
      // `classes!lesson_reports_class_id_fkey(` 는 통과, 맨몸 `classes(` 는 위반.
      if (/(?<!!)\bclasses\(/.test(src)) offenders.push(file.replace(process.cwd(), ""));
    }
    expect(offenders).toEqual([]);
  });

  it("보고서 목록 select가 실제로 FK 힌트를 달고 있다(스캔이 헛돌지 않는지 확인)", () => {
    const src = readFileSync(join(process.cwd(), "src/features/report-admin/server/actions.ts"), "utf8");
    expect(src).toContain("classes!lesson_reports_class_id_fkey(class_name)");
  });
});

/**
 * 0318a가 `student_consultations.class_id → classes` FK를 더했다 — 그 순간 student_consultations는 students↔classes·
 * users↔classes 사이의 **또 하나의 연결 표**가 된다. 이 표에서 반을 끌어올 땐 FK 이름을 붙인다([[#94]] 같은 사고 예방).
 */
describe("student_consultations → classes 임베드는 FK를 명시한다(0318a)", () => {
  it("상담을 읽는 파일에 힌트 없는 classes( 임베드가 없다", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      const src = stripComments(readFileSync(file, "utf8"));
      if (!src.includes('from("student_consultations")')) continue;
      if (/(?<!!)\bclasses\s*\(/.test(src)) offenders.push(file.replace(process.cwd(), ""));
    }
    expect(offenders).toEqual([]);
  });

  it("목록 select가 실제로 FK 힌트를 달고 있다(스캔이 헛돌지 않는지 확인)", () => {
    const src = readFileSync(join(process.cwd(), "src/features/consultations/server/queries.ts"), "utf8");
    expect(src).toContain("classes!student_consultations_class_id_fkey");
  });
});
