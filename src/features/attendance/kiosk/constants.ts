// 키오스크 디바이스 토큰 쿠키 이름 — 설정 액션(set)·API(read)·키오스크 페이지(read) 공용.
// httpOnly 쿠키. 평문 토큰은 기기에만, 서버엔 SHA-256 해시(kiosk_devices.token_hash)만 저장.
export const KIOSK_COOKIE = "eywa_kiosk_token";
