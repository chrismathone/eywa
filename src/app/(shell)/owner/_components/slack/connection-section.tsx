"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { describeSlackError } from "@/features/slack/format";
import type { SlackHealth } from "@/features/slack/server/queries";
import { disconnectSlack, saveSlackToken } from "@/features/slack/server/connection-actions";
import { Button } from "@/components/ui/button";

/** 연결 — 봇 토큰(바꿀 때만 입력) · 상태(끊김·마지막 발송·대기/실패 건수) · 연결 해제. 토큰 원문은 받지 않는다(가린 값만). */
export function ConnectionSection({
  connected,
  maskedToken,
  teamName,
  broken,
  lastDispatchAt,
  lastErrorCode,
  health,
}: {
  connected: boolean;
  maskedToken: string;
  teamName: string;
  broken: boolean;
  lastDispatchAt: string | null;
  lastErrorCode: string | null;
  health: SlackHealth;
}) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = (fn: () => Promise<{ error?: string; message?: string }>) => {
    if (pending) return;
    setErr(null);
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (r.error) setErr(r.error);
      else {
        setMsg(r.message ?? "완료");
        setToken("");
        router.refresh();
      }
    });
  };
  const last = lastDispatchAt ? new Date(lastDispatchAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div className="space-y-2">
      <label htmlFor="slack-bot-token" className="text-foreground block text-sm font-bold">
        연결
        <span className="text-text-dim ml-2 text-xs font-normal">
          {connected ? `${teamName ? `${teamName} · ` : ""}${maskedToken}` : "슬랙 앱 → OAuth & Permissions → Bot User OAuth Token"}
        </span>
      </label>
      {broken ? (
        <p className="text-danger text-xs">
          발송이 멈췄습니다 — {describeSlackError(lastErrorCode)} 새 토큰을 저장하면 쌓인 알림부터 이어서 보냅니다.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="slack-bot-token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={connected ? "바꿀 때만 새 토큰을 붙여 넣으세요" : "xoxb-…"}
          spellCheck={false}
          autoComplete="off"
          className="border-line bg-bg-soft focus:border-primary h-(--control-h) min-w-64 flex-1 rounded-lg border px-2.5 font-mono text-sm outline-none"
        />
        <Button onClick={() => run(() => saveSlackToken(token))} disabled={pending || !token.trim()}>
          토큰 저장
        </Button>
        {connected ? (
          <Button
            variant="outline"
            onClick={() => window.confirm("슬랙 연결을 해제할까요? 알림이 더 이상 슬랙으로 가지 않습니다.") && run(() => disconnectSlack())}
            disabled={pending}
          >
            연결 해제
          </Button>
        ) : null}
      </div>
      {connected ? (
        <p className="text-text-dim text-xs">
          {last ? `마지막 발송 확인 ${last}` : "아직 발송 기록 없음"} · 대기 {health.pending}건
          {health.failedDay ? <span className="text-danger"> · 최근 하루 실패 {health.failedDay}건</span> : null}
          {health.notLinkedDay ? <span className="text-danger"> · 슬랙 미연결로 못 보낸 1:1 {health.notLinkedDay}건</span> : null}
        </p>
      ) : null}
      {msg ? <p className="text-primary text-xs">{msg}</p> : null}
      {err ? <p className="text-danger text-xs">{err}</p> : null}
    </div>
  );
}
