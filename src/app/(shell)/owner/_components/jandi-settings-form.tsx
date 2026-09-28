"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "@/components/icons/aywa-icon-compat";
import { JANDI_EVENT_OPTIONS } from "@/features/jandi/events";
import { JANDI_WEBHOOK_PREFIX } from "@/features/jandi/format";
import { disconnectJandi, saveJandiSettings, sendJandiTest } from "@/features/jandi/server/actions";

/**
 * 잔디 연결 설정 폼 — 웹훅 주소(바꿀 때만 입력) + 보낼 알림 종류 + 확인 메시지 · 연결 해제.
 * 🔴 저장된 주소는 가린 값(`maskedUrl`)으로만 받는다 — 원문은 서버 밖으로 안 나온다.
 */
const GROUPS = [...new Set(JANDI_EVENT_OPTIONS.map((o) => o.group))];
const btn =
  "border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition disabled:opacity-50";

export function JandiSettingsForm({
  connected,
  maskedUrl,
  eventTypes,
}: {
  connected: boolean;
  maskedUrl: string;
  eventTypes: string[];
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(eventTypes));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (type: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  function run(action: () => Promise<{ error?: string; message?: string }>, after?: () => void) {
    if (pending) return;
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await action();
      if (res.error) {
        setErr(res.error);
        return;
      }
      setMsg(res.message ?? "완료");
      after?.();
      router.refresh();
    });
  }

  const save = () => run(() => saveJandiSettings({ webhookUrl: url, eventTypes: [...picked] }), () => setUrl(""));
  const test = () => run(() => sendJandiTest());
  const disconnect = () => {
    if (!window.confirm("잔디 연결을 해제할까요? 알림이 더 이상 잔디 방으로 가지 않습니다.")) return;
    run(() => disconnectJandi(), () => setUrl(""));
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="jandi-webhook-url" className="text-foreground block text-xs font-bold">
          인커밍 웹훅 주소
          <span className="text-text-dim ml-2 font-normal">
            {connected ? `연결됨 · ${maskedUrl}` : "잔디 방 → 커넥트 → Incoming Webhook에서 만든 주소"}
          </span>
        </label>
        <input
          id="jandi-webhook-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={connected ? "바꿀 때만 새 주소를 붙여 넣으세요" : `${JANDI_WEBHOOK_PREFIX}…`}
          spellCheck={false}
          autoComplete="off"
          className="border-line bg-bg-soft focus:border-primary block w-full min-w-0 rounded-md border px-2.5 py-1.5 font-mono text-xs outline-none"
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-foreground text-xs font-bold">잔디로 보낼 알림</legend>
        {GROUPS.map((group) => (
          <div key={group}>
            <p className="text-text-dim mb-1 text-xs">{group}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {JANDI_EVENT_OPTIONS.filter((o) => o.group === group).map((o) => (
                <label key={o.type} className="text-foreground inline-flex cursor-pointer items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={picked.has(o.type)}
                    onChange={() => toggle(o.type)}
                    className="border-line accent-primary size-4 cursor-pointer rounded"
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={pending} className={btn}>
          {pending ? <Loader2 className="size-3 animate-spin" /> : null}
          저장
        </button>
        <button type="button" onClick={test} disabled={pending || !connected} className={btn}>
          확인 메시지 보내기
        </button>
        {connected ? (
          <button type="button" onClick={disconnect} disabled={pending} className={btn}>
            연결 해제
          </button>
        ) : null}
        {msg ? <span className="text-primary text-xs">{msg}</span> : null}
        {err ? <span className="text-danger text-xs">{err}</span> : null}
      </div>
    </div>
  );
}
