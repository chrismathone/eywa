"use client";

import { useEffect, useState } from "react";
import { checkMakeeduSyncWorkers } from "@/features/integrations/server/actions";
import type { MakeeduWorker } from "@/features/integrations/server/makeedu-sync";
import { EyIcon } from "@/components/icons/aywa-icons";

/**
 * 동기화 담당 PC 상태(0073a 심장박동) — 연동 면. 어느 PC가 makeedu 동기화를 실행하는지 + 온라인/오프라인.
 * 원장이 "담당 PC가 켜져 있어 요청이 처리될지"를 한눈에 확인.
 * - 워처 없음: 지정 안내(setup-sync-pc.ps1).
 * - 온라인: 초록 · 방금 활동. 오프라인: 회색 · 마지막 활동 시각(요청은 쌓였다 PC 켜지면 처리).
 * - 2대 이상 온라인: 경고(한 대만 권장 — makeedu 이중 로그인).
 *
 * ⚠️ 20초 폴링(sync-card와 동일 패턴, 2026-07-03): 정적 스냅샷이던 시절 "새로고침 전 옛 상태"가
 * 화면마다 남아 같은 시각에 자리별로 온라인/오프라인이 다르게 보이는 혼란이 있었음 → 전 화면이
 * 새로고침 없이 20초 안에 같은 상태로 수렴. 초기값은 서버 렌더(sheets-face)가 주입.
 */
export function MakeeduWorkerStatus({
  workers: initialWorkers,
  nowMs: initialNowMs,
}: {
  workers: MakeeduWorker[];
  nowMs: number;
}) {
  const [workers, setWorkers] = useState(initialWorkers);
  const [nowMs, setNowMs] = useState(initialNowMs);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await checkMakeeduSyncWorkers();
        if (alive) {
          setWorkers(r.workers);
          setNowMs(r.nowMs);
        }
      } catch {
        /* 폴링 실패는 무시(다음 틱 재시도) */
      }
    };
    const pollId = setInterval(poll, 20_000);
    return () => {
      alive = false;
      clearInterval(pollId);
    };
  }, []);

  const onlineCount = workers.filter((w) => w.online).length;
  return (
    <section className="bg-card border-border rounded-2xl border p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-foreground text-sm font-bold">동기화 담당 PC</span>
        {workers.length === 0 ? (
          <span className="text-amber text-sm">
            아직 지정된 PC가 없습니다 — 담당 PC에서 <code className="text-xs">setup-sync-pc.ps1</code> 실행
          </span>
        ) : null}
      </div>

      {workers.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {workers.map((w) => (
            <li key={w.hostname} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
              <span
                className={`inline-block size-2 shrink-0 rounded-full ${w.online ? "bg-primary" : "bg-line-strong"}`}
                aria-hidden
              />
              <span className="text-foreground font-medium whitespace-nowrap">{w.hostname}</span>
              <span className={`whitespace-nowrap ${w.online ? "text-primary" : "text-text-dim"}`}>
                {w.online ? "온라인" : "오프라인"}
              </span>
              <span className="text-text-faint whitespace-nowrap">· 마지막 활동 {relTime(nowMs, w.lastSeen)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {onlineCount >= 2 ? (
        <p className="text-amber mt-2 flex items-start gap-1.5 text-xs">
          <EyIcon name="alert" size={14} className="mt-0.5 shrink-0" />
          <span>{onlineCount}대가 동시에 동작 중입니다 — makeedu 이중 로그인 위험이 있어 <strong>한 대만</strong> 두는 게 좋습니다.</span>
        </p>
      ) : null}
      {workers.length > 0 && onlineCount === 0 ? (
        <p className="text-text-faint mt-2 text-xs">
          담당 PC가 꺼져 있어도 요청은 대기열에 쌓였다가 PC가 켜지면 자동 처리됩니다.
        </p>
      ) : null}
    </section>
  );
}

// 상대 시각(한국어) — 방금/N분 전/N시간 전/N일 전.
function relTime(nowMs: number, iso: string): string {
  const diff = Math.max(0, nowMs - new Date(iso).getTime());
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "방금";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}
