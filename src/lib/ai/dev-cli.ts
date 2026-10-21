/**
 * 개발 전용 — AI 호출을 학원 API 키 대신 **내부 요금제 Claude CLI(`claude -p`)**로 돌린다(원장 2026-10-21 "개발서버도 -p 이용하면 되잖아").
 * 실제 앱 경로(관문·하네스·단계 흐름)를 비용 없이 개발 서버에서 확인하려는 것이다.
 *
 * 🔴 운영에서는 절대 켜지지 않는다 — `AI_DEV_CLAUDE_CLI=1` + `NODE_ENV !== "production"` + Vercel 아님, 셋 다일 때만.
 * 🔴 관문은 generateJSON 것을 그대로 지난 뒤(사실 원칙·라이선스·모델 고정) 호출만 바꾼다. 문서(PDF) 첨부는 지원하지 않는다(평소 경로로).
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Env = Record<string, string | undefined>;

export function devCliEnabled(env: Env = process.env): boolean {
  return env.AI_DEV_CLAUDE_CLI === "1" && env.NODE_ENV !== "production" && !env.VERCEL && !env.VERCEL_ENV;
}

export type DevCliInput = {
  model: string;
  prompt: string;
  system?: string;
  images?: { mediaType: string; dataBase64: string; label?: string }[];
};

const SAFE_NAME = /[^A-Za-z0-9_-]/g;
const TIMEOUT_MS = 10 * 60_000;

/** 프롬프트 조립(순수) — 화면은 파일 경로로 넘기고 Read로 열게 한다. */
export function devCliPrompt(input: DevCliInput, files: readonly { label: string; path: string }[]): string {
  return [
    input.system ? `[시스템 지침]\n${input.system}` : "",
    input.prompt,
    files.length ? `[첨부 화면 파일] Read 도구로 아래 파일을 모두 열어 본다(파일 이름 = 화면 이름):\n${files.map((f) => `${f.label}: ${f.path}`).join("\n")}` : "",
    "위 자료 말고 다른 파일은 열지 말고, 파일을 만들거나 고치지 말고, 답은 JSON 하나만 출력하라.",
  ].filter(Boolean).join("\n\n");
}

/**
 * CLI에 넘기는 환경 — 🔴 Anthropic 키를 전부 뺀다. 개발 서버는 .env.local의 학원 API 키를 들고 있어서, 그대로 넘기면
 * CLI가 로그인(요금제)이 아니라 **API 키로 과금**된다.
 */
export function cliEnv(env: Env = process.env): Env {
  const out: Env = { ...env };
  for (const k of Object.keys(out)) if (/^ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL)/.test(k)) delete out[k];
  return out;
}

/**
 * 🔴 CLI가 **구독 로그인(claude.ai)**으로 돌 때만 쓴다 — 사용자 설정의 `env.ANTHROPIC_API_KEY`·`apiKeyHelper`는 환경변수를 지워도
 * 남아 로그인보다 먼저 쓰인다(적대 리뷰 2026-10-21 재현). **호출마다** 확인하고(로그인이 중간에 바뀌어도 잡게), 아니면 던진다.
 */
export async function assertSubscriptionAuth(): Promise<void> {
  const { stdout } = await promisify(execFile)("claude", ["auth", "status"], { env: cliEnv() as NodeJS.ProcessEnv, timeout: 30_000 });
  const method = (JSON.parse(stdout) as { authMethod?: string }).authMethod;
  if (method !== "claude.ai") throw new Error(`개발용 Claude CLI가 요금제 로그인이 아닙니다(${method ?? "알 수 없음"}) — API 과금을 막으려고 멈춥니다`);
}

export async function runDevCli(input: DevCliInput): Promise<string> {
  await assertSubscriptionAuth();
  const dir = await mkdtemp(join(tmpdir(), "aywa-dev-cli-"));
  try {
    const files = await Promise.all((input.images ?? []).map(async (img, i) => {
      const label = (img.label ?? `image_${i + 1}`).replace(SAFE_NAME, "_");
      const path = join(dir, `${String(i + 1).padStart(2, "0")}_${label}.${img.mediaType === "image/png" ? "png" : "jpg"}`);
      await writeFile(path, Buffer.from(img.dataBase64, "base64"));
      return { label: img.label ?? label, path };
    }));
    // 프롬프트는 표준 입력으로 — 명령 인자로 넘기면 긴 판정 자료가 OS 인자 한도(E2BIG)에 걸린다(적대 리뷰 2026-10-21).
    const prompt = devCliPrompt(input, files);
    const args = ["-p", "--model", input.model, "--output-format", "text", "--allowedTools", "Read", "--add-dir", dir];
    return await new Promise<string>((resolve, reject) => {
      const child = spawn("claude", args, { cwd: dir, env: cliEnv() as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] });
      // 자식이 입력을 받기 전에 끝나면 EPIPE가 stdin에서 난다 — 여기서 받지 않으면 개발 서버 프로세스가 죽는다(결과는 close가 알린다).
      child.stdin.on("error", () => {});
      child.stdin.end(prompt);
      let out = "";
      let err = "";
      const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("개발용 Claude CLI 응답 시간 초과")); }, TIMEOUT_MS);
      child.stdout.on("data", (c: Buffer) => { out += c.toString(); });
      child.stderr.on("data", (c: Buffer) => { err += c.toString(); });
      child.on("error", (e) => { clearTimeout(timer); reject(new Error(`개발용 Claude CLI 실행 실패: ${e.message}`)); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0 && out.trim()) resolve(out);
        else reject(new Error(`개발용 Claude CLI 실패(코드 ${code}): ${err.slice(0, 200)}`));
      });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
