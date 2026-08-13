import { describe, it, expect } from "vitest";
import { buildRichCardGroups, teacherColor, type GridSlot } from "./class-grid";
import { DEFAULT_PERIODS_CONFIG, settingsToPeriodsConfig } from "./periods";

const C = DEFAULT_PERIODS_CONFIG;

function slot(p: Partial<GridSlot>): GridSlot {
  return {
    classId: "c1",
    className: "PJ2",
    subject: "english",
    dayOfWeek: "mon",
    startTime: "14:20",
    endTime: "15:00",
    teacherName: "Hannah",
    classroomName: "본원604",
    slotTeacherLabel: null,
    slotRoomLabel: null,
    classBgColor: null,
    classTextColor: null,
    students: [],
    ...p,
  };
}

// '1시간 단위'는 섹션별 토글(compactSections=압축할 섹션의 sectionKey 집합). 테스트 편의로 모든 섹션을 압축:
// 비압축으로 한 번 돌려 섹션 키를 얻은 뒤 그 전부를 압축 집합으로 재실행("전 섹션 토글 ON"과 동치).
function compactAll(slots: GridSlot[], config = C) {
  const keys = new Set(buildRichCardGroups(slots, config).map((g) => g.sectionKey));
  return buildRichCardGroups(slots, config, keys);
}

describe("buildRichCardGroups", () => {
  it("반별 카드 + 요일×교시 셀(슬롯 강사/LAB)·요일별 강의실 도출", () => {
    const groups = buildRichCardGroups(
      [
        slot({ dayOfWeek: "mon", startTime: "14:20", slotTeacherLabel: "LAB", slotRoomLabel: "LAB실" }),
        slot({ dayOfWeek: "mon", startTime: "15:00", slotTeacherLabel: "Kristine", slotRoomLabel: null }),
        slot({ dayOfWeek: "thu", startTime: "15:00", slotTeacherLabel: "Zoe", slotRoomLabel: null }),
      ],
      C,
    );
    expect(groups).toHaveLength(1);
    const card = groups[0].cards[0];
    // 14:20=영어 1교시(order=860), 15:00=2교시(order=900)
    expect(card.cells["860:mon"]).toEqual({ label: "LAB", isLab: true });
    expect(card.cells["900:mon"]).toEqual({ label: "Kristine", isLab: false });
    expect(card.cells["900:thu"]).toEqual({ label: "Zoe", isLab: false });
    // 강의실: 자리(LAB) 교시의 방(LAB실)은 **안 싣는다**(원장 2026-08-11) — 셀에 이미 LAB으로 찍힌다.
    // 남는 건 반 기본방(본원604→604)뿐이라 월·목이 같아 단일 표기.
    expect(card.classroomLabel).toBe("604");
    expect(card.classroomLabel).not.toContain("LAB");
    expect(card.classroomLabel).not.toContain("본원");
  });

  it("같은 16:20 시작인 EiE 4교시와 IJW 1교시를 서로 다른 설정 행에 배치", () => {
    const config = settingsToPeriodsConfig({
      weekdayPeriods: [],
      weekendPeriods: [],
      subjects: [
        {
          key: "english",
          weekdayPeriods: [
            { label: "EiE 1교시", startTime: "14:20", endTime: "15:00" },
            { label: "EiE 2교시", startTime: "15:00", endTime: "15:40" },
            { label: "EiE 3교시", startTime: "15:40", endTime: "16:20" },
            { label: "EiE 4교시", startTime: "16:20", endTime: "17:00" },
            { label: "EiE 5교시", startTime: "17:00", endTime: "17:40" },
            { label: "EiE 6교시", startTime: "17:40", endTime: "18:20" },
            { label: "IJW 1교시", startTime: "16:20", endTime: "17:20" },
          ],
        },
      ],
    });
    const groups = buildRichCardGroups(
      [
        slot({ classId: "eie", className: "EiE", startTime: "16:20", endTime: "17:00" }),
        slot({ classId: "ijw", className: "IJW", startTime: "16:20", endTime: "17:20" }),
      ],
      config,
    );

    expect(groups.map((g) => g.label)).toEqual(["EiE 4교시 시작", "IJW 1교시 시작"]);
    expect(groups.flatMap((g) => g.periodRows.map((r) => r.label))).toEqual(["EiE 4교시", "IJW 1교시"]);
    expect(groups.flatMap((g) => g.cards.flatMap((c) => Object.keys(c.cells)))).toEqual([
      "980:mon",
      "980.001:mon",
    ]);
  });

  it("🔴 교시표에 없는 시각의 수업도 행을 받는다 — 셀만 만들고 앉을 자리가 없던 버그", () => {
    // 실측(injaewon 2026-08-11): `[특강]중3-2 개념 완성반` 월화목금 11:00처럼 교시표 밖 시각이 12종 있고,
    // 슬롯이 전부 비표준인 반은 통합뷰 격자가 **빈 칸만** 남았다(셀은 만들어졌는데 그 order의 행이 없었다).
    const offTable = buildRichCardGroups(
      [slot({ classId: "sp", className: "[특강]중3-2", subject: "math", dayOfWeek: "mon", startTime: "11:00" })],
      C,
    );
    const g = offTable[0];
    const cellOrders = Object.keys(g.cards[0].cells).map((k) => Number(k.split(":")[0]));
    // 그 셀이 앉을 행이 축에 **있어야** 한다(= 화면에 그려진다).
    expect(g.periodRows.map((r) => r.order)).toEqual(cellOrders);
    expect(g.periodRows).toHaveLength(1);
  });

  it("자리(LAB·JJ) 교시밖에 없어도 강의실 줄이 깨지지 않는다 — '-'", () => {
    const groups = buildRichCardGroups(
      [
        slot({ dayOfWeek: "mon", startTime: "14:20", slotTeacherLabel: "JJ", slotRoomLabel: "305", classroomName: null }),
      ],
      C,
    );
    expect(groups[0].cards[0].classroomLabel).toBe("-");
  });

  it("슬롯 강사 없으면 반 기본 강사로 셀 채움(수학식 단색)", () => {
    const groups = buildRichCardGroups(
      [slot({ subject: "math", className: "수학A", teacherName: "김선생", startTime: "14:30", slotTeacherLabel: null })],
      C,
    );
    const card = groups[0].cards[0];
    const cell = Object.values(card.cells)[0];
    expect(cell.label).toBe("김선생");
    expect(cell.isLab).toBe(false);
  });

  it("시작 교시별 그룹(평일 기준) + 주말 전용 반은 '주말' 섹션(맨 뒤)", () => {
    const groups = buildRichCardGroups(
      [
        slot({ classId: "a", className: "A", dayOfWeek: "mon", startTime: "14:20" }), // 영어 1교시
        slot({ classId: "b", className: "B", dayOfWeek: "mon", startTime: "15:00" }), // 영어 2교시
        slot({ classId: "w", className: "W", subject: "english", dayOfWeek: "sat", startTime: "09:00", endTime: "10:00" }),
      ],
      C,
    );
    expect(groups[groups.length - 1].label).toBe("주말");
    const weekday = groups.filter((g) => g.label !== "주말");
    expect(weekday.map((g) => g.label)).toEqual(["1교시 시작", "2교시 시작"]);
  });

  it("섹션 축은 실제 쓰는 교시만 + 카드 요일축도 실제 요일만 + 대기/퇴원 높이 동기화(max)", () => {
    const groups = buildRichCardGroups(
      [
        slot({
          classId: "a",
          className: "A",
          dayOfWeek: "mon",
          startTime: "14:20",
          students: [
            { name: "가", grade: "초3", school: "A초", status: "active" },
            { name: "나", grade: "초3", school: "A초", status: "hold" },
          ],
        }),
        slot({ classId: "b", className: "B", dayOfWeek: "tue", startTime: "14:20" }),
      ],
      C,
    );
    const g = groups[0];
    // 그룹 축(집계·폴백용)은 그대로 월~금 — 렌더는 카드별 `days`를 쓴다.
    expect(g.days).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    // 🔴 카드 요일축 = 그 반이 실제 수업하는 요일만(원장 2026-08-11 "수업없는 요일 열도 숨겨버리고").
    expect(g.cards.find((c) => c.classId === "a")!.days).toEqual(["mon"]);
    expect(g.cards.find((c) => c.classId === "b")!.days).toEqual(["tue"]);
    // 🔴 교시 행도 실제 쓰는 것만 — 둘 다 1교시(14:20)뿐이라 한 행.
    expect(g.periodRows.map((p) => p.label)).toEqual(["1교시"]);
    // 명단 행수 = 그룹 내 max (2026-07-27). 대기 1명 → 1행, 퇴원 0명 → 0(섹션 자체를 안 그린다).
    expect(g.rosterRows.hold).toBe(1);
    expect(g.rosterRows.withdrawn).toBe(0);
    expect(g.rosterRows.active).toBe(1);
  });

  it("끝 가까운 섹션도 자기가 쓰는 교시만 — 10교시 시작 → 10교시 한 행", () => {
    const groups = buildRichCardGroups(
      [slot({ classId: "x", className: "X", dayOfWeek: "mon", startTime: "20:20" })], // 영어 10교시(통합 시트)
      C,
    );
    expect(groups[0].periodRows.map((p) => p.label)).toEqual(["10교시"]);
  });

  it("빈 교시 행은 사이·위·아래 **전부** 제거 — 4·6·8 점유면 세 행뿐", () => {
    // 1시간 단위 수업 = 16:20(4교시)·17:20(6교시)·18:20(8교시) → 5·7교시가 빔.
    const oneHour = [
      slot({ dayOfWeek: "mon", startTime: "16:20", endTime: "17:20" }),
      slot({ dayOfWeek: "mon", startTime: "17:20", endTime: "18:20" }),
      slot({ dayOfWeek: "mon", startTime: "18:20", endTime: "19:20" }),
    ];
    // 🔴 예전엔 기본이 5칸 윈도우(4~8 전부)였고 '1시간 단위'를 켜야 5·7이 빠졌다. 이제는 기본이 곧 이것이다.
    expect(buildRichCardGroups(oneHour, C)[0].periodRows.map((p) => p.label)).toEqual([
      "4교시", "6교시", "8교시",
    ]);
    expect(compactAll(oneHour)[0].periodRows.map((p) => p.label)).toEqual(["4교시", "6교시", "8교시"]);
  });

  it("끝단 패딩도 남기지 않는다 — 2026-07-06 '윈도우 컨텍스트 유지' 규약 폐기", () => {
    // 아래 패딩: 1·2·3교시만 점유 → 예전엔 뒤에 빈 4·5교시가 남았다.
    const morning = [
      slot({ dayOfWeek: "mon", startTime: "14:20" }),
      slot({ dayOfWeek: "mon", startTime: "15:00" }),
      slot({ dayOfWeek: "mon", startTime: "15:40" }),
    ];
    expect(buildRichCardGroups(morning, C)[0].periodRows.map((p) => p.label)).toEqual([
      "1교시", "2교시", "3교시",
    ]);
    // 위 패딩: 8·10교시 점유 → 예전엔 위 7·아래 11이 남았다(윈도우 당김).
    const evening = [
      slot({ dayOfWeek: "mon", startTime: "18:20", endTime: "19:20" }),
      slot({ dayOfWeek: "mon", startTime: "20:20", endTime: "21:10" }),
    ];
    expect(buildRichCardGroups(evening, C)[0].periodRows.map((p) => p.label)).toEqual([
      "8교시", "10교시",
    ]);
  });

  it("compact=같은 시작 교시라도 체계 다른 반은 별도 그룹 분리(각 그룹이 자기 축으로 압축·클립 없음)", () => {
    // 1시간 체계 A(4·6·8) + 40분 체계 B(4·5·7) — 같은 '4교시 시작'이지만 서로의 빈 행을 점유.
    const mixed = [
      slot({ classId: "a", className: "A", dayOfWeek: "mon", startTime: "16:20", endTime: "17:20" }),
      slot({ classId: "a", className: "A", dayOfWeek: "mon", startTime: "17:20", endTime: "18:20" }),
      slot({ classId: "a", className: "A", dayOfWeek: "mon", startTime: "18:20", endTime: "19:20" }),
      slot({ classId: "b", className: "B", dayOfWeek: "mon", startTime: "16:20", endTime: "17:00" }),
      slot({ classId: "b", className: "B", dayOfWeek: "mon", startTime: "17:00", endTime: "17:40" }),
      slot({ classId: "b", className: "B", dayOfWeek: "mon", startTime: "17:40", endTime: "18:20" }),
    ];
    // compact 아님 — 한 그룹, 유니언 축(4~8 전부).
    const plain = buildRichCardGroups(mixed, C);
    expect(plain).toHaveLength(1);
    expect(plain[0].periodRows.map((p) => p.label)).toEqual(["4교시", "5교시", "6교시", "7교시", "8교시"]);
    // compact — 두 그룹으로 분리, 각자 사이 빈 행만 숨김(B의 5·7교시 클립 없음).
    const groups = compactAll(mixed);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe("4교시 시작");
    expect(groups[0].cards.map((c) => c.className)).toEqual(["A"]);
    expect(groups[0].periodRows.map((p) => p.label)).toEqual(["4교시", "6교시", "8교시"]);
    expect(groups[1].label).toBe("4교시 시작 ②");
    expect(groups[1].cards.map((c) => c.className)).toEqual(["B"]);
    // B 축: 4·5·7 점유 → 그 세 행만(사이 6도, 아래 8도 없다).
    expect(groups[1].periodRows.map((p) => p.label)).toEqual(["4교시", "5교시", "7교시"]);
  });

  it("compact=같은 체계(부분집합 점유)는 한 그룹 유지 — 과분리 없음", () => {
    const sameChain = [
      slot({ classId: "a", className: "A", dayOfWeek: "mon", startTime: "16:20", endTime: "17:20" }),
      slot({ classId: "a", className: "A", dayOfWeek: "mon", startTime: "17:20", endTime: "18:20" }),
      slot({ classId: "a", className: "A", dayOfWeek: "mon", startTime: "18:20", endTime: "19:20" }), // 4·6·8
      slot({ classId: "b", className: "B", dayOfWeek: "mon", startTime: "16:20", endTime: "17:20" }),
      slot({ classId: "b", className: "B", dayOfWeek: "mon", startTime: "17:20", endTime: "18:20" }), // 4·6
    ];
    const groups = compactAll(sameChain);
    expect(groups).toHaveLength(1);
    expect(groups[0].cards.map((c) => c.className)).toEqual(["A", "B"]);
    expect(groups[0].periodRows.map((p) => p.label)).toEqual(["4교시", "6교시", "8교시"]);
  });

  it("'1시간 단위'는 섹션별 — 고른 섹션만 compacted 플래그가 선다(행 숨김은 이제 항상)", () => {
    const two = [
      slot({ classId: "a", className: "A", dayOfWeek: "mon", startTime: "14:20" }), // 1교시 시작
      slot({ classId: "a", className: "A", dayOfWeek: "mon", startTime: "15:00" }), // 2교시
      slot({ classId: "b", className: "B", dayOfWeek: "mon", startTime: "16:20", endTime: "17:20" }), // 4교시
      slot({ classId: "b", className: "B", dayOfWeek: "mon", startTime: "17:20", endTime: "18:20" }), // 6교시
      slot({ classId: "b", className: "B", dayOfWeek: "mon", startTime: "18:20", endTime: "19:20" }), // 8교시
    ];
    const plain = buildRichCardGroups(two, C);
    const s1 = plain.find((g) => g.label === "1교시 시작")!;
    const s4 = plain.find((g) => g.label === "4교시 시작")!;
    // sectionKey = 시작 교시 order(=자정기준 분): 14:20→860, 16:20→980.
    expect(s1.sectionKey).toBe(860);
    expect(s4.sectionKey).toBe(980);
    // 4교시 시작 섹션만 압축(그 sectionKey만 집합에).
    const groups = buildRichCardGroups(two, C, new Set([s4.sectionKey]));
    const c1 = groups.find((g) => g.label === "1교시 시작")!;
    const c4 = groups.find((g) => g.label === "4교시 시작")!;
    expect(c1.compacted).toBe(false);
    expect(c4.compacted).toBe(true);
    // 행 숨김은 토글과 무관하게 항상 — 토글의 몫은 **교시 체계가 다른 반의 부그룹 분리**뿐이다(위 테스트).
    expect(c1.periodRows.map((p) => p.label)).toEqual(["1교시", "2교시"]);
    expect(c4.periodRows.map((p) => p.label)).toEqual(["4교시", "6교시", "8교시"]);
  });

  it("영문이름·신입/전입은 학생에 보존", () => {
    const groups = buildRichCardGroups(
      [
        slot({
          students: [
            { name: "강민승", grade: "초4", school: "달성초", status: "active", englishName: "Willy", isNew: true },
            { name: "현가현", grade: "초4", school: "종로초", status: "active", isTransferredIn: true },
          ],
        }),
      ],
      C,
    );
    const card = groups[0].cards[0];
    expect(card.active[0].englishName).toBe("Willy");
    expect(card.active.find((s) => s.name === "현가현")?.isTransferredIn).toBe(true);
  });

  it("teacherColor는 결정적(같은 라벨 같은 색)", () => {
    expect(teacherColor("Kristine")).toBe(teacherColor("Kristine"));
    expect(teacherColor(null)).toBe("blue");
  });
});
