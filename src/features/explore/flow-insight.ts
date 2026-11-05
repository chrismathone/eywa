import { z } from "zod";
import type { PillColor } from "@/components/atoms/pill";

/**
 * 원생 흐름 분석(상담 · 타임라인) — **순수 계약**(서버 갱신 · 화면 카드 · 테스트가 함께 읽는다).
 * 원장 2026-11-03: *"전체 상담을 한번 돌리고 다음 상담부터는 새 상담을 이전 상담 분석에 합산시켜서 어떤 방향으로 상담이 흘러가고
 * 있는지"* · *"타임라인도 비슷하게"*. 저장 = `student_flow_insights`(s2_0027), 갱신 = [`server/flow-insights.ts`](./server/flow-insights.ts).
 * ⚠️ `"use client"`도 `server-only`도 붙이지 말 것(#61·#81).
 */

export const FLOW_KINDS = ["consultations", "timeline"] as const;
export type FlowKind = (typeof FLOW_KINDS)[number];
export const FLOW_KIND_LABEL: Record<FlowKind, string> = { consultations: "상담 흐름", timeline: "타임라인 흐름" };
/** AI 호출부 식별자(`meta.feature`) — 키 그룹 표(`FEATURE_KEY_GROUP`)와 모델 고정(`FEATURE_MODELS`)이 이 이름을 본다. */
export const FLOW_FEATURE: Record<FlowKind, string> = { consultations: "student_flow_consultations", timeline: "student_flow_timeline" };
/** 한 번에 모델에 넘기는 기록 상한(최근 것부터) — 비용·길이 바닥. */
export const FLOW_RECORD_CAP: Record<FlowKind, number> = { consultations: 60, timeline: 120 };

export const DIRECTIONS = ["improving", "stable", "concern", "mixed", "unknown"] as const;
export type FlowDirection = (typeof DIRECTIONS)[number];
export const DIRECTION_META: Record<FlowDirection, { label: string; color: PillColor }> = {
  improving: { label: "좋아지는 중", color: "green" },
  stable: { label: "유지", color: "blue" },
  concern: { label: "주의", color: "amber" },
  mixed: { label: "엇갈림", color: "purple" },
  unknown: { label: "판단 보류", color: "neutral" },
};

export const flowInsightSchema = z.object({
  /** 한 줄 — 지금 흐름이 어느 방향인가. */
  headline: z.string().trim().min(1).max(200),
  direction: z.enum(DIRECTIONS),
  /** 되풀이되는 주제(최대 6). */
  themes: z.array(z.string().trim().min(1).max(60)).max(6),
  /** 새 기록으로 달라진 점(없으면 빈 문자열). */
  recentChange: z.string().trim().max(400),
  /** 지켜볼 점(최대 4). */
  watch: z.array(z.string().trim().min(1).max(200)).max(4),
  /** 다음 상담·확인 제안(최대 4 · 기록에 근거한 것만). */
  nextSteps: z.array(z.string().trim().min(1).max(200)).max(4),
  /** 근거 — 어떤 기간·몇 건을 보고 말했는지. */
  basis: z.string().trim().max(200),
});
export type FlowInsight = z.infer<typeof flowInsightSchema>;

/** 모델에 넘기는 기록 한 줄 — `at`은 ISO(시각) 또는 YYYY-MM-DD, 비교는 문자열 순서(둘 다 앞 10자리가 날짜). */
export type FlowRecord = { at: string; text: string };

/** 화면이 받는 모양(직렬화 가능). */
export type FlowInsightView = {
  kind: FlowKind;
  label: string;
  insight: FlowInsight | null;
  generatedAt: string | null;
  /** 짧은 모델 라벨(`modelDisplayLabel`) — 모르는 모델은 null(raw id 노출 금지). */
  modelLabel: string | null;
  coveredCount: number;
  coveredThrough: string | null;
};

/** 이전 분석이 반영한 시점(`coveredThrough`) **뒤**의 기록만 — 같은 시각은 이미 반영된 것으로 본다. */
export function splitNewRecords(records: readonly FlowRecord[], coveredThrough: string | null): FlowRecord[] {
  if (!coveredThrough) return [...records];
  return records.filter((r) => r.at > coveredThrough);
}

export function latestAt(records: readonly FlowRecord[]): string | null {
  return records.reduce<string | null>((max, r) => (max === null || r.at > max ? r.at : max), null);
}

const KIND_GUIDE: Record<FlowKind, string> = {
  consultations:
    "기록은 한 학생의 원생 상담 일지다(상담일 · 분류 · 대상 · 상담자 · 요약 · 후속 조치). 상담이 어떤 방향으로 흘러가는지(학습·정서·학부모 요청의 변화, 되풀이되는 요청, 후속 조치 이행)를 본다.",
  timeline:
    "기록은 한 학생의 활동 타임라인이다(수강 시작·종료·반 이동 · 상담 · 특이사항 메모 · 시험 성적 · 재원 상태). 학원 생활이 어떤 방향으로 흘러가는지(수강·성적·상담이 함께 가리키는 흐름)를 본다.",
};

/**
 * 프롬프트 — 첫 분석은 전체 기록, 그 뒤는 **이전 분석 + 새 기록만**(합산). 사실 원칙(팩트·추측 금지)은 `generateJSON`이 앞에 붙이지만
 * 여기서도 "기록에 없는 것은 쓰지 말 것"을 또렷이 둔다. 응답은 JSON 하나.
 */
export function buildFlowPrompt(
  kind: FlowKind,
  input: { studentLabel: string; prior: FlowInsight | null; priorThrough: string | null; records: readonly FlowRecord[]; totalCount: number },
): { system: string; prompt: string } {
  const system = [
    "당신은 학원 원장을 돕는 기록 분석가입니다. 한국어 합니다체로, 기록에 있는 사실만 씁니다. 기록에 없는 원인·감정·결과를 지어내지 않습니다.",
    KIND_GUIDE[kind],
    "출력은 아래 JSON 하나만(설명 문장·마크다운 금지):",
    '{"headline": "한 줄 흐름(≤80자)", "direction": "improving|stable|concern|mixed|unknown", "themes": ["되풀이되는 주제 ≤6개"], "recentChange": "새 기록으로 달라진 점(없으면 빈 문자열)", "watch": ["지켜볼 점 ≤4개"], "nextSteps": ["다음 상담·확인 제안 ≤4개 — 기록에 근거한 것만"], "basis": "근거: 기간과 건수"}',
    "direction은 전체 흐름 기준입니다 — 좋아지는 중 improving · 큰 변화 없음 stable · 걱정되는 신호 concern · 좋고 나쁨이 엇갈림 mixed · 기록이 적어 판단 어려움 unknown.",
    "이름·날짜·숫자는 기록 그대로 옮기고, 민감한 가정사·건강 정보는 요약에 되풀이하지 않습니다.",
  ].join("\n");
  const lines = input.records.map((r) => `- [${r.at.slice(0, 10)}] ${r.text}`).join("\n");
  const prompt = input.prior
    ? [
        `학생: ${input.studentLabel}`,
        `이전 분석(${input.priorThrough ? `${input.priorThrough.slice(0, 10)}까지 반영` : "이전"}):`,
        JSON.stringify(input.prior),
        `새 기록 ${input.records.length}건(전체 ${input.totalCount}건 중 이전 분석 뒤의 것):`,
        lines,
        "이전 분석에 새 기록을 **합산**해 갱신하세요: 변하지 않은 주제는 유지하고, 새 기록으로 달라진 점은 recentChange에 적고, direction은 전체 흐름으로 다시 판단합니다. basis는 전체 기간·건수로 적습니다.",
      ].join("\n\n")
    : [
        `학생: ${input.studentLabel}`,
        `기록 ${input.records.length}건${input.totalCount > input.records.length ? `(전체 ${input.totalCount}건 중 최근 ${input.records.length}건)` : ""}:`,
        lines,
        "전체 기록을 처음 분석합니다. recentChange에는 가장 최근 기록에서 보이는 변화를 적습니다(없으면 빈 문자열).",
      ].join("\n\n");
  return { system, prompt };
}

/** 모델 응답 → 계약 모양. 틀리면 throw(저장하지 않는다 — 그럴듯한 반쪽을 화면에 내지 않는다). */
export function parseFlowInsight(data: unknown): FlowInsight {
  return flowInsightSchema.parse(data);
}
