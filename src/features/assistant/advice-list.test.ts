// '지난 의견' 현황 · 묶기 · 거르기(제안 → 결과 → 학습 3단계 첫 조각 · 2026-11-10).
import { describe, expect, it } from "vitest";
import type { AdviceView } from "./advice";
import { groupAdvice, matchesFilter, summarizeAdvice, type AdviceListItem } from "./advice-list";

const view = (over: Partial<AdviceView> = {}): AdviceView => ({
  id: "a0",
  itemNo: 0,
  status: "open",
  statusAt: "2026-11-09T06:00:00+00:00",
  memo: null,
  doneOn: null,
  selfRating: null,
  check: { label: "결석률", unit: "percent", better: "down", windowDays: 14, baseline: { value: 18, sample: 50, from: "2026-10-24", to: "2026-11-07" }, nextCheckOn: "2026-11-25" },
  noCheck: null,
  measureState: "waiting",
  result: null,
  doneCheck: null,
  targets: null,
  askedOn: "2026-11-09",
  ...over,
});
const RESULT = { verdict: "improved" as const, base: 18, baseSample: 50, value: 9, sample: 48, from: "2026-11-11", to: "2026-11-25", checkedAt: "2026-11-27T20:10:00+00:00", reason: null, basis: "asked" as const, anchor: "2026-11-09", threshold: 4 };

const item = (id: string, messageId: string, createdAt: string, itemNo: number, over: Partial<AdviceView> = {}): AdviceListItem => ({
  view: view({ id, itemNo, ...over }),
  action: `의견 ${id}`,
  why: "근거",
  threadId: `t-${messageId}`,
  threadTitle: `대화 ${messageId}`,
  messageId,
  createdAt,
});

describe("matchesFilter", () => {
  it("처리할 것 = 처리 전·채택·보류 · 끝낸 것 = 완료·안 함 · 결과 나옴 = 다시 잰 값이 있다", () => {
    for (const s of ["open", "adopted", "on_hold"] as const) expect([matchesFilter(view({ status: s }), "todo"), matchesFilter(view({ status: s }), "closed")]).toEqual([true, false]);
    for (const s of ["done", "declined"] as const) expect([matchesFilter(view({ status: s }), "todo"), matchesFilter(view({ status: s }), "closed")]).toEqual([false, true]);
    expect(matchesFilter(view(), "result")).toBe(false);
    expect(matchesFilter(view({ status: "done", result: RESULT, measureState: "measured" }), "result")).toBe(true);
    expect(matchesFilter(view({ status: "declined" }), "all")).toBe(true);
  });
});

describe("summarizeAdvice", () => {
  it("처리 상태별 · 거르기별 · 판정별 · 기다리는 수 · 가장 가까운 재측정(오늘 이후만)", () => {
    const s = summarizeAdvice(
      [
        view({ id: "1" }),
        view({ id: "2", status: "adopted", check: { ...view().check!, nextCheckOn: "2026-11-18" } }),
        view({ id: "3", status: "done", measureState: "measured", result: RESULT }),
        view({ id: "4", status: "declined", measureState: "measured", result: { ...RESULT, verdict: "flat" } }),
        // 다시 잴 날이 지났는데 아직 기다림 — '가장 가까운 재측정'으로 약속하지 않는다
        view({ id: "5", check: { ...view().check!, nextCheckOn: "2026-11-01" } }),
        view({ id: "6", check: null, noCheck: "확인 지표를 받지 못했습니다", measureState: "none" }),
      ],
      "2026-11-10",
    );
    expect(s.total).toBe(6);
    expect(s.byStatus).toEqual({ open: 3, adopted: 1, done: 1, on_hold: 0, declined: 1 });
    expect(s.byFilter).toEqual({ all: 6, todo: 4, result: 2, closed: 2 });
    expect(s.byVerdict).toEqual({ improved: 1, flat: 1, worse: 0, unknown: 0 });
    expect(s.waiting).toBe(3);
    expect(s.nextCheckOn).toBe("2026-11-18");
    expect(summarizeAdvice([view({ check: { ...view().check!, nextCheckOn: "2026-11-01" } })], "2026-11-10").nextCheckOn).toBeNull();
  });
});

describe("groupAdvice", () => {
  const items = [
    item("a", "m1", "2026-11-08T03:00:00+00:00", 1),
    item("b", "m2", "2026-11-09T05:00:00+00:00", 0, { status: "done" }),
    item("c", "m1", "2026-11-08T03:00:00+00:00", 0),
    item("d", "m2", "2026-11-09T05:00:00+00:00", 1),
  ];
  it("새 답이 위 · 답 안은 의견 번호 순 · 의견을 낸 날은 한국 날짜", () => {
    const g = groupAdvice(items, "all");
    expect(g.map((x) => [x.messageId, x.askedOn, x.items.map((i) => i.view.id)])).toEqual([
      ["m2", "2026-11-09", ["b", "d"]],
      ["m1", "2026-11-08", ["c", "a"]],
    ]);
    // 한국 시각으로 다음 날(UTC 15시 이후)이면 그 날
    expect(groupAdvice([item("x", "m3", "2026-11-09T15:30:00+00:00", 0)], "all")[0]!.askedOn).toBe("2026-11-10");
  });
  it("거르면 빈 답은 빠진다 · 처리해 조건을 벗어난 의견은 keep에 있으면 남는다 · 화면에서 저장한 상태로 거른다", () => {
    expect(groupAdvice(items, "closed").map((x) => x.items.map((i) => i.view.id))).toEqual([["b"]]);
    const doneNow = (i: AdviceListItem) => (i.view.id === "c" ? { ...i.view, status: "done" as const } : i.view);
    expect(groupAdvice(items, "todo", doneNow).map((x) => x.items.map((i) => i.view.id))).toEqual([["d"], ["a"]]);
    expect(groupAdvice(items, "todo", doneNow, new Set(["c"])).map((x) => x.items.map((i) => i.view.id))).toEqual([["d"], ["c", "a"]]);
  });
});
