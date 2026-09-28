"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmSlackSelfLink, startSlackSelfLink, unlinkMySlack } from "@/features/slack/server/self-link-actions";

/**
 * 내 슬랙 연결 — 슬랙 가입 이메일 → 슬랙 1:1(aywa 앱)로 온 6자리 코드 입력 → 연결.
 * 연결하면 학원 규칙에 따라 내게 오는 알림이 슬랙 1:1로도 오고, 채널에서 @멘션된다.
 */
const btn =
  "border-line text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center rounded-lg border px-3 py-1.5 text-xs transition disabled:opacity-50";
const input = "border-line bg-bg-soft focus:border-primary rounded-md border px-2.5 py-1.5 text-sm outline-none";

export function SlackLinkCard({ linked, email }: { linked: "code" | "owner_email" | null; email: string }) {
  const router = useRouter();
  const [slackEmail, setSlackEmail] = useState(email);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = (fn: () => Promise<{ error?: string; message?: string }>, after?: () => void) =>
    start(async () => {
      setErr(null);
      setMsg(null);
      const r = await fn();
      if (r.error) return setErr(r.error);
      setMsg(r.message ?? "완료");
      after?.();
    });

  return (
    <section className="bg-card shadow-card space-y-3 rounded-2xl p-5" aria-label="내 슬랙 연결">
      <div>
        <h3 className="text-foreground text-sm font-bold">내 슬랙 연결</h3>
        <p className="text-text-dim mt-1 text-xs">연결하면 학원이 정한 알림이 슬랙 1:1로도 오고, 채널에서 내 이름이 @멘션됩니다.</p>
      </div>
      {linked === "code" ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-primary">연결됨</span>
          <button type="button" className={btn} disabled={pending} onClick={() => run(() => unlinkMySlack(), () => router.refresh())}>
            연결 해제
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {linked === "owner_email" ? (
            <p className="text-text-dim text-xs">원장이 이메일로 연결해 두었습니다. 본인 확인을 한 번 해 두면 나중에 슬랙에서 바로 처리하는 기능도 쓸 수 있습니다.</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={slackEmail}
              onChange={(e) => setSlackEmail(e.target.value)}
              placeholder="슬랙에 가입한 이메일"
              aria-label="슬랙에 가입한 이메일"
              className={`${input} min-w-56 flex-1`}
            />
            <button type="button" className={btn} disabled={pending} onClick={() => run(() => startSlackSelfLink(slackEmail), () => setSent(true))}>
              {sent ? "코드 다시 받기" : "코드 받기"}
            </button>
          </div>
          {sent ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                placeholder="6자리 코드"
                aria-label="슬랙으로 받은 6자리 코드"
                className={`${input} w-32 font-mono tracking-widest`}
              />
              <button type="button" className={btn} disabled={pending || code.length < 6} onClick={() => run(() => confirmSlackSelfLink(code), () => router.refresh())}>
                연결
              </button>
            </div>
          ) : null}
        </div>
      )}
      {msg ? <p className="text-primary text-xs">{msg}</p> : null}
      {err ? <p className="text-danger text-xs">{err}</p> : null}
    </section>
  );
}
