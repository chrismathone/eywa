"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Mic, CircleStop, X, Download } from "@/components/icons/aywa-icon-compat";
import { useRecordingLock } from "@/components/workspace/use-recording-lock";
import { useWindowStore } from "@/components/workspace/window-store";
import { formatSeconds, downloadFile } from "@/lib/audio-upload";
import { adoptRecordingOwner, releaseRecordingOwner, dismissBrowserRecording, getBrowserRecording, getServerRecording, recordingIsActive, stopBrowserRecording, subscribeBrowserRecording, type BrowserRecording } from "@/lib/browser-recording";
import type { RecordingOwner } from "@/lib/recording-recovery";
import { useFrameRecordings, sendRecordingCommand } from "./use-frame-recordings";
import { useRecordingPosition } from "./use-recording-position";
import styles from "./recording-runtime.module.css";

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
  const activeFrame = frames.find((item) => recordingIsActive(item.value));
  const visibleLocal = activeFrame && !recordingIsActive(local) ? null : local;
  const visibleFrames = activeFrame ? [activeFrame] : recordingIsActive(local) ? [] : frames;
  if (inWorkspaceFrame || (!local && !frames.length)) return null;
  return <>
    {visibleLocal ? <RecordingControls key={visibleLocal.requestId} slot={0} recording={visibleLocal} hasFile={!!visibleLocal.file}
      onStop={() => stopBrowserRecording(visibleLocal.requestId)}
      onDownload={() => { if (visibleLocal.file) downloadFile(visibleLocal.file); }}
      onDismiss={() => dismissBrowserRecording()} /> : null}
    {visibleFrames.map((item, index) => <RecordingControls key={`${item.winId}:${item.value.requestId}`} slot={index + (visibleLocal ? 1 : 0)} recording={item.value} hasFile={item.value.hasFile}
      onStop={() => sendRecordingCommand(item, "stop")}
      onDownload={() => sendRecordingCommand(item, "download")}
      onDismiss={() => sendRecordingCommand(item, "dismiss")}
      onOpen={() => { useWindowStore.getState().restore(item.winId); sendRecordingCommand(item, "open"); }} />)}
  </>;
}

function RecordingControls({ recording, hasFile, onStop, onDownload, onDismiss, onOpen, slot }: {
  slot: number;
  recording: Omit<BrowserRecording, "file">;
  hasFile: boolean;
  onStop: () => void;
  onDownload: () => void;
  onDismiss: () => void;
  onOpen?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const position = useRecordingPosition(slot, () => setExpanded(false));
  const { attach } = position;
  const attachAnchor = useCallback((node: HTMLDivElement | null) => { anchor.current = node; attach(node); }, [attach]);
  useLayoutEffect(() => {
    if (!expanded || !panel.current || !anchor.current) return;
    const node = panel.current;
    const button = anchor.current;
    const place = () => {
      const rect = button.getBoundingClientRect();
      const maxTop = Math.max(16, window.innerHeight - node.offsetHeight - 16);
      const top = rect.top >= node.offsetHeight + 24 ? rect.top - node.offsetHeight - 8 : rect.bottom + 8;
      node.style.left = `${Math.max(16, Math.min(rect.right - node.offsetWidth, window.innerWidth - node.offsetWidth - 16))}px`;
      node.style.top = `${Math.max(16, Math.min(top, maxTop))}px`;
      node.style.visibility = "visible";
    };
    place();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    observer?.observe(node);
    window.addEventListener("resize", place);
    return () => { observer?.disconnect(); window.removeEventListener("resize", place); };
  }, [expanded, anchor]);
  const active = recordingIsActive(recording);
  const label = active ? recording.status === "starting" ? "녹음 준비 중" : "녹음 중" : recording.status === "failed" ? "녹음 확인 필요" : "녹음 완료";
  return (
    <div ref={attachAnchor} className={styles.anchor} data-recording-id={recording.requestId}>
      {expanded ? createPortal(<section ref={panel} aria-label="녹음 진행" onKeyDown={(event) => { if (event.key === "Escape") setExpanded(false); }} className={`${styles.panel} bg-background border-border rounded-xl border p-4 shadow-lg`}>
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
      </section>, document.body) : null}
      <button type="button" aria-label={`${label} · ${formatSeconds(recording.seconds)} · 진행 확인`} aria-expanded={expanded}
        onPointerEnter={position.chooseSide} onFocus={position.chooseSide}
        onPointerDown={position.onPointerDown} onPointerMove={position.onPointerMove} onPointerUp={position.onPointerUp}
        onPointerCancel={position.onPointerCancel} onLostPointerCapture={position.onLostPointerCapture}
        onClick={(event) => { const dragged = position.consumeDragClick(); if (event.detail === 0 || !dragged) setExpanded((open) => !open); }} className={styles.capsule}>
        <span className={styles.microphone} aria-hidden="true"><span className="relative"><Mic /><span className={`absolute -top-1 -right-1 size-2 rounded-full ${active ? "bg-danger" : "bg-primary"}`} /></span></span>
        <span className={`${styles.timer} num text-text-dim`} aria-hidden="true">{formatSeconds(recording.seconds)}</span>
      </button>
    </div>
  );
}
