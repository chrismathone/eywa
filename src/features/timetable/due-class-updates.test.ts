import { describe, expect, it } from "vitest";
import {
  SCHEDULED_CLASS_UPDATE_FLOOR,
  dueClassUpdates,
  shouldApplyClassroom,
  shouldApplyName,
  shouldApplyTeacher,
  type ClassUpdate,
  type SnapshotClassUpdates,
} from "./due-class-updates";

const TODAY = "2026-09-01";
const upd = (o: Partial<ClassUpdate> = {}): ClassUpdate => ({
  classId: "c1",
  teacherId: "new",
  classroomId: null,
  prevTeacherId: "old",
  prevClassroomId: null,
  ...o,
});
const snap = (o: Partial<SnapshotClassUpdates> = {}): SnapshotClassUpdates => ({
  snapshotId: "s1",
  effectiveDate: "2026-09-01",
  updates: [upd()],
  ...o,
});

describe("dueClassUpdates", () => {
  it("기한이 된 것만 — 미래는 아직", () => {
    const rows = [snap({ snapshotId: "now" }), snap({ snapshotId: "later", effectiveDate: "2026-10-01" })];
    expect(dueClassUpdates(rows, TODAY).map((r) => r.snapshotId)).toEqual(["now"]);
  });

  it("🔴 바닥 이전 스냅샷은 절대 재생하지 않는다 — 7월 담임이 되살아난다", () => {
    const old = snap({ snapshotId: "july", effectiveDate: "2026-07-09" });
    expect(dueClassUpdates([old], TODAY)).toEqual([]);
    expect(SCHEDULED_CLASS_UPDATE_FLOOR).toBe("2026-08-28");
  });

  it("바닥 당일도 제외(예약이 가능해진 다음 날부터)", () => {
    expect(dueClassUpdates([snap({ effectiveDate: SCHEDULED_CLASS_UPDATE_FLOOR })], TODAY)).toEqual([]);
  });

  it("바꿀 항목이 없으면 건너뛴다", () => {
    expect(dueClassUpdates([snap({ updates: [] })], TODAY)).toEqual([]);
  });

  it("이른 날짜부터 재생한다(여러 예약이 밀렸을 때 순서 보존)", () => {
    const rows = [
      snap({ snapshotId: "b", effectiveDate: "2026-09-01" }),
      snap({ snapshotId: "a", effectiveDate: "2026-08-31" }),
    ];
    expect(dueClassUpdates(rows, TODAY).map((r) => r.snapshotId)).toEqual(["a", "b"]);
  });
});

describe("shouldApplyTeacher — 사람이 손댄 담임을 덮지 않는다", () => {
  it("예약 시점 그대로면 적용", () => {
    expect(shouldApplyTeacher(upd(), "old")).toBe(true);
  });

  it("그 사이 사람이 바꿨으면 그대로 둔다", () => {
    expect(shouldApplyTeacher(upd(), "someone-else")).toBe(false);
  });

  it("이미 반영됐으면 다시 안 한다 — 두 번 돌아도 안전", () => {
    expect(shouldApplyTeacher(upd(), "new")).toBe(false);
  });

  it("변경 대상이 아닌 필드는 건드리지 않는다", () => {
    expect(shouldApplyTeacher(upd({ teacherId: null }), "old")).toBe(false);
    expect(shouldApplyClassroom(upd(), "anything")).toBe(false);
  });

  it("담임이 없던 반(null)도 예약 시점이 null이면 적용", () => {
    expect(shouldApplyTeacher(upd({ prevTeacherId: null }), null)).toBe(true);
    expect(shouldApplyTeacher(upd({ prevTeacherId: null }), "old")).toBe(false);
  });

  it("강의실은 필드 독립으로 판정", () => {
    const u = upd({ classroomId: "r2", prevClassroomId: "r1" });
    expect(shouldApplyClassroom(u, "r1")).toBe(true);
    expect(shouldApplyClassroom(u, "r9")).toBe(false);
  });
});

// 🔴 반 이름도 9/1에 예약되도록(원장 2026-08-28 *"반이름 변경도 9/1에 예약되도록 시스템화 하면 안되나?"*).
//    담임과 **같은 그릇**(classUpdates)에 얹었기 때문에, 예약 취소(배지 ×)로 이름 변경까지 함께 사라진다.
describe("shouldApplyName — 예약된 반 이름 변경", () => {
  const base = {
    classId: "c1",
    teacherId: null,
    classroomId: null,
    prevTeacherId: null,
    prevClassroomId: null,
  };

  it("현재 이름이 예약 시점 그대로면 바꾼다", () => {
    const u = { ...base, className: "LS4a", prevClassName: "LS3a" };
    expect(shouldApplyName(u, "LS3a")).toBe(true);
  });

  it("🔴 그 사이 사람이 이름을 바꿨으면 덮지 않는다", () => {
    const u = { ...base, className: "LS4a", prevClassName: "LS3a" };
    expect(shouldApplyName(u, "LS3a(임시)")).toBe(false);
    expect(shouldApplyName(u, "LS4a")).toBe(false); // 이미 반영됨 — 두 번 돌아도 안전
  });

  it("🔴 className이 없는 옛 스냅샷은 이름 변경 대상이 아니다", () => {
    expect(shouldApplyName(base, "LS3a")).toBe(false);
    expect(shouldApplyName({ ...base, className: null }, "LS3a")).toBe(false);
    expect(shouldApplyName({ ...base, className: "" }, "LS3a")).toBe(false);
  });

  it("prevClassName이 없으면 현재 이름이 없을 때만(빈 반) — 애매하면 안 바꾼다", () => {
    const u = { ...base, className: "LS4a" };
    expect(shouldApplyName(u, "LS3a")).toBe(false);
    expect(shouldApplyName(u, null)).toBe(true);
  });

  it("담임 규칙과 서로 독립 — 이름만 든 항목이 담임을 건드리지 않는다", () => {
    const u = { ...base, className: "LS4a", prevClassName: "LS3a" };
    expect(shouldApplyTeacher(u, null)).toBe(false);
    expect(shouldApplyClassroom(u, null)).toBe(false);
    expect(shouldApplyName(u, "LS3a")).toBe(true);
  });
});
