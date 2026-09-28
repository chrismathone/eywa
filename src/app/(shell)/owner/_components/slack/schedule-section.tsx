"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSlackSchedule, type SlackScheduleInput } from "@/features/slack/server/connection-actions";
import { SLACK_BTN, SLACK_BTN_ON } from "./check-dropdowns";

/**
 * 발송 시간 — 방해금지(시작·끝) · 주말 조용히 · 기본 요약 시각(KST). 방해금지 중 생긴 '바로' 알림은 끝나는 시각에
 * **한 통으로 묶어** 보낸다(아침에 수십 통 몰아 보내지 않는다). 규칙에서 '방해금지 지키기'를 끄면 그 규칙만 예외.
 */
const timeCls = "border-line rounded-md border bg-transparent px-2 py-1 text-xs";

export function ScheduleSection({ initial }: { initial: SlackScheduleInput }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<SlackScheduleInput>) => setS((prev) => ({ ...prev, ...p }));
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);

  const save = () => {
    if (pending) return;
    setErr(null);
    setMsg(null);
    start(async () => {
      const r = await saveSlackSchedule(s);
      if (r.error) setErr(r.error);
      else {
        setMsg(r.message ?? "저장했습니다");
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-2">
      <p className="text-foreground text-sm font-bold">발송 시간</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" aria-pressed={s.dndEnabled} onClick={() => set({ dndEnabled: !s.dndEnabled })} className={s.dndEnabled ? SLACK_BTN_ON : SLACK_BTN}>
          {s.dndEnabled ? "✓ " : ""}방해금지
        </button>
        <label className="text-text-dim inline-flex items-center gap-1">
          <input type="time" value={s.dndStart} onChange={(e) => set({ dndStart: e.target.value })} disabled={!s.dndEnabled} className={timeCls} aria-label="방해금지 시작" />~
          <input type="time" value={s.dndEnd} onChange={(e) => set({ dndEnd: e.target.value })} disabled={!s.dndEnabled} className={timeCls} aria-label="방해금지 끝" />
        </label>
        <button type="button" aria-pressed={s.weekendQuiet} onClick={() => set({ weekendQuiet: !s.weekendQuiet })} className={s.weekendQuiet ? SLACK_BTN_ON : SLACK_BTN}>
          {s.weekendQuiet ? "✓ " : ""}주말(토·일) 조용히
        </button>
        <label className="text-text-dim inline-flex items-center gap-1">
          기본 요약 시각
          <input type="time" value={s.digestAt} onChange={(e) => set({ digestAt: e.target.value })} className={timeCls} aria-label="기본 요약 시각" />
        </label>
        <button type="button" onClick={save} disabled={pending || !dirty} className={SLACK_BTN_ON}>
          저장
        </button>
        {msg ? <span className="text-primary">{msg}</span> : null}
        {err ? <span className="text-danger">{err}</span> : null}
      </div>
      <p className="text-text-dim text-xs">방해금지 동안 생긴 알림은 끝나는 시각에 한 통으로 모아 보냅니다.</p>
    </div>
  );
}
