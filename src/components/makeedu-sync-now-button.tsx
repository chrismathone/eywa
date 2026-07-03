"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { triggerMakeeduSyncNow } from "@/features/integrations/server/actions";

/**
 * 목록 화면 ↻ 배지 옆의 컴팩트 '지금 동기화' 버튼 (MakeeduSyncBadge가 권한 확인 후 렌더).
 *
 * ⚠️ 페이지 로드 비용 0 원칙(B6 — 이 배지는 5개 최다 사용 목록 화면 전부에 뜬다): 락 선조회·주기 폴링 없음.
 * 대신 서버 액션(triggerMakeeduSyncNow)이 공유 쿨다운(5분)·진행 중을 강제하므로, 쿨다운 중 눌러도
 * "이미 실행 중/조금 전 실행" 안내 + 락 응답으로 즉시 잠기고 남은 시간이 카운트다운된다.
 * (owner 연동 면의 큰 카드는 선제 잠금+20초 폴링까지 하는 풀 버전 — 여기는 경량 변형.)
 */
export function MakeeduSyncNowButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyUntil, setBusyUntil] = useState(0);
  const [nowMs, setNowMs] = useState(0);
  const cooling = busyUntil > nowMs;

  // 잠금 중에만 1초 틱(카운트다운 + 만료 시 자동 재활성) — 평소엔 타이머 0개.
  useEffect(() => {
    if (!cooling) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [cooling]);

  function run() {
    if (pending || cooling) return;
    setMsg(null);
    start(async () => {
      const res = await triggerMakeeduSyncNow();
      if (res?.error) setMsg({ ok: false, text: res.error });
      else {
        setMsg({ ok: true, text: res?.message ?? "동기화를 시작했습니다 — 1~2분 뒤 배지에 반영됩니다." });
        if (res?.lock?.busyUntil) {
          setBusyUntil(Date.parse(res.lock.busyUntil));
          setNowMs(Date.now());
        }
      }
    });
  }

  const remainSec = cooling ? Math.max(0, Math.ceil((busyUntil - nowMs) / 1000)) : 0;
  const label = pending
    ? "요청 중…"
    : cooling
      ? `${Math.floor(remainSec / 60)}분 ${String(remainSec % 60).padStart(2, "0")}초 후 가능`
      : "지금 동기화";

  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {msg ? (
        <span
          title={msg.text}
          className={`max-w-[320px] truncate text-[11px] ${msg.ok ? "text-primary" : "text-danger"}`}
        >
          {msg.text}
        </span>
      ) : null}
      <button
        type="button"
        onClick={run}
        disabled={pending || cooling}
        className="border-line text-text-dim hover:bg-bg-soft hover:text-foreground inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] whitespace-nowrap transition disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
      >
        {pending ? (
          <Loader2 className="size-3 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="size-3" aria-hidden />
        )}
        <span className="tabular">{label}</span>
      </button>
    </span>
  );
}
