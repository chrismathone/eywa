import { afterEach, describe, expect, it } from "vitest";
import { TENANT, STUDENT, CLASS, TEACHER, OTHER, ATT, DATE, m, seed, cell, unitWrites } from "./makeup-reservation-complete-test-context";
import { effectGapsOf } from "@/features/makeups/server/adapters/effects";
import { completeMakeupReservations } from "./makeup-reservation-complete";

const key = `${STUDENT}|${CLASS}|${DATE}`;
const CALENDAR_UNKNOWN = "정규 시간표를 확인하지 못해 보강 시수와 참여를 기록하지 않았습니다";
const CAP = 1000;
type Row = Record<string, unknown>;
type Thenable = { then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => unknown };
const original = m.builder;

function capUnpagedAttendance() {
  m.builder = ((table: string) => {
    const b = original(table) as Thenable;
    if (table !== "attendance_records") return b;
    const then = b.then;
    b.then = (ok, bad) => then((res) => {
      const out = res as { data?: unknown[] | null };
      const data = Array.isArray(out.data) && out.data.length > CAP ? out.data.slice(0, CAP) : out.data;
      return ok(data === out.data ? out : { ...out, data });
    }, bad);
    return b;
  }) as typeof m.builder;
}
afterEach(() => { m.builder = original; });

async function run(over: { created?: boolean } = {}) {
  return completeMakeupReservations({ tenantId: TENANT }, [cell(over)]);
}
function makeupOnly() {
  expect(unitWrites()).toHaveLength(1);
  expect(m.state.tables.attendance_records?.find((row) => row.id === ATT)?.session_units).toBe(0.5);
  expect(m.state.commands[0]).toMatchObject({ status: "present", actual_minutes: 60, attendance_record_id: ATT });
  expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("reserved");
}
function held(result: Awaited<ReturnType<typeof run>>) {
  expect(unitWrites()).toHaveLength(0);
  expect(m.state.commands).toHaveLength(0);
  expect(result.has(key)).toBe(false);
  expect(effectGapsOf(result)[0]?.kind).toBe("teacher_hold");
}

describe("정규 수업이 없는 날은 보강 시수만 쓴다", () => {
  it("휴일이면 정규 시수를 더하지 않고 참여를 보낸다", async () => {
    m.state.holidays = [{ date: DATE }];
    expect((await run()).get(key)).toBe(0.5);
    makeupOnly();
  });
  it("쉬거나 끝난 반은 보강 시수만 쓴다", async () => {
    m.state.tables.classes![0]!.is_active = false;
    await run();
    makeupOnly();
    m.state.tables.classes![0]!.is_active = true;
    m.state.tables.classes![0]!.closed_at = "2026-10-04";
    m.state.updates = [];
    m.state.commands = [];
    m.state.tables.attendance_records![0]!.session_units = null;
    await run();
    makeupOnly();
  });
  it("현재 정규 교시가 없으면 보강 시수만 쓴다", async () => {
    m.state.tables.class_schedules = [];
    expect((await run()).get(key)).toBe(0.5);
    makeupOnly();
  });
  it("수강을 읽지 못하면 보강 시수로 쓰지 않는다", async () => {
    m.state.enrollmentReadError = true;
    held(await run());
  });
  it("시간표를 모르면 수강이 없어도 시수 앞에 멈춘다", async () => {
    seed({ enrolled: false });
    m.state.schedulePageError = true;
    const result = await run();
    held(result);
    expect(effectGapsOf(result)[0]?.error).toBe(CALENDAR_UNKNOWN);
    expect(m.state.tables.attendance_records?.[0]?.session_units).toBeNull();
  });
});

describe("찍힌 담당이 다르면 정규 수업이 없어도 시수 앞에 멈춘다", () => {
  it("수강이 없는 날의 다른 담당은 시수를 쓰지 않는다", async () => {
    seed({ enrolled: false });
    m.state.tables.attendance_records![0]!.taught_by = OTHER;
    held(await run());
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("reserved");
  });
  it("휴일에 같은 담당이 대신 찍히면 보강 시수를 쓴다", async () => {
    m.state.holidays = [{ date: DATE }];
    m.state.tables.classes![0]!.teacher_id = OTHER;
    expect((await run()).get(key)).toBe(0.5);
    makeupOnly();
  });
  it("빈 담당과 알 수 없는 반 담임은 시수를 쓰지 않는다", async () => {
    seed({ enrolled: false });
    m.state.tables.attendance_records![0]!.taught_by = null;
    m.state.tables.classes![0]!.teacher_id = null;
    held(await run());
  });
  it("빈 담당이 다른 반 담임으로 돌아가면 시수를 쓰지 않는다", async () => {
    seed({ enrolled: false });
    m.state.tables.attendance_records![0]!.taught_by = null;
    m.state.tables.classes![0]!.teacher_id = OTHER;
    held(await run());
  });
  it("휴일에 찍힌 담당이 다르면 보강 시수를 쓰지 않는다", async () => {
    m.state.holidays = [{ date: DATE }];
    m.state.tables.attendance_records![0]!.taught_by = OTHER;
    held(await run());
  });
});

const idOf = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const at = (i: number) => new Date(Date.parse("2026-10-05T00:00:00.000Z") + i * 1000).toISOString();
function row(i: number, patch: Row = {}): Row {
  return {
    id: idOf(i), tenant_id: TENANT, student_id: STUDENT, class_id: CLASS, session_date: DATE, slot_start: null,
    status: "present", note: null, session_units: null, recorded_at: at(i), taught_by: TEACHER, ...patch,
  };
}
function day(older: Row, current: Row) {
  m.state.tables.attendance_records = [...Array.from({ length: CAP }, (_, i) => row(i, older)), row(CAP, current)];
}
const stored = (i: number) => m.state.tables.attendance_records!.find((r) => r.id === idOf(i))!;

describe("하루 출결은 1000행 뒤의 현재 행으로 판정한다", () => {
  it("첫 페이지 뒤의 현재 출석은 그 칸으로 참여를 보낸다", async () => {
    seed({ enrolled: false });
    day({}, { session_units: 2 });
    capUnpagedAttendance();
    await run({ created: false });
    expect(unitWrites()).toHaveLength(0);
    expect(stored(CAP).session_units).toBe(2);
    expect(stored(CAP - 1).session_units).toBeNull();
    expect(m.state.commands[0]).toMatchObject({ status: "present", attendance_record_id: idOf(CAP) });
  });
  it("첫 페이지 뒤의 현재 결석은 이전 출석에 시수를 쓰지 않는다", async () => {
    day({}, { status: "absent" });
    capUnpagedAttendance();
    const result = await run({ created: false });
    expect(unitWrites()).toHaveLength(0);
    expect(m.state.commands).toHaveLength(0);
    expect(result.has(key)).toBe(false);
    expect(stored(CAP - 1)).toMatchObject({ status: "present", session_units: null });
    expect(stored(CAP)).toMatchObject({ status: "absent", session_units: null });
  });
  it("첫 페이지 뒤의 현재 교시는 노쇼로 보내지 않는다", async () => {
    seed({ reservation: "done" });
    day({ status: "absent" }, { slot_start: "16:20:00" });
    capUnpagedAttendance();
    const result = await run({ created: false });
    expect(unitWrites()).toHaveLength(0);
    expect(m.state.commands).toHaveLength(0);
    expect(effectGapsOf(result)).toEqual([]);
    expect(stored(CAP)).toMatchObject({ status: "present", slot_start: "16:20:00", session_units: null });
  });
  it("페이지 밖 다른 교시 담당이 있으면 시수 앞에 멈춘다", async () => {
    day({}, { taught_by: OTHER, slot_start: "18:00:00" });
    capUnpagedAttendance();
    const result = await run({ created: false });
    expect(unitWrites()).toHaveLength(0);
    expect(m.state.commands).toHaveLength(0);
    expect(effectGapsOf(result)[0]?.kind).toBe("teacher_hold");
    expect(stored(CAP).session_units).toBeNull();
  });
  it("둘째 페이지를 읽지 못하면 없는 출결로 보지 않는다", async () => {
    m.state.tables.makeup_reservations![0]!.status = "done";
    m.state.tables.attendance_records = Array.from({ length: CAP }, (_, i) => row(i, { status: "absent" }));
    m.state.attendanceDayNextPageError = true;
    capUnpagedAttendance();
    const result = await run({ created: false });
    expect(unitWrites()).toHaveLength(0);
    expect(m.state.commands).toHaveLength(0);
    expect(effectGapsOf(result)[0]?.kind).toBe("teacher_hold");
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("done");
    expect(stored(0).status).toBe("absent");
    expect(stored(0).session_units).toBeNull();
  });
  it("둘째 페이지의 현재 교시 길이로 1.5를 쓴다", async () => {
    const filler = { tenant_id: TENANT, class_id: CLASS, day_of_week: "tue", start_time: "09:00:00", end_time: "09:40:00", valid_from: "2026-01-01", valid_to: null, teacher_id: null };
    m.state.tables.class_schedules = [
      ...Array.from({ length: CAP }, (_, i) => ({ ...filler, id: idOf(i) })),
      { ...filler, id: idOf(CAP), day_of_week: "mon", start_time: "16:20:00", end_time: "17:40:00" },
    ];
    expect((await run()).get(key)).toBe(1.5);
    expect(m.state.commands).toHaveLength(0);
  });
  it("수업 시간 둘째 페이지가 실패하면 시수를 쓰지 않는다", async () => {
    const filler = { tenant_id: TENANT, class_id: CLASS, day_of_week: "tue", start_time: "09:00:00", end_time: "09:40:00", valid_from: "2026-01-01", valid_to: null, teacher_id: null };
    m.state.tables.class_schedules = [
      ...Array.from({ length: CAP }, (_, i) => ({ ...filler, id: idOf(i) })),
      { ...filler, id: idOf(CAP), day_of_week: "mon", start_time: "16:20:00", end_time: "17:40:00" },
    ];
    m.state.scheduleMinutesNextPageError = true;
    held(await run());
  });
});
