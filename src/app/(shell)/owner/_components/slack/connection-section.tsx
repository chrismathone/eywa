"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { describeSlackError } from "@/features/slack/format";
import type { SlackHealth } from "@/features/slack/server/queries";
import { disconnectSlack, resendSlackFailures, saveSlackToken } from "@/features/slack/server/connection-actions";

/**
 * 연결 — 봇 토큰(바꿀 때만 입력) · 상태(끊김·마지막 발송·대기) · **최근 실패를 원인별로 + 고치는 법 + 다시 보내기**
 * (codex 2차: 슬랙 초보 원장이 채널 초대·권한을 몰라 실패가 쌓이기만 하면 안 된다). 토큰 원문은 받지 않는다.
 */
const FIXES: { key: keyof Omit<SlackHealth, "pending">; title: string; fix: string }[] = [
  {
    key: "channelFail",
    title: "채널에 못 보냄",
    fix: "비공개 채널이면 그 채널 입력창에 /invite @aywa 를 쳐서 앱을 초대하세요. 채널을 보관했거나 지웠다면 규칙에서 다른 채널을 고르세요.",
  },
  {
    key: "notLinked",
    title: "슬랙 계정을 연결하지 않은 사람에게 1:1",
    fix: "아래 '사람 연결'에서 연결하거나, 본인이 '내 정보'에서 슬랙 연결을 하면 됩니다.",
  },
  { key: "otherFail", title: "그 밖의 실패(일시 오류 등)", fix: "잠시 뒤 다시 보내기를 눌러 보세요. 계속되면 토큰을 새로 저장해 보세요." },
];

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
      setErr(r.error ?? null);
      setMsg(r.message ?? null);
      // 저장은 됐는데 경고가 붙는 경우(권한 부족)도 있으니 메시지가 있으면 새로고침한다.
      if (r.message) {
        setToken("");
        router.refresh();
      }
    });
  };
  const last = lastDispatchAt
    ? new Date(lastDispatchAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;
  const failures = FIXES.filter((f) => health[f.key] > 0);

  return (
    <div className="space-y-2">
      <label htmlFor="slack-bot-token" className="text-foreground block text-sm font-bold">
        연결
        <span className="text-text-dim ml-2 text-xs font-normal">
          {connected ? `${teamName ? `${teamName} · ` : ""}${maskedToken}` : "슬랙 앱 → OAuth & Permissions → Bot User OAuth Token"}
        </span>
      </label>
      {broken ? (
        <p className="bg-danger-soft text-danger rounded-lg px-3 py-2 text-sm">
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
          {last ? `마지막 발송 확인 ${last}` : "아직 발송 기록 없음"} · 보낼 차례를 기다리는 것 {health.pending}건
        </p>
      ) : null}
      {failures.length ? (
        <div className="border-line space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-foreground text-sm font-bold">최근 이틀 동안 못 보낸 것</p>
            <Button variant="outline" className="ml-auto" onClick={() => run(() => resendSlackFailures())} disabled={pending}>
              고쳤으면 다시 보내기
            </Button>
          </div>
          <ul className="space-y-1.5">
            {failures.map((f) => (
              <li key={f.key} className="text-sm">
                <span className="text-danger font-medium">
                  {f.title} {health[f.key]}건
                </span>
                <span className="text-text-dim"> — {f.fix}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {msg ? <p className="text-primary text-xs">{msg}</p> : null}
      {err ? <p className="text-danger text-xs">{err}</p> : null}
    </div>
  );
}
