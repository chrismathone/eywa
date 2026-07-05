import { describe, expect, it } from "vitest";
import { cellClassKey, computeBlocks } from "./grid";
import {
  assignLanes,
  buildClassIntervals,
  buildCoveringRows,
  buildTenMinuteRows,
  packGroups,
  slotRowSpan,
  timeToMin,
} from "./ten-minute-grid";

const slot = (startTime: string, endTime: string, classId = "c1") => ({ startTime, endTime, classId });

describe("buildTenMinuteRows", () => {
  it("빈 슬롯 → 폴백 프레임 46행(14:20~22:00), isHour는 정시에만", () => {
    const rows = buildTenMinuteRows([]);
    expect(rows).toHaveLength(46);
    expect(rows[0]!.key).toBe("14:20");
    expect(rows[rows.length - 1]!.key).toBe("21:50");
    expect(rows[0]!.isHour).toBe(false); // 14:20
    const hours = rows.filter((r) => r.isHour).map((r) => r.key);
    expect(hours).toEqual(["15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"]);
  });

  it("데이터가 폴백 안이면 폴백이 이긴다(빈 주에도 시트 프레임)", () => {
    const rows = buildTenMinuteRows([slot("15:00", "15:40")]);
    expect(rows).toHaveLength(46);
  });

  it("범위 밖 슬롯은 바깥쪽 라운딩으로 축 확장", () => {
    const rows = buildTenMinuteRows([slot("13:55", "14:05")]);
    expect(rows[0]!.key).toBe("13:50"); // floor(13:55)
    expect(rows).toHaveLength(49); // 13:50~22:00
  });
});

describe("slotRowSpan", () => {
  const rows = buildTenMinuteRows([]);

  it("정렬 시각 정밀: 15:00~15:40=span4 · 17:20~18:10=span5 · 21:10~22:00=마지막까지 span5", () => {
    expect(slotRowSpan(rows, "15:00", "15:40")).toEqual({ index: 4, span: 4 });
    expect(slotRowSpan(rows, "17:20", "18:10")).toEqual({ index: 18, span: 5 });
    const last = slotRowSpan(rows, "21:10", "22:00");
    expect(last).toEqual({ index: 41, span: 5 });
    expect(last.index + last.span).toBe(rows.length);
  });

  it("HH:MM:SS 허용(DB time 문자열)", () => {
    expect(slotRowSpan(rows, "15:00:00", "15:40:00")).toEqual({ index: 4, span: 4 });
  });

  it("방어: 비정렬 내림/올림 · 역전 · 동일시각 · 파싱실패 — throw 없이 span≥1", () => {
    expect(slotRowSpan(rows, "15:05", "15:35")).toEqual({ index: 4, span: 4 }); // floor/ceil
    expect(slotRowSpan(rows, "15:40", "15:00").span).toBeGreaterThanOrEqual(1); // 역전
    expect(slotRowSpan(rows, "15:00", "15:00").span).toBe(1); // zero-length
    expect(slotRowSpan(rows, "잘못됨", "??").span).toBeGreaterThanOrEqual(1); // 파싱 실패
  });

  it("클램프: 축 범위 밖 시각은 경계로", () => {
    const r = slotRowSpan(rows, "13:00", "23:30");
    expect(r.index).toBe(0);
    expect(r.index + r.span).toBe(rows.length);
  });
});

describe("buildCoveringRows — half-open 피복", () => {
  const rows = buildTenMinuteRows([]);

  it("15:00~15:40 슬롯은 15:00·15:10·15:20·15:30 행만 덮는다(15:40 미포함)", () => {
    const covering = buildCoveringRows(rows, [slot("15:00", "15:40")]);
    const coveredKeys = rows.filter((_, i) => covering[i]!.length > 0).map((r) => r.key);
    expect(coveredKeys).toEqual(["15:00", "15:10", "15:20", "15:30"]);
  });
});

describe("computeBlocks 통합 — 시트식 세로 병합", () => {
  const rows = buildTenMinuteRows([]);
  const keysOf = (slots: ReturnType<typeof slot>[]) => {
    const covering = buildCoveringRows(rows, slots);
    return covering.map((cs) => cellClassKey(cs.map((s) => s.classId)));
  };

  it("back-to-back 동일 반(15:00~15:40 + 15:40~16:20) → rowSpan 8 단일 블록", () => {
    const keys = keysOf([slot("15:00", "15:40"), slot("15:40", "16:20")]);
    const blocks = computeBlocks(rows.length, 1, (ri) => keys[ri]!, false);
    expect(blocks.get("4:0")).toMatchObject({ rowSpan: 8 });
    expect(blocks.get("5:0")).toBeUndefined(); // 피복 행은 맵에 없음
  });

  it("갭 있는 동일 반(15:00~15:40 / 16:00~16:40) → 블록 2개(사이 빈 1×1)", () => {
    const keys = keysOf([slot("15:00", "15:40"), slot("16:00", "16:40")]);
    const blocks = computeBlocks(rows.length, 1, (ri) => keys[ri]!, false);
    expect(blocks.get("4:0")).toMatchObject({ rowSpan: 4 });
    expect(blocks.get("10:0")).toMatchObject({ rowSpan: 4 }); // 16:00
    expect(blocks.get("8:0")).toMatchObject({ rowSpan: 1 }); // 15:40 빈 행
  });

  it("동일 길이 병렬(LAB: 3반 18:20~19:20) → 단일 블록 rowSpan 6", () => {
    const keys = keysOf([
      slot("18:20", "19:20", "c1"),
      slot("18:20", "19:20", "c2"),
      slot("18:20", "19:20", "c3"),
    ]);
    const blocks = computeBlocks(rows.length, 1, (ri) => keys[ri]!, false);
    expect(blocks.get("24:0")).toMatchObject({ rowSpan: 6 }); // 18:20 = index 24
  });

  it("부분 겹침(c1 16:20~17:00 + c2 16:20~17:20) → 블록 분할 — v1 수용 동작 고정", () => {
    // 반세트 키가 중간에 바뀌므로 c2 chip이 두 블록에 반복 표시된다(단일 컬럼 rowSpan 모델의
    // 수학적 한계 — 시트는 서브컬럼이라 미발생). v2(서브컬럼 분할) 전까지 이 동작이 명세.
    const keys = keysOf([slot("16:20", "17:00", "c1"), slot("16:20", "17:20", "c2")]);
    const blocks = computeBlocks(rows.length, 1, (ri) => keys[ri]!, false);
    expect(blocks.get("12:0")).toMatchObject({ rowSpan: 4 }); // 16:20~17:00 {c1,c2}
    expect(blocks.get("16:0")).toMatchObject({ rowSpan: 2 }); // 17:00~17:20 {c2}
  });
});

describe("timeToMin", () => {
  it("HH:MM / HH:MM:SS / 실패", () => {
    expect(timeToMin("14:20")).toBe(860);
    expect(timeToMin("14:20:00")).toBe(860);
    expect(timeToMin("bogus")).toBeNull();
  });
});

describe("packGroups — 같은 시간 병렬 = 한 그룹(합반 묶음)", () => {
  it("동시·동일 범위 3반 → 그룹 1개(laneWidth 3) — 낱개 레인 흩어짐 없음", () => {
    const { groups, laneCount } = packGroups(
      buildClassIntervals([
        slot("14:20", "15:00", "LT2"),
        slot("14:20", "15:00", "KW6"),
        slot("14:20", "15:00", "PJ5"),
      ]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ laneStart: 0, laneWidth: 3 });
    expect(groups[0]!.intervals.map((i) => i.classId)).toEqual(["KW6", "LT2", "PJ5"]);
    expect(laneCount).toBe(3);
  });

  it("순차 수업(겹침 없음) → 그룹들 전부 lane 0, laneCount 1", () => {
    const { groups, laneCount } = packGroups(
      buildClassIntervals([slot("14:20", "15:00", "c1"), slot("15:00", "15:40", "c2")]),
    );
    expect(groups).toHaveLength(2);
    for (const g of groups) expect(g).toMatchObject({ laneStart: 0, laneWidth: 1 });
    expect(laneCount).toBe(1);
  });

  it("다른 길이 겹침(JJ 월: 40분 합반 2반 + 60분 단독) → 그룹 2개, 레인 분리", () => {
    const { groups, laneCount } = packGroups(
      buildClassIntervals([
        slot("16:20", "17:00", "sky"),
        slot("16:20", "17:00", "bridgeC"),
        slot("16:20", "17:20", "top"),
      ]),
    );
    expect(groups).toHaveLength(2);
    const pair = groups.find((g) => g.laneWidth === 2)!;
    const solo = groups.find((g) => g.laneWidth === 1)!;
    expect(pair.laneStart).toBe(0);
    expect(solo.laneStart).toBe(2); // 합반이 0-1 점유 → 단독은 2
    expect(laneCount).toBe(3);
  });

  it("앞 그룹 종료 후 레인 재사용", () => {
    const { groups, laneCount } = packGroups(
      buildClassIntervals([
        slot("14:20", "15:00", "a"),
        slot("14:20", "15:00", "b"),
        slot("15:00", "15:40", "c"),
      ]),
    );
    expect(groups.find((g) => g.intervals[0]!.classId === "c")).toMatchObject({ laneStart: 0, laneWidth: 1 });
    expect(laneCount).toBe(2);
  });

  it("빈 입력 → 그룹 0, laneCount 1(빈 요일 프레임)", () => {
    expect(packGroups([])).toEqual({ groups: [], laneCount: 1 });
  });
});

describe("buildClassIntervals — 반별 구간 접기", () => {
  it("back-to-back 같은 반(15:00~15:40 + 15:40~16:20) → 구간 1개(15:00~16:20)", () => {
    const iv = buildClassIntervals([slot("15:00", "15:40"), slot("15:40", "16:20")]);
    expect(iv).toHaveLength(1);
    expect(iv[0]).toMatchObject({ classId: "c1", startMin: 900, endMin: 980 });
    expect(iv[0]!.slots).toHaveLength(2);
  });

  it("갭 있는 같은 반(14:20~15:00 / 16:20~17:00) → 별도 구간 2개(레인 재사용 가능)", () => {
    const iv = buildClassIntervals([slot("14:20", "15:00"), slot("16:20", "17:00")]);
    expect(iv).toHaveLength(2);
  });

  it("다른 반은 겹쳐도 구간 분리", () => {
    const iv = buildClassIntervals([slot("15:00", "15:40", "c1"), slot("15:00", "15:40", "c2")]);
    expect(iv).toHaveLength(2);
  });
});

describe("assignLanes — 그리디 레인 배정(시트 LAB 서브컬럼)", () => {
  it("겹침 없는 순차 수업 → 레인 1개(일반 강사 컬럼 무변)", () => {
    const lanes = assignLanes(
      buildClassIntervals([slot("14:20", "15:00", "c1"), slot("15:00", "15:40", "c2"), slot("16:20", "17:00", "c3")]),
    );
    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toHaveLength(3);
  });

  it("동시 병렬 3반(이주희 월 14:20 LT2·KW6·PJ5) → 레인 3개", () => {
    const lanes = assignLanes(
      buildClassIntervals([
        slot("14:20", "15:00", "LT2"),
        slot("14:20", "15:00", "KW6"),
        slot("14:20", "15:00", "PJ5"),
        slot("15:00", "15:40", "DP5"), // 뒤 단독 수업은 첫 레인 재사용
      ]),
    );
    expect(lanes).toHaveLength(3);
    expect(lanes[0]!.map((iv) => iv.classId)).toEqual(["LT2", "DP5"]);
  });

  it("부분 겹침(c1 16:20~17:00 + c2 16:20~17:20) → 레인 2개 — 칩 반복 없이 나란히", () => {
    const lanes = assignLanes(
      buildClassIntervals([slot("16:20", "17:00", "c1"), slot("16:20", "17:20", "c2")]),
    );
    expect(lanes).toHaveLength(2);
  });

  it("레인 안 구간은 서로 안 겹친다(불변식)", () => {
    const lanes = assignLanes(
      buildClassIntervals([
        slot("14:20", "15:00", "a"),
        slot("14:20", "15:40", "b"),
        slot("15:00", "15:40", "c"),
        slot("15:40", "16:20", "d"),
      ]),
    );
    for (const lane of lanes) {
      for (let i = 1; i < lane.length; i++) {
        expect(lane[i]!.startMin).toBeGreaterThanOrEqual(lane[i - 1]!.endMin);
      }
    }
  });

  it("빈 입력 → 빈 레인 1개(빈 요일 컬럼 프레임 유지)", () => {
    expect(assignLanes([])).toEqual([[]]);
  });
});
