import { describe, expect, it } from "vitest";
import {
  BUILTIN_ENGLISH_JJ_TEMPLATE,
  BUILTIN_ENGLISH_TEMPLATE,
  BUILTIN_ENGLISH_TEMPLATES,
  ENGLISH_TEMPLATE_TOKEN_KEYS,
  TEMPLATE_BODY_MAX,
  TEMPLATE_DECORATION_TOKENS,
  builtinTemplateLabelKey,
} from "./defaults";
import { fillReportTemplate, templateTokens } from "./fill";
import { splitImageSlots } from "./image-slots";

describe("기본 영어 템플릿", () => {
  it("쓰는 토큰이 전부 토큰 목록에 있다(모르는 토큰이면 그 줄이 조용히 빠진다)", () => {
    const unknown = templateTokens(BUILTIN_ENGLISH_TEMPLATE.body).filter(
      (t) => !(ENGLISH_TEMPLATE_TOKEN_KEYS as readonly string[]).includes(t),
    );
    expect(unknown).toEqual([]);
  });

  it("본문 상한 안에 들어간다", () => {
    expect(BUILTIN_ENGLISH_TEMPLATE.body.length).toBeLessThan(TEMPLATE_BODY_MAX);
  });

  it("사용자가 보내 준 EiE 글 모양으로 채워진다", () => {
    const r = fillReportTemplate(BUILTIN_ENGLISH_TEMPLATE.body, {
      학생: "공서연",
      작성자: "부원장",
      인사말: "밝고 활기찬 에너지로 수업에 참여했습니다.",
      진도:
        "원어민 선생님 수업 : Classroom English 발화 연습 + e-book Book Report\n" +
        "부원장 선생님 수업 : Unit 1~3 핵심 내용 전체 리뷰",
      테스트: "단어 테스트 진행 (31~40번)",
      숙제: "Work Book : p.30~33 풀어오기",
      다음테스트: "단어 시험 : 71~80번",
      코멘트: "서연이가 구문 감각을 잘 발휘해 주었습니다.",
    });
    expect(r.unknownTokens).toEqual([]);
    expect(r.text.startsWith("안녕하세요 학부모님, 부원장입니다! 😊❤️\n\n밝고 활기찬")).toBe(true);
    expect(r.text).toContain("📍 오늘의 진도\n원어민 선생님 수업 :");
    expect(r.text).toContain("테스트 : 단어 테스트 진행 (31~40번)");
    expect(r.text).toContain("💡 다음 시간 테스트 안내\n단어 시험 : 71~80번\n(※ 오늘 재시가");
    expect(r.text.endsWith("💌 부원장 코멘트 (Feedback)\n서연이가 구문 감각을 잘 발휘해 주었습니다.")).toBe(true);
  });

  it("다음 테스트가 없으면 재시험 안내 문장까지 문단째 빠진다", () => {
    const r = fillReportTemplate(BUILTIN_ENGLISH_TEMPLATE.body, {
      작성자: "부원장",
      인사말: "",
      진도: "Unit 4",
      테스트: "",
      숙제: "",
      다음테스트: "",
      코멘트: "좋았습니다.",
    });
    expect(r.text).not.toContain("재시가");
    expect(r.text).not.toContain("📅 오늘의 숙제");
    expect(r.text).toContain("📍 오늘의 진도\nUnit 4");
  });
});

describe("기본 템플릿 + 인재원 결과지(2026-09-11)", () => {
  const BASE = {
    작성자: "부원장",
    인사말: "",
    진도: "Unit 4",
    테스트: "일일 20문제 중 18개 맞음",
    숙제: "",
    다음테스트: "",
    코멘트: "좋았습니다.",
  };
  const fill = (body: string, values: Record<string, string>) =>
    fillReportTemplate(body, values, { decorationTokens: TEMPLATE_DECORATION_TOKENS });

  it("🔴 원래 기본 템플릿엔 그림 칸이 없다 — 쓰던 글·지문이 흔들리지 않게", () => {
    expect(templateTokens(BUILTIN_ENGLISH_TEMPLATE.body)).not.toContain("시험결과지");
    expect(templateTokens(BUILTIN_ENGLISH_TEMPLATE.body)).not.toContain("학습분석지");
  });

  it("쓰는 토큰이 전부 목록에 있고 상한 안이다", () => {
    const unknown = templateTokens(BUILTIN_ENGLISH_JJ_TEMPLATE.body).filter(
      (t) => !(ENGLISH_TEMPLATE_TOKEN_KEYS as readonly string[]).includes(t),
    );
    expect(unknown).toEqual([]);
    expect(BUILTIN_ENGLISH_JJ_TEMPLATE.body.length).toBeLessThan(TEMPLATE_BODY_MAX);
    // 2026-10-26 — 항목 보고서(기본)가 맨 앞, 옛 두 기본 템플릿은 그대로 남는다.
    // 2026-10-26 오후 — JJ 수업보고서가 맨 뒤에 붙는다(기본 자리는 그대로 항목 보고서).
    expect(BUILTIN_ENGLISH_TEMPLATES.map((t) => t.id)).toEqual([
      "builtin:english-sheet",
      BUILTIN_ENGLISH_TEMPLATE.id,
      BUILTIN_ENGLISH_JJ_TEMPLATE.id,
      "builtin:english-jj-sheet",
      // 2026-11-05 — EiE 일일·월간 보고서가 맨 뒤.
      "builtin:eie-daily",
      "builtin:eie-monthly",
    ]);
    expect(BUILTIN_ENGLISH_TEMPLATES.every((t) => t.builtIn && t.id.startsWith("builtin:"))).toBe(true);
  });

  it("🔑 자료가 없는 날엔 원래 기본 템플릿과 글자 하나 다르지 않다(그림 문단째 빠진다)", () => {
    const none = fill(BUILTIN_ENGLISH_JJ_TEMPLATE.body, { ...BASE, 시험결과지: "", 학습분석지: "" });
    expect(none.text).toBe(fill(BUILTIN_ENGLISH_TEMPLATE.body, BASE).text);
    expect(none.text).not.toContain("[");
  });

  it("자료가 있으면 자리 줄이 진도·테스트 뒤 · 코멘트 뒤에 선다", () => {
    const both = fill(BUILTIN_ENGLISH_JJ_TEMPLATE.body, { ...BASE, 시험결과지: "[시험결과지]", 학습분석지: "[학습분석지]" });
    const segs = splitImageSlots(both.text);
    expect(segs.filter((s) => s.kind === "slot").map((s) => (s.kind === "slot" ? s.key : ""))).toEqual([
      "시험결과지",
      "학습분석지",
    ]);
    expect(both.text.indexOf("테스트 : ")).toBeLessThan(both.text.indexOf("[시험결과지]"));
    expect(both.text.indexOf("좋았습니다.")).toBeLessThan(both.text.indexOf("[학습분석지]"));
  });

  it("기본 템플릿 이름은 id마다 제 문구 키", () => {
    expect(builtinTemplateLabelKey(BUILTIN_ENGLISH_TEMPLATE.id)).toBe("os.tpl.builtinName");
    expect(builtinTemplateLabelKey(BUILTIN_ENGLISH_JJ_TEMPLATE.id)).toBe("os.tpl.builtinJjName");
  });
});
