// 멘트(학부모 보고서 본문 notes) **작성 방식** 판정 — 순수(Vitest). 0214a `lesson_reports.ment_source`.
//
// 왜 있나(원장 2026-08-18): 강사별 "직접 쓴 멘트"를 골라 모아 **강사별 말투 코퍼스**를 만들고, 후속으로
// 강사별 자동생성 멘트에 그 말투를 반영하기 위한 기반. 그래서 구분의 목적은 통계가 아니라 **코퍼스 순도**다 —
// AI가 쓴 문장을 '직접 작성'으로 오표기하는 쪽이 반대(직접 쓴 걸 자동으로 오표기)보다 훨씬 나쁘다.
// 판정 규칙이 애매할 땐 항상 **자동 쪽으로 보수적으로** 기운다.
//
// 값 3종 + NULL(도입 전·미상 — 소급 없음, 모르면 null이 정직):
//  · auto        = 자동작성 그대로(AI 성공분 + AI 실패 시 템플릿 폴백 포함 — 강사 문장이 아니라는 점은 같다)
//  · auto_edited = 자동작성 후 강사가 한 글자라도 수정(전부 지우고 새로 썼어도 여기 — 세션 안에서 AI 문장을
//                  본 뒤의 작성이라 순수 자필로 신뢰하지 않는다, 보수 규칙)
//  · manual      = 자동작성 이력 없이 처음부터 직접 작성
//
// UI 라벨은 아래 MENT_SOURCE_LABEL 단일 소스(raw 키 화면 노출 금지 규칙).
//
// 🔑 영어 글 속 첨부 자리 줄(`[첨부: …]`, 2026-09-11)은 문장이 아니다 — 비었는지·같은지를 볼 때 빼고 본다. 사진 한 장 넣었다고
//    '자동작성 후 수정'이 되지 않고, 사진만 있는 글은 멘트가 없는 것이다('직접 작성'으로 코퍼스에 들어가지 않게).
import { withoutAttachmentLines } from "@/features/report-templates/attachment-lines";

const sentencesOf = (s: string | null | undefined) => withoutAttachmentLines(s ?? "").trim();

// 나열 순서 = 필터 <option> 순서 — 이 기능의 주 용도(직접 쓴 멘트 찾기)가 맨 앞.
export const MENT_SOURCES = ["manual", "auto_edited", "auto"] as const;
export type MentSource = (typeof MENT_SOURCES)[number];

/** 화면 표시 라벨(전체 문구) — 필터 옵션·툴팁. */
export const MENT_SOURCE_LABEL: Record<MentSource, string> = {
  auto: "자동작성 그대로",
  auto_edited: "자동작성 후 수정",
  manual: "직접 작성",
};

/** 목록 셀용 축약 라벨 — 좁은 열에서 한눈에. */
export const MENT_SOURCE_SHORT: Record<MentSource, string> = {
  auto: "자동",
  auto_edited: "자동+수정",
  manual: "직접",
};

/** 신뢰 경계 정규화 — 클라이언트/DB에서 온 임의 문자열을 알려진 값으로만 좁힌다(그 외 undefined). */
export function parseMentSource(v: unknown): MentSource | undefined {
  return v === "auto" || v === "auto_edited" || v === "manual" ? v : undefined;
}

/**
 * 클라이언트 판정 — 이번 세션의 자동작성 스냅샷(autoDraft)과 최종 멘트를 비교.
 * autoDraft = 자동작성 버튼이 멘트 칸에 **마지막으로 넣은** 텍스트(AI 성공분·템플릿 폴백 모두).
 * 반환 undefined = 멘트 없음(저장 시 null).
 */
export function computeClientMentSource(
  draft: string | null | undefined,
  autoDraft: string | null | undefined,
): MentSource | undefined {
  const d = sentencesOf(draft);
  if (!d) return undefined;
  const a = sentencesOf(autoDraft);
  if (!a) return "manual";
  return d === a ? "auto" : "auto_edited";
}

/**
 * 서버 최종 판정 — 클라 판정에 **저장돼 있던 라벨의 끈끈함(sticky)** 을 더한다.
 *
 * 왜 필요한가: autoDraft 스냅샷은 세션(브라우저 상태 + 세션 자동저장)에 산다. 어제 AI로 만들어 저장한
 * 멘트를 오늘 새 세션에서 고치면 클라는 스냅샷이 없어 'manual'이라 우기게 되는데, 그 문장은 AI 유래다.
 * → 저장돼 있던 라벨이 auto 계열이고 텍스트가 바뀌었으면 클라 주장과 무관하게 'auto_edited'로 강등(보수).
 *
 * 규칙(위에서 아래로 첫 일치):
 *  1) 새 멘트 없음 → null
 *  2) 기존 멘트와 텍스트 동일(trim) → 기존 라벨 유지(모르던 행은 null 유지 — 안 고친 저장이 라벨을 지어내지 않는다)
 *  3) 클라가 auto/auto_edited → 그대로 신뢰(자동작성 사실은 클라만 안다)
 *  4) 클라가 manual → 기존 라벨이 auto 계열이면 'auto_edited'(sticky 강등), 아니면 'manual'
 *  5) 클라 판정 없음(구 클라·서버 직접 호출) → 기존이 auto 계열이면 'auto_edited', 아니면 null(지어내지 않는다)
 */
export function resolveMentSource(args: {
  client?: MentSource | null;
  prevSource?: string | null;
  prevNotes?: string | null;
  nextNotes?: string | null;
}): MentSource | null {
  const next = sentencesOf(args.nextNotes);
  if (!next) return null;
  const prev = sentencesOf(args.prevNotes);
  const prevSrc = parseMentSource(args.prevSource) ?? null;
  if (prev && next === prev) return prevSrc;
  const client = parseMentSource(args.client);
  if (client === "auto" || client === "auto_edited") return client;
  const aiDerived = prevSrc === "auto" || prevSrc === "auto_edited";
  if (client === "manual") return aiDerived ? "auto_edited" : "manual";
  return aiDerived ? "auto_edited" : null;
}

/**
 * "ment_source 컬럼이 아직 없다"(0214a 미적용) 에러 판별 — select는 42703("column … does not exist"),
 * insert/upsert는 PGRST204("Could not find the 'ment_source' column … in the schema cache")로 온다.
 * 둘 다 메시지에 컬럼명이 실리므로 그걸 본다(코드는 경로마다 달라 신뢰 불가).
 */
export function isMentSourceMissingError(message: string | null | undefined): boolean {
  return !!message && message.includes("ment_source");
}
