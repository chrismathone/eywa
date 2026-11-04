// 🔴 보고서 미발송 반(JJ 자리 반 · classes.report_optout) 차단 SQL 가드 — 2026-11-03부터 동기화가 JJ 반 보드도 연결하므로,
// 워커의 반 보드 발송 대상 조회 세 곳이 `not c.report_optout`으로 막아야 JJ 반에 수업보고서·영상 게시 반이 새지 않는다(리뷰 C2·R13·F13).
// 함수 범위(isClassRouteEligible · resolveClassTargets · loadVideoTeacher)로 자르고, JS 주석(// · /* */)과 SQL 템플릿 안의 `--` 주석을 걷은 뒤
// **SQL 템플릿(sql`…`) 안에서만** 센다 — 파일 전체 글자를 세면 SQL에서 지우고 주석에 같은 글자를 써도 통과한다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** 한 함수의 본문 — `export async function 이름(`부터 다음 최상위 `export`(또는 파일 끝)까지. 없으면 null. */
function functionBody(source, name) {
  const s = String(source);
  const at = s.search(new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\s*\\(`));
  if (at < 0) return null;
  const next = s.slice(at + 1).search(/\r?\nexport\s/);
  return next < 0 ? s.slice(at) : s.slice(at, at + 1 + next);
}
/** JS 주석을 걷은 뒤 sql`…` 템플릿 본문만 모은다 — 템플릿 안의 SQL `--` 주석도 걷는다(주소의 `://`는 JS 주석이 아니다). */
function sqlTemplates(code) {
  const stripped = String(code)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  return [...stripped.matchAll(/\bsql`([^`]*)`/g)].map((m) => m[1].replace(/--[^\n]*/g, ""));
}
const read = (f) => readFileSync(join(process.cwd(), "scripts/_classnote", f), "utf8");
const optoutIn = (f, fn) => {
  const body = functionBody(read(f), fn);
  if (body == null) throw new Error(`${f}: 함수 ${fn}를 찾지 못했다(이름이 바뀌면 이 가드도 바꾼다)`);
  return sqlTemplates(body).filter((t) => /not\s+c\.report_optout/.test(t));
};

describe("보고서 미발송 반 차단 SQL — 함수마다", () => {
  it("발송 가능 판정(isClassRouteEligible) · 반 보드 찾기(resolveClassTargets) · 영상 게시 반 잇기(loadVideoTeacher) 각각 한 번", () => {
    for (const [file, fn] of [["classnote-class-route.mjs", "isClassRouteEligible"], ["classnote-class-route.mjs", "resolveClassTargets"], ["video-teacher-route.mjs", "loadVideoTeacher"]]) {
      const hits = optoutIn(file, fn);
      expect(hits, `${file} ${fn}`).toHaveLength(1);
      expect(hits[0], `${file} ${fn}`).toMatch(/classnote_class_boards/);
      expect(hits[0], `${file} ${fn}`).toMatch(/classes c/);
    }
  });
  it("가드 자체 — JS 주석·SQL `--` 주석에만 적힌 글자는 세지 않는다 · 주소의 :// 는 주석이 아니다 · 함수 범위로 자른다", () => {
    const fake = [
      "export async function a(sql) {",
      "  // not c.report_optout",
      "  /* not c.report_optout */",
      "  const u = \"https://x\";",
      "  return sql`select 1 from classes c -- not c.report_optout\n where c.is_active`;",
      "}",
      "export async function b(sql) {",
      "  return sql`select 2 from classes c where not c.report_optout`;",
      "}",
    ].join("\n");
    expect(sqlTemplates(functionBody(fake, "a")).filter((t) => /not\s+c\.report_optout/.test(t))).toEqual([]);
    expect(sqlTemplates(functionBody(fake, "b"))).toEqual(["select 2 from classes c where not c.report_optout"]);
    expect(functionBody(fake, "없음")).toBeNull();
  });
});
