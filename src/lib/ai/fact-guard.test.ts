import { describe, it, expect } from "vitest";
import { FACT_GUARD, withFactGuard } from "./fact-guard";

describe("FACT_GUARD — 원장이 지정한 5개 원칙이 문자 그대로 들어 있다", () => {
  // 원장 지시(2026-07-23) 원문: '팩트' '환각금지' '사실만 작성' '창작 금지' '추측 금지'.
  // 문구를 완화·삭제하면 이 테스트가 깨진다(의도된 잠금).
  it.each(["팩트", "환각 금지", "사실만", "창작 금지", "추측 금지"])("'%s' 포함", (word) => {
    expect(FACT_GUARD).toContain(word);
  });
});

describe("withFactGuard", () => {
  it("프롬프트 앞에 붙는다", () => {
    const out = withFactGuard("오늘 진도를 요약하세요.");
    expect(out.startsWith(FACT_GUARD)).toBe(true);
    expect(out).toContain("오늘 진도를 요약하세요.");
  });

  it("멱등 — 이미 붙어 있으면 중복되지 않는다", () => {
    const once = withFactGuard("본문");
    expect(withFactGuard(once)).toBe(once);
    expect(once.split("[사실 원칙 — 예외 없이 적용]")).toHaveLength(2);
  });

  it("원문을 훼손하지 않는다(JSON mode 필수 단어 등 보존)", () => {
    const body = 'JSON만 출력: {"comment": "..."}';
    expect(withFactGuard(body)).toContain(body);
  });
});
