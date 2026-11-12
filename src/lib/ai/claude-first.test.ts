import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURE_MODELS } from "./model-pins";
import { resolveModelChain } from "./models";

/**
 * **AI 1순위는 Claude · OpenAI는 폴백만** — 원장 2026-11-12 *"CLAUDE를 메인으로, 폴백은 GPT로"*.
 * 기능 코드가 OpenAI을 먼저 고르는 자리(`provider: "openai"` · 매개변수 기본값 · 인자로 넘기기)가 다시 생기면 실패한다.
 * 지점마다 다른 모델은 운영 콘솔 'AI 모델' 탭(`tenant_ai_models`)이 고른다 — 코드 기본은 Claude다.
 */
const ROOT = process.cwd();
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(relative(ROOT, p).split(sep).join("/"));
  }
  return out;
}
const OPENAI_FIRST = [/provider:\s*["']openai["']/, /AiProvider\s*=\s*["']openai["']/, /,\s*["']openai["']\s*,\s*\{/];

describe("AI 1순위 = Claude · OpenAI는 폴백(2026-11-12)", () => {
  it("기능 코드(src/lib/ai 밖)에 OpenAI을 먼저 고르는 자리가 없다", () => {
    const hits = sources(join(ROOT, "src"))
      .filter((f) => !f.startsWith("src/lib/ai/"))
      .flatMap((f) =>
        readFileSync(join(ROOT, f), "utf8")
          .split("\n")
          .map((line, i) => ({ f, no: i + 1, line }))
          .filter(({ line }) => OPENAI_FIRST.some((re) => re.test(line))),
      )
      .map(({ f, no, line }) => `${f}:${no}  ${line.trim().slice(0, 100)}`);
    expect(hits).toEqual([]);
  });
  it("코드 기본 고정 모델은 전부 Claude", () => {
    expect(Object.entries(FEATURE_MODELS).filter(([, pin]) => pin.provider !== "anthropic")).toEqual([]);
  });
  it("폴백 사다리는 Claude → OpenAI", () => {
    const names = ["AI_PROVIDER", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"] as const;
    const prev = Object.fromEntries(names.map((n) => [n, process.env[n]]));
    delete process.env.AI_PROVIDER;
    process.env.ANTHROPIC_API_KEY = "test-key"; // 후보는 키가 있는 회사만 선다 — 시험용 가짜 값
    process.env.OPENAI_API_KEY = "test-key";
    try {
      for (const tier of ["fast", "balanced"] as const) {
        expect(resolveModelChain(tier).map((c) => c.provider), tier).toEqual(["anthropic", "openai"]);
      }
      // 전사 분석 고정(Sonnet 5.5)도 막히면 OpenAI으로 넘어간다.
      expect(resolveModelChain("balanced", "default", undefined, null, FEATURE_MODELS.meeting_analysis).map((c) => c.provider)).toEqual(["anthropic", "openai"]);
    } finally {
      for (const n of names) {
        if (prev[n] === undefined) delete process.env[n];
        else process.env[n] = prev[n];
      }
    }
  });
});
