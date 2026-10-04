// scripts/_classnote/video-oauth-values.mjs — Drive OAuth 값 파일(`aywa-video-oauth.txt`)과 `.env.local` 합치기. 순수(의존성 0).
//
// 값 파일 = 로그인한 PC에서 만들어 발송 PC로 옮기는 인증 3줄(`KEY=값`). 발송 PC는 이 파일을 읽어 `.env.local`에 넣고 지운다.
// 저장 폴더(CLASSNOTE_VIDEO_DRIVE_FOLDER_ID)는 지점 설정이다. 값 파일에 남아 있어도 읽지 않고, env에 덮어쓰지 않는다.
// 🔴 값(비밀·토큰)을 오류 문장에 싣지 않는다 — 어느 키가 문제인지만 말한다.
export const OAUTH_VALUES_FILE = "aywa-video-oauth.txt";
export const OAUTH_KEYS = ["GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"];
const FOLDER_KEY = "CLASSNOTE_VIDEO_DRIVE_FOLDER_ID";
/** OAuth로 바꾸면 지우는 키 — gcloud 계정이 남아 있으면 인증이 그쪽을 먼저 탄다(video-drive-auth). */
const GCLOUD_KEYS = ["GOOGLE_DRIVE_GCLOUD_ACCOUNT", "GOOGLE_DRIVE_GCLOUD_PATH"];
const FOLDER_ID = /^[A-Za-z0-9_-]{10,}$/;
/** Drive 폴더 ID 모양인가(주소를 통째로 붙여 넣은 경우를 거른다). */
export const isDriveFolderId = (value) => FOLDER_ID.test(String(value ?? ""));

function checkValue(key, value) {
  if (!value) throw new Error(`값 파일에 ${key}가 없습니다.`);
  // `.env.local`에 `KEY='값'`으로 적는다 — 따옴표·줄바꿈·공백이 섞이면 다음 줄까지 깨진다.
  if (/[\r\n"'\s]/.test(value)) throw new Error(`값 파일의 ${key} 모양이 올바르지 않습니다.`);
}

/** 값 파일 본문 → {키: 값}. 인증 세 키가 모두 있어야 하고, 모르는 키는 거절한다(엉뚱한 파일을 넣은 경우).
 *  옛 파일의 저장 폴더 줄은 무시한다 — 워커 설정으로 들어가지 않게. */
export function parseOauthValues(text) {
  const out = {};
  for (const raw of String(text ?? "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at <= 0) throw new Error("값 파일의 줄 모양이 올바르지 않습니다.");
    const key = line.slice(0, at).trim();
    if (key === FOLDER_KEY) continue;
    if (!OAUTH_KEYS.includes(key)) throw new Error("영상 연결용 값 파일이 아닙니다.");
    out[key] = line.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  for (const key of OAUTH_KEYS) checkValue(key, out[key]);
  return out;
}

/** {키: 값} → 값 파일 본문. */
export function formatOauthValues(values) {
  for (const key of OAUTH_KEYS) checkValue(key, values?.[key]);
  return `# aywa 영상 보관 Drive 연결 값 — 발송 PC에 옮겨 적용한 뒤에는 지우세요(적용 스크립트가 지웁니다).\n${OAUTH_KEYS.map((key) => `${key}=${values[key]}`).join("\n")}\n`;
}

/** `.env.local` 본문에 인증 세 값을 넣는다 — 같은 키의 옛 줄과 gcloud 키 줄은 지우고, 나머지 줄은 그대로 둔다.
 *  🔴 저장 폴더 줄은 지우지도 않고 값 파일의 폴더로 다시 쓰지도 않는다(구 스키마 env 폴백·저장된 지점 설정). */
export function mergeOauthEnv(body, values) {
  for (const key of OAUTH_KEYS) checkValue(key, values?.[key]);
  let next = String(body ?? "");
  // 손으로 고친 줄(`KEY = '값'` · `export KEY=…`)도 지운다 — gcloud 계정 줄이 남으면 인증이 계속 그쪽을 탄다.
  for (const key of [...OAUTH_KEYS, ...GCLOUD_KEYS]) next = next.replace(new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=.*(?:\\r?\\n|$)`, "gm"), "");
  return `${next.trimEnd()}\n${OAUTH_KEYS.map((key) => `${key}='${values[key]}'`).join("\n")}\n`;
}
