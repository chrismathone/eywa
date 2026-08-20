import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 비서 툴 **메뉴 게이트 배선 가드** — 툴 하나가 곧 한 화면의 데이터다. 그 화면을 못 여는 사람이
 * 비서로 우회 조회하는 구멍(#77)을 막으려면 툴마다 requireMenu가 있어야 한다.
 *
 * 왜 구조 가드인가: 게이트가 빠진 새 툴은 **에러 없이 잘 동작한다** — 권한이 있는 사람(개발·원장)
 * 계정에서는 아무 차이가 없어서 리뷰에서도 안 보인다. 실제로 직원 툴 3종이 그 상태로 한 달을 돌았다
 * (2026-08-20 배선). 그래서 "그 사람은 못 보는데?"를 사람이 아니라 테스트가 묻게 한다.
 */
const TOOLS_DIR = resolve(process.cwd(), "src/features/assistant/server");

function toolFiles(): string[] {
  return readdirSync(TOOLS_DIR)
    .filter((f) => /^tools-.*\.ts$/.test(f) && !f.endsWith(".test.ts"))
    .map((f) => join(TOOLS_DIR, f));
}

/** `name: "x"` ~ 다음 툴 선언 전까지를 한 툴의 본문으로 자른다(정확한 파서가 필요 없는 수준). */
function toolBlocks(source: string): { name: string; body: string }[] {
  const starts = [...source.matchAll(/betaZodTool\(\{/g)].map((m) => m.index ?? 0);
  return starts.map((start, i) => {
    const body = source.slice(start, starts[i + 1] ?? source.length);
    const name = body.match(/name:\s*"([a-z_]+)"/)?.[1] ?? "(이름 없음)";
    return { name, body };
  });
}

describe("비서 툴 메뉴 게이트", () => {
  it("툴 파일이 실제로 스캔된다(경로가 바뀌면 가드가 조용히 통과하지 않게)", () => {
    expect(toolFiles().length).toBeGreaterThanOrEqual(6);
  });

  it("모든 툴이 requireMenu 게이트를 통과한다", () => {
    const missing: string[] = [];
    for (const file of toolFiles()) {
      const source = readFileSync(file, "utf8");
      for (const { name, body } of toolBlocks(source)) {
        // 파일 상단 상수(GATE·STAFF_GATE…)로 감싼 형태도 인정 — 실제 호출이 run 안에 있으면 된다.
        const gated = /requireMenu\(|_?GATE\(\)/.test(body);
        if (!gated) missing.push(`${file.split(/[\\/]/).pop()}:${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("게이트가 지목하는 메뉴 키는 permissions의 MENU_KEYS 안에 있다", async () => {
    const { MENU_KEYS } = await import("@/lib/permissions");
    const keys = new Set<string>(MENU_KEYS as readonly string[]);
    const used: string[] = [];
    for (const file of toolFiles()) {
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/requireMenu\(\s*"([a-z_]+)"/g)) used.push(m[1]!);
    }
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((k) => !keys.has(k))).toEqual([]);
  });
});
