import { describe, expect, it } from "vitest";
import { mapPool } from "./async-pool";

describe("mapPool — 동시 실행 상한 + 입력 순서 결과(B12)", () => {
  it("결과는 끝난 순서가 아니라 입력 순서", async () => {
    const out = await mapPool([30, 5, 15], 3, (ms) => new Promise<number>((r) => setTimeout(() => r(ms), ms)));
    expect(out).toEqual([30, 5, 15]);
  });

  it("동시에 limit개를 넘지 않는다", async () => {
    let running = 0;
    let peak = 0;
    await mapPool(Array.from({ length: 20 }, (_, i) => i), 6, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      running -= 1;
    });
    expect(peak).toBe(6);
  });

  it("빈 목록 · 하나라도 실패하면 던진다", async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
    await expect(mapPool([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error("x"); return n; })).rejects.toThrow("x");
  });
});
