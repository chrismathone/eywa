import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 시간표 **\*LAB 임시 칸**의 조회 두 벌을 **실행으로** 잠근다(원장 2026-09-11) — 문자열 가드
 * (`virtual-lab-wiring.test.ts`)는 모양만 본다.
 *  ① 이동만 있는 주(고정 0건)에도 학원 전체 배치를 **초기 Promise.all 안에서** 읽어 둔다(B4 — page의 await는 캐시 적중).
 *  ② fail-soft([[#95]]) — 표가 없거나 키가 없거나 조회가 실패해도 시간표는 산다(칸만 안 선다).
 * admin 클라이언트는 **물은 표 이름을 기록하는 가짜**로 바꾼다 — 실제 DB는 건드리지 않는다.
 */
const h = vi.hoisted(() => ({
  calls: [] as string[],
  rows: {} as Record<string, unknown[]>,
  errors: {} as Record<string, string>,
  throwOnCreate: false,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (h.throwOnCreate) throw new Error("SUPABASE_SERVICE_ROLE_KEY 없음");
    return {
      from: (table: string) => {
        h.calls.push(table);
        const q: Record<string, unknown> = {};
        for (const k of ["select", "eq", "in", "gte", "lte", "not", "or", "order"]) q[k] = () => q;
        q.range = (from: number) =>
          Promise.resolve(
            h.errors[table]
              ? { data: null, error: { message: h.errors[table] } }
              : { data: from === 0 ? (h.rows[table] ?? []) : [], error: null },
          );
        return q;
      },
    };
  },
}));

import { getSeatWeekMoves } from "./seat-moves";
import { getSeatLiveSlots, getSeatPins } from "./seat-pins";
import { buildVirtualLabs, knownLabSources, NO_VIRTUAL_LABS } from "../lib/virtual-lab";
import { DEFAULT_PERIODS_CONFIG } from "../lib/periods";

const REF = "2026-09-10";
const MOVE_ROW = { seat: "lab", session_date: "2026-09-10", class_id: "LE1", student_id: "s2", slot_start: "17:40:00" };
const LIVE_ROW = {
  day_of_week: "thu",
  start_time: "17:40:00",
  end_time: "18:20:00",
  slot_teacher_label: "LAB",
  valid_from: null,
  valid_to: null,
};

let n = 0;
/** React `cache`가 메모이즈하는 환경이어도 테스트끼리 섞이지 않게 — 테넌트를 매번 새로. */
const tenant = () => `t-${++n}`;

beforeEach(() => {
  h.calls = [];
  h.rows = {};
  h.errors = {};
  h.throwOnCreate = false;
});

describe("getSeatWeekMoves — 이동만 있는 주의 배치 조회는 병렬 가지 안(B4)", () => {
  it("🔑 이동이 있으면 초기 Promise.all이 끝날 때 학원 전체 배치(class_schedules)를 **이미** 읽었다 — 고정 0건이어도", async () => {
    h.rows = { seat_period_moves: [MOVE_ROW], class_schedules: [LIVE_ROW] };
    const t = tenant();
    const [pins, moves] = await Promise.all([getSeatPins(t, REF), getSeatWeekMoves(t, REF)]);
    expect(pins.pins).toHaveLength(0);
    expect(moves).toEqual([
      { seat: "lab", sessionDate: "2026-09-10", classId: "LE1", studentId: "s2", slotStart: "17:40" },
    ]);
    expect(h.calls).toContain("class_schedules");
  });

  it("이동도 고정도 0건이면 배치를 묻지 않는다(평소 왕복 불변 — B6)", async () => {
    const t = tenant();
    await Promise.all([getSeatPins(t, REF), getSeatWeekMoves(t, REF)]);
    expect([...h.calls].sort()).toEqual(["seat_period_moves", "seat_period_pins"]);
  });

  it("배치 조회가 실패해도 이동은 버리지 않는다(칸만 안 선다 — 판정은 buildVirtualLabs가 live=null로)", async () => {
    h.rows = { seat_period_moves: [MOVE_ROW] };
    h.errors = { class_schedules: "canceling statement due to statement timeout" };
    expect(await getSeatWeekMoves(tenant(), REF)).toHaveLength(1);
  });

  it("fail-soft — 표가 없거나(0255a 미적용) 키가 없으면 **null(모름)** — 던지지 않고, '이동 0줄'과는 다른 값", async () => {
    h.errors = { seat_period_moves: 'relation "public.seat_period_moves" does not exist' };
    expect(await getSeatWeekMoves(tenant(), REF)).toBeNull();
    h.errors = {};
    h.throwOnCreate = true;
    expect(await getSeatWeekMoves(tenant(), REF)).toBeNull();
    // 대조 — 정상 조회의 0줄은 빈 배열이다.
    h.throwOnCreate = false;
    expect(await getSeatWeekMoves(tenant(), REF)).toEqual([]);
  });
});

/**
 * 🔴 고정·하루 이동 중 **하나라도 모르면** *LAB을 안 세운다 — page 흐름 그대로 실행한다
 * (초기 `Promise.all` → `knownLabSources` → `getSeatLiveSlots` → `buildVirtualLabs`, page가 이 모양인지는 배선 가드가 본다).
 * 시나리오: LE1 목 = 15:00 원어민 · 15:40 LAB · 16:20 원어민, 이현이 = 목 17:00 상시 고정(9/1부터).
 */
describe("🔴 고정·하루 이동 중 하나라도 모르면 *LAB 없음 — page 흐름 그대로", () => {
  const S1 = { studentId: "s1", name: "이현이", status: "active", enrollmentDate: "2026-03-02", attendanceDays: [] as string[] };
  const LE1_SLOTS = [
    ["15:00", "15:40", "Daniella"],
    ["15:40", "16:20", "LAB"],
    ["16:20", "17:00", "Daniella"],
  ].map(([s, e, label]) => ({
    classId: "LE1",
    dayOfWeek: "thu",
    startTime: `${s}:00`,
    endTime: `${e}:00`,
    slotTeacherLabel: label!,
    students: [S1],
  }));
  const LAB_ROWS = [
    ["15:40:00", "16:20:00"],
    ["17:00:00", "17:40:00"],
  ].map(([s, e]) => ({ ...LIVE_ROW, start_time: s, end_time: e }));
  const PIN_ROW = {
    seat: "lab",
    day_of_week: "thu",
    class_id: "LE1",
    student_id: "s1",
    slot_start: "17:00:00",
    effective_from: "2026-09-01",
  };
  /** 9/10 하루만 **제 교시(15:40)로** 되돌림 — 그날 자리 출석부는 이현이를 15:40에 세운다. */
  const BACK_ROW = { ...MOVE_ROW, student_id: "s1", slot_start: "15:40:00" };
  const TIMEOUT = "canceling statement due to statement timeout";

  async function pageFlow(t: string) {
    const [seatPins, seatMoves] = await Promise.all([getSeatPins(t, REF), getSeatWeekMoves(t, REF)]);
    const sources = knownLabSources(seatPins, seatMoves);
    const labs = sources
      ? buildVirtualLabs({
          slots: LE1_SLOTS,
          pins: sources.pins,
          moves: sources.moves,
          live: await getSeatLiveSlots(t, REF).catch(() => null),
          referenceDate: REF,
          subject: "english",
          config: DEFAULT_PERIODS_CONFIG,
        })
      : NO_VIRTUAL_LABS;
    return { labs, seatPins, seatMoves };
  }

  it("대조: 둘 다 읽히면 — 제 교시로 되돌린 날엔 *LAB 없음(자리 출석부와 같다), 되돌림이 없으면 17:00에 선다", async () => {
    h.rows = { seat_period_pins: [PIN_ROW], seat_period_moves: [BACK_ROW], class_schedules: LAB_ROWS };
    expect((await pageFlow(tenant())).labs).toBe(NO_VIRTUAL_LABS);
    h.rows = { seat_period_pins: [PIN_ROW], class_schedules: LAB_ROWS };
    expect((await pageFlow(tenant())).labs.LE1?.map((c) => c.start)).toEqual(["17:00"]);
  });

  it("🔴 하루 이동 조회만 실패 → *LAB 없음(0줄로 읽으면 17:00에 '고정' 칸이 선다) · 이름 표식 재료(고정)는 그대로", async () => {
    h.rows = { seat_period_pins: [PIN_ROW], seat_period_moves: [BACK_ROW], class_schedules: LAB_ROWS };
    h.errors = { seat_period_moves: TIMEOUT };
    const { labs, seatPins, seatMoves } = await pageFlow(tenant());
    expect(seatMoves).toBeNull();
    expect(labs).toBe(NO_VIRTUAL_LABS);
    expect(seatPins.pins).toHaveLength(1);
    expect(seatPins.failed).toBeFalsy();
  });

  it("🔴 고정 조회만 실패 → *LAB 없음(0줄로 읽으면 고정 첫날이 '하루만'이 된다) · 이름 표식은 원래대로 안 붙는다", async () => {
    // 고정 첫날 = 그날 이동 줄 + 같은 교시 고정(자리 출석부 `moveSeatStudentPeriod`가 이렇게 쓴다).
    h.rows = {
      seat_period_pins: [{ ...PIN_ROW, effective_from: "2026-09-10" }],
      seat_period_moves: [{ ...BACK_ROW, slot_start: "17:00:00" }],
      class_schedules: LAB_ROWS,
    };
    expect((await pageFlow(tenant())).labs.LE1?.[0]?.note).toBe(
      "임시 LAB · 목 17:00 — 교시 이동: 이현이(9/10부터 매주 목 고정)",
    );
    h.errors = { seat_period_pins: TIMEOUT };
    const failed = await pageFlow(tenant());
    expect(failed.seatPins.failed).toBe(true);
    expect(failed.seatPins.pins).toEqual([]);
    expect(failed.labs).toBe(NO_VIRTUAL_LABS);
  });

  it("키가 없으면(클라이언트 생성 throw) 둘 다 모름 — *LAB 없음, 던지지 않는다", async () => {
    h.throwOnCreate = true;
    const { labs, seatPins, seatMoves } = await pageFlow(tenant());
    expect(seatPins.failed).toBe(true);
    expect(seatMoves).toBeNull();
    expect(labs).toBe(NO_VIRTUAL_LABS);
  });

  it("둘 다 0줄이면 학원 전체 배치를 묻지 않는다(평소 왕복 불변 — B6)", async () => {
    expect((await pageFlow(tenant())).labs).toBe(NO_VIRTUAL_LABS);
    expect([...h.calls].sort()).toEqual(["seat_period_moves", "seat_period_pins"]);
  });
});

describe("getSeatLiveSlots — page가 try 밖에서 await하므로 안쪽 catch가 살아 있어야 한다", () => {
  it("🔴 키가 없으면(클라이언트 생성 throw) null — 부가 표시 하나로 시간표가 500이 되지 않는다", async () => {
    h.throwOnCreate = true;
    await expect(getSeatLiveSlots(tenant(), REF)).resolves.toBeNull();
  });

  it("🔴 조회가 실패하면 null(모르면 판정하지 않는다)", async () => {
    h.errors = { class_schedules: "canceling statement due to statement timeout" };
    await expect(getSeatLiveSlots(tenant(), REF)).resolves.toBeNull();
  });

  it("정상이면 끝 시각까지 앱 표기로", async () => {
    h.rows = { class_schedules: [LIVE_ROW] };
    await expect(getSeatLiveSlots(tenant(), REF)).resolves.toEqual([
      {
        dayOfWeek: "thu",
        startTime: "17:40:00",
        endTime: "18:20:00",
        slotTeacherLabel: "LAB",
        validFrom: null,
        validTo: null,
      },
    ]);
  });
});
