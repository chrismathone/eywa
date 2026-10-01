import "server-only";
import { oauthRefreshAuth } from "../../../../scripts/_classnote/video-oauth-refresh.mjs";

/**
 * 제출 링크가 쓰는 Drive 연결 — **발송 PC 워커와 같은 OAuth 값**(허락한 계정·같은 저장 폴더)을 Vercel 환경변수에서 읽는다.
 * 토큰 갱신은 워커 모듈 [`oauthRefreshAuth`](../../../../scripts/_classnote/video-oauth-refresh.mjs)를 그대로 부른다(fetch만 · 비밀값을 오류에 안 싣는다).
 *
 * 🔴 지점 하나에만 묶는다(`CLASSNOTE_VIDEO_TENANT_ID`) — Drive 폴더·계정은 한 학원 것이다. 다른 지점이 같은 env를 타고
 *    그 학원 Drive에 올리면 안 된다(Notion·캘린더·직원명부 연동과 같은 규약: env의 지점에서만).
 * 값이 하나라도 없으면 null = 제출 링크 기능 전체가 없는 것처럼(버튼·보고서 줄 없음, 링크 화면은 "지금은 받을 수 없습니다").
 * 🔴 이 모듈의 값(클라이언트 비밀·갱신 토큰·접근 토큰)을 로그·응답·오류 문장에 싣지 말 것. 서버 전용이다.
 */
export type VideoDriveConfig = { tenantId: string; rootId: string; accessToken: () => Promise<string> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DRIVE_ID_RE = /^[A-Za-z0-9_-]{10,}$/;

type Env = Record<string, string | undefined>;
let cached: { fingerprint: string; auth: { accessToken(): Promise<string> } } | null = null;

/** 환경변수 → 설정(없으면 null). 접근 토큰 캐시는 같은 값이 유지되는 동안 프로세스에 하나. */
export function readVideoDriveConfig(env: Env = process.env): VideoDriveConfig | null {
  const tenantId = env.CLASSNOTE_VIDEO_TENANT_ID?.trim() ?? "";
  const rootId = env.CLASSNOTE_VIDEO_DRIVE_FOLDER_ID?.trim() ?? "";
  const clientId = env.GOOGLE_DRIVE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() ?? "";
  const refreshToken = env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim() ?? "";
  if (!UUID_RE.test(tenantId) || !DRIVE_ID_RE.test(rootId) || !clientId || !clientSecret || !refreshToken) return null;
  const fingerprint = `${clientId}\n${clientSecret}\n${refreshToken}`;
  if (cached?.fingerprint !== fingerprint)
    cached = { fingerprint, auth: oauthRefreshAuth({ clientId, clientSecret, refreshToken }) };
  const auth = cached.auth;
  return { tenantId: tenantId.toLowerCase(), rootId, accessToken: () => auth.accessToken() };
}

/** 이 지점에 연결된 Drive 설정 — 다른 지점이면 null. */
export function videoDriveConfigFor(tenantId: string, env: Env = process.env): VideoDriveConfig | null {
  const config = readVideoDriveConfig(env);
  return config && config.tenantId === tenantId.toLowerCase() ? config : null;
}

/** 테스트 전용 — 토큰 캐시 리셋. */
export function _resetVideoDriveConfigForTest(): void {
  cached = null;
}
