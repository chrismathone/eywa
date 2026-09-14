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

  it("🔴 자리(JJ·랩실)뿐이면 막는다 — 입력이든 지우기든, 표식이 있든 없든(원장 2026-09-12)", () => {
    const share = shareBy({ jj: "seat", lab: "seat" });
    for (const clearing of [false, true]) {
      for (const ghostIntent of [false, true]) {
        expect(planScopedDay({ targets: [row("jj"), row("lab")], share, clearing, ghostIntent })).toEqual({
          kind: "reject",
          reason: "seatOnly",
        });
      }
    }
  });

  it("🔴 빗금 칸의 지우기는 막는다 — 남의 기록 삭제는 되돌리기 어렵다(기본값)", () => {
    const share = shareBy({ o1: "other", jj: "seat" });
    expect(planScopedDay({ targets: [row("o1"), row("jj")], share, clearing: true })).toEqual({
      kind: "reject",
      reason: "clearGhost",
    });
  });

  /**
   * 🔴 적대 리뷰 2026-09-14 — 서버 판정만 따르면 화면이 오래된 칸에서 사람이 본 것과 다른 기록을 조용히 쓴다.
   *    표식(화면이 빗금 칸으로 알았나)과 판정이 갈리면 저장하지 않는다.
   */
  it("🔴 판정과 화면 표식이 갈리면 stale — 빈칸으로 알던 칸에 남의 기록이 생김 · 빗금으로 알던 칸에 제 몫이 생김", () => {
    const ghost = shareBy({ o1: "other" });
    expect(planScopedDay({ targets: [row("o1")], share: ghost, clearing: false })).toEqual({
      kind: "reject",
      reason: "stale",
    });
    const own = shareBy({ a: "mine", o1: "other" });
    expect(planScopedDay({ targets: [row("a"), row("o1")], share: own, clearing: false, ghostIntent: true })).toEqual({
      kind: "reject",
      reason: "stale",
    });
    // 기록이 사라져 새 칸이 됐는데 빗금으로 알고 보냈다 — 새 행(제 몫)을 만들지 않는다.
    expect(planScopedDay({ targets: [], share: own, clearing: false, ghostIntent: true })).toEqual({
      kind: "reject",
      reason: "stale",
    });
  });
});

describe("거절 문장 — 격자가 누르기 전에 하는 말과 같다", () => {
  it("화면 사전(한국어) 그대로 — 서버 문장을 따로 짓지 않는다", () => {
    expect(SCOPED_REJECT_MESSAGE.seatOnly).toBe(sheetT("ko", "att.lock.seatOnly"));
    expect(SCOPED_REJECT_MESSAGE.clearGhost).toBe(sheetT("ko", "att.grid.ghostClearBlock"));
    expect(SCOPED_REJECT_MESSAGE.stale).toBe(sheetT("ko", "att.grid.ghostStale"));
  });
});
