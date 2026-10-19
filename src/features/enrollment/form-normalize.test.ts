import { describe, expect, it } from "vitest";
import { canonicalDate, canonicalGrade, canonicalPhone, normalizeExtractedForm } from "./form-normalize";

describe("normalizeExtractedForm — 칸 값 모양을 기존과 같게", () => {
  const out = normalizeExtractedForm({
    schoolName: "침산초",
    grade: "초등학교 5학년",
    parentPhone: "01012345678",
    parentRelation: "어머니",
    gender: "여자",
    birthDate: "2015.3.4",
    consultationPath: "아는 분 소개로",
    registrationStatus: "추후등록예정",
    subject: "math",
    shuttleBusRequest: false,
    lastScore: 85,
    weakSubjects: ["분수", "도형"],
    safetyNotes: "없음",
    careerGoal: "null",
    subjectDetails: { math: { examResults: 85, notes: ["계산 실수"] }, music: { notes: "버림" }, english: "문자열" },
    extra: "버림",
  });

  it("선택지 표기로(학년·관계·성별·경로·상태·과목)", () => {
    expect(out.grade).toBe("초5");
    expect(out.parentRelation).toBe("모");
    expect(out.gender).toBe("여");
    expect(out.consultationPath).toBe("지인 소개");
    expect(out.registrationStatus).toBe("추후 등록예정");
    expect(out.subject).toBe("수학");
  });
  it("전화·날짜 형식", () => {
    expect(out.parentPhone).toBe("010-1234-5678");
    expect(out.birthDate).toBe("2015-03-04");
  });
  it("셔틀은 참거짓 값만 'true'/'false' 글자로(flash가 참거짓 값으로 낸 적 있다) · 글자는 그대로(판정은 뒤 하네스)", () => {
    expect(out.shuttleBusRequest).toBe("false");
    expect(normalizeExtractedForm({ shuttleBusRequest: true }).shuttleBusRequest).toBe("true");
    expect(normalizeExtractedForm({ shuttleBusRequest: "신청" }).shuttleBusRequest).toBe("신청");
    expect(normalizeExtractedForm({ shuttleBusRequest: "필요 없음" }).shuttleBusRequest).toBe("필요 없음");
    expect(normalizeExtractedForm({}).shuttleBusRequest).toBe("");
  });
  it("객체 값은 키를 살린다 — '1명, 1명'이 저장되면 안 된다(2026-10-19 리뷰)", () => {
    expect(normalizeExtractedForm({ siblings: { 형: "1명", 누나: "1명" } }).siblings).toBe("형: 1명, 누나: 1명");
    // 과목 키는 한글 이름으로 · 그 밖의 영문 키는 무엇의 값인지 못 옮기니 버린다(예전에도 문자열이 아닌 값은 버려졌다).
    expect(normalizeExtractedForm({ lastScore: { math: "85점", english: "B" } }).lastScore).toBe("수학: 85점, 영어: B");
    expect(normalizeExtractedForm({ lastScore: { midterm: 80, final: 75 } }).lastScore).toBe("");
  });
  it("상담 경로에 부정이 있으면 고르지 않는다", () => {
    expect(normalizeExtractedForm({ consultationPath: "소개받은 적 없음" }).consultationPath).toBe("소개받은 적 없음");
  });
  it("과목 상세는 한글 과목 이름 키도 받는다(뒤 하네스가 받던 꼴)", () => {
    expect(normalizeExtractedForm({ subjectDetails: { 수학: { notes: "도형 약함" } } }).subjectDetails).toEqual({
      math: { notes: "도형 약함" },
    });
  });
  it("숫자·배열은 글자로 · 'null'은 빈 칸 · '없음'은 말한 사실이라 남긴다", () => {
    expect(out.lastScore).toBe("85");
    expect(out.weakSubjects).toBe("분수, 도형");
    expect(out.careerGoal).toBe("");
    expect(out.safetyNotes).toBe("없음");
  });
  it("과목 상세는 아는 과목·객체만, 값은 글자로", () => {
    expect(out.subjectDetails).toEqual({ math: { examResults: "85", notes: "계산 실수" } });
  });
  it("모르는 칸은 버린다", () => {
    expect("extra" in out).toBe(false);
  });
  it("두 번 돌려도 같다", () => {
    expect(normalizeExtractedForm(out)).toEqual(out);
  });
});

describe("표기 맞추기 — 못 읽으면 그대로(뒤 하네스가 거른다)", () => {
  it("학년", () => {
    expect(canonicalGrade("중학교 2학년")).toBe("중2");
    expect(canonicalGrade("고1")).toBe("고1");
    expect(canonicalGrade("초7")).toBe("초7");
    expect(canonicalGrade("예비 중1")).toBe("예비 중1");
  });
  it("전화", () => {
    expect(canonicalPhone("010 123 4567")).toBe("010-123-4567");
    expect(canonicalPhone("053-123-4567")).toBe("053-123-4567");
  });
  it("날짜", () => {
    expect(canonicalDate("2015년 3월 4일")).toBe("2015-03-04");
    // 날짜 꼴인데 달력에 없는 날은 빈 칸 — DB가 거절하면 같은 묶음의 다른 칸·'완료'까지 안 써진다(2026-10-19 리뷰).
    expect(canonicalDate("2015-13-01")).toBe("");
    expect(canonicalDate("2014.02.31")).toBe("");
    expect(canonicalDate("2016.02.29")).toBe("2016-02-29");
    expect(canonicalDate("작년 봄")).toBe("작년 봄");
  });
});
