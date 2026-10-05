import { describe, expect, it } from "vitest";
import { effectGapsOf } from "@/features/makeups/server/adapters/effects";
import { TENANT, STUDENT, CLASS, TEACHER, OTHER, ATT, DATE, SLOT, m, cell, slot, unitWrites } from "./makeup-reservation-complete-test-context";
import { completeMakeupReservations } from "./makeup-reservation-complete";

const key = `${STUDENT}|${CLASS}|${DATE}`;
const CALENDAR_DIFFERS = "같은 날 정규 수업의 담당 강사와 보강 강사가 달라 함께 기록할 수 없습니다";
const CALENDAR_UNKNOWN = "정규 시간표를 확인하지 못해 보강 시수와 참여를 기록하지 않았습니다";

function classTeacher(id: string) {
  m.state.tables.classes![0]!.teacher_id = id;
}

function scheduleRow(patch: Record<string, unknown>) {
  return { ...m.state.tables.class_schedules![0], teacher_id: null, valid_from: "2026-01-01", valid_to: null, ...patch };
}

async function run(over: { unitsExplicit?: boolean } = {}) {
  return completeMakeupReservations({ tenantId: TENANT }, [cell(over)]);
}

function stayed(result: Awaited<ReturnType<typeof run>>, error: string) {
  expect(unitWrites()).toHaveLength(0);
  expect(m.state.commands).toHaveLength(0);
  expect(result.has(key)).toBe(false);
  expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("reserved");
  expect(m.state.tables.attendance_records?.find((row) => row.id === ATT)?.status).toBe("present");
  expect(m.state.tables.attendance_records?.find((row) => row.id === ATT)?.session_units).toBeNull();
  expect(effectGapsOf(result)[0]).toMatchObject({ kind: "teacher_hold", error });
}

describe("시간표 담당이 보강 강사와 같아야 연결 시수를 쓴다", () => {
  it("찍힌 담당이 같아도 시간표 담당이 다르면 시수를 쓰지 않는다", async () => {
    classTeacher(OTHER);
    stayed(await run(), CALENDAR_DIFFERS);
  });

  it("출결 담당과 시간표 담당이 같으면 1.5를 한 번 쓴다", async () => {
    const wrote = await run();
    expect(wrote.get(key)).toBe(1.5);
    expect(unitWrites()).toHaveLength(1);
    expect(m.state.commands).toHaveLength(0);
    expect(m.state.tables.attendance_records?.[0]?.session_units).toBe(1.5);
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("reserved");
  });

  it("유효한 교시 담당이 보강 강사이면 반 담임이 달라도 1.5를 쓴다", async () => {
    classTeacher(OTHER);
    m.state.tables.class_schedules![0]!.teacher_id = TEACHER;
    const wrote = await run();
    expect(wrote.get(key)).toBe(1.5);
    expect(unitWrites()).toHaveLength(1);
    expect(m.state.tables.attendance_records?.[0]?.session_units).toBe(1.5);
  });

  it("유효한 교시 담당이 다르면 반 담임이 같아도 시수를 쓰지 않는다", async () => {
    m.state.tables.class_schedules![0]!.teacher_id = OTHER;
    stayed(await run(), CALENDAR_DIFFERS);
  });

  it("끝난 교시 담당은 세지 않고 현재 교시는 반 담임으로 1.5를 쓴다", async () => {
    m.state.tables.class_schedules = [
      scheduleRow({ id: "12121212-1212-4121-8121-121212121212", teacher_id: OTHER, valid_to: "2026-10-04" }),
      scheduleRow({ id: "13131313-1313-4131-8131-131313131313", teacher_id: null }),
    ];
    const wrote = await run();
    expect(wrote.get(key)).toBe(1.5);
    expect(unitWrites()).toHaveLength(1);
    expect(m.state.commands).toHaveLength(0);
  });

  it("시간표를 읽지 못하면 시수와 참여를 쓰지 않는다", async () => {
    m.state.schedulePageError = true;
    stayed(await run(), CALENDAR_UNKNOWN);
  });

  it("명시 시수는 시간표 담당이 달라도 출결을 덮지 않는다", async () => {
    classTeacher(OTHER);
    stayed(await run({ unitsExplicit: true }), CALENDAR_DIFFERS);
  });

  it("다른 교시의 현재 출결 담당은 시수 앞에 그대로 멈춘다", async () => {
    m.state.tables.attendance_records!.push(slot(SLOT, { taught_by: OTHER }));
    const held = await run();
    expect(unitWrites()).toHaveLength(0);
    expect(m.state.commands).toHaveLength(0);
    expect(effectGapsOf(held)[0]?.kind).toBe("teacher_hold");
    expect(m.state.tables.attendance_records?.[0]?.status).toBe("present");
    expect(m.state.tables.attendance_records?.[0]?.session_units).toBeNull();
  });

  it("둘째 페이지의 다른 출결 담당도 시수 앞에 그대로 멈춘다", async () => {
    const rows = m.state.tables.attendance_records!;
    for (let i = 0; i < 1000; i += 1) {
      rows.push(slot(`00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`, {
        slot_start: "09:00:00", status: "absent", taught_by: OTHER, recorded_at: "2026-10-05T01:00:00.000Z",
      }));
    }
    rows.push(slot(SLOT, { taught_by: OTHER }));
    const held = await run();
    expect(unitWrites()).toHaveLength(0);
    expect(m.state.commands).toHaveLength(0);
    expect(m.state.tables.attendance_records?.find((row) => row.id === ATT)?.session_units).toBeNull();
    expect(effectGapsOf(held)[0]?.kind).toBe("teacher_hold");
  });

  it("현재 교시 담당이 둘이면 시수를 쓰지 않는다", async () => {
    m.state.tables.class_schedules = [
      scheduleRow({ id: "12121212-1212-4121-8121-121212121212", teacher_id: TEACHER, start_time: "16:20:00" }),
      scheduleRow({ id: "13131313-1313-4131-8131-131313131313", teacher_id: OTHER, start_time: "18:00:00" }),
    ];
    stayed(await run(), CALENDAR_DIFFERS);
  });

  it("둘째 페이지의 현재 교시 담당이 다르면 시수를 쓰지 않는다", async () => {
    const rows = [];
    for (let i = 0; i < 1000; i += 1) {
      rows.push(scheduleRow({
        id: `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`,
        teacher_id: TEACHER, valid_to: "2026-10-04",
      }));
    }
    rows.push(scheduleRow({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", teacher_id: OTHER }));
    m.state.tables.class_schedules = rows;
    stayed(await run(), CALENDAR_DIFFERS);
  });
  it("설정 조회 실패 시 휴강 없음으로 간주하여 시수를 쓰지 않는다", async () => {
    m.state.settingsReadError = true;
    const held = await run();
    expect(unitWrites()).toHaveLength(0);
    expect(m.state.commands).toHaveLength(0);
    expect(effectGapsOf(held)[0]?.kind).toBe("teacher_hold");
    expect(m.state.tables.attendance_records?.find(row => row.id === ATT)?.session_units).toBeNull();
  });
});
