"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { CircleStop, Download, Mic, X } from "@/components/icons/aywa-icon-compat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatSeconds } from "@/lib/audio-upload";
import { recordingIsActive } from "@/lib/browser-recording";
import type { FrameValue, RecordingCommand } from "./use-frame-recordings";
import { capsuleFootprint, placeRecordingPanel, stackFootprint } from "./recording-panel-placement";
import { useOutsideDismiss } from "./use-outside-dismiss";
import { RECORDING_LAYOUT_EVENT, useRecordingPosition } from "./use-recording-position";
import styles from "./recording-runtime.module.css";

const KIND_LABEL = { meeting: "회의 녹음", consultation: "신규 콜&상담 녹음", "student-consultation": "원생상담 녹음" } as const;
/** 정보창은 한 번에 하나 — 다른 녹음 아이콘을 누르면 그 녹음의 정보창으로 바로 바뀐다. */
const PANEL_EVENT = "eywa-recording-panel";
const STATUS_LABEL = { starting: "녹음 준비 중", recording: "녹음 중", paused: "일시정지", stopping: "녹음 마무리 중", ready: "녹음 완료", failed: "녹음 확인 필요" } as const;

/**
 * 떠 있는 녹음 아이콘 하나 — 녹음마다 하나. 붉은 테두리 하나에 마이크와 그 밑의 제목(콜&상담·원생상담 = 학생 이름,
 * 회의 = 회의 제목, 길면 앞부분만)을 묶는다(원장 2026-10-16 "녹음 아이콘만 여러개 떠있으면 절대 모를 것 같고").
 * 녹음 중 = 옅은 붉은 바탕 + 붉은 점 · 일시정지 = 점선 테두리 + 일시정지 표식. 누르면 정보창.
 */
export function RecordingCapsule({ recording, onCommand }: { recording: FrameValue; onCommand: (command: RecordingCommand) => void }) {
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
    // 쌓인 다른 녹음 아이콘까지 피한다 — 덮으면 그 녹음으로 옮겨 갈 수 없다.
    const others = [...document.querySelectorAll<HTMLElement>("[data-recording-id]")].filter((node) => node !== box).map((node) => node.getBoundingClientRect());
    const at = placeRecordingPanel({
      capsule: stackFootprint(capsuleFootprint(box.getBoundingClientRect(), box.dataset.side), others),
      panel: { width: node.offsetWidth, height: node.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    node.style.left = `${at.left}px`;
    node.style.top = `${at.top}px`;
    node.style.maxHeight = at.maxHeight === null ? "" : `${at.maxHeight}px`;
    node.dataset.placed = "true";
  }, []);
  const position = useRecordingPosition(placePanel);
  const { attach } = position;
  const attachAnchor = useCallback((node: HTMLDivElement | null) => { anchor.current = node; attach(node); }, [attach]);
  useLayoutEffect(() => {
    if (!expanded || !panel.current) return;
    placePanel();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(placePanel) : null;
    observer?.observe(panel.current);
    // 다른 녹음 아이콘이 오가거나 옮겨지면 그 아이콘도 피해 다시 잡는다.
    window.addEventListener(RECORDING_LAYOUT_EVENT, placePanel);
    return () => {
      observer?.disconnect();
      window.removeEventListener(RECORDING_LAYOUT_EVENT, placePanel);
    };
  }, [expanded, placePanel]);
  // 바깥 클릭 = 정보창만 닫고 그 클릭은 아래 화면에 전하지 않는다. 다른 녹음 아이콘은 바깥으로 치지 않는다 — 녹음 사이를
  // 옮겨 다닐 때 한 번에 그 녹음의 정보창으로 바뀌어야 한다(원장 2026-10-16 "녹음하는 곳을 옮겨다니면서").
  useOutsideDismiss(expanded, (target) => !!(panel.current?.contains(target) || anchor.current?.contains(target)
    || (target instanceof Element && target.closest("[data-recording-id]"))), () => setExpanded(false));
  useEffect(() => {
    if (!expanded) return;
    window.dispatchEvent(new CustomEvent(PANEL_EVENT, { detail: recording.requestId }));
    const onOther = (event: Event) => { if ((event as CustomEvent<string>).detail !== recording.requestId) setExpanded(false); };
    window.addEventListener(PANEL_EVENT, onOther);
    return () => window.removeEventListener(PANEL_EVENT, onOther);
  }, [expanded, recording.requestId]);
  const closeOnEscape = (event: ReactKeyboardEvent, refocus: boolean) => {
    if (event.key !== "Escape" || !expanded) return;
    event.stopPropagation();
    setExpanded(false);
    if (refocus) capsule.current?.focus();
  };
  const { status, scope, kind, error, hasFile } = recording;
  const active = recordingIsActive(recording);
  const label = STATUS_LABEL[status];
  const time = formatSeconds(recording.seconds);
  const title = scope.label;
  const run = (command: RecordingCommand) => () => onCommand(command);
  return (
    <div ref={attachAnchor} className={styles.anchor} data-recording-id={recording.requestId} data-state={status} data-open={expanded ? "true" : undefined}>
      {expanded ? createPortal(<section ref={panel} id={panelId} aria-label="녹음 진행" onKeyDown={(event) => closeOnEscape(event, true)} className={`${styles.panel} bg-background border-border rounded-xl border p-4 shadow-lg`}>
        {/* 시간은 정보창에 따로 적지 않는다 — 열려 있는 동안 캡슐이 펼친 채 보여 준다(원장 2026-10-14 "안내창은 녹음 시간 안보여도됨"). */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-text-dim text-xs">{KIND_LABEL[kind]} · {label}</p>
            <p className="mt-1 truncate text-sm font-semibold" title={title}>{title}</p>
          </div>
          <button type="button" aria-label="녹음 진행 접기" onClick={() => setExpanded(false)} className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "text-text-dim")}><X className="size-4" /></button>
        </div>
        {error ? <p role="alert" className="text-danger mb-3 text-xs">{error}</p> : null}
        {status === "paused" ? <p className="text-text-dim mb-3 text-xs">멈춰 둔 녹음입니다. 이어서 녹음하면 이 녹음만 소리를 담습니다.</p> : null}
        {!active && hasFile ? <p className="text-text-dim mb-3 text-xs">녹음을 보관했습니다. 작성 화면에서 저장·분석할 수 있습니다.</p> : null}
        {/* 버튼은 공용 모양(buttonVariants) — 올리면 색이 바뀌고 누르면 눌린다(원장 2026-10-14 "마우스 올려도 눌린다는 효과가 없어서 헷갈림"). */}
        <div className="flex flex-wrap items-center gap-2">
          {status === "recording" ? <button type="button" onClick={run("pause")} className={cn(buttonVariants({ variant: "outline" }))}><EyIcon name="pause" />일시정지</button> : null}
          {status === "paused" ? <button type="button" onClick={run("resume")} className={cn(buttonVariants(), "bg-danger text-white hover:bg-danger/85")}><Mic />이어서 녹음</button> : null}
          {active ? <button type="button" disabled={status === "stopping"} onClick={run("stop")}
            className={status === "paused" ? cn(buttonVariants({ variant: "outline" }), "text-danger") : cn(buttonVariants(), "bg-danger text-white hover:bg-danger/85")}><CircleStop />녹음 끝내기</button> : null}
          {/* 작성 화면으로 가면 정보창은 닫는다 — 이미 그 화면이어도 눌렀다는 것이 보인다. */}
          <button type="button" onClick={() => { setExpanded(false); onCommand("open"); }} className={cn(buttonVariants({ variant: "outline" }))}>작성 화면 열기</button>
          {hasFile ? <button type="button" onClick={run("download")} className={cn(buttonVariants({ variant: "outline" }))}><Download />파일 저장</button> : null}
          {!active ? <button type="button" onClick={run("dismiss")} className={cn(buttonVariants({ variant: "outline" }), "text-text-dim")}>안내 닫기</button> : null}
        </div>
      </section>, document.body) : null}
      <button ref={capsule} type="button" aria-label={`${title} · ${label} · ${time} · 진행 확인`} aria-expanded={expanded} aria-controls={expanded ? panelId : undefined}
        onPointerEnter={position.chooseSide} onFocus={position.chooseSide} onKeyDown={(event) => closeOnEscape(event, false)}
        onPointerDown={position.onPointerDown} onPointerMove={position.onPointerMove} onPointerUp={position.onPointerUp}
        onPointerCancel={position.onPointerCancel} onLostPointerCapture={position.onLostPointerCapture}
        onClick={(event) => { const dragged = position.consumeDragClick(); if (event.detail === 0 || !dragged) setExpanded((open) => !open); }} className={styles.capsule}>
        <span className={styles.face} aria-hidden="true">
          <span className={styles.microphone}>
            <Mic />
            {status === "paused"
              ? <EyIcon name="pause" className={`${styles.badge} text-text-dim`} />
              : <span className={`${styles.dot} ${active ? "bg-danger" : "bg-primary"}`} />}
          </span>
          <span className={styles.label}>{title}</span>
        </span>
        <span className={`${styles.timer} num text-text-dim`} aria-hidden="true">{time}</span>
      </button>
    </div>
  );
}
