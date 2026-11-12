import { describe, expect, it } from "vitest";
import { mentMaxTokens, mentSections, readMentResponse, stripSubjectLabel, type MentAssembly } from "./ment-assembly";
import { formatMentPreview, trendPreviewLine } from "./ment-preview-format";
import { commentStyleDirective } from "./prompt-defaults";
import type { ReportCommentInput } from "./report-comment";
import { buildTrendInput } from "./trend-comment";

// 운영 자동작성과 AI 멘트 탭 미리보기가 같이 쓰는 조립·응답 읽기(원장 2026-10-16 미리보기 = 실제와 같게).
const input: ReportCommentInput = {
  studentName: "학원이",
  subject: "수학",
  progress: "일차방정식의 활용",
  dailyTest: "5문제 중 4개 맞음",
  checkTest: "",
  attitude: "매우 좋음",
  homework: "100%",
  homeworkToday: "12-20p",
  textbook: "",
  specialNote: "풀이 과정을 끝까지 적음",
};
const trend = buildTrendInput(
  [
    { date: "2026-10-01", examInfo: null, homeworkScore: "100%", classId: null },
    { date: "2026-10-06", examInfo: null, homeworkScore: "100%", classId: null },
    { date: "2026-10-08", examInfo: null, homeworkScore: "100%", classId: null },
  ],
  { today: "2026-10-08" },
);
const base: MentAssembly = {
  mode: "A",
  input,
  templates: { comment: null, comment_p1: null, comment_p2: null, trend: null },
  styleSeed: "학원이|2026-10-08|수학",
  styleBlock: "",
  toneBlock: "",
  trend: null,
};

describe("mentSections — 운영·미리보기 공용 조립", () => {
  it("저장 진도의 공백 과목 접두를 운영 입력처럼 떼고 다른 시작은 보존한다", () => {
    expect(stripSubjectLabel("수학 2-6-1 일차방정식", "수학")).toBe("2-6-1 일차방정식");
    expect(stripSubjectLabel("수학: 2-6-1 일차방정식", "수학")).toBe("수학: 2-6-1 일차방정식");
    expect(stripSubjectLabel("2-6-1 일차방정식", "수학")).toBe("2-6-1 일차방정식");
  });
  it("모드 A = 멘트 하나 + 결 변형 · 말투 지침은 맨 뒤 · 추세엔 어조만", () => {
    expect(trend?.facts.length).toBeGreaterThan(0);
    const s = mentSections({ ...base, styleBlock: "@@말투@@", toneBlock: "@@어조@@", trend });
    expect(s.map((x) => x.field)).toEqual(["comment", "trend"]);
    expect(s[0]!.body).toContain("풀이 과정을 끝까지 적음");
    expect(s[0]!.body).toContain(commentStyleDirective(base.styleSeed));
    expect(s[0]!.body.endsWith("@@말투@@")).toBe(true);
    expect(s[1]!.body.endsWith("@@어조@@")).toBe(true);
    expect(s[1]!.body).not.toContain("@@말투@@");
  });
  it("모드 B = 두 문단에 말투 · 편집 중 프롬프트가 그 문단에 들어간다", () => {
    const s = mentSections({ ...base, mode: "B", styleBlock: "@@말투@@", templates: { ...base.templates, comment_p1: "고친 P1 {{facts}}" } });
    expect(s.map((x) => x.field)).toEqual(["p1", "p2"]);
    expect(s[0]!.body.startsWith("고친 P1")).toBe(true);
    expect(s.every((x) => x.body.endsWith("@@말투@@"))).toBe(true);
  });
  it("사실 줄이 없으면 추세 섹션을 만들지 않는다", () => {
    expect(mentSections({ ...base, trend: trend ? { ...trend, facts: [] } : null }).map((x) => x.field)).toEqual(["comment"]);
  });
  it("특이사항·반 안내가 있으면 출력 상한이 크다", () => {
    expect(mentMaxTokens(input)).toBe(1800);
    expect(mentMaxTokens({ specialNote: "", classNotice: "" })).toBe(1000);
  });
});

describe("readMentResponse — 응답 읽기와 생성 뒤 검사", () => {
  it("숫자가 든 추세는 버리고 멘트는 살린다", () => {
    const r = readMentResponse({ comment: "잘 했습니다.", trend: "과제를 세 번 연속 100% 해 왔습니다." }, "A", trend);
    expect(r.comment).toBe("잘 했습니다.");
    expect(r.dropped).toBe(true);
    expect(r.trend).toBeUndefined();
    expect(r.violations).toContain("숫자");
  });
  it("비워 보낸 추세 = quiet · 키가 없으면 quiet 아님 · 문자열이 아닌 값은 빈 값", () => {
    expect(readMentResponse({ comment: "a", trend: "" }, "A", trend).quietByModel).toBe(true);
    expect(readMentResponse({ comment: "a" }, "A", trend).quietByModel).toBe(false);
    expect(readMentResponse({ comment: 3 }, "A", null).comment).toBe("");
  });
  it("모드 B는 두 문단을 빈 줄로 잇는다 · 추세를 맡기지 않았으면 읽지 않는다", () => {
    const r = readMentResponse({ p1: "첫 문단", p2: "둘째 문단", trend: "최근 잘 해 오고 있습니다." }, "B", null);
    expect(r.comment).toBe("첫 문단\n\n둘째 문단");
    expect(r.rawTrend).toBeUndefined();
  });
});

describe("미리보기 결과 글", () => {
  const parts = { comment: "멘트", trend: null, trendSkipped: "quiet" as const, modelLabel: "Claude Haiku", mode: "A" as const, hasSpecialNote: true, hasClassNotice: false, styleTeacher: "이수진" };
  it("멘트 · 추세 상태 · 무엇으로 조립했는지", () => {
    const t = formatMentPreview(parts);
    expect(t).toContain("[학부모 멘트]\n멘트");
    expect(t).toContain("이 회차엔 쓰지 않습니다");
    expect(t).toContain("Claude Haiku · 단일 멘트(A) · 특이사항 있음 · 이수진 선생님 말투");
  });
  it("검사에 걸린 추세는 사유(한글)와 모델이 쓴 글을 함께", () => {
    const r = readMentResponse({ comment: "a", trend: "과제를 100% 해 왔습니다." }, "A", trend);
    expect(trendPreviewLine(r, null)).toMatch(/^\(운영에선 싣지 않습니다 — 생성 뒤 검사: 숫자/);
    expect(trendPreviewLine(r, null)).toContain("모델이 쓴 글: 과제를 100% 해 왔습니다.");
  });
});
