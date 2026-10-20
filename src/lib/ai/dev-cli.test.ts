import { describe, expect, it } from "vitest";
import { cliEnv, devCliEnabled, devCliPrompt } from "./dev-cli";

describe("개발 전용 Claude CLI 갈래", () => {
  it("🔴 운영·Vercel에서는 절대 켜지지 않는다", () => {
    expect(devCliEnabled({ AI_DEV_CLAUDE_CLI: "1", NODE_ENV: "development" })).toBe(true);
    expect(devCliEnabled({ AI_DEV_CLAUDE_CLI: "1", NODE_ENV: "production" })).toBe(false);
    expect(devCliEnabled({ AI_DEV_CLAUDE_CLI: "1", NODE_ENV: "development", VERCEL: "1" })).toBe(false);
    expect(devCliEnabled({ AI_DEV_CLAUDE_CLI: "1", NODE_ENV: "development", VERCEL_ENV: "preview" })).toBe(false);
    expect(devCliEnabled({ NODE_ENV: "development" })).toBe(false);
  });
  it("🔴 CLI에는 Anthropic 키를 넘기지 않는다(요금제 로그인으로만 돈다)", () => {
    const env = cliEnv({ ANTHROPIC_API_KEY: "k", ANTHROPIC_API_KEY_VIDEO: "g", ANTHROPIC_AUTH_TOKEN: "t", PATH: "/bin" });
    expect(env).toEqual({ PATH: "/bin" });
  });
  it("화면 파일 경로와 이름을 프롬프트에 싣는다", () => {
    const p = devCliPrompt({ model: "m", prompt: "판정", system: "지침" }, [{ label: "f01_00m05s", path: "/tmp/a.jpg" }]);
    expect(p).toContain("[시스템 지침]\n지침");
    expect(p).toContain("f01_00m05s: /tmp/a.jpg");
    expect(p).toContain("JSON 하나만");
  });
});
