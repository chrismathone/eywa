import { acceptRestyle } from "../../src/features/onescreen/pilot-restyle-guard";

const BANNED = ["성장이 기대됩니다", "꾸준한 노력으로", "한 걸음 더", "앞으로도 잘", "최선을 다하겠습니다"];
const ENDINGS: ReadonlyArray<[string, RegExp]> = [
  ["합니다체", /(?:습니다|합니다|입니다|했습니다|됩니다|바랍니다)$/],
  ["해요체", /(?:해요|예요|이에요|했어요|돼요)$/],
  ["서술체", /(?:이다|했다|한다|된다)$/],
];

const compact = (value: string) => value.replace(/\s+/g, "");
const numericTokens = (value: string) => value.match(/\d+(?:[.,/]\d+)*(?:\s*(?:%|퍼센트|단원|쪽|페이지|문제|개|점))?/g) ?? [];
const sentences = (value: string) => value.split(/(?<=[.!?。])\s+|\n+/).map((v) => v.trim()).filter(Boolean);

export type MentQualityMetrics = {
  length: number;
  sentenceCount: number;
  endingMixRatio: number;
  endings: string[];
  copiedNumbers: string[];
  unknownNumbers: string[];
  unitNumberTokens: string[];
  subjectPrefix: boolean;
  bannedExpressions: string[];
  suspiciousNames: string[];
  restyleGuardPassed: boolean | null;
};

/** 학부모 멘트 품질 지표의 단일 계산기 — 운영 발송분·Claude·Codex 결과를 같은 잣대로 비교한다. */
export function measureMentQuality(output: string, sourceFacts: string, originalForRestyle?: string): MentQualityMetrics {
  const rows = sentences(output);
  const endingRows = rows.map((row) => ENDINGS.find(([, re]) => re.test(row.replace(/[.!?。]+$/, "")))?.[0] ?? "기타");
  const counts = new Map<string, number>();
  for (const ending of endingRows.filter((v) => v !== "기타")) counts.set(ending, (counts.get(ending) ?? 0) + 1);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const largest = Math.max(0, ...counts.values());
  const sourceNumbers = new Set(numericTokens(sourceFacts).map(compact));
  const outputNumbers = numericTokens(output);
  const suspiciousNames = output.match(/[가-힣A-Za-z]{2,}(?:학원|학교|선생님|교재)/g) ?? [];
  return {
    length: [...output].length,
    sentenceCount: rows.length,
    endingMixRatio: total ? Number(((total - largest) / total).toFixed(3)) : 0,
    endings: [...counts.keys()],
    copiedNumbers: outputNumbers.filter((token) => sourceNumbers.has(compact(token))),
    unknownNumbers: outputNumbers.filter((token) => !sourceNumbers.has(compact(token))),
    unitNumberTokens: outputNumbers.filter((token) => /%|퍼센트|단원|쪽|페이지|문제|개|점/.test(token)),
    subjectPrefix: /^(?:수학|영어|국어|과학|사회)\s*[:：]/.test(output.trim()),
    bannedExpressions: BANNED.filter((word) => output.includes(word)),
    suspiciousNames: [...new Set(suspiciousNames.filter((word) => !sourceFacts.includes(word)))],
    restyleGuardPassed: originalForRestyle === undefined ? null : acceptRestyle(originalForRestyle, output),
  };
}

export type StabilityDelta = { sentenceDelta: number; lengthDelta: number; endingChanged: boolean };

export function compareMentRuns(a: MentQualityMetrics, b: MentQualityMetrics): StabilityDelta {
  return {
    sentenceDelta: Math.abs(a.sentenceCount - b.sentenceCount),
    lengthDelta: Math.abs(a.length - b.length),
    endingChanged: a.endings.join("|") !== b.endings.join("|"),
  };
}

export type AnalysisQualityMetrics = {
  fieldFillRate: number;
  missingFields: string[];
  mustCaptureRate: number;
  missedMustCapture: string[];
  warningsMissing: boolean;
  normalizationPassed: boolean;
  chatterMixed: boolean;
};

export type MustCaptureFact = { label: string; anyOf: string[] };

const captureText = (value: unknown) => JSON.stringify(value ?? "")
  .normalize("NFKC")
  .toLocaleLowerCase("ko-KR")
  .replace(/[\s\p{P}\p{S}]+/gu, "");

/** 분석 JSON의 칸 채움·warnings 누락·후처리·잡담 혼입을 공통 계산한다. */
export function measureAnalysisQuality(input: {
  data: Record<string, unknown>;
  expectedFields: readonly string[];
  raw: string;
  normalize?: (value: unknown) => unknown;
  mustCapture?: readonly MustCaptureFact[];
}): AnalysisQualityMetrics {
  const filled = input.expectedFields.filter((field) => {
    const value = input.data[field];
    return Array.isArray(value) ? value.length > 0 : value != null && String(value).trim() !== "";
  });
  let normalizationPassed = true;
  let normalized: unknown = input.data;
  try {
    normalized = input.normalize?.(input.data) ?? input.data;
  } catch {
    normalizationPassed = false;
  }
  const haystack = captureText(normalized);
  const normalizedRecord = normalized && typeof normalized === "object" && !Array.isArray(normalized)
    ? normalized as Record<string, unknown>
    : input.data;
  const warnings = normalizedRecord.warnings;
  const missedMustCapture = (input.mustCapture ?? [])
    .filter((fact) => !fact.anyOf.some((term) => haystack.includes(captureText(term))))
    .map((fact) => fact.label);
  const mustCaptureCount = input.mustCapture?.length ?? 0;
  return {
    fieldFillRate: input.expectedFields.length ? Number((filled.length / input.expectedFields.length).toFixed(3)) : 1,
    missingFields: input.expectedFields.filter((field) => !filled.includes(field)),
    mustCaptureRate: mustCaptureCount ? Number(((mustCaptureCount - missedMustCapture.length) / mustCaptureCount).toFixed(3)) : 1,
    missedMustCapture,
    warningsMissing: input.expectedFields.includes("warnings") && (warnings == null || String(warnings).trim() === ""),
    normalizationPassed,
    chatterMixed: !input.raw.trim().startsWith("{") || /```/.test(input.raw),
  };
}
