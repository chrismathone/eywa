import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeatClassRoster, SeatDay } from "./queries";

/**
 * 교시 이동 **서버 쓰기 경로**의 학생 축 — 원장 2026-09-11 *"LAB실에서 내가 드래그하고 싶은건, '다른 시간대'의
 * 수업임"* 이후. 화면(`seatDropVerdict`)이 막아도 서버가 **자기 조회로 같은 함수를 다시 돌린다**([[#77]]: 화면 값은
 * 페이지를 연 시점의 스냅샷이고, 두 사람이 같은 화면을 열어 둘 수 있다).
 *
 * 잠그는 것: ① 겹치면 쓰지도 감사로그를 남기지도 않는다 ② 학생 축 조회는 **세션 클라이언트**(로그인 경로)
 * ③ 조회가 실패하면 **쓰지 않는다**(서버는 게이트 — 화면의 fail-open과 반대) ④ 반 축이 먼저다.
 */

const h = vi.hoisted(() => ({
  upsert: vi.fn(),
  /** `from(표)`가 불린 차례 — 고정 확인이 그날 줄 **다음에** 고정 표를 쓰는지 가른다. */
  tables: [] as string[],
  logAction: vi.fn(),
  getSeatDay: vi.fn(),
  getSeatPeriodChoices: vi.fn(),
  getSeatStudentClasses: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      h.tables.push(table);
      return { upsert: h.upsert };
    },
  }),
}));
vi.mock("@/features/audit/server/log", () => ({ logAction: h.logAction }));
vi.mock("./move-gate", () => ({
  gateSeatMoveWrite: async () => ({ userId: "u1", tenantId: "t1", via: "menu" }),
}));
vi.mock("./queries", () => ({ getSeatDay: h.getSeatDay }));
vi.mock("./period-choice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./period-choice")>()),
  getSeatPeriodChoices: h.getSeatPeriodChoices,
}));
vi.mock("./next-destination", () => ({ getSeatStudentClasses: h.getSeatStudentClasses }));

const { moveSeatStudentPeriod } = await import("./period-actions");
const { seatDowKey } = await import("./period-choice");

const FRI = "2026-09-11";
const student = (id: string, name: string): SeatClassRoster["students"][number] => ({
  id,
  name,
  school: null,
  grade: null,
  status: null,
  recordedBy: null,
  fromSeat: false,
  note: null,
  attitude: null,
  listeningLevel: null,
  memorizedWords: null,
  progressNote: null,
});
const roster = (classId: string, end: string, students: SeatClassRoster["students"]): SeatClassRoster => ({
  classId,
  className: classId,
  end,
  bgColor: null,
  textColor: null,
  students,
});
const period = (start: string, classId: string, end: string) => ({
  start,
  slots: [{ classId, className: classId, start: `${start}:00`, end: `${end}:00` }],
  ends: [end],
});

/** 금 랩실(실측 모양) — 이도윤B(y)는 PL1b 15:00 랩실, PL1b는 14:20에 정규 수업이 있다. */
const DAY: SeatDay = {
  date: FRI,
  periods: [
    period("14:20", "LS4a", "15:00"),
    period("15:00", "PL1b", "15:40"),
    period("15:40", "LE1", "16:20"),
    period("16:20", "JP3", "17:00"),
  ],
  rosterByPeriod: {
    "14:20": [roster("LS4a", "15:00", [student("a", "임시연")])],
    "15:00": [roster("PL1b", "15:40", [student("y", "이도윤B")])],
    "15:40": [roster("LE1", "16:20", [student("b", "박한솔")])],
    "16:20": [roster("JP3", "17:00", [student("c", "최지우")])],
  },
  slotsByClass: { LS4a: ["14:20"], PL1b: ["15:00"], LE1: ["15:40"], JP3: ["16:20"] },
  markedSlotsByCell: {},
  busyStartsByClass: { PL1b: ["14:20"] },
  offSlotByCell: {},
};
const MATH = {
  classId: "EL2S",
  className: "초등M 초4 EL2S",
  start: "16:20",
  end: "17:15",
  room: "본원205",
  seatLabel: null,
};
const move = (toSlot: string) =>
  moveSeatStudentPeriod({ seat: "lab", date: FRI, studentId: "y", classId: "PL1b", fromSlot: "15:00", toSlot });

beforeEach(() => {
  h.tables.length = 0;
  h.getSeatDay.mockResolvedValue(DAY);
  h.getSeatPeriodChoices.mockResolvedValue({ moves: [], pins: [], ready: true, reason: null });
  h.getSeatStudentClasses.mockResolvedValue({ ok: true, byStudent: { y: [MATH] } });
  h.upsert.mockResolvedValue({ error: null });
  h.logAction.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

describe("교시 이동 서버 — 학생 축", () => {
  it("🔴 그 시각에 그 학생의 다른 수업이 있으면 거절한다 — 쓰지도, 감사로그를 남기지도 않는다", async () => {
    const res = await move("16:20");
    expect(res).toEqual({
      error: "그 시각에 이 학생의 다른 수업(초등M 초4 EL2S 16:20~17:15)이 있습니다 — 겹치는 시간으로는 옮길 수 없습니다",
    });
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.logAction).not.toHaveBeenCalled();
  });

  it("학생 축 조회는 세션 클라이언트(테넌트를 넘기지 않는다) — 화면과 같은 조회·같은 규칙", async () => {
    await move("15:40");
    expect(h.getSeatStudentClasses).toHaveBeenCalledWith(["y"], FRI, "lab");
  });

  it("안 겹치면 옮긴다 — 감사로그 키는 그대로(`seat_period_move`)", async () => {
    const res = await move("15:40");
    expect(res).toEqual({ ok: true, pinned: false });
    expect(h.upsert).toHaveBeenCalledTimes(1);
    expect(h.upsert.mock.calls[0]![0]).toMatchObject({ student_id: "y", class_id: "PL1b", slot_start: "15:40" });
    expect(h.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "seat_period_move" }));
  });

  it("🔴 학생의 다른 수업을 확인하지 못하면 옮기지 않는다 — 서버는 게이트다(조회 문의 거절 문장 그대로)", async () => {
    const why = "이 학생의 다른 수업을 확인하지 못했습니다 — 다시 시도해 주세요";
    h.getSeatStudentClasses.mockResolvedValue({ ok: false, error: why });
    const res = await move("15:40");
    expect(res).toEqual({ error: why });
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.logAction).not.toHaveBeenCalled();
  });

  it("🔴 목표 교시 **안에서 시작하는** 수업도 거절한다 — 교시 끝은 서버가 자기 명단(`day.periods`)에서 읽는다", async () => {
    // 16:20 교시(~17:00) 안에서 16:40에 시작하는 수학 — 시작이 같지도, 그 수업이 16:20을 품지도 않는다.
    h.getSeatStudentClasses.mockResolvedValue({ ok: true, byStudent: { y: [{ ...MATH, start: "16:40", end: "17:30" }] } });
    const res = await move("16:20");
    expect(res).toEqual({
      error: "그 시각에 이 학생의 다른 수업(초등M 초4 EL2S 16:40~17:30)이 있습니다 — 겹치는 시간으로는 옮길 수 없습니다",
    });
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.logAction).not.toHaveBeenCalled();
  });

  it("반 축이 먼저다 — 그 반의 정규 수업 시각은 반 축 문장으로 거절", async () => {
    const res = await move("14:20");
    expect(res).toEqual({ error: "그 시각에는 이 반의 다른 수업이 있습니다 — 겹치는 시간으로는 옮길 수 없습니다" });
    expect(h.upsert).not.toHaveBeenCalled();
  });
});

/**
 * **고정 확인**('앞으로도 고정')의 서버 갈래 — 창은 그날 이동이 **받아진 뒤에** 뜬다. 그래서 이 호출이 올 땐 선택을 얹은
 * 명단에서 학생이 이미 목표 교시에 서 있고 출발 교시엔 없다. 고정 요청은 **언제나** 이 갈래(`alreadyThere`)를 지나므로,
 * 이 갈래가 꺼지면 원장이 요청한 고정이 통째로 죽는다(에러는 "명단에 없는 학생" — 원인을 알 수 없다).
 * 가드(`period-choice-wiring` ②)는 문자열만 본다 — 동작은 여기서 잠근다.
 */
describe("교시 이동 서버 — 고정 확인(이미 옮긴 뒤의 두 번째 호출)", () => {
  /** 첫 호출이 받아진 뒤의 그날 줄 — y는 15:40에 서 있다. */
  const MOVED = {
    moves: [{ classId: "PL1b", studentId: "y", slotStart: "15:40" }],
    pins: [],
    ready: true,
    reason: null,
  };
  const confirm = (extra: { pin?: boolean; fromSlot?: string; toSlot?: string } = {}) =>
    moveSeatStudentPeriod({
      seat: "lab",
      date: FRI,
      studentId: "y",
      classId: "PL1b",
      fromSlot: extra.fromSlot ?? "15:00",
      toSlot: extra.toSlot ?? "15:40",
      ...(extra.pin === undefined ? {} : { pin: extra.pin }),
    });

  it("🔑 학생이 목표 교시에 서 있으면 고정을 쓴다 — 그날 줄 다음에 그 요일 고정(시작일 = 이 화면 날짜) · 감사로그 `seat_period_pin`·confirmOnly", async () => {
    h.getSeatPeriodChoices.mockResolvedValue(MOVED);
    const res = await confirm({ pin: true });
    expect(res).toEqual({ ok: true, pinned: true });
    expect(h.tables).toEqual(["seat_period_moves", "seat_period_pins"]);
    expect(h.upsert).toHaveBeenCalledTimes(2);
    expect(h.upsert.mock.calls[1]![0]).toMatchObject({
      student_id: "y",
      class_id: "PL1b",
      slot_start: "15:40",
      day_of_week: seatDowKey(FRI),
      effective_from: FRI,
    });
    expect(h.logAction).toHaveBeenCalledTimes(1);
    expect(h.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "seat_period_pin",
        metadata: expect.objectContaining({
          confirmOnly: true,
          fromSlot: "15:00",
          toSlot: "15:40",
          effectiveFrom: FRI,
        }),
      }),
    );
  });

  it("🔴 대조군 — 같은 명단에서 `pin`이 없으면 '이 교시 명단에 없는 학생'으로 거절한다(고정 확인만의 갈래다)", async () => {
    h.getSeatPeriodChoices.mockResolvedValue(MOVED);
    const res = await confirm();
    expect(res).toEqual({ error: "이 교시 명단에 없는 학생입니다" });
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.logAction).not.toHaveBeenCalled();
  });

  it("🔴 목표 교시에도 없으면 `pin`이어도 거절한다 — 갈래가 '어디에도 없는 학생'까지 열지 않는다", async () => {
    // 선택 줄이 없어 y는 제 교시(15:00)에 서 있다 — 화면이 보낸 출발(15:40)에도 목표(16:20)에도 없다.
    const res = await confirm({ pin: true, fromSlot: "15:40", toSlot: "16:20" });
    expect(res).toEqual({ error: "이 교시 명단에 없는 학생입니다" });
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.logAction).not.toHaveBeenCalled();
  });
});
