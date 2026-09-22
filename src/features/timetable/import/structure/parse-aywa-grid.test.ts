import { describe, it, expect } from "vitest";
import fixture from "./fixtures/aywa-teacher-grid.sample.json";
import { parseAywaTeacherGrid } from "./parse-aywa-grid";
import type { SheetGrid } from "./types";

// fixture = 1-rxc의 현 aywa export 강사별영어시간표 탭 스냅샷(includeGridData, 48행×84열·병합 331).
// ⚠️ 구 parse-grid.ts용 fixture(원본 손시트)와 별개. export 구조 바뀌면 새로 뜰 것.
const grid = fixture as SheetGrid;
const parsed = parseAywaTeacherGrid(grid);
const DAYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

describe("parseAywaTeacherGrid — aywa export 강사별 구조 파싱", () => {
  it("강사 블록 = row0 라벨(정제된 slot_teacher_label). 12명, 예비 없음", () => {
    expect(parsed.teachers.map((t) => t.name)).toEqual([
      "Jane", "Hannah", "Elsa", "Charlie", "부원장", "Dom",
      "Anna", "Florence", "Kristine", "Sam", "JJ", "이주희",
    ]);
  });

  it("경고 없이 전 슬롯 파싱(라운드트립 무손실 — DB 308행과 동일 키)", () => {
    expect(parsed.warnings).toEqual([]);
    expect(parsed.slots.length).toBe(308);
  });

  it("불변식: 모든 슬롯이 유효 요일·시각·반명", () => {
    for (const s of parsed.slots) {
      expect(DAYS.has(s.day)).toBe(true);
      expect(s.className.length).toBeGreaterThan(0);
      expect(s.className).not.toContain("\n"); // 반명은 첫 줄만
      expect(s.startTime).toMatch(/^\d{2}:\d{2}$/);
      expect(s.endTime).toMatch(/^\d{2}:\d{2}$/);
      expect(s.startTime < s.endTime!).toBe(true); // 병합 rowSpan → 종료 > 시작
    }
  });

  it("방 = 반명 뺀 잔여에서만 추출 — 반명 속 'SKY'를 방으로 오인 안 함", () => {
    const sky = parsed.slots.filter((s) => s.className.includes("SKY"));
    expect(sky.length).toBeGreaterThan(0);
    for (const s of sky) expect(s.room).not.toBe("SKY"); // 방은 숫자실(301 등)이거나 null
  });

  it("병합 rowSpan = 수업 길이(단일 10분 셀 아님)", () => {
    // 60분 수업(6행 병합) 존재 — 시작·종료 60분 차.
    const hour = parsed.slots.find(
      (s) => s.className === "중등E_중2 심화" && s.day === "mon" && s.startTime === "16:20",
    );
    expect(hour?.endTime).toBe("17:20");
  });

  it("주말(토) 슬롯도 파싱", () => {
    expect(parsed.slots.some((s) => s.day === "sat")).toBe(true);
  });
});
