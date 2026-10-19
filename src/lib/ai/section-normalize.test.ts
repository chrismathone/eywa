import { describe, expect, it } from "vitest";
import {
  applyBold,
  applySpeakers,
  asBulletList,
  asProse,
  baseClean,
  normalizeSection,
  sectionSource,
  splitSentences,
  toText,
} from "./section-normalize";

const strip = { bold: "strip" as const, speakers: "strip" as const, roles: { A: "상담자", B: "학부모", C: "기타" } };

describe("toText — 문자열 자리의 다른 값", () => {
  it("배열은 줄마다 · 숫자·참거짓은 글자로 · 없음은 빈 문자열", () => {
    expect(toText(["가", "", "나"])).toBe("가\n나");
    expect(toText(85)).toBe("85");
    expect(toText(false)).toBe("false");
    expect(toText(null)).toBe("");
    expect(toText({ a: "하나", b: ["둘"] })).toBe("하나\n둘");
  });
  it("객체는 키를 살린다 — 사람이 읽는 키는 '키: 값', 영문 키는 값만 · 배열 속 객체 하나 = 한 줄(2026-10-19 리뷰)", () => {
    expect(toText({ "노원장(A)": "셔틀 노선 변경 제안", "정유진(B)": ["일정 확인", "명단 정리"] })).toBe(
      "노원장(A): 셔틀 노선 변경 제안\n정유진(B): 일정 확인 명단 정리",
    );
    expect(toText([{ owner: "원장", task: "계약서 발송", due: "금요일" }, "두 번째"])).toBe("원장 · 계약서 발송 · 금요일\n두 번째");
  });
  it("대문자 한 글자 키는 화자 — 누구의 말인지 남긴다", () => {
    expect(toText({ A: "일정 공유", B: "교재 문제 제기" })).toBe("화자 A: 일정 공유\n화자 B: 교재 문제 제기");
  });
});

describe("baseClean", () => {
  it("글자 그대로의 \\n · 코드 펜스 · 머리말 · 겹친 빈 줄", () => {
    expect(baseClean("```json\n# 제목\n가\\n나\n\n\n\n다  라")).toBe("제목\n가\n나\n\n다 라");
  });
  it("값 전체가 빈 칸 표시면 빈 문자열('없음'은 남긴다)", () => {
    expect(baseClean("-")).toBe("");
    expect(baseClean("null")).toBe("");
    expect(baseClean("없음")).toBe("없음");
  });
});

describe("asBulletList — 나열 섹션", () => {
  it("산문으로 쓴 섹션은 문장마다 불릿(블라인드 비교에서 flash가 7곳 이렇게 썼다)", () => {
    expect(asBulletList("수학 진도가 늦다. 숙제를 미룬다! 괜찮을까?")).toBe("- 수학 진도가 늦다.\n- 숙제를 미룬다!\n- 괜찮을까?");
  });
  it("소수점은 문장 끝이 아니다", () => {
    expect(asBulletList("평균 3.5점이다.")).toBe("- 평균 3.5점이다.");
  });
  it("다른 불릿 기호·번호는 '- '로 · 일부만 불릿이면 나머지에도", () => {
    expect(asBulletList("• 하나\n2. 둘\n① 셋\n넷")).toBe("- 하나\n- 둘\n- 셋\n- 넷");
  });
  it("숫자로 시작하는 항목의 번호 목록은 번호를 뗀다(날짜만 지킨다)", () => {
    expect(asBulletList("1. 3월부터 주3회 수업\n2. 2주 뒤 재상담")).toBe("- 3월부터 주3회 수업\n- 2주 뒤 재상담");
  });
  it("이미 기존 모양이면 그대로", () => {
    expect(asBulletList("- 가\n- 나")).toBe("- 가\n- 나");
  });
  it("'확인된 위험 신호 없음' 같은 정해진 문장은 불릿 없이", () => {
    expect(asBulletList("확인된 위험 신호 없음", ["확인된 위험 신호 없음"])).toBe("확인된 위험 신호 없음");
  });
  it("'1학년' 같은 숫자 시작은 번호가 아니다 · '①번'은 문항 번호", () => {
    expect(asBulletList("- 1학년 때 시작")).toBe("- 1학년 때 시작");
    expect(asBulletList("①번 서술형에서 감점이 잦음.")).toBe("- ①번 서술형에서 감점이 잦음.");
  });
  it("줄 머리의 날짜(10. 25.)는 번호가 아니다 — 월이 지워지면 안 된다(2026-10-19 리뷰)", () => {
    expect(asBulletList("10. 25.(토)부터 등원")).toBe("- 10. 25.(토)부터 등원");
    expect(asBulletList("- 첫 상담\n10. 25.까지 결과 안내")).toBe("- 첫 상담\n- 10. 25.까지 결과 안내");
    expect(asProse("10. 25.(토)부터 등원하기로 했다.")).toBe("10. 25.(토)부터 등원하기로 했다.");
  });
  it("질문→답변은 한 항목 · 한 줄에 둘이 붙어 와도 질문마다 나눈다", () => {
    expect(asBulletList("반 배정은 언제 하나요? → 레벨 테스트 뒤 정합니다.")).toBe("- 반 배정은 언제 하나요? → 레벨 테스트 뒤 정합니다.");
    expect(asBulletList("수학 진도는 어디까지 나가나요? → (미답변) 셔틀은 운행하나요? → 아파트 앞까지 운행한다고 답함.")).toBe(
      "- 수학 진도는 어디까지 나가나요? → (미답변)\n- 셔틀은 운행하나요? → 아파트 앞까지 운행한다고 답함.",
    );
  });
  it("'발언자: 내용' 줄은 통째로 · 콜론이 있어도 발언자가 아니면 문장마다(시각·비율·라벨)", () => {
    expect(asBulletList("**노원장(A)**: 첫 제안을 했다. 셔틀 노선 변경도 제안했다.")).toBe(
      "- **노원장(A)**: 첫 제안을 했다. 셔틀 노선 변경도 제안했다.",
    );
    expect(asBulletList("다음 주 화요일 4:00에 레벨테스트를 하기로 함. 수강료는 월 30만원으로 안내함.")).toBe(
      "- 다음 주 화요일 4:00에 레벨테스트를 하기로 함.\n- 수강료는 월 30만원으로 안내함.",
    );
    expect(asBulletList("1:1 클리닉을 제안함. 주 2회 진행하기로 함.")).toBe("- 1:1 클리닉을 제안함.\n- 주 2회 진행하기로 함.");
    expect(asBulletList("주요 논거: 성공 사례를 소개함. 입시 정보를 제공함.")).toBe("- 주요 논거: 성공 사례를 소개함.\n- 입시 정보를 제공함.");
    expect(asBulletList("성적 60점 → 80점 목표로 합의함. 주3회 수업으로 결정함.")).toBe(
      "- 성적 60점 → 80점 목표로 합의함.\n- 주3회 수업으로 결정함.",
    );
  });
});

describe("asProse — 산문 섹션", () => {
  it("문장으로 끝나는 불릿만 있으면 한 문단으로", () => {
    expect(asProse("- 가였다.\n- 나였다.")).toBe("가였다. 나였다.");
  });
  it("문장이 아닌 조각은 줄을 그대로 둔다(이어 붙이면 뜻이 섞인다)", () => {
    expect(asProse("- 외동\n- 어머니 직장인\n- 이전 공부방 1년")).toBe("외동\n어머니 직장인\n이전 공부방 1년");
  });
  it("이미 산문이면 문단 줄바꿈 그대로", () => {
    expect(asProse("첫 문단.\n\n둘째 문단.")).toBe("첫 문단.\n\n둘째 문단.");
  });
});

describe("applyBold", () => {
  it("strip = 전부 · balance = 짝 안 맞는 줄의 마지막 하나만", () => {
    expect(applyBold("**원장**이 **결정", "strip")).toBe("원장이 결정");
    expect(applyBold("**원장**이 **결정", "balance")).toBe("**원장**이 결정");
    expect(applyBold("**원장**과 **대표**", "balance")).toBe("**원장**과 **대표**");
  });
});

describe("applySpeakers", () => {
  const roles = { A: "상담자", B: "학부모", C: "기타" };
  it("strip — 화자 기호를 역할로·괄호 기호는 지움 · 'A반'·'TOEFL'은 그대로", () => {
    expect(applySpeakers("화자 B는 걱정했다", "strip", { roles })).toBe("학부모는 걱정했다");
    expect(applySpeakers("어머니(B)는 A반을 원함", "strip", { roles })).toBe("어머니는 A반을 원함");
    expect(applySpeakers("학부모 B가 TOEFL을 물음", "strip", { roles })).toBe("학부모가 TOEFL을 물음");
  });
  it("strip — 정상 낱말은 건드리지 않는다(2026-10-19 리뷰 두 번이 재현한 입력)", () => {
    expect(applySpeakers("학생 A반으로 배정", "strip", { roles })).toBe("학생 A반으로 배정");
    expect(applySpeakers("학생 C형 문제를 풀었다", "strip", { roles })).toBe("학생 C형 문제를 풀었다");
    expect(applySpeakers("중등 심화(A)반 · B등급(B)", "strip", { roles })).toBe("중등 심화(A)반 · B등급(B)");
    expect(applySpeakers("학부모 Q&A 시간에 질문함", "strip", { roles })).toBe("학부모 Q&A 시간에 질문함");
    expect(applySpeakers("학생 B+ 수준으로 평가", "strip", { roles })).toBe("학생 B+ 수준으로 평가");
    expect(applySpeakers("학생 A 등급을 받음", "strip", { roles })).toBe("학생 A 등급을 받음");
    expect(applySpeakers("학생 O/X 퀴즈 결과", "strip", { roles })).toBe("학생 O/X 퀴즈 결과");
  });
  it("strip — '화자 X'를 바꾸지 않는 때: 역할 모름 · '기타' · 녹음 여럿", () => {
    expect(applySpeakers("화자 D는 동생이다", "strip", { roles })).toBe("화자 D는 동생이다");
    expect(applySpeakers("화자 C는 수업에 관심을 보임", "strip", { roles })).toBe("화자 C는 수업에 관심을 보임");
    expect(applySpeakers("1차 상담에서 화자 A는 성적을 걱정했다", "strip", { roles, multi: true })).toBe(
      "1차 상담에서 화자 A는 성적을 걱정했다",
    );
  });
  it("strip — 화자 글자에 붙은 조사는 바뀐 낱말에 맞춘다(은·이·을·과·으로·이랑)", () => {
    expect(applySpeakers("학생 C가 대답했다", "strip", {})).toBe("학생이 대답했다");
    expect(applySpeakers("화자 B를 칭찬했다", "strip", { roles: { B: "학생" } })).toBe("학생을 칭찬했다");
    expect(applySpeakers("상담자(화자 A)와 학부모(B)는 합의했다", "strip", {})).toBe("상담자와 학부모는 합의했다");
    expect(applySpeakers("학생(A)는 웃었다", "strip", {})).toBe("학생은 웃었다");
    expect(applySpeakers("학생 A로부터 들은 내용과 학부모 B로부터 받은 요청", "strip", {})).toBe(
      "학생으로부터 들은 내용과 학부모로부터 받은 요청",
    );
    expect(applySpeakers("학생 A랑 이야기함. 원장 A로 연락", "strip", {})).toBe("학생이랑 이야기함. 원장으로 연락");
    expect(applySpeakers("김민수(화자 A)는 웃었다", "strip", {})).toBe("김민수는 웃었다");
  });
  it("compact — 기존 저장본 꼴 '원장(A)'로 · 괄호가 이름 꼴이 아니면 그대로", () => {
    expect(applySpeakers("**원장(화자 A)**이 제안", "compact")).toBe("**원장(A)**이 제안");
    expect(applySpeakers("- **화자 B(정유진 부원장)**: 의견", "compact")).toBe("- **정유진 부원장(B)**: 의견");
    expect(applySpeakers("화자 F가 보고", "compact")).toBe("화자 F가 보고");
    expect(applySpeakers("화자 B(추정: 실장)가 말함", "compact")).toBe("화자 B(추정: 실장)가 말함");
    expect(applySpeakers("화자 A(약 5분 지각)", "compact")).toBe("화자 A(약 5분 지각)");
  });
});

describe("normalizeSection", () => {
  it("모양만 고치고 내용 글자는 남긴다", () => {
    const out = normalizeSection("수업이 빡세다고 함. **숙제** 많음.", "list", { bold: "strip", speakers: "strip" });
    expect(out).toBe("- 수업이 빡세다고 함.\n- 숙제 많음.");
  });
  it("빈 칸 표시는 불릿 없이 빈 문자열", () => {
    expect(normalizeSection("-", "list", strip)).toBe("");
    expect(normalizeSection("null", "list", strip)).toBe("");
  });
  it("splitSentences — 빈 조각 없음 · 영문 약어 뒤 마침표는 문장 끝이 아니다", () => {
    expect(splitSentences("  가.  나.  ")).toEqual(["가.", "나."]);
    expect(splitSentences("Mr. Kim과 상담했다. 다음 주 재상담.")).toEqual(["Mr. Kim과 상담했다.", "다음 주 재상담."]);
  });
  it("sectionSource — 한 겹 싼 응답(바깥 부가 칸은 합친다)·키 대소문자 · 섹션 칸이 있었나", () => {
    expect(sectionSource({ report: { Summary: "요약" } }, ["summary"])).toEqual({ source: { summary: "요약" }, hasSections: true });
    expect(sectionSource({ analysis: { summary: "요약" }, speakerRoles: { A: "상담자" } }, ["summary"], ["speakerRoles"])).toEqual({
      source: { summary: "요약", speakerRoles: { A: "상담자" } },
      hasSections: true,
    });
    expect(sectionSource({ summary: "정본", SUMMARY: "다른 것" }, ["summary"]).source).toEqual({ summary: "정본" });
    expect(sectionSource("not json", ["summary"]).hasSections).toBe(false);
  });
});
