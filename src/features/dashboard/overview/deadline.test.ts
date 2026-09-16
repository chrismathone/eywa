import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OVERVIEW_BUDGET_MS, remainingMs, settleWithin } from "./deadline";

const never = () => new Promise<void>(() => {});

describe("운영실 렌더 마감", () => {
  it("예산은 세그먼트 상한(60초)보다 넉넉히 짧다 — 응답을 내보낼 여유", () => {
    expect(OVERVIEW_BUDGET_MS).toBeLessThan(60_000 / 2);
  });

  it("남은 시간은 음수가 되지 않는다", () => {
    expect(remainingMs(1_000, 5_000, 2_000)).toBe(4_000);
    expect(remainingMs(1_000, 5_000, 9_999)).toBe(0);
  });

  it("전부 끝나면 마감을 안 기다린다", async () => {
    const started = Date.now();
    await settleWithin([Promise.resolve(1), Promise.resolve(2)], 5_000);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("🔴 안 끝나는 조회가 있어도 마감에 돌아온다 — 페이지가 통째로 죽지 않는다", async () => {
    const started = Date.now();
    await settleWithin([Promise.resolve(1), never()], 30);
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("🔴 거절한 조회가 전체를 무너뜨리지 않는다 — 던지지 않는다", async () => {
    await expect(settleWithin([Promise.reject(new Error("조회 실패")), Promise.resolve(1)], 5_000)).resolves.toBeUndefined();
  });

  it("예산이 이미 바닥이면 기다리지 않는다", async () => {
    const started = Date.now();
    await settleWithin([never()], 0);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("할 일이 없으면 즉시 돌아온다", async () => {
    await expect(settleWithin([], 5_000)).resolves.toBeUndefined();
  });

  it("🔴 운영실 서버가 전부 기다리지 않는다 — 마감을 지나 화면을 낸다", () => {
    const src = readFileSync(join(process.cwd(), "src/features/dashboard/overview/server.ts"), "utf8");
    expect(src).toContain("settleWithin(jobs");
    // 되돌아가면 카드 하나가 늘어질 때 페이지 전체가 504가 된다(원장 콘솔 2026-09-16).
    // 같은 파일의 다른 팬아웃(`todayActions`의 `Promise.all`)은 대상이 아니다 — 그건 이 마감 **안에서** 돈다.
    // `allSettled`·세미콜론 없는 꼴까지 — 다만 같은 파일의 다른 팬아웃은 `return (await …` 이라 안 걸린다.
    expect(src).not.toMatch(/(^|\n)\s*await Promise\.all(Settled)?\(jobs\)/);
  });
});
