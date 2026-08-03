/**
 * ECS 접근 스코프의 **세 갈래가 두 곳에서 갈리지 않게** 잠근다 (0173a 반 임시 위임).
 *
 * ECS는 "볼 수 있는 반"을 두 곳에서 판정한다:
 *  · `requireEcsClassAccess` — 반 하나를 열 때(게이트, 모든 액션·조회가 통과)
 *  · `ecsVisibleClassFilter` — 랜딩 목록·반 전환 드롭다운에 뿌릴 때
 * 두 곳의 소스 집합이 갈라지면 **"목록엔 뜨는데 열면 담당 반이 아닙니다"** 또는 그 반대가 된다.
 * (반담당 → 부담임(2026-07-29) → 위임(2026-08-03)으로 소스가 늘어날 때마다 생기는 위험이라 테스트로 못박는다.)
 *
 * ⚠️ 소스를 하나 더 늘리면 **이 배열에도 추가**할 것 — 그게 "두 곳 다 고쳤나"의 체크리스트다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCES = [
  "scope.classIds", // ① 반담당(전역 teacher-scope)
  "ecsAssistantClassIds", // ② 부담임(슬롯 강사 FK, ECS 전용 확장)
  "ecsDelegatedClassIds", // ③ 임시 위임(0173a, ECS 전용 확장)
] as const;

/** `export ... <name> = ...` 또는 `export async function <name>`부터 다음 최상위 선언 전까지. */
function functionBody(src: string, name: string): string {
  const start = src.search(new RegExp(`export (async function|const) ${name}\\b`));
  expect(start, `${name}를 access.ts에서 찾지 못했다`).toBeGreaterThan(-1);
  const rest = src.slice(start + 1);
  const nextExport = rest.search(/\nexport (async function|const|type) /);
  return nextExport === -1 ? rest : rest.slice(0, nextExport);
}

describe("ECS 스코프 소스", () => {
  const src = readFileSync(
    join(process.cwd(), "src", "features", "class-sheets", "server", "access.ts"),
    "utf8",
  );

  for (const fn of ["requireEcsClassAccess", "ecsVisibleClassFilter"] as const) {
    it(`${fn}가 세 갈래를 모두 본다`, () => {
      const body = functionBody(src, fn);
      const missing = SOURCES.filter((s) => !body.includes(s));
      expect(
        missing,
        `${fn}에 빠진 스코프 소스 — 게이트와 목록이 갈리면 "목록엔 뜨는데 열면 거절"이 된다:\n  ${missing.join("\n  ")}`,
      ).toEqual([]);
    });
  }

  it("전역 teacher-scope는 ECS 확장에 오염되지 않는다(교재요청 쓰기·시간표 파급 방지)", () => {
    const globalScope = readFileSync(join(process.cwd(), "src", "lib", "auth", "teacher-scope.ts"), "utf8");
    // 부담임·위임은 **ECS 전용 확장**이다. 전역 스코프가 이들을 흡수하면 교재요청 쓰기까지 함께 열린다
    // (2026-07-29에 실제로 누출 155건이 났던 자리).
    expect(globalScope).not.toContain("ecsAssistantClassIds");
    expect(globalScope).not.toContain("class_delegations");
    expect(globalScope).not.toContain("getDelegatedClassIdsInRange");
  });
});
