// 콜&상담 녹음 13섹션 분석 **저장 전** 후처리 — 모델이 바뀌어도 저장·화면 모양을 기존(v4-pro)과 같게(원장 2026-10-19).
// (화면에 그릴 때의 후보정은 report-normalize.ts `normalizeAiListText` — 그건 그대로 두고, 여기는 저장되는 값을 맞춘다.)
// 순수 함수(⚠️ server-only 금지 [[#61]] — Vitest 대상). 규칙 원문 = consultation-analysis.ts 프롬프트의 '출력 형식 규칙'.
import { cleanRoleMap, normalizeSection, sectionSource, toText, type SectionRules } from "@/lib/ai/section-normalize";
import type { ConsultationReport13, ConversationFlowNode } from "./consultation-analysis-prompt";

/** 산문 섹션(프롬프트: '- ' 불릿 금지, 자연스러운 문장). */
const PROSE_KEYS = ["consultationType", "summary", "familyBackground", "parentSatisfaction"] as const;
/** 나열 섹션(프롬프트: 항목마다 줄바꿈 + '- '). */
const LIST_KEYS = [
  "parentConcerns",
  "parentQuestions",
  "parentRequests",
  "studentTraits",
  "teacherResponse",
  "salesPoints",
  "agreements",
  "followUps",
  "warnings",
] as const;
const SECTION_KEYS = [...PROSE_KEYS, ...LIST_KEYS] as const;
const EXTRA_KEYS = ["speakerRoles", "conversationFlow", "extracted"] as const;
/** 프롬프트가 정한 '해당 없음' 문장 — 불릿 없이 그대로 둔다(기존 저장본과 같은 꼴). */
export const NO_WARNING = "확인된 위험 신호 없음";
/**
 * 응답에 분석 **칸**이 하나도 없을 때(모양 실패 — 글·다른 모양) — '완료'로 저장하지 않고 실패로 돌린다(빈 보고서·지어낸
 * '위험 신호 없음' 방지). 칸은 있는데 비어 있으면(잡담만 한 녹음 — 프롬프트가 근거 없으면 비우라 한다) 정상이다.
 */
export const EMPTY_ANALYSIS_ERROR = "AI 응답에 분석 내용이 없습니다";
const ROLE_SET = ["상담자", "학부모", "학생", "기타"] as const;

function roleWord(t: string): string | null {
  if (/학부모|어머니|아버지|어머님|아버님|엄마|아빠|보호자|부모|할머니|할아버지/.test(t)) return "학부모";
  if (/학생|아이|자녀|딸|아들/.test(t)) return "학생";
  if (/상담|선생|강사|원장|실장|교사|직원/.test(t)) return "상담자";
  return null;
}

/**
 * 화자 역할 — 프롬프트의 넷 중 하나로(비슷한 말은 그 역할로, 모르면 '기타').
 * **끝 낱말(중심어)로 먼저** 본다 — '상담받으러 온 어머니'(→ 학부모) · '선생님 자녀'(→ 학생) · '학부모 상담 실장'(→ 상담자).
 * 앞 낱말에 먼저 걸리면 본문의 '화자 B는'까지 엉뚱한 역할로 바뀐다(2026-10-19 리뷰 두 번). 끝 낱말로 모르면 전체에서.
 */
export function canonicalRole(label: string): string {
  const t = label.trim();
  if ((ROLE_SET as readonly string[]).includes(t)) return t;
  const head = t.split(/\s+/).pop() ?? t;
  return roleWord(head) ?? roleWord(t) ?? "기타";
}

/** 대화 흐름 트리 — 화면이 재귀로 그리므로 단계 수를 자르지 않는다(이상한 입력의 무한 깊이만 막는다). */
function flowNodes(v: unknown, depth = 0): ConversationFlowNode[] {
  if (!Array.isArray(v) || depth > 8) return [];
  const out: ConversationFlowNode[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const n = raw as Record<string, unknown>;
    const topic = toText(n.topic).trim();
    const summary = toText(n.summary).trim();
    const children = flowNodes(n.children, depth + 1);
    if (!topic && !summary && children.length === 0) continue;
    out.push(children.length > 0 ? { topic, summary, children } : { topic, summary });
  }
  return out;
}

function nullable(v: unknown): string | null {
  const t = toText(v).trim();
  return t && t !== "null" && t !== "-" ? t : null;
}

/**
 * '질문 → 답변' 줄에 답이 있는데 '(미답변)'도 붙은 경우 — 프롬프트 금지 조항이라 '(미답변)'만 뗀다.
 * 한 줄에 '→'가 둘 이상이면(질문 둘이 붙음) 어느 답의 표시인지 모르니 손대지 않는다.
 */
function fixQuestions(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const parts = line.split("→");
      if (parts.length !== 2 || !line.includes("(미답변)")) return line;
      const after = parts[1];
      const answer = after.replace("(미답변)", "").trim();
      return answer ? line.replace(/\s*\(미답변\)/, "") : line;
    })
    .join("\n");
}

/**
 * 추출 학생 이름이 입력 이름에서 **성만 빠진 꼴**('도현' ↔ 입력 '김도현')이면 입력 이름으로(2026-10-26).
 * Claude는 지침 '발화에 명시되지 않으면 null'을 글자대로 따라 전사에서 불린 이름만 적는다 — 이 값이 인쇄본 '학생명'
 * (`print_payload.prospect.name`)에 그대로 나간다(시험 15건 중 5건 — 기존 저장본은 입력 이름).
 * 🔴 입력 이름의 끝과 정확히 같고 앞에 빠진 것이 한두 글자(성)일 때만 — 다른 이름(동명이인·ASR 오인식)은 손대지 않는다.
 *    동명이인 구분 글자('김근우A')는 떼고 견주되, 바꿀 때는 입력 이름 그대로 쓴다.
 */
export function fullProspectName(extracted: string | null, inputName: string | null | undefined): string | null {
  const full = (inputName ?? "").trim();
  if (!extracted || !full) return extracted;
  const ex = extracted.replace(/\s/g, "");
  const base = full.replace(/\s/g, "").replace(/[A-Za-z]+$/, "");
  const surname = base.length - ex.length;
  // 성 한 글자 + 이름, 또는 두 글자 성(남궁·제갈) + 두 글자 이상 이름 — '김도현'에서 '현'만 남은 것은 이름 일부라 손대지 않는다.
  const ok = (surname === 1 && ex.length >= 1) || (surname === 2 && ex.length >= 2);
  return ok && base.endsWith(ex) ? full : extracted;
}

/** speakerRoles는 추론 못 했으면 없다(undefined) — 재분석이 `?? 이전 값`으로 기존 역할을 이어받는다. */
export type NormalizedConsultationReport = ConsultationReport13 & { speakerRoles?: Record<string, string> };

/**
 * AI 응답(JSON 파싱 직후) → 기존과 같은 모양의 13섹션 보고서.
 * - 모양만 고친다(내용 불변). 모르는 키는 버린다(저장 스냅샷 모양을 고정). 한 겹 싸서 보낸 응답·키 대소문자 차이는 푼다.
 * - warnings 칸이 있는데 비면 프롬프트대로 '확인된 위험 신호 없음'(칸 자체가 없으면 지어 넣지 않는다).
 * - 🔴 13섹션 칸이 하나도 없으면 던진다 — 빈 보고서를 '완료'로 저장하지 않는다(호출부가 '분석 실패'로 남긴다).
 * - multi(녹음 여럿) = 화자 글자가 녹음마다 따로라 '화자 A'를 역할로 바꾸지 않는다(최근 녹음 기준 역할이라 앞 녹음과 어긋난다).
 */
export function normalizeConsultationReport(
  raw: unknown,
  opts: { multi?: boolean; /** 상담 행의 학생 이름(현재 입력값) — 성이 빠진 추출 이름을 되돌릴 때만 쓴다. */ inputName?: string | null } = {},
): NormalizedConsultationReport {
  const { source: r, hasSections } = sectionSource(raw, SECTION_KEYS, EXTRA_KEYS);
  if (!hasSections) throw new Error(EMPTY_ANALYSIS_ERROR);
  const speakerRoles = cleanRoleMap(r.speakerRoles, canonicalRole);
  const rules: SectionRules = { bold: "strip", speakers: "strip", roles: speakerRoles, multi: opts.multi };
  const out = {} as Record<string, unknown>;
  for (const k of PROSE_KEYS) out[k] = normalizeSection(r[k], "prose", rules);
  for (const k of LIST_KEYS) out[k] = normalizeSection(r[k], "list", rules, [NO_WARNING]);
  out.parentQuestions = fixQuestions(out.parentQuestions as string);
  if (!(out.warnings as string).trim() && "warnings" in r) out.warnings = NO_WARNING;
  const ex = r.extracted && typeof r.extracted === "object" ? (r.extracted as Record<string, unknown>) : {};
  out.extracted = {
    prospectName: fullProspectName(nullable(ex.prospectName), opts.inputName),
    grade: nullable(ex.grade),
    school: nullable(ex.school),
    parentName: nullable(ex.parentName),
    parentPhone: nullable(ex.parentPhone),
  };
  out.conversationFlow = flowNodes(r.conversationFlow);
  if (Object.keys(speakerRoles).length > 0) out.speakerRoles = speakerRoles;
  return out as NormalizedConsultationReport;
}
