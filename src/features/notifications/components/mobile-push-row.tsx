"use client";

import { useCallback, useEffect, useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { iosNeedsInstall, pushSupported, urlBase64ToBytes } from "../push-key";

/**
 * 벨 드롭다운 안 **휴대폰 알림 켜기/끄기** 한 줄 (0188a, 2026-08-07).
 *
 * 범위(원장 2026-08-07): *"셔틀 선생님으로 체크된 사용자만 알림을 모바일에서 받을 수 있으면 될것 같네."*
 * → 서버(`GET /api/push`)가 **토글 켠 계정 + 키 설정됨**일 때만 `enabled`를 준다. 그 외 계정에는 이 줄이
 * 아예 안 뜬다(할 수 없는 일을 권하지 않는다 — 켜봐야 받을 알림이 없다).
 *
 * ⚠️ 권한 요청(`Notification.requestPermission`)은 **클릭 안에서만** 통한다(브라우저 정책) — 그래서
 *    자동 구독이 아니라 버튼이다. PC의 기존 '컴퓨터 알림 켜기'와 별개 경로(그쪽은 창이 열려 있을 때만).
 * ⚠️ 아이폰은 **홈 화면에 추가한 앱**에만 푸시가 온다(16.4+) — 그 상태가 아니면 버튼 대신 방법을 적는다.
 *    안내 없이 버튼만 두면 눌러도 아무 일이 없어 "고장"으로 읽힌다.
 */
export function MobilePushRow() {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsInstall, setNeedsInstall] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/push", { cache: "no-store" });
        const data = (await res.json()) as { enabled?: boolean; publicKey?: string | null };
        if (!alive || !data?.enabled || !data.publicKey) return;
        setPublicKey(data.publicKey);
        const standalone =
          window.matchMedia?.("(display-mode: standalone)").matches ||
          (navigator as unknown as { standalone?: boolean }).standalone === true;
        setNeedsInstall(iosNeedsInstall(navigator.userAgent, standalone));
        if (pushSupported()) {
          const reg = await navigator.serviceWorker.getRegistration();
          const sub = await reg?.pushManager.getSubscription();
          if (alive) setSubscribed(Boolean(sub));
        }
      } catch {
        /* 구독 상태 조회 실패는 조용히 — 벨 본체가 이것 때문에 깨지면 안 된다 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const enable = useCallback(async () => {
    if (!publicKey || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!pushSupported()) {
        setError("이 브라우저는 휴대폰 알림을 지원하지 않습니다.");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setError("알림이 차단돼 있습니다 — 브라우저 설정에서 알림을 허용해주세요.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          // 🔴 false로 두면 브라우저가 구독을 거부한다 — 우리는 항상 눈에 보이는 알림을 띄운다(sw.js).
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBytes(publicKey) as BufferSource,
        }));
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      const data = (await res.json()) as { ok?: boolean };
      if (!data?.ok) {
        setError("등록에 실패했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }
      setSubscribed(true);
    } catch {
      setError("휴대폰 알림을 켜지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, [busy, publicKey]);

  const disable = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch {
      setError("끄지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  if (!publicKey) return null; // 대상 계정이 아니거나 서버가 준비 안 됨 → 줄 자체를 그리지 않는다

  if (needsInstall) {
    return (
      <p className="text-text-faint border-line border-b px-3 py-2 text-xs leading-snug break-keep">
        아이폰에서 알림을 받으려면 사파리 하단 <b>공유</b> → <b>홈 화면에 추가</b> 후, 그 아이콘으로 들어와
        여기서 켜주세요.
      </p>
    );
  }

  return (
    <div className="border-line border-b">
      <button
        type="button"
        onClick={() => void (subscribed ? disable() : enable())}
        disabled={busy}
        className="hover:bg-bg-soft flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs transition disabled:opacity-60"
      >
        <EyIcon name="bell" size={13} className="text-primary shrink-0" />
        <span className="text-foreground font-bold">{subscribed ? "휴대폰 알림 끄기" : "휴대폰 알림 켜기"}</span>
        <span className="text-text-faint truncate">
          {subscribed ? "— 이 기기로 받는 중" : "— 출결 연락을 폰으로"}
        </span>
      </button>
      {error ? (
        <p className="text-danger px-3 pb-2 text-xs leading-snug break-keep">{error}</p>
      ) : null}
    </div>
  );
}
