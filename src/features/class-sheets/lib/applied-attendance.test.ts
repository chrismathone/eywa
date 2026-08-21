import { describe, expect, it } from "vitest";
import {
  applyAppliedToBoardAtt,
  applyAppliedToSheetAtt,
  type BoardAttState,
  type SheetAttState,
} from "./applied-attendance";

const NONE: ReadonlySet<string> = new Set<string>();
const MINE = new Set(["c1"]);

describe("applyAppliedToBoardAtt — 오늘 요약 카드(반×하루 축)", () => {
  it("기록한 칸이 present로 반영된다", () => {
    const before: BoardAttState = { "c1|s1": { status: null, note: null } };
    const after = applyAppliedToBoardAtt(
      before,
      [{ studentId: "s1", classId: "c1" }],
      "present",
      MINE,
      NONE,
    );
    expect(after["c1|s1"]).toEqual({ status: "present", note: null });
  });

  it("로컬에 아직 없는 칸도 채운다 — 카드가 서버 초기값으로 폴백하기 때문", () => {
    const after = applyAppliedToBoardAtt(
      {},
      [{ studentId: "s1", classId: "c1" }],
      "present",
      MINE,
      NONE,
    );
    expect(after["c1|s1"]).toEqual({ status: "present", note: null });
  });

  it("다른 반은 무시한다 — 스트립은 그 날 내 전 교시를 다룬다", () => {
    const before: BoardAttState = {};
    expect(
      applyAppliedToBoardAtt(before, [{ studentId: "s1", classId: "남의반" }], "present", MINE, NONE),
    ).toBe(before);
  });

  it("🔴 in-flight 칸은 건너뛴다 — 방금 누른 결석이 되살아나지 않게", () => {
    const before: BoardAttState = { "c1|s1": { status: "absent", note: "병결" } };
    const after = applyAppliedToBoardAtt(
      before,
      [{ studentId: "s1", classId: "c1" }],
      "present",
      MINE,
      new Set(["c1|s1"]),
    );
    expect(after).toBe(before);
  });

  it("변화 없으면 같은 참조 + 메모는 보존", () => {
    const before: BoardAttState = { "c1|s1": { status: "present", note: "지각 사유" } };
    expect(
      applyAppliedToBoardAtt(before, [{ studentId: "s1", classId: "c1" }], "present", MINE, NONE),
    ).toBe(before);
    const changed = applyAppliedToBoardAtt(
      { "c1|s1": { status: "absent", note: "병결" } },
      [{ studentId: "s1", classId: "c1" }],
      "present",
      MINE,
      NONE,
    );
    expect(changed["c1|s1"]).toEqual({ status: "present", note: "병결" });
  });
});

const DATE = "2026-08-20";
const FIRST = { [DATE]: "15:00" };

describe("applyAppliedToSheetAtt — 주간 시트(교시 칸 축)", () => {
  it("교시가 있으면 그 교시 칸에 붙고, 값의 slot은 저장축 그대로", () => {
    const after = applyAppliedToSheetAtt(
      {},
      [{ studentId: "s1", classId: "c1" }],
      { date: DATE, status: "present", slot: "16:20", classId: "c1" },
      FIRST,
      NONE,
    );
    expect(after[`s1|${DATE}|16:20`]).toEqual({
      status: "present",
      note: null,
      units: null,
      slot: "16:20",
    });
  });

  it("🔑 slot=null이면 그 날 **첫 교시 칸**에 붙는다(서버 키 규칙과 같은 규약)", () => {
    const after = applyAppliedToSheetAtt(
      {},
      [{ studentId: "s1", classId: "c1" }],
      { date: DATE, status: "present", slot: null, classId: "c1" },
      FIRST,
      NONE,
    );
    expect(after[`s1|${DATE}|15:00`]).toEqual({
      status: "present",
      note: null,
      units: null,
      // 🔴 칸 키(첫 교시)가 아니라 **저장축(null)** 이 값에 남아야 제자리 갱신이 된다.
      slot: null,
    });
  });

  it("HH:MM:SS로 와도 칸 키는 HH:MM으로 정규화된다", () => {
    const after = applyAppliedToSheetAtt(
      {},
      [{ studentId: "s1", classId: "c1" }],
      { date: DATE, status: "present", slot: "16:20:00", classId: "c1" },
      FIRST,
      NONE,
    );
    expect(Object.keys(after)).toEqual([`s1|${DATE}|16:20`]);
    // 값의 저장축도 정규화 — 서버가 내려주는 모양과 같아야 제자리 갱신이 어긋나지 않는다.
    expect(after[`s1|${DATE}|16:20`]!.slot).toBe("16:20");
  });

  it("다른 반은 무시 · 그리지 않는 날짜(첫 교시 미상 + slot 없음)도 무시", () => {
    const before: SheetAttState = {};
    expect(
      applyAppliedToSheetAtt(
        before,
        [{ studentId: "s1", classId: "남의반" }],
        { date: DATE, status: "present", slot: "16:20", classId: "c1" },
        FIRST,
        NONE,
      ),
    ).toBe(before);
    expect(
      applyAppliedToSheetAtt(
        before,
        [{ studentId: "s1", classId: "c1" }],
        { date: "2026-08-21", status: "present", slot: null, classId: "c1" },
        FIRST,
        NONE,
      ),
    ).toBe(before);
  });

  it("🔴 이 시트가 그리지 않는 날짜는 교시가 있어도 무시 — 다른 주를 보고 있을 때 오늘 기록이 새면 안 된다", () => {
    const before: SheetAttState = {};
    expect(
      applyAppliedToSheetAtt(
        before,
        [{ studentId: "s1", classId: "c1" }],
        { date: "2026-08-21", status: "present", slot: "16:20", classId: "c1" },
        FIRST,
        NONE,
      ),
    ).toBe(before);
  });

  it("🔴 in-flight 칸은 건너뛴다", () => {
    const before: SheetAttState = {
      [`s1|${DATE}|16:20`]: { status: "absent", note: "병결", units: null, slot: "16:20" },
    };
    expect(
      applyAppliedToSheetAtt(
        before,
        [{ studentId: "s1", classId: "c1" }],
        { date: DATE, status: "present", slot: "16:20", classId: "c1" },
        FIRST,
        new Set([`s1|${DATE}|16:20`]),
      ),
    ).toBe(before);
  });

  it("변화 없으면 같은 참조 · 메모·시수는 불변", () => {
    const same: SheetAttState = {
      [`s1|${DATE}|16:20`]: { status: "present", note: "메모", units: 2, slot: "16:20" },
    };
    expect(
      applyAppliedToSheetAtt(
        same,
        [{ studentId: "s1", classId: "c1" }],
        { date: DATE, status: "present", slot: "16:20", classId: "c1" },
        FIRST,
        NONE,
      ),
    ).toBe(same);
    const changed = applyAppliedToSheetAtt(
      { [`s1|${DATE}|16:20`]: { status: "absent", note: "메모", units: 2, slot: "16:20" } },
      [{ studentId: "s1", classId: "c1" }],
      { date: DATE, status: "present", slot: "16:20", classId: "c1" },
      FIRST,
      NONE,
    );
    expect(changed[`s1|${DATE}|16:20`]).toEqual({
      status: "present",
      note: "메모",
      units: 2,
      slot: "16:20",
    });
  });
});
