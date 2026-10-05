import { describe, expect, it } from "vitest";
import { TENANT, STUDENT, CLASS, ATT, DATE, m, seed, cell, unitWrites } from "./makeup-reservation-complete-test-context";
import { effectGapsOf } from "@/features/makeups/server/adapters/effects";
import { completeMakeupReservations } from "./makeup-reservation-complete";

const key = `${STUDENT}|${CLASS}|${DATE}`;
const CALENDAR_UNKNOWN = "정규 시간표를 확인하지 못해 보강 시수와 참여를 기록하지 않았습니다";

function unitsOf() {
  return m.state.tables.attendance_records?.find((row) => row.id === ATT)?.session_units ?? null;
}
function noAutoUnits() {
  expect(unitWrites()).toHaveLength(0);
  expect(unitsOf()).toBeNull();
}
async function run() {
  return completeMakeupReservations({ tenantId: TENANT }, [cell()]);
}

describe("연결 시수는 엄격한 현재 설정을 따른다", () => {
  it("일반판 휴일에는 캐시된 침산 자동 시수를 쓰지 않는다", async () => {
    m.state.lessonPreset = "generic";
    m.state.holidays = [{ date: DATE }];
    const result = await run();
    noAutoUnits();
    expect(result.has(key)).toBe(false);
    expect(m.state.commands[0]).toMatchObject({
      status: "present", actual_minutes: 60, attendance_record_id: ATT,
      expected_makeup_units: null, expected_total_units: null,
    });
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("reserved");
  });

  it("일반판에 현재 정규 교시가 없어도 자동 시수를 쓰지 않는다", async () => {
    m.state.lessonPreset = "generic";
    m.state.tables.class_schedules = [];
    const result = await run();
    noAutoUnits();
    expect(result.has(key)).toBe(false);
    expect(m.state.commands[0]).toMatchObject({ expected_makeup_units: null, expected_total_units: null });
  });

  it("일반판 정규일에도 캐시된 침산 자동 시수를 쓰지 않는다", async () => {
    m.state.lessonPreset = "generic";
    const result = await run();
    noAutoUnits();
    expect(result.has(key)).toBe(false);
    expect(m.state.commands).toHaveLength(0);
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("reserved");
  });

  it("현재 설정을 읽지 못하면 시수를 쓰기 전에 멈춘다", async () => {
    m.state.lessonPreset = "generic";
    m.state.settingsReadError = true;
    const result = await run();
    noAutoUnits();
    expect(m.state.commands).toHaveLength(0);
    expect(result.has(key)).toBe(false);
    expect(effectGapsOf(result)[0]).toMatchObject({ kind: "teacher_hold", error: CALENDAR_UNKNOWN });
  });

  it("침산 정규일은 1.5이고 참여 명령은 없다", async () => {
    m.state.lessonPreset = "chinsan";
    expect((await run()).get(key)).toBe(1.5);
    expect(unitWrites()).toHaveLength(1);
    expect(unitsOf()).toBe(1.5);
    expect(m.state.commands).toHaveLength(0);
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("reserved");
  });

  it("침산 휴일은 보강 시수 0.5와 참여만 보낸다", async () => {
    m.state.lessonPreset = "chinsan";
    m.state.holidays = [{ date: DATE }];
    expect((await run()).get(key)).toBe(0.5);
    expect(unitsOf()).toBe(0.5);
    expect(m.state.commands[0]).toMatchObject({ status: "present", actual_minutes: 60, attendance_record_id: ATT });
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("reserved");
  });

  it("직접 입력한 시수는 일반판에서도 그대로다", async () => {
    seed({ units: 2 });
    m.state.lessonPreset = "generic";
    await completeMakeupReservations({ tenantId: TENANT }, [cell({ created: false, unitsExplicit: true })]);
    expect(unitWrites()).toHaveLength(0);
    expect(unitsOf()).toBe(2);
    expect(m.state.commands).toHaveLength(0);
  });

  it("미연결 이행은 옛 프로필 조회의 자동 시수를 유지한다", async () => {
    m.state.lessonPreset = "generic";
    m.state.lookupDenied = true;
    expect((await run()).get(key)).toBe(1.5);
    expect(unitsOf()).toBe(1.5);
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("done");
    expect(m.state.commands).toHaveLength(0);
  });
});
