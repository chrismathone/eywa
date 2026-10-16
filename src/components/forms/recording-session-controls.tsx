"use client";

import { CircleStop, Mic } from "@/components/icons/aywa-icon-compat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { formatSeconds } from "@/lib/audio-upload";
import type { RecordingStatus } from "@/lib/browser-recording";

/**
 * 작성 화면의 녹음 진행 칸 — 회의록·콜&상담·원생상담이 같이 쓴다.
 * 녹음은 여러 개를 켜 둘 수 있고 소리를 담는 것은 하나다(원장 2026-10-16) — '이어서 녹음'을 누르면 다른 녹음은 자동으로
 * 일시정지된다. 시간은 실제로 담은 시간만 센다.
 */
export function RecordingSessionControls({ status, seconds, onPause, onResume, onStop }: {
  status: RecordingStatus | undefined;
  seconds: number;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  const paused = status === "paused";
  const label = status === "starting" ? "녹음 준비 중" : status === "stopping" ? "녹음 마무리 중" : paused ? "일시정지" : "녹음 중";
  const action = "inline-flex items-center gap-1.5 text-sm font-medium disabled:opacity-50";
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-3 ${paused ? "border-border border-dashed bg-muted/30" : "border-chart-4 bg-chart-4/5"}`}>
      <div className="inline-flex items-center gap-3">
        {paused ? <EyIcon name="pause" className="text-text-dim size-4" /> : (
          <span className="relative inline-flex size-2.5">
            <span className="bg-chart-4 absolute inset-0 animate-ping rounded-full opacity-60" />
            <span className="bg-chart-4 relative inline-flex size-2.5 rounded-full" />
          </span>
        )}
        <span className="text-foreground text-sm font-medium">{label}</span>
        <span className="text-muted-foreground num text-sm">{formatSeconds(seconds)}</span>
      </div>
      <div className="inline-flex items-center gap-4">
        {status === "recording" ? (
          <button type="button" onClick={onPause} className={`${action} text-foreground`}><EyIcon name="pause" className="size-4" />일시정지</button>
        ) : paused ? (
          <button type="button" onClick={onResume} className={`${action} text-chart-4`}><Mic className="size-4" />이어서 녹음</button>
        ) : null}
        <button type="button" onClick={onStop} disabled={status === "stopping"} className={`${action} text-chart-4`}>
          <CircleStop className="size-4" />
          녹음 끝내기
        </button>
      </div>
      {paused ? <p className="text-text-dim basis-full text-xs">멈춰 둔 녹음입니다. 이어서 녹음하면 이 녹음만 소리를 담습니다.</p> : null}
    </div>
  );
}
