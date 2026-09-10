import { describe, expect, it } from "vitest";
import {
  applySeatPinMarks,
  buildSeatLiveStarts,
  movableSeatOf,
  seatPinNote,
  SEAT_PIN_MARK_CLASS,
  type SeatPinRow,
} from "./seat-pin-mark";

/**
 * 자리(랩실) 교시 고정 표식 — 순수 규칙.
 *
 * 기준 주: `referenceDate = 2026-09-10`(목요일) → 월 09-07 · 화 09-08 · 수 09-09 · 목 09-10 · 금 09-11.
 * 실데이터 모양을 그대로 쓴다(JP1 목 14:20 / 16:20 — 실측 8개 (반×요일) 중 하나).
 */
const REF = "2026-09-10";

type Stu = { studentId: string; status?: string; seatPinNote?: string };
type Slot = {
  classId: string;
  dayOfWeek: string;
  startTime: string;
  slotTeacherLabel?: string | null;
  students: Stu[];
};

/** JP1 목요일: LAB 두 교시가 **같은 명단 배열 인스턴스**를 나눠 갖는다(서버 `byClass`와 같은 모양). */
function jp1Thu(students: Stu[]): Slot[] {
  return [
    { classId: "JP1", dayOfWeek: "thu", startTime: "14:20:00", slotTeacherLabel: "LAB", students },
    { classId: "JP1", dayOfWeek: "thu", startTime: "16:20:00", slotTeacherLabel: "LAB", students },
  ];
}

const pin = (over: Partial<SeatPinRow> = {}): SeatPinRow => ({
  seat: "lab",
  dayOfWeek: "thu",
  classId: "JP1",
  studentId: "s1",
  slotStart: "16:20",
  effectiveFrom: "2026-09-01",
  ...over,
});

describe("movableSeatOf", () => {
  it("자리 라벨이면 그 자리 키 — 별칭(랩실·이주희)도 같은 답", () => {
    expect(movableSeatOf("LAB")).toBe("lab");
    expect(movableSeatOf("랩실")).toBe("lab");
    expect(movableSeatOf("이주희")).toBe("lab");
  });

  it("교시를 옮길 수 없는 자리(JJ)와 사람 강사는 null", () => {
    // JJ실은 실제로 같은 요일 2교시인 반이 5개 있지만(실측) 교시 선택 기능이 안 열려 있다.
    expect(movableSeatOf("JJ")).toBeNull();
    expect(movableSeatOf("이다교")).toBeNull();
    expect(movableSeatOf(null)).toBeNull();
  });
});

describe("seatPinNote", () => {
  it("한글로 적고 raw 코드(thu·lab)를 노출하지 않는다", () => {
    const note = seatPinNote([{ seat: "lab", dayOfWeek: "thu", slotStart: "16:20" }]);
    expect(note).toBe("랩실 교시 고정 · 목 16:20");
    expect(note).not.toMatch(/thu|lab/i);
  });

  it("여러 요일이면 월→일 순으로 이어 붙인다", () => {
    expect(
      seatPinNote([
        { seat: "lab", dayOfWeek: "fri", slotStart: "16:20" },
        { seat: "lab", dayOfWeek: "tue", slotStart: "14:20" },
      ]),
    ).toBe("랩실 교시 고정 · 화 14:20 · 금 16:20");
  });

  it("빈 입력은 빈 문자열(표식이 안 붙는다)", () => {
    expect(seatPinNote([])).toBe("");
  });
});

describe("applySeatPinMarks", () => {
  it("고정이 걸린 학생 이름에 문구를 얹는다 — 그 반의 자리 칸 전부에서 같은 모양", () => {
    const students: Stu[] = [{ studentId: "s1" }, { studentId: "s2" }];
    const out = applySeatPinMarks(jp1Thu(students), { pins: [pin()], referenceDate: REF });
    for (const slot of out) {
      expect(slot.students[0]!.seatPinNote).toBe("랩실 교시 고정 · 목 16:20");
      expect(slot.students[1]!.seatPinNote).toBeUndefined();
    }
  });

  it("고정이 0줄이면 입력을 **그대로** 돌려준다(참조까지 동일 = 비용 0)", () => {
    const slots = jp1Thu([{ studentId: "s1" }]);
    expect(applySeatPinMarks(slots, { pins: [], referenceDate: REF })).toBe(slots);
  });

  it("표식이 붙어도 손대지 않은 반의 명단 배열 인스턴스는 그대로 공유된다", () => {
    const jp1 = [{ studentId: "s1" }];
    const other = [{ studentId: "s9" }];
    const slots: Slot[] = [
      ...jp1Thu(jp1),
      { classId: "LS4a", dayOfWeek: "thu", startTime: "15:40:00", slotTeacherLabel: "LAB", students: other },
    ];
    const out = applySeatPinMarks(slots, { pins: [pin()], referenceDate: REF });
    // 안 바뀐 반은 슬롯 객체까지 같은 참조(RSC 페이로드가 안 불어난다).
    expect(out[2]).toBe(slots[2]);
    // 바뀐 반의 두 슬롯은 **같은 새 배열**을 나눠 갖는다(공유가 깨지지 않았다).
    expect(out[0]!.students).toBe(out[1]!.students);
    expect(out[0]!.students).not.toBe(jp1);
  });

  it("하나뿐인 자기 교시로 고정했으면 안 붙인다 — 옮긴 게 아니다", () => {
    const students: Stu[] = [{ studentId: "s1" }];
    const only: Slot[] = [
      { classId: "JP1", dayOfWeek: "thu", startTime: "16:20:00", slotTeacherLabel: "LAB", students },
    ];
    const out = applySeatPinMarks(only, { pins: [pin()], referenceDate: REF });
    expect(out[0]!.students[0]!.seatPinNote).toBeUndefined();
    expect(out).toBe(only);
  });

  it("고정된 교시가 그 주 시간표에 없으면 안 붙인다(배치가 바뀌었다)", () => {
    const students: Stu[] = [{ studentId: "s1" }];
    const out = applySeatPinMarks(jp1Thu(students), {
      pins: [pin({ slotStart: "18:20" })],
      referenceDate: REF,
    });
    expect(out[0]!.students[0]!.seatPinNote).toBeUndefined();
  });

  it("🔑 다른 시간(남의 반 자리 교시)으로 옮긴 고정도 붙는다 — 목표 교시는 학원 전체 배치로 확인한다", () => {
    // 원장 2026-09-10 "다른 시간으로 옮기는게 목적" — LE1 목 15:40 LAB → PL4의 17:00 LAB.
    const students: Stu[] = [{ studentId: "s1" }];
    const le1: Slot[] = [
      { classId: "LE1", dayOfWeek: "thu", startTime: "15:40:00", slotTeacherLabel: "LAB", students },
    ];
    const out = applySeatPinMarks(le1, {
      pins: [pin({ classId: "LE1", slotStart: "17:00" })],
      liveStarts: new Map([["lab|thu", new Set(["15:40", "17:00"])]]),
      referenceDate: REF,
    });
    expect(out[0]!.students[0]!.seatPinNote).toBe("랩실 교시 고정 · 목 17:00");
  });

  it("옮긴 목표 교시가 그 주에 안 돌면 안 붙인다(배치가 바뀌었다)", () => {
    const students: Stu[] = [{ studentId: "s1" }];
    const le1: Slot[] = [
      { classId: "LE1", dayOfWeek: "thu", startTime: "15:40:00", slotTeacherLabel: "LAB", students },
    ];
    const out = applySeatPinMarks(le1, {
      pins: [pin({ classId: "LE1", slotStart: "17:00" })],
      liveStarts: new Map([["lab|thu", new Set(["15:40"])]]),
      referenceDate: REF,
    });
    expect(out[0]!.students[0]!.seatPinNote).toBeUndefined();
  });

  it("학원 전체 배치를 모르면(조회 실패) 다른 시간 고정엔 안 붙인다 — 모르면 안 붙인다", () => {
    const students: Stu[] = [{ studentId: "s1" }];
    const le1: Slot[] = [
      { classId: "LE1", dayOfWeek: "thu", startTime: "15:40:00", slotTeacherLabel: "LAB", students },
    ];
    const out = applySeatPinMarks(le1, {
      pins: [pin({ classId: "LE1", slotStart: "17:00" })],
      liveStarts: null,
      referenceDate: REF,
    });
    expect(out[0]!.students[0]!.seatPinNote).toBeUndefined();
  });

  it("그 반의 다른 수업 시각으로 고정했으면 안 붙인다 — 자리 출석부도 버린다(기록 키가 겹친다)", () => {
    const students: Stu[] = [{ studentId: "s1" }];
    const le1: Slot[] = [
      { classId: "LE1", dayOfWeek: "thu", startTime: "15:40:00", slotTeacherLabel: "LAB", students },
      // 같은 날 17:00은 그 반의 원어민 수업 — 거기로 옮기면 반 기록과 자리 기록이 같은 칸이 된다.
      { classId: "LE1", dayOfWeek: "thu", startTime: "17:00:00", slotTeacherLabel: "Daniella", students },
    ];
    const out = applySeatPinMarks(le1, {
      pins: [pin({ classId: "LE1", slotStart: "17:00" })],
      liveStarts: new Map([["lab|thu", new Set(["15:40", "17:00"])]]),
      referenceDate: REF,
    });
    expect(out[0]!.students[0]!.seatPinNote).toBeUndefined();
  });

  it("`effective_from`보다 이전 주엔 안 붙는다 — 과거는 기록이다", () => {
    const students: Stu[] = [{ studentId: "s1" }];
    // 그 주 목요일은 2026-09-03이라 09-10 시작 고정은 아직 유효하지 않다.
    const past = applySeatPinMarks(jp1Thu(students), {
      pins: [pin({ effectiveFrom: "2026-09-10" })],
      referenceDate: "2026-09-03",
    });
    expect(past[0]!.students[0]!.seatPinNote).toBeUndefined();
    // 시작일 당일이 든 주에는 붙는다(경계 포함).
    const now = applySeatPinMarks(jp1Thu(students), {
      pins: [pin({ effectiveFrom: "2026-09-10" })],
      referenceDate: REF,
    });
    expect(now[0]!.students[0]!.seatPinNote).toBe("랩실 교시 고정 · 목 16:20");
  });

  it("퇴원 줄엔 안 붙인다 — 고정은 남아도 그 학생은 이제 안 온다", () => {
    const students: Stu[] = [{ studentId: "s1", status: "withdrawn" }];
    const out = applySeatPinMarks(jp1Thu(students), { pins: [pin()], referenceDate: REF });
    expect(out[0]!.students[0]!.seatPinNote).toBeUndefined();
  });

  it("교시를 옮길 수 없는 자리(JJ)의 고정은 무시한다", () => {
    const students: Stu[] = [{ studentId: "s1" }];
    const jj: Slot[] = [
      { classId: "MED", dayOfWeek: "thu", startTime: "16:20:00", slotTeacherLabel: "JJ", students },
      { classId: "MED", dayOfWeek: "thu", startTime: "17:20:00", slotTeacherLabel: "JJ", students },
    ];
    const out = applySeatPinMarks(jj, {
      pins: [pin({ seat: "jj", classId: "MED", slotStart: "17:20" })],
      referenceDate: REF,
    });
    expect(out[0]!.students[0]!.seatPinNote).toBeUndefined();
  });

  it("다른 요일 고정은 그 요일 칸에만 — 요일이 어긋나면 안 붙는다", () => {
    const students: Stu[] = [{ studentId: "s1" }];
    const out = applySeatPinMarks(jp1Thu(students), {
      pins: [pin({ dayOfWeek: "tue" })],
      referenceDate: REF,
    });
    expect(out[0]!.students[0]!.seatPinNote).toBeUndefined();
  });

  it("자리가 아닌 칸(정규 수업)의 교시 수는 세지 않는다", () => {
    const students: Stu[] = [{ studentId: "s1" }];
    const mixed: Slot[] = [
      { classId: "JP1", dayOfWeek: "thu", startTime: "16:20:00", slotTeacherLabel: "LAB", students },
      // 같은 반·같은 요일이지만 사람 강사 수업 — 자리 교시가 아니므로 "2개 이상"에 안 들어간다.
      { classId: "JP1", dayOfWeek: "thu", startTime: "17:20:00", slotTeacherLabel: "이다교", students },
    ];
    const out = applySeatPinMarks(mixed, { pins: [pin()], referenceDate: REF });
    expect(out[0]!.students[0]!.seatPinNote).toBeUndefined();
  });

  it("표시 서식은 파란 글씨 + 밑줄 + 이탤릭(원장 2026-09-10 지시 그대로)", () => {
    expect(SEAT_PIN_MARK_CLASS).toContain("text-blue");
    expect(SEAT_PIN_MARK_CLASS).toContain("underline");
    expect(SEAT_PIN_MARK_CLASS).toContain("italic");
  });
});

describe("buildSeatLiveStarts", () => {
  it("옮길 수 있는 자리 라벨 슬롯만, 그 주 그 요일에 살아 있는 것만 모은다", () => {
    const live = buildSeatLiveStarts(
      [
        { dayOfWeek: "thu", startTime: "17:00:00", slotTeacherLabel: "LAB" },
        { dayOfWeek: "thu", startTime: "15:40:00", slotTeacherLabel: "랩실" },
        // 사람 강사 수업·JJ(교시를 옮길 수 없는 자리)는 뺀다.
        { dayOfWeek: "thu", startTime: "16:20:00", slotTeacherLabel: "이다교" },
        { dayOfWeek: "thu", startTime: "18:00:00", slotTeacherLabel: "JJ" },
        // 그 주 목요일(09-10) 전에 끝난 배치는 뺀다.
        { dayOfWeek: "thu", startTime: "19:00:00", slotTeacherLabel: "LAB", validTo: "2026-09-09" },
      ],
      REF,
    );
    expect([...(live.get("lab|thu") ?? [])].sort()).toEqual(["15:40", "17:00"]);
    expect(live.has("jj|thu")).toBe(false);
  });
});
