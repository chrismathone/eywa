"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSlackSchedule, type SlackScheduleInput } from "@/features/slack/server/connection-actions";
import { ToolbarChip } from "@/components/toolbar";
import { Button } from "@/components/ui/button";

/**
 * 발송 시간 — 방해금지(시작·끝) · 주말 조용히 · 기본 요약 시각(KST). 방해금지 중 생긴 '바로' 알림은 끝나는 시각에
 * **한 통으로 묶어** 보낸다(아침에 수십 통 몰아 보내지 않는다). 규칙에서 '방해금지 지키기'를 끄면 그 규칙만 예외.
 */
const timeCls = "border-line h-(--control-h) rounded-lg border bg-transparent px-2 text-sm disabled:opacity-50";

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
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ToolbarChip active={s.dndEnabled} onClick={() => set({ dndEnabled: !s.dndEnabled })}>
          방해금지
        </ToolbarChip>
        <label className="text-text-dim inline-flex items-center gap-1">
          <input type="time" value={s.dndStart} onChange={(e) => set({ dndStart: e.target.value })} disabled={!s.dndEnabled} className={timeCls} aria-label="방해금지 시작" />~
          <input type="time" value={s.dndEnd} onChange={(e) => set({ dndEnd: e.target.value })} disabled={!s.dndEnabled} className={timeCls} aria-label="방해금지 끝" />
        </label>
        <ToolbarChip active={s.weekendQuiet} onClick={() => set({ weekendQuiet: !s.weekendQuiet })}>
          주말(토·일) 조용히
        </ToolbarChip>
        <label className="text-text-dim inline-flex items-center gap-1">
          기본 요약 시각
          <input type="time" value={s.digestAt} onChange={(e) => set({ digestAt: e.target.value })} className={timeCls} aria-label="기본 요약 시각" />
        </label>
        <Button onClick={save} disabled={pending || !dirty}>
          저장
        </Button>
        {msg ? <span className="text-primary">{msg}</span> : null}
        {err ? <span className="text-danger">{err}</span> : null}
      </div>
      <p className="text-text-dim text-xs">방해금지 동안 생긴 알림은 끝나는 시각에 한 통으로 모아 보냅니다.</p>
    </div>
  );
}
