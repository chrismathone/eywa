import "server-only";
import { VIDEO_OAUTH_CHANNEL, VIDEO_OAUTH_DONE_PATH, VIDEO_OAUTH_MESSAGE_TYPE } from "../../drive-oauth-shared";

/**
 * Google 로그인이 끝난 **새 탭의 결과 화면**(성공·실패 한 줄) + 학원 설정 화면에 "끝났다"를 알리는 신호.
 *
 * 🔴 주소·화면·신호에 싣는 것은 **정해 둔 상태 이름 하나뿐**이다 — 코드·state·토큰·계정·오류 원문은 어디에도 넣지 않는다.
 *    모르는 상태 이름은 '실패'로 바꾼다(주소의 글자를 화면에 그대로 찍지 않는다).
 * 신호는 BroadcastChannel(같은 출처에서만 들린다) — 학원 설정 화면이 받아 스스로 새로 읽는다.
 */
const MESSAGES = {
  connected: ["Google 계정을 연결했습니다", "이 창을 닫고 학원 설정 화면으로 돌아가 저장 폴더를 확인해 주세요."],
  denied: ["연결을 취소했습니다", "Google 화면에서 허용하지 않았습니다. 지금 설정은 그대로입니다."],
  consent: ["연결하지 못했습니다", "Google이 계속 쓸 수 있는 허락을 주지 않았습니다. 다시 시도해 동의 화면에서 '허용'을 눌러 주세요."],
  scope: ["연결하지 못했습니다", "Google Drive 권한이 빠졌습니다. 다시 시도해 동의 화면에서 Drive 항목을 모두 선택해 주세요."],
  identity: ["연결하지 못했습니다", "로그인한 Google 계정을 확인하지 못했습니다. 이메일 확인이 끝난 계정으로 다시 시도해 주세요."],
  other_account: ["다른 계정으로 로그인했습니다", "지금 연결된 계정과 다른 Google 계정입니다. 계정을 바꾸려면 학원 설정 화면에서 '다른 계정으로 바꾸기'를 눌러 주세요. 지금 설정은 그대로입니다."],
  rejected: ["연결하지 못했습니다", "이 Google 계정을 이 지점에 연결할 수 없거나, 그사이 설정이 바뀌었습니다. 학원 설정 화면을 새로고침한 뒤 이 지점 전용 계정으로 다시 시도해 주세요."],
  expired: ["다시 시도해 주세요", "연결 요청이 만료됐거나 이미 사용됐습니다. 학원 설정 화면에서 처음부터 다시 시작해 주세요."],
  session: ["로그인이 필요합니다", "aywa 로그인이 풀렸습니다. 다시 로그인한 뒤 학원 설정 화면에서 처음부터 다시 시작해 주세요."],
  forbidden: ["연결할 수 없습니다", "연동 설정을 바꿀 수 있는 계정으로 다시 시도해 주세요."],
  origin: ["주소를 확인해 주세요", "aywa 정식 주소로 접속한 화면에서 다시 시작해 주세요."],
  stale: ["다시 시도해 주세요", "그사이 설정이 바뀌었습니다. 학원 설정 화면을 새로고침한 뒤 다시 시작해 주세요."],
  legacy: ["연결하지 못했습니다", "기존에 쓰던 연결을 확인하지 못해 새 계정을 받을 수 없습니다. 잠시 후 다시 시도해 주세요."],
  unavailable: ["아직 준비 중입니다", "Google 계정 연결을 아직 쓸 수 없습니다."],
  failed: ["연결하지 못했습니다", "잠시 후 학원 설정 화면에서 다시 시도해 주세요. 지금 설정은 그대로입니다."],
} as const satisfies Record<string, readonly [string, string]>;

export type VideoOAuthDoneStatus = keyof typeof MESSAGES;
export const isVideoOAuthDoneStatus = (value: unknown): value is VideoOAuthDoneStatus =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(MESSAGES, value);

export const videoOAuthDonePath = (status: VideoOAuthDoneStatus): string => `${VIDEO_OAUTH_DONE_PATH}?status=${status}`;

/** 이 화면은 바깥 자원을 하나도 부르지 않는다 — 인라인 스타일·스크립트(신호 한 줄)만 허용하고 다른 사이트의 틀 안에 들어가지 않는다. */
export const VIDEO_OAUTH_PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
} as const;

/** 결과 화면 HTML — 상태 이름은 위 목록의 열쇠라 글자 그대로 넣어도 안전하다(영문 소문자·밑줄뿐). */
export function renderVideoOAuthDonePage(input: unknown): string {
  const status: VideoOAuthDoneStatus = isVideoOAuthDoneStatus(input) ? input : "failed";
  const [title, body] = MESSAGES[status];
  const tone = status === "connected" ? "#0d7743" : "#b44832";
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>숙제영상 드라이브 연결 — aywa</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#e9edf4;color:#121212;
font-family:Pretendard,-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;word-break:keep-all}
main{background:#fff;border:1px solid rgba(29,29,31,.14);border-radius:16px;padding:28px 24px;margin:16px;max-width:420px}
h1{margin:0 0 10px;font-size:20px;line-height:1.4;color:${tone}}
p{margin:0 0 20px;font-size:16px;line-height:1.6}
button{font:inherit;font-weight:700;color:#fff;background:#363c41;border:0;border-radius:8px;padding:10px 18px;cursor:pointer}
</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p>${body}</p>
<button type="button" id="close">이 창 닫기</button>
</main>
<script>
try{var c=new BroadcastChannel(${JSON.stringify(VIDEO_OAUTH_CHANNEL)});c.postMessage({type:${JSON.stringify(VIDEO_OAUTH_MESSAGE_TYPE)},status:${JSON.stringify(status)}});c.close()}catch(e){}
document.getElementById("close").addEventListener("click",function(){window.close()});
</script>
</body>
</html>`;
}

/** 결과 화면 응답(주소를 옮기지 않고 그 자리에서 보여 줄 때 — 시작 단계의 거절). */
export function videoOAuthDoneResponse(status: VideoOAuthDoneStatus, httpStatus = 200): Response {
  return new Response(renderVideoOAuthDonePage(status), { status: httpStatus, headers: VIDEO_OAUTH_PAGE_HEADERS });
}
