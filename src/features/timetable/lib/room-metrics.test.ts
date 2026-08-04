import { describe, expect, it } from "vitest";
import type { PeriodsConfig } from "./periods";
import { buildRoomBuckets, type RoomInfo, type RoomSlotLite } from "./room-grid";
import {
  buildRoomWeekRows,
  collectRoomConflicts,
  collectSeatOver,
  resolveDayWindows,
  summarizeDay,
  timelineColumnCells,
  utilPct,
  type RoomTimelineCell,
} from "./room-metrics";

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

describe("timelineAxis — 10분 격자 축", () => {
  it("평일은 오전 특강이 창을 넓혀도 14시부터 시작한다", async () => {
    const { timelineAxis } = await import("./room-metrics");
    // 실데이터 모양: 평일 오전 특강(10:00~13:00)이 관측 확장으로 창을 10시까지 끌어내린다.
    const morning = slot({ dayOfWeek: "mon", startTime: "10:00", endTime: "13:00", classId: "special" });
    const w = resolveDayWindows(["math"], CONFIG, [morning]);
    expect(w.mon!.startMin).toBe(10 * 60); // 창 자체는 넓어진 채로 둔다(지도는 정직해야 하므로)
    const axis = timelineAxis(w, "mon");
    expect(axis.startMin).toBe(14 * 60);
    expect(axis.hours.map((h) => h.label)).toEqual(["14~15시", "15~16시"]);
    expect(axis.slots).toBe(12); // 2시간 ÷ 10분
  });

  it("주말은 하한을 적용하지 않는다 — 토요일 오전엔 정규 수업이 실제로 돈다", async () => {
    const { timelineAxis } = await import("./room-metrics");
    const w = resolveDayWindows(["math"], CONFIG, []); // 주말 창 09:00~10:00
    expect(timelineAxis(w, "sat")).toMatchObject({ startMin: 9 * 60, slots: 6 });
  });

  it("창이 14시보다 늦게 시작하면 그 시작을 그대로 쓴다(하한이지 고정값이 아니다)", async () => {
    const { timelineAxis } = await import("./room-metrics");
    const w = resolveDayWindows(["math"], { weekday: { "1": { startTime: "16:00", endTime: "18:00" } }, weekend: {} }, []);
    expect(timelineAxis(w, "mon").hours.map((h) => h.label)).toEqual(["16~17시", "17~18시"]);
  });

  it("하한 뒤로 남는 시간이 없으면 빈 축(표를 안 그린다)", async () => {
    const { timelineAxis } = await import("./room-metrics");
    const w = resolveDayWindows(["math"], { weekday: { "1": { startTime: "10:00", endTime: "12:00" } }, weekend: {} }, []);
    expect(timelineAxis(w, "mon").slots).toBe(0);
  });
});

describe("buildRoomTimelineRows — 수업 시간대로 병합", () => {
  it("80분 수업(15:00~16:20)은 10분 칸 8개로 병합된다", async () => {
    const { buildRoomTimelineRows } = await import("./room-metrics");
    const { buckets } = buildRoomBuckets(
      [slot({ dayOfWeek: "mon", startTime: "15:00", endTime: "16:20", students: 7 })],
      ROOMS,
    );
    // 창을 16:20까지 넓히려 관측 확장을 태운다(교시표는 16:00까지라 그대로면 잘린다).
    const w = resolveDayWindows(["math"], CONFIG, [
      slot({ dayOfWeek: "mon", startTime: "15:00", endTime: "16:20" }),
    ]);
    const r1 = buildRoomTimelineRows(buckets, w, "mon").rows.find((r) => r.key === "r1")!;
    const cls = r1.cells.find((c) => c.kind === "class")!;
    expect(cls).toMatchObject({ span: 8, students: 7, seatPct: 70, startMin: 15 * 60, endMin: 16 * 60 + 20 });
  });

  it("빈 시간은 gap으로 이어 붙고, 칸 수 합은 축과 정확히 같다(colspan 어긋남 방지)", async () => {
    const { buildRoomTimelineRows } = await import("./room-metrics");
    const { buckets } = buildRoomBuckets(
      [slot({ dayOfWeek: "mon", startTime: "14:30", endTime: "15:00" })],
      ROOMS,
    );
    const w = resolveDayWindows(["math"], CONFIG, []); // 14:00~16:00 = 12칸
    const { axis, rows } = buildRoomTimelineRows(buckets, w, "mon");
    for (const r of rows) {
      expect(r.cells.reduce((n, c) => n + c.span, 0)).toBe(axis.slots);
    }
    const r1 = rows.find((r) => r.key === "r1")!;
    expect(r1.cells.map((c) => [c.kind, c.span])).toEqual([
      ["gap", 3],
      ["class", 3],
      ["gap", 6],
    ]);
  });

  it("같은 시간에 두 반이면 인원이 큰 쪽을 대표로 세운다(좌석 압박을 과소평가하지 않는다)", async () => {
    const { buildRoomTimelineRows } = await import("./room-metrics");
    const { buckets } = buildRoomBuckets(
      [
        slot({ dayOfWeek: "mon", startTime: "14:00", endTime: "15:00", classId: "small", students: 3 }),
        slot({ dayOfWeek: "mon", startTime: "14:00", endTime: "15:00", classId: "big", students: 9 }),
      ],
      ROOMS,
    );
    const w = resolveDayWindows(["math"], CONFIG, []);
    const r1 = buildRoomTimelineRows(buckets, w, "mon").rows.find((r) => r.key === "r1")!;
    const cls = r1.cells.find((c) => c.kind === "class")!;
    expect(cls).toMatchObject({ classId: "big", students: 9, overlap: "joint" });
  });

  it("정원 미입력이면 인원률은 null — 인원은 그대로 보여준다(0%로 속이지 않는다)", async () => {
    const { buildRoomTimelineRows } = await import("./room-metrics");
    const { buckets } = buildRoomBuckets(
      [slot({ dayOfWeek: "mon", startTime: "14:00", endTime: "15:00", roomId: "r2", students: 5 })],
      ROOMS,
    );
    const w = resolveDayWindows(["math"], CONFIG, []);
    const r2 = buildRoomTimelineRows(buckets, w, "mon").rows.find((r) => r.key === "r2")!;
    expect(r2.cells.find((c) => c.kind === "class")).toMatchObject({ students: 5, seatPct: null });
  });

  it("정원을 넘으면 100%를 넘겨 그대로 낸다(초과를 숨기지 않는다)", async () => {
    const { buildRoomTimelineRows } = await import("./room-metrics");
    const { buckets } = buildRoomBuckets(
      [slot({ dayOfWeek: "mon", startTime: "14:00", endTime: "15:00", students: 13 })],
      ROOMS,
    );
    const w = resolveDayWindows(["math"], CONFIG, []);
    const r1 = buildRoomTimelineRows(buckets, w, "mon").rows.find((r) => r.key === "r1")!;
    expect(r1.cells.find((c) => c.kind === "class")).toMatchObject({ seatPct: 130 });
  });

  it("다른 요일 수업은 안 섞인다(선택 요일 절대값)", async () => {
    const { buildRoomTimelineRows } = await import("./room-metrics");
    const { buckets } = buildRoomBuckets(
      [slot({ dayOfWeek: "tue", startTime: "14:00", endTime: "16:00", students: 8 })],
      ROOMS,
    );
    const w = resolveDayWindows(["math"], CONFIG, []);
    const mon = buildRoomTimelineRows(buckets, w, "mon").rows.find((r) => r.key === "r1")!;
    expect(mon.cells).toEqual([{ kind: "gap", span: 12 }]);
  });
});

describe("timelineColumnCells — 축 전환(시간=세로)용 색인", () => {
  it("병합에 덮인 칸은 null(그 자리에 td를 또 그리면 표가 밀린다)", () => {
    const cells = [
      { kind: "gap", span: 2 },
      { kind: "class", span: 3, classId: "c1" },
      { kind: "gap", span: 1 },
    ] as unknown as RoomTimelineCell[];
    const at = timelineColumnCells(cells, 6);
    expect(at.map((c) => (c == null ? "-" : c.kind))).toEqual([
      "gap",
      "gap",
      "class",
      "-",
      "-",
      "gap",
    ]);
    expect(at[2]).toMatchObject({ span: 3, classId: "c1" });
  });

  it("빈 구간은 10분마다 쪼갠다(통째 병합하면 그 구간에 눈금이 안 남는다)", () => {
    const at = timelineColumnCells([{ kind: "gap", span: 4 }] as RoomTimelineCell[], 4);
    expect(at).toEqual([
      { kind: "gap", span: 1 },
      { kind: "gap", span: 1 },
      { kind: "gap", span: 1 },
      { kind: "gap", span: 1 },
    ]);
  });

  it("길이는 항상 격자 칸 수 — 축 끝을 넘는 셀은 잘라낸다(행 수와 어긋나지 않게)", () => {
    const at = timelineColumnCells(
      [{ kind: "gap", span: 2 }, { kind: "class", span: 5, classId: "c1" }] as unknown as RoomTimelineCell[],
      4,
    );
    expect(at).toHaveLength(4);
    expect(at.filter(Boolean)).toHaveLength(3);
  });

  it("실데이터 경로 — 15:00~16:20 수업 한 개는 시작 칸에만 서고 span 8을 유지", async () => {
    const { buildRoomTimelineRows } = await import("./room-metrics");
    const s = slot({ dayOfWeek: "mon", startTime: "15:00", endTime: "16:20", students: 8 });
    const { buckets } = buildRoomBuckets([s], ROOMS);
    // 창을 수업까지 넓혀서(관측 확장) 80분이 통째로 축 안에 들어오게 — 잘린 창은 위 케이스가 따로 본다.
    const w = resolveDayWindows(["math"], CONFIG, [s]);
    const { axis, rows } = buildRoomTimelineRows(buckets, w, "mon");
    const at = timelineColumnCells(rows.find((r) => r.key === "r1")!.cells, axis.slots);
    const starts = at.filter((c) => c?.kind === "class");
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ span: 8 });
    // 병합 뒤 8칸 중 시작 1칸만 td가 서고 나머지 7칸은 비어 있다.
    expect(at.filter((c) => c == null)).toHaveLength(7);
  });
});

describe("collectRoomConflicts — 하단 '시간 겹침' 반 목록(주간)", () => {
  it("부분 겹침만 잡고, 합반(완전 동일 범위)은 안 잡는다 — 요약의 '건수'와 같은 술어", () => {
    const { buckets } = buildRoomBuckets(
      [
        // 부분 겹침(이중예약 의심) — 15:00~16:00 ∩ 15:30~16:30
        slot({ id: "a", classId: "c1", className: "중등M 중1", startTime: "15:00", endTime: "16:00" }),
        slot({ id: "b", classId: "c2", className: "중등M 중2", startTime: "15:30", endTime: "16:30" }),
        // 합반 — 완전 동일 범위라 겹침이 아니다
        slot({ id: "c", classId: "c3", className: "합반A", roomId: "r2", startTime: "15:00", endTime: "16:00" }),
        slot({ id: "d", classId: "c4", className: "합반B", roomId: "r2", startTime: "15:00", endTime: "16:00" }),
      ],
      ROOMS,
    );
    const rows = collectRoomConflicts(buckets);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.roomName).toBe("본원301");
    expect(rows[0]!.classes.map((c) => c.className)).toEqual(["중등M 중1", "중등M 중2"]);
    // 줄이 말하는 시각 = 두 반이 **실제로 같은 방에 있는** 교집합(15:30~16:00).
    expect([rows[0]!.startMin, rows[0]!.endMin]).toEqual([930, 960]);
  });

  it("요약의 conflictPairs와 목록 길이가 절대 어긋나지 않는다(같은 술어 회귀 가드)", () => {
    const slots = [
      slot({ id: "a", classId: "c1", startTime: "15:00", endTime: "16:00" }),
      slot({ id: "b", classId: "c2", startTime: "15:30", endTime: "16:30" }),
      slot({ id: "c", classId: "c3", startTime: "15:40", endTime: "17:00" }),
    ];
    const { buckets } = buildRoomBuckets(slots, ROOMS);
    const w = resolveDayWindows(["math"], CONFIG, slots);
    expect(collectRoomConflicts(buckets)).toHaveLength(summarizeDay(buckets, w, "mon", 0).conflictPairs);
  });

  it("요일을 넘나들며 모은다(요일 칩을 안 따라간다) + 요일·시각 순 정렬", () => {
    const { buckets } = buildRoomBuckets(
      [
        slot({ id: "a", classId: "c1", dayOfWeek: "wed", startTime: "15:00", endTime: "16:00" }),
        slot({ id: "b", classId: "c2", dayOfWeek: "wed", startTime: "15:30", endTime: "16:30" }),
        slot({ id: "c", classId: "c3", dayOfWeek: "mon", startTime: "14:00", endTime: "15:00" }),
        slot({ id: "d", classId: "c4", dayOfWeek: "mon", startTime: "14:30", endTime: "15:30" }),
      ],
      ROOMS,
    );
    expect(collectRoomConflicts(buckets).map((r) => r.day)).toEqual(["mon", "wed"]);
  });
});

describe("collectSeatOver — 하단 '정원 초과' 반 목록(주간)", () => {
  it("정원이 있는 방만, 넘은 반만 — 초과 폭이 큰 순", () => {
    const { buckets } = buildRoomBuckets(
      [
        slot({ id: "a", classId: "c1", className: "1명 초과", students: 11, startTime: "14:00", endTime: "15:00" }),
        slot({ id: "b", classId: "c2", className: "5명 초과", students: 15, startTime: "15:00", endTime: "16:00" }),
        slot({ id: "c", classId: "c3", className: "딱 정원", students: 10, startTime: "16:00", endTime: "17:00" }),
        // 정원 미입력(r2)은 판정 대상이 아니다 — 0으로 속이지 않는다.
        slot({ id: "d", classId: "c4", className: "정원없는방", students: 99, roomId: "r2" }),
      ],
      ROOMS,
    );
    const rows = collectSeatOver(buckets);
    expect(rows.map((r) => r.className)).toEqual(["5명 초과", "1명 초과"]);
    expect(rows[0]).toMatchObject({ roomName: "본원301", capacity: 10, students: 15, classId: "c2" });
  });

  it("반을 짚어 준다(수업 상세 링크의 근거) — classId가 비면 링크가 거짓말이 된다", () => {
    const { buckets } = buildRoomBuckets(
      [slot({ id: "a", classId: "c9", className: "고등M 고1", students: 12 })],
      ROOMS,
    );
    expect(collectSeatOver(buckets)[0]!.classId).toBe("c9");
  });
});
