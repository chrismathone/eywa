import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 테넌트 격리 — **admin 클라이언트는 RLS 를 우회한다.** service.ts 의 질의에서
 * 한 테이블만 tenant 필터가 빠져도 다른 학원의 학생·진도가 이 API 로 나간다.
 *
 * 그래서 소스를 직접 세어 잠근다:
 *   ① `.from("…")` 호출 하나마다 tenant_id 필터가 하나 이상
 *   ② `!inner` 조인 임베드마다 임베드 쪽 tenant_id 필터가 하나
 *
 * 텍스트 가드는 그 낱말이 다른 곳에도 있으면 장식이 된다(testautocreator
 * 2026-08-18 `LOOP` 사건) — 그래서 낱말이 아니라 **호출 모양**을 세고,
 * 맨 아래 「가드의 가드」가 이 검사가 실제로 잡는지 픽스처로 확인한다.
 */

const SOURCE = readFileSync(path.join(__dirname, "service.ts"), "utf8");

function countMatches(text: string, re: RegExp): number {
  return [...text.matchAll(re)].length;
}

/** `.select("…")` 의 문자열 부분만 — 주석 속 낱말이 분모에 안 들어가게. */
function selectStrings(text: string): string[] {
  return [...text.matchAll(/\.select\(\s*\n?\s*"([^"]+)"/g)].map((m) => m[1]!);
}

describe("todays-math 연계 — 테넌트 격리 (구조 검사)", () => {
  it("`.from()` 마다 루트 tenant_id 필터가 있다", () => {
    const fromCalls = countMatches(SOURCE, /\.from\(\s*"[a-z_]+"\s*\)/g);
    const rootFilters = countMatches(SOURCE, /\.eq\(\s*"tenant_id"\s*,\s*tenantId\s*\)/g);
    expect(fromCalls).toBeGreaterThan(0);
    expect(rootFilters).toBeGreaterThanOrEqual(fromCalls);
  });

  it("`!inner` 임베드마다 임베드 쪽 tenant_id 필터가 있다", () => {
    // 🔴 주석에도 `!inner` 가 나온다 — 소스 전체에서 세면 주석이 분모를 부풀려
    //    멀쩡한 코드가 빨개진다(실제로 한 번 그랬다). **select 문자열 안**만 센다.
    const embeds = selectStrings(SOURCE).filter((s) => s.includes("!inner")).length;
    const embedFilters = countMatches(SOURCE, /\.eq\(\s*"[a-z_]+\.tenant_id"\s*,\s*tenantId\s*\)/g);
    expect(embeds).toBeGreaterThan(0);
    expect(embedFilters).toBeGreaterThanOrEqual(embeds);
  });

  it("임베드한 테이블의 tenant_id 를 select 목록에도 실어 온다 (필터 증거)", () => {
    // 임베드 select 문자열 안에 tenant_id 가 있어야 PostgREST 필터가 실제로 적용된다.
    const embedSelects = selectStrings(SOURCE).filter((s) => s.includes("!inner"));
    expect(embedSelects.length).toBeGreaterThan(0);
    for (const sel of embedSelects) expect(sel).toContain("tenant_id");
  });

  /**
   * 🔴 가드의 가드 — 이 정규식들이 «필터 빠진 코드»를 실제로 잡는지 확인한다.
   *    못 잡는 모양이면 위 검사는 영원히 초록이고 아무것도 안 지킨다.
   */
  it("[가드의 가드] 필터를 뺀 픽스처에서 검사가 빨개진다", () => {
    const bad = `
      admin.from("students").select("id").eq("status", "enrolled");
      admin.from("lesson_reports").select("id, students!inner(status)").eq("tenant_id", tenantId);
    `;
    const fromCalls = countMatches(bad, /\.from\(\s*"[a-z_]+"\s*\)/g);
    const rootFilters = countMatches(bad, /\.eq\(\s*"tenant_id"\s*,\s*tenantId\s*\)/g);
    const embeds = selectStrings(bad).filter((s) => s.includes("!inner")).length;
    const embedFilters = countMatches(bad, /\.eq\(\s*"[a-z_]+\.tenant_id"\s*,\s*tenantId\s*\)/g);
    expect(fromCalls).toBe(2);
    expect(rootFilters).toBe(1); // 2 < 필요 — ① 이 잡는다
    expect(embeds).toBe(1);
    expect(embedFilters).toBe(0); // 1 < 필요 — ② 가 잡는다
  });
});
