import { describe, expect, it } from "vitest";
import { canonicalRole, EMPTY_ANALYSIS_ERROR, NO_WARNING, normalizeConsultationReport } from "./analysis-normalize";

// 2026-10-19 블라인드 비교에서 V4.1 flash가 실제로 낸 모양을 줄인 것 — 나열 섹션을 산문으로, 셔틀 같은 값은 그대로.
const FLASH_LIKE = {
  speakerRoles: { A: "선생님", B: "어머니" },
  consultationType: "- 등록 상담\n- 진단 결과 설명",
  summary: "이태경은 수학 60점대다. 주3회 등록하기로 했다.",
  familyBackground: "",
  parentConcerns: "아이가 수학을 어려워한다. 숙제를 미룬다.",
  parentQuestions: "- 반 배정은 어떻게? → 레벨 테스트 뒤 결정 (미답변)\n- 셔틀은? → (미답변)",
  parentRequests: ["보강 요청", "주말 수업 문의"],
  parentSatisfaction: "설명에 만족했다.",
  studentTraits: "• 집중이 짧음\n• 계산 실수",
  teacherResponse: "화자 A는 레벨 테스트를 권했다.",
  salesPoints: "",
  agreements: "- 다음 주 레벨 테스트",
  followUps: "- 시간표 안내(상담자)",
  warnings: "",
  conversationFlow: [{ topic: "성적", summary: "60점대", children: [{ topic: "약점", summary: "계산" }] }, "잡음"],
  extracted: { prospectName: "이태경", grade: "", school: "null", parentName: null, parentPhone: 1012345678 },
  extra: "버린다",
};

describe("normalizeConsultationReport — 기존 저장본 모양으로", () => {
  const out = normalizeConsultationReport(FLASH_LIKE);

  it("나열 섹션: 산문 → 문장마다 불릿 · 배열 → 줄마다 · 다른 기호 → '- '", () => {
    expect(out.parentConcerns).toBe("- 아이가 수학을 어려워한다.\n- 숙제를 미룬다.");
    expect(out.parentRequests).toBe("- 보강 요청\n- 주말 수업 문의");
    expect(out.studentTraits).toBe("- 집중이 짧음\n- 계산 실수");
  });
  it("산문 섹션: 불릿을 떼고 한 문단", () => {
    // 문장이 아닌 조각은 줄을 그대로 둔다 — 이어 붙이면 '등록 상담 진단 결과 설명'처럼 뜻이 섞인다(2026-10-19 재리뷰).
    expect(out.consultationType).toBe("등록 상담\n진단 결과 설명");
    expect(out.summary).toBe("이태경은 수학 60점대다. 주3회 등록하기로 했다.");
  });
  it("답이 있는 질문의 '(미답변)'만 뗀다 · 답이 없으면 그대로", () => {
    expect(out.parentQuestions).toBe("- 반 배정은 어떻게? → 레벨 테스트 뒤 결정\n- 셔틀은? → (미답변)");
  });
  it("화자 기호는 역할 이름으로(프롬프트 금지 조항)", () => {
    expect(out.teacherResponse).toBe("- 상담자는 레벨 테스트를 권했다.");
    expect(out.speakerRoles).toEqual({ A: "상담자", B: "학부모" });
  });
  it("warnings가 비면 프롬프트의 정해진 문장", () => {
    expect(out.warnings).toBe(NO_WARNING);
  });
  it("추출 정보: 빈 값·'null'은 null · 숫자는 글자", () => {
    expect(out.extracted).toEqual({ prospectName: "이태경", grade: null, school: null, parentName: null, parentPhone: "1012345678" });
  });
  it("대화 흐름: 노드만(문자열 잡음은 버린다)", () => {
    expect(out.conversationFlow).toEqual([{ topic: "성적", summary: "60점대", children: [{ topic: "약점", summary: "계산" }] }]);
  });
  it("모르는 키는 버린다(저장 스냅샷 모양 고정)", () => {
    expect("extra" in out).toBe(false);
    expect(Object.keys(out).sort()).toEqual(
      [
        "agreements", "consultationType", "conversationFlow", "extracted", "familyBackground", "followUps",
        "parentConcerns", "parentQuestions", "parentRequests", "parentSatisfaction", "salesPoints",
        "speakerRoles", "studentTraits", "summary", "teacherResponse", "warnings",
      ].sort(),
    );
  });
  it("기존 모양(v4-pro 저장본)은 바뀌지 않는다", () => {
    const already = { ...out };
    expect(normalizeConsultationReport(already)).toEqual(out);
  });
  it("섹션 칸이 하나도 없는 응답(모양 실패)은 '완료'로 저장하지 않고 던진다", () => {
    expect(() => normalizeConsultationReport("not json")).toThrow(EMPTY_ANALYSIS_ERROR);
    expect(() => normalizeConsultationReport({ speakerRoles: { A: "상담자" }, extracted: {} })).toThrow(EMPTY_ANALYSIS_ERROR);
  });
  it("칸은 있는데 비어 있는 응답(잡담만 한 녹음)은 정상 — 던지지 않는다", () => {
    const empty = normalizeConsultationReport({ summary: "", warnings: "" });
    expect(empty.summary).toBe("");
    expect(empty.warnings).toBe(NO_WARNING);
  });
  it("바깥에 화자 역할을 두고 섹션만 한 겹 싼 응답도 읽는다", () => {
    const out2 = normalizeConsultationReport({ analysis: { summary: "등록하기로 했다.", warnings: "" }, speakerRoles: { A: "상담자" } });
    expect(out2.summary).toBe("등록하기로 했다.");
    expect(out2.speakerRoles).toEqual({ A: "상담자" });
  });
  it("녹음이 여럿이면 '화자 A'를 역할로 바꾸지 않는다(화자 글자는 녹음마다 따로)", () => {
    const multi = normalizeConsultationReport(
      { speakerRoles: { A: "상담자" }, summary: "1차 상담에서 화자 A는 성적을 걱정했다." },
      { multi: true },
    );
    expect(multi.summary).toBe("1차 상담에서 화자 A는 성적을 걱정했다.");
  });
  it("한 줄에 '→'가 둘이면 '(미답변)'을 떼지 않는다(어느 답의 표시인지 모른다)", () => {
    const q = normalizeConsultationReport({ parentQuestions: "- 진도는? → (미답변) 셔틀은? → 운행함" });
    expect(q.parentQuestions).toBe("- 진도는? → (미답변) 셔틀은? → 운행함");
  });
  it("대화 흐름: 제목 없이 자식만 있는 노드도 자식을 살린다", () => {
    const f = normalizeConsultationReport({ summary: "요약.", conversationFlow: [{ children: [{ topic: "약점", summary: "계산" }] }] });
    expect(f.conversationFlow).toEqual([{ topic: "", summary: "", children: [{ topic: "약점", summary: "계산" }] }]);
  });
  it("한 겹 싸서 보낸 응답·키 대소문자 차이는 풀어서 읽는다", () => {
    const wrapped = normalizeConsultationReport({ report: { Summary: "등록하기로 했다.", warnings: [] } });
    expect(wrapped.summary).toBe("등록하기로 했다.");
    expect(wrapped.warnings).toBe(NO_WARNING);
  });
  it("warnings 칸이 아예 없으면 '위험 신호 없음'을 지어 넣지 않는다", () => {
    expect(normalizeConsultationReport({ summary: "요약." }).warnings).toBe("");
  });
  it("화자 역할을 못 냈으면 speakerRoles가 없다(재분석이 이전 역할을 이어받는다)", () => {
    expect("speakerRoles" in normalizeConsultationReport({ summary: "요약." })).toBe(false);
  });
  it("대화 흐름은 세 단계 이상도 그대로", () => {
    const deep = normalizeConsultationReport({
      summary: "요약.",
      conversationFlow: [{ topic: "1", summary: "", children: [{ topic: "2", summary: "", children: [{ topic: "3", summary: "끝" }] }] }],
    });
    expect(deep.conversationFlow).toEqual([
      { topic: "1", summary: "", children: [{ topic: "2", summary: "", children: [{ topic: "3", summary: "끝" }] }] },
    ]);
  });
});

describe("canonicalRole", () => {
  it("넷 중 하나로", () => {
    expect(canonicalRole("원장")).toBe("상담자");
    expect(canonicalRole("엄마")).toBe("학부모");
    expect(canonicalRole("자녀")).toBe("학생");
    expect(canonicalRole("동생 친구")).toBe("기타");
  });
  it("끝 낱말(중심어)로 먼저 판정한다(2026-10-19 리뷰 두 번)", () => {
    expect(canonicalRole("상담받으러 온 어머니")).toBe("학부모");
    expect(canonicalRole("상담 대상 학생")).toBe("학생");
    expect(canonicalRole("선생님 자녀")).toBe("학생");
    expect(canonicalRole("상담 선생님")).toBe("상담자");
    expect(canonicalRole("학생 담당 선생님")).toBe("상담자");
    expect(canonicalRole("학부모 상담 실장")).toBe("상담자");
    expect(canonicalRole("학부모(어머니)")).toBe("학부모");
  });
});
