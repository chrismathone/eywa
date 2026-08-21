/**
 * 지각 메모 조립·해석 — **시각이 곧 사실**이라 조용히 틀리면 아무도 되짚지 못한다.
 * 특히 KST: 서버는 UTC라 로컬 시·분을 그대로 찍으면 9시간 어긋난 등원 시각이 남는다.
 */
import { describe, expect, it } from "vitest";
import {
  buildLateNote,
  hhmmToMinutes,
  lateArrivalTime,
  minutesToHhmm,
  parseLateNote,
} from "./late-note";

/** 2026-08-20 08:05 UTC = 같은 날 17:05 KST — UTC 그대로 찍으면 08:05가 돼 9시간 어긋난다. */
const UTC_0805 = new Date("2026-08-20T08:05:00.000Z");

describe("lateArrivalTime", () => {
  it("Date는 **KST** 시·분으로 읽는다", () => {
    expect(lateArrivalTime(UTC_0805)).toBe("17:05");
  });

  it("문자열 'HH:MM'은 그 값에서 출발한다(저장된 등원 시각 정정)", () => {
    expect(lateArrivalTime("17:05", 0)).toBe("17:05");
    expect(lateArrivalTime("17:05", -5)).toBe("17:00");
    expect(lateArrivalTime("17:05", 5)).toBe("17:10");
  });

  it("하루 밖으로 나가지 않는다 — 자정에 −5분을 눌러도 전날이 되지 않는다", () => {
    expect(lateArrivalTime("00:02", -5)).toBe("00:00");
    expect(lateArrivalTime("23:58", 5)).toBe("23:59");
  });

  it("읽을 수 없는 문자열은 00:00이 아니라 **지금(KST)** 으로 떨어진다", () => {
    // 형식이 깨진 값을 00:00으로 적으면 "새벽 0시에 등원"이라는 사실이 아닌 메모가 남는다.
    expect(lateArrivalTime("아무말")).not.toBe("00:00");
    expect(lateArrivalTime("25:99")).not.toBe("25:99");
  });
});

describe("buildLateNote", () => {
  it("사유가 없으면 시각만", () => {
    expect(buildLateNote(UTC_0805, 0, null)).toBe("17:05 등원");
  });

  it("사유가 있으면 뒤에 붙인다", () => {
    expect(buildLateNote(UTC_0805, 0, "버스 놓침")).toBe("17:05 등원 · 버스 놓침");
  });

  it("공백뿐인 사유는 붙이지 않는다 — 꼬리에 ' · '만 남지 않게", () => {
    expect(buildLateNote("17:05", 0, "   ")).toBe("17:05 등원");
  });

  it("±분이 시각에 반영된다", () => {
    expect(buildLateNote("17:05", -5, null)).toBe("17:00 등원");
  });
});

describe("parseLateNote — 이미 찍힌 칸을 다시 열 때", () => {
  it("시각만 있는 메모", () => {
    expect(parseLateNote("17:05 등원")).toEqual({ time: "17:05", reason: null });
  });

  it("시각 + 사유", () => {
    expect(parseLateNote("17:05 등원 · 버스 놓침")).toEqual({ time: "17:05", reason: "버스 놓침" });
  });

  it("조립한 것을 그대로 되읽는다(왕복)", () => {
    const note = buildLateNote("09:30", 0, "학교 종례 늦음");
    expect(parseLateNote(note)).toEqual({ time: "09:30", reason: "학교 종례 늦음" });
  });

  it("형식이 아닌 옛 메모는 **사유 자리로 살린다** — 통째로 버리지 않는다", () => {
    expect(parseLateNote("차가 막혀서")).toEqual({ time: null, reason: "차가 막혀서" });
  });

  it("빈 메모", () => {
    expect(parseLateNote(null)).toEqual({ time: null, reason: null });
    expect(parseLateNote("   ")).toEqual({ time: null, reason: null });
  });
});

describe("분 ↔ HH:MM", () => {
  it("왕복", () => {
    expect(minutesToHhmm(17 * 60 + 5)).toBe("17:05");
    expect(hhmmToMinutes("17:05")).toBe(1025);
  });

  it("형식이 틀리면 null — 00:00으로 삼키지 않는다", () => {
    expect(hhmmToMinutes("17:5")).toBeNull();
    expect(hhmmToMinutes("24:00")).toBeNull();
    expect(hhmmToMinutes("")).toBeNull();
  });
});
