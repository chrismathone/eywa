import { describe, expect, it } from "vitest";
import { isBlankTemplate } from "./template";

const blank = (head: string, tail = "조치사항:\n\n건의사항:\n\n비고:") => `✅ 상담 내역\n상담 기록 항목:\n\n${head}\n\n상담 내용:\n\n${tail}`;

describe("빈 양식 판정 — 한 글자도 없을 때만", () => {
  it("실제로 비어 있으면 참: 날짜만 있는 양식 · 빈 글 · X 표기", () => {
    expect(isBlankTemplate(blank("2026년 09월 09일"))).toBe(true);
    expect(isBlankTemplate("")).toBe(true);
    expect(isBlankTemplate("   \n  ")).toBe(true);
    expect(isBlankTemplate("학생 상담일지2026년 11월 03일\n\n" + blank("2026년 11월 03일", "조치사항:X\n비고:X"))).toBe(true);
  });
  it("상담자 이름이 적힌 빈 양식은 규칙이 아니라 모델이 읽는다(이름과 한 단어 내용을 가를 수 없다)", () => {
    expect(isBlankTemplate(blank("2026년 09월 09일\n\n김태건"))).toBe(false);
    expect(isBlankTemplate(blank("2026년 07월 02일\n이영현(Ellen)"))).toBe(false);
  });
  it("🔴 머리의 한 단어는 이름이 아니라 내용일 수 있다 — '성적'·'결석'·'통화완료'", () => {
    expect(isBlankTemplate("✅ 상담 내역\n상담 기록 항목: 성적\n상담 내용:\n조치사항:\n비고:")).toBe(false);
    expect(isBlankTemplate(blank("2026년 09월 09일\n통화완료"))).toBe(false);
    expect(isBlankTemplate("결석\n상담 내용:")).toBe(false);
  });
  it("🔴 '상담 기록 항목:' 줄에 쓴 실제 글은 빈 양식이 아니다(화면 미리보기 휴리스틱이 놓치던 것)", () => {
    expect(isBlankTemplate("✅ 상담 내역\n상담 기록 항목: 어머니와 통화, 다음주 보강 잡음\n상담 내용:\n조치사항:\n비고:")).toBe(false);
    expect(isBlankTemplate(blank("2026년 09월 09일\n어머니와 통화함"))).toBe(false);
  });
  it("항목 값이나 이어지는 줄에 글이 하나라도 있으면 거짓 — 짧아도 모델이 읽는다", () => {
    expect(isBlankTemplate(blank("2026년 09월 09일", "조치사항: 재연락\n건의사항:\n비고:"))).toBe(false);
    expect(isBlankTemplate("✅ 상담 내역\n2026년 09월 09일\n김태건\n상담 내용: 안내함\n조치사항:")).toBe(false);
    expect(isBlankTemplate("✅ 상담 내역\n김태건\n상담 내용:\n\n다음 주 보강 안내\n조치사항:")).toBe(false);
  });
  it("양식이 아닌 글은 거짓(짧은 글·한마디도) — 길이로 정하지 않는다", () => {
    for (const t of ["안내함", "(녹음 분석 중)", "첫 수업 상담. 특이사항 없고 잘부탁한다고 하심.", "[정규상담]\n하성이 잘하고 있음"]) expect(isBlankTemplate(t), t).toBe(false);
  });
});
