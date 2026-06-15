import { describe, it, expect } from "vitest";
import { buildParentMessage, TONE_LABELS, type MessageInput } from "./message";

function input(overrides: Partial<MessageInput> = {}): MessageInput {
  return {
    name: "김서윤",
    level: "warn",
    scoreDrop: 8,
    lastScore: 78,
    homeworkRate: 70,
    reasons: ["성적 8점 하락", "숙제율 70%"],
    memo: "",
    academyName: "인재원",
    directorName: "김수진",
    ...overrides,
  };
}

describe("buildParentMessage — 기본 구조", () => {
  it("머리말에 학원·원장·학생 호칭, 마무리에 드림", () => {
    const msg = buildParentMessage(input(), "soft");
    expect(msg).toContain("[인재원]");
    expect(msg).toContain("서윤 학생 학부모님");
    expect(msg).toContain("인재원 김수진 드림");
    expect(msg).toContain("이번 주 관리 계획");
  });

  it("안정/관심/위험 본문이 달라진다", () => {
    expect(buildParentMessage(input({ level: "ok", reasons: [] }), "soft")).toContain("안정적");
    expect(buildParentMessage(input({ level: "warn" }), "soft")).toContain("함께 챙기면 좋을");
    expect(buildParentMessage(input({ level: "risk" }), "soft")).toContain("직접 전화드리겠습니다");
  });
});

describe("buildParentMessage — 톤 변형", () => {
  it("성과 중심(result)은 숫자 라인 포함", () => {
    const msg = buildParentMessage(input(), "result");
    expect(msg).toContain("최근 평가 78점");
    expect(msg).toContain("-8점");
  });
  it("단호하게(firm)는 일정 확정 요청 추가(비안정 한정)", () => {
    expect(buildParentMessage(input({ level: "warn" }), "firm")).toContain("상담 일정을 확정");
    expect(buildParentMessage(input({ level: "ok", reasons: [] }), "firm")).not.toContain("상담 일정을 확정");
  });
  it("안심 중심(reassure)은 회복 가능 문구", () => {
    expect(buildParentMessage(input({ level: "warn" }), "reassure")).toContain("회복 가능");
  });
  it("TONE_LABELS 4종", () => {
    expect(Object.keys(TONE_LABELS)).toEqual(["soft", "firm", "result", "reassure"]);
  });
});

describe("buildParentMessage — 학부모 안전성(내부 라벨 미유출)", () => {
  it("내부 위험 사유 원문이 그대로 노출되지 않는다", () => {
    const msg = buildParentMessage(
      input({ level: "risk", reasons: ["상담·메모 내 강한 이탈 신호", "성적 15점 하락"] }),
      "soft",
    );
    expect(msg).not.toContain("이탈 신호");
    expect(msg).not.toContain("위험");
    // 번역된 안전 문구로 치환
    expect(msg).toContain("아쉬웠던 단원");
  });
  it("번역 불가 사유만 있으면 기본 안전 문구로 폴백", () => {
    const msg = buildParentMessage(input({ level: "warn", reasons: ["숙제 기록 없음"] }), "soft");
    expect(msg).toContain("현재 학습 리듬을 유지");
  });
});

describe("buildParentMessage — 칭찬 게이팅", () => {
  it("안정 + 긍정 메모면 칭찬 인용", () => {
    const msg = buildParentMessage(input({ level: "ok", reasons: [], memo: "수업 태도가 좋아짐" }), "soft");
    expect(msg).toContain("눈에 띕니다");
  });
  it("부정 키워드 메모는 칭찬하지 않는다", () => {
    const msg = buildParentMessage(input({ level: "ok", reasons: [], memo: "결석이 잦아 걱정" }), "soft");
    expect(msg).not.toContain("눈에 띕니다");
  });
  it("길거나 괄호 주석 있는 메모는 인용 안 함(중간 잘림·내부 표기 유출 방지)", () => {
    const longMemo = "선행 학습 가속화 요청 (학부모). 현재 진도 대비 1.5학년 위 단원 진행 중";
    const msg = buildParentMessage(input({ level: "ok", reasons: [], memo: longMemo }), "soft");
    expect(msg).not.toContain("눈에 띕니다");
    expect(msg).not.toContain("(학부모)");
    expect(msg).toContain("수업 참여와 과제 모두"); // 일반 폴백 문구
  });
  it("성적 기록 없으면 '기록 정리 중'", () => {
    const msg = buildParentMessage(input({ lastScore: null, scoreDrop: 0 }), "result");
    expect(msg).toContain("기록 정리 중");
  });
});
