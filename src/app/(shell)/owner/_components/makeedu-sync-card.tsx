"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, RefreshCw } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  setMakeeduSyncEnabled,
  triggerMakeeduSyncNow,
  checkMakeeduSyncLock,
} from "@/features/integrations/server/actions";
import type { MakeeduAutoSyncStatus, MakeeduSyncLock } from "@/features/integrations/server/makeedu-sync";
import { writeLockedNote } from "@/lib/write-lock";

/**
 * makeedu 자동 동기화 ON/OFF 카드 (연동 면). 토글은 user_integrations(provider=makeedu).sync_enabled를 바꾸고,
 * GitHub Actions cron(sync-all.cjs)이 매 실행 시작에 이 값을 읽어 off면 스킵한다. master 전용(서버 액션이 게이트).
 *
 * '지금 동기화' 버튼은 **모든 사용자 공유 잠금**(initialLock)으로 진행 중/쿨다운 동안 비활성 — 동시 실행·연타
 * 방지(데이터 안전은 dedup·원자적 claim이 이미 보장, 이건 UX). 20초 폴링으로 다른 사용자의 트리거도 실시간 반영.
 */
export function MakeeduSyncCard({
  status,
  initialLock,
  canToggle = true,
  canTrigger = true,
}: {
  status: MakeeduAutoSyncStatus;
  initialLock: MakeeduSyncLock;
  /** 자동 동기화 켜기·끄기 = 연동 설정 쓰기(`setMakeeduSyncEnabled`와 같은 판정). 없으면 스위치를 잠근다. */
  canToggle?: boolean;
  /**
   * '지금 동기화' = makeedu 연동(integrations) 쓰기 — `triggerMakeeduSyncNow`와 같은 판정(sheets-face.tsx가 계산).
   * 🔴 없으면 단추를 **그리지 않는다**(원장 2026-11-05 — 누르면 거절되는 단추를 두지 않는다).
   */
  canTrigger?: boolean;
}) {
  const [enabled, setEnabled] = useState(status.enabled);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [triggering, startRun] = useTransition();
  const [runMsg, setRunMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [lock, setLock] = useState<MakeeduSyncLock>(initialLock);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // 두 타이머: (1) 1초 틱 — 하단 카운트다운(mm:ss)과 쿨다운 만료 시 자동 재활성. (2) 20초 폴링 —
  // 다른 사용자/탭이 트리거하면 이 카드 버튼도 실시간 비활성(공유 lock DB에서 재조회).
  useEffect(() => {
    let alive = true;
    const secTick = setInterval(() => setNowMs(Date.now()), 1000);
    const poll = async () => {
      try {
        const l = await checkMakeeduSyncLock();
        if (alive) setLock(l);
      } catch {
        /* 폴링 실패는 무시(다음 틱 재시도) */
      }
    };
    void poll();
    const pollId = setInterval(poll, 20_000);
    return () => {
      alive = false;
      clearInterval(secTick);
      clearInterval(pollId);
    };
  }, []);

  const busyUntilMs = lock.busyUntil ? Date.parse(lock.busyUntil) : 0;
  const cooling = busyUntilMs > nowMs;
  const inProgress = triggering || lock.running;
  const busy = inProgress || cooling;
  // 하단 카운트다운 mm분 ss초.
  const remainSec = cooling ? Math.max(0, Math.ceil((busyUntilMs - nowMs) / 1000)) : 0;
  const remLabel = `${Math.floor(remainSec / 60)}분 ${String(remainSec % 60).padStart(2, "0")}초`;

  function toggle() {
    if (pending) return;
    const next = !enabled;
    setError(null);
    start(async () => {
      const res = await setMakeeduSyncEnabled(next);
      if (res?.error) setError(res.error);
      else setEnabled(next);
    });
  }

  // 지금 즉시 1회 동기화 — 로컬 서버면 sync-all.cjs 직접 실행, Vercel(프로덕션)이면 요청 큐에 접수
  // (동기화 PC 워처가 15초 내 대신 실행). 어느 경로든 결과는 ~1-2분 뒤 배지 반영. 잠금 중이면 무시.
  function runNow() {
    if (triggering || busy) return;
    setRunMsg(null);
    startRun(async () => {
      const res = await triggerMakeeduSyncNow();
      if (res?.error) setRunMsg({ ok: false, text: res.error });
      else {
        setRunMsg({
          ok: true,
          text: res?.message ?? "동기화를 시작했습니다 — 1~2분 뒤 각 화면 배지에 반영됩니다.",
        });
        if (res?.lock) {
          setLock(res.lock); // 트리거 즉시 잠금(눌린 사용자 버튼 바로 비활성)
          setNowMs(Date.now());
        }
      }
    });
  }

  return (
    <section className="bg-card border-border space-y-4 rounded-2xl border p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-foreground text-base font-bold">makeedu 자동 동기화</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            켜면 <strong>하루 2회</strong> makeedu에서 학생·예비상담·재원상담·수납·반을 자동으로
            가져오고, 교재 신청의 등록·납부도 수납과 대조해 자동 체크합니다 (기존 데이터는 보존하고 새
            항목만 추가). 끄면 자동 동기화를 멈춥니다.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="makeedu 자동 동기화"
          onClick={toggle}
          disabled={pending || !canToggle}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
            enabled ? "bg-primary" : "bg-line-strong"
          }`}
        >
          <span
            className={`flex size-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform ${
              enabled ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          >
            {pending ? <Loader2 className="text-text-dim size-3 animate-spin" /> : null}
          </span>
        </button>
      </div>

      {error ? <p className="text-chart-4 text-sm">{error}</p> : null}

      {canTrigger ? (
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={runNow} disabled={busy}>
            {inProgress ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {inProgress ? "동기화 진행 중" : "지금 동기화"}
          </Button>
          {runMsg ? (
            <span className={`text-xs ${runMsg.ok ? "text-primary" : "text-chart-4"}`}>{runMsg.text}</span>
          ) : null}
        </div>
        {/* 비활성 사용자에게도 언제 다시 가능한지 초 단위로 — 1초 틱으로 갱신. */}
        {cooling ? (
          <p className="text-text-faint mt-1.5 text-xs tabular">
            {inProgress ? "동기화 진행 중 · " : "동기화 완료 대기 · "}
            다시 가능까지 <span className="text-text-dim font-medium">{remLabel}</span>
          </p>
        ) : inProgress ? (
          <p className="text-text-faint mt-1.5 text-xs">동기화 진행 중…</p>
        ) : null}
      </div>
      ) : canToggle ? (
        // 면 전체가 잠겼으면(연동 설정 읽기) 면 위의 안내 한 줄로 충분하다 — 여기는 makeedu 연동 권한만 없을 때.
        <p className="text-text-faint text-xs">{writeLockedNote("integrations")}</p>
      ) : null}

      <p className="text-muted-foreground border-t pt-3 text-xs">
        반영 시각은 각 화면(학생·수업·상담·수납)의 ‘↻ 동기화’ 배지에 표시됩니다.
        {status.lastSyncedAt
          ? ` · 마지막 동기화 ${new Date(status.lastSyncedAt).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
              year: "numeric",
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}`
          : null}
      </p>
    </section>
  );
}
