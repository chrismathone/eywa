import { commentBody, commentP1Body, commentP2Body, type ReportCommentInput } from "./report-comment";
import { commentStyleDirective, type PromptSection } from "./prompt-defaults";
import { findImpossibleScaleSpans, findTrendContradictions, findTrendViolations, trendBody, type TrendInput } from "./trend-comment";

/**
 * 자동작성 프롬프트 조립 · 응답 읽기 — **운영 자동작성(`generateReportComment`)과 AI 멘트 탭 미리보기가 같은 함수**를 쓴다.
 * 🔴 원장 2026-10-16 미리보기 후속: 미리보기가 따로 조립하면(특이사항·결 변형·말투·추세 없이, 다른 모델로) 거기서 본 글과 실제로
 *    나가는 글이 달라진다. 조립·검사를 바꿀 땐 여기 한 곳만 고친다(순수 — DB·모델 호출 없음).
 */

/** 활성 프롬프트(없으면 null = 기본값). 미리보기는 편집 중인 한 종류만 바꿔 넣는다. */
export type MentTemplates = { comment: string | null; comment_p1: string | null; comment_p2: string | null; trend: string | null };

export type MentAssembly = {
  mode: "A" | "B";
  /** 학부모께 드리는 말(`splitParentAddress`)을 뗀 뒤의 입력. */
  input: ReportCommentInput;
  templates: MentTemplates;
  /** 결 변형 시드 — `${이름}|${날짜}|${과목}`(같은 학생·같은 날은 같은 결). */
  styleSeed: string;
  /** 선생님 말투 지침(멘트) · 어조만(추세) — 없으면 "". */
  styleBlock: string;
  toneBlock: string;
  /** 사실 줄이 있는 추세 입력 — 없으면 추세 섹션을 만들지 않는다. */
  trend: TrendInput | null;
  /** 멘트 섹션 끝에 붙일 코드 지시(수학 보고서 시범 `PILOT_AI_DIRECTIVE`) — 없으면 종전 그대로. 모드 A에서만 쓴다. */
  extraDirective?: string;
};

/** 저장 진도("수학 2-4-3 …")를 운영 자동작성 입력처럼 과목과 진도로 다시 나눈다. */
export function stripSubjectLabel(progress: string, label: string): string {
  return label && progress.startsWith(`${label} `) ? progress.slice(label.length + 1) : progress;
}

/** 멘트(모드 A 단일 · B 두 문단) + 추세 섹션. 사실 없는 문단은 뺀다. */
export function mentSections(a: MentAssembly): PromptSection[] {
  const withTeacherStyle = (body: string) => (a.styleBlock ? `${body}\n\n${a.styleBlock}` : body);
  const sections: PromptSection[] = [];
  if (a.mode === "B") {
    const p1 = commentP1Body(a.input, a.templates.comment_p1);
    const p2 = commentP2Body(a.input, a.templates.comment_p2);
    if (p1) sections.push({ type: "comment_p1", field: "p1", body: withTeacherStyle(p1) });
    if (p2) sections.push({ type: "comment_p2", field: "p2", body: withTeacherStyle(p2) });
  } else {
    // 문체 변형(2026-07-30) — 같은 반 학생들이 한 낱말만 다른 복사본을 받지 않게 어디서부터 이야기를 열지를 학생·날짜별로 돌린다.
    // 순서가 뜻이다 — 말투 지침의 마지막 줄이 바로 위 '이번 알림장의 결'을 가리킨다(첫 문장 여는 자리는 결이 이긴다).
    const style = commentStyleDirective(a.styleSeed);
    const body = commentBody(a.input, a.templates.comment);
    const styled = withTeacherStyle(style ? `${body}\n\n${style}` : body);
    sections.push({ type: "comment", field: "comment", body: a.extraDirective ? `${styled}\n\n${a.extraDirective}` : styled });
  }
  if (a.trend && a.trend.facts.length) {
    // 추세엔 **어조·문장 결만** — 선생님 표현·마무리까지 붙이면 추세 금지(계획)에 걸려 버려진다(2026-10-16).
    const tbody = trendBody(a.trend, a.templates.trend);
    sections.push({ type: "trend", field: "trend", body: a.toneBlock ? `${tbody}\n\n${a.toneBlock}` : tbody });
  }
  return sections;
}

/** 출력 상한 — 특이사항·반 안내가 있으면 길어진다. */
export const mentMaxTokens = (input: Pick<ReportCommentInput, "specialNote" | "classNotice">): number =>
  input.specialNote || input.classNotice ? 1800 : 1000;

export type MentResponse = {
  /** 모드에 맞춘 멘트 본문(모드 B = 두 문단을 빈 줄로). 비면 "". */
  comment: string;
  /** 모델이 쓴 추세 그대로(검사 전). */
  rawTrend?: string;
  /** 실을 추세 — 검사에 걸리면 undefined. */
  trend?: string;
  dropped: boolean;
  badSpans: string[];
  violations: string[];
  /** 추세를 맡겼는데 모델이 **비워 보냈다**(본문과 같은 말뿐 · 오늘 값과 어긋남). 키가 아예 없으면 false(대체 provider가 계약을 빠뜨림). */
  quietByModel: boolean;
};

/**
 * 모델 응답 → 멘트·추세 + 생성 뒤 검사.
 * 🔴 추세 문장 후검증(2026-08-13 · 2026-10-15) — 사실일 수 없는 표기("9~15문제 중 9~15개")와 기록에 있을 수 없는 문장(계획·원인·숫자·
 *    나빠지는 흐름)은 **추세를 아예 안 싣는다** — 없는 것보다 거짓이 나쁘다(trend-comment.ts). 멘트는 그대로 살린다.
 */
export function readMentResponse(
  data: Record<string, unknown>,
  mode: "A" | "B",
  trendInput: Pick<TrendInput, "streakEnded"> | null,
): MentResponse {
  const pick = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : "").trim();
  const comment = mode === "B" ? [pick("p1"), pick("p2")].filter(Boolean).join("\n\n") : pick("comment");
  const hasTrend = !!trendInput;
  const rawTrend = hasTrend ? pick("trend") || undefined : undefined;
  const badSpans = rawTrend ? findImpossibleScaleSpans(rawTrend) : [];
  const violations = rawTrend ? [...findTrendViolations(rawTrend), ...(trendInput ? findTrendContradictions(trendInput, rawTrend) : [])] : [];
  const dropped = badSpans.length > 0 || violations.length > 0;
  return {
    comment,
    rawTrend,
    trend: dropped ? undefined : rawTrend,
    dropped,
    badSpans,
    violations,
    quietByModel: hasTrend && typeof data.trend === "string" && !data.trend.trim(),
  };
}
