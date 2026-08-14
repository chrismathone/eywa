import { describe, it, expect } from "vitest";
import { compareByJobRank, jobTitleRank } from "./job-rank";

// 실측 설정 순서(2026-08-14): 원장 → 부원장 → 실장 → 강사 → 조교 → 행정 → 아르바이트
const ORDER = ["원장", "부원장", "실장", "강사", "조교", "행정", "아르바이트"];

describe("직급 서열 순위", () => {
  it("정확일치는 설정 배열의 자리", () => {
    expect(jobTitleRank("원장", ORDER)).toBe(0);
    expect(jobTitleRank("부원장", ORDER)).toBe(1);
    expect(jobTitleRank("아르바이트", ORDER)).toBe(6);
  });

  it("변형 직급은 포함 매칭 — 실측 직급명들", () => {
    expect(jobTitleRank("급여제 강사", ORDER)).toBe(3);
    expect(jobTitleRank("시간제 강사", ORDER)).toBe(3);
    expect(jobTitleRank("LAP실 아르바이트", ORDER)).toBe(6);
    expect(jobTitleRank("아르바이트 (차량)", ORDER)).toBe(6);
  });

  it("'수학과 부원장'은 원장(0)이 아니라 부원장(1) — 최장 매칭", () => {
    expect(jobTitleRank("수학과 부원장", ORDER)).toBe(1);
  });

  it("설정에 없는 직급·빈 직급은 맨 뒤", () => {
    expect(jobTitleRank("대리", ORDER)).toBe(Infinity);
    expect(jobTitleRank("영어과 교수부장", ORDER)).toBe(Infinity);
    expect(jobTitleRank("", ORDER)).toBe(Infinity);
    expect(jobTitleRank(null, ORDER)).toBe(Infinity);
  });
});

describe("후보 목록 정렬", () => {
  it("서열순 → 같은 서열·꼬리는 이름순", () => {
    const people = [
      { name: "다니엘", jobTitle: "대리" },
      { name: "김강사", jobTitle: "급여제 강사" },
      { name: "박원장", jobTitle: "원장" },
      { name: "이부원장", jobTitle: "수학과 부원장" },
      { name: "가나다", jobTitle: null },
      { name: "안알바", jobTitle: "아르바이트" },
    ];
    const sorted = [...people].sort((a, b) => compareByJobRank(a, b, ORDER));
    expect(sorted.map((p) => p.name)).toEqual([
      "박원장", // 원장(0)
      "이부원장", // 부원장(1)
      "김강사", // 강사(3)
      "안알바", // 아르바이트(6)
      "가나다", // 미매칭 꼬리 — 이름순
      "다니엘",
    ]);
  });
});
