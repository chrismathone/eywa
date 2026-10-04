import "server-only";
import { createHash } from "node:crypto";
import { oauthRefreshAuth } from "../../../../scripts/_classnote/video-oauth-refresh.mjs";

/**
 * **기존(레거시) Drive 연결** — 발송 PC 워커와 같은 OAuth 값(데스크톱 클라이언트 · 허락한 계정 · 같은 저장 폴더)을 Vercel 환경변수에서 읽는다.
 * 토큰 갱신은 워커 모듈 [`oauthRefreshAuth`](../../../../scripts/_classnote/video-oauth-refresh.mjs)를 그대로 부른다(fetch만 · 비밀값을 오류에 안 싣는다).
 *
 * 🔴 이 env 자격은 **env에 적힌 지점 하나의 기존 저장 폴더에만** 쓴다(`CLASSNOTE_VIDEO_TENANT_ID`). 다른 지점·계정을 연결한 저장 폴더는
 *    지점마다 로그인한 Google 계정의 자격만 쓴다([`drive-credentials.ts`](./drive-credentials.ts)) — 여기로 되돌아오지 않는다.
 * 🔴 이 모듈의 값(클라이언트 비밀·갱신 토큰·접근 토큰)을 로그·응답·오류 문장에 싣지 말 것. 서버 전용이다.
 */
export type VideoDriveConfig = {
  tenantId: string; rootId: string; accessToken: () => Promise<string>;
  /** 저장 폴더에 묶인 계정 연결 — 기존 env 연결이면 null. 새 업로드의 경로에 폴더와 함께 각인한다. */
  connectionId: string | null;
  /** 그 연결의 토큰 번호(다시 연결할 때마다 +1) — 캐시 열쇠. 기존 env 연결이면 null. */
  tokenVersion: number | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DRIVE_ID_RE = /^[A-Za-z0-9_-]{10,}$/;

type Env = Record<string, string | undefined>;
let cached: { fingerprint: string; auth: { accessToken(): Promise<string> } } | null = null;

/** 환경변수 → 기존 연결 설정(없으면 null). 접근 토큰 캐시는 같은 값이 유지되는 동안 프로세스에 하나. */
export function readVideoDriveConfig(env: Env = process.env): VideoDriveConfig | null {
  const tenantId = env.CLASSNOTE_VIDEO_TENANT_ID?.trim() ?? "";
  const rootId = env.CLASSNOTE_VIDEO_DRIVE_FOLDER_ID?.trim() ?? "";
  const auth = readVideoDriveAuth(env);
  if (!UUID_RE.test(tenantId) || !DRIVE_ID_RE.test(rootId) || !auth) return null;
  return { tenantId: tenantId.toLowerCase(), rootId, accessToken: auth.accessToken, connectionId: null, tokenVersion: null };
}

/** 기존 연결의 인증 세 값 → 토큰 공급자. 🔴 어느 지점 것인지는 보지 않는다 — 호출부는 `legacyVideoDriveAuthFor`를 쓸 것. */
export function readVideoDriveAuth(env: Env = process.env): { accessToken: () => Promise<string> } | null {
  const clientId = env.GOOGLE_DRIVE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() ?? "";
  const refreshToken = env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim() ?? "";
  if (!clientId || !clientSecret || !refreshToken) return null;
  const fingerprint = `${clientId}\n${clientSecret}\n${refreshToken}`;
  if (cached?.fingerprint !== fingerprint)
    cached = { fingerprint, auth: oauthRefreshAuth({ clientId, clientSecret, refreshToken }) };
  const auth = cached.auth;
  return { accessToken: () => auth.accessToken() };
}

/**
 * 이 지점이 **env에 적힌 지점일 때만** 기존 연결의 토큰 공급자를 준다. 이미 시작한 옛 작업을 끝낼 때도 쓰므로 저장 폴더 env는 보지 않는다
 * (어느 폴더인지는 등록부가 정한다). 다른 지점이면 null — 그 학원 Drive를 남의 지점이 쓰지 못한다.
 */
export function legacyVideoDriveAuthFor(tenantId: string, env: Env = process.env): { accessToken: () => Promise<string> } | null {
  const envTenant = env.CLASSNOTE_VIDEO_TENANT_ID?.trim().toLowerCase() ?? "";
  if (!UUID_RE.test(envTenant) || envTenant !== tenantId.toLowerCase()) return null;
  return readVideoDriveAuth(env);
}

/**
 * 기존 연결 자격의 지문(SHA-256 16진 64자) — 등록부에 적어 두고, 값이 바뀌었을 때만 그 계정을 다시 확인한다.
 * 클라이언트 번호와 갱신 토큰으로 만든다(비밀을 바꿔도 같은 계정이다). 원문은 어디에도 남기지 않는다.
 */
export function legacyAuthFingerprint(env: Env = process.env): string | null {
  const clientId = env.GOOGLE_DRIVE_CLIENT_ID?.trim() ?? "";
  const refreshToken = env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim() ?? "";
  if (!clientId || !refreshToken) return null;
  return createHash("sha256").update(`${clientId}\n${refreshToken}`).digest("hex");
}

/** 이 지점에 연결된 기존 Drive 설정 — 다른 지점이면 null. */
export function videoDriveConfigFor(tenantId: string, env: Env = process.env): VideoDriveConfig | null {
  const config = readVideoDriveConfig(env);
  return config && config.tenantId === tenantId.toLowerCase() ? config : null;
}

/** 테스트 전용 — 토큰 캐시 리셋. */
export function _resetVideoDriveConfigForTest(): void {
  cached = null;
}
