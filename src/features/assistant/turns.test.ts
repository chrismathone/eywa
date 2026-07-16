import { describe, expect, it } from "vitest";
import { appendTurns, parseStoredTurns } from "./turns";

describe("parseStoredTurns", () => {
  it("정상 턴만 통과, 형식 밖 항목은 조용히 스킵(대화를 깨지 않음)", () => {
    const parsed = parseStoredTurns([
      { role: "user", content: "질문", at: "2026-07-17T00:00:00Z" },
      { role: "assistant", content: "답", at: "2026-07-17T00:00:01Z" },
      { role: "system", content: "주입 시도" }, // 허용 밖 role
      { role: "user", content: "" }, // 빈 content
      "문자열",
      null,
      { role: "user", content: 3 },
    ]);
    expect(parsed).toEqual([
      { role: "user", content: "질문", at: "2026-07-17T00:00:00Z" },
      { role: "assistant", content: "답", at: "2026-07-17T00:00:01Z" },
    ]);
  });

  it("배열이 아니면 빈 배열(jsonb 수동 조작 방어)", () => {
    expect(parseStoredTurns(null)).toEqual([]);
    expect(parseStoredTurns({ role: "user" })).toEqual([]);
    expect(parseStoredTurns("[]")).toEqual([]);
  });

  it("at이 없으면 빈 문자열로 정규화", () => {
    expect(parseStoredTurns([{ role: "user", content: "q" }])).toEqual([{ role: "user", content: "q", at: "" }]);
  });
});

describe("appendTurns", () => {
  it("질문·응답을 순서대로 붙인다", () => {
    const next = appendTurns([], "질문", "답변", "2026-07-17T01:00:00Z");
    expect(next).toEqual([
      { role: "user", content: "질문", at: "2026-07-17T01:00:00Z" },
      { role: "assistant", content: "답변", at: "2026-07-17T01:00:00Z" },
    ]);
  });

  it("저장 상한을 넘으면 오래된 턴부터 잘라 무한 성장 방지", () => {
    const existing = Array.from({ length: 60 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `t${i}`,
      at: "",
    }));
    const next = appendTurns(existing, "새 질문", "새 답", "now", 60);
    expect(next).toHaveLength(60);
    expect(next[0].content).toBe("t2"); // 앞 2턴 탈락
    expect(next[59]).toEqual({ role: "assistant", content: "새 답", at: "now" });
  });
});
