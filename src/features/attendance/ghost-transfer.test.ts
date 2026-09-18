/**
 * 강사 보기 **빗금 칸 입력**(원장 2026-09-14 *"그냥 그 날의 해당 담당 출석으로 전부 이전시켜. 다른 사람이 대신 찍었어도."*)
 * — 저장 경로 판정. 메모 규칙은 `proxy-memo.test.ts`, 서버 행동은 `server/actions-scoped-split.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { sheetT } from "@/features/teacher-view/i18n";
import { planScopedDay, SCOPED_REJECT_MESSAGE } from "./ghost-transfer";
import type { DayTargetRow } from "./scoped-split";
import type { AttendanceSlotShare } from "./teacher-axis";

const row = (id: string): DayTargetRow => ({ id, slot_start: null });
const shareBy = (m: Record<string, AttendanceSlotShare>) => (r: DayTargetRow) => m[r.id]!;

describe("planScopedDay — 강사 보기 그날 칸의 저장 경로", () => {
  it("반별 보기(share 없음)는 표식이 와도 종전 경로 · 새 칸(행 없음)도 종전 경로", () => {
    for (const ghostIntent of [false, true]) {
      expect(planScopedDay({ targets: [row("a")], share: null, clearing: false, ghostIntent })).toEqual({ kind: "own" });
    }
    expect(planScopedDay({ targets: [], share: shareBy({}), clearing: false })).toEqual({ kind: "own" });
  });

  it("제 몫 행이 하나라도 있으면 종전 경로 — 남의 교시·자리가 섞여도(시수 배분은 planDayCellUnits가 한다)", () => {
    const share = shareBy({ a: "mine", b: "other", c: "seat" });
    for (const clearing of [false, true]) {
      expect(planScopedDay({ targets: [row("b"), row("a"), row("c")], share, clearing })).toEqual({ kind: "own" });
    }
  });

  it("🔴 제 몫 0 + 다른 선생님 교시 + 화면 표식 → 그 행들에만(자리 행은 빠진다) · 받은 순서 그대로", () => {
    const share = shareBy({ jj: "seat", o1: "other", o2: "other" });
    expect(
      planScopedDay({ targets: [row("o2"), row("jj"), row("o1")], share, clearing: false, ghostIntent: true }),
    ).toEqual({ kind: "transfer", rows: [row("o2"), row("o1")] });
  });

  it("🔴 표식이 온 옛 옮기기 경로 — 자리(JJ·랩실)뿐이면 막는다(원장 2026-09-12)", () => {
    const share = shareBy({ jj: "seat", lab: "seat" });
    expect(planScopedDay({ targets: [row("jj"), row("lab")], share, clearing: false, ghostIntent: true })).toEqual({
      kind: "reject",
      reason: "seatOnly",
    });
  });

  /**
   * 🔴 원장 2026-09-17 *"내 출석부에서 고치는건데 남의 출석부를 건드리는건 아니지. 그냥 내 출석부 상에서 자유롭게 숫자 설정만
   *    하는거야."* — 제 몫 행이 없는 칸은 강사 보기에서 빈칸이다. 입력은 제 교시 행을 새로 만들고, 지우기는 할 일이 없다.
   */
  it("🔴 제 몫 0 · 표식 없는 입력 → create(남의 교시·자리 행은 그대로 두고 제 행을 만든다)", () => {
    for (const m of [{ o1: "other", jj: "seat" }, { jj: "seat" }, { o1: "other" }] as Record<string, AttendanceSlotShare>[]) {
      expect(planScopedDay({ targets: Object.keys(m).map(row), share: shareBy(m), clearing: false })).toEqual({
        kind: "create",
      });
    }
  });

  it("🔴 제 몫 0 · 지우기 → skip(지울 제 기록이 없다 — 남의 기록을 지우지도, 거절하지도 않는다)", () => {
    for (const m of [{ o1: "other", jj: "seat" }, { jj: "seat" }] as Record<string, AttendanceSlotShare>[]) {
      for (const ghostIntent of [false, true]) {
        expect(
          planScopedDay({ targets: Object.keys(m).map(row), share: shareBy(m), clearing: true, ghostIntent }),
        ).toEqual({ kind: "skip" });
      }
    }
  });

  it("🔴 빗금으로 알고 보냈는데 제 몫 행이 생겼거나 기록이 사라졌으면 stale — 제 기록을 덮지 않는다", () => {
    const own = shareBy({ a: "mine", o1: "other" });
    expect(planScopedDay({ targets: [row("a"), row("o1")], share: own, clearing: false, ghostIntent: true })).toEqual({
      kind: "reject",
      reason: "stale",
    });
    expect(planScopedDay({ targets: [], share: own, clearing: false, ghostIntent: true })).toEqual({
      kind: "reject",
      reason: "stale",
    });
  });
});

describe("거절 문장 — 격자가 누르기 전에 하는 말과 같다", () => {
  it("화면 사전(한국어) 그대로 — 서버 문장을 따로 짓지 않는다", () => {
    expect(SCOPED_REJECT_MESSAGE.seatOnly).toBe(sheetT("ko", "att.lock.seatOnly"));
    expect(SCOPED_REJECT_MESSAGE.stale).toBe(sheetT("ko", "att.grid.ghostStale"));
  });
});
