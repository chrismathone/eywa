import { describe, expect, it } from "vitest";
import { diffShift, isEmptyUndo, planShiftUndo, slotOf, toUndoLine, type UndoLine } from "./shift-undo";

const L = (id: string, date: string, progress: string, lineNo = 1): UndoLine => ({
  id,
  plan_date: date,
  slot_start: "18:20",
  term_mode: "regular",
  skill_area: "grammar",
  line_no: lineNo,
  textbook: "Grammar",
  page_range: "25분",
  progress,
  homework: null,
});

describe("diffShift", () => {
  it("지워진·생긴·고친 줄과 바뀐 표식만 담는다", () => {
    const t = diffShift({
      classId: "c",
      date: "2027-01-05",
      slot: "18:20",
      before: [L("a", "2027-01-05", "U1"), L("b", "2027-01-08", "U2"), L("same", "2027-01-12", "U3")],
      after: [L("b", "2027-01-08", "U1"), L("n", "2027-01-15", "U2"), L("same", "2027-01-12", "U3")],
      markersBefore: {},
      markersAfter: { "2027-01-05|18:20": "skip" },
    });
    expect(t.removed.map((r) => r.id)).toEqual(["a"]);
    expect(t.added.map((r) => r.id)).toEqual(["n"]);
    expect(t.changed.map((c) => [c.before.progress, c.after.progress])).toEqual([["U2", "U1"]]);
    expect(t.markers).toEqual([{ key: "2027-01-05|18:20", before: null, after: "skip" }]);
    expect(isEmptyUndo(t)).toBe(false);
  });

  it("toUndoLine — time·date 표기를 고정", () => {
    expect(toUndoLine({ id: 1, plan_date: "2027-01-05", slot_start: "18:20:00", line_no: "2", skill_area: "g", term_mode: "regular" }))
      .toMatchObject({ id: "1", slot_start: "18:20", line_no: 2, textbook: null });
  });
});

describe("planShiftUndo", () => {
  const token = diffShift({
    classId: "c",
    date: "2027-01-05",
    slot: "18:20",
    before: [L("a", "2027-01-05", "U1"), L("b", "2027-01-08", "U2")],
    after: [L("b", "2027-01-08", "U1"), L("n", "2027-01-12", "U2")],
    markersBefore: {},
    markersAfter: { "2027-01-05|18:20": "skip" },
  });
  const now = new Map([
    ["b", L("b", "2027-01-08", "U1")],
    ["n", L("n", "2027-01-12", "U2")],
  ]);

  it("그대로면 지우기 → 되돌려 고치기 → 되살리기 → 표식 원래대로", () => {
    const p = planShiftUndo(token, now, { "2027-01-05|18:20": "skip" }, new Set());
    expect(p).toEqual({
      ok: true,
      deletes: ["n"],
      restores: [L("b", "2027-01-08", "U2")],
      reinserts: [L("a", "2027-01-05", "U1")],
      markers: [{ key: "2027-01-05|18:20", kind: null }],
    });
  });

  it("🔴 그 사이 고친 줄이 있으면 통째로 거절", () => {
    const edited = new Map(now);
    edited.set("b", L("b", "2027-01-08", "U1 복습"));
    expect(planShiftUndo(token, edited, { "2027-01-05|18:20": "skip" }, new Set())).toEqual({ ok: false, reason: "changed" });
  });

  it("🔴 새로 생긴 줄을 누가 지웠어도 거절", () => {
    const gone = new Map(now);
    gone.delete("n");
    expect(planShiftUndo(token, gone, { "2027-01-05|18:20": "skip" }, new Set())).toEqual({ ok: false, reason: "changed" });
  });

  it("🔴 표식이 그 사이 또 바뀌었으면(다시 눌렀으면) 거절", () => {
    expect(planShiftUndo(token, now, {}, new Set())).toEqual({ ok: false, reason: "changed" });
  });

  it("🔴 지워진 줄 자리에 다른 줄이 들어섰으면 거절", () => {
    const occupied = new Set([slotOf(L("x", "2027-01-05", "", 1))]);
    expect(planShiftUndo(token, now, { "2027-01-05|18:20": "skip" }, occupied)).toEqual({ ok: false, reason: "changed" });
  });
});
