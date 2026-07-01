import { describe, expect, it } from "vitest";
import {
  dayChangeLabel,
  incomingDayLabel,
  sameDaySet,
  zoneAttendanceDays,
} from "./split-attendance";

describe("sameDaySet — 요일 집합 동일 판정(no-op)", () => {
  it("순서 무관 동일", () => {
    expect(sameDaySet(["mon", "thu"], ["thu", "mon"])).toBe(true);
    expect(sameDaySet([], [])).toBe(true);
    expect(sameDaySet(undefined, [])).toBe(true);
  });
  it("다르면 false", () => {
    expect(sameDaySet(["mon"], ["thu"])).toBe(false);
    expect(sameDaySet([], ["mon"])).toBe(false);
    expect(sameDaySet(["mon", "thu"], ["mon"])).toBe(false);
  });
});

describe("dayChangeLabel — 요일 변경 배지", () => {
  it("빈 배열=전 요일", () => {
    expect(dayChangeLabel([])).toBe("전 요일");
    expect(dayChangeLabel(undefined)).toBe("전 요일");
  });
  it("요일 지정=OO만", () => {
    expect(dayChangeLabel(["thu"])).toBe("목만");
    expect(dayChangeLabel(["mon", "thu"])).toBe("월·목만");
  });
});

describe("zoneAttendanceDays — 드롭 존 → 등원 요일", () => {
  it("요일 존은 그 요일만", () => {
    expect(zoneAttendanceDays("thu")).toEqual(["thu"]);
    expect(zoneAttendanceDays("mon")).toEqual(["mon"]);
  });
  it("공통 존(null/undefined)은 전 요일([])", () => {
    expect(zoneAttendanceDays(null)).toEqual([]);
    expect(zoneAttendanceDays(undefined)).toEqual([]);
    expect(zoneAttendanceDays("")).toEqual([]);
  });
});

describe("incomingDayLabel — 전입 예정 요일 라벨", () => {
  it("전 요일 등원(빈 배열/undefined)은 라벨 없음", () => {
    expect(incomingDayLabel([], ["mon", "thu"])).toBe("");
    expect(incomingDayLabel(undefined, ["mon", "thu"])).toBe("");
  });

  it("월-only 학생이 월목 셀로 전입 → '월'", () => {
    expect(incomingDayLabel(["mon"], ["mon", "thu"])).toBe("월");
  });

  it("이 셀의 전 요일을 다 오면(분리 아님) 라벨 생략", () => {
    // 월목 다 오는 학생 → 월목 셀에선 분리 아님
    expect(incomingDayLabel(["mon", "thu"], ["mon", "thu"])).toBe("");
    // 단독(수) 셀에 수요일 등원 → 그 셀 전 요일 = 라벨 없음
    expect(incomingDayLabel(["wed"], ["wed"])).toBe("");
  });

  it("일부만 오면 그 요일만(요일 순서=셀 요일 순서)", () => {
    expect(incomingDayLabel(["mon", "thu"], ["mon", "tue", "thu", "fri"])).toBe("월·목");
    // ad 순서가 섞여도 covers 순서로 정렬(부분 등원 = tue 안 옴)
    expect(incomingDayLabel(["thu", "mon"], ["mon", "tue", "thu"])).toBe("월·목");
    expect(incomingDayLabel(["mon", "wed"], ["mon", "tue", "thu"])).toBe("월");
  });

  it("등원 요일이 이 셀 요일과 안 겹치는 교차 이동 → 학생 실제 요일 그대로", () => {
    // 화 등원 학생을 월목 셀로 끌어옴(교차) → 그래도 '화'로 누구인지 표시
    expect(incomingDayLabel(["tue"], ["mon", "thu"])).toBe("화");
    expect(incomingDayLabel(["tue", "fri"], ["mon", "thu"])).toBe("화·금");
  });

  it("coveringDays 미지정(통합뷰 등)이면 학생 요일 그대로", () => {
    expect(incomingDayLabel(["mon"], [])).toBe("월");
    expect(incomingDayLabel(["sat", "sun"], [])).toBe("토·일");
  });
});
