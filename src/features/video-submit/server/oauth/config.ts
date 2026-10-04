import "server-only";
import { VIDEO_OAUTH_BASE_PATH, VIDEO_OAUTH_CALLBACK_PATH } from "../../drive-oauth-shared";

/**
 * 숙제영상 드라이브 **Google 계정 연결**(지점마다 따로 로그인)의 앱 설정 — Vercel 환경변수 세 값.
 *
 * 🔑 앱 식별(클라이언트 번호·비밀)은 전 지점 공통이고 서버 env에만 있다. 지점의 갱신 토큰은 DB 금고에만 있다 — 둘이 함께 있어야
 *    토큰을 받을 수 있다(한쪽만으로는 못 쓴다). 기존 연결의 데스크톱 클라이언트(`GOOGLE_DRIVE_*`)와는 다른 클라이언트다.
 * 🔴 돌아오는 주소는 **env에 적은 고정 주소**만 쓴다 — 요청의 Host·X-Forwarded-Host로 만들지 않는다.
 * 🔴 이 모듈의 비밀을 로그·응답·오류 문장에 싣지 말 것. 서버 전용이다.
 */
export type VideoOAuthConfig = {
  clientId: string; clientSecret: string;
  /** Google 콘솔에 등록한 주소 그대로(env 값) — 인증 요청·코드 교환에 같은 값을 보낸다. */
  redirectUri: string;
  /** 그 주소의 출처(`https://호스트`) — 시작 요청·돌아온 요청이 이 출처여야 한다(쿠키가 이 출처에만 있다). */
  origin: string;
  host: string;
  /** https인가 — 개발용 localhost만 http를 받는다. 쿠키의 Secure 여부. */
  secure: boolean;
};

type Env = Record<string, string | undefined>;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const clean = (value: string | undefined): string => (value ?? "").trim();
const plain = (value: string): boolean => value.length > 0 && value.length <= 512 && !/\s/.test(value);

/** env → 설정. 하나라도 없거나 주소가 정해진 모양이 아니면 null(연결 기능이 아직 없는 것처럼). */
export function readVideoOAuthConfig(env: Env = process.env): VideoOAuthConfig | null {
  const clientId = clean(env.HOMEWORK_VIDEO_GOOGLE_CLIENT_ID);
  const clientSecret = clean(env.HOMEWORK_VIDEO_GOOGLE_CLIENT_SECRET);
  const redirect = clean(env.HOMEWORK_VIDEO_GOOGLE_REDIRECT_URI);
  if (!plain(clientId) || !plain(clientSecret) || !plain(redirect)) return null;
  let url: URL;
  try { url = new URL(redirect); } catch { return null; }
  const secure = url.protocol === "https:";
  if (!secure && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) return null;
  if (url.pathname !== VIDEO_OAUTH_CALLBACK_PATH || url.search || url.hash || url.username || url.password) return null;
  return { clientId, clientSecret, redirectUri: `${url.origin}${url.pathname}`, origin: url.origin, host: url.host.toLowerCase(), secure };
}

/**
 * 저장된 클라이언트 번호로 비밀을 고른다 — 갱신 토큰은 그것을 발급한 클라이언트로만 갱신된다.
 * 지금 클라이언트면 지금 비밀(같은 번호의 비밀 교체는 env만 바꾸면 된다), 예전 클라이언트면 선택 env `…_PREVIOUS_*` 한 쌍.
 * 어느 쪽도 아니면 null — 🔴 다른 클라이언트의 비밀로 갱신을 시도하지 않는다.
 */
export function videoOAuthClientSecret(clientId: string, env: Env = process.env): string | null {
  if (!plain(clientId)) return null;
  const current = clean(env.HOMEWORK_VIDEO_GOOGLE_CLIENT_ID);
  if (current === clientId) return clean(env.HOMEWORK_VIDEO_GOOGLE_CLIENT_SECRET) || null;
  const previous = clean(env.HOMEWORK_VIDEO_GOOGLE_PREVIOUS_CLIENT_ID);
  if (previous && previous === clientId) return clean(env.HOMEWORK_VIDEO_GOOGLE_PREVIOUS_CLIENT_SECRET) || null;
  return null;
}

/** 로그인 한 번 동안 PKCE 검증값을 담는 쿠키 — https면 `__Secure-` 접두(안전한 출처만 구울 수 있다). 경로는 이 연결 라우트로 좁힌다. */
export function videoOAuthCookie(config: Pick<VideoOAuthConfig, "secure">): { name: string; path: string; secure: boolean } {
  return { name: config.secure ? "__Secure-aywa-video-drive-oauth" : "aywa-video-drive-oauth", path: VIDEO_OAUTH_BASE_PATH, secure: config.secure };
}
