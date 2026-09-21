/**
 * 🔴 **`recorded_via`를 쓰는 곳은 그 컬럼이 아직 없어도 살아남아야 한다** — 회귀 방지(#95).
 *
 * aywa의 SQL은 원장이 **손으로** 실행하므로 push와 적용 사이엔 항상 간격이 있다. 0212a가 걸리기 전
 * 배포된 앱이 `recorded_via`를 넣어 insert하면 PostgREST가 컬럼 부재로 실패한다.
 *
 * 2026-08-14 실측: 키오스크 체크인만 폴백이 없었고, 그 실패는 `if (error) return null`(best-effort)로
 * **삼켜져서** 출결이 조용히 안 찍히는 모양이었다(로그도 안 남는다). 눈에 안 보이는 실패라 더 위험하다.
 *
 * 규칙: `recorded_via:`를 페이로드에 넣는 파일은 같은 파일 안에 **컬럼 부재 폴백**을 갖는다
 * (`isMissingViaColumn(...)` 또는 `/recorded_via/i.test(...)`). 0212a가 프로덕션에 적용된 뒤에도
 * 이 가드는 남긴다 — 새 환경(스테이징·복원본)에서 같은 간격이 다시 생긴다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "src", "features", "attendance");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("recorded_via(0212a) 폴백", () => {
  const files = walk(ROOT).map((path) => ({ path, src: readFileSync(path, "utf8") }));

  /** 페이로드에 값으로 넣는 곳만(정규식·주석·타입은 제외). */
  const writers = files.filter((f) => /recorded_via:\s*["'`]/.test(f.src));

  it("쓰는 파일이 실제로 있다(가드가 헛돌지 않게)", () => {
    expect(writers.length).toBeGreaterThan(0);
  });

  it.each(writers.map((f) => f.path))("%s — 컬럼 부재 폴백이 있다", (path) => {
    const src = files.find((f) => f.path === path)!.src;
    const hasFallback =
      src.includes("isMissingViaColumn") || /\/recorded_via\/i\.test/.test(src) || src.includes("withVia(");
    expect(
      hasFallback,
      `${path}: recorded_via를 넣는데 컬럼 부재 폴백이 없다 — 0212a 적용 전 배포되면 이 저장이 조용히 실패한다`,
    ).toBe(true);
  });
});
