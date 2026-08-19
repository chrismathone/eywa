import { describe, expect, it } from "vitest";
import {
  INTAKE_MAX_RANGE_DAYS,
  INTAKE_MAX_REASON,
  INTAKE_MEMO_SUFFIX,
  intakeMemo,
  buildAbsenceCells,
  cellKey,
  expandDateRange,
  hhmm,
  slotAppliesOn,
  type IntakeEnrollment,
  type IntakeSlot,
} from "./absence-intake";

// 2026-08-19(수) · 08-20(목) · 08-21(금)
const WED = "2026-08-19";
const THU = "2026-08-20";
const FRI = "2026-08-21";

const mathClass: IntakeEnrollment = {
  classId: "c-math",
  className: "중2 A",
  subject: "math",
  startDate: "2026-03-01",
  endDate: null,
  attendanceDays: null,
};
const engClass: IntakeEnrollment = {
  classId: "c-eng",
  className: "DP1",
  subject: "english",
  startDate: "2026-03-01",
  endDate: null,
  attendanceDays: null,
};

/** 수학 = 수·금 연강 2교시 / 영어 = 수 3교시. */
const slots: IntakeSlot[] = [
  { classId: "c-math", dayOfWeek: "wed", startTime: "17:00:00", validFrom: null, validTo: null },
  { classId: "c-math", dayOfWeek: "wed", startTime: "18:00:00", validFrom: null, validTo: null },
  { classId: "c-math", dayOfWeek: "fri", startTime: "17:00:00", validFrom: null, validTo: null },
  { classId: "c-eng", dayOfWeek: "wed", startTime: "16:20:00", validFrom: null, validTo: null },
  { classId: "c-eng", dayOfWeek: "wed", startTime: "17:20:00", validFrom: null, validTo: null },
];

describe("expandDateRange", () => {
  it("양끝을 포함해 펼친다", () => {
    expect(expandDateRange(WED, FRI)).toEqual([WED, THU, FRI]);
  });
  it("하루짜리도 한 칸", () => {
    expect(expandDateRange(WED, WED)).toEqual([WED]);
  });
  it("뒤집힌 범위는 빈 배열", () => {
    expect(expandDateRange(FRI, WED)).toEqual([]);
  });
  it("상한을 넘으면 **자르지 않고** 빈 배열 — 절반만 접수되는 침묵 손실 방지", () => {
    const long = expandDateRange("2026-01-01", "2026-06-01");
    expect(long).toEqual([]);
  });
  it("상한 경계(31일)는 통과한다", () => {
    const edge = expandDateRange("2026-08-01", "2026-08-31");
    expect(edge).toHaveLength(INTAKE_MAX_RANGE_DAYS);
    expect(edge.at(-1)).toBe("2026-08-31");
  });
  it("형식이 아니면 빈 배열", () => {
    expect(expandDateRange("2026-8-1", FRI)).toEqual([]);
  });
});

describe("slotAppliesOn", () => {
  const slot: IntakeSlot = {
    classId: "c",
    dayOfWeek: "wed",
    startTime: "17:00",
    validFrom: "2026-08-01",
    validTo: "2026-08-19",
  };
  it("요일이 다르면 false", () => {
    expect(slotAppliesOn(slot, FRI, "fri")).toBe(false);
  });
  it("유효기간 마지막 날은 포함", () => {
    expect(slotAppliesOn(slot, WED, "wed")).toBe(true);
  });
  it("만료된 배치는 제외 — 끝난 교시로 결석을 만들지 않는다", () => {
    expect(slotAppliesOn({ ...slot, validTo: "2026-08-12" }, WED, "wed")).toBe(false);
  });
  it("유효기간이 둘 다 없으면 항상 유효(판정 불가를 '없음'으로 바꾸지 않는다)", () => {
    expect(slotAppliesOn({ ...slot, validFrom: null, validTo: null }, WED, "wed")).toBe(true);
  });
});

describe("buildAbsenceCells — 저장 축은 과목이 정한다", () => {
  const base = { enrollments: [mathClass, engClass], slots, holidays: new Set<string>() };

  it("수학 연강 2교시는 **하루 한 칸**(slotCount=2, saveSlot=null)", () => {
    const cells = buildAbsenceCells({ ...base, dates: [WED] });
    const math = cells.filter((c) => c.classId === "c-math");
    expect(math).toHaveLength(1);
    expect(math[0]).toMatchObject({ saveSlot: null, periodStart: "17:00", slotCount: 2 });
  });

  it("영어는 **교시별 칸**(3교시면 3칸)", () => {
    const cells = buildAbsenceCells({ ...base, dates: [WED] });
    const eng = cells.filter((c) => c.classId === "c-eng");
    expect(eng.map((c) => c.saveSlot)).toEqual(["16:20", "17:20"]);
  });

  it("수업이 없는 요일은 칸을 만들지 않는다", () => {
    expect(buildAbsenceCells({ ...base, dates: [THU] })).toEqual([]);
  });

  it("공휴일은 건너뛴다 — 쉬는 날 결석은 거짓이다", () => {
    const cells = buildAbsenceCells({ ...base, dates: [WED, FRI], holidays: new Set([WED]) });
    expect(cells.map((c) => c.date)).toEqual([FRI]);
  });

  it("수강 구간 밖(종료 후)은 제외", () => {
    const ended: IntakeEnrollment = { ...mathClass, endDate: "2026-08-19" };
    const cells = buildAbsenceCells({ ...base, enrollments: [ended], dates: [WED, FRI] });
    expect(cells.map((c) => c.date)).toEqual([WED]);
  });

  it("분리등원이면 그 요일만 — 수요일만 오는 학생은 금요일 칸이 없다", () => {
    const wedOnly: IntakeEnrollment = { ...mathClass, attendanceDays: ["wed"] };
    const cells = buildAbsenceCells({ ...base, enrollments: [wedOnly], dates: [WED, FRI] });
    expect(cells.map((c) => c.date)).toEqual([WED]);
  });

  it("같은 반 수강행이 둘(재등록)이어도 칸은 하나", () => {
    const again: IntakeEnrollment = { ...mathClass, startDate: "2026-08-01" };
    const cells = buildAbsenceCells({ ...base, enrollments: [mathClass, again], dates: [WED] });
    expect(cells.filter((c) => c.classId === "c-math")).toHaveLength(1);
  });

  it("날짜 → 교시 순으로 정렬된다", () => {
    const cells = buildAbsenceCells({ ...base, dates: [FRI, WED] });
    expect(cells.map((c) => `${c.date} ${c.periodStart}`)).toEqual([
      "2026-08-19 16:20",
      "2026-08-19 17:00",
      "2026-08-19 17:20",
      "2026-08-21 17:00",
    ]);
  });

  it("cellKey는 (반·날짜·저장축)", () => {
    expect(cellKey({ classId: "c", date: WED, saveSlot: "17:00" })).toBe("c|2026-08-19|17:00");
    expect(cellKey({ classId: "c", date: WED, saveSlot: null })).toBe("c|2026-08-19|");
  });

  it("hhmm은 앞 5자만", () => {
    expect(hhmm("17:00:00")).toBe("17:00");
    expect(hhmm(null)).toBe("");
  });
});

describe("intakeMemo — 출처가 메모 한 줄에 함께 간다(모든 화면이 note를 읽는다)", () => {
  it("사유 뒤에 출처를 붙인다", () => {
    expect(intakeMemo("제주도 여행")).toBe("제주도 여행 (데스크 접수)");
  });
  it("이미 붙어 있으면 두 번 붙이지 않는다(멱등)", () => {
    expect(intakeMemo("제주도 여행 (데스크 접수)")).toBe("제주도 여행 (데스크 접수)");
  });
  it("공백만이면 빈 문자열 — 없는 메모를 지어내지 않는다", () => {
    expect(intakeMemo("   ")).toBe("");
  });
  it("길이 상한을 넘으면 사유를 자른다", () => {
    const long = "가".repeat(300);
    expect(intakeMemo(long).length).toBeLessThanOrEqual(INTAKE_MAX_REASON + INTAKE_MEMO_SUFFIX.length + 1);
  });
});
