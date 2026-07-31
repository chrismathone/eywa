import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const L = require_("./lib.cjs") as {
  billingMonthRange: (a?: {
    anchor?: string | null;
    months?: number;
    today?: string | Date;
  }) => { from: string; to: string };
};

// 이 범위가 곧 "동기화가 볼 수 있는 세계"다. 여기서 한 달을 놓치면 그 달이 통째로 동결된다.
describe("billingMonthRange — 스크랩할 청구월 범위", () => {
  // 🔴🔴 2026-07-31 실측 사고 — makeedu는 **선청구**라 달력 7월에 이미 청구월이 2026-08이었다.
  // 달력으로 계산해 2026-05~07을 넣었더니 **살아있는 2026-08이 통째로 빠졌고**, 그 달 360건이
  // 한 번도 갱신되지 않아 미수 ₩54M이 옛 스냅샷으로 굳었다. 앵커는 반드시 makeedu가 말하는 청구월이다.
  it("앵커(화면의 현재 청구월)를 기준으로 잡는다 — 달력 월이 아니다", () => {
    expect(L.billingMonthRange({ anchor: "2026-08", months: 3, today: "2026-07-31" })).toEqual({
      from: "2026-06",
      to: "2026-08",
    });
  });

  it("앵커가 `YYYYMM` 형식이어도 읽는다", () => {
    expect(L.billingMonthRange({ anchor: "202608", months: 2, today: "2026-07-31" })).toEqual({
      from: "2026-07",
      to: "2026-08",
    });
  });

  // 화면 값을 못 읽었을 때 달력 당월만 잡으면 같은 사고가 재현된다 → 선청구를 감안해 한 달 더 넓게.
  it("앵커가 없으면 달력 당월 +1까지 본다(선청구 대비, 빈 달은 무해)", () => {
    expect(L.billingMonthRange({ anchor: null, months: 3, today: "2026-07-31" })).toEqual({
      from: "2026-06",
      to: "2026-08",
    });
    expect(L.billingMonthRange({ months: 1, today: "2026-07-31" })).toEqual({
      from: "2026-08",
      to: "2026-08",
    });
  });

  // 화면 값이 과거로 굳어 있는 이상 상황 — 그걸 그대로 믿으면 현재 달을 또 놓친다.
  it("앵커가 달력 당월보다 과거면 달력 당월을 쓴다", () => {
    expect(L.billingMonthRange({ anchor: "2026-05", months: 1, today: "2026-07-31" })).toEqual({
      from: "2026-07",
      to: "2026-07",
    });
  });

  it("1개월이면 앵커 달만", () => {
    expect(L.billingMonthRange({ anchor: "2026-08", months: 1, today: "2026-07-31" })).toEqual({
      from: "2026-08",
      to: "2026-08",
    });
  });

  // 🔴 연말 경계 — 여기서 틀리면 12월 청구가 통째로 안 잡힌다.
  it("연을 넘어간다", () => {
    expect(L.billingMonthRange({ anchor: "2026-01", months: 3, today: "2025-12-20" })).toEqual({
      from: "2025-11",
      to: "2026-01",
    });
    expect(L.billingMonthRange({ anchor: "2026-02", months: 6, today: "2026-01-10" })).toEqual({
      from: "2025-09",
      to: "2026-02",
    });
  });

  it("월은 항상 2자리(makeedu 입력 형식 YYYY-MM)", () => {
    const r = L.billingMonthRange({ anchor: "2026-10", months: 3, today: "2026-09-15" });
    expect(r).toEqual({ from: "2026-08", to: "2026-10" });
    expect(r.from).toMatch(/^\d{4}-\d{2}$/);
    expect(r.to).toMatch(/^\d{4}-\d{2}$/);
  });

  // env `MAKEEDU_INVOICE_MONTHS`를 사람이 손으로 넣는 자리라 쓰레기 값이 실제로 들어올 수 있다.
  it("0·음수·NaN은 최소 1개월로 클램프한다", () => {
    for (const bad of [0, -3, NaN])
      expect(L.billingMonthRange({ anchor: "2026-08", months: bad, today: "2026-07-31" })).toEqual({
        from: "2026-08",
        to: "2026-08",
      });
  });

  it("미지정(undefined)은 기본 3개월", () => {
    expect(L.billingMonthRange({ anchor: "2026-08", today: "2026-07-31" })).toEqual({
      from: "2026-06",
      to: "2026-08",
    });
  });

  it("인자 없이도 죽지 않는다(달력 폴백)", () => {
    const r = L.billingMonthRange();
    expect(r.from).toMatch(/^\d{4}-\d{2}$/);
    expect(r.to).toMatch(/^\d{4}-\d{2}$/);
  });
});
