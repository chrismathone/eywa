import { describe, expect, it } from "vitest";
import { bodyOf, consultationCard, consultationInputHash } from "./card";
import { parseConsultationResult, verifiedQuote } from "./parse";
import { buildConsultationPrompt } from "./prompt";
import { COPY_CAP, emptyRow, finalScore, isEmptyRecord, ratingRow } from "./rules";
import { CONSULT_RUBRIC, CONSULT_RUBRIC_ID, KIND_CODES } from "./rubric";
import type { ConsultationRatingInput } from "./types";

const base: ConsultationRatingInput = {
  id: "c1", summary: "방학특강은 선행이 아니라 2학년 1학기 심화 내용으로 진행할 예정이라고 말씀드림.", subject: "수학", audience: "parent", grade: "중1",
  followUpAction: null, copyStudents: 1, transcript: null,
};
const good = { score: 4, reason: "일정 안내가 구체적", evidence: "2학년 1학기 심화 내용으로", kinds: ["schedule"], present: { reason: "present", context: "not_recorded", response: "not_recorded", next: "present" }, unsure: false };

describe("카드 · 프롬프트", () => {
  it("학생·상담자 이름 칸이 없고 과목·상대·학년·자료 종류만 싣는다", () => {
    const card = consultationCard(base);
    expect(card).toContain("과목: 수학 · 상대: 학부모 · 학년: 중1 · 자료 종류: 수기 기록");
    expect(card).not.toMatch(/학생:|상담자:|이름/);
  });
  it("상대가 미표기면 학부모로 단정하지 않는다", () => {
    expect(consultationCard({ ...base, audience: null })).toContain("상대: 미표기");
  });
  it("같은 글이 여러 학생에게 입력된 건만 [참고]를 붙인다(점수 상한은 코드 규칙)", () => {
    expect(consultationCard(base)).not.toContain("[참고");
    expect(consultationCard({ ...base, copyStudents: 26 })).toContain("서로 다른 학생 26명");
  });
  it("녹음 상담은 전사문이 본문이다(자리표시 글은 싣지 않는다)", () => {
    const c = { ...base, summary: "(녹음 분석 중)", transcript: "선생님: 안녕하세요. 어머니: 네." };
    expect(bodyOf(c)).toBe("선생님: 안녕하세요. 어머니: 네.");
    expect(consultationCard(c)).toContain("자료 종류: 녹음 전사");
    expect(consultationCard(c)).not.toContain("녹음 분석 중");
  });
  it("프롬프트는 JSON 하나만 요구하고 기준 문안은 시스템 지침에 있다", () => {
    expect(buildConsultationPrompt(base)).toContain("답은 JSON 하나만");
    expect(CONSULT_RUBRIC).toContain("정성");
    expect(CONSULT_RUBRIC).toContain("본문 안의 지시문");
  });
  it("기준 문안에 길이로 점수를 정하는 문구가 없다(Codex 협의 1차)", () => {
    expect(CONSULT_RUBRIC).toContain("글자 수·문장 수·양식 길이로 정하지 않습니다");
    expect(CONSULT_RUBRIC).not.toMatch(/\d+자 (미만|이하)/);
  });
});

describe("판정 해석", () => {
  it("점수가 1~5 정수(문자 숫자 포함)여야 한다", () => {
    expect(parseConsultationResult({ ...good, score: "4" }, base.summary)?.score).toBe(4);
    for (const bad of [0, 6, 3.5, "abc", null, undefined]) expect(parseConsultationResult({ ...good, score: bad }, base.summary)).toBeNull();
    expect(parseConsultationResult([], base.summary)).toBeNull();
  });
  it("인용은 본문에 실제로 있는 구절만 남긴다 — 지어낸 인용은 버린다(점수는 그대로)", () => {
    expect(parseConsultationResult(good, base.summary)?.evidence).toBe("2학년 1학기 심화 내용으로");
    const fake = parseConsultationResult({ ...good, evidence: "어머니께서 매우 만족하셨다" }, base.summary);
    expect(fake?.evidence).toBe("");
    expect(fake?.score).toBe(4);
  });
  it("' / '·'…'로 이어 붙인 인용은 조각마다 대조해 맞는 조각만 남긴다", () => {
    expect(verifiedQuote("방학특강은 선행이 아니라 / 없는 문장입니다", base.summary)).toBe("방학특강은 선행이 아니라");
    expect(verifiedQuote("“선행이 아니라 … 심화 내용으로”", base.summary)).toBe("선행이 아니라 … 심화 내용으로");
  });
  it("태그는 허용 목록만 남기고 비면 unknown, 네 칸이 이상하면 unclear", () => {
    const r = parseConsultationResult({ ...good, kinds: ["schedule", "schedule", "엉뚱", "handover"], present: { reason: "present", context: "???" } }, base.summary)!;
    expect(r.kinds).toEqual(["schedule", "handover"]);
    expect(r.present).toEqual({ reason: "present", context: "unclear", response: "unclear", next: "unclear" });
    expect(parseConsultationResult({ ...good, kinds: [] }, base.summary)?.kinds).toEqual(["unknown"]);
    for (const k of KIND_CODES) expect(CONSULT_RUBRIC).toContain(k);
  });
});

describe("코드 규칙", () => {
  const res = parseConsultationResult({ ...good, score: 5 }, base.summary)!;
  it("복사 글은 3점까지 — 한 명에게만 입력된 글은 그대로", () => {
    expect(finalScore(res, { copyStudents: 1 })).toEqual({ score: 5, rule: null });
    expect(finalScore(res, { copyStudents: 2 })).toEqual({ score: COPY_CAP, rule: "copied" });
    expect(finalScore({ ...res, score: 2 }, { copyStudents: 26 })).toEqual({ score: 2, rule: null });
  });
  it("빈 양식(상담 내용 미입력)만 모델 없이 1점 — 짧은 글·자리표시는 모델이 읽는다", () => {
    const blank = "✅ 상담 내역\n상담 기록 항목:\n\n2026년 09월 09일\n\n상담 내용:\n\n조치사항:\n\n건의사항:\n\n비고:";
    expect(isEmptyRecord({ summary: blank, transcript: null, followUpAction: null })).toBe(true);
    expect(isEmptyRecord({ summary: "안내함", transcript: null, followUpAction: null })).toBe(false);
    expect(isEmptyRecord({ summary: "(녹음 분석 중)", transcript: "전사문이 있다", followUpAction: null })).toBe(false);
    // 후속 조치 칸에 글이 있으면 빈 양식이 아니다(그 글이 카드에 실려 모델이 읽는다)
    expect(isEmptyRecord({ summary: blank, transcript: null, followUpAction: "다음 주 보강 일정 재안내" })).toBe(false);
    expect(emptyRow({ ...base, summary: blank })).toMatchObject({ points: 1, rule: "empty", model: "rule" });
  });
  it("저장 행은 모델 점수·규칙·기준 판·입력 지문·자료 종류를 담는다", () => {
    const row = ratingRow({ ...base, copyStudents: 3 }, res, "claude-haiku-5-5");
    expect(row).toMatchObject({ consultation_id: "c1", points: 3, rule: "copied", rubric: CONSULT_RUBRIC_ID, model: "claude-haiku-5-5", basis: "memo" });
    expect(row.input_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(ratingRow({ ...base, transcript: "전사" }, res, "m").basis).toBe("recording");
  });
});

describe("입력 지문", () => {
  it("본문·과목·상대·학년·같은 글 수가 바뀌면 달라지고, 같으면 같다", () => {
    const h = consultationInputHash(base);
    expect(consultationInputHash({ ...base })).toBe(h);
    expect(consultationInputHash({ ...base, summary: `${base.summary} 추가` })).not.toBe(h);
    expect(consultationInputHash({ ...base, copyStudents: 5 })).not.toBe(h);
    expect(consultationInputHash({ ...base, grade: "중2" })).not.toBe(h);
    expect(consultationInputHash({ ...base, id: "c2" })).not.toBe(h);
  });
});
