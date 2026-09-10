import { describe, expect, it } from "vitest";
import {
  applySeatPlacements,
  isSeatDragGesture,
  mergeSeatPlacements,
  seatHomeClassOf,
  seatMoveBlockReason,
  seatResetCounts,
  seatResetTargets,
  SEAT_DRAG_THRESHOLD_PX,
  SEAT_MOVE_MARKED_ERROR,
  validateSeatMove,
  type SeatPlacement,
} from "./placement";

type S = { id: string; name: string };
const roster = (classId: string, ...ids: string[]) => ({
  classId,
  className: classId,
  students: ids.map((id) => ({ id, name: id })) as S[],
});

/** JP1 · LT6 두 묶음이 같은 교시에 서는 랩실 한 장. */
const RS = [roster("JP1", "a", "b"), roster("LT6", "c", "d", "e")];

describe("문턱 — 덜 움직이면 클릭(출결), 넘으면 드래그", () => {
  it("제자리·잔떨림은 클릭이다", () => {
    expect(isSeatDragGesture(0, 0)).toBe(false);
    expect(isSeatDragGesture(3, 3)).toBe(false); // 4.24px
    // 정확히 문턱은 클릭 — dnd-kit `distance`도 '초과'에서만 활성화한다(둘이 갈리면 이중 액션).
    expect(isSeatDragGesture(SEAT_DRAG_THRESHOLD_PX, 0)).toBe(false);
  });
  it("문턱을 넘으면 드래그다 — 대각선도 유클리드로 센다", () => {
    expect(isSeatDragGesture(6, 0)).toBe(true);
    expect(isSeatDragGesture(-6, 0)).toBe(true);
    expect(isSeatDragGesture(4, 4)).toBe(true); // 5.66px — 축별 비교였다면 놓쳤을 자리
  });
});

describe("원래 반(homeClass)", () => {
  it("명단에 있으면 그 반, 없으면 null", () => {
    expect(seatHomeClassOf(RS, "a")).toBe("JP1");
    expect(seatHomeClassOf(RS, "e")).toBe("LT6");
    expect(seatHomeClassOf(RS, "zzz")).toBeNull();
  });
  it("같은 교시에 두 반으로 잡혀 있으면 모른다(null)", () => {
    const dup = [roster("JP1", "a"), roster("LT6", "a")];
    expect(seatHomeClassOf(dup, "a")).toBeNull();
  });
});

describe("배치 얹기", () => {
  const moveC: SeatPlacement = { studentId: "c", fromClassId: "LT6", toClassId: "JP1" };

  it("옮긴 학생은 대상 묶음 끝에 서고 원래 반을 기억한다", () => {
    const { rosters, applied, stale } = applySeatPlacements(RS, [moveC]);
    expect(applied).toEqual([moveC]);
    expect(stale).toEqual([]);
    expect(rosters[0]!.students.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(rosters[1]!.students.map((s) => s.id)).toEqual(["d", "e"]);
    const guest = rosters[0]!.students.at(-1)!;
    // 🔴 출결은 원래 반으로 — 놓인 묶음(JP1)이 아니다.
    expect(guest.homeClassId).toBe("LT6");
    expect(guest.movedFromClassId).toBe("LT6");
    expect(rosters[0]!.students[0]!.homeClassId).toBe("JP1");
    expect(rosters[0]!.students[0]!.movedFromClassId).toBeNull();
  });

  it("명단 밖 학생·없는 반·같은 반은 반영하지 않는다(stale)", () => {
    const bad: SeatPlacement[] = [
      { studentId: "zzz", fromClassId: "LT6", toClassId: "JP1" }, // 명단 밖
      { studentId: "c", fromClassId: "LT6", toClassId: "NOPE" }, // 이 교시에 없는 반
      { studentId: "c", fromClassId: "LT6", toClassId: "LT6" }, // 같은 반
      { studentId: "c", fromClassId: "JP1", toClassId: "JP1" }, // 원래 반이 안 맞음
    ];
    const { applied, stale, rosters } = applySeatPlacements(RS, bad);
    expect(applied).toEqual([]);
    expect(stale).toHaveLength(4);
    expect(rosters.map((r) => r.students.map((s) => s.id))).toEqual([
      ["a", "b"],
      ["c", "d", "e"],
    ]);
  });

  it("반 이름 등 묶음의 다른 값은 그대로 지나간다", () => {
    const { rosters } = applySeatPlacements(RS, [moveC]);
    expect(rosters.map((r) => r.className)).toEqual(["JP1", "LT6"]);
  });

  it("배치가 없으면 명단이 그대로다(JJ실·평소 화면)", () => {
    const { rosters, applied } = applySeatPlacements(RS, []);
    expect(applied).toEqual([]);
    expect(rosters.map((r) => r.students.map((s) => s.id))).toEqual([
      ["a", "b"],
      ["c", "d", "e"],
    ]);
    expect(rosters.every((r) => r.students.every((s) => s.homeClassId === r.classId))).toBe(true);
  });
});

describe("초기화 대상 — 반별과 전체가 같은 목록을 본다", () => {
  const applied: SeatPlacement[] = [
    { studentId: "c", fromClassId: "LT6", toClassId: "JP1" },
    { studentId: "d", fromClassId: "LT6", toClassId: "JP1" },
    { studentId: "a", fromClassId: "JP1", toClassId: "LT6" },
  ];

  it("반별은 그 묶음으로 옮겨 온 학생만", () => {
    expect(seatResetTargets(applied, "JP1").map((p) => p.studentId)).toEqual(["c", "d"]);
    expect(seatResetTargets(applied, "LT6").map((p) => p.studentId)).toEqual(["a"]);
  });

  it("전체는 그 교시 전부이고, **반별 건수의 합 = 전체 건수**", () => {
    const counts = seatResetCounts(applied);
    expect(counts).toEqual({ JP1: 2, LT6: 1 });
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(seatResetTargets(applied).length);
    expect(sum).toBe(applied.length);
  });

  it("되돌릴 것이 없으면 건수가 0 — 버튼을 세울 근거가 없다", () => {
    expect(seatResetTargets([])).toEqual([]);
    expect(seatResetCounts([])).toEqual({});
  });

  it("반영 안 된 줄(stale)은 초기화 대상이 아니다 — 버튼 수와 서버가 지우는 수가 갈리지 않게", () => {
    const { applied: only } = applySeatPlacements(RS, [
      { studentId: "c", fromClassId: "LT6", toClassId: "JP1" },
      { studentId: "zzz", fromClassId: "LT6", toClassId: "JP1" },
    ]);
    expect(seatResetTargets(only)).toHaveLength(1);
  });
});

describe("드래그 한 번의 판정", () => {
  it("명단 밖 학생은 거절 — 이유를 말한다", () => {
    expect(validateSeatMove(RS, { studentId: "zzz", toClassId: "JP1" })).toEqual({
      error: "이 교시 명단에 없는 학생입니다",
    });
  });
  it("이 교시에 없는 반으로는 못 옮긴다", () => {
    expect(validateSeatMove(RS, { studentId: "c", toClassId: "NOPE" })).toEqual({
      error: "이 교시에 없는 반입니다",
    });
  });
  it("정상 이동은 원래 반을 서버가 스스로 정한다(화면이 보낸 값을 안 믿는다)", () => {
    expect(validateSeatMove(RS, { studentId: "c", toClassId: "JP1" })).toEqual({
      ok: true,
      fromClassId: "LT6",
      isReset: false,
    });
  });
  it("제 반으로 도로 끌면 그 학생만 초기화다", () => {
    expect(validateSeatMove(RS, { studentId: "c", toClassId: "LT6" })).toEqual({
      ok: true,
      fromClassId: "LT6",
      isReset: true,
    });
  });
});

describe("서버 줄 + 낙관 오버레이 합치기", () => {
  const server: SeatPlacement[] = [{ studentId: "c", fromClassId: "LT6", toClassId: "JP1" }];

  it("오버레이가 없으면 서버 줄 그대로", () => {
    expect(mergeSeatPlacements(RS, server, {})).toEqual(server);
  });
  it("null 오버레이 = 초기화(그 줄이 사라진다)", () => {
    expect(mergeSeatPlacements(RS, server, { c: null })).toEqual([]);
  });
  it("새 이동은 원래 반을 명단에서 다시 읽는다", () => {
    expect(mergeSeatPlacements(RS, [], { a: "LT6" })).toEqual([
      { studentId: "a", fromClassId: "JP1", toClassId: "LT6" },
    ]);
  });
  it("같은 학생을 다시 옮기면 서버 줄이 아니라 오버레이가 이긴다(한 학생 한 줄)", () => {
    const merged = mergeSeatPlacements(RS, server, { c: "LT6" });
    expect(merged).toEqual([]); // 제 반 = 배치 없음
    const { applied } = applySeatPlacements(RS, mergeSeatPlacements(RS, server, { c: "JP1" }));
    expect(applied).toHaveLength(1);
  });
});

describe("출결이 찍힌 학생은 드래그 절대 불가 (원장 2026-09-10)", () => {
  const MARKED = [
    { classId: "JP1", students: [{ id: "a", status: "present" }, { id: "b", status: null }] },
    { classId: "LT6", students: [{ id: "c", status: null }] },
  ];

  it("상태가 있으면 이유를 돌려주고, 없으면 null이다", () => {
    expect(seatMoveBlockReason("present")).toBe(SEAT_MOVE_MARKED_ERROR);
    expect(seatMoveBlockReason("absent")).toBe(SEAT_MOVE_MARKED_ERROR);
    expect(seatMoveBlockReason("late")).toBe(SEAT_MOVE_MARKED_ERROR);
    expect(seatMoveBlockReason(null)).toBeNull();
    expect(seatMoveBlockReason(undefined)).toBeNull();
  });

  it("서버 판정도 막는다 — 화면이 잠갔더라도 다시 본다([[#77]])", () => {
    expect(validateSeatMove(MARKED, { studentId: "a", toClassId: "LT6" })).toEqual({
      error: SEAT_MOVE_MARKED_ERROR,
    });
  });

  it("제 반으로 도로 끄는 것(그 학생만 초기화)도 막는다 — 지시가 \x22절대 불가\x22다", () => {
    expect(validateSeatMove(MARKED, { studentId: "a", toClassId: "JP1" })).toEqual({
      error: SEAT_MOVE_MARKED_ERROR,
    });
  });

  it("미체크 학생은 그대로 옮겨진다", () => {
    expect(validateSeatMove(MARKED, { studentId: "b", toClassId: "LT6" })).toEqual({
      ok: true,
      fromClassId: "JP1",
      isReset: false,
    });
  });

  it("명단 밖 판정이 먼저다 — 상태를 볼 학생 자체가 없다", () => {
    expect(validateSeatMove(MARKED, { studentId: "zzz", toClassId: "LT6" })).toEqual({
      error: "이 교시 명단에 없는 학생입니다",
    });
  });
});
