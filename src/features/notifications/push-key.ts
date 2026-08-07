/**
 * VAPID 공개키(base64url 문자열) → 브라우저 구독이 요구하는 바이트 배열. 순수함수(Vitest 대상).
 *
 * 왜 변환이 필요한가: `pushManager.subscribe({ applicationServerKey })`는 **문자열이 아니라 바이트**를
 * 받는다. base64url(`-`·`_`, 패딩 없음)을 그대로 atob에 넣으면 브라우저가 던지고, 그 오류는 "켜기를
 * 눌렀는데 아무 일도 안 남"으로만 보인다 — 그래서 이 변환을 따로 떼어 테스트로 잠근다.
 */
export function urlBase64ToBytes(base64Url: string): Uint8Array {
  const trimmed = String(base64Url ?? "").trim();
  if (!trimmed) throw new Error("공개키가 비어 있습니다");
  const padded = trimmed + "=".repeat((4 - (trimmed.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** 이 브라우저가 웹 푸시를 할 수 있나(서비스워커 + 푸시 + 알림). */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * 아이폰인데 **홈 화면에 추가하지 않은** 상태인가 — iOS는 설치된 앱(standalone)에만 푸시를 준다(16.4+).
 * 이 경우 '켜기'를 눌러도 브라우저가 조용히 거절하므로, 버튼 대신 안내를 보여줘야 한다.
 */
export function iosNeedsInstall(ua: string, standalone: boolean): boolean {
  return /iPhone|iPad|iPod/i.test(ua) && !standalone;
}
