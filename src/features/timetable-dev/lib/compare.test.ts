/**
 * 월별 계획 비교의 경계를 못박는다.
 *
 * 여기서 잠그는 것은 "예쁜 diff"가 아니라 **거짓 결과 세 가지**다:
 *   ① 시각 형식('09:00' vs '09:00:00')이 갈려 안 바뀐 달이 통째로 빨개지는 것
 *   ② `id`·`planMonth` 같은 달마다 다른 필드를 비교에 넣어 모든 행이 '변경'이 되는 것
 *   ③ 시작시각만 같고 끝시각이 다른 **다른 교시**([[#106]])를 같은 칸으로 묶어 '변경'으로 세는 것
 */
import { describe, expect, it } from "vitest";
import type { PlanSlot } from "@/features/timetable-dev/types";
import {
  PLAN_COMPARED_FIELDS,
  comparePlans,
  describePlanChange,
  formatPlanFieldValue,
} from "./compare";

function slot(over: Partial<PlanSlot> = {}): PlanSlot {
  return {
    id: "slot-1",
    planMonth: "2026-09",
    classId: "class-a",
    dayOfWeek: "mon",
    startTime: "09:00",
    endTime: "10:00",
    teacherId: null,
    classroomId: null,
    slotTeacherLabel: null,
    slotRoomLabel: null,
    periodLabel: null,
    mergeGroup: null,
    sourceScheduleId: null,
    ...over,
  };
}

describe("comparePlans — 기본", () => {
  it("둘 다 비면 행도 집계도 0", () => {
    const d = comparePlans([], []);
    expect(d.rows).toEqual([]);
    expect([d.addedCount, d.removedCount, d.changedCount, d.sameCount]).toEqual([0, 0, 0, 0]);
  });

  it("after에만 있으면 추가, before에만 있으면 삭제", () => {
    const a = comparePlans([], [slot({ id: "x" })]);
    expect(a.addedCount).toBe(1);
    expect(a.rows[0].kind).toBe("added");
    expect(a.rows[0].after?.id).toBe("x");
    expect(a.rows[0].before).toBeUndefined();
    expect(a.rows[0].changes).toEqual([]);

    const r = comparePlans([slot({ id: "x" })], []);
    expect(r.removedCount).toBe(1);
    expect(r.rows[0].kind).toBe("removed");
    expect(r.rows[0].before?.id).toBe("x");
    expect(r.rows[0].after).toBeUndefined();
  });

  it("방향이 뜻을 가진다 — 두 달을 맞바꾸면 추가/삭제가 뒤집힌다", () => {
    const one = [slot()];
    expect(comparePlans([], one).addedCount).toBe(1);
    expect(comparePlans(one, []).removedCount).toBe(1);
  });
});

describe("comparePlans — 거짓 '변경' 방지", () => {
  it("① 시각 형식만 다르면 동일(DB 'HH:MM:SS' ↔ 폼 'HH:MM')", () => {
    const before = [slot({ startTime: "09:00:00", endTime: "10:00:00" })];
    const after = [slot({ startTime: "09:00", endTime: "10:00" })];
    const d = comparePlans(before, after);
    expect(d.sameCount).toBe(1);
    expect(d.changedCount).toBe(0);
    expect(d.addedCount + d.removedCount).toBe(0);
    // 앵커도 정규화된 값으로 나온다(정렬·표시가 형식에 흔들리지 않게).
    expect(d.rows[0].startTime).toBe("09:00");
  });

  it("한 자리 시(9:00)도 09:00과 같은 칸", () => {
    const d = comparePlans([slot({ startTime: "9:00" })], [slot({ startTime: "09:00:00" })]);
    expect(d.sameCount).toBe(1);
    expect(d.rows[0].startTime).toBe("09:00");
  });

  it("② id·planMonth·sourceScheduleId는 비교하지 않는다 — 달마다 다르니까", () => {
    const before = [slot({ id: "sep-1", planMonth: "2026-09", sourceScheduleId: "sch-1" })];
    const after = [slot({ id: "oct-1", planMonth: "2026-10", sourceScheduleId: null })];
    const d = comparePlans(before, after);
    expect(d.sameCount).toBe(1);
    expect(d.changedCount).toBe(0);
    expect(PLAN_COMPARED_FIELDS).not.toContain("id");
    expect(PLAN_COMPARED_FIELDS).not.toContain("planMonth");
    expect(PLAN_COMPARED_FIELDS).not.toContain("sourceScheduleId");
  });

  it("빈 문자열과 null은 같은 '없음'", () => {
    const before = [slot({ slotTeacherLabel: "", slotRoomLabel: "  ", periodLabel: "" })];
    const after = [slot({ slotTeacherLabel: null, slotRoomLabel: null, periodLabel: null })];
    expect(comparePlans(before, after).sameCount).toBe(1);
  });
});

describe("comparePlans — 변경 감지", () => {
  it("필드 하나만 다르면 그 하나만 changes에 담긴다", () => {
    const d = comparePlans(
      [slot({ teacherId: "t-old" })],
      [slot({ teacherId: "t-new" })],
    );
    expect(d.changedCount).toBe(1);
    expect(d.rows[0].kind).toBe("changed");
    expect(d.rows[0].changes).toEqual([{ field: "teacherId", before: "t-old", after: "t-new" }]);
    expect(d.rows[0].before?.teacherId).toBe("t-old");
    expect(d.rows[0].after?.teacherId).toBe("t-new");
  });

  it("비교 대상 7필드가 모두 감지된다", () => {
    const before = slot();
    const after = slot({
      endTime: "11:00",
      teacherId: "t",
      classroomId: "r",
      slotTeacherLabel: "김강사",
      slotRoomLabel: "A실",
      periodLabel: "1교시",
      mergeGroup: "m-1",
    });
    const d = comparePlans([before], [after]);
    expect(d.rows[0].changes.map((c) => c.field).sort()).toEqual([...PLAN_COMPARED_FIELDS].sort());
  });

  it("끝시각만 바뀌면 변경(추가/삭제 아님)", () => {
    const d = comparePlans([slot({ endTime: "10:00" })], [slot({ endTime: "10:40" })]);
    expect(d.changedCount).toBe(1);
    expect(d.rows[0].changes).toEqual([{ field: "endTime", before: "10:00", after: "10:40" }]);
  });
});

describe("comparePlans — 앵커(#106: 시작시각이 같은 교시가 둘)", () => {
  it("같은 반·같은 요일이라도 시작시각이 다르면 서로 다른 칸(변경 아님)", () => {
    // EiE 4교시 16:20~17:00 이 사라지고 IJW 1교시 16:20~17:20 이 생긴 것처럼 보이는 상황이 아니라,
    // '시작시각이 아예 다른' 칸 — 한쪽에만 있으면 추가/삭제여야 한다.
    const before = [slot({ startTime: "16:20", endTime: "17:00" })];
    const after = [slot({ startTime: "17:20", endTime: "18:00" })];
    const d = comparePlans(before, after);
    expect(d.addedCount).toBe(1);
    expect(d.removedCount).toBe(1);
    expect(d.changedCount).toBe(0);
    expect(d.rows.map((r) => r.startTime)).toEqual(["16:20", "17:20"]);
  });

  it("다른 반이 같은 (요일,시작)에 서도 섞이지 않는다", () => {
    const eie = slot({ classId: "eie", startTime: "16:20", endTime: "17:00" });
    const ijw = slot({ classId: "ijw", startTime: "16:20", endTime: "17:20" });
    const d = comparePlans([eie, ijw], [eie, ijw]);
    expect(d.sameCount).toBe(2);
    expect(d.changedCount).toBe(0);
  });

  it("한쪽에만 있는 시각은 '끝시각 변경'으로 묶이지 않는다", () => {
    // 같은 반의 16:20 칸이 before에만, 17:20 칸이 after에만 있을 때 끝시각이 우연히 같아도
    // 두 칸을 하나로 합치면 EiE 교시가 IJW 교시로 둔갑한다.
    const before = [slot({ startTime: "16:20", endTime: "17:20" })];
    const after = [slot({ startTime: "17:20", endTime: "17:20" })];
    const d = comparePlans(before, after);
    expect(d.rows.map((r) => r.kind).sort()).toEqual(["added", "removed"]);
  });
});

describe("comparePlans — 여러 요일·정렬·집계", () => {
  it("같은 반 여러 요일이 각각 독립으로 판정된다", () => {
    const before = [
      slot({ id: "b-mon", dayOfWeek: "mon", teacherId: "t1" }),
      slot({ id: "b-wed", dayOfWeek: "wed", teacherId: "t1" }),
      slot({ id: "b-fri", dayOfWeek: "fri", teacherId: "t1" }),
    ];
    const after = [
      slot({ id: "a-mon", dayOfWeek: "mon", teacherId: "t1" }), // 동일
      slot({ id: "a-wed", dayOfWeek: "wed", teacherId: "t2" }), // 변경
      slot({ id: "a-sat", dayOfWeek: "sat", teacherId: "t1" }), // 추가(fri는 삭제)
    ];
    const d = comparePlans(before, after);
    expect({
      added: d.addedCount,
      removed: d.removedCount,
      changed: d.changedCount,
      same: d.sameCount,
    }).toEqual({ added: 1, removed: 1, changed: 1, same: 1 });
    expect(d.rows.map((r) => `${r.dayOfWeek}:${r.kind}`)).toEqual([
      "mon:same",
      "wed:changed",
      "fri:removed",
      "sat:added",
    ]);
  });

  it("요일 → 시작시각 → 반 순으로 정렬된다", () => {
    const rows = comparePlans(
      [
        slot({ classId: "b", dayOfWeek: "tue", startTime: "10:00" }),
        slot({ classId: "a", dayOfWeek: "tue", startTime: "10:00" }),
        slot({ classId: "z", dayOfWeek: "tue", startTime: "09:00" }),
        slot({ classId: "c", dayOfWeek: "mon", startTime: "23:00" }),
      ],
      [],
    ).rows;
    expect(rows.map((r) => `${r.dayOfWeek}/${r.startTime}/${r.classId}`)).toEqual([
      "mon/23:00/c",
      "tue/09:00/z",
      "tue/10:00/a",
      "tue/10:00/b",
    ]);
  });

  it("집계 합 = 행 수", () => {
    const d = comparePlans(
      [slot({ dayOfWeek: "mon" }), slot({ dayOfWeek: "tue", teacherId: "t1" })],
      [slot({ dayOfWeek: "tue", teacherId: "t2" }), slot({ dayOfWeek: "wed" })],
    );
    expect(d.addedCount + d.removedCount + d.changedCount + d.sameCount).toBe(d.rows.length);
  });

  it("중복 앵커는 먼저 온 행이 대표(#106 규약 — 뒤엣것이 앞을 덮지 않는다)", () => {
    const d = comparePlans([slot({ id: "first" }), slot({ id: "second" })], []);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0].before?.id).toBe("first");
  });
});

describe("표기 — raw id를 화면에 내보내지 않는다", () => {
  const resolve = (kind: "teacher" | "classroom", id: string) =>
    kind === "teacher"
      ? ({ t1: "김철수", t2: "이영희" } as Record<string, string>)[id] ?? null
      : ({ r1: "301호" } as Record<string, string>)[id] ?? null;

  it("강사 변경을 이름으로 푼다", () => {
    const [change] = comparePlans([slot({ teacherId: "t1" })], [slot({ teacherId: "t2" })]).rows[0]
      .changes;
    expect(describePlanChange(change, resolve)).toEqual({ label: "강사", text: "김철수 → 이영희" });
  });

  it("모르는 id는 uuid가 아니라 '이름 미상'", () => {
    expect(formatPlanFieldValue("teacherId", "ghost", resolve)).toBe("이름 미상");
    expect(formatPlanFieldValue("classroomId", "r1", resolve)).toBe("301호");
    expect(formatPlanFieldValue("classroomId", null, resolve)).toBe("없음");
  });

  it("배정 해제는 '없음'으로", () => {
    const [change] = comparePlans([slot({ teacherId: "t1" })], [slot({ teacherId: null })]).rows[0]
      .changes;
    expect(describePlanChange(change, resolve).text).toBe("김철수 → 없음");
  });

  it("합반은 uuid 대신 무슨 일이 있었는지로", () => {
    const link = comparePlans([slot()], [slot({ mergeGroup: "m1" })]).rows[0].changes[0];
    const unlink = comparePlans([slot({ mergeGroup: "m1" })], [slot()]).rows[0].changes[0];
    const moved = comparePlans([slot({ mergeGroup: "m1" })], [slot({ mergeGroup: "m2" })]).rows[0]
      .changes[0];
    expect(describePlanChange(link).text).toBe("합반으로 묶임");
    expect(describePlanChange(unlink).text).toBe("합반 해제");
    expect(describePlanChange(moved).text).toBe("다른 합반으로 이동");
    for (const c of [link, unlink, moved]) {
      expect(describePlanChange(c).text).not.toContain("m1");
      expect(describePlanChange(c).text).not.toContain("m2");
    }
  });

  it("교시·표기 라벨은 값 그대로(사람이 쓴 글자다)", () => {
    const [change] = comparePlans(
      [slot({ periodLabel: "1교시" })],
      [slot({ periodLabel: "2교시" })],
    ).rows[0].changes;
    expect(describePlanChange(change)).toEqual({ label: "교시", text: "1교시 → 2교시" });
  });
});
