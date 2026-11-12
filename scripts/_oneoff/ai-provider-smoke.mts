/**
 * Claude·Codex 내부요금제 품질 비교 + OpenAI API 최소 연결 확인.
 * 🔴 DB·라이선스·사용량 기록을 전혀 타지 않는다. 기본 모드는 `internal`이며 실제 API를 부르지 않는다.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { devCliTrace, getCodexCliVersion, runCodexCli, runDevCli, type DevCliTrace } from "../../src/lib/ai/dev-cli";
import { withFactGuard } from "../../src/lib/ai/fact-guard";
import { AI_MODELS, type AiTier } from "../../src/lib/ai/models";
import { openAIProfileFor } from "../../src/lib/ai/model-pins";
import { parseJsonLoose } from "../../src/lib/ai/generate";
import { mentSections, readMentResponse, stripSubjectLabel, type MentAssembly } from "../../src/features/onescreen/ment-assembly";
import { assembleCombined } from "../../src/features/onescreen/prompt-defaults";
import { normalizeIntent } from "../../src/features/attendance/parent-alerts/intent";
import { normalizeStudentConsultationReport, type StudentConsultationReport } from "../../src/features/consultations/analysis-prompt";
import { normalizeConsultationReport } from "../../src/features/enrollment/analysis-normalize";
import { normalizeExtractedForm } from "../../src/features/enrollment/form-normalize";
import { applyParentAddress, validatePrepBrief, type PrepFacts } from "../../src/features/enrollment/prep-brief";
import { normalizeMeetingAnalysis } from "../../src/features/meetings/analysis-normalize";
import { groundContractExtract, type RawContractExtract } from "../../src/features/staff/contract/contract-extract";
import { BUILT_IN_ANALYSIS_CASES, buildAnalysisCase, type AnalysisSeed } from "./ai-provider-cases";
import { compareMentRuns, measureAnalysisQuality, measureMentQuality } from "./ai-provider-metrics";

type Mode = "internal" | "claude-cli" | "codex-cli" | "openai-connectivity";
type Kind = "ment" | "consultation" | "form" | "classification" | "translation" | "meeting" | "studentConsultation" | "prep" | "contract";
type Case = {
  id: string;
  feature: string;
  kind: Kind;
  tier: Exclude<AiTier, "reasoning">;
  claudeEffort: "low" | "medium" | "high";
  prompt: string;
  sourceFacts: string;
  expectedFields: string[];
  claudeOnly?: boolean;
  mentMode?: "A" | "B";
  mustCapture?: AnalysisSeed["mustCapture"];
  inputName?: string;
  multi?: boolean;
  messageDates?: Record<string, string>;
  prepFacts?: PrepFacts;
};
type InputFile = {
  version: 1;
  ment?: Array<{ id: string; input: MentAssembly["input"] & { storedProgress?: string }; mode?: "A" | "B" }>;
  analyses?: AnalysisSeed[];
};
type Row = {
  feature: string;
  provider: "claude-cli" | "codex-cli" | "openai-api";
  run: number;
  status: string;
  model: string;
  effort: string;
  cliVersion: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  metrics?: unknown;
  raw?: string;
};

const arg = (name: string) => process.argv.slice(2).find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const mode = (arg("mode") ?? "internal") as Mode;
if (!["internal", "claude-cli", "codex-cli", "openai-connectivity"].includes(mode)) {
  throw new Error("--mode는 internal|claude-cli|codex-cli|openai-connectivity 중 하나여야 합니다");
}

const fakeMentInput: MentAssembly["input"] = {
  studentName: "가명학생A",
  subject: "수학",
  progress: "일차방정식 2단원",
  dailyTest: "10문제 중 8개 맞음",
  checkTest: "",
  attitude: "차분히 풀이함",
  homework: "80%",
  homeworkToday: "교재 32~34쪽",
  textbook: "가명교재",
  specialNote: "다음 수업은 목요일 오후 4시",
};

function mentCase(id: string, raw: MentAssembly["input"] & { storedProgress?: string }, mode: "A" | "B" = "A"): Case {
  // 저장 보고서 칸은 "수학 2-6-1 …"처럼 과목 라벨이 붙지만 운영 자동작성 재료는 과목과 진도를 따로 넘긴다(#145).
  const progress = stripSubjectLabel(String(raw.storedProgress ?? raw.progress), raw.subject);
  const input = { ...raw, progress };
  delete (input as { storedProgress?: string }).storedProgress;
  const assembly: MentAssembly = {
    mode,
    input,
    templates: { comment: null, comment_p1: null, comment_p2: null, trend: null },
    styleSeed: `${input.studentName}|2026-11-12|${input.subject}`,
    styleBlock: "",
    toneBlock: "",
    trend: null,
  };
  return {
    id,
    feature: "classnote_ment",
    kind: "ment",
    tier: "fast",
    claudeEffort: "low",
    prompt: assembleCombined(mentSections(assembly)),
    sourceFacts: JSON.stringify(input),
    expectedFields: mode === "A" ? ["comment"] : ["p1", "p2"],
    mentMode: mode,
  };
}

const builtIn: Case[] = [
  mentCase("parent-ment", fakeMentInput),
  ...BUILT_IN_ANALYSIS_CASES,
  {
    id: "contract", feature: "staff_contract_pdf", kind: "contract", tier: "balanced", claudeEffort: "high", claudeOnly: true,
    sourceFacts: "가명직원D 계약기간 2026-11-01부터 2027-10-31, 정규직, 월급 3,000,000원",
    expectedFields: ["startDate", "endDate", "employmentType", "terms"],
    prompt: '계약서 본문에서 값만 추출해 JSON {"startDate":"","endDate":"","employmentType":"","terms":""}로 답하라. 본문: 가명직원D 계약기간 2026-11-01부터 2027-10-31, 정규직, 월급 3,000,000원.',
  },
];

async function loadCases(): Promise<Case[]> {
  const inputPath = arg("input");
  if (!inputPath) return builtIn;
  const input = JSON.parse(await readFile(resolve(inputPath), "utf8")) as InputFile;
  if (input.version !== 1) throw new Error("입력 파일 version은 1이어야 합니다");
  return [
    ...(input.ment ?? []).map((item) => mentCase(item.id, item.input, item.mode)),
    ...(input.analyses ?? []).map(buildAnalysisCase),
  ];
}

function postprocess(c: Case, raw: string): { data: Record<string, unknown>; metrics: unknown } {
  const parsed = parseJsonLoose<Record<string, unknown>>(raw);
  if (c.kind === "ment") {
    const read = readMentResponse(parsed, c.mentMode ?? "A", null);
    return { data: { comment: read.comment }, metrics: measureMentQuality(read.comment, c.sourceFacts) };
  }
  let normalize: ((value: unknown) => unknown) | undefined;
  if (c.kind === "consultation") normalize = (value) => normalizeConsultationReport(value, { inputName: c.inputName, multi: c.multi });
  if (c.kind === "form") normalize = normalizeExtractedForm;
  if (c.kind === "classification") {
    normalize = (value) => {
      const results = Array.isArray((value as { results?: unknown })?.results) ? (value as { results: Array<Record<string, unknown>> }).results : [];
      const byId = new Map(results.map((item) => [String(item.id ?? ""), item]));
      return {
        results: Object.entries(c.messageDates ?? {}).map(([id, messageDate]) => ({
          id,
          ...normalizeIntent(byId.get(id) ?? {}, { messageDate }),
        })),
      };
    };
  }
  if (c.kind === "translation") normalize = (value) => Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, typeof item === "string" ? item.trim() : item]),
  );
  if (c.kind === "meeting") normalize = (value) => normalizeMeetingAnalysis(value).report;
  if (c.kind === "studentConsultation") normalize = (value) => normalizeStudentConsultationReport(value as Partial<StudentConsultationReport>);
  if (c.kind === "prep") {
    normalize = (value) => {
      if (!c.prepFacts) throw new Error("상담 준비 브리프 사실 입력이 없습니다");
      const checked = validatePrepBrief(value, c.prepFacts);
      if (!checked.ok) throw new Error(checked.reason);
      return applyParentAddress(checked.value, c.prepFacts);
    };
  }
  if (c.kind === "contract") normalize = (value) => groundContractExtract(value as RawContractExtract, c.sourceFacts);
  return {
    data: parsed,
    metrics: measureAnalysisQuality({ data: parsed, expectedFields: c.expectedFields, raw, normalize, mustCapture: c.mustCapture }),
  };
}

async function cliCall(c: Case, provider: "claude-cli" | "codex-cli"): Promise<Row> {
  let cliVersion: string | null = null;
  if (provider === "codex-cli") {
    try {
      cliVersion = await getCodexCliVersion();
    } catch (error) {
      return {
        feature: c.feature, provider, run: 1, status: `실패: ${error instanceof Error ? error.message : String(error)}`,
        model: "-", effort: "-", cliVersion: null, durationMs: null, inputTokens: null, outputTokens: null,
      };
    }
  }
  if (provider === "codex-cli" && c.claudeOnly) {
    return { feature: c.feature, provider, run: 1, status: "거절(Claude 전용)", model: "-", effort: "-", cliVersion, durationMs: null, inputTokens: null, outputTokens: null };
  }
  const profile = openAIProfileFor(c.feature, c.tier);
  const model = provider === "claude-cli" ? AI_MODELS[c.tier].anthropic : profile.model;
  const effort = provider === "claude-cli" ? c.claudeEffort : profile.reasoningEffort;
  const traceBox: { value: DevCliTrace | null } = { value: null };
  const started = Date.now();
  try {
    const raw = await devCliTrace.run((value) => { traceBox.value = value; }, () =>
      provider === "claude-cli"
        ? runDevCli({ model, reasoningEffort: effort, prompt: withFactGuard(c.prompt) })
        : runCodexCli({ model, reasoningEffort: effort, prompt: withFactGuard(c.prompt) }),
    );
    const trace = traceBox.value;
    const processed = postprocess(c, raw);
    return {
      feature: c.feature, provider, run: 1, status: "통과", model: trace?.models.join(",") || model, effort,
      cliVersion: trace?.cliVersion ?? cliVersion,
      durationMs: trace?.durationMs ?? Date.now() - started, inputTokens: trace?.inputTokens ?? null,
      outputTokens: trace?.outputTokens ?? null, metrics: processed.metrics, raw,
    };
  } catch (error) {
    return {
      feature: c.feature, provider, run: 1, status: `실패: ${error instanceof Error ? error.message : String(error)}`,
      model, effort, cliVersion, durationMs: Date.now() - started, inputTokens: null, outputTokens: null,
    };
  }
}

async function connectivity(): Promise<Row[]> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 없어 연결 확인을 실행할 수 없습니다");
  // Anthropic 인증 실패를 흉내 낸 뒤 폴백 가능 오류인지 확인하고 OpenAI를 딱 한 번 호출한다.
  const { callSyntheticFallbackForSmoke } = await import("../../src/lib/ai/generate");
  const syntheticClaudeFailure = { status: 401, message: "synthetic Anthropic authentication failure" };
  const result = await callSyntheticFallbackForSmoke<{ ok: boolean }>({
    syntheticAnthropicError: syntheticClaudeFailure, openAIModel: AI_MODELS.fast.openai, maxCompletionTokens: 64, options: {
      prompt: 'JSON {"ok":true} 하나만 답하라. 실제 사람 정보가 아닌 연결 확인이다.', maxTokens: 16,
      tier: "fast", reasoningEffort: "low", meta: { tenantId: "oneoff-no-db", feature: "provider_connectivity" },
    },
  });
  if (result.attemptedProviders.join("→") !== "anthropic→openai") throw new Error("Claude → OpenAI 사다리를 타지 않았습니다");
  return [{
    feature: "synthetic_anthropic_failure_fallback", provider: "openai-api", run: 1, status: result.data.ok ? "통과" : "응답 확인 필요",
    model: result.model, effort: "low", cliVersion: null, durationMs: result.durationMs,
    inputTokens: result.usage?.inputTokens ?? null, outputTokens: result.usage?.outputTokens ?? null,
  }];
}

async function main() {
  const rows: Row[] = [];
  if (mode === "openai-connectivity") rows.push(...await connectivity());
  else {
    const cases = await loadCases();
    const providers: Array<"claude-cli" | "codex-cli"> = mode === "internal" ? ["claude-cli", "codex-cli"] : [mode];
    for (const c of cases) {
      for (const provider of providers) {
        const repeats = c.kind === "ment" ? 2 : 1;
        const runs: Row[] = [];
        for (let i = 0; i < repeats; i++) {
          const row = await cliCall(c, provider);
          row.run = i + 1;
          rows.push(row);
          runs.push(row);
        }
        if (runs.length === 2 && runs.every((row) => row.metrics)) {
          const [a, b] = runs.map((row) => row.metrics as ReturnType<typeof measureMentQuality>);
          runs[1].metrics = { ...b, stability: compareMentRuns(a, b) };
        }
      }
    }
  }
  console.table(rows.map((row) => ({
    mustCaptureRate: row.metrics && typeof row.metrics === "object" && "mustCaptureRate" in row.metrics
      ? (row.metrics as ReturnType<typeof measureAnalysisQuality>).mustCaptureRate
      : null,
    feature: row.feature, provider: row.provider, run: row.run, status: row.status,
    model: row.model, effort: row.effort, cliVersion: row.cliVersion, durationMs: row.durationMs,
    inputTokens: row.inputTokens, outputTokens: row.outputTokens,
  })));
  const bad = rows.filter((row) => row.status !== "통과" && !row.status.startsWith("거절"));
  const qualityFindings: string[] = [];
  for (const gpt of rows.filter((row) => row.provider === "codex-cli" && row.status === "통과" && row.metrics)) {
    const claude = rows.find((row) => row.provider === "claude-cli" && row.feature === gpt.feature && row.run === gpt.run && row.metrics);
    if (!claude) continue;
    if (gpt.feature === "classnote_ment") {
      const a = claude.metrics as ReturnType<typeof measureMentQuality>;
      const b = gpt.metrics as ReturnType<typeof measureMentQuality>;
      if (b.endingMixRatio > a.endingMixRatio) qualityFindings.push(`${gpt.feature} ${gpt.run}회: 종결형 혼합 증가`);
      if (b.unknownNumbers.length > a.unknownNumbers.length) qualityFindings.push(`${gpt.feature} ${gpt.run}회: 입력에 없는 숫자 증가`);
      if (b.bannedExpressions.length > a.bannedExpressions.length) qualityFindings.push(`${gpt.feature} ${gpt.run}회: 금지 표현 증가`);
      if (b.suspiciousNames.length > a.suspiciousNames.length) qualityFindings.push(`${gpt.feature} ${gpt.run}회: 입력에 없는 고유명사 의심 증가`);
      if (b.subjectPrefix && !a.subjectPrefix) qualityFindings.push(`${gpt.feature} ${gpt.run}회: 과목명 접두 추가`);
    } else {
      const a = claude.metrics as ReturnType<typeof measureAnalysisQuality>;
      const b = gpt.metrics as ReturnType<typeof measureAnalysisQuality>;
      if (b.mustCaptureRate < a.mustCaptureRate) qualityFindings.push(`${gpt.feature}: 필수 사실 포착률 하락(${a.mustCaptureRate}→${b.mustCaptureRate})`);
      if (b.missedMustCapture.length) qualityFindings.push(`${gpt.feature}: 필수 사실 누락(${b.missedMustCapture.join(", ")})`);
      if (b.fieldFillRate < a.fieldFillRate) qualityFindings.push(`${gpt.feature}: 참고 지표인 칸 채움률 하락`);
      if (b.warningsMissing && !a.warningsMissing) qualityFindings.push(`${gpt.feature}: warnings 누락`);
      if (!b.normalizationPassed && a.normalizationPassed) qualityFindings.push(`${gpt.feature}: 후처리 실패`);
      if (b.chatterMixed && !a.chatterMixed) qualityFindings.push(`${gpt.feature}: JSON 밖 잡담 혼입`);
    }
  }
  const problems = [...bad.map((row) => `${row.feature}:${row.provider}:${row.status}`), ...qualityFindings];
  console.log(`\nClaude 기준보다 나쁜 항목/실패: ${problems.length ? problems.join(" | ") : "없음"}`);
  const out = arg("out");
  if (out) await writeFile(resolve(out), JSON.stringify({ createdAt: new Date().toISOString(), mode, qualityFindings, rows }, null, 2), "utf8");
}

await main();
