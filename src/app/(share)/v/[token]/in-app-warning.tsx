"use client";

import { useSyncExternalStore } from "react";
import { detectInAppBrowser, kakaoOpenExternalUrl } from "@/features/video-submit/in-app-browser";

const noop = () => () => {};

/**
 * 다른 앱(카카오톡 등) 안에서 연 제출 화면이면 "끊길 수 있다"를 미리 알린다(원장 2026-10-17). 서버 렌더에서는 아무것도 그리지 않는다 —
 * 기기 정보는 브라우저에서만 읽는다(하이드레이션 불일치 방지, [[#108]]). 업로드는 막지 않는다.
 */
export function InAppWarning() {
  // 스냅샷은 문자열(매번 같은 값) — 객체를 돌려주면 렌더마다 새 값이라 무한 갱신이 된다.
  const userAgent = useSyncExternalStore(noop, () => navigator.userAgent, () => "");
  const app = detectInAppBrowser(userAgent);
  if (!app) return null;
  return (
    <div className="border-amber bg-amber-soft space-y-2 rounded-2xl border p-4" role="note">
      <p className="text-foreground text-base font-bold break-keep">{app.name} 안에서 연 화면입니다</p>
      <p className="text-foreground text-sm break-keep">
        다른 앱 안에서 올리면 다른 앱으로 넘어가거나 화면이 꺼질 때 전송이 끊길 수 있습니다. 큰 영상은 Chrome·Safari 같은 기본 브라우저에서
        열어 올려 주세요.
      </p>
      {app.kakao ? (
        <a href={kakaoOpenExternalUrl(window.location.href)}
          className="border-line bg-background text-foreground block rounded-lg border px-4 py-3 text-center text-base font-bold">
          기본 브라우저로 열기
        </a>
      ) : null}
    </div>
  );
}
