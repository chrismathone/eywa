"use client";

/**
 * 컴퓨터(OS) 알림 — Web Notifications API 얇은 래퍼.
 *
 * 범위(원장 결정 2026-07-15): **브라우저 창이 열려 있을 때만**. 최소화·다른 탭이어도 OS 알림은 뜬다.
 * ⚠️ 브라우저를 완전히 닫은 상태의 푸시는 Service Worker + Web Push + VAPID + 푸시 백엔드가 필요 —
 * ~~규모가 달라 도입하지 않았다~~ → **2026-08-07 별도 경로로 도입**(0188a): 셔틀처럼 사무실 PC 앞에
 * 없는 사람을 위해 `attendance_alert_optin` 계정 + 출결 알림에 한해 웹 푸시가 나간다
 * ([sw.js](../../../public/sw.js) · [web-push.ts](../../lib/push/web-push.ts) · 벨의 '휴대폰 알림 켜기').
 * **이 파일은 그대로 PC 전용**이다 — 두 경로는 겹치지 않는다(PC=창 열려 있을 때, 폰=닫아도).
 * 🔴 **안드로이드 크롬은 아래 `new Notification()`을 지원하지 않는다**(서비스워커 필수) → 폰에서는
 *    창을 열어놔도 이 경로로는 안 뜬다. 폰 알림을 늘릴 땐 반드시 웹 푸시 쪽에 붙일 것.
 *
 * 권한은 사용자 제스처에서만 요청한다(브라우저 정책) → 벨 드롭다운의 '컴퓨터 알림 켜기' 버튼이 호출.
 */

export type NotifyPermission = "default" | "granted" | "denied" | "unsupported";

function supported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** 현재 권한 상태. 미지원 브라우저면 "unsupported". */
export function notifyPermission(): NotifyPermission {
  if (!supported()) return "unsupported";
  return Notification.permission as NotifyPermission;
}

/** 권한 요청 — **반드시 클릭 등 사용자 제스처 안에서** 호출할 것(그 밖에선 브라우저가 무시/거부). */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (!supported()) return "unsupported";
  try {
    return (await Notification.requestPermission()) as NotifyPermission;
  } catch {
    return notifyPermission();
  }
}

/**
 * 최상위 프레임인가 — iframe(플로팅 창) 안에서 **중복 발사** 방지용 가드.
 * 현재 구조상 임베드((shell)/layout의 `if (embed) return`)엔 헤더·벨이 없고 강사 미니셸은 창을 안 쓰므로
 * 중복이 날 수 없지만, 구조가 바뀌어도 알림이 두 번 울리지 않도록 방어로 남긴다(원장 요청).
 * cross-origin이면 window.top 접근이 throw → 안전하게 false(=안 쏨).
 */
export function isTopFrame(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
}

/**
 * OS 알림 1건 발사. 권한 없음·미지원·비최상위 프레임이면 아무것도 안 하고 false.
 * @param tag 같은 tag는 OS가 덮어써 중복 표시를 막는다(알림 id 사용).
 * @param onClick 알림 클릭 시(창 포커스 + 해당 링크로 이동).
 */
export function showDesktopNotification(opts: {
  title: string;
  body?: string | null;
  tag?: string;
  onClick?: () => void;
}): boolean {
  if (!supported() || Notification.permission !== "granted" || !isTopFrame()) return false;
  try {
    const n = new Notification(opts.title, {
      body: opts.body ?? undefined,
      tag: opts.tag,
      icon: "/eywa-logo.png",
      // 확인 전까지 안 사라지게(지원 브라우저 한정) — "확실하게 알 수 있으면 좋겠다"(원장).
      requireInteraction: true,
    });
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        /* 포커스 실패는 무시 */
      }
      opts.onClick?.();
      n.close();
    };
    return true;
  } catch {
    return false; // 일부 브라우저는 SW 없이 생성 시 throw — 조용히 실패(중앙 팝업이 대체 수단)
  }
}
