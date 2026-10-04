/**
 * 숙제영상 드라이브 Google 계정 연결 — **서버와 화면이 같이 쓰는 고정 값**(주소·신호 이름).
 * 일반 모듈이다: 화면(클라이언트)도 읽으므로 `server-only`를 붙이지 않고, 서버가 읽으므로 `"use client"`도 붙이지 않는다.
 * 비밀은 여기 두지 않는다.
 */
export const VIDEO_OAUTH_BASE_PATH = "/api/integrations/homework-video-drive";
/** 연결 시작 — 학원 설정 화면의 버튼이 새 탭으로 POST한다. */
export const VIDEO_OAUTH_START_PATH = `${VIDEO_OAUTH_BASE_PATH}/start`;
/** Google 콘솔에 등록하는 돌아오는 주소(고정). */
export const VIDEO_OAUTH_CALLBACK_PATH = `${VIDEO_OAUTH_BASE_PATH}/callback`;
/** 로그인이 끝난 새 탭의 결과 화면. */
export const VIDEO_OAUTH_DONE_PATH = `${VIDEO_OAUTH_BASE_PATH}/done`;
/** 결과 화면 → 학원 설정 화면 신호(BroadcastChannel — 같은 출처에서만 들린다). 실리는 것은 상태 이름 하나뿐이다. */
export const VIDEO_OAUTH_CHANNEL = "aywa-video-drive-oauth";
export const VIDEO_OAUTH_MESSAGE_TYPE = "video-drive-oauth";
