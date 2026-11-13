/**
 * 개발 전용 — AI 호출을 학원 API 키 대신 내부 요금제 CLI(Claude `claude -p` · GPT `codex exec`)로 돌린다.
 * 실제 앱 경로(관문·하네스·단계 흐름)를 비용 없이 개발 서버에서 확인하려는 것이다.
 *
 * 🔴 운영에서는 절대 켜지지 않는다 — `AI_DEV_CLAUDE_CLI=1` + `NODE_ENV !== "production"` + Vercel 아님, 셋 다일 때만.
 * 🔴 관문은 generateJSON 것을 그대로 지난 뒤(사실 원칙·라이선스·모델 고정) 호출만 바꾼다. 문서(PDF) 첨부는 지원하지 않는다(평소 경로로).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Env = Record<string, string | undefined>;

/** CLI 한 번의 기록 — 요청 모델과 **실제로 답한 모델**(폴백이면 다르다)·시간·토큰. 토큰 값은 요금제라 청구되지 않는다(정가 환산만). */
export type DevCliTrace = {
  requestedModel: string;
  models: string[];
  cliVersion: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  listCostUsd: number | null;
};

/**
 * 시험 실행기 전용 관찰자(2026-10-26 크레딧 MVP) — 이 저장소 안에서 `run(관찰자, …)`로 감싼 호출만 CLI를 JSON 출력으로 돌려
 * 실제 응답 모델을 넘긴다. 감싸지 않은 호출(개발 서버)은 예전 그대로 글 출력이다.
 */
export const devCliTrace = new AsyncLocalStorage<(trace: DevCliTrace) => void>();

/** `claude -p --output-format json`의 봉투 → 답 글 + 기록(순수). 오류 봉투면 던진다. */
export function parseCliEnvelope(stdout: string, requestedModel: string): { text: string; trace: DevCliTrace } {
  const env = JSON.parse(stdout) as {
    is_error?: boolean; result?: unknown; duration_ms?: number; total_cost_usd?: number;
    api_error_status?: unknown; usage?: Record<string, number | undefined>;
    modelUsage?: Record<string, { canonicalModel?: string }>;
  };
  if (env.is_error || typeof env.result !== "string") throw new Error(`개발용 Claude CLI 오류 응답(${String(env.api_error_status ?? "원인 미상")})`);
  const models = Object.entries(env.modelUsage ?? {}).map(([k, v]) => v?.canonicalModel ?? k);
  const n = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    text: env.result,
    trace: {
      requestedModel, models, cliVersion: null, durationMs: n(env.duration_ms),
      inputTokens: n(env.usage?.input_tokens), outputTokens: n(env.usage?.output_tokens),
      cacheReadTokens: n(env.usage?.cache_read_input_tokens), cacheWriteTokens: n(env.usage?.cache_creation_input_tokens),
      listCostUsd: n(env.total_cost_usd),
    },
  };
}

/** `codex exec --json` JSONL에서 토큰을 모은다. 형식이 늘어나도 알 수 없는 이벤트는 건너뛴다. */
export function parseCodexJsonl(stdout: string, requestedModel: string, durationMs: number, cliVersion: string | null = null): DevCliTrace {
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let cacheReadTokens: number | null = null;
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    try {
      const event = JSON.parse(line) as { usage?: Record<string, unknown> };
      const usage = event.usage;
      if (!usage) continue;
      inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : inputTokens;
      outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : outputTokens;
      cacheReadTokens = typeof usage.cached_input_tokens === "number" ? usage.cached_input_tokens : cacheReadTokens;
    } catch {
      // JSONL이 아닌 진단 한 줄은 결과 파싱에 영향을 주지 않는다.
    }
  }
  return {
    requestedModel,
    models: [requestedModel],
    cliVersion,
    durationMs,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens: null,
    listCostUsd: null,
  };
}

export function devCliEnabled(env: Env = process.env): boolean {
  return env.AI_DEV_CLAUDE_CLI === "1" && env.NODE_ENV !== "production" && !env.VERCEL && !env.VERCEL_ENV;
}

export type DevCliInput = {
  model: string;
  prompt: string;
  system?: string;
  images?: { mediaType: string; dataBase64: string; label?: string }[];
  /** 비교 시험에서 운영 호출의 Claude 추론 강도를 그대로 넘길 때만 사용한다. 미지정이면 기존 CLI 기본값 그대로다. */
  reasoningEffort?: "low" | "medium" | "high";
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
 * Codex 요금제 실행 환경 = **허용 목록만** 넘긴다(검토 2026-11-12). `codex exec -s read-only`도 셸 명령은 돌릴 수 있어,
 * 개발 서버의 비밀값(`ANTHROPIC_API_KEY*`·`SUPABASE_SERVICE_ROLE_KEY`·`DATABASE_URL` 등)을 통째로 넘기면 전사문·학부모 글에
 * 심긴 지시로 결과에 섞일 수 있다. OpenAI API 키도 넘기지 않는다(요금제가 아니라 API로 과금될 수 있다).
 */
const CODEX_ENV_ALLOW = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|SYSTEMDRIVE|TEMP|TMP|TMPDIR|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|COMMONPROGRAMFILES|COMMONPROGRAMFILES\(X86\)|USERNAME|USER|LOGNAME|SHELL|TERM|LANG|LANGUAGE|LC_[A-Z_]+|TZ|NO_COLOR|XDG_[A-Z_]+|CODEX_HOME|AYWA_CODEX_BIN|HTTPS?_PROXY|NO_PROXY|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS)$/i;
export function codexCliEnv(env: Env = process.env): Env {
  const out: Env = {};
  for (const [k, v] of Object.entries(env)) if (CODEX_ENV_ALLOW.test(k)) out[k] = v;
  return out;
}

export type CodexCliInvocation = {
  command: string;
  prefixArgs: string[];
  binary: string;
};

/** Windows에서는 PATH의 오래된 codex.exe보다 npm의 codex.cmd를 명시해 같은 내부요금제 CLI 판을 쓴다. */
export function codexCliInvocation(env: Env = process.env, platform: NodeJS.Platform = process.platform): CodexCliInvocation {
  const configured = env.AYWA_CODEX_BIN?.trim();
  const binary = configured || (platform === "win32" ? "codex.cmd" : "codex");
  if (platform === "win32" && /\.(?:cmd|bat)$/i.test(binary)) {
    return {
      command: env.ComSpec?.trim() || env.COMSPEC?.trim() || "cmd.exe",
      prefixArgs: ["/d", "/s", "/c", binary],
      binary,
    };
  }
  return { command: binary, prefixArgs: [], binary };
}

/** MCP 경고가 실제 API 오류를 가리지 않게 마지막 ERROR 줄을 우선 보여 준다. */
export function summarizeCodexCliError(stderr: string, maxChars = 1_000): string {
  const lines = stderr
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/rmcp::/i.test(line));
  const errorLine = [...lines].reverse().find((line) => /\bERROR\b/i.test(line));
  const detail = errorLine ?? lines.at(-1) ?? "표준 오류 내용 없음";
  return detail.length > maxChars ? `${detail.slice(0, maxChars - 1)}…` : detail;
}

let codexVersionCache: { key: string; value: Promise<string> } | null = null;

/**
 * 🔴 Codex 실행은 명령이 실행 중에 정해진다(`codex.cmd`·`AYWA_CODEX_BIN`). 정적 import한 `spawn`·`execFile`에 그런 명령을 넘기면
 * Turbopack이 인자를 파일 참조로 읽어 **프로젝트 전체를 서버 함수에 싣는다**(2026-11-12 배포 실패 — 'enrollment' 함수 254MB > 한도 250MB ·
 * 경고 'Encountered unexpected file in NFT list'). 개발 전용 경로라 실행할 때만 내장 모듈을 꺼낸다 — 정적 import로 되돌리지 말 것.
 */
function devChildProcess() {
  return process.getBuiltinModule("node:child_process");
}

/** 선택한 Codex 실행 파일의 판을 모델 호출 전에 한 번 확인하고 이후 호출에서 재사용한다. */
export async function getCodexCliVersion(): Promise<string> {
  const invocation = codexCliInvocation();
  const key = JSON.stringify(invocation);
  if (codexVersionCache?.key === key) return codexVersionCache.value;
  const value = (async () => {
    try {
      const { stdout } = await promisify(devChildProcess().execFile)(invocation.command, [...invocation.prefixArgs, "--version"], {
        env: codexCliEnv() as NodeJS.ProcessEnv,
        timeout: 30_000,
        windowsHide: true,
      });
      const version = String(stdout).trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "";
      if (!version) throw new Error("버전 출력이 비었습니다");
      return version;
    } catch (error) {
      const e = error as Error & { stderr?: string | Buffer };
      const detail = e.stderr ? summarizeCodexCliError(String(e.stderr)) : e.message;
      throw new Error(`개발용 Codex CLI 판 확인 실패(${invocation.binary}): ${detail}`);
    }
  })();
  codexVersionCache = { key, value };
  try {
    return await value;
  } catch (error) {
    if (codexVersionCache?.value === value) codexVersionCache = null;
    throw error;
  }
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
    const observe = devCliTrace.getStore();
    const args = [
      "-p", "--model", input.model,
      ...(input.reasoningEffort ? ["--effort", input.reasoningEffort] : []),
      "--output-format", observe ? "json" : "text", "--allowedTools", "Read", "--add-dir", dir,
    ];
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
        if (code !== 0 || !out.trim()) return reject(new Error(`개발용 Claude CLI 실패(코드 ${code}): ${err.slice(0, 200)}`));
        if (!observe) return resolve(out);
        try {
          const { text, trace } = parseCliEnvelope(out, input.model);
          observe(trace);
          resolve(text);
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** OpenAI가 첫 후보인 개발 호출을 Codex 내부요금제로 실행하고 마지막 답만 돌려준다. */
export async function runCodexCli(
  input: DevCliInput & { reasoningEffort: "low" | "medium" | "high" },
): Promise<string> {
  if (input.images?.length) throw new Error("개발용 Codex CLI는 이미지 첨부를 지원하지 않습니다");
  const invocation = codexCliInvocation();
  const cliVersion = await getCodexCliVersion();
  const dir = await mkdtemp(join(tmpdir(), "aywa-codex-cli-"));
  const outputPath = join(dir, "last-message.txt");
  try {
    const prompt = devCliPrompt(input, []);
    const observe = devCliTrace.getStore();
    const args = [
      "exec", "-s", "read-only", "--skip-git-repo-check", "--ephemeral",
      "-m", input.model, "-c", `model_reasoning_effort=\"${input.reasoningEffort}\"`,
      ...(observe ? ["--json"] : []),
      "--output-last-message", outputPath, "-",
    ];
    const startedAt = Date.now();
    let stdout = "";
    await new Promise<void>((resolve, reject) => {
      const child = devChildProcess().spawn(invocation.command, [...invocation.prefixArgs, ...args], {
        cwd: dir,
        env: codexCliEnv() as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      child.stdin.on("error", () => {});
      child.stdin.end(prompt);
      let err = "";
      const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("개발용 Codex CLI 응답 시간 초과")); }, TIMEOUT_MS);
      child.stdout.on("data", (c: Buffer) => { stdout += c.toString(); });
      child.stderr.on("data", (c: Buffer) => { err += c.toString(); });
      child.on("error", (e) => { clearTimeout(timer); reject(new Error(`개발용 Codex CLI 실행 실패: ${e.message}`)); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(`개발용 Codex CLI 실패(코드 ${code}): ${summarizeCodexCliError(err)}`));
        else resolve();
      });
    });
    const answer = (await readFile(outputPath, "utf8")).trim();
    if (!answer) throw new Error("개발용 Codex CLI가 마지막 답을 남기지 않았습니다");
    observe?.(parseCodexJsonl(stdout, input.model, Date.now() - startedAt, cliVersion));
    return answer;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
