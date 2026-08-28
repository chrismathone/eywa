import { describe, expect, it } from "vitest";
import {
  dedupeLiveSchedules,
  normalizePlanSlotInput,
  summarizePlanMonths,
  toPlanDay,
  toPlanSlot,
  type LiveScheduleRow,
  type PlanSlotRow,
} from "./plan-row";
import type { PlanSlotInput } from "../types";

const U = (n: number) => `0000000${n}-0000-4000-8000-000000000000`.slice(-36);
const CLASS_A = "11111111-1111-4111-8111-111111111111";
const CLASS_B = "22222222-2222-4222-8222-222222222222";
const TEACHER = "33333333-3333-4333-8333-333333333333";

function row(over: Partial<PlanSlotRow> = {}): PlanSlotRow {
  return {
    id: U(1),
    plan_month: "2026-09",
    class_id: CLASS_A,
    day_of_week: "mon",
    start_time: "16:20:00",
    end_time: "17:20:00",
    teacher_id: null,
    classroom_id: null,
    slot_teacher_label: null,
    slot_room_label: null,
    period_label: null,
    merge_group: null,
    source_schedule_id: null,
    ...over,
  };
}

function live(over: Partial<LiveScheduleRow> = {}): LiveScheduleRow {
  return {
    id: U(1),
    class_id: CLASS_A,
    day_of_week: "mon",
    start_time: "16:20:00",
    end_time: "17:20:00",
    teacher_id: null,
    classroom_id: null,
    slot_teacher_label: null,
    slot_room_label: null,
    period_label: null,
    merge_group: null,
    valid_from: "2026-01-01",
    valid_to: null,
    ...over,
  };
}

describe("toPlanSlot", () => {
  it("DB의 'HH:MM:SS'를 'HH:MM'으로 자른다(비교가 문자열 동등이라 형식이 갈리면 전부 '변경')", () => {
    const slot = toPlanSlot(row({ start_time: "16:20:00", end_time: "17:20:00" }));
    expect(slot?.startTime).toBe("16:20");
    expect(slot?.endTime).toBe("17:20");
  });

  it("요일 enum이 깨진 행은 담지 않는다(조용히 mon으로 떨어뜨리지 않는다)", () => {
    expect(toPlanSlot(row({ day_of_week: "monday" }))).toBeNull();
    expect(toPlanSlot(row({ day_of_week: "" }))).toBeNull();
  });

  it("null 필드를 그대로 보존한다", () => {
    const slot = toPlanSlot(row({ teacher_id: TEACHER, period_label: "1교시" }));
    expect(slot).toMatchObject({
      classId: CLASS_A,
      dayOfWeek: "mon",
      teacherId: TEACHER,
      classroomId: null,
      periodLabel: "1교시",
      mergeGroup: null,
    });
  });
});

describe("toPlanDay", () => {
  it("계약의 7요일만 통과", () => {
    expect(toPlanDay("sun")).toBe("sun");
    expect(toPlanDay("Mon")).toBeNull();
    expect(toPlanDay(null)).toBeNull();
  });
});

describe("summarizePlanMonths", () => {
  it("달마다 칸 수·반 수·마지막 수정 시각을 모으고 최신 달이 위", () => {
    const out = summarizePlanMonths([
      { plan_month: "2026-09", class_id: CLASS_A, updated_at: "2026-08-01T00:00:00Z" },
      { plan_month: "2026-09", class_id: CLASS_A, updated_at: "2026-08-20T00:00:00Z" },
      { plan_month: "2026-09", class_id: CLASS_B, updated_at: null },
      { plan_month: "2026-10", class_id: CLASS_B, updated_at: "2026-08-05T00:00:00Z" },
    ]);
    expect(out.map((m) => m.month)).toEqual(["2026-10", "2026-09"]);
    expect(out[1]).toEqual({
      month: "2026-09",
      slotCount: 3,
      classCount: 2, // 같은 반 두 칸은 한 반
      updatedAt: "2026-08-20T00:00:00Z", // 가장 늦은 것
    });
  });

  it("형식 밖 달은 목록·정렬을 어긋내지 않게 버린다", () => {
    expect(summarizePlanMonths([{ plan_month: "2026-13", class_id: CLASS_A, updated_at: null }])).toEqual([]);
  });

  it("빈 입력은 빈 목록", () => {
    expect(summarizePlanMonths([])).toEqual([]);
  });
});

describe("dedupeLiveSchedules", () => {
  it("한 칸에 이력 두 줄이 겹치면 가장 늦게 시작한 행만 남긴다(#88 · 유니크 제약 방어)", () => {
    const old = live({ id: U(1), valid_from: "2026-01-01", valid_to: "2026-09-14", teacher_id: null });
    const fresh = live({ id: U(2), valid_from: "2026-09-15", valid_to: null, teacher_id: TEACHER });
    const out = dedupeLiveSchedules([old, fresh]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(U(2));
    expect(out[0]!.teacher_id).toBe(TEACHER);
  });

  it("valid_from이 같으면 id로 결정론적 tie-break(재실행 결과가 흔들리지 않게)", () => {
    const a = live({ id: U(1), valid_from: "2026-09-01" });
    const b = live({ id: U(2), valid_from: "2026-09-01" });
    expect(dedupeLiveSchedules([a, b])[0]!.id).toBe(U(2));
    expect(dedupeLiveSchedules([b, a])[0]!.id).toBe(U(2));
  });

  it("반·요일·시작시각이 다르면 서로 다른 칸이라 다 남는다", () => {
    const rows = [
      live({ id: U(1), class_id: CLASS_A, day_of_week: "mon", start_time: "16:20:00" }),
      live({ id: U(2), class_id: CLASS_B, day_of_week: "mon", start_time: "16:20:00" }),
      live({ id: U(3), class_id: CLASS_A, day_of_week: "tue", start_time: "16:20:00" }),
      live({ id: U(4), class_id: CLASS_A, day_of_week: "mon", start_time: "17:30:00" }),
    ];
    expect(dedupeLiveSchedules(rows)).toHaveLength(4);
  });

  it("'16:20:00'과 '16:20'은 같은 칸이다(정규화 후 키를 만든다)", () => {
    const a = live({ id: U(1), start_time: "16:20:00", valid_from: "2026-01-01" });
    const b = live({ id: U(2), start_time: "16:20", valid_from: "2026-05-01" });
    expect(dedupeLiveSchedules([a, b])).toHaveLength(1);
  });

  it("요일이 깨진 원본은 버린다(계획 표의 enum에 못 들어간다)", () => {
    expect(dedupeLiveSchedules([live({ day_of_week: "월" })])).toEqual([]);
  });
});

describe("normalizePlanSlotInput", () => {
  function input(over: Partial<PlanSlotInput> = {}): PlanSlotInput {
    return {
      classId: CLASS_A,
      dayOfWeek: "mon",
      startTime: "16:20",
      endTime: "17:20",
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

  it("정상 입력을 정규화해 통과시킨다(초는 잘리고 빈 문자열 라벨은 null)", () => {
    const r = normalizePlanSlotInput(
      input({ startTime: "16:20:00", slotRoomLabel: "  ", periodLabel: " 1교시 " }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.startTime).toBe("16:20");
    expect(r.value.slotRoomLabel).toBeNull();
    expect(r.value.periodLabel).toBe("1교시");
  });

  it("빈 uuid 문자열은 null로(폼의 '선택 안 함')", () => {
    const r = normalizePlanSlotInput(input({ teacherId: "", classroomId: "   " }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.teacherId).toBeNull();
    expect(r.value.classroomId).toBeNull();
  });

  it.each([
    ["반이 없으면", input({ classId: "" }), "반을 선택해 주세요"],
    ["반 id가 uuid가 아니면", input({ classId: "abc" }), "반을 선택해 주세요"],
    ["요일이 깨졌으면", input({ dayOfWeek: "monday" as PlanSlotInput["dayOfWeek"] }), "요일이 올바르지 않습니다"],
    ["시작 시각이 형식 밖이면", input({ startTime: "25:00" }), "시작 시각이 올바르지 않습니다(예: 16:20)"],
    ["종료 시각이 비었으면", input({ endTime: "" }), "종료 시각이 올바르지 않습니다(예: 17:20)"],
    ["종료가 시작보다 이르면", input({ startTime: "17:20", endTime: "16:20" }), "종료 시각은 시작 시각보다 늦어야 합니다"],
    ["종료와 시작이 같으면", input({ startTime: "16:20", endTime: "16:20" }), "종료 시각은 시작 시각보다 늦어야 합니다"],
    ["강사 id가 uuid가 아니면", input({ teacherId: "nope" }), "강사 값이 올바르지 않습니다"],
    ["강의실 id가 uuid가 아니면", input({ classroomId: "nope" }), "강의실 값이 올바르지 않습니다"],
  ])("%s 한글 사유로 거절한다", (_label, bad, message) => {
    const r = normalizePlanSlotInput(bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe(message);
  });

  it("에러 문구에 영문 키·raw 코드가 새지 않는다(UI 노출 규약)", () => {
    const r = normalizePlanSlotInput(input({ dayOfWeek: "monday" as PlanSlotInput["dayOfWeek"] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).not.toMatch(/[a-z]{3,}/i);
  });
});
