/**
 * eywa 서비스 워커 — **휴대폰 푸시 알림 전용**(2026-08-07).
 *
 * 범위(원장 2026-08-07): *"셔틀 선생님으로 체크된 사용자만 알림을 모바일에서 받을 수 있으면 될것 같네.
 * pc 알림은 잘 작동하는것 같더라고"* → 이 파일은 **푸시를 받아 띄우고, 눌렀을 때 그 화면을 여는 것**만 한다.
 *
 * 🔴 **캐싱(오프라인) 기능을 넣지 말 것.** 서비스워커가 앱 응답을 캐시하기 시작하면 배포한 새 코드가
 * 폰에만 옛날 것으로 남아("배포했는데 안 바뀌었다") 원인 추적이 지옥이 된다 — eywa는 이미 열린 탭의
 * 배포 스큐로 한 번 겪었다. fetch 핸들러 자체를 두지 않는 게 그 사고를 구조적으로 막는다.
 *
 * ⚠️ 안드로이드 크롬은 `new Notification()`(생성자)을 지원하지 않는다 — 폰 알림은 **반드시** 여기의
 *    `registration.showNotification()`을 거쳐야 한다. PC의 기존 경로(desktop-notify.ts)와는 별개다.
 */

// 새 버전을 배포하면 기다리지 않고 곧바로 넘겨받는다(구독은 그대로 유지된다).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  // 페이로드가 없거나 깨져도 **무조건 하나는 띄운다** — iOS는 푸시를 받고 알림을 안 띄우면
  // 구독 권한을 회수한다. 내용을 몰라도 "새 알림"으로라도 띄우는 게 안전하다.
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = payload.title || "eywa 알림";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/eywa-mark.png",
      badge: "/eywa-mark.png",
      // 같은 알림이 두 번 와도 하나로 덮어쓴다(알림 id를 태그로 쓴다).
      tag: payload.tag || undefined,
      // 확인 전까지 안 사라지게 — "확실하게 알 수 있으면 좋겠다"(원장, PC 알림과 같은 기준).
      requireInteraction: true,
      data: { link: payload.link || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // 이미 열려 있는 창이 있으면 그 창을 쓴다(폰에서 창이 여러 개 쌓이는 것 방지).
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client && link) client.navigate(link).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(link);
    }),
  );
});
