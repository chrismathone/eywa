"use client";

import { useEffect } from "react";

// Cloudflare Turnstile 암묵 렌더 — 스크립트 1회 로드 + .cf-turnstile div.
// 풀이 성공 시 Turnstile이 폼에 hidden input(name="cf-turnstile-response")을 자동 주입.
// siteKey(env NEXT_PUBLIC_TURNSTILE_SITE_KEY)가 있을 때만 렌더되므로, 데모(키 없음)에선 이 컴포넌트 자체가 안 쓰임.
export function TurnstileWidget({ siteKey }: { siteKey: string }) {
  useEffect(() => {
    const id = "cf-turnstile-script";
    if (document.getElementById(id)) return;
    const s = document.createElement("script");
    s.id = id;
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }, []);

  return <div className="cf-turnstile mx-3 mt-4 flex justify-center" data-sitekey={siteKey} data-theme="light" />;
}
