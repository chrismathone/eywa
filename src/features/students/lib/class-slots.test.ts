import { describe, expect, it } from "vitest";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import {
  buildClassSlots,
  filterLabSeparateRows,
  liveScheduleRows,
  roomBookOf,
  slotRoomName,
  type ScheduleRow,
} from "./class-slots";

/**
 * 🔴 픽스처 = **실제 등록 강의실**(injaewon 2026-09-11 조회 22개 중 일부, 바른602는 보관) — 지어낸 이름으로
 *    잠그면 표가 실제와 어긋나도 초록으로 통과한다.
 */
const ROOMS = [
  { id: "r601", name: "본원601" },
  { id: "r602", name: "본원602" },
  { id: "r603", name: "본원603" },
  { id: "r606", name: "본원606" },
  { id: "r301", name: "본원301" },
  { id: "r305", name: "본원305" },
  { id: "r203", name: "본원203" },
  { id: "b602", name: "바른602" },
];
const BOOK = roomBookOf(ROOMS);

describe("slotRoomName — 좌석표·ECS·오늘 출결과 같은 규칙(FK 이름 → 라벨 정정 → 반 기본)", () => {
  it("🔴 FK가 있으면 FK 이름 — 시트 라벨 `606`이 아니라 반 수정 폼이 고른 `본원606`(실측 이도윤B PL1b 월 14:20)", () => {
    expect(slotRoomName({ roomId: "r606", roomLabel: "606" }, "본원603", BOOK)).toBe("본원606");
  });

  it("🔴 라벨과 FK가 다른 방이면 FK가 이긴다(실측 중등E_중1 정규 B 화 19:20 — 라벨 305 / FK 본원301)", () => {
    expect(slotRoomName({ roomId: "r301", roomLabel: "305" }, "본원601", BOOK)).toBe("본원301");
  });

  it("같은 학생·같은 날의 두 표기(`본원602`·`602`)가 한 이름으로 모인다(실측 박세인 LE1 화요일)", () => {
    const a = slotRoomName({ roomId: "r602", roomLabel: "본원602" }, "본원606", BOOK);
    const b = slotRoomName({ roomId: "r602", roomLabel: "602" }, "본원606", BOOK);
    expect([a, b]).toEqual(["본원602", "본원602"]);
  });

  it("FK가 없으면 맨숫자 라벨을 등록 이름으로 맞춘다 — 애매하면(본원602·바른602) 손대지 않는다", () => {
    expect(slotRoomName({ roomId: null, roomLabel: "305" }, null, BOOK)).toBe("본원305");
    expect(slotRoomName({ roomId: null, roomLabel: "602" }, null, BOOK)).toBe("602");
    expect(slotRoomName({ roomId: null, roomLabel: "본원602" }, null, BOOK)).toBe("본원602");
  });

  it("슬롯에 방이 없으면 반 기본 강의실(수학 반 전부가 이 경우) · 그것도 없으면 null — 지어내지 않는다", () => {
    expect(slotRoomName({ roomId: null, roomLabel: null }, "본원203", BOOK)).toBe("본원203");
    expect(slotRoomName({ roomId: null, roomLabel: null }, null, BOOK)).toBeNull();
  });

  it("⚠️ 강의실 목록을 못 받았으면 라벨 그대로 — 표시 전용이라 탭은 산다", () => {
    expect(slotRoomName({ roomId: "r606", roomLabel: "606" }, null, roomBookOf([]))).toBe("606");
  });
});

const row = (p: Partial<ScheduleRow> & Pick<ScheduleRow, "day" | "startTime" | "endTime">): ScheduleRow => ({
  validFrom: null,
  validTo: null,
  roomId: null,
  roomLabel: null,
  teacherId: null,
  teacherLabel: null,
  ...p,
});

// 영어 교시표 일부 — 시작이 같은 두 교시(EiE 40분 / 인재원 60분)가 공존하는 실제 모양(이름은 전부 비움).
const CFG = settingsToPeriodsConfig({
  weekdayPeriods: [],
  weekendPeriods: [],
  subjects: [
    {
      key: "english",
      weekdayPeriods: [
        { label: "", startTime: "14:20", endTime: "15:00" },
        { label: "", startTime: "15:00", endTime: "15:40" },
        { label: "", startTime: "16:20", endTime: "17:00" },
        { label: "", startTime: "16:20", endTime: "17:20" },
      ],
    },
  ],
});
const CTX = {
  subject: "english",
  attendanceDaysKo: [] as string[],
  periodsConfig: CFG,
  classRoomName: "본원603",
  rooms: BOOK,
  labelMap: { Sam: "김태건", Jane: "추민아" },
  userNameById: new Map([["u-choo", "추민아"]]),
};

describe("buildClassSlots — 반 배치 → 학생 탭 슬롯", () => {
  it("교시 담당은 라벨의 표시 이름, 자리(LAB)는 사람 없이 seat, 강의실은 FK 이름, 종료시각까지 싣는다", () => {
    const slots = buildClassSlots(
      [
        row({ day: "mon", startTime: "14:20", endTime: "15:00", roomId: "r606", roomLabel: "606", teacherLabel: "Sam" }),
        row({ day: "mon", startTime: "15:00", endTime: "15:40", roomId: "r603", roomLabel: "603", teacherLabel: "LAB" }),
      ],
      CTX,
    );
    expect(slots).toEqual([
      expect.objectContaining({ day: "mon", startTime: "14:20", endTime: "15:00", teacherName: "김태건", seat: null, room: "본원606" }),
      expect.objectContaining({ day: "mon", startTime: "15:00", endTime: "15:40", teacherName: null, seat: "LAB", room: "본원603" }),
    ]);
  });

  it("라벨이 없으면 슬롯 FK 계정 이름(교시 담당 축 — 반 담임이 아니다)", () => {
    const [s] = buildClassSlots([row({ day: "tue", startTime: "16:20", endTime: "17:20", teacherId: "u-choo" })], CTX);
    expect(s!.teacherName).toBe("추민아");
  });

  it("교시 라벨은 (시작,종료) 짝 — 60분 수업은 `16:20~17:20`(시작만 보면 `16:20~17:00`)", () => {
    const [s] = buildClassSlots([row({ day: "tue", startTime: "16:20", endTime: "17:20" })], CTX);
    expect(s!.periodLabel).toBe("16:20~17:20");
  });

  it("분리등원 — 등원 요일만 남긴다(텍스트 요약 groupSchedule과 같은 규칙)", () => {
    const slots = buildClassSlots(
      [row({ day: "tue", startTime: "16:20", endTime: "17:20" }), row({ day: "wed", startTime: "16:20", endTime: "17:20" })],
      { ...CTX, attendanceDaysKo: ["수"] },
    );
    expect(slots.map((s) => s.day)).toEqual(["wed"]);
  });
});

describe("liveScheduleRows — 기준일 유효 배치만(#88)", () => {
  const old = row({ day: "tue", startTime: "19:20", endTime: "20:10", validFrom: "2026-09-01", validTo: "2026-09-06", roomId: "r601" });
  const cur = row({ day: "tue", startTime: "19:20", endTime: "20:10", validFrom: "2026-09-07", roomId: "r301" });

  it("마감된 옛 행은 빠지고 기준일에 유효한 행만 — valid_to는 그날까지 포함", () => {
    expect(liveScheduleRows([old, cur], "2026-09-11")).toEqual([cur]);
    expect(liveScheduleRows([old, cur], "2026-09-06")).toEqual([old]);
  });

  it("⚠️ 전부 이력뿐이면 전 행 — '시간 미정'으로 거짓 축소하지 않는다", () => {
    expect(liveScheduleRows([old], "2026-09-11")).toEqual([old]);
  });
});

describe("filterLabSeparateRows — *LAB 배정으로 자리 교시를 가른다(원장 2026-09-18)", () => {
  // PL1b 화요일 실배치: 14:20 LAB(일반) · 15:00 강사 교시 · 15:40 *LAB.
  const lab = row({ day: "tue", startTime: "14:20", endTime: "15:00", teacherLabel: "LAB" });
  const lesson = row({ day: "tue", startTime: "15:00", endTime: "15:40", teacherLabel: "Anna" });
  const sep = row({ day: "tue", startTime: "15:40", endTime: "16:20", teacherLabel: "LAB", labSeparate: true });
  const rows = [lab, lesson, sep];

  it("켠 원생은 *LAB만 · 끈 원생은 일반 LAB만 · 강사 교시는 둘 다 그대로", () => {
    expect(filterLabSeparateRows(rows, true)).toEqual([lesson, sep]);
    expect(filterLabSeparateRows(rows, false)).toEqual([lab, lesson]);
  });

  it("🔴 모르면(null) 한 줄도 안 뺀다 — 조회 실패가 수업을 지우지 않게", () => {
    expect(filterLabSeparateRows(rows, null)).toEqual(rows);
  });

  it("🔴 그 날 *LAB이 없으면 그대로 — 켠 원생도 월요일 LAB에 선다", () => {
    // 월요일 LAB + 화요일 *LAB — 가르기는 **요일마다** 따로 본다(월요일은 갈릴 것이 없다).
    const mon = [row({ day: "mon", startTime: "15:00", endTime: "15:40", teacherLabel: "LAB" }), sep];
    expect(filterLabSeparateRows(mon, true)).toEqual(mon);
    // ⚠️ 끈 원생도 그대로다 — 이 픽스처의 화요일엔 갈 **일반 LAB이 없어서**(그 날 자리가 *LAB뿐) 빼지 않는다.
    //    "명단에서 사람이 사라지는 것이 최악"이라는 가드(실측 그런 배치 0건). 일반 LAB이 함께 있으면 위 케이스처럼 빠진다.
    expect(filterLabSeparateRows(mon, false)).toEqual(mon);
  });
});
