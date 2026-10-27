import { describe, expect, it } from "vitest";
import { mergePilotDraft, parsePilotSections, pilotSectionBody } from "./pilot-merge";

const auto = [
  "■ 진도\n우리 지원이는 오늘 비례식을 배웠습니다.",
  "■ 일일 테스트\n10문제 중 8개 맞음",
  "■ 수업 태도\n집중해서 잘 참여했습니다.",
  "■ 오늘의 수업\nAI가 쓴 오늘 수업 이야기.",
  "■ 오늘의 숙제\n쎈 10-12p",
  "■ 사랑의 한마디\n오늘도 잘했어!",
].join("\n\n");

describe("새 수학 보고서 — 고친 글에 바뀐 값만 맞추기", () => {
  it("항목을 읽는다(첫 ■ 앞 글 포함)", () => {
    const p = parsePilotSections(`인사 한 줄\n\n${auto}`);
    expect(p.head).toBe("인사 한 줄");
    expect(p.sections.map((s) => s.title)).toEqual(["진도", "일일 테스트", "수업 태도", "오늘의 수업", "오늘의 숙제", "사랑의 한마디"]);
    expect(pilotSectionBody(auto, "오늘의 수업")).toBe("AI가 쓴 오늘 수업 이야기.");
  });

  it("고친 '오늘의 수업'·손댄 항목은 그대로, 손대지 않은 항목은 새 값으로", () => {
    const draft = auto
      .replace("AI가 쓴 오늘 수업 이야기.", "선생님이 고친 오늘 수업 이야기.")
      .replace("집중해서 잘 참여했습니다.", "선생님이 고친 태도 문장.");
    // 서버가 다시 짠 글 — 오늘의 수업은 고친 글 그대로, 시험은 '시험 없음'으로 바뀜, 태도도 바뀜.
    const fresh = [
      "■ 진도\n우리 지원이는 오늘 비례식을 배웠습니다.",
      "■ 일일 테스트\n오늘은 몸이 좋지 않아 일일 테스트를 보지 않았습니다.",
      "■ 수업 태도\n새 태도 문장.",
      "■ 오늘의 수업\n선생님이 고친 오늘 수업 이야기.",
      "■ 오늘의 숙제\n쎈 10-12p",
      "■ 사랑의 한마디\n오늘도 잘했어!",
    ].join("\n\n");
    const out = mergePilotDraft(draft, auto, fresh);
    expect(out.draft).toContain("선생님이 고친 오늘 수업 이야기.");
    expect(out.draft).toContain("선생님이 고친 태도 문장.");
    expect(out.draft).toContain("일일 테스트를 보지 않았습니다");
    expect(out.draft).not.toContain("10문제 중 8개");
    // 원문(autoDraft)엔 AI의 오늘의 수업이 남는다.
    expect(out.autoDraft).toContain("AI가 쓴 오늘 수업 이야기.");
    expect(out.autoDraft).toContain("새 태도 문장.");
  });

  it("사라진 사실 항목은 빠지고, 선생님이 만든 항목은 한마디 앞에 남는다", () => {
    const draft = auto.replace("■ 사랑의 한마디", "■ 덧붙임\n선생님이 만든 항목\n\n■ 사랑의 한마디");
    const fresh = auto.replace("■ 일일 테스트\n10문제 중 8개 맞음\n\n", "");
    const out = mergePilotDraft(draft, auto, fresh);
    expect(out.draft).not.toContain("■ 일일 테스트");
    expect(out.draft.indexOf("■ 덧붙임")).toBeLessThan(out.draft.indexOf("■ 사랑의 한마디"));
    expect(out.draft.endsWith("오늘도 잘했어!")).toBe(true);
  });
});
