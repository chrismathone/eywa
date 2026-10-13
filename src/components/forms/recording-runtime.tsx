"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Mic, CircleStop, X, Download } from "@/components/icons/aywa-icon-compat";
import { useRecordingLock } from "@/components/workspace/use-recording-lock";
import { useWindowStore } from "@/components/workspace/window-store";
import { formatSeconds, downloadFile } from "@/lib/audio-upload";
import { adoptRecordingOwner, releaseRecordingOwner, dismissBrowserRecording, getBrowserRecording, getServerRecording, recordingIsActive, stopBrowserRecording, subscribeBrowserRecording, type BrowserRecording } from "@/lib/browser-recording";
import type { RecordingOwner } from "@/lib/recording-recovery";
import { useFrameRecordings, sendRecordingCommand } from "./use-frame-recordings";

export function RecordingOwnerGuard({ owner }: { owner: RecordingOwner }) {
  const { tenantId, userId } = owner;
  useEffect(() => {
    adoptRecordingOwner({ tenantId, userId });
    return () => releaseRecordingOwner({ tenantId, userId });
  }, [tenantId, userId]);
  return null;
}

/** Mounted in the root layout; changing pages never stops or unmounts the recorder. */
export function RecordingRuntime() {
  const local = useSyncExternalStore(subscribeBrowserRecording, getBrowserRecording, getServerRecording);
  const { frames, inWorkspaceFrame } = useFrameRecordings(local);
  useRecordingLock(recordingIsActive(local));
  if (inWorkspaceFrame || (!local && !frames.length)) return null;
  return <div className="fixed right-4 bottom-20 z-[10000] flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
    {local ? <RecordingControls key={local.requestId} recording={local} hasFile={!!local.file}
      onStop={() => stopBrowserRecording(local.requestId)}
      onDownload={() => { if (local.file) downloadFile(local.file); }}
      onDismiss={() => dismissBrowserRecording()} /> : null}
    {frames.map((item) => <RecordingControls key={`${item.winId}:${item.value.requestId}`} recording={item.value} hasFile={item.value.hasFile}
      onStop={() => sendRecordingCommand(item, "stop")}
      onDownload={() => sendRecordingCommand(item, "download")}
      onDismiss={() => sendRecordingCommand(item, "dismiss")}
      onOpen={() => { useWindowStore.getState().restore(item.winId); sendRecordingCommand(item, "open"); }} />)}
  </div>;
}

function RecordingControls({ recording, hasFile, onStop, onDownload, onDismiss, onOpen }: {
  recording: Omit<BrowserRecording, "file">;
  hasFile: boolean;
  onStop: () => void;
  onDownload: () => void;
  onDismiss: () => void;
  onOpen?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const active = recordingIsActive(recording);
  const label = active ? recording.status === "starting" ? "녹음 준비 중" : "녹음 중" : recording.status === "failed" ? "녹음 확인 필요" : "녹음 완료";
  return (
    <div className="max-w-full">
      {expanded ? <section aria-label="녹음 진행" className="bg-background border-border mb-2 w-80 max-w-full rounded-xl border p-4 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-text-dim text-xs">{{ meeting: "회의 녹음", consultation: "콜앤상담 녹음", "student-consultation": "학생 상담 녹음" }[recording.kind]}</p>
            <p className="mt-1 break-words text-sm font-semibold">{recording.scope.label}</p>
          </div>
          <button type="button" aria-label="녹음 진행 접기" onClick={() => setExpanded(false)} className="text-text-dim rounded p-1"><X className="size-4" /></button>
        </div>
        <p className="num my-3 text-2xl font-bold">{formatSeconds(recording.seconds)}</p>
        {recording.error ? <p role="alert" className="text-danger mb-3 text-xs">{recording.error}</p> : null}
        {!active && hasFile ? <p className="text-text-dim mb-3 text-xs">녹음을 보관했습니다. 작성 화면에서 저장·분석할 수 있습니다.</p> : null}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {active ? <button type="button" disabled={recording.status === "stopping"} onClick={onStop} className="bg-danger text-white inline-flex items-center gap-1 rounded-lg px-3 py-2"><CircleStop className="size-4" />녹음 중지</button> : null}
          {onOpen ? <button type="button" onClick={onOpen} className="border-border rounded-lg border px-3 py-2">작성 화면 열기</button> : <Link href={recording.href} prefetch={false} className="border-border rounded-lg border px-3 py-2">작성 화면 열기</Link>}
          {hasFile ? <button type="button" onClick={onDownload} className="border-border inline-flex items-center gap-1 rounded-lg border px-3 py-2"><Download className="size-4" />파일 저장</button> : null}
          {!active ? <button type="button" onClick={onDismiss} className="text-text-dim rounded-lg px-2 py-2">안내 닫기</button> : null}
        </div>
      </section> : null}
      <button type="button" aria-label={`${label} · ${formatSeconds(recording.seconds)} · 진행 확인`} aria-expanded={expanded} onClick={() => setExpanded((open) => !open)} className="bg-background border-border ml-auto flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold shadow-lg">
        <span className="relative"><Mic className="size-4" /><span className={`absolute -top-1 -right-1 size-2 rounded-full ${active ? "bg-danger" : "bg-primary"}`} /></span>
        <span>{label}</span><span className="num text-text-dim">{formatSeconds(recording.seconds)}</span>
      </button>
    </div>
  );
}
