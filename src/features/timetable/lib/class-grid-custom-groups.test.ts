import { describe, expect, it } from "vitest";
import { DEFAULT_PERIODS_CONFIG } from "./periods";
import { buildRichCardGroups, type GridSlot, type IntegrationGroupsConfig } from "./class-grid";

/** 영어 평일 슬롯 1개(= 반 1개). start는 "HH:MM" 평일 교시 시작. */
function slot(classId: string, className: string, day: string, start: string): GridSlot {
  return {
    id: `${classId}-${day}-${start}`,
    classId,
    className,
    subject: "english",
    dayOfWeek: day,
    startTime: `${start}:00`,
    endTime: "23:00:00",
    teacherName: "Anna",
    classroomName: "601",
    studentCount: 0,
    slotTeacherLabel: "Anna",
    slotRoomLabel: "601",
    classBgColor: null,
    classTextColor: null,
    students: [],
  } as unknown as GridSlot;
}

// 서로 다른 시작 교시 3반 — 자동 그룹이면 3섹션으로 갈린다.
const slots: GridSlot[] = [
  slot("c1", "DP5", "mon", "14:20"),
  slot("c2", "JP1", "mon", "15:00"),
  slot("c3", "KW6", "mon", "15:40"),
];

const cfg = (over: Partial<IntegrationGroupsConfig> = {}): IntegrationGroupsConfig => ({
  groups: [
    { id: "g1", title: "초등부", classIds: ["c1", "c3"] },
    { id: "g2", title: "중등부", classIds: ["c2"] },
  ],
  showOthers: true,
  othersTitle: "기타 수업",
  ...over,
});

const labels = (gs: { label: string }[]) => gs.map((g) => g.label);
const cardsOf = (gs: { label: string; cards: { className: string }[] }[], label: string) =>
  gs.find((g) => g.label === label)?.cards.map((c) => c.className) ?? [];

describe("통합뷰 커스텀 그룹(ijw CUSTOM_GROUP 이식)", () => {
  it("미설정이면 지금까지처럼 'N교시 시작' 자동 그룹", () => {
    const groups = buildRichCardGroups(slots, DEFAULT_PERIODS_CONFIG);
    expect(groups.length).toBe(3);
    expect(groups.every((g) => g.label.endsWith("시작"))).toBe(true);
  });

  it("빈 그룹 목록도 자동 그룹으로 폴백한다(설정만 만들고 안 채운 상태에서 화면이 비면 안 됨)", () => {
    const groups = buildRichCardGroups(slots, DEFAULT_PERIODS_CONFIG, new Set(), {
      groups: [],
      showOthers: true,
      othersTitle: "기타",
    });
    expect(groups.length).toBe(3);
  });

  it("시작 교시가 달라도 한 그룹으로 묶이고, 그룹 정의 순서대로 배치된다", () => {
    const groups = buildRichCardGroups(slots, DEFAULT_PERIODS_CONFIG, new Set(), cfg());
    expect(labels(groups)).toEqual(["초등부", "중등부"]);
    expect(cardsOf(groups, "초등부")).toEqual(["DP5", "KW6"]); // 14:20·15:40 시작이 한 섹션에
  });

  it("어느 그룹에도 없는 반은 '기타' 섹션으로 맨 아래에 모인다", () => {
    const groups = buildRichCardGroups(slots, DEFAULT_PERIODS_CONFIG, new Set(), {
      ...cfg(),
      groups: [{ id: "g1", title: "초등부", classIds: ["c1"] }],
    });
    expect(labels(groups)).toEqual(["초등부", "기타 수업"]);
    expect(cardsOf(groups, "기타 수업")).toEqual(["JP1", "KW6"]);
  });

  it("'기타' 숨김이면 미배정 반은 화면에서 빠진다", () => {
    const groups = buildRichCardGroups(slots, DEFAULT_PERIODS_CONFIG, new Set(), {
      ...cfg(),
      groups: [{ id: "g1", title: "초등부", classIds: ["c1"] }],
      showOthers: false,
    });
    expect(labels(groups)).toEqual(["초등부"]);
  });

  it("한 반이 여러 그룹에 적혀 있으면 먼저 나온 그룹만 갖는다(같은 반 두 줄 노출 금지)", () => {
    const groups = buildRichCardGroups(slots, DEFAULT_PERIODS_CONFIG, new Set(), {
      ...cfg(),
      groups: [
        { id: "g1", title: "초등부", classIds: ["c1"] },
        { id: "g2", title: "중등부", classIds: ["c1", "c2"] },
      ],
      showOthers: false,
    });
    expect(cardsOf(groups, "초등부")).toEqual(["DP5"]);
    expect(cardsOf(groups, "중등부")).toEqual(["JP1"]);
  });

  it("주말 전용 반은 같은 그룹 안에서도 '(주말)' 별도 섹션 — 교시축·요일열 체계가 다르다", () => {
    const withWeekend = [...slots, slot("c4", "SAT1", "sat", "10:00")];
    const groups = buildRichCardGroups(withWeekend, DEFAULT_PERIODS_CONFIG, new Set(), {
      ...cfg(),
      groups: [{ id: "g1", title: "초등부", classIds: ["c1", "c4"] }],
    });
    expect(cardsOf(groups, "초등부")).toEqual(["DP5"]);
    expect(cardsOf(groups, "초등부 (주말)")).toEqual(["SAT1"]);
    // 주말 섹션의 요일축은 주말 요일만(평일 축에 얹히지 않는다)
    const sat = groups.find((g) => g.label === "초등부 (주말)")!;
    expect(sat.days).toEqual(["sat"]);
  });

  it("제목이 공백뿐인 그룹은 무시한다(빈 제목 섹션이 생기지 않게)", () => {
    const groups = buildRichCardGroups(slots, DEFAULT_PERIODS_CONFIG, new Set(), {
      ...cfg(),
      groups: [{ id: "g1", title: "   ", classIds: ["c1"] }],
      showOthers: true,
    });
    expect(labels(groups).every((l) => l.endsWith("시작"))).toBe(true); // 유효 그룹 0개 → 자동 그룹 폴백
  });
});

describe("커스텀 그룹 안 열 순서", () => {
  it("그룹에 적힌 순서를 그대로 쓴다(가나다로 재정렬하지 않음)", () => {
    // 가나다면 DP5·JP1·KW6, 정의 순서면 KW6·DP5·JP1 — 원장 시트의 좌우 순서 재현이 목적.
    const groups = buildRichCardGroups(slots, DEFAULT_PERIODS_CONFIG, new Set(), {
      groups: [{ id: "g1", title: "오후 2:20", classIds: ["c3", "c1", "c2"] }],
      showOthers: false,
      othersTitle: "기타",
    });
    expect(groups[0].cards.map((c) => c.className)).toEqual(["KW6", "DP5", "JP1"]);
  });

  it("'기타' 섹션은 정의 순서가 없으므로 가나다 유지", () => {
    const groups = buildRichCardGroups(slots, DEFAULT_PERIODS_CONFIG, new Set(), {
      groups: [{ id: "g1", title: "묶음", classIds: [] }, { id: "g2", title: "묶음2", classIds: ["c2"] }],
      showOthers: true,
      othersTitle: "기타 수업",
    });
    const others = groups.find((g) => g.label === "기타 수업")!;
    expect(others.cards.map((c) => c.className)).toEqual(["DP5", "KW6"]);
  });
});
