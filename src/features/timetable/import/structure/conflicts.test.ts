import { describe, expect, it } from "vitest";
import {
  blocksApply,
  conflictChecklist,
  conflictKeys,
  describeConflict,
  detectScheduleConflicts,
} from "./conflicts";
import type { SchedulePlanItem, TargetSchedule } from "./types";
import type { DayOfWeek } from "@/features/timetable/lib/periods";

function slot(over: Partial<TargetSchedule> & { className: string }): TargetSchedule {
  return {
    classId: over.classId ?? `id-${over.className}`,
    className: over.className,
    day: (over.day ?? "tue") as DayOfWeek,
    startTime: over.startTime ?? "16:20",
    endTime: over.endTime === undefined ? "17:20" : over.endTime,
    // ⚠️ `?? "604"`로 쓰면 `room: null` 지정이 기본값으로 되살아나 "방 미상" 갈래를 못 재현한다.
    room: "room" in over ? (over.room ?? null) : "604",
    classroomId: over.classroomId ?? null,
    teachers: over.teachers ?? [{ name: "Sam", teacherId: "t1" }],
    starred: false,
  };
}
/** 그 슬롯이 이번 변경 대상임을 표시(touched=true 유도). */
function changed(t: TargetSchedule): SchedulePlanItem {
  return {
    action: "update", classId: t.classId, className: t.className, day: t.day,
    startTime: t.startTime, endTime: t.endTime, room: t.room, teacherNames: t.teachers.map((x) => x.name),
  };
}

describe("detectScheduleConflicts — 실제 시간표에서 뽑은 네 갈래", () => {
  it("같은 방 · 같은 강사 = 합반 → 경고만(적용을 막지 않는다)", () => {
    // 실측 재현: 화 604호 Sam — RTT4 17:00~17:40 × 중등E_초등 브릿지 C2 16:20~17:20.
    const a = slot({ className: "RTT4", startTime: "17:00", endTime: "17:40" });
    const b = slot({ className: "중등E_초등 브릿지 C2" });
    const [c, ...rest] = detectScheduleConflicts([a, b], [changed(a)]);
    expect(rest).toHaveLength(0);
    expect(c!.kind).toBe("merged");
    expect(blocksApply(c!.kind)).toBe(false);
    expect(conflictChecklist([c!])).toHaveLength(0); // 건드렸어도 체크 대상이 아니다
    expect(c!.exact).toBe(false);
    expect(describeConflict(c!)).toContain("합반으로 보이나 시간대가 서로 다릅니다");
  });

  it("같은 방 · 다른 강사 = 한 방에 선생 둘 → 차단", () => {
    // 실측 재현: 목 606호 — 브릿지 C2(Hannah) × RTT4(Sam), 둘 다 16:20 시작.
    const a = slot({ className: "중등E_초등 브릿지 C2", day: "thu", room: "606", teachers: [{ name: "Hannah", teacherId: "t2" }] });
    const b = slot({ className: "RTT4", day: "thu", room: "606", endTime: "17:00" });
    const [c] = detectScheduleConflicts([a, b], [changed(b)]);
    expect(c!.kind).toBe("room");
    expect(c!.where).toBe("606");
    expect(blocksApply(c!.kind)).toBe(true);
    expect(conflictChecklist([c!])).toHaveLength(1);
    expect(describeConflict(c!)).toContain("강사가 다른 두 반이 겹칩니다");
  });

  it("같은 강사 · 방이 서로 다르면 차단(합반으로 설명되지 않는다)", () => {
    const a = slot({ className: "A", room: "601" });
    const b = slot({ className: "B", room: "602" });
    const [c] = detectScheduleConflicts([a, b], [changed(a)]);
    expect(c!.kind).toBe("teacher");
    expect(c!.where).toBe("Sam");
  });

  it("같은 강사인데 방을 모르면 합반으로 본다 — 확실하지 않은 것으로 적용을 막지 않는다", () => {
    const a = slot({ className: "A", room: null });
    const b = slot({ className: "B", room: "602" });
    expect(detectScheduleConflicts([a, b], [])[0]!.kind).toBe("merged");
  });

  it("한 반이 같은 시간에 두 줄이면 중복 → 차단", () => {
    const a = slot({ classId: "same", className: "RTT4", startTime: "16:20", endTime: "17:20" });
    const b = slot({ classId: "same", className: "RTT4", startTime: "17:00", endTime: "17:40", room: "601", teachers: [{ name: "Kim", teacherId: "t9" }] });
    const [c] = detectScheduleConflicts([a, b], [changed(a)]);
    expect(c!.kind).toBe("duplicate");
    expect(describeConflict(c!)).toContain("두 줄로 잡혀 있습니다");
  });

  it("다른 방 · 다른 강사면 충돌이 아니다(정상 병행 수업)", () => {
    const a = slot({ className: "A", room: "601" });
    const b = slot({ className: "B", room: "602", teachers: [{ name: "Kim", teacherId: "t9" }] });
    expect(detectScheduleConflicts([a, b], [])).toHaveLength(0);
  });

  it("요일이 다르면 겹치지 않는다", () => {
    const a = slot({ className: "A", day: "mon", teachers: [{ name: "Hannah", teacherId: "t2" }] });
    const b = slot({ className: "B", day: "tue", teachers: [{ name: "Hannah", teacherId: "t2" }] });
    expect(detectScheduleConflicts([a, b], [])).toHaveLength(0);
  });
});

describe("자리(LAB·JJ)는 충돌이 아니다 — 순진하게 세면 76쌍이 오탐이었다", () => {
  it("강사 라벨이 LAB/JJ면 검사에서 빠진다", () => {
    const mk = (name: string, cn: string) => slot({ className: cn, room: "603", teachers: [{ name, teacherId: null }] });
    expect(detectScheduleConflicts([mk("LAB", "LS6"), mk("LAB", "KW2")], [])).toHaveLength(0);
    expect(detectScheduleConflicts([mk("JJ", "LS6"), mk("JJ", "KW2")], [])).toHaveLength(0);
    // 별칭(옛 표기)도 같은 판정 — specialSlotLabel 단일 소스를 그대로 탄다.
    expect(detectScheduleConflicts([mk("이주희", "LS6"), mk("자율실", "KW2")], [])).toHaveLength(0);
  });

  it("방 라벨이 자리여도 빠진다", () => {
    const a = slot({ className: "LS6", room: "LAB", teachers: [{ name: "Sam", teacherId: "t1" }] });
    const b = slot({ className: "KW2", room: "LAB", teachers: [{ name: "Hannah", teacherId: "t2" }] });
    expect(detectScheduleConflicts([a, b], [])).toHaveLength(0);
  });
});

describe("체크리스트 범위 — 손대지 않은 옛 충돌은 확인을 요구하지 않는다", () => {
  const a = slot({ className: "A", room: "606", teachers: [{ name: "Hannah", teacherId: "t2" }] });
  const b = slot({ className: "B", room: "606" });

  it("이번 변경이 안 건드리면 목록에는 있으나 체크 대상이 아니다", () => {
    const found = detectScheduleConflicts([a, b], []); // planItems에 없음 = keep
    expect(found).toHaveLength(1);
    expect(found[0]!.touched).toBe(false);
    expect(conflictChecklist(found)).toHaveLength(0);
  });

  it("한쪽만 건드려도 체크 대상", () => {
    expect(conflictChecklist(detectScheduleConflicts([a, b], [changed(a)]))).toHaveLength(1);
  });
});

describe("키 안정성 — 체크가 임의로 풀리면 안 된다", () => {
  const a = slot({ className: "A", room: "606", teachers: [{ name: "Hannah", teacherId: "t2" }] });
  const b = slot({ className: "B", room: "606" });

  it("입력 순서가 뒤집혀도 같은 키·같은 개수", () => {
    expect(conflictKeys(detectScheduleConflicts([a, b], []))).toEqual(
      conflictKeys(detectScheduleConflicts([b, a], [])),
    );
  });

  it("한 쌍은 한 번만 나온다(방·강사 축에서 두 번 세지 않는다)", () => {
    const found = detectScheduleConflicts([a, b], []);
    expect(new Set(found.map((c) => c.key)).size).toBe(found.length);
  });

  it("끝시각을 몰라도 시작이 같으면 겹친 것으로 본다", () => {
    const x = slot({ className: "X", room: "606", endTime: null, teachers: [{ name: "Hannah", teacherId: "t2" }] });
    const y = slot({ className: "Y", room: "606", endTime: null });
    expect(detectScheduleConflicts([x, y], [])).toHaveLength(1);
  });
});
