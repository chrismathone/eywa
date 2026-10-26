import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURE_MODELS } from "./model-pins";
import { resolveModelChain } from "./models";

/**
 * **AI 1순위는 Claude · DeepSeek은 폴백만** — 원장 2026-10-26 *"딥시크로 바꾼거 다 클로드로 전환"* ·
 * *"전사 분석은 전부 sonnet 5.5로 돌리고, 간단하고 빠르게 작성해야하는 수업보고서 멘트는 haiku 5.5로"* · *"폴백으로 딥시크 남겨놔"*.
 * 기능 코드가 DeepSeek을 먼저 고르는 자리(`provider: "deepseek"` · 매개변수 기본값 · 인자로 넘기기)가 다시 생기면 실패한다.
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
const DEEPSEEK_FIRST = [/provider:\s*["']deepseek["']/, /AiProvider\s*=\s*["']deepseek["']/, /,\s*["']deepseek["']\s*,\s*\{/];

describe("AI 1순위 = Claude · DeepSeek은 폴백(2026-10-26)", () => {
  it("기능 코드(src/lib/ai 밖)에 DeepSeek을 먼저 고르는 자리가 없다", () => {
    const hits = sources(join(ROOT, "src"))
      .filter((f) => !f.startsWith("src/lib/ai/"))
      .flatMap((f) =>
        readFileSync(join(ROOT, f), "utf8")
          .split("\n")
          .map((line, i) => ({ f, no: i + 1, line }))
          .filter(({ line }) => DEEPSEEK_FIRST.some((re) => re.test(line))),
      )
      .map(({ f, no, line }) => `${f}:${no}  ${line.trim().slice(0, 100)}`);
    expect(hits).toEqual([]);
  });
  it("코드 기본 고정 모델은 전부 Claude", () => {
    expect(Object.entries(FEATURE_MODELS).filter(([, pin]) => pin.provider !== "anthropic")).toEqual([]);
  });
  it("폴백 사다리는 Claude → DeepSeek 그대로(원장 '폴백으로 딥시크 남겨놔')", () => {
    const names = ["AI_PROVIDER", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY"] as const;
    const prev = Object.fromEntries(names.map((n) => [n, process.env[n]]));
    delete process.env.AI_PROVIDER;
    process.env.ANTHROPIC_API_KEY = "test-key"; // 후보는 키가 있는 회사만 선다 — 시험용 가짜 값
    process.env.DEEPSEEK_API_KEY = "test-key";
    try {
      for (const tier of ["fast", "balanced"] as const) {
        expect(resolveModelChain(tier).map((c) => c.provider), tier).toEqual(["anthropic", "deepseek"]);
      }
      // 전사 분석 고정(Sonnet 5.5)도 막히면 DeepSeek으로 넘어간다.
      expect(resolveModelChain("balanced", "default", undefined, null, FEATURE_MODELS.meeting_analysis).map((c) => c.provider)).toEqual(["anthropic", "deepseek"]);
    } finally {
      for (const n of names) {
        if (prev[n] === undefined) delete process.env[n];
        else process.env[n] = prev[n];
      }
    }
  });
});
