/**
 * 🔴 ClassNote 반 보드 '대상 반'은 두 곳이 같은 조건이어야 한다 — 연동 PC 워커 `targetClassWhere`(scripts/_classnote/math-class-boards-load.mjs)
 *    ↔ 원스크린 C.N 아이콘의 대상 반 조회(src/features/onescreen/server/classnote-match.ts `getClassnoteMatchMap`).
 *
 * 2026-11-03 'JJ 맞춤'(1d0b1b4f0 · 연동 PC 1.0.12 — PC에는 적용 안 됨)은 워커에서만 `not c.report_optout`을 빼서 두 조건이 갈라졌다.
 * 2026-11-04 원장 *"JJ 미발송반은 클래스노트 반배정도 할 필요없음"* — 둘 다 **보고서 발송 반만**(미발송 제외)으로 맞춘다.
 * 한쪽만 바꾸면 이 시험이 실패한다. 조건을 바꿀 땐 두 곳과 이 시험을 함께 고칠 것.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** 워커 조각의 SQL 템플릿 본문(`targetClassWhere = (sql, tenant, today) => sql\`…\``). */
function workerTargetSql(): string {
  const src = read("scripts/_classnote/math-class-boards-load.mjs");
  const m = src.match(/export const targetClassWhere = \(sql, tenant, today\) =>\s*sql`([^`]*)`/);
  if (!m) throw new Error("targetClassWhere 조각을 찾지 못했다(모양이 바뀌면 이 가드도 바꾼다)");
  return m[1];
}

/** 주석을 걷는다 — 조건을 지우고 주석에만 같은 글자를 남겨도 통과하지 않게(report-optout-guard.test.mjs와 같은 이유). */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** 원스크린 대상 반 조회 — `.from("classes")`부터 그 조회의 `.range(` 까지(같은 함수 안 다른 조회와 섞이지 않게) · 주석 제외. */
function serverTargetQuery(): string {
  const src = read("src/features/onescreen/server/classnote-match.ts");
  const at = src.indexOf('.from("classes")');
  if (at < 0) throw new Error('classnote-match.ts에서 .from("classes") 조회를 찾지 못했다');
  const end = src.indexOf(".range(", at);
  return stripComments(src.slice(at, end < 0 ? undefined : end));
}

/** 함수 하나의 SQL 템플릿 본문만(sql`…`) — 주석·JSDoc·다음 함수는 안 본다. 끝 = 0열의 닫는 괄호(`\n}` — LF·CRLF 둘 다). */
function workerFunctionSql(src: string, head: string): string {
  const at = src.indexOf(head);
  if (at < 0) throw new Error(`${head}를 찾지 못했다(모양이 바뀌면 이 가드도 바꾼다)`);
  const end = src.indexOf("\n}", at);
  const body = src.slice(at, end < 0 ? undefined : end);
  return [...body.matchAll(/sql`([^`]*)`/g)].map((m) => m[1]).join("\n");
}

describe("ClassNote 대상 반 — 워커 ↔ 원스크린 아이콘", () => {
  it("둘 다 활성 · 수학(math·subject_1) · 보고서 발송 반(미발송 제외)", () => {
    const worker = workerTargetSql();
    expect(worker).toContain("c.is_active");
    expect(worker).toContain("not c.report_optout");
    expect(worker).toContain("c.subject in ('math', 'subject_1')");

    const server = serverTargetQuery();
    expect(server).toContain('.in("subject", ["math", "subject_1"])');
    expect(server).toContain('.eq("is_active", true)');
    expect(server).toContain('.eq("report_optout", false)');
  });

  it("종강 반 연결 지키기(loadClosedLinked)도 미발송 반을 지키지 않는다 — 미발송 반의 옛 연결은 정기 동기화가 걷는다", () => {
    const sqlText = workerFunctionSql(read("scripts/_classnote/math-class-boards-load.mjs"), "export async function loadClosedLinked(");
    expect(sqlText).toContain("from classes c");
    expect(sqlText).toContain("not c.report_optout");
  });
});
