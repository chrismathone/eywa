// LLM provider/model 레지스트리 + provider 해석. **순수**(process.env만, SDK import 없음)라
// 단위테스트가 빠르다. 티어→모델 + provider별 키 env명의 단일 소스.
//
// UI엔 모델 이름을 노출하지 않는다(CLAUDE.md 정책) — 여기 문자열은 내부 식별·model_version 저장용.
// 기능별 모델 고정(코드 기본 · 운영 콘솔 선택지)은 model-pins.ts.
import type { ModelPin } from "./model-pins";

// 회사는 둘 — Claude(anthropic) · DeepSeek. 🔴 Upstage(Solar)는 뺐다(원장 2026-10-19 *"솔라는 빼버려. 두개면 충분"* —
// 품질 시험 탈락으로 맨 뒤 예비였고, 그날 키도 잔액 부족으로 정지돼 있었다). 되살리지 말 것.
export type AiProvider = "anthropic" | "deepseek";
export type AiTier = "fast" | "balanced" | "reasoning";
export type AiKeyName = "default" | "consultations";

// 티어 → provider별 모델 id. reasoning은 Anthropic 전용(평소 금지 정책).
// deepseek: v4-pro(고품질 추론, 전사 분석 기본)·v4-flash(경량). v4-pro는 balanced로 라우팅(reasoning 티어는
// Anthropic 고정 정책 유지 — deepseek reasoning 슬롯은 null로 미사용). 실측 A/B(2026-07-16): v4-pro가
// 등록상담 warnings를 Sonnet급으로 생성(경량 v4-flash/chat·Solar는 warnings 붕괴). 배경 = docs/changelog.
// 🔴 fast tier의 deepseek = **v4-flash**(원장 2026-08-28 *"haiku -> 폴백 deepseek v4 flash"* — 같은 날
//    *"flash 말고 v4 pro"*에서 **프로덕션 실측을 보고 뒤집은 것**이라 되돌리지 말 것).
//    근거: v4-pro를 폴백에 걸었더니 강사가 자동작성 한 번에 **86초**를 기다렸다(실측 20:34:27 anthropic 실패
//    → 20:35:53 v4-pro 성공, output 6,505 토큰이 거의 전부 추론). 멘트 호출은 멘트+추세 통합 1회라
//    프롬프트가 길어 추론이 더 붇는다. v4-flash는 같은 조건 7.3초.
//    ⚠️ **폴백이 느리면 폴백이 아니라 또 다른 장애다** — 크레딧이 빈 동안은 전건이 이 경로로 오기 때문이다.
//    ⚠️ v4-flash가 전사 분석 A/B에서 warnings를 붕괴시킨 건 사실이나 그건 **balanced tier(등록상담·회의록)**
//    이야기다. 거긴 지금도 v4-pro이고, 여기는 사실 나열형 한 단락이라 급이 다르다.
export const AI_MODELS: Record<AiTier, Record<AiProvider, string | null>> = {
  // Haiku 5.5(원장 2026-10-16 *"운영 모델도 5.5로 올려"*) — 4.5의 1/10 값. 5 계열 제약(temperature 400 · 생각 기본 켜짐)은
  // generate.ts `isClaude5Model`이 흡수한다. 구독으로 같은 입력 9건 비교 뒤 적용(추세 날짜·진도 단원 코드 대응 포함).
  // deepseek = `deepseek-flash`(V4.1-Flash-1017) — 옛 이름 `deepseek-v4-flash`는 딥시크가 "은퇴"로 적고 같은 모델로 돌리는 중이라
  // (공식 가격표 2026-10-19 · 우리 키 `/models`엔 새 이름만 나온다) 이름을 지우기 전에 옮겼다.
  fast: { anthropic: "claude-haiku-5-5", deepseek: "deepseek-flash" },
  // Sonnet 5.5(원장 2026-10-19 *"소넷 5 -> 소넷 5.5가 출시되었으니 폴백 모델도 버전업"*) — 5와 같은 값($2/$10)·같은 토크나이저.
  // 바뀐 점 중 우리에게 닿는 것: 생각 끄기(`thinking: disabled`)가 400(우리는 thinking을 안 보낸다) · 생각 깊이 기본 high가 다시 맞춰졌다.
  balanced: { anthropic: "claude-sonnet-5-5", deepseek: "deepseek-v4-pro" },
  reasoning: { anthropic: "claude-opus-4-7", deepseek: null },
};

/**
 * 기능별 키 그룹 — 원장 2026-09-15 *"기능별로 키를 발급받아서 사용량 체크를 하려고"*(video · student_ontology 포함 10그룹).
 * env 이름 = `<회사>_API_KEY_<그룹 대문자>`(예 `ANTHROPIC_API_KEY_MENT` · `DEEPSEEK_API_KEY_MEETING`).
 * 옛 `consultations` 버킷과 env 이름이 같게 두어(`ANTHROPIC_API_KEY_CONSULTATIONS`) 이미 있는 키를 그대로 쓴다.
 */
export type AiKeyGroup =
  | "ment"
  | "meeting"
  | "enrollment"
  | "consultations"
  | "briefing"
  | "attendance"
  | "notice"
  | "staff"
  | "video"
  | "student_ontology";

/**
 * 호출부 식별자(generateJSON `meta.feature`) → 키 그룹. 🔴 **새 AI 기능을 만들면 여기 한 줄**을 더한다 —
 * 빠지면 기본 키로 불려 그 기능 사용량이 따로 안 잡힌다(가드 `key-groups.test.ts`가 잡는다).
 */
export const FEATURE_KEY_GROUP: Readonly<Record<string, AiKeyGroup>> = {
  // 수업보고서 멘트 — 원스크린 학부모 멘트 · 영어 AI 코멘트 · 프롬프트 미리보기 · 강사별 말투 프로파일
  classnote_ment: "ment",
  english_ment: "ment",
  ment_prompt_preview: "ment",
  ment_style_profile: "ment",
  // 사랑의 한마디 초안(2026-10-28 · 원스크린 [초안] 버튼) — 학부모 멘트와 같은 그룹
  love_note_draft: "ment",
  // 수업보고서 평점 정기 처리(2026-10-26 · 밤 배치 · 지점 스위치 report_rating) — 멘트를 읽어 매기는 일이라 같은 그룹
  lesson_report_rating: "ment",
  // 회의록 녹음 분석
  meeting_analysis: "meeting",
  // 콜&상담 — 녹음 분석 · 폼 자동입력 · 상담 준비 브리프
  enrollment_analysis: "enrollment",
  enrollment_form_extract: "enrollment",
  enrollment_prep_brief: "enrollment",
  // 원생상담 녹음 분석 · 원생 AI 케어
  consultation_analysis: "consultations",
  student_care: "consultations",
  // 운영실 일일 브리핑 · 업무 비서('확인할 일' 위 'AI로 정리' — 2026-11-02)
  daily_briefing: "briefing",
  dashboard_secretary: "briefing",
  // 출결 — 요약 · 학부모 결석 문자 판별 · 학부모 글 만족도(강사평가 — 같은 학부모 글 분류 계열, 애매한 글만)
  attendance_recap: "attendance",
  parent_attendance_intent: "attendance",
  parent_attendance_jev_shadow: "attendance",
  parent_satisfaction: "attendance",
  // 원생 온톨로지 — 원장 전용 키 배정(2026-10-22). 현재 소비처는 긍정 신호 밤 판정.
  student_positive_signal: "student_ontology",
  student_ontology_summary: "student_ontology",
  // 공지 번역
  notice_translate: "notice",
  // 직원 계약서 — 글자 PDF 추출 · 스캔 OCR(Claude 전용)
  staff_contract_pdf: "staff",
  staff_contract_pdf_ocr: "staff",
  // 영상 숙제 설명 AI 참고 메모 — 판정(Haiku) · 실수 확인(Sonnet). 밤 배치 + '다시 분석' 즉시 호출(원장 2026-10-20)
  video_review_judge: "video",
  video_review_verify: "video",
};

/** 기능 이름 → 키 그룹(표에 없으면 null — 옛 버킷·기본 키로). 원형 속성 이름(`constructor` 등)은 거른다. */
export function keyGroupOf(feature?: string | null): AiKeyGroup | null {
  if (!feature || !Object.prototype.hasOwnProperty.call(FEATURE_KEY_GROUP, feature)) return null;
  return FEATURE_KEY_GROUP[feature] ?? null;
}

const PROVIDER_KEY_ENV: Record<AiProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

/**
 * 실제로 쓸 키의 **env 이름**(없으면 null). 순서 = 기능 그룹 키 → 옛 버킷 키(`consultations`) → 기본 키.
 * 🔴 2026-09-15부터 **Anthropic도 기본 키로 넘어간다.** 예전엔 consultations 키가 없으면 Claude를 통째로
 * 건너뛰었는데(빌링 분리), 그 규칙을 기능 그룹에 그대로 쓰면 원장이 키를 하나씩 넣는 동안 키가 아직 없는
 * 기능이 **조용히 DeepSeek으로 바뀐다**(멘트 품질이 달라진다). 넘어간 호출은 ai_usage_logs.key_name이
 * 'default'로 남아 빠진 키가 드러난다.
 */
export function resolveKeyEnv(provider: AiProvider, keyName: AiKeyName, group?: AiKeyGroup | null): string | null {
  const base = PROVIDER_KEY_ENV[provider];
  const names = [
    group ? `${base}_${group.toUpperCase()}` : null,
    keyName !== "default" ? `${base}_${keyName.toUpperCase()}` : null,
    base,
  ];
  for (const name of names) if (name && process.env[name]) return name;
  return null;
}

/** 실제 사용할 API 키 문자열(없으면 undefined) — `resolveKeyEnv`가 고른 env의 값. */
export function resolveKey(provider: AiProvider, keyName: AiKeyName, group?: AiKeyGroup | null): string | undefined {
  const name = resolveKeyEnv(provider, keyName, group);
  return name ? process.env[name] : undefined;
}

/** 사용량 표(ai_usage_logs.key_name)에 남길 짧은 이름 — 'ment' · 'consultations' · 'default'(키 없음 'none'). */
export function keyLabelOf(provider: AiProvider, envName: string | null): string {
  if (!envName) return "none";
  const base = PROVIDER_KEY_ENV[provider];
  return envName === base ? "default" : envName.slice(base.length + 1).toLowerCase();
}

/**
 * env AI_PROVIDER로 기본 provider 선택 — `deepseek`이면 DeepSeek, 그 밖(미설정·옛 값 `upstage` 포함)은 Claude.
 * (2026-10-19 Solar를 빼기 전에는 미설정 = Solar였다 — env가 안 걸리면 운영이 Solar로 돌던 함정이 함께 사라졌다.)
 */
export function defaultProvider(): AiProvider {
  return process.env.AI_PROVIDER === "deepseek" ? "deepseek" : "anthropic";
}

export type ResolvedModel = { provider: AiProvider; model: string; keyName: AiKeyName };

/**
 * 폴백 사다리 — **anthropic → deepseek**(원장 2026-08-28 *"anthropic -> deepseek"* · 2026-10-19 *"솔라는 빼버려. 두개면 충분"*).
 * 이 배열 순서가 곧 사다리라, 순서를 바꾸면 폴백 대상이 바뀐다.
 */
const FALLBACK_LADDER: readonly AiProvider[] = ["anthropic", "deepseek"];

/**
 * 후보 provider 순서(reasoning=Anthropic 고정, 그 외 AI_PROVIDER 기본을 맨 앞, 나머지는 폴백, prefer를 최우선).
 * resolveModelChain이 이 순서에서 "모델+키가 실제 있는" 후보만 남기므로, 선호/기본 provider 키가 없어도
 * 다른 provider로 무중단 폴백된다(전사 분석은 prefer:"deepseek" → 키 없으면 anthropic으로).
 */
function providerOrder(tier: AiTier, prefer?: AiProvider): AiProvider[] {
  const def = defaultProvider();
  const base: AiProvider[] =
    tier === "reasoning"
      ? ["anthropic"] // reasoning은 Anthropic 고정(정책)
      : [def, ...FALLBACK_LADDER.filter((p) => p !== def)];
  return prefer ? [prefer, ...base.filter((p) => p !== prefer)] : base;
}

/**
 * 시도 순서대로 **키가 실제 있는** (provider, model) 체인. generateJSON이 이 체인을 돌며 한 provider가
 * 인증/한도 오류를 내면 다음 provider로 폴백한다(B1: 무효 키도 회복 — resolveModel은 단일이라
 * 무효 키여도 첫 provider에 고정됐었다). 키 있는 후보가 없으면 빈 배열.
 */
export function resolveModelChain(
  tier: AiTier,
  keyName: AiKeyName = "default",
  prefer?: AiProvider,
  group?: AiKeyGroup | null,
  /** 기능 고정 모델(`featurePin`) — 그 회사를 맨 앞에 그 모델로 세우고, 나머지는 평소 사다리. reasoning 티어엔 안 건다. */
  pin?: ModelPin | null,
): ResolvedModel[] {
  const usePin = pin && tier !== "reasoning" ? pin : null;
  return providerOrder(tier, usePin?.provider ?? prefer)
    .map((provider) => ({ provider, model: usePin?.provider === provider ? usePin.model : AI_MODELS[tier][provider] }))
    .filter((c): c is { provider: AiProvider; model: string } => Boolean(c.model) && Boolean(resolveKey(c.provider, keyName, group)))
    .map((c) => ({ provider: c.provider, model: c.model, keyName }));
}

/**
 * 티어+키이름 → 실제 (provider, model). 기본 provider 키가 없으면 다른 provider로 폴백(키 있는 쪽) →
 * 둘 다 없으면 모델이 있는 첫 candidate를 반환(이후 클라 생성에서 throw → 호출부 stub). reasoning은 Anthropic 고정.
 *
 * `prefer`: 호출부가 특정 provider를 **선호**(강제 아님)하도록 지정. 키가 있으면 그걸, 없으면 평소 폴백 순서로(무중단).
 */
export function resolveModel(
  tier: AiTier,
  keyName: AiKeyName = "default",
  prefer?: AiProvider,
  group?: AiKeyGroup | null,
  pin?: ModelPin | null,
): ResolvedModel {
  const chain = resolveModelChain(tier, keyName, prefer, group, pin);
  if (chain.length > 0) return chain[0];
  const usePin = pin && tier !== "reasoning" ? pin : null;
  if (usePin) return { provider: usePin.provider, model: usePin.model, keyName };
  // 키 없음 — 모델 있는 첫 candidate(이후 클라 생성에서 throw → 호출부 stub). 기존 동작 보존.
  const order = providerOrder(tier, prefer);
  const provider = order.find((p) => AI_MODELS[tier][p]) ?? "anthropic";
  return { provider, model: AI_MODELS[tier][provider] ?? "claude-sonnet-4-6", keyName };
}
