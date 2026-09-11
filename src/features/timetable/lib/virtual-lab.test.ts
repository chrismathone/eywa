import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRichCardGroups, type GridSlot } from "./class-grid";
import { DEFAULT_PERIODS_CONFIG, slotPeriodRow } from "./periods";
import { visibleSpanRows } from "./row-span";
import { NO_SEAT_PINS, SEAT_PINS_UNKNOWN, type SeatPinRow } from "./seat-pin-mark";
import {
  borrowFromRoster,
  buildVirtualLabs,
  knownLabSources,
  NO_VIRTUAL_LABS,
  onSeatRosterOn,
  placeVirtualLabs,
  VIRTUAL_LAB_CELL_CLASS,
  VIRTUAL_LAB_LABEL,
  type SeatLiveSlot,
  type SeatMoveRow,
  type VirtualLabCell,
} from "./virtual-lab";

/**
 * 시간표 통합뷰 **\*LAB 임시 칸** — 순수 규칙(원장 2026-09-11).
 *
 * 기준 주: `referenceDate = 2026-09-10`(목) → 월 09-07 … 일 09-13. 모양은 실데이터 그대로다:
 *  · LE1 목 = 15:00 원어민 · **15:40 LAB** · 16:20 원어민(changelog 2026-09-10 실측 — "15:00·16:20은 원어민 수업이라
 *    그리로는 못 간다")
 *  · 학원 전체 목요일 LAB = 14:20 · 15:00 · 15:40 · 16:20 · 17:00 · 17:40 · 18:20(각 40분, 2026-09-11 실측 조합)
 */
const REF = "2026-09-10";
const C = DEFAULT_PERIODS_CONFIG;

type Stu = {
  studentId: string;
  name: string;
  grade: string | null;
  school: string | null;
  status: "active" | "hold" | "withdrawn";
  enrollmentDate?: string | null;
  attendanceDays?: string[];
  movingOut?: { on: string; className: string | null };
};

const stu = (studentId: string, name: string, over: Partial<Stu> = {}): Stu => ({
  studentId,
  name,
  grade: "중1",
  school: "경명여중",
  status: "active",
  enrollmentDate: "2026-03-02",
  attendanceDays: [],
  ...over,
});

type Slot = {
  id: string;
  classId: string;
  className: string;
  subject: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  teacherName: string | null;
  classroomName: string | null;
  slotTeacherLabel: string | null;
  slotRoomLabel: string | null;
  classBgColor: string | null;
  classTextColor: string | null;
  students: Stu[];
};

function slot(classId: string, day: string, start: string, end: string, label: string | null, students: Stu[]): Slot {
  return {
    id: `${classId}-${day}-${start}`,
    classId,
    className: classId,
    subject: "english",
    dayOfWeek: day,
    startTime: `${start}:00`,
    endTime: `${end}:00`,
    teacherName: "송지혜",
    classroomName: "본원601",
    slotTeacherLabel: label,
    slotRoomLabel: null,
    classBgColor: null,
    classTextColor: null,
    students,
  };
}

const LE1_STUDENTS = [stu("s1", "이현이"), stu("s2", "송하늘"), stu("s3", "박바다")];
/** LE1 목 — 한 반의 슬롯들은 같은 명단 배열을 나눠 갖는다(서버 `byClass`와 같은 모양). */
const le1Thu = (students: Stu[] = LE1_STUDENTS): Slot[] => [
  slot("LE1", "thu", "15:00", "15:40", "Daniella", students),
  slot("LE1", "thu", "15:40", "16:20", "LAB", students),
  slot("LE1", "thu", "16:20", "17:00", "Daniella", students),
];

const LIVE_THU: SeatLiveSlot[] = [
  ["14:20", "15:00"],
  ["15:00", "15:40"],
  ["15:40", "16:20"],
  ["16:20", "17:00"],
  ["17:00", "17:40"],
  ["17:40", "18:20"],
  ["18:20", "19:00"],
].map(([s, e]) => ({ dayOfWeek: "thu", startTime: `${s}:00`, endTime: `${e}:00`, slotTeacherLabel: "LAB" }));

const pin = (over: Partial<SeatPinRow> = {}): SeatPinRow => ({
  seat: "lab",
  dayOfWeek: "thu",
  classId: "LE1",
  studentId: "s1",
  slotStart: "17:00",
  effectiveFrom: "2026-09-01",
  ...over,
});

const move = (over: Partial<SeatMoveRow> = {}): SeatMoveRow => ({
  seat: "lab",
  sessionDate: "2026-09-10",
  classId: "LE1",
  studentId: "s2",
  slotStart: "17:40",
  ...over,
});

const build = (over: Partial<Parameters<typeof buildVirtualLabs>[0]> = {}) =>
  buildVirtualLabs({
    slots: le1Thu(),
    pins: [],
    moves: [],
    live: LIVE_THU,
    referenceDate: REF,
    subject: "english",
    config: C,
    ...over,
  });

describe("buildVirtualLabs — 자리 출석부와 같은 판정", () => {
  it("상시 고정 → 목표 교시에 *LAB 한 칸, 교시축 행은 카드 빌더와 **같은 함수**(slotPeriodRow)로 잰다", () => {
    const out = build({ pins: [pin()] });
    expect(Object.keys(out)).toEqual(["LE1"]);
    const c = out.LE1![0]!;
    expect(c).toMatchObject({ classId: "LE1", dayOfWeek: "thu", date: "2026-09-10", start: "17:00" });
    expect(c.order).toBe(slotPeriodRow("english", "17:00", "thu", C, "17:40").order);
    expect(c.students).toEqual([
      { studentId: "s1", name: "이현이", source: { kind: "pin", effectiveFrom: "2026-09-01" } },
    ]);
    expect(c.note).toBe("임시 LAB · 목 17:00 — 교시 이동: 이현이(9/1부터 매주 목 고정)");
  });

  it("🔴 하루 이동은 **그 날짜가 든 주에만** — 다음 주·지난 주엔 없다", () => {
    const now = build({ moves: [move()] });
    expect(now.LE1).toHaveLength(1);
    expect(now.LE1![0]).toMatchObject({
      start: "17:40",
      students: [{ studentId: "s2", name: "송하늘", source: { kind: "move", date: "2026-09-10" } }],
    });
    expect(now.LE1![0]!.note).toBe("임시 LAB · 목 17:40 — 교시 이동: 송하늘(9/10 하루만)");
    expect(build({ moves: [move()], referenceDate: "2026-09-17" })).toBe(NO_VIRTUAL_LABS);
    expect(build({ moves: [move()], referenceDate: "2026-09-03" })).toBe(NO_VIRTUAL_LABS);
  });

  it("상시 고정은 **적용일 이후 매주 같은 요일**에만", () => {
    const later = pin({ effectiveFrom: "2026-09-11" });
    // 이번 주 목요일(09-10)은 적용 전 — 과거는 기록이다.
    expect(build({ pins: [later] })).toBe(NO_VIRTUAL_LABS);
    expect(build({ pins: [later], referenceDate: "2026-09-17" }).LE1![0]!.date).toBe("2026-09-17");
    // 적용일 뒤로는 매주 선다.
    expect(build({ pins: [pin()], referenceDate: "2026-10-01" }).LE1![0]!.start).toBe("17:00");
    // 요일이 다르면 안 선다(그 반은 화요일에 자리 교시가 없다).
    expect(build({ pins: [pin({ dayOfWeek: "tue" })] })).toBe(NO_VIRTUAL_LABS);
  });

  it("하루 이동이 상시 고정을 **이긴다** — 오늘만 제 교시로 되돌리면 그날은 *LAB이 없다", () => {
    const moved = build({ pins: [pin()], moves: [move({ studentId: "s1", slotStart: "17:40" })] });
    expect(moved.LE1!.map((c) => c.start)).toEqual(["17:40"]);
    expect(moved.LE1![0]!.students[0]!.source).toEqual({ kind: "move", date: "2026-09-10" });
    expect(build({ pins: [pin()], moves: [move({ studentId: "s1", slotStart: "15:40" })] })).toBe(NO_VIRTUAL_LABS);
  });

  it("🔑 고정 첫날(그날 이동 줄 + 같은 교시 고정 — 자리 출석부가 **이렇게 쓴다**)은 **고정**이라 말한다 — 이름 표식과 같은 말", () => {
    // moveSeatStudentPeriod: 그날 이동 upsert → '고정할까요?' 확인이면 같은 교시로 고정 upsert(effective_from = 그 날짜).
    const out = build({
      pins: [pin({ effectiveFrom: "2026-09-10" })],
      moves: [move({ studentId: "s1", slotStart: "17:00" })],
    });
    expect(out.LE1).toHaveLength(1);
    expect(out.LE1![0]!.students).toEqual([
      { studentId: "s1", name: "이현이", source: { kind: "pin", effectiveFrom: "2026-09-10" } },
    ]);
    expect(out.LE1![0]!.note).toBe("임시 LAB · 목 17:00 — 교시 이동: 이현이(9/10부터 매주 목 고정)");
  });

  it("같은 교시여도 고정이 **아직 적용 전**(미래 시작)이면 그날 이동은 하루짜리다 — 미래 고정을 오늘의 사실로 적지 않는다", () => {
    const out = build({
      pins: [pin({ effectiveFrom: "2026-09-17" })],
      moves: [move({ studentId: "s1", slotStart: "17:00" })],
    });
    expect(out.LE1![0]!.students[0]!.source).toEqual({ kind: "move", date: "2026-09-10" });
    expect(out.LE1![0]!.note).toBe("임시 LAB · 목 17:00 — 교시 이동: 이현이(9/10 하루만)");
  });

  it("문서의 툴팁 예시는 코드가 **실제로 만드는** 문장이다 — 하루 이동은 그 날짜의 요일 칸에만 선다", () => {
    const out = build({
      slots: le1Thu([stu("s4", "송지혜"), stu("s1", "이현이")]),
      pins: [pin({ effectiveFrom: "2026-09-03" })],
      moves: [move({ studentId: "s4", slotStart: "17:00" })],
    });
    const note = out.LE1![0]!.note;
    expect(note).toBe("임시 LAB · 목 17:00 — 교시 이동: 송지혜(9/10 하루만) · 이현이(9/3부터 매주 목 고정)");
    for (const f of ["src/features/timetable/lib/virtual-lab.ts", "docs/changelog.md"]) {
      expect(readFileSync(join(process.cwd(), f), "utf8"), `${f}의 예시가 실제 문장과 다르다`).toContain(note);
    }
  });

  it("🔴 제 반 자리 교시로 고른 것(하루 두 번 도는 반)은 **자기 칸**이라 *LAB이 아니다", () => {
    const j = [stu("j1", "김가을")];
    const jp1 = [slot("JP1", "thu", "14:20", "15:00", "LAB", j), slot("JP1", "thu", "16:20", "17:00", "LAB", j)];
    expect(build({ slots: jp1, pins: [pin({ classId: "JP1", studentId: "j1", slotStart: "16:20" })] })).toBe(
      NO_VIRTUAL_LABS,
    );
  });

  it("🔴 반 BUSY — 그 시각에 그 반의 다른 수업이 있으면 고정을 버린다(자리 출석부도 버린다)", () => {
    // 16:20은 학원 전체 LAB이 도는 시각이지만 LE1은 그때 원어민 수업이다.
    expect(build({ pins: [pin({ slotStart: "16:20" })] })).toBe(NO_VIRTUAL_LABS);
  });

  it("라벨 없는 교시(담당만 있는 슬롯)는 반 BUSY로 **안 본다** — 자리 출석부(`loadSeatDay`)가 라벨 있는 슬롯만 읽는 것과 같은 재료", () => {
    // 자리 출석부는 이 시각으로의 고정을 받아 학생을 17:00 랩실에 세운다 — 시간표가 여기서 버리면 두 화면이 갈린다.
    const slots = [...le1Thu(), slot("LE1", "thu", "17:00", "17:40", null, LE1_STUDENTS)];
    expect(build({ slots, pins: [pin()] }).LE1?.map((c) => c.start)).toEqual(["17:00"]);
  });

  it("목표 교시가 그날 이 자리에 **안 돌면** 안 선다 · 학원 전체 배치를 모르면 안 선다", () => {
    expect(build({ pins: [pin({ slotStart: "19:20" })] })).toBe(NO_VIRTUAL_LABS);
    expect(build({ pins: [pin()], live: null })).toBe(NO_VIRTUAL_LABS);
    // 그 날짜에 끝난 배치(유효기간)는 도는 교시가 아니다.
    const ended = LIVE_THU.map((r) => (r.startTime.startsWith("17:00") ? { ...r, validTo: "2026-09-09" } : r));
    expect(build({ pins: [pin()], live: ended })).toBe(NO_VIRTUAL_LABS);
  });

  it("퇴원·대기·그 날짜 뒤 시작·예약 전출 이후·분리등원 요일 밖은 뺀다 — 경계는 선다", () => {
    const drop: Partial<Stu>[] = [
      { status: "withdrawn" },
      { status: "hold" },
      { enrollmentDate: "2026-09-11" },
      { movingOut: { on: "2026-09-10", className: "LE2" } },
      { attendanceDays: ["mon", "tue"] },
    ];
    for (const over of drop) {
      expect(build({ slots: le1Thu([stu("s1", "이현이", over)]), pins: [pin()] }), JSON.stringify(over)).toBe(
        NO_VIRTUAL_LABS,
      );
    }
    const keep: Partial<Stu>[] = [
      { enrollmentDate: "2026-09-10" },
      { movingOut: { on: "2026-09-11", className: "LE2" } },
      { attendanceDays: ["mon", "thu"] },
    ];
    for (const over of keep) {
      expect(build({ slots: le1Thu([stu("s1", "이현이", over)]), pins: [pin()] }).LE1, JSON.stringify(over)).toHaveLength(1);
    }
  });

  it("그날 그 반 명단에 없는 학생의 선택은 세우지 않는다 — 명단 밖 학생을 끌어오는 경로가 아니다", () => {
    expect(build({ pins: [pin({ studentId: "zz" })] })).toBe(NO_VIRTUAL_LABS);
  });

  it("JJ실 고정·이동은 대상이 아니다(교시를 옮기는 자리는 랩실뿐)", () => {
    expect(build({ pins: [pin({ seat: "jj" })], moves: [move({ seat: "jj" })] })).toBe(NO_VIRTUAL_LABS);
  });

  it("고정·이동이 0건이면 빈 값 **참조 그대로**(비용 0)", () => {
    expect(build()).toBe(NO_VIRTUAL_LABS);
  });

  it("같은 교시로 옮긴 학생 여럿은 **한 칸** — 명단 순서대로, 툴팁이 모두를 말한다(raw 코드 없음)", () => {
    const out = build({ pins: [pin()], moves: [move({ studentId: "s3", slotStart: "17:00" })] });
    expect(out.LE1).toHaveLength(1);
    expect(out.LE1![0]!.students.map((s) => s.name)).toEqual(["이현이", "박바다"]);
    const note = out.LE1![0]!.note;
    expect(note).toBe("임시 LAB · 목 17:00 — 교시 이동: 이현이(9/1부터 매주 목 고정) · 박바다(9/10 하루만)");
    expect(note).not.toMatch(/thu|move|pin|2026-/);
  });

  it("🔑 출처는 **학생마다** 가린다 — 같은 반 **다른 학생**의 오늘 이동(다른 교시)이 고정 학생을 '하루만'으로 뒤집지 않는다", () => {
    // 이현이 = 목 17:00 상시 고정 · 송하늘 = 오늘만 17:40 → 두 칸, 각자 제 출처(이름 표식도 이현이를 '고정'이라 말한다).
    const out = build({ pins: [pin()], moves: [move()] });
    expect(out.LE1!.map((c) => c.start)).toEqual(["17:00", "17:40"]);
    expect(out.LE1![0]!.students).toEqual([
      { studentId: "s1", name: "이현이", source: { kind: "pin", effectiveFrom: "2026-09-01" } },
    ]);
    expect(out.LE1![0]!.note).toBe("임시 LAB · 목 17:00 — 교시 이동: 이현이(9/1부터 매주 목 고정)");
    expect(out.LE1![1]!.students).toEqual([
      { studentId: "s2", name: "송하늘", source: { kind: "move", date: "2026-09-10" } },
    ]);
  });

  it("주말 칸은 교시축 행을 믿지 않는다(order=null — 카드 빌더가 주말 칸을 옮겨 앉힌다)", () => {
    const sat = [slot("SAT1", "sat", "10:00", "11:00", "LAB", [stu("w1", "최주말")])];
    const live: SeatLiveSlot[] = [
      { dayOfWeek: "sat", startTime: "10:00:00", endTime: "11:00:00", slotTeacherLabel: "LAB" },
      { dayOfWeek: "sat", startTime: "11:00:00", endTime: "12:00:00", slotTeacherLabel: "LAB" },
    ];
    const out = build({
      slots: sat,
      live,
      pins: [pin({ classId: "SAT1", studentId: "w1", dayOfWeek: "sat", slotStart: "11:00" })],
    });
    expect(out.SAT1![0]).toMatchObject({ dayOfWeek: "sat", date: "2026-09-12", start: "11:00", order: null });
  });
});

/**
 * page의 기준일(`getWeekReferenceDate`)은 이번 주면 **오늘**, 지난 주면 일요일, 미래 주면 월요일이다 — 그래서 7칸 중
 * 6칸은 칸 날짜와 기준일이 다르다. 적용일·수강 시작/전출·툴팁 날짜는 전부 **그 요일 칸의 날짜**로 잰다.
 * (위 테스트들은 기준일을 시험하는 그 목요일로 둬서 이 차이를 못 본다.)
 */
describe("🔴 판정 날짜 = 그 요일 칸의 날짜 — 기준일이 아니다", () => {
  const FRI = "2026-09-11";
  const MON = "2026-09-07";

  it("금요일에 연 이번 주 — 목요일 하루 이동의 날짜·툴팁은 **9/10**(칸 날짜)", () => {
    const out = build({ moves: [move()], referenceDate: FRI });
    expect(out.LE1).toHaveLength(1);
    expect(out.LE1![0]).toMatchObject({
      date: "2026-09-10",
      students: [{ studentId: "s2", source: { kind: "move", date: "2026-09-10" } }],
    });
    expect(out.LE1![0]!.note).toBe("임시 LAB · 목 17:40 — 교시 이동: 송하늘(9/10 하루만)");
  });

  it("금요일에 연 이번 주 — 9/11 시작 수강생은 목(9/10) 칸에 **없고**, 9/11 전출 학생은 목 칸에 **있다**", () => {
    expect(build({ slots: le1Thu([stu("s1", "이현이", { enrollmentDate: FRI })]), pins: [pin()], referenceDate: FRI })).toBe(
      NO_VIRTUAL_LABS,
    );
    const leaving = le1Thu([stu("s1", "이현이", { movingOut: { on: FRI, className: "LE2" } })]);
    expect(build({ slots: leaving, pins: [pin()], referenceDate: FRI }).LE1?.map((c) => c.date)).toEqual(["2026-09-10"]);
  });

  it("월요일에 연 이번 주 — 목(9/10)부터 적용하는 목요일 고정은 목요일 칸에 **선다**(적용일을 기준일로 재면 사라진다)", () => {
    const out = build({ pins: [pin({ effectiveFrom: "2026-09-10" })], referenceDate: MON });
    expect(out.LE1?.map((c) => c.date)).toEqual(["2026-09-10"]);
    expect(out.LE1![0]!.note).toBe("임시 LAB · 목 17:00 — 교시 이동: 이현이(9/10부터 매주 목 고정)");
    // 거울상 — 금요일부터 적용하는 목요일 고정은 이번 주 목요일(9/10) 칸에 안 선다(과거는 기록이다).
    expect(build({ pins: [pin({ effectiveFrom: FRI })], referenceDate: FRI })).toBe(NO_VIRTUAL_LABS);
  });
});

describe("knownLabSources — 재료 둘 중 하나라도 모르면 칸 없음(모르면 안 붙인다)", () => {
  const pinsOk = { pins: [pin()], liveStarts: null };

  it("둘 다 알면 그대로 넘긴다 — 한쪽이 0줄이어도", () => {
    expect(knownLabSources(pinsOk, [move()])).toEqual({ pins: [pin()], moves: [move()] });
    expect(knownLabSources(pinsOk, [])).toEqual({ pins: [pin()], moves: [] });
    expect(knownLabSources(NO_SEAT_PINS, [move()])).toEqual({ pins: [], moves: [move()] });
  });

  it("🔴 하루 이동을 모르면(null) 고정이 있어도 null — 0줄로 읽으면 '오늘만 제 교시로' 되돌린 학생이 고정 교시에 선다", () => {
    expect(knownLabSources(pinsOk, null)).toBeNull();
  });

  it("🔴 고정을 모르면(조회 실패) 이동이 있어도 null — 0줄로 읽으면 고정 첫날이 '하루만'이 된다", () => {
    expect(knownLabSources(SEAT_PINS_UNKNOWN, [move()])).toBeNull();
    expect(knownLabSources({ ...pinsOk, failed: true }, [move()])).toBeNull();
    // 이름 표식에겐 실패도 '고정 0줄'이다(안 붙는다) — 모름 표시만 다르다.
    expect(SEAT_PINS_UNKNOWN.pins).toEqual([]);
  });

  it("둘 다 0줄이면 null — page는 학원 전체 배치도 묻지 않는다(평소 왕복 불변)", () => {
    expect(knownLabSources(NO_SEAT_PINS, [])).toBeNull();
  });
});

describe("onSeatRosterOn — 자리 명단과 같은 두 판정", () => {
  it("분리등원이 비면 전 요일, 있으면 그 요일만", () => {
    expect(onSeatRosterOn(stu("a", "가"), "2026-09-10", "thu")).toBe(true);
    expect(onSeatRosterOn(stu("a", "가", { attendanceDays: ["thu"] }), "2026-09-10", "thu")).toBe(true);
    expect(onSeatRosterOn(stu("a", "가", { attendanceDays: ["fri"] }), "2026-09-10", "thu")).toBe(false);
  });
});

describe("placeVirtualLabs — 격자 안 / 그 카드에만 추가 행", () => {
  const X = [slot("X", "thu", "15:00", "15:40", "홍길동", []), slot("X", "thu", "17:00", "17:40", "홍길동", [])];

  it("🔑 섹션에 그 교시 행이 있고 칸이 비면 **격자 안** — 카드 빌더의 행 order가 곧 키다", () => {
    const slots = [...le1Thu(), ...X];
    const group = buildRichCardGroups(slots as unknown as GridSlot[], C)[0]!;
    const card = group.cards.find((c) => c.classId === "LE1")!;
    const labs = build({ slots, pins: [pin()] }).LE1!;
    const placed = placeVirtualLabs({
      labs,
      cells: card.cells,
      rows: visibleSpanRows(group.periodRows, group.rowPlan),
      plan: group.rowPlan,
    });
    expect(Object.keys(placed.inGrid)).toEqual([`${labs[0]!.order}:thu`]);
    expect(placed.extraRows).toEqual([]);
    // 🔴 카드 칸은 그대로 비어 있다 — *LAB은 카드 데이터에 섞이지 않는다.
    expect(card.cells[`${labs[0]!.order}:thu`]).toBeUndefined();
  });

  it("🔴 섹션에 그 교시 행이 없으면 **그 카드에만** 추가 행 — 섹션 교시축은 늘지 않는다", () => {
    const group = buildRichCardGroups(le1Thu() as unknown as GridSlot[], C)[0]!;
    const before = group.periodRows.map((r) => r.order);
    const card = group.cards[0]!;
    const labs = build({ pins: [pin()] }).LE1!;
    const placed = placeVirtualLabs({
      labs,
      cells: card.cells,
      rows: visibleSpanRows(group.periodRows, group.rowPlan),
      plan: group.rowPlan,
    });
    expect(placed.inGrid).toEqual({});
    expect(placed.extraRows).toEqual([{ start: "17:00", cells: { thu: labs[0] } }]);
    expect(group.periodRows.map((r) => r.order)).toEqual(before);
    expect(before).not.toContain(labs[0]!.order);
  });

  const lab = (over: Partial<VirtualLabCell>): VirtualLabCell => ({
    classId: "LE1",
    dayOfWeek: "thu",
    date: REF,
    start: "17:00",
    order: 1020,
    students: [],
    note: "",
    ...over,
  });

  it("그 칸에 이미 그 반 수업이 있으면 덮지 않고 추가 행으로", () => {
    const placed = placeVirtualLabs({
      labs: [lab({})],
      cells: { "1020:thu": { label: "Daniella", isLab: false } },
      rows: [{ order: 980 }, { order: 1020 }],
    });
    expect(placed.inGrid).toEqual({});
    expect(placed.extraRows.map((r) => r.start)).toEqual(["17:00"]);
  });

  it("이 카드의 접힌 칸(60분 수업을 40분 눈금 1.5칸)이 그 행을 지나가면 덮지 않는다 — 다른 요일은 그대로 격자 안", () => {
    const plan = { hidden: [950], moved: { "950": { order: 900, offset: 0.5, span: 1.5 } } };
    const placed = placeVirtualLabs({
      labs: [lab({ order: 940 }), lab({ order: 940, dayOfWeek: "tue" })],
      cells: { "950:thu": { label: "Flor", isLab: false } },
      rows: [{ order: 900 }, { order: 940 }, { order: 980 }],
      plan,
    });
    expect(Object.keys(placed.inGrid)).toEqual(["940:tue"]);
    expect(placed.extraRows).toHaveLength(1);
    expect(placed.extraRows[0]!.cells.thu).toBeDefined();
  });

  it("주말(order=null)은 격자에 앉히지 않는다 · 추가 행은 시작 시각 하나에 한 줄, 시작순", () => {
    const placed = placeVirtualLabs({
      labs: [
        lab({ start: "17:40", order: 1060 }),
        lab({ start: "17:00", order: 1020, dayOfWeek: "tue" }),
        lab({ start: "17:00", order: 1020 }),
        lab({ start: "11:00", order: null, dayOfWeek: "sat" }),
      ],
      cells: {},
      rows: [{ order: 900 }],
    });
    expect(placed.inGrid).toEqual({});
    expect(placed.extraRows.map((r) => r.start)).toEqual(["11:00", "17:00", "17:40"]);
    expect(Object.keys(placed.extraRows[1]!.cells).sort()).toEqual(["thu", "tue"]);
  });

  it("칸이 없으면 빈 배치(참조 그대로)", () => {
    const empty = placeVirtualLabs({ labs: [], cells: {}, rows: [] });
    expect(empty.inGrid).toEqual({});
    expect(empty.extraRows).toEqual([]);
  });
});

describe("borrowFromRoster — 카드에만 더한 행의 높이", () => {
  it("재원 칸의 **남는 자리만큼만** 빌린다 — 명단이 잘려 사람이 가려지면 안 된다", () => {
    expect(borrowFromRoster({ extraH: 32, sectionH: 268, usedH: 86 })).toBe(32);
    expect(borrowFromRoster({ extraH: 64, sectionH: 268, usedH: 240 })).toBe(28);
    expect(borrowFromRoster({ extraH: 32, sectionH: 268, usedH: 300 })).toBe(0);
    // 명단 접힘(재원 칸 0) — 빌릴 곳이 없으면 그 카드만 길어진다.
    expect(borrowFromRoster({ extraH: 32, sectionH: 0, usedH: 34 })).toBe(0);
    expect(borrowFromRoster({ extraH: 0, sectionH: 268, usedH: 86 })).toBe(0);
  });
});

describe("표시 서식", () => {
  it("글자는 원장이 부른 그대로 `*LAB` · LAB 칸 계열(파랑) + 점선·이탤릭 = 임시", () => {
    expect(VIRTUAL_LAB_LABEL).toBe("*LAB");
    expect(VIRTUAL_LAB_CELL_CLASS).toContain("text-blue");
    expect(VIRTUAL_LAB_CELL_CLASS).toContain("italic");
    expect(VIRTUAL_LAB_CELL_CLASS).toContain("outline-dashed");
    // 바탕을 칠하지 않는다 — 칠한 LAB 칸(bg-blue-soft)과 한눈에 갈려야 한다.
    expect(VIRTUAL_LAB_CELL_CLASS).not.toMatch(/\bbg-/);
  });
});
