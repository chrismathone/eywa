import { describe, expect, it } from "vitest";
import { planLessonShift, type ShiftOp } from "./lesson-shift-chain";

/** ops를 칸 내용 지도에 적용해 결과를 본다 — 실제 서버가 하는 일과 같은 순서. */
function apply(cells: Record<string, string>, ops: ShiftOp[]): Record<string, string> {
  const out = { ...cells };
  for (const o of ops) {
    if (o.op === "clear") delete out[o.at];
    else {
      expect(out[o.to]).toBeUndefined(); // 옮겨 갈 칸은 언제나 비어 있어야 한다(위치 유니크)
      out[o.to] = out[o.from]!;
      if (o.op === "move") delete out[o.from];
    }
  }
  return out;
}

const MONDAYS = ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"];

describe("planLessonShift", () => {
  it("미룸 — 누른 칸은 그대로(복사), 뒤가 한 주씩 밀린다", () => {
    const cells = { "2026-10-19": "S5", "2026-10-26": "S6", "2026-11-02": "S7" };
    const r = planLessonShift({ kind: "skip", fromDate: "2026-10-19", liveDates: MONDAYS, filledDates: Object.keys(cells) });
    if (!r.ok) throw new Error(r.reason);
    expect(apply(cells, r.ops)).toEqual({
      "2026-10-19": "S5",
      "2026-10-26": "S5",
      "2026-11-02": "S6",
      "2026-11-09": "S7",
    });
  });

  it("당김 — 누른 칸에 다음 주 내용이 오고 뒤가 한 주씩 당겨진다", () => {
    const cells = { "2026-10-19": "S5", "2026-10-26": "S6", "2026-11-02": "S7" };
    const r = planLessonShift({ kind: "advance", fromDate: "2026-10-19", liveDates: MONDAYS, filledDates: Object.keys(cells) });
    if (!r.ok) throw new Error(r.reason);
    expect(apply(cells, r.ops)).toEqual({ "2026-10-19": "S6", "2026-10-26": "S7" });
  });

  it("미룸 뒤 당김은 원래대로 돌아온다", () => {
    const cells = { "2026-10-19": "S5", "2026-10-26": "S6", "2026-11-02": "S7" };
    const a = planLessonShift({ kind: "skip", fromDate: "2026-10-19", liveDates: MONDAYS, filledDates: Object.keys(cells) });
    if (!a.ok) throw new Error(a.reason);
    const pushed = apply(cells, a.ops);
    const b = planLessonShift({ kind: "advance", fromDate: "2026-10-19", liveDates: MONDAYS, filledDates: Object.keys(pushed) });
    if (!b.ok) throw new Error(b.reason);
    expect(apply(pushed, b.ops)).toEqual(cells);
  });

  it("사이의 빈 칸도 함께 움직인다(줄 전체 평행 이동)", () => {
    const cells = { "2026-10-19": "A", "2026-11-02": "B" };
    const r = planLessonShift({ kind: "skip", fromDate: "2026-10-19", liveDates: MONDAYS, filledDates: Object.keys(cells) });
    if (!r.ok) throw new Error(r.reason);
    expect(apply(cells, r.ops)).toEqual({ "2026-10-19": "A", "2026-10-26": "A", "2026-11-09": "B" });
  });

  it("휴일(수업일 목록에 없는 주)은 건너뛴다", () => {
    const live = MONDAYS.filter((d) => d !== "2026-10-26");
    const cells = { "2026-10-19": "S5", "2026-11-02": "S6" };
    const r = planLessonShift({ kind: "skip", fromDate: "2026-10-19", liveDates: live, filledDates: Object.keys(cells) });
    if (!r.ok) throw new Error(r.reason);
    expect(apply(cells, r.ops)).toEqual({ "2026-10-19": "S5", "2026-11-02": "S5", "2026-11-09": "S6" });
  });

  it("누른 칸보다 앞의 칸은 건드리지 않는다", () => {
    const cells = { "2026-10-12": "S4", "2026-10-19": "S5" };
    const r = planLessonShift({ kind: "skip", fromDate: "2026-10-19", liveDates: ["2026-10-12", ...MONDAYS], filledDates: Object.keys(cells) });
    if (!r.ok) throw new Error(r.reason);
    expect(apply(cells, r.ops)).toEqual({ "2026-10-12": "S4", "2026-10-19": "S5", "2026-10-26": "S5" });
  });

  it("거절 — 내용 없음 · 다음 수업일 없음 · 당겨올 내용 없음", () => {
    expect(planLessonShift({ kind: "skip", fromDate: "2026-10-19", liveDates: MONDAYS, filledDates: [] })).toEqual({ ok: false, reason: "no-content" });
    expect(planLessonShift({ kind: "skip", fromDate: "2026-10-19", liveDates: ["2026-10-19"], filledDates: ["2026-10-19"] })).toEqual({ ok: false, reason: "no-next-day" });
    expect(planLessonShift({ kind: "advance", fromDate: "2026-10-19", liveDates: MONDAYS, filledDates: ["2026-10-19"] })).toEqual({ ok: false, reason: "nothing-after" });
  });

  it("빈 칸에서 미루면 뒤만 밀린다 · 빈 칸에서 당기면 다음 내용이 온다", () => {
    const cells = { "2026-10-26": "S6" };
    const s = planLessonShift({ kind: "skip", fromDate: "2026-10-19", liveDates: MONDAYS, filledDates: Object.keys(cells) });
    if (!s.ok) throw new Error(s.reason);
    expect(apply(cells, s.ops)).toEqual({ "2026-11-02": "S6" });
    const a = planLessonShift({ kind: "advance", fromDate: "2026-10-19", liveDates: MONDAYS, filledDates: Object.keys(cells) });
    if (!a.ok) throw new Error(a.reason);
    expect(apply(cells, a.ops)).toEqual({ "2026-10-19": "S6" });
  });
});
