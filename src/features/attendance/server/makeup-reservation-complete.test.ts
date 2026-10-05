import { describe, expect, it } from "vitest";
import { TENANT, STUDENT, CLASS, TEACHER, OTHER, PART, ATT, DATE, SLOT, OLD_SLOT, NEW_SLOT, m, seed, cell, slot, unitWrites } from "./makeup-reservation-complete-test-context";
import { effectGapsOf } from "@/features/makeups/server/adapters/effects";
import { judgeProjectionEvidence } from "@/features/makeups/projection-evidence";
import { completeMakeupReservations } from "./makeup-reservation-complete";

describe("연결 예약 이행 훅", () => {
  it("권한 없는 자리 관측은 미연결 예약을 완료·되돌리고 연결 예약의 DB 거절은 출결 시수에 닿지 않는다", async () => {
    m.state.lookupDenied = true;
    await completeMakeupReservations({ tenantId: TENANT }, [cell()]);
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("done");
    expect(m.state.commands).toHaveLength(0);
    m.state.tables.attendance_records![0]!.status = "absent";
    await completeMakeupReservations({ tenantId: TENANT }, [cell({ status: "absent", created: false })]);
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("reserved");
    seed(); m.state.lookupDenied = true; m.state.reservationGuard = true;
    await completeMakeupReservations({ tenantId: TENANT }, [cell()]);
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("reserved");
    expect(unitWrites()).toHaveLength(0);
    expect(m.state.commands).toHaveLength(0);
  });

  it("같은 담당 정규+보강은 1.5를 한 번만 쓰고 참여 명령은 없다", async () => {
    const key = `${STUDENT}|${CLASS}|${DATE}`;
    const first = await completeMakeupReservations({ tenantId: TENANT }, [cell()]);
    expect(first.get(key)).toBe(1.5);
    expect(m.state.commands).toHaveLength(0);
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("reserved");
    const second = await completeMakeupReservations({ tenantId: TENANT }, [cell({ created: false })]);
    expect(second.has(key)).toBe(false);
    expect(unitWrites()).toHaveLength(1);
    expect(m.state.tables.attendance_records?.[0]?.session_units).toBe(1.5);
  });

  it("이미 저장된 시수와 명시 입력은 그대로다", async () => {
    seed({ units: 2 });
    await completeMakeupReservations({ tenantId: TENANT }, [cell({ created: false })]);
    expect(unitWrites()).toHaveLength(0);
    expect(m.state.tables.attendance_records?.[0]?.session_units).toBe(2);
    seed({});
    await completeMakeupReservations({ tenantId: TENANT }, [cell({ unitsExplicit: true })]);
    expect(unitWrites()).toHaveLength(0);
  });

  it("비정규일은 보고서를 같이 보내고, 보고서가 없으면 완료가 아니다", async () => {
    m.state.reportId = "77777777-7777-4777-8777-777777777777";
    seed({ enrolled: false });
    await completeMakeupReservations({ tenantId: TENANT }, [cell()]);
    expect(m.state.commands[0]).toMatchObject({ status: "present", actual_minutes: 60, report_id: m.state.reportId, attendance_record_id: ATT });
    m.state.reportId = null;
    seed({ enrolled: false });
    await completeMakeupReservations({ tenantId: TENANT }, [cell()]);
    expect(m.state.commands[0]).not.toHaveProperty("report_id");
    expect(judgeProjectionEvidence({
      commandSent: true, commandAccepted: true, commandError: null,
      evidence: { attendanceRecordId: ATT, sessionUnits: 0.5, sessionUnitsRead: true, taughtBy: TEACHER, taughtByRead: true, reportId: null, actualTeacherId: TEACHER },
    }).state).toBe("pending");
  });

  it("조퇴는 차이 대기만 남기고, 노쇼 실패는 출결과 예약을 유지한다", async () => {
    seed({ attendance: "early_leave" });
    const partial = await completeMakeupReservations({ tenantId: TENANT }, [cell({ status: "early_leave" })]);
    expect(m.state.commands).toHaveLength(0);
    expect(effectGapsOf(partial).map((gap) => gap.kind)).toEqual(["units_review"]);
    expect(m.state.tables.attendance_records?.[0]?.status).toBe("early_leave");
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("reserved");
    seed({ reservation: "done", attendance: "absent" });
    m.state.failCommand = true;
    const missed = await completeMakeupReservations({ tenantId: TENANT }, [cell({ status: "absent", created: false })]);
    expect(m.state.commands[0]).toMatchObject({ status: "no_show", actual_minutes: 0 });
    expect(effectGapsOf(missed).map((gap) => gap.kind)).toContain("participation_failed");
    expect(m.state.tables.attendance_records?.[0]?.status).toBe("absent");
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("done");
    expect(unitWrites()).toHaveLength(0);
  });

  it("다른 담당은 정규 시수를 두지 않고, 관측은 참여를 보내지 않는다", async () => {
    m.state.teacherId = OTHER;
    const held = await completeMakeupReservations({ tenantId: TENANT }, [cell()]);
    expect(unitWrites()).toHaveLength(0);
    expect(effectGapsOf(held)[0]?.kind).toBe("teacher_hold");
    m.state.teacherId = TEACHER;
    seed();
    const seen = await completeMakeupReservations({ tenantId: TENANT, observeOnly: true }, [cell()]);
    expect(m.state.commands).toHaveLength(0);
    expect(unitWrites()).toHaveLength(0);
    expect(effectGapsOf(seen)[0]).toMatchObject({ kind: "observation", effectKey: `att:${PART}`, queued: true });
  });

  it("완료로 확인된 참여는 실패 기록을 덮지 않고, 대기는 대기열에 남는다", async () => {
    seed({ enrolled: false });
    m.state.projectionState = "done";
    m.state.verificationOk = true;
    const done = await completeMakeupReservations({ tenantId: TENANT }, [cell()]);
    expect(m.state.commands).toHaveLength(1);
    expect(m.state.gaps).toHaveLength(0);
    expect(effectGapsOf(done)).toEqual([]);
    seed({ enrolled: false });
    const pending = await completeMakeupReservations({ tenantId: TENANT }, [cell()]);
    expect(effectGapsOf(pending)[0]).toMatchObject({ kind: "participation_pending", queued: true });
    expect(m.state.tables.attendance_records?.[0]?.status).toBe("present");
  });

  it("다른 교시의 현재 담당이 다르면 하루 칸 시수를 쓰지 않는다", async () => {
    m.state.tables.attendance_records!.push(slot(SLOT, { taught_by: OTHER }));
    const held = await completeMakeupReservations({ tenantId: TENANT }, [cell()]);
    expect(unitWrites()).toHaveLength(0);
    expect(m.state.commands).toHaveLength(0);
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("reserved");
    expect(m.state.tables.attendance_records?.[0]?.status).toBe("present");
    expect(m.state.tables.attendance_records?.[0]?.session_units).toBeNull();
    expect(effectGapsOf(held)[0]?.kind).toBe("teacher_hold");
  });

  it("둘째 페이지의 다른 담당도 시수와 참여 앞에 멈춘다", async () => {
    const rows = m.state.tables.attendance_records!;
    for (let i = 0; i < 1000; i += 1) {
      rows.push(slot(`00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`, {
        slot_start: "09:00:00", status: "absent", taught_by: OTHER, recorded_at: "2026-10-05T01:00:00.000Z",
      }));
    }
    rows.push(slot(SLOT, { taught_by: OTHER }));
    const held = await completeMakeupReservations({ tenantId: TENANT }, [cell()]);
    expect(unitWrites()).toHaveLength(0);
    expect(m.state.commands).toHaveLength(0);
    expect(m.state.tables.attendance_records?.find((row) => row.id === ATT)?.status).toBe("present");
    expect(m.state.tables.attendance_records?.find((row) => row.id === ATT)?.session_units).toBeNull();
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("reserved");
    expect(effectGapsOf(held)[0]?.kind).toBe("teacher_hold");
  });

  it("같은 담당과 나중 정정은 1.5를 한 번 쓴다", async () => {
    const key = `${STUDENT}|${CLASS}|${DATE}`;
    m.state.tables.attendance_records!.push(slot(SLOT));
    const same = await completeMakeupReservations({ tenantId: TENANT }, [cell()]);
    expect(same.get(key)).toBe(1.5);
    expect(unitWrites()).toHaveLength(1);
    expect(m.state.commands).toHaveLength(0);
    seed();
    m.state.tables.attendance_records!.push(
      slot(OLD_SLOT, { taught_by: OTHER, recorded_at: "2026-10-05T07:00:00.000Z" }),
      slot(NEW_SLOT, { taught_by: TEACHER, recorded_at: "2026-10-05T09:00:00.000Z" }),
    );
    const corrected = await completeMakeupReservations({ tenantId: TENANT }, [cell()]);
    expect(corrected.get(key)).toBe(1.5);
    expect(m.state.tables.attendance_records?.find((row) => row.id === ATT)?.session_units).toBe(1.5);
    expect(m.state.commands).toHaveLength(0);
  });

  it("명시 시수는 담당이 갈려도 출결 상태를 되돌리지 않는다", async () => {
    m.state.tables.attendance_records!.push(slot(SLOT, { taught_by: OTHER }));
    const held = await completeMakeupReservations({ tenantId: TENANT }, [cell({ unitsExplicit: true })]);
    expect(unitWrites()).toHaveLength(0);
    expect(m.state.commands).toHaveLength(0);
    expect(m.state.tables.attendance_records?.[0]?.status).toBe("present");
    expect(m.state.tables.attendance_records?.[0]?.session_units).toBeNull();
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("reserved");
    expect(effectGapsOf(held)[0]?.kind).toBe("teacher_hold");
  });

  it("비정규일에 담당이 갈리면 참여를 보내지 않는다", async () => {
    seed({ enrolled: false });
    m.state.tables.attendance_records!.push(slot(SLOT, { taught_by: OTHER }));
    const held = await completeMakeupReservations({ tenantId: TENANT }, [cell()]);
    expect(unitWrites()).toHaveLength(0);
    expect(m.state.commands).toHaveLength(0);
    expect(m.state.tables.attendance_records?.[0]?.status).toBe("present");
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("reserved");
    expect(effectGapsOf(held)[0]?.kind).toBe("teacher_hold");
  });

  it("정규 출결을 읽지 못하면 시수와 참여를 쓰지 않는다", async () => {
    m.state.attendancePageError = true;
    const held = await completeMakeupReservations({ tenantId: TENANT }, [cell()]);
    expect(unitWrites()).toHaveLength(0);
    expect(m.state.commands).toHaveLength(0);
    expect(m.state.tables.attendance_records?.[0]?.status).toBe("present");
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("reserved");
    expect(effectGapsOf(held)[0]?.kind).toBe("teacher_hold");
  });
});
