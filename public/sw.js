/**
 * aywa 서비스 워커 — **휴대폰 푸시 알림 전용**(2026-08-07).
 *
 * 범위(원장 2026-08-07): *"셔틀 선생님으로 체크된 사용자만 알림을 모바일에서 받을 수 있으면 될것 같네.
 * pc 알림은 잘 작동하는것 같더라고"* → 이 파일은 **푸시를 받아 띄우고, 눌렀을 때 그 화면을 여는 것**만 한다.
 *
 * 🔴 **캐싱(오프라인) 기능을 넣지 말 것.** 서비스워커가 앱 응답을 캐시하기 시작하면 배포한 새 코드가
 * 폰에만 옛날 것으로 남아("배포했는데 안 바뀌었다") 원인 추적이 지옥이 된다 — aywa는 이미 열린 탭의
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
  const title = payload.title || "에이와 알림";
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
      // 🔴 **PC면 새 탭**으로 연다 — 지금 탭을 옮기면 그 탭의 화면이 통째로 다시 실린다. PC 탭엔 작성 중인 것이 있을 수
      //    있다(열어 둔 플로팅 창의 폼 · 강사 미니셸 원스크린 작성 중 · 셔틀 오늘 등하원 · 풀셸 배경 폼 — 전수검사 리뷰 2026-09-11).
      //    PC 판정은 둘: ① 브라우저가 알려 주는 `userAgentData.mobile === false`(크로미움) ② 플로팅 창(iframe)이 window
      //    클라이언트로 잡힌다(`frameType: "nested"`) = 창을 띄운 작업면. 창을 직접 옮기면 창 이름과 다른 화면 + 전체 셸이 뜬다.
      // ⚠️ 한계: userAgentData가 없는 PC 브라우저(사파리·파이어폭스)에서 창을 하나도 안 띄웠으면 폰과 구분되지 않아 아래처럼
      //    그 탭을 옮긴다 — 그 탭에서 작성 중이던 것이 있으면 날아간다.
      const uaData = self.navigator && self.navigator.userAgentData;
      const pcConfirmed = !!uaData && uaData.mobile === false;
      if (pcConfirmed || clients.some((c) => c.frameType === "nested")) return self.clients.openWindow(link);
      // 이미 열려 있는 창이 있으면 그 창을 쓴다(폰에서 창이 여러 개 쌓이는 것 방지).
      // ⚠️ `=== "top-level"`이 아니라 `!== "nested"`다 — 다른 창이 연 최상위 창("auxiliary")도 최상위이고,
      //    frameType을 모르는 브라우저는 종전대로 첫 창을 써야 폰에서 창이 쌓이지 않는다.
      for (const client of clients) {
        if (client.frameType === "nested") continue;
        if ("focus" in client) {
          if ("navigate" in client && link) client.navigate(link).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(link);
    }),
  );
});
