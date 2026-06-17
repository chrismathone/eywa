"use client";

import { useState } from "react";
import type { SpeakerUtterance } from "@/features/meetings/server/queries";

const THRESHOLD = 60;

/**
 * 전사 발화 목록 — ~300발화가 평면으로 쏟아지는 것을 막아 기본 60개만 렌더하고
 * 나머지는 "+ N개 더 보기" 토글로 펼친다(now-cockpit 캡 + 외 N 패턴의 발화 버전).
 */
export function TranscriptList({
  utterances,
  speakerRoles,
}: {
  utterances: SpeakerUtterance[];
  speakerRoles: Record<string, string> | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? utterances : utterances.slice(0, THRESHOLD);
  const rest = utterances.length - rows.length;

  return (
    <div className="max-h-[420px] space-y-3 overflow-y-auto p-5">
      {rows.map((u, i) => {
        const role = speakerRoles?.[u.speaker];
        return (
          <div key={i} className="space-y-1">
            <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              화자 {u.speaker}
              {role ? <span className="text-foreground/70 ml-1.5 normal-case">· {role}</span> : null}
            </p>
            <p className="text-foreground text-sm leading-relaxed">{u.text}</p>
          </div>
        );
      })}
      {rest > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft w-full rounded-md border py-2 text-xs transition"
        >
          + {rest}개 발화 더 보기
        </button>
      ) : null}
    </div>
  );
}
