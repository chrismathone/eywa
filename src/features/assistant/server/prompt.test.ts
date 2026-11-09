// 학원 비서 시스템 프롬프트 — 사실 원칙 · 온톨로지 · 비서 의견 · 캐시(바뀌는 값 없음).
import { describe, expect, it } from "vitest";
import { FACT_GUARD } from "@/lib/ai/fact-guard";
import { ONTOLOGY_MAP } from "../catalog/ontology";
import { buildSystemPrompt, catalogLines, pastAnswerText, questionMessage } from "./prompt";

const docs = [
  { name: "students", label: "원생", ko: "원생 기본 정보" },
  { name: "sync_queue", label: "동기화 대기", ko: "내부 대기열", internal: true as const },
];

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt(catalogLines(docs, new Set(["students", "sync_queue", "brand_new"])));
  it("🔴 사실 원칙이 맨 앞에(자체 루프 — CLAUDE.md '사실 원칙')", () => {
    expect(prompt.startsWith(FACT_GUARD)).toBe(true);
  });
  it("온톨로지 지도와 비서 의견 규칙이 들어 있다", () => {
    expect(prompt).toContain(ONTOLOGY_MAP);
    expect(prompt).toMatch(/비서 의견\(advice\) 블록을 꼭 하나/);
    expect(prompt).toMatch(/형식적인 보고서 작성기가 아니다/);
  });
  it("표 목록 — 설명 있는 표 · 내부 표 · 설명 없는 새 표", () => {
    expect(prompt).toContain("- students: 원생 기본 정보");
    expect(prompt).toMatch(/내부 기록 표.*sync_queue/);
    expect(prompt).toMatch(/설명이 아직 없는 표.*brand_new/);
  });
  it("글은 문단으로 나눠 쓰고 · 강사별 비교는 재직 기간 기준(원장 2026-11-09)", () => {
    expect(prompt).toMatch(/한 문단 2~3문장/);
    expect(prompt).toMatch(/list 블록으로 뺀다/);
    expect(prompt).toMatch(/\*\*재직 기간 기준\*\*/);
    expect(prompt).toMatch(/users\.hire_date/);
    expect(prompt).toMatch(/terms에 '퇴사'가 들어간 줄의 start_date/);
    expect(prompt).toMatch(/마지막 복직 기록.*보다 앞이면 옛 재직의 끝이다/);
    expect(prompt).toMatch(/changed->'status'->>'new'='inactive'/);
    expect(prompt).toMatch(/재직 기간을 확인하지 못해 뺐습니다/);
    expect(prompt).toMatch(/action='staff_status_change'/);
    expect(prompt).toMatch(/기간 끝\(valid_to\)으로 재직 끝을 정하지 않는다/);
    expect(prompt).toMatch(/강사와 상관없이 학원 전체 기록 그대로 센다/);
    expect(prompt).toMatch(/'\(담임 없음\)'/);
  });
  it("답의 질 — 모든 요인 종합 · 원장 입장 · 애매한 말·지어내기·추측 금지(원장 2026-11-09)", () => {
    expect(prompt).toMatch(/## 답의 질/);
    expect(prompt).toMatch(/요인을 빠짐없이 조회한 뒤 함께 판단한다/);
    expect(prompt).toMatch(/시기가 겹친다는 것만으로 원인이라 하지 않는다/);
    expect(prompt).toMatch(/애매한 말 금지/);
    expect(prompt).toMatch(/숫자의 한계.*흐린 말이 아니다/);
    expect(prompt).toMatch(/"~ 때문입니다"로 단정하지 않고/);
    expect(prompt).toMatch(/지어내지 않는다/);
  });
  it("바뀌는 값(오늘 날짜)이 없다 — 캐시가 깨지지 않게", () => {
    expect(prompt).not.toMatch(/20\d\d-\d\d-\d\d/);
    expect(buildSystemPrompt("x")).toBe(buildSystemPrompt("x"));
  });
});

describe("questionMessage · pastAnswerText", () => {
  it("오늘(한국 시간)을 질문에 붙인다", () => {
    expect(questionMessage("재원생은?", new Date("2026-11-06T15:30:00Z"))).toBe("오늘은 2026-11-07(토) · 지금 00:30(한국 시간)\n\n질문: 재원생은?");
  });
  it("지난 답은 요약·비서 의견·조회만 짧게", () => {
    const text = pastAnswerText({
      question: "재원생은?",
      report: {
        title: "재원생",
        blocks: [
          { type: "summary", text: "31명입니다." },
          { type: "advice", items: [{ action: "휴원생 3명 연락", why: "2주째 휴원" }] },
          { type: "table", title: "반별", query: "q1", columns: [{ column: "반", label: "반" }] },
        ],
      },
      queries: [{ id: "q1", purpose: "반별 인원", sql: "select\n  1" }],
    });
    expect(text).toContain("31명입니다.");
    expect(text).toContain("[비서 의견] 휴원생 3명 연락 — 2주째 휴원");
    expect(text).toContain("(표 반별)");
    expect(text).toContain("- 반별 인원: select 1");
    // 지난 차례의 조회 번호는 넣지 않는다(새 차례도 q1부터 센다).
    expect(text).not.toMatch(/\bq1\b/);
  });
  it("지난 답의 강조 표시는 벗기고 글자만 넘긴다", () => {
    const text = pastAnswerText({
      question: "퇴원은?",
      report: {
        title: "퇴원",
        blocks: [
          { type: "summary", text: "퇴원 **8명** 중 [[bad:불만족 3명]]" },
          { type: "callout", tone: "warn", title: "[[warn:주의]]", text: "**BS3B** 7명" },
          { type: "list", items: ["[[good:출석 95%]]"] },
          { type: "advice", items: [{ action: "**담임** 면담", why: "[[bad:**7명**]] 퇴원" }] },
        ],
      },
      queries: [],
    });
    expect(text).toContain("퇴원 8명 중 불만족 3명");
    expect(text).toContain("주의: BS3B 7명");
    expect(text).toContain("- 출석 95%");
    expect(text).toContain("[비서 의견] 담임 면담 — 7명 퇴원");
    expect(text).not.toMatch(/\*\*|\[\[/);
  });
  it("강조 규칙이 들어 있다(원장 서식 요청)", () => {
    const prompt = buildSystemPrompt("x");
    expect(prompt).toContain("[[bad:…]]");
    expect(prompt).toMatch(/한 문단에 서너 군데까지/);
  });
});
