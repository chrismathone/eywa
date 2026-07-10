import { describe, expect, it } from "vitest";
import { classnoteMinDate, isClassnoteAllowed, isClassnoteSubjectEnabled } from "./classnote-guard";

describe("classnoteMinDate", () => {
  it("전 달 1일", () => {
    expect(classnoteMinDate("2026-07-07")).toBe("2026-06-01");
    expect(classnoteMinDate("2026-07-01")).toBe("2026-06-01");
  });
  it("1월 → 전년 12월", () => {
    expect(classnoteMinDate("2026-01-10")).toBe("2025-12-01");
  });
});

describe("isClassnoteAllowed (KST 문자열 비교)", () => {
  const today = "2026-07-07"; // minDate 2026-06-01
  it("전 달 1일 이후는 허용", () => {
    expect(isClassnoteAllowed("2026-06-01", today)).toBe(true);
    expect(isClassnoteAllowed("2026-07-05", today)).toBe(true);
    expect(isClassnoteAllowed("2026-07-07", today)).toBe(true);
  });
  it("전 달 1일 이전은 차단(사고 방지)", () => {
    expect(isClassnoteAllowed("2026-05-31", today)).toBe(false);
    expect(isClassnoteAllowed("2026-01-15", today)).toBe(false);
  });
  it("빈 값은 차단", () => {
    expect(isClassnoteAllowed("", today)).toBe(false);
  });
  it("1월 경계", () => {
    expect(isClassnoteAllowed("2025-12-01", "2026-01-10")).toBe(true);
    expect(isClassnoteAllowed("2025-11-30", "2026-01-10")).toBe(false);
  });
});

describe("isClassnoteSubjectEnabled (과목별 발송 게이트)", () => {
  it("허용 목록에 든 과목만 발송", () => {
    expect(isClassnoteSubjectEnabled("math", ["math"])).toBe(true);
    expect(isClassnoteSubjectEnabled("english", ["math"])).toBe(false);
    expect(isClassnoteSubjectEnabled("math", ["math", "english"])).toBe(true);
    expect(isClassnoteSubjectEnabled("subject_1", ["subject_1"])).toBe(true);
  });
  it("빈 목록 = 어떤 과목도 발송 안 함(명시 opt-in)", () => {
    expect(isClassnoteSubjectEnabled("math", [])).toBe(false);
    expect(isClassnoteSubjectEnabled("english", [])).toBe(false);
  });
  // P0-2(2026-07-10): 구버전은 null→math 정규화로 통과시켰음 — 이관/레거시 행이 math opt-in에
  // 편승해 발송되는 벡터라 발송 경로에선 거부로 전환(조회용 정규화는 score-history 별도).
  it("subject=null/빈값은 발송 거부(이관·레거시 편승 차단)", () => {
    expect(isClassnoteSubjectEnabled(null, ["math"])).toBe(false);
    expect(isClassnoteSubjectEnabled(undefined, ["math"])).toBe(false);
    expect(isClassnoteSubjectEnabled("", ["math"])).toBe(false);
    expect(isClassnoteSubjectEnabled(null, ["english"])).toBe(false);
  });
  // P0-3(2026-07-10): 화이트리스트 밖 과목은 opt-in돼 있어도 거부 — 워커가 보드 라벨을 못 만들어
  // 전부 "(수학)" 보드로 가던 오게시 구멍 차단.
  it("발송 가능 화이트리스트 밖 과목은 opt-in돼도 거부", () => {
    expect(isClassnoteSubjectEnabled("science", ["science"])).toBe(false);
    expect(isClassnoteSubjectEnabled("subject_2", ["subject_2", "math"])).toBe(false);
  });
});
