"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Mic, CircleStop, X, Download } from "@/components/icons/aywa-icon-compat";
import { useRecordingLock } from "@/components/workspace/use-recording-lock";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWindowStore } from "@/components/workspace/window-store";
import { formatSeconds, downloadFile } from "@/lib/audio-upload";
import { adoptRecordingOwner, releaseRecordingOwner, dismissBrowserRecording, getBrowserRecording, getServerRecording, recordingIsActive, stopBrowserRecording, subscribeBrowserRecording, type BrowserRecording } from "@/lib/browser-recording";
import type { RecordingOwner } from "@/lib/recording-recovery";
import { useFrameRecordings, sendRecordingCommand } from "./use-frame-recordings";
import { capsuleFootprint, placeRecordingPanel } from "./recording-panel-placement";
import { useOutsideDismiss } from "./use-outside-dismiss";
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
  const capsule = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  // 정보창 자리 = 펼친 캡슐을 피해 화면의 넓은 쪽으로(순수 함수 placeRecordingPanel). 열 때·내용이 바뀔 때·캡슐을
  // 끌거나 창 크기가 바뀔 때 다시 잴 뿐 닫지 않는다(원장 2026-10-14 "띄워놓은채로 있으면 시간이 계속 보이게").
  const placePanel = useCallback(() => {
    const node = panel.current;
    const box = anchor.current;
    if (!node || !box) return;
    node.style.maxHeight = "";
    const at = placeRecordingPanel({
      capsule: capsuleFootprint(box.getBoundingClientRect(), box.dataset.side),
      panel: { width: node.offsetWidth, height: node.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    node.style.left = `${at.left}px`;
    node.style.top = `${at.top}px`;
    node.style.maxHeight = at.maxHeight === null ? "" : `${at.maxHeight}px`;
    node.dataset.placed = "true";
  }, []);
  const position = useRecordingPosition(slot, placePanel);
  const { attach } = position;
  const attachAnchor = useCallback((node: HTMLDivElement | null) => { anchor.current = node; attach(node); }, [attach]);
  useLayoutEffect(() => {
    if (!expanded || !panel.current) return;
    placePanel();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(placePanel) : null;
    observer?.observe(panel.current);
    return () => observer?.disconnect();
  }, [expanded, placePanel]);
  // 바깥 클릭 = 정보창만 닫고 그 클릭은 아래 화면에 전하지 않는다.
  useOutsideDismiss(expanded, (target) => !!(panel.current?.contains(target) || anchor.current?.contains(target)), () => setExpanded(false));
  const closeOnEscape = (event: ReactKeyboardEvent, refocus: boolean) => {
    if (event.key !== "Escape" || !expanded) return;
    event.stopPropagation();
    setExpanded(false);
    if (refocus) capsule.current?.focus();
  };
  const active = recordingIsActive(recording);
  const label = active ? recording.status === "starting" ? "녹음 준비 중" : "녹음 중" : recording.status === "failed" ? "녹음 확인 필요" : "녹음 완료";
  const time = formatSeconds(recording.seconds);
  return (
    <div ref={attachAnchor} className={styles.anchor} data-recording-id={recording.requestId} data-open={expanded ? "true" : undefined}>
      {expanded ? createPortal(<section ref={panel} id={panelId} aria-label="녹음 진행" onKeyDown={(event) => closeOnEscape(event, true)} className={`${styles.panel} bg-background border-border rounded-xl border p-4 shadow-lg`}>
        {/* 시간은 정보창에 따로 적지 않는다 — 열려 있는 동안 캡슐이 펼친 채 보여 준다(원장 2026-10-14 "안내창은 녹음 시간 안보여도됨"). */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-text-dim text-xs">{{ meeting: "회의 녹음", consultation: "콜앤상담 녹음", "student-consultation": "학생 상담 녹음" }[recording.kind]}</p>
            <p className="mt-1 truncate text-sm font-semibold" title={recording.scope.label}>{recording.scope.label}</p>
          </div>
          <button type="button" aria-label="녹음 진행 접기" onClick={() => setExpanded(false)} className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "text-text-dim")}><X className="size-4" /></button>
        </div>
        {recording.error ? <p role="alert" className="text-danger mb-3 text-xs">{recording.error}</p> : null}
        {!active && hasFile ? <p className="text-text-dim mb-3 text-xs">녹음을 보관했습니다. 작성 화면에서 저장·분석할 수 있습니다.</p> : null}
        {/* 버튼은 공용 모양(buttonVariants) — 올리면 색이 바뀌고 누르면 눌린다(원장 2026-10-14 "마우스 올려도 눌린다는 효과가 없어서 헷갈림"). */}
        <div className="flex flex-wrap items-center gap-2">
          {active ? <button type="button" disabled={recording.status === "stopping"} onClick={onStop} className={cn(buttonVariants(), "bg-danger text-white hover:bg-danger/85")}><CircleStop />녹음 중지</button> : null}
          {/* 작성 화면으로 가면 정보창은 닫는다 — 이미 그 화면이어도 눌렀다는 것이 보인다. */}
          {onOpen ? <button type="button" onClick={() => { setExpanded(false); onOpen(); }} className={cn(buttonVariants({ variant: "outline" }))}>작성 화면 열기</button>
            : <Link href={recording.href} prefetch={false} onClick={() => setExpanded(false)} className={cn(buttonVariants({ variant: "outline" }))}>작성 화면 열기</Link>}
          {hasFile ? <button type="button" onClick={onDownload} className={cn(buttonVariants({ variant: "outline" }))}><Download />파일 저장</button> : null}
          {!active ? <button type="button" onClick={onDismiss} className={cn(buttonVariants({ variant: "outline" }), "text-text-dim")}>안내 닫기</button> : null}
        </div>
      </section>, document.body) : null}
      <button ref={capsule} type="button" aria-label={`${label} · ${time} · 진행 확인`} aria-expanded={expanded} aria-controls={expanded ? panelId : undefined}
        onPointerEnter={position.chooseSide} onFocus={position.chooseSide} onKeyDown={(event) => closeOnEscape(event, false)}
        onPointerDown={position.onPointerDown} onPointerMove={position.onPointerMove} onPointerUp={position.onPointerUp}
        onPointerCancel={position.onPointerCancel} onLostPointerCapture={position.onLostPointerCapture}
        onClick={(event) => { const dragged = position.consumeDragClick(); if (event.detail === 0 || !dragged) setExpanded((open) => !open); }} className={styles.capsule}>
        <span className={styles.microphone} aria-hidden="true"><span className="relative"><Mic /><span className={`absolute -top-1 -right-1 size-2 rounded-full ${active ? "bg-danger" : "bg-primary"}`} /></span></span>
        <span className={`${styles.timer} num text-text-dim`} aria-hidden="true">{time}</span>
      </button>
    </div>
  );
}
