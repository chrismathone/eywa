import { describe, expect, it } from "vitest";
import {
  DEFAULT_ECS_MONTH_PERIOD,
  DEFAULT_ECS_SHOW_SELF_STUDY,
  normalizeEcsMonthPeriod,
  readEcsMonthPeriod,
  readEcsCollapsedRosterGroups,
  readEcsEnglishTrack,
  readEcsShowSelfStudy,
  readEcsTeacher,
} from "./view-prefs";

describe("readEcsShowSelfStudy — JJ 표시(LAB은 대상 아님)", () => {
  it("기본은 표시 — 원장 2026-08-03 '오픈시켜'(숨김으로 되돌리지 말 것)", () => {
    expect(DEFAULT_ECS_SHOW_SELF_STUDY).toBe(true);
    expect(readEcsShowSelfStudy(undefined)).toBe(true);
    expect(readEcsShowSelfStudy({})).toBe(true);
    expect(readEcsShowSelfStudy({ ecs: {} })).toBe(true);
  });

  it("저장된 false만 숨김", () => {
    expect(readEcsShowSelfStudy({ ecs: { showSpecialRooms: false } })).toBe(false);
    expect(readEcsShowSelfStudy({ ecs: { showSpecialRooms: true } })).toBe(true);
  });

  it("다른 화면 네임스페이스 값은 훔쳐 읽지 않는다", () => {
    expect(readEcsShowSelfStudy({ onescreen: { showSpecialRooms: false } })).toBe(true);
  });

  it("깨진 값(문자열·배열·null)은 기본값 — 교시가 통째로 사라지지 않게", () => {
    expect(readEcsShowSelfStudy({ ecs: { showSpecialRooms: "false" } })).toBe(true);
    expect(readEcsShowSelfStudy({ ecs: null })).toBe(true);
    expect(readEcsShowSelfStudy({ ecs: [] })).toBe(true);
    expect(readEcsShowSelfStudy([])).toBe(true);
    expect(readEcsShowSelfStudy("nope")).toBe(true);
  });
});

describe("readEcsEnglishTrack — 프로그램 보기 필터(계정 귀속)", () => {
  it("미설정은 '전체'", () => {
    expect(readEcsEnglishTrack(null)).toBe("all");
    expect(readEcsEnglishTrack({})).toBe("all");
    expect(readEcsEnglishTrack({ ecs: {} })).toBe("all");
  });

  it("저장값을 그대로 읽는다", () => {
    expect(readEcsEnglishTrack({ ecs: { englishTrack: "eie" } })).toBe("eie");
    expect(readEcsEnglishTrack({ ecs: { englishTrack: "injaewon" } })).toBe("injaewon");
  });

  it("다른 화면 네임스페이스 값은 훔쳐 읽지 않는다", () => {
    expect(readEcsEnglishTrack({ onescreen: { englishTrack: "eie" } })).toBe("all");
  });

  it("깨진 값은 '전체' — 반 목록이 통째로 비면 '반이 사라졌다'가 된다", () => {
    expect(readEcsEnglishTrack({ ecs: { englishTrack: "EIE" } })).toBe("all");
    expect(readEcsEnglishTrack({ ecs: { englishTrack: 3 } })).toBe("all");
    expect(readEcsEnglishTrack({ ecs: [] })).toBe("all");
  });

  it("자리(LAB·JJ) 설정과 서로 간섭하지 않는다(축이 다르다)", () => {
    const prefs = { ecs: { englishTrack: "eie", showSpecialRooms: false } };
    expect(readEcsEnglishTrack(prefs)).toBe("eie");
    expect(readEcsShowSelfStudy(prefs)).toBe(false);
  });
});

describe("readEcsCollapsedRosterGroups — 로스터 섹션 접힘(계정 귀속)", () => {
  it("기본은 전부 펼침", () => {
    expect(readEcsCollapsedRosterGroups(undefined)).toEqual([]);
    expect(readEcsCollapsedRosterGroups({})).toEqual([]);
    expect(readEcsCollapsedRosterGroups({ ecs: {} })).toEqual([]);
  });

  it("저장된 그룹만 접힌다 — 순서는 항상 재원→퇴원→기록으로 고정", () => {
    expect(readEcsCollapsedRosterGroups({ ecs: { collapsedRosterGroups: ["record", "active"] } })).toEqual([
      "active",
      "record",
    ]);
  });

  it("모르는 키는 버리고 아는 키는 살린다(통째로 무시하지 않는다)", () => {
    expect(
      readEcsCollapsedRosterGroups({ ecs: { collapsedRosterGroups: ["withdrawn", "무엇", 7] } }),
    ).toEqual(["withdrawn"]);
  });

  it("깨진 값은 전부 펼침 — 명단이 통째로 접혀 '학생이 없다'로 보이지 않게", () => {
    expect(readEcsCollapsedRosterGroups({ ecs: { collapsedRosterGroups: "active" } })).toEqual([]);
    expect(readEcsCollapsedRosterGroups({ ecs: { collapsedRosterGroups: null } })).toEqual([]);
  });

  it("다른 화면 네임스페이스 값은 훔쳐 읽지 않는다", () => {
    expect(readEcsCollapsedRosterGroups({ onescreen: { collapsedRosterGroups: ["active"] } })).toEqual([]);
  });

  it("형제 설정과 서로 간섭하지 않는다", () => {
    const prefs = {
      ecs: {
        collapsedRosterGroups: ["withdrawn"],
        showSpecialRooms: false,
        englishTrack: "eie",
        teacher: TEACHER_ID,
      },
    };
    expect(readEcsCollapsedRosterGroups(prefs)).toEqual(["withdrawn"]);
    expect(readEcsShowSelfStudy(prefs)).toBe(false);
    expect(readEcsEnglishTrack(prefs)).toBe("eie");
    expect(readEcsTeacher(prefs)).toBe(TEACHER_ID);
  });
});

const TEACHER_ID = "11111111-1111-4111-8111-111111111111";

describe("readEcsTeacher — 담임 보기 필터(계정 귀속)", () => {
  it("미설정은 '전체'", () => {
    expect(readEcsTeacher(null)).toBe("all");
    expect(readEcsTeacher({})).toBe("all");
    expect(readEcsTeacher({ ecs: {} })).toBe("all");
  });

  it("저장값을 그대로 읽는다", () => {
    expect(readEcsTeacher({ ecs: { teacher: TEACHER_ID } })).toBe(TEACHER_ID);
    expect(readEcsTeacher({ ecs: { teacher: "none" } })).toBe("none");
  });

  it("깨진 값은 '전체' — 반 목록이 통째로 비어 '반이 사라졌다'가 되지 않게", () => {
    expect(readEcsTeacher({ ecs: { teacher: "육소희" } })).toBe("all");
    expect(readEcsTeacher({ ecs: { teacher: 7 } })).toBe("all");
  });

  it("다른 화면 네임스페이스 값은 훔쳐 읽지 않는다", () => {
    expect(readEcsTeacher({ onescreen: { teacher: TEACHER_ID } })).toBe("all");
  });
});

describe("readEcsMonthPeriod — EiE 계획서 기간 축(월/세션, 2026-09-21)", () => {
  it("기본은 세션(출석부 날짜축과 같은 기본)", () => {
    expect(DEFAULT_ECS_MONTH_PERIOD).toBe("session");
    expect(readEcsMonthPeriod(undefined)).toBe("session");
    expect(readEcsMonthPeriod({ ecs: {} })).toBe("session");
  });

  it("저장된 값은 그대로, 깨진 값은 기본", () => {
    expect(readEcsMonthPeriod({ ecs: { monthPeriod: "month" } })).toBe("month");
    expect(readEcsMonthPeriod({ ecs: { monthPeriod: "session" } })).toBe("session");
    expect(readEcsMonthPeriod({ ecs: { monthPeriod: "week" } })).toBe("session");
  });

  it("주소 값은 모양이 맞을 때만 — 배열·모르는 값은 null(저장값으로 떨어진다)", () => {
    expect(normalizeEcsMonthPeriod("month")).toBe("month");
    expect(normalizeEcsMonthPeriod(["month", "session"])).toBeNull();
    expect(normalizeEcsMonthPeriod("Month")).toBeNull();
    expect(normalizeEcsMonthPeriod(undefined)).toBeNull();
  });
});
