import { describe, expect, it } from "vitest";
import {
  enumDayToKo,
  isWeekendDay,
  koDayToEnum,
  normalizePeriodId,
  periodLabel,
  periodListLabel,
  periodRowText,
  periodSoloLabel,
  periodToTimes,
  slotPeriodRow,
  subjectPeriodRows,
  subjectWeekdayPeriods,
  settingsToPeriodsConfig,
} from "./periods";

describe("PeriodsConfig 주입 (owner 설정 교시 반영)", () => {
  const cfg = settingsToPeriodsConfig({
    weekdayPeriods: [
      { startTime: "10:00", endTime: "10:50" },
      { startTime: "11:00", endTime: "11:50" },
    ],
    weekendPeriods: [{ startTime: "08:00", endTime: "09:00" }],
  });

  it("periodToTimes가 설정 교시 시각을 반영", () => {
    expect(periodToTimes("1", "math", undefined, cfg)).toEqual({ startTime: "10:00", endTime: "10:50" });
    expect(periodToTimes("1", "math", { weekend: true }, cfg)).toEqual({ startTime: "08:00", endTime: "09:00" });
  });

  it("slotPeriodRow가 설정 시각 → 그룹 행으로 매핑(2교시=1그룹)", () => {
    const r = slotPeriodRow("math", "10:00", "mon", cfg);
    expect(r.key).toBe("m-1");
    expect(r.time).toBe("10:00~11:50"); // 2개 교시가 1그룹으로 묶임
  });

  it("subjectPeriodRows 행 수가 설정 교시 수에서 파생(2교시→1그룹, 주말 1교시)", () => {
    expect(subjectPeriodRows("math", false, cfg)).toHaveLength(1);
    expect(subjectPeriodRows("math", true, cfg)).toHaveLength(1);
  });

  it("빈 설정 배열이면 기본 상수로 폴백(동등성)", () => {
    const empty = settingsToPeriodsConfig({ weekdayPeriods: [], weekendPeriods: [] });
    expect(periodToTimes("1", "math", undefined, empty)).toEqual(periodToTimes("1", "math"));
  });
});

describe("요일 변환", () => {
  it("한글→enum 7요일 매핑", () => {
    expect(koDayToEnum("월")).toBe("mon");
    expect(koDayToEnum("일")).toBe("sun");
    expect(koDayToEnum("토")).toBe("sat");
    expect(koDayToEnum(" 수 ")).toBe("wed"); // trim
  });
  it("알 수 없는 요일은 null", () => {
    expect(koDayToEnum("x")).toBeNull();
    expect(koDayToEnum("")).toBeNull();
  });
  it("enum→한글 왕복", () => {
    expect(enumDayToKo("mon")).toBe("월");
    expect(enumDayToKo("sun")).toBe("일");
    for (const ko of ["월", "화", "수", "목", "금", "토", "일"]) {
      expect(enumDayToKo(koDayToEnum(ko)!)).toBe(ko);
    }
  });
  it("주말 판정", () => {
    expect(isWeekendDay("sat")).toBe(true);
    expect(isWeekendDay("sun")).toBe(true);
    expect(isWeekendDay("fri")).toBe(false);
    expect(isWeekendDay("mon")).toBe(false);
  });
});

describe("교시 정규화", () => {
  it("레거시 키를 통일 periodId로", () => {
    expect(normalizePeriodId("1-1")).toBe("1");
    expect(normalizePeriodId("4-2")).toBe("8");
    expect(normalizePeriodId("3-1")).toBe("5");
  });
  it("이미 통일이면 그대로 + trim", () => {
    expect(normalizePeriodId("7")).toBe("7");
    expect(normalizePeriodId(" 10 ")).toBe("10");
  });
});

describe("교시→시각", () => {
  it("수학 평일 8교시 경계", () => {
    expect(periodToTimes("1", "math")).toEqual({ startTime: "14:30", endTime: "15:25" });
    expect(periodToTimes("8", "math")).toEqual({ startTime: "21:05", endTime: "22:00" });
  });
  it("highmath는 수학 교시표 공용", () => {
    expect(periodToTimes("5", "highmath")).toEqual(periodToTimes("5", "math"));
  });
  it("영어는 11교시(통합영어시간표 시트 col A 기준)", () => {
    expect(periodToTimes("1", "english")).toEqual({ startTime: "14:20", endTime: "15:00" });
    expect(periodToTimes("6", "english")).toEqual({ startTime: "17:20", endTime: "18:10" });
    expect(periodToTimes("11", "english")).toEqual({ startTime: "21:10", endTime: "22:00" });
  });
  it("레거시 키도 변환 후 매핑", () => {
    expect(periodToTimes("1-1", "math")).toEqual({ startTime: "14:30", endTime: "15:25" });
    expect(periodToTimes("4-2", "math")).toEqual({ startTime: "21:05", endTime: "22:00" });
  });
  it("주말은 과목 무관 09:00 기준 1시간 단위", () => {
    expect(periodToTimes("1", "math", { weekend: true })).toEqual({
      startTime: "09:00",
      endTime: "10:00",
    });
    expect(periodToTimes("1", "english", { weekend: true })).toEqual({
      startTime: "09:00",
      endTime: "10:00",
    });
    expect(periodToTimes("8", "math", { weekend: true })).toEqual({
      startTime: "16:00",
      endTime: "17:00",
    });
  });
  it("영어 평일 10·11교시는 평일표에만, 주말 8교시엔 없음", () => {
    expect(periodToTimes("11", "english")).not.toBeNull();
    expect(periodToTimes("11", "english", { weekend: true })).toBeNull();
  });
  it("알 수 없는 교시는 null", () => {
    expect(periodToTimes("99", "math")).toBeNull();
    expect(periodToTimes("9", "math")).toBeNull(); // 수학은 8교시까지
  });
});

describe("교시 라벨", () => {
  it("표시용 라벨", () => {
    expect(periodLabel("3")).toBe("3교시");
    expect(periodLabel("1-2")).toBe("2교시"); // 정규화 후
  });
});

describe("시각→그리드 행(slotPeriodRow)", () => {
  it("수학 평일: 8교시를 4그룹으로 — 1·2교시 시작은 같은 1교시 그룹", () => {
    const a = slotPeriodRow("math", "14:30", "mon"); // 교시1
    const b = slotPeriodRow("math", "15:25", "mon"); // 교시2
    expect(a.key).toBe("m-1");
    expect(b.key).toBe("m-1"); // 같은 그룹 셀
    expect(a.label).toBe("1교시");
    expect(a.time).toBe("14:30~16:20");
  });
  it("수학 평일: 3교시 시작(16:20)은 2그룹, 8교시(21:05)는 4그룹", () => {
    expect(slotPeriodRow("math", "16:20", "tue").key).toBe("m-2");
    expect(slotPeriodRow("math", "21:05:00", "tue").key).toBe("m-4"); // HH:MM:SS도 처리
    expect(slotPeriodRow("math", "18:20", "tue").key).toBe("m-3"); // 5교시→3그룹(18:10→18:20 gap)
  });
  it("고등수학은 수학 그룹 체계 공용", () => {
    expect(slotPeriodRow("highmath", "14:30", "mon").key).toBe("m-1");
  });
  it("영어 평일: 11교시 개별 행(통합 시트 시각)", () => {
    expect(slotPeriodRow("english", "14:20", "mon")).toMatchObject({ key: "e-1", label: "1교시" });
    expect(slotPeriodRow("english", "16:20", "mon")).toMatchObject({ key: "e-4", time: "16:20~17:00" });
    expect(slotPeriodRow("english", "17:20", "mon")).toMatchObject({ key: "e-6", time: "17:20~18:10" });
    expect(slotPeriodRow("english", "21:10", "mon").key).toBe("e-11");
  });
  it("같은 16:20이라도 과목 따라 다른 행(수학 2그룹 vs 영어 4교시)", () => {
    expect(slotPeriodRow("math", "16:20", "mon").key).toBe("m-2");
    expect(slotPeriodRow("english", "16:20", "mon").key).toBe("e-4");
  });
  it("주말은 과목 무관 시간단위 8교시", () => {
    expect(slotPeriodRow("math", "09:00", "sat")).toMatchObject({ key: "w-1", time: "09:00~10:00" });
    expect(slotPeriodRow("english", "09:00", "sun").key).toBe("w-1"); // 주말은 영어도 동일
    expect(slotPeriodRow("math", "16:00", "sat").key).toBe("w-8");
  });
  it("매칭 안 되는 시각은 '기타' 행으로 폴백(throw 없음) — 시각 그대로 라벨", () => {
    const r = slotPeriodRow("math", "13:13", "mon");
    expect(r.key).toBe("x-13:13");
    expect(r.label).toBe("13:13");
    expect(r.order).toBe(13 * 60 + 13); // 시각(분) 기준
  });
  it("order는 시각(분) 기준 — 행이 시각순 정렬됨", () => {
    expect(slotPeriodRow("math", "08:00", "mon").order).toBeLessThan(
      slotPeriodRow("math", "13:13", "mon").order,
    );
    // 수학 1교시(14:30=870) < 2교시그룹(16:20=980)
    expect(slotPeriodRow("math", "14:30", "mon").order).toBe(14 * 60 + 30);
    expect(slotPeriodRow("math", "16:20", "mon").order).toBeGreaterThan(
      slotPeriodRow("math", "14:30", "mon").order,
    );
  });
});

describe("과목별 평일 교시표(weekdayBySubject) — subjects[].weekdayPeriods override", () => {
  const p = (startTime: string, endTime: string) => ({ startTime, endTime });
  const base = {
    weekdayPeriods: [p("14:30", "15:25"), p("15:25", "16:20")],
    weekendPeriods: [p("09:00", "10:00")],
  };

  it("커스텀 영어 3교시 → rows 3·e-1..e-3·역조회, 미스매치 시각은 x- 폴백", () => {
    const cfg = settingsToPeriodsConfig({
      ...base,
      subjects: [{ key: "english", weekdayPeriods: [p("13:00", "13:40"), p("13:40", "14:20"), p("14:20", "15:00")] }],
    });
    const rows = subjectPeriodRows("english", false, cfg);
    expect(rows.map((r) => r.key)).toEqual(["e-1", "e-2", "e-3"]);
    expect(slotPeriodRow("english", "13:40", "mon", cfg).key).toBe("e-2");
    // 커스텀 테이블 밖 시각(옛 ENGLISH_PERIODS 시각) → 기타 행
    expect(slotPeriodRow("english", "18:20", "mon", cfg).key).toBe("x-18:20");
  });

  it("영어 교시 이름과 같은 시작시각의 EiE/IJW 교시를 종료시각으로 구분", () => {
    const cfg = settingsToPeriodsConfig({
      ...base,
      subjects: [
        {
          key: "english",
          weekdayPeriods: [
            { label: "EiE 1교시", ...p("14:20", "15:00") },
            { label: "EiE 2교시", ...p("15:00", "15:40") },
            { label: "EiE 3교시", ...p("15:40", "16:20") },
            { label: "EiE 4교시", ...p("16:20", "17:00") },
            { label: "EiE 5교시", ...p("17:00", "17:40") },
            { label: "EiE 6교시", ...p("17:40", "18:20") },
            { label: "IJW 1교시", ...p("16:20", "17:20") },
          ],
        },
      ],
    });

    expect(subjectWeekdayPeriods("english", cfg).map((r) => r.label)).toEqual([
      "EiE 1교시",
      "EiE 2교시",
      "EiE 3교시",
      "EiE 4교시",
      "EiE 5교시",
      "EiE 6교시",
      "IJW 1교시",
    ]);
    expect(slotPeriodRow("english", "16:20", "tue", cfg, "17:00")).toMatchObject({
      key: "e-4",
      label: "EiE 4교시",
    });
    expect(slotPeriodRow("english", "16:20", "tue", cfg, "17:20")).toMatchObject({
      key: "e-7",
      label: "IJW 1교시",
    });
    const duplicateStartRows = subjectPeriodRows("english", false, cfg).filter((r) => r.time.startsWith("16:20~"));
    expect(duplicateStartRows.map((r) => r.label)).toEqual(["EiE 4교시", "IJW 1교시"]);
    expect(new Set(duplicateStartRows.map((r) => r.order)).size).toBe(2);
  });

  it("subjects에 english override 없음(빈 배열 포함) → 기존 ENGLISH_PERIODS 동일(무회귀)", () => {
    const noSub = settingsToPeriodsConfig(base);
    const emptyOverride = settingsToPeriodsConfig({
      ...base,
      subjects: [{ key: "english", weekdayPeriods: [] }],
    });
    for (const cfg of [noSub, emptyOverride]) {
      expect(subjectPeriodRows("english", false, cfg)).toHaveLength(11);
      expect(slotPeriodRow("english", "14:20", "mon", cfg).key).toBe("e-1");
    }
  });

  it("수학계 커스텀 3교시(홀수) → 2그룹(꼬리 단독), 커스텀 없는 과목은 전역 weekday", () => {
    const cfg = settingsToPeriodsConfig({
      ...base,
      subjects: [{ key: "science", weekdayPeriods: [p("10:00", "10:50"), p("11:00", "11:50"), p("12:00", "12:50")] }],
    });
    const sci = subjectPeriodRows("science", false, cfg);
    expect(sci.map((r) => r.key)).toEqual(["m-1", "m-2"]);
    expect(sci[1]!.time).toBe("12:00~12:50"); // 홀수 꼬리 = 단독 그룹
    expect(slotPeriodRow("science", "11:00", "mon", cfg).key).toBe("m-1");
    // math는 override 없음 → 전역 weekday(base 2교시 = 1그룹)
    expect(subjectPeriodRows("math", false, cfg)).toHaveLength(1);
    expect(slotPeriodRow("math", "14:30", "mon", cfg).key).toBe("m-1");
  });

  it("사용자 과목 키(subject_1)에도 커스텀 적용(string subject) + periodToTimes·subjectWeekdayPeriods 해석", () => {
    const cfg = settingsToPeriodsConfig({
      ...base,
      subjects: [{ key: "subject_1", weekdayPeriods: [p("17:00", "18:00")] }],
    });
    expect(periodToTimes("1", "subject_1", undefined, cfg)).toEqual({ startTime: "17:00", endTime: "18:00" });
    expect(subjectWeekdayPeriods("subject_1", cfg)).toEqual([{ id: "1", startTime: "17:00", endTime: "18:00" }]);
    // 주말은 여전히 과목 무관 config.weekend
    expect(periodToTimes("1", "subject_1", { weekend: true }, cfg)).toEqual({ startTime: "09:00", endTime: "10:00" });
  });
});

// 원장 2026-08-13: *"빈값으로 설정 가능하게 … 빈값이면 표기하고 싶지 않은 거니까 시간대만 표시"*.
// 🔴 이 규칙의 전부는 **`undefined`(내장 교시표 = 이름이라는 개념이 없음)와 `""`(학원장이 비움)를
//    구분**하는 것이다. 둘을 뭉개면 비운 이름이 다시 `N교시`로 되살아난다.
describe("교시 이름 비우기 — `\"\"`(비움) ≠ undefined(내장표)", () => {
  const p = (startTime: string, endTime: string) => ({ startTime, endTime });

  it("settingsToPeriodsConfig가 빈 이름을 버리지 않는다(칸 없는 옛 저장분만 undefined)", () => {
    const cfg = settingsToPeriodsConfig({
      weekdayPeriods: [{ label: "", ...p("14:30", "15:25") }, { label: " ", ...p("15:25", "16:20") }],
      weekendPeriods: [p("09:00", "10:00")],
    });
    expect(cfg.weekday["1"]!.label).toBe("");
    expect(cfg.weekday["2"]!.label).toBe(""); // 공백만 적은 것도 "비움"
    expect(cfg.weekend["1"]!.label).toBeUndefined(); // label 칸 자체가 없던 행
  });

  it("periodListLabel: 이름 그대로 / undefined는 `N교시` / 빈 값은 빈 문자열", () => {
    expect(periodListLabel({ id: "4", label: "EiE 4교시" })).toBe("EiE 4교시");
    expect(periodListLabel({ id: "4" })).toBe("4교시");
    expect(periodListLabel({ id: "4", label: "" })).toBe("");
  });

  it("이름을 홀로 찍는 자리(periodSoloLabel·periodRowText)는 시간대로 대체", () => {
    const row = { id: "4", label: "", startTime: "16:20", endTime: "17:00" };
    expect(periodSoloLabel(row)).toBe("16:20~17:00");
    expect(periodSoloLabel({ ...row, label: "EiE 4교시" })).toBe("EiE 4교시");
    expect(periodSoloLabel({ ...row, label: undefined })).toBe("4교시");
    expect(periodRowText({ label: "", time: "16:20~17:00" })).toBe("16:20~17:00");
    expect(periodRowText({ label: "EiE 4교시", time: "16:20~17:00" })).toBe("EiE 4교시");
  });

  it("영어 축: 이름을 비운 교시는 label이 빈 문자열이고 시각은 그대로 살아 있다(행은 안 사라진다)", () => {
    const cfg = settingsToPeriodsConfig({
      weekdayPeriods: [p("14:30", "15:25"), p("15:25", "16:20")],
      weekendPeriods: [p("09:00", "10:00")],
      subjects: [
        {
          key: "english",
          weekdayPeriods: [
            { label: "", ...p("14:20", "15:00") },
            { label: "EiE 2교시", ...p("15:00", "15:40") },
          ],
        },
      ],
    });
    const rows = subjectPeriodRows("english", false, cfg);
    expect(rows.map((r) => r.label)).toEqual(["", "EiE 2교시"]);
    expect(rows.map((r) => r.time)).toEqual(["14:20~15:00", "15:00~15:40"]);
    // 역매핑(슬롯 → 행)도 그대로 — 이름을 비웠다고 배치가 흔들리면 안 된다.
    expect(slotPeriodRow("english", "14:20", "mon", cfg, "15:00")).toMatchObject({ key: "e-1", label: "" });
    expect(subjectWeekdayPeriods("english", cfg)[0]).toEqual({
      id: "1",
      label: "",
      startTime: "14:20",
      endTime: "15:00",
    });
  });

  it("내장 교시표(설정 없음)는 그대로 `N교시` — 무회귀", () => {
    expect(subjectPeriodRows("english", false)[0]!.label).toBe("1교시");
    expect(subjectPeriodRows("math", true)[0]!.label).toBe("1교시");
  });

  // 적대 리뷰: 설정 jsonb는 읽을 때 스키마를 안 거친다(deep-merge뿐) → 저장된 null이 그대로 온다.
  it("깨진 값(null·숫자)은 죽지 않고 `N교시`로 — 설정 한 줄이 시간표를 못 깨뜨린다", () => {
    expect(periodListLabel({ id: "3", label: null as unknown as string })).toBe("3교시");
    expect(periodListLabel({ id: "3", label: 7 as unknown as string })).toBe("3교시");
    const cfg = settingsToPeriodsConfig({
      weekdayPeriods: [{ label: null as unknown as string, startTime: "14:30", endTime: "15:25" }],
      weekendPeriods: [],
    });
    expect(cfg.weekday["1"]!.label).toBeUndefined();
    expect(subjectPeriodRows("math", false, cfg)[0]!.label).toBe("1교시");
  });
});
