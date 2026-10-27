import { describe, expect, it } from "vitest";
import { TENANT, STUDENT, CLASS, DATE, m, seed, cell } from "./makeup-reservation-complete-test-context";
import { completeMakeupReservations } from "./makeup-reservation-complete";

/**
 * `addToCurrent` — 정규 반으로 옮겨 합친 예약(원장 2026-10-27 박지호 건 · `moveReservationToRegular`).
 * 그 칸은 예약보다 먼저 찍혀 있어 '새 칸·빈 칸에만 자동값' 규칙으로는 보강분이 빠지거나(3교시 반 1.5) 시간표로 다시 매겨진다(적대 리뷰).
 * 🔴 미연결(옛) 예약 경로 — 연결 예약은 옮기기 전에 막힌다(`mappedReservationMutationBlock`).
 */
const key = `${STUDENT}|${CLASS}|${DATE}`;
const moved = (over: Parameters<typeof cell>[0] = {}) => ({ ...cell({ created: false, ...over }), addToCurrent: true });
const unitsNow = () => m.state.tables.attendance_records?.[0]?.session_units;

describe("이행 — addToCurrent(지금 값 + 보강분)", () => {
  it("🔴 이미 1.5가 저장된 칸(3교시 반)에 보강분 0.5를 더해 2 — 시간표로 다시 매기지 않는다", async () => {
    seed({ units: 1.5 });
    m.state.lookupDenied = true;
    const out = await completeMakeupReservations({ tenantId: TENANT }, [moved()]);
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("done");
    expect(unitsNow()).toBe(2);
    expect(out.get(key)).toBe(2);
  });

  it("빈 칸(=1)은 1.5 · 사람이 친 값(2)도 그 위에 더한다", async () => {
    seed({});
    m.state.lookupDenied = true;
    await completeMakeupReservations({ tenantId: TENANT }, [moved()]);
    expect(unitsNow()).toBe(1.5);
    seed({ units: 2 });
    m.state.lookupDenied = true;
    await completeMakeupReservations({ tenantId: TENANT }, [moved()]);
    expect(unitsNow()).toBe(2.5);
  });

  it("🔴 이미 이행된 예약(동시 출석 저장이 먼저)은 더하지 않는다 — 두 번 더하지 않게", async () => {
    seed({ units: 1.5, reservation: "done" });
    m.state.lookupDenied = true;
    const out = await completeMakeupReservations({ tenantId: TENANT }, [moved()]);
    expect(unitsNow()).toBe(1.5);
    expect(out.has(key)).toBe(false);
  });

  it("명시 시수는 그대로 · 상한(20)을 넘기면 더하지 않는다", async () => {
    seed({ units: 1.5 });
    m.state.lookupDenied = true;
    await completeMakeupReservations({ tenantId: TENANT }, [moved({ unitsExplicit: true })]);
    expect(unitsNow()).toBe(1.5);
    seed({ units: 20 });
    m.state.lookupDenied = true;
    await completeMakeupReservations({ tenantId: TENANT }, [moved()]);
    expect(unitsNow()).toBe(20);
  });

  it("옵션이 없으면 종전대로 — 이미 저장된 칸은 그대로(다른 호출부 불변)", async () => {
    seed({ units: 1.5 });
    m.state.lookupDenied = true;
    await completeMakeupReservations({ tenantId: TENANT }, [cell({ created: false })]);
    expect(m.state.tables.makeup_reservations?.[0]?.status).toBe("done");
    expect(unitsNow()).toBe(1.5);
  });
});
