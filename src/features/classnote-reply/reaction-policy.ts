/**
 * ClassNote **학부모 글·댓글 공감**(0319a) — 앱 쪽 순수 판정(서버·클라 공용, `server-only` 금지 #61).
 *
 * 원장 2026-10-01 *"댓글 공감 누르기 버튼도 가능하면 기능 배선"* — aywa에서 누르면 연동 PC 워커가 봇 계정으로 ClassNote 그 글·댓글에
 * 공감을 누르거나 푼다. 모드·자격·게시 명의는 답글과 **같은 것**을 쓴다(reply-policy·reply-permission).
 * 🔑 ClassNote 공감은 (계정·명의·종류)당 하나이고 '공감한 사람'에 **보낸 명의**가 보인다(2026-10-01 학원이 글 실측).
 *    aywa는 학부모 메시지 하나에 공감 하나만 둔다(먼저 누른 사람의 명의) — 여럿이 각자 누르면 학부모 폰에 공감 알림이 여러 번 간다.
 * 🔴 워커가 같은 종류·라벨을 `scripts/_classnote/parent-reaction-guard.mjs`에 따로 든다 — 패리티 테스트가 대조한다.
 */
import type { SemanticTone } from "@/lib/design/semantic-color";
import { isReplyManager } from "./reply-policy";

export const REACTION_TYPES = ["like", "thanks", "check", "delight", "surprise", "sorrow"] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];
/** 화면 표기(ClassNote 공감 종류 이름 그대로) — 영문 코드를 화면에 내보내지 않는다. */
export const REACTION_LABELS: Record<ReactionType, string> = {
  like: "좋아요", thanks: "감사해요", check: "확인했어요", delight: "기쁨", surprise: "놀람", sorrow: "슬픔",
};

export function isReactionType(v: unknown): v is ReactionType {
  return typeof v === "string" && (REACTION_TYPES as readonly string[]).includes(v);
}

export type ReactionStatus = "queued" | "processing" | "success" | "failed" | "remove_requested" | "removed";

/**
 * 상태 → 화면 라벨(raw 코드 노출 금지). `pressed` = 지금 ClassNote에 눌려 있다고 보는가(풀기 대기 포함).
 * `unconfirmed` = 누르기 요청은 나갔는데 결과를 확정하지 못했다 — 실패·풀림으로 끝났어도 '못 눌렀다'고 단정하지 않는다.
 */
export function reactionStatusView(r: { status: ReactionStatus; processingAction?: string | null; error?: string | null; failedAction?: string | null; unconfirmed?: boolean }): {
  label: string; tone: SemanticTone; busy: boolean; pressed: boolean;
} {
  if (r.unconfirmed && (r.status === "failed" || r.status === "removed")) return { label: "공감 확인 필요", tone: "caution", busy: false, pressed: false };
  // 확인 필요 행이 대기 중 = 연동 PC가 눌렸는지 **확인만** 한다(다시 누르지 않는다).
  if (r.unconfirmed && r.status === "queued") return { label: "공감 확인 중", tone: "info", busy: true, pressed: false };
  switch (r.status) {
    case "queued":
      return { label: "공감 누르는 중", tone: "info", busy: true, pressed: false };
    case "processing":
      return r.processingAction === "remove"
        ? { label: "공감 푸는 중", tone: "info", busy: true, pressed: true }
        : { label: "공감 누르는 중", tone: "info", busy: true, pressed: false };
    case "remove_requested":
      return { label: "공감 푸는 중", tone: "info", busy: true, pressed: true };
    case "failed":
      return { label: "공감하지 못함", tone: "critical", busy: false, pressed: false };
    case "removed":
      return { label: "공감 풂", tone: "inert", busy: false, pressed: false };
    default:
      return r.error && r.failedAction === "remove"
        ? { label: "공감함 · 풀기 실패", tone: "caution", busy: false, pressed: true }
        : { label: "공감함", tone: "positive", busy: false, pressed: true };
  }
}

/**
 * 풀 수 있나 — 누른 사람 본인 또는 관리자급, 그리고 손댈 수 있는 상태(대기·눌림).
 * 🔴 '확인 필요'(`unconfirmed`)인 **대기** 행은 바로 취소하지 않는다 — 앞선 시도의 요청이 ClassNote에 눌려 있을 수 있다(워커가 확정한 뒤 푼다).
 */
export function canRemoveReaction(a: { userId: string; role: string; authorUserId: string | null; status: ReactionStatus; manager?: boolean; unconfirmed?: boolean }): boolean {
  if (a.status !== "queued" && a.status !== "success") return false;
  if (a.status === "queued" && a.unconfirmed) return false;
  return a.manager === true || isReplyManager(a.role) || (!!a.authorUserId && a.authorUserId === a.userId);
}

/** 새로 누를 수 있는 상태인가(행이 없거나 · 못 눌렀거나 · 풀었거나). 대기·처리 중·눌림이면 아니다. */
export function canPressReaction(status: ReactionStatus | null): boolean {
  return status === null || status === "failed" || status === "removed";
}
