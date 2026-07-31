import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const L = require_("./lib.cjs") as {
  billingMonthRange: (today: string | Date, months?: number) => { from: string; to: string };
};

// 이 범위가 곧 "동기화가 볼 수 있는 세계"다. 좁으면 그 달이 조용히 동결되고(2026-07 미수 ₩12.86M이
// 07-16 스냅샷으로 굳었다), 넓히면 makeedu에 1회 조회로 여러 달을 받는다(실측 857 → 3,174건).
describe("billingMonthRange — 스크랩할 청구월 범위", () => {
  it("기본 3개월 = 당월 + 직전 2개월", () => {
    expect(L.billingMonthRange("2026-07-30")).toEqual({ from: "2026-05", to: "2026-07" });
  });

  it("1개월이면 당월만(옛 동작)", () => {
    expect(L.billingMonthRange("2026-07-30", 1)).toEqual({ from: "2026-07", to: "2026-07" });
  });

  // 🔴 연말 경계 — 1월에서 뒤로 가면 연도가 내려가야 한다. 여기서 틀리면 12월 청구가 통째로 안 잡힌다.
  it("연을 넘어간다", () => {
    expect(L.billingMonthRange("2026-01-05", 3)).toEqual({ from: "2025-11", to: "2026-01" });
    expect(L.billingMonthRange("2026-02-01", 6)).toEqual({ from: "2025-09", to: "2026-02" });
  });

  it("월은 항상 2자리(makeedu 입력 형식 YYYY-MM)", () => {
    const r = L.billingMonthRange("2026-10-01", 3);
    expect(r).toEqual({ from: "2026-08", to: "2026-10" });
    expect(r.from).toMatch(/^\d{4}-\d{2}$/);
    expect(r.to).toMatch(/^\d{4}-\d{2}$/);
  });

  // 잘못된 입력이 범위를 0개월·음수로 만들면 조회가 빈 결과를 내고 임포터의 0행 가드가 동기화를 멈춘다.
  // (env `MAKEEDU_INVOICE_MONTHS`를 사람이 손으로 넣는 자리라 쓰레기 값이 실제로 들어올 수 있다.)
  it("0·음수·NaN은 최소 1개월로 클램프한다", () => {
    for (const bad of [0, -3, NaN])
      expect(L.billingMonthRange("2026-07-30", bad)).toEqual({ from: "2026-07", to: "2026-07" });
  });

  // undefined는 "쓰레기 값"이 아니라 **미지정**이다 — 기본값(3개월)이 나와야 한다.
  it("미지정(undefined)은 기본 3개월", () => {
    expect(L.billingMonthRange("2026-07-30", undefined)).toEqual({ from: "2026-05", to: "2026-07" });
  });

  it("Date 객체도 받는다(KST 기준)", () => {
    // 2026-07-30 20:00 UTC = KST 2026-07-31 05:00 → 같은 달
    expect(L.billingMonthRange(new Date("2026-07-30T20:00:00Z"), 1)).toEqual({
      from: "2026-07",
      to: "2026-07",
    });
    // 2026-07-31 16:00 UTC = KST 2026-08-01 01:00 → 8월로 넘어간다
    expect(L.billingMonthRange(new Date("2026-07-31T16:00:00Z"), 1)).toEqual({
      from: "2026-08",
      to: "2026-08",
    });
  });
});
