import { describe, expect, it } from "vitest";
import { parseTeacherGrid } from "./parse-grid";
import type { SheetGrid } from "./types";
// 실제 인재원 강사별영어시간표(7월) 시트를 Sheets includeGridData 형태로 스냅샷한 픽스처.
// (구글시트 export → xlsx → 셀+병합 추출. 값은 formattedValue, 병합은 0-based end-exclusive.)
import fixtureJson from "./fixtures/teacher-grid.sample.json";

const fixture = fixtureJson as unknown as SheetGrid;

describe("parseTeacherGrid — 실 강사별 그리드", () => {
  const parsed = parseTeacherGrid(fixture);

  it("강사 블록 16개를 인식", () => {
    expect(parsed.teachers).toHaveLength(16);
  });

  it("첫 블록 = Jane / 담임 방 301 / index 1", () => {
    const jane = parsed.teachers[0]!;
    expect(jane.name).toBe("Jane");
    expect(jane.homeRoom).toBe("301");
    expect(jane.index).toBe(1);
  });

  it("예비 블록 4개(예비1~4)", () => {
    expect(parsed.teachers.filter((t) => t.reserve)).toHaveLength(4);
  });

  it("배치 슬롯 275건 파싱", () => {
    expect(parsed.slots).toHaveLength(275);
  });

  it("모든 슬롯: 요일 mon~sat, 시작시각 HH:MM", () => {
    const days = new Set(["mon", "tue", "wed", "thu", "fri", "sat"]);
    for (const s of parsed.slots) {
      expect(days.has(s.day)).toBe(true);
      expect(s.startTime).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it("스팟체크: Jane 월 '중등E_중2 심화' → 방 301, 16:20~17:20 (행 인덱스 규칙)", () => {
    // end=17:20이 진실(병합 6행 × 10분, DB normalized_model과 일치). 옛 기대값 17:00은
    // A열 라벨("4:20~5:00") 기반 오류였음 — 라벨 텍스트는 불규칙해 신뢰 불가(2026-07-06 정정).
    const s = parsed.slots.find(
      (x) => x.teacherName === "Jane" && x.day === "mon" && x.className === "중등E_중2 심화",
    );
    expect(s).toBeDefined();
    expect(s!.room).toBe("301");
    expect(s!.startTime).toBe("16:20");
    expect(s!.endTime).toBe("17:20");
  });

  it("행 인덱스 규칙: 모든 슬롯 시각이 10분 격자 정렬 + end > start", () => {
    const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    for (const s of parsed.slots) {
      expect(min(s.startTime) % 10).toBe(0);
      expect(s.endTime).toMatch(/^\d{2}:\d{2}$/);
      expect(min(s.endTime!)).toBeGreaterThan(min(s.startTime));
    }
  });

  it("레벨코드 수업(LT2/KW6 등)과 내신 수업이 함께 존재", () => {
    const names = new Set(parsed.slots.map((s) => s.className));
    expect([...names].some((n) => /^[A-Z]{2,3}\d/.test(n))).toBe(true); // 영어 레벨코드
    expect(names.has("중등E_중2 심화")).toBe(true); // 내신
  });

  it("SKY 방 인식(정규식 \\b(\\d{3}|SKY)\\b)", () => {
    const sky = parsed.slots.filter((s) => s.room === "SKY");
    expect(sky.length).toBeGreaterThan(0);
  });
});
