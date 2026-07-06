import { describe, expect, it } from "vitest";
import { cellClassKey, computeBlocks } from "./grid";
import {
  breakBlocksForColumn,
  buildClassIntervals,
  buildCoveringRows,
  buildSlotIntervals,
  buildTenMinuteRows,
  packGroups,
  parseBreakRanges,
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

describe("stepMin — 격자 단위 파라미터화(과목 설정 teacherViewStep)", () => {
  it("step 20 폴백 프레임 → 23행, 20분 간격, 첫 행 14:20", () => {
    const rows = buildTenMinuteRows([], undefined, 20);
    expect(rows).toHaveLength(23); // 14:20~22:00 = 460분 / 20
    expect(rows[0]!.key).toBe("14:20");
    expect(rows[1]!.startMin - rows[0]!.startMin).toBe(20);
  });

  it("step 30 축 스냅: 14:20은 30의 배수가 아님 → lo=14:00으로 내림, 전 행 :00/:30 정렬(정수 인덱스 불변식)", () => {
    const rows = buildTenMinuteRows([], undefined, 30);
    expect(rows[0]!.key).toBe("14:00"); // 860 → 840 스냅
    for (const r of rows) expect(r.startMin % 30).toBe(0);
    const span = slotRowSpan(rows, "15:00", "16:00");
    expect(Number.isInteger(span.index)).toBe(true);
    expect(span).toEqual({ index: 2, span: 2 }); // 14:00 기준 15:00=2행째, 60분=2행
  });

  it("slotRowSpan은 rows에서 step 추론(인자 불변) — 30분 축에서 바깥 라운딩", () => {
    const rows = buildTenMinuteRows([], undefined, 30);
    expect(slotRowSpan(rows, "16:20", "17:00")).toEqual({ index: 4, span: 2 }); // 16:00~17:00로 라운딩
  });

  it("buildSlotIntervals step 30 바깥 라운딩", () => {
    const iv = buildSlotIntervals([slot("16:20", "17:00")], 30);
    expect(iv[0]).toMatchObject({ startMin: 960, endMin: 1020 }); // 16:00~17:00
  });

  it("기본값(step 10) 회귀 카나리 — 46행·14:20 시작(기존 동작 그대로)", () => {
    const rows = buildTenMinuteRows([]);
    expect(rows).toHaveLength(46);
    expect(rows[0]!.key).toBe("14:20");
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

describe("buildSlotIntervals — 슬롯=구간 1:1 (시트 셀 미러, 접기 없음)", () => {
  it("back-to-back 같은 반(2교시 연결 수업) → 시트처럼 구간 2개 유지", () => {
    // 시트는 한 수업의 연결 교시를 교시별 셀로 쪼개 그린다(검은 교시선) — 2026-07-06 사용자 지정.
    const iv = buildSlotIntervals([slot("16:20", "17:20"), slot("17:20", "18:10")]);
    expect(iv).toHaveLength(2);
    expect(iv[0]).toMatchObject({ startMin: 980, endMin: 1040 });
    expect(iv[1]).toMatchObject({ startMin: 1040, endMin: 1090 });
  });

  it("동일 (반,시각) 중복 슬롯만 병합", () => {
    const iv = buildSlotIntervals([slot("15:00", "15:40"), slot("15:00", "15:40")]);
    expect(iv).toHaveLength(1);
    expect(iv[0]!.slots).toHaveLength(2);
  });

  it("packGroups와 조합: 연결 2교시 수업 = 같은 레인에 셀 2개(laneCount 1)", () => {
    const { groups, laneCount } = packGroups(
      buildSlotIntervals([slot("16:20", "17:20"), slot("17:20", "18:10")]),
    );
    expect(groups).toHaveLength(2);
    for (const g of groups) expect(g).toMatchObject({ laneStart: 0, laneWidth: 1 });
    expect(laneCount).toBe(1);
  });
});

describe("parseBreakRanges — 쉬는 시간 설정 파싱·격자 스냅", () => {
  it("정상 범위 → 분 범위, step 10에선 스냅 무변", () => {
    expect(parseBreakRanges([{ start: "18:10", end: "18:20" }])).toEqual([
      { startMin: 1090, endMin: 1100 },
    ]);
  });

  it("역전·동일시각·형식오류 제외(길이≤0)", () => {
    expect(parseBreakRanges([{ start: "18:20", end: "18:10" }])).toEqual([]);
    expect(parseBreakRanges([{ start: "18:10", end: "18:10" }])).toEqual([]);
    expect(parseBreakRanges([{ start: "??", end: "18:20" }])).toEqual([]);
    expect(parseBreakRanges(undefined)).toEqual([]);
  });

  it("step 30 스냅: 18:10~18:20 → 18:00~18:30(바깥 라운딩)", () => {
    expect(parseBreakRanges([{ start: "18:10", end: "18:20" }], 30)).toEqual([
      { startMin: 1080, endMin: 1110 },
    ]);
  });
});

describe("breakBlocksForColumn — 앞뒤 수업 붙은 컬럼에만 쉬는 시간", () => {
  const rows = buildTenMinuteRows([]); // 14:20~22:00, step 10
  const iv = (startMin: number, endMin: number, classId = "c") => ({
    classId,
    startMin,
    endMin,
    slots: [],
  });
  const brk = [{ startMin: 1090, endMin: 1100 }]; // 18:10~18:20

  it("앞(끝=18:10)+뒤(시작=18:20) 수업이 둘 다 있으면 블록 렌더", () => {
    const out = breakBlocksForColumn(rows, [iv(1030, 1090, "a"), iv(1100, 1160, "b")], brk);
    expect(out).toEqual([{ index: 23, span: 1, startMin: 1090, endMin: 1100 }]); // (1090-860)/10=23
  });

  it("앞만 있으면(뒤 수업 없음) 미표시", () => {
    expect(breakBlocksForColumn(rows, [iv(1030, 1090, "a")], brk)).toEqual([]);
  });

  it("뒤만 있으면(앞 수업 없음) 미표시", () => {
    expect(breakBlocksForColumn(rows, [iv(1100, 1160, "b")], brk)).toEqual([]);
  });

  it("범위와 겹치는 수업 있으면 미표시(수업 중이라 쉬는 시간 아님)", () => {
    // 앞뒤 수업 조건은 만족하되 범위를 가로지르는 수업(18:00~18:30)이 있으면 제외
    const out = breakBlocksForColumn(
      rows,
      [iv(1030, 1090, "a"), iv(1100, 1160, "b"), iv(1080, 1110, "c")],
      brk,
    );
    expect(out).toEqual([]);
  });

  it("붙지 않은 앞뒤(공백)면 미표시 — 앞 수업이 18:00에 끝나면 18:10과 불일치", () => {
    expect(breakBlocksForColumn(rows, [iv(1030, 1080, "a"), iv(1100, 1160, "b")], brk)).toEqual([]);
  });

  it("축 범위 밖 쉬는 시간은 제외", () => {
    // 폴백 축 14:20~22:00, 23:00~23:10 범위는 축 밖
    const out = breakBlocksForColumn(
      rows,
      [iv(1030, 1090, "a"), iv(1100, 1160, "b")],
      [{ startMin: 1380, endMin: 1390 }],
    );
    expect(out).toEqual([]);
  });

  it("여러 교시 걸친 쉬는 시간(span>1) — 18:10~18:30", () => {
    const out = breakBlocksForColumn(rows, [iv(1030, 1090, "a"), iv(1110, 1160, "b")], [
      { startMin: 1090, endMin: 1110 },
    ]);
    expect(out).toEqual([{ index: 23, span: 2, startMin: 1090, endMin: 1110 }]);
  });

  // ⚠️ 다중 레인(LAB) 불변식 — 어느 레인이든 범위에 겹치는 수업이 있으면 억제(수업 안 사라짐·이중 td 방지).
  it("한 레인은 앞뒤 붙었어도 다른 레인 수업이 범위에 걸치면 미표시(수업 보존)", () => {
    // 레인0: 앞(끝=18:10)+뒤(시작=18:20) 붙음 / 레인1: 18:10~18:20 병렬 수업 → overlaps=true → 억제
    const out = breakBlocksForColumn(
      rows,
      [iv(1030, 1090, "a0"), iv(1100, 1160, "b0"), iv(1090, 1100, "lab1")],
      brk,
    );
    expect(out).toEqual([]);
  });

  it("수업이 쉬는 시간 '시작'에 딱 시작하면 겹침으로 억제(그룹 앵커 공동행 불가)", () => {
    // 18:10에 시작하는 수업(18:10~19:10)은 [1090,1100) 범위와 겹침 → break 억제 = break/그룹 공동 앵커 원천 차단
    expect(
      breakBlocksForColumn(rows, [iv(1030, 1090, "a"), iv(1090, 1150, "starts-at-break")], brk),
    ).toEqual([]);
  });

  it("수업이 쉬는 시간 '끝'에 딱 끝나면 겹침으로 억제", () => {
    // 18:20에 끝나는 수업(18:00~18:20)은 범위와 겹침 → 억제
    expect(
      breakBlocksForColumn(rows, [iv(1080, 1100, "ends-at-break-end"), iv(1100, 1160, "b")], brk),
    ).toEqual([]);
  });
});
