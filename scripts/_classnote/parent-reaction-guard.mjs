// scripts/_classnote/parent-reaction-guard.mjs — 학부모 글·댓글 **공감**(0319a) 워커 판정(순수, Vitest).
//
// 원장 2026-10-01 *"댓글 공감 누르기 버튼도 가능하면 기능 배선"* — aywa에서 누른 공감을 연동 PC 워커가 봇 계정으로 ClassNote에 누르거나 푼다.
// 모드·대상 확인·쓰기 허가증은 답글과 **같은 것**이다(parent-reply-guard `preflightReplyPlace`·`evaluateReplyTarget`·`assertReplyWritePermit`).
// 여기는 공감에만 있는 것: 종류 · 다음 상태 · 사유 라벨.
// ⚠️ 의존성 0(가드 모듈만) — playwright·postgres를 import하지 말 것.
// 🔴 앱(src/features/classnote-reply/reaction-policy.ts)이 종류·라벨을 한 벌 더 든다 — 패리티 테스트(reply-guard-parity.test.ts)가 대조한다.
import { REPLY_AUTHOR_MAX, REPLY_POST_MAX_AGE_HOURS, REPLY_RETRY_MAX, normalizeReplyMode, preflightReplyPlace } from "./parent-reply-guard.mjs";

/** ClassNote 공감 종류(2026-10-01 `GET /api/v1_2/reactions/types/` 실측 6종). 워커는 쓰기 전에 ClassNote 목록에 아직 있는지 다시 본다. */
export const REACTION_TYPES = Object.freeze(["like", "thanks", "check", "delight", "surprise", "sorrow"]);
export const REACTION_LABELS = Object.freeze({ like: "좋아요", thanks: "감사해요", check: "확인했어요", delight: "기쁨", surprise: "놀람", sorrow: "슬픔" });

const toNum = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/**
 * 공감 행 → 답글 가드가 읽는 모양(행의 '대상 댓글' = 답글 행의 '답한 댓글' 자리). 가드의 메시지 대조(①)가 같은 규칙으로 돈다.
 */
export function reactionRowForGuard(row) {
  return { ...row, reply_to_comment_id: row?.target_comment_id ?? null };
}

/** ClassNote를 읽기도 전에 — 요청 행만 보고 지금 모드에서 손댈 수 있는 자리인가(자리 규칙은 답글과 같다). */
export function preflightReactionRow({ mode, row }) {
  if (normalizeReplyMode(mode) === "off") return { ok: false, code: "mode_off" };
  if (!REACTION_TYPES.includes(row?.reaction_type)) return { ok: false, code: "invalid" };
  const author = String(row?.author_label ?? "").trim();
  if (!author || author.length > REPLY_AUTHOR_MAX) return { ok: false, code: "invalid" };
  if (!Number.isFinite(Number(row?.classnote_post_id)) || Number(row.classnote_post_id) <= 0) return { ok: false, code: "invalid" };
  if (row?.target_comment_id != null && !Number.isFinite(toNum(row.target_comment_id))) return { ok: false, code: "invalid" };
  if ((row?.processing_action ?? "add") === "remove" && !Number.isFinite(toNum(row?.classnote_reaction_id))) return { ok: false, code: "gone" };
  return preflightReplyPlace({ mode, row });
}

/** 묵은 '누름' 요청인가 — 답글과 같은 상한(24시간). 풀기엔 걸지 않는다. 요청 시각을 모르면 묵은 것으로 본다. */
export function isReactionExpired(row, now = Date.now()) {
  const at = row?.requested_at == null ? NaN : new Date(row.requested_at).getTime();
  return !Number.isFinite(at) || now - at > REPLY_POST_MAX_AGE_HOURS * 3_600_000;
}

/** 그 명의의 공감 목록(`my_reactions`)에서 같은 종류의 공감 번호. 없으면 null. */
export function findMyReaction(mine, reactionType) {
  const hit = (Array.isArray(mine) ? mine : []).find((r) => r && r.reaction_type === reactionType && Number.isFinite(toNum(r.id)));
  return hit ? Number(hit.id) : null;
}

/** 그 명의의 공감 목록에 그 번호가 있나(남의 공감을 풀지 않는다). */
export function hasMyReaction(mine, reactionId) {
  const id = toNum(reactionId);
  return id !== null && (Array.isArray(mine) ? mine : []).some((r) => toNum(r?.id) === id);
}

/**
 * 한 번 처리한 뒤의 상태.
 * kind: done · already · gone(대상 공감·댓글이 없다) · blocked(가드·거절) · retryable(결과 모름)
 * 🔴 풀기 실패는 공감이 **그대로 눌려 있다**는 뜻이라 success로 돌린다(사유는 error 칸).
 */
export function reactionNextState({ action, kind, retryCount = 0 }) {
  const again = kind === "retryable" && retryCount + 1 < REPLY_RETRY_MAX;
  if (action === "remove") {
    if (kind === "done" || kind === "already" || kind === "gone") return "removed";
    return again ? "remove_requested" : "success";
  }
  if (kind === "done" || kind === "already") return "success";
  return again ? "queued" : "failed";
}

const LABELS = {
  mode_off: "공감 기능이 꺼져 있습니다",
  mode_changed: "처리하는 사이 설정이 바뀌어 반영하지 않았습니다",
  not_test_target: "시험 단계라 학원이 테스트 보드의 학원이 글에만 공감을 누릅니다",
  test_board_polluted: "테스트 보드에 학원* 테스트 원아가 아닌 원아가 있어 반영하지 않았습니다",
  target_unconfirmed: "이 글의 학생·원아를 확정하지 못해 반영하지 않았습니다",
  facts_unavailable: "학생 연결 기록을 확인하지 못했습니다 — 잠시 뒤 다시 시도합니다",
  message_mismatch: "학부모 글 기록과 요청이 달라 반영하지 않았습니다",
  board_unknown: "aywa가 아는 보드(연결된 반 보드·확인된 1인 보드)가 아니라 반영하지 않았습니다",
  child_not_in_board: "그 원아가 지금 그 보드에 없어 반영하지 않았습니다",
  student_mismatch: "원아와 학생의 확정 연결이 요청과 달라 반영하지 않았습니다",
  board_mismatch: "원글의 보드가 요청 때와 달라 반영하지 않았습니다",
  child_mismatch: "원글의 원아가 요청 때와 달라 반영하지 않았습니다",
  post_gone: "원글이 ClassNote에서 지워졌습니다",
  post_unavailable: "ClassNote에서 원글을 확인하지 못했습니다 — 잠시 뒤 다시 시도합니다",
  board_check_failed: "보드 원아를 확인하지 못했습니다 — 잠시 뒤 다시 시도합니다",
  comments_unavailable: "ClassNote 댓글 목록을 확인하지 못했습니다 — 잠시 뒤 다시 시도합니다",
  reactions_unavailable: "ClassNote 공감 상태를 확인하지 못했습니다 — 잠시 뒤 다시 시도합니다",
  rejected: "ClassNote가 요청을 거부했습니다",
  uncertain: "ClassNote 응답이 불확실해 다시 확인 후 재시도합니다",
  write_guard: "쓰기 가드가 막았습니다 — 대상 확인을 통과하지 않은 글입니다",
  invalid: "공감 요청이 올바르지 않습니다",
  gone: "ClassNote에서 이미 풀린 공감입니다",
  comment_gone: "공감할 댓글이 ClassNote에서 지워졌습니다",
  not_parent_comment: "학부모가 쓴 댓글이 아니라 공감을 누르지 않았습니다",
  type_unknown: "ClassNote에 없는 공감 종류라 누르지 않았습니다",
  expired: "요청한 지 하루가 넘어 누르지 않았습니다 — 필요하면 다시 눌러 주세요",
  not_pressed: "앞선 공감이 ClassNote에 눌리지 않은 것을 확인했습니다 — 다시 눌러 주세요",
  not_ours: "ClassNote에서 이 명의의 공감을 찾지 못해 손대지 않았습니다",
};

/** 한글 사유(화면·error 칸). 원문은 error_raw로 따로 적는다. */
export function reactionErrorLabel(code) {
  return LABELS[code] ?? "공감을 처리하지 못했습니다";
}
