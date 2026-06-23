import { describe, it, expect } from "vitest";
import {
  autoAssignClassrooms,
  detectRoomConflicts,
  assignSummary,
  type AssignClass,
  type AssignRoom,
} from "./classroom-assign";

const room = (id: string, name: string, capacity: number | null = 20): AssignRoom => ({
  id,
  name,
  capacity,
});

const cls = (
  id: string,
  slots: { day: string; start: string; end: string }[],
  opts: { students?: number; room?: string | null; name?: string } = {},
): AssignClass => ({
  id,
  className: opts.name ?? `반${id}`,
  subject: "math",
  studentCount: opts.students ?? 10,
  currentRoomId: opts.room ?? null,
  slots,
});

describe("autoAssignClassrooms", () => {
  it("빈 입력은 빈 결과", () => {
    const r = autoAssignClassrooms([], []);
    expect(r.assignments).toEqual([]);
    expect(r.unassigned).toEqual([]);
    expect(r.conflictsBefore).toEqual([]);
  });

  it("단일 반은 가용 강의실에 배정(미배정→changed)", () => {
    const r = autoAssignClassrooms(
      [cls("c1", [{ day: "mon", start: "16:00", end: "17:30" }])],
      [room("r1", "301호")],
    );
    expect(r.assignments).toHaveLength(1);
    expect(r.assignments[0].toRoomId).toBe("r1");
    expect(r.assignments[0].changed).toBe(true);
  });

  it("동시간 두 반은 서로 다른 강의실로(충돌 회피)", () => {
    const r = autoAssignClassrooms(
      [
        cls("c1", [{ day: "mon", start: "16:00", end: "17:30" }]),
        cls("c2", [{ day: "mon", start: "16:30", end: "18:00" }]),
      ],
      [room("r1", "301호"), room("r2", "302호")],
    );
    expect(r.unassigned).toHaveLength(0);
    const rooms = r.assignments.map((a) => a.toRoomId);
    expect(new Set(rooms).size).toBe(2); // 두 반이 다른 방
  });

  it("강의실이 부족하면 한 반은 미배정(동시간대 사유)", () => {
    const r = autoAssignClassrooms(
      [
        cls("c1", [{ day: "mon", start: "16:00", end: "17:30" }]),
        cls("c2", [{ day: "mon", start: "16:30", end: "18:00" }]),
      ],
      [room("r1", "301호")],
    );
    expect(r.assignments).toHaveLength(1);
    expect(r.unassigned).toHaveLength(1);
    expect(r.unassigned[0].reason).toContain("동시간대");
  });

  it("시간이 안 겹치면 한 강의실을 두 반이 공유", () => {
    const r = autoAssignClassrooms(
      [
        cls("c1", [{ day: "mon", start: "16:00", end: "17:30" }]),
        cls("c2", [{ day: "tue", start: "16:00", end: "17:30" }]),
      ],
      [room("r1", "301호")],
    );
    expect(r.unassigned).toHaveLength(0);
    expect(new Set(r.assignments.map((a) => a.toRoomId))).toEqual(new Set(["r1"]));
  });

  it("respectCapacity면 정원 초과 강의실은 제외", () => {
    const r = autoAssignClassrooms(
      [cls("c1", [{ day: "mon", start: "16:00", end: "17:30" }], { students: 30 })],
      [room("r1", "작은방", 16), room("r2", "큰방", 40)],
      { respectCapacity: true, keepExisting: true },
    );
    expect(r.assignments[0].toRoomId).toBe("r2");
  });

  it("정원 가능한 강의실이 없으면 수용 사유로 미배정", () => {
    const r = autoAssignClassrooms(
      [cls("c1", [{ day: "mon", start: "16:00", end: "17:30" }], { students: 30 })],
      [room("r1", "작은방", 16)],
      { respectCapacity: true, keepExisting: true },
    );
    expect(r.assignments).toHaveLength(0);
    expect(r.unassigned[0].reason).toContain("수용 인원");
  });

  it("keepExisting면 충돌 없는 기존 배정을 유지(changed=false)", () => {
    const r = autoAssignClassrooms(
      [cls("c1", [{ day: "mon", start: "16:00", end: "17:30" }], { room: "r2" })],
      [room("r1", "301호"), room("r2", "302호")],
      { respectCapacity: true, keepExisting: true },
    );
    expect(r.assignments[0].toRoomId).toBe("r2");
    expect(r.assignments[0].changed).toBe(false);
  });
});

describe("detectRoomConflicts", () => {
  it("같은 강의실 동시간 두 반을 충돌로 감지", () => {
    const conflicts = detectRoomConflicts(
      [
        cls("c1", [{ day: "wed", start: "16:00", end: "17:30" }], { room: "r1", name: "수학A" }),
        cls("c2", [{ day: "wed", start: "16:30", end: "18:00" }], { room: "r1", name: "수학B" }),
      ],
      [room("r1", "301호")],
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].roomName).toBe("301호");
    expect(conflicts[0].classNames).toEqual(["수학A", "수학B"]);
    expect(conflicts[0].day).toBe("수");
  });

  it("다른 강의실이면 충돌 아님", () => {
    const conflicts = detectRoomConflicts(
      [
        cls("c1", [{ day: "wed", start: "16:00", end: "17:30" }], { room: "r1" }),
        cls("c2", [{ day: "wed", start: "16:30", end: "18:00" }], { room: "r2" }),
      ],
      [room("r1", "301호"), room("r2", "302호")],
    );
    expect(conflicts).toHaveLength(0);
  });
});

describe("assignSummary", () => {
  it("변경·미배정·충돌 건수 집계", () => {
    const result = autoAssignClassrooms(
      [
        cls("c1", [{ day: "mon", start: "16:00", end: "17:30" }]),
        cls("c2", [{ day: "mon", start: "16:30", end: "18:00" }]),
      ],
      [room("r1", "301호")],
    );
    const s = assignSummary(result);
    expect(s.total).toBe(1);
    expect(s.changed).toBe(1);
    expect(s.unassigned).toBe(1);
  });
});
