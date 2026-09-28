/**
 * 슬랙 — 순수 함수(토큰 검증·가리기·mrkdwn 이스케이프·오류 한글화·오류 분류). 서버·클라·테스트 공용.
 * 메시지 조립은 [`render.ts`](./render.ts).
 */

/** 한 번의 발송에서 한 곳(채널·사람)에 낱개로 보낼 최대 수 — 넘으면 종류별 건수 한 통으로 묶는다. */
export const SLACK_AGGREGATE_THRESHOLD = 3;

const TOKEN_RE = /^xoxb-[0-9A-Za-z-]{20,200}$/;

export type SlackTokenCheck = { ok: true; token: string } | { ok: false; error: string };

export function checkSlackBotToken(raw: string): SlackTokenCheck {
  const token = raw.trim();
  if (!token) return { ok: false, error: "봇 토큰을 붙여 넣어 주세요" };
  if (!token.startsWith("xoxb-")) return { ok: false, error: "봇 토큰(xoxb-로 시작)이 아닙니다 — 'Bot User OAuth Token'을 복사하세요" };
  if (!TOKEN_RE.test(token)) return { ok: false, error: "봇 토큰 모양이 올바르지 않습니다" };
  return { ok: true, token };
}

/** 화면 표시용 — 끝 4자만(토큰 원문은 클라에 내려보내지 않는다). */
export function maskSlackToken(token: string): string {
  return token ? `xoxb-••••${token.slice(-4)}` : "";
}

export const escapeMrkdwn = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * 오류 분류 — 발송기가 어떻게 할지:
 *  · auth   = 토큰이 죽었다 → 연결을 '끊김'으로, 발송 중단(매분 재시도하지 않는다)
 *  · target = 그 대상만 안 된다(채널 삭제·보관·봇 미초대·사람 없음) → 그 건 포기, 재시도 없음
 *  · rate   = 한도 → 잠시 뒤
 *  · retry  = 네트워크·일시 오류 → 백오프 재시도
 */
export type SlackErrorKind = "auth" | "target" | "rate" | "retry";

export function slackErrorKind(code: string | null): SlackErrorKind {
  switch (code) {
    case "invalid_auth":
    case "not_authed":
    case "token_revoked":
    case "token_expired":
    case "account_inactive":
    case "missing_scope":
      return "auth";
    case "channel_not_found":
    case "not_in_channel":
    case "is_archived":
    case "users_not_found":
    case "user_not_found":
    case "cannot_dm_bot":
    case "user_disabled":
    case "msg_too_long":
    case "no_text":
      return "target";
    case "ratelimited":
      return "rate";
    default:
      return "retry";
  }
}

/** 슬랙 오류 코드 → 한글(원문 코드는 화면에 그대로 내지 않는다). null = 네트워크·시간 초과. */
export function describeSlackError(code: string | null): string {
  switch (code) {
    case null:
      return "슬랙 서버에 연결하지 못했습니다(시간 초과 또는 네트워크 오류)";
    case "invalid_auth":
    case "not_authed":
    case "token_revoked":
    case "token_expired":
    case "account_inactive":
      return "슬랙이 토큰을 거절했습니다 — 앱이 삭제·재설치됐거나 토큰이 바뀌었습니다. 새 봇 토큰을 등록해 주세요";
    case "missing_scope":
      return "슬랙 앱 권한이 부족합니다 — 안내된 권한(scope)을 모두 추가하고 앱을 다시 설치해 주세요";
    case "channel_not_found":
    case "not_in_channel":
      return "채널에 보낼 수 없습니다 — 비공개 채널이면 채널에서 /invite 로 앱을 먼저 초대해 주세요";
    case "is_archived":
      return "보관된 채널이라 보낼 수 없습니다";
    case "users_not_found":
      return "슬랙에서 같은 이메일의 사용자를 찾지 못했습니다";
    case "ratelimited":
      return "슬랙 발송 한도를 넘었습니다. 잠시 후 다시 시도해 주세요";
    case "not_linked":
      return "슬랙 계정을 연결하지 않은 사람입니다 — '사람 연결'에서 연결해 주세요";
    case "gave_up":
      return "여러 번 실패해 보내지 않았습니다";
    default:
      return "슬랙이 오류로 응답했습니다";
  }
}
