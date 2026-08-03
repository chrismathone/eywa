import { describe, expect, it } from "vitest";
import type { PeriodsConfig } from "./periods";
import { buildRoomBuckets, type RoomInfo, type RoomSlotLite } from "./room-grid";
import { buildRoomWeekRows, resolveDayWindows, summarizeDay, utilPct } from "./room-metrics";

const slot = (over: Partial<RoomSlotLite>): RoomSlotLite => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  classId: "c1",
  className: "중등M 중1",
  subject: "math",
  dayOfWeek: "mon",
  startTime: "15:00",
  endTime: "16:00",
  teacherLabel: null,
  students: 8,
  classBgColor: null,
  classTextColor: null,
  isSpecialLecture: false,
  roomId: "r1",
  roomLabel: null,
  ...over,
});

// 평일 14:00~16:00 / 주말 09:00~10:00. 과목 override(sci=13:00 시작)로 합집합 검증.
const CONFIG: PeriodsConfig = {
  weekday: {
    "1": { startTime: "14:00", endTime: "15:00" },
    "2": { startTime: "15:00", endTime: "16:00" },
  },
  weekend: { "1": { startTime: "09:00", endTime: "10:00" } },
  weekdayBySubject: { sci: { "1": { startTime: "13:00", endTime: "14:30" } } },
};

const ROOMS: RoomInfo[] = [
  { id: "r1", name: "본원301", capacity: 10 },
  { id: "r2", name: "본원302", capacity: null },
];

describe("resolveDayWindows", () => {
  it("평일 창 = 데이터에 있는 과목들의 교시표 합집합", () => {
    const w = resolveDayWindows(["math", "sci"], CONFIG, []);
    expect(w.mon).toEqual({ startMin: 13 * 60, endMin: 16 * 60 }); // sci 13:00 ∪ 전역 ~16:00
    expect(w.sat).toEqual({ startMin: 9 * 60, endMin: 10 * 60 });
  });

  it("관측 확장 — 창 밖 수업(아침 특강)이 있으면 그 요일 창을 넓힌다(가동률>100% 방지)", () => {
    const w = resolveDayWindows(["math"], CONFIG, [
      slot({ dayOfWeek: "mon", startTime: "08:00", endTime: "10:00" }),
    ]);
    expect(w.mon).toEqual({ startMin: 8 * 60, endMin: 16 * 60 });
    expect(w.tue).toEqual({ startMin: 14 * 60, endMin: 16 * 60 }); // 다른 요일 불변
  });
});

describe("utilPct", () => {
  it("창 없으면 null(0%로 속이지 않는다), 정수 반올림", () => {
    expect(utilPct(60, null)).toBeNull();
    expect(utilPct(60, { startMin: 0, endMin: 180 })).toBe(33);
  });
});

describe("buildRoomWeekRows", () => {
  it("주중 가동률 = 월~금 점유 합 ÷ 평일 창 합(주말 제외) + 좌석 초과 판정", () => {
    const { buckets } = buildRoomBuckets(
      [
        slot({ dayOfWeek: "mon", startTime: "14:00", endTime: "15:00" }),
        slot({ dayOfWeek: "tue", startTime: "14:00", endTime: "15:00", classId: "c2", students: 12 }),
        slot({ dayOfWeek: "sat", startTime: "09:00", endTime: "10:00", classId: "c3" }),
      ],
      ROOMS,
    );
    const w = resolveDayWindows(["math"], CONFIG, []);
    const rows = buildRoomWeekRows(buckets, w);
    const r1 = rows.find((r) => r.key === "r1")!;
    // 평일 창 = 120분 × 5일 = 600, 점유 = 60 + 60 (토요일 60은 제외)
    expect(r1.weekdayUtilPct).toBe(20);
    expect(r1.days.mon.utilPct).toBe(50);
    expect(r1.days.sat.utilPct).toBe(100);
    expect(r1.maxStudents).toBe(12);
    expect(r1.seatOver).toBe(true); // 정원 10 < 최대 12
    const r2 = rows.find((r) => r.key === "r2")!;
    expect(r2.weekdayUtilPct).toBe(0);
    expect(r2.seatOver).toBe(false); // 정원 미설정은 초과 판정 안 함
  });
});

describe("summarizeDay", () => {
  it("가동률 분모=등록 교실만, 미등록(라벨) 버킷은 겹침·지금 사용엔 반영", () => {
    const { buckets } = buildRoomBuckets(
      [
        slot({ dayOfWeek: "mon", startTime: "14:00", endTime: "16:00" }), // r1 풀가동
        slot({ dayOfWeek: "mon", startTime: "14:00", endTime: "15:00", roomId: null, roomLabel: "LAB", classId: "x1" }),
        slot({ dayOfWeek: "mon", startTime: "14:30", endTime: "15:30", roomId: null, roomLabel: "LAB", classId: "x2" }),
      ],
      ROOMS,
    );
    const w = resolveDayWindows(["math"], CONFIG, []);
    const s = summarizeDay(buckets, w, "mon", 14 * 60 + 10);
    expect(s.roomsTotal).toBe(2);
    expect(s.roomsUsed).toBe(1); // r1만(라벨 버킷은 분모 밖)
    expect(s.dayUtilPct).toBe(50); // 120분 ÷ (120분 × 2실)
    expect(s.conflictPairs).toBe(1); // LAB 부분 겹침
    expect(s.roomsInUseNow).toBe(2); // 14:10 현재 r1 + LAB
  });

  it("수업 없는 요일은 사용 0·겹침 0", () => {
    const { buckets } = buildRoomBuckets([slot({ dayOfWeek: "mon" })], ROOMS);
    const s = summarizeDay(buckets, resolveDayWindows(["math"], CONFIG, []), "wed", 900);
    expect(s.roomsUsed).toBe(0);
    expect(s.conflictPairs).toBe(0);
    expect(s.dayUtilPct).toBe(0);
  });
});
