"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { downloadFile } from "@/lib/audio-upload";
import {
  dismissBrowserRecording, getBrowserRecordings, pauseBrowserRecording, recordingIsActive, recordingViewAttached,
  resumeBrowserRecording, stopBrowserRecording, type BrowserRecording,
} from "@/lib/browser-recording";

const PROGRESS = "eywa-recording-progress";
const COMMAND = "eywa-recording-command";
const KINDS = ["meeting", "consultation", "student-consultation"];
const STATUSES = ["starting", "recording", "paused", "stopping", "ready", "failed"];
export type RecordingCommand = "stop" | "pause" | "resume" | "open" | "download" | "dismiss";
export type FrameValue = Omit<BrowserRecording, "file"> & { hasFile: boolean };
export type FrameRecording = { winId: string; frame: HTMLIFrameElement; value: FrameValue };

export function toFrameValue(value: BrowserRecording): FrameValue {
  const { file, ...rest } = value;
  return { ...rest, hasFile: !!file };
}
function validFrameValue(value: unknown): value is FrameValue {
  const v = value as FrameValue | null;
  return !!v && typeof v.requestId === "string" && typeof v.scope?.label === "string" && KINDS.includes(v.kind)
    && STATUSES.includes(v.status) && typeof v.seconds === "number";
}

/** 이 문서의 녹음 하나에 명령 — 아이콘(같은 문서)과 부모가 보낸 명령(창 안)이 같은 길을 쓴다. */
export function runRecordingCommand(value: BrowserRecording, command: RecordingCommand, navigate: (href: string) => void) {
  if (command === "stop") stopBrowserRecording(value.requestId);
  if (command === "pause") pauseBrowserRecording(value.requestId);
  if (command === "resume") resumeBrowserRecording(value.requestId);
  // 작성 폼이 이미 화면에 붙어 있으면 옮기지 않는다 — 같은 주소로 다시 가면 쿼리가 바뀌어 폼이 새로 그려질 수 있다.
  if (command === "open" && !recordingViewAttached(value.requestId)) navigate(value.href);
  if (command === "download" && value.file) downloadFile(value.file);
  if (command === "dismiss") dismissBrowserRecording({ requestId: value.requestId });
}

/** 창(iframe)의 녹음 진행 정보만 바탕으로 올린다 — 소리는 그 창의 폼에서 나가지 않는다. 녹음마다 아이콘 하나. */
export function useFrameRecordings(local: readonly BrowserRecording[]) {
  const router = useRouter();
  const [frames, setFrames] = useState<FrameRecording[]>([]);
  const inWorkspaceFrame = typeof window !== "undefined" && window.parent !== window && !!window.frameElement?.closest("[data-window-id]");
  useEffect(() => {
    if (window.parent === window) return;
    const values = local.map(toFrameValue);
    // `value` = 배포가 섞인 사이 옛 바탕(하나만 읽는다)을 위한 대표 하나 — 녹음 중 → 살아 있는 것 → 맨 끝.
    // 옛 바탕은 '일시정지'를 몰라 그 값을 통째로 버린다(아이콘이 옛 상태로 굳는다) — 살아 있는 녹음으로 보낸다.
    const pick = values.find((v) => v.status === "recording") ?? values.find(recordingIsActive) ?? values[values.length - 1] ?? null;
    const value = pick?.status === "paused" ? { ...pick, status: "recording" as const } : pick;
    window.parent.postMessage({ type: PROGRESS, values, value }, window.location.origin);
  }, [local]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (data?.type === COMMAND && window.parent !== window && event.source === window.parent) {
        const current = getBrowserRecordings().find((value) => value.requestId === data.requestId);
        if (current) runRecordingCommand(current, data.command, (href) => router.push(href));
        return;
      }
      if (data?.type !== PROGRESS || window.parent !== window) return;
      const frame = [...document.querySelectorAll("iframe")].find((element) => element.contentWindow === event.source);
      const winId = frame?.closest<HTMLElement>("[data-window-id]")?.dataset.windowId;
      if (!frame || !winId) return;
      const list: unknown[] = Array.isArray(data.values) ? data.values : data.value ? [data.value] : [];
      const values = list.filter(validFrameValue);
      setFrames((previous) => [
        ...previous.filter((item) => item.winId !== winId && item.frame.isConnected),
        ...values.map((value) => ({ winId, frame, value })),
      ]);
    };
    const onHide = () => {
      if (window.parent !== window) window.parent.postMessage({ type: PROGRESS, values: [], value: null }, window.location.origin);
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("pagehide", onHide);
      onHide();
    };
  }, [router]);

  useEffect(() => {
    if (!frames.length) return;
    const timer = setInterval(() => setFrames((previous) => previous.some((item) => !item.frame.isConnected) ? previous.filter((item) => item.frame.isConnected) : previous), 3000);
    return () => clearInterval(timer);
  }, [frames.length]);
  return { frames, inWorkspaceFrame };
}

export function sendRecordingCommand(item: FrameRecording, command: RecordingCommand) {
  item.frame.contentWindow?.postMessage({ type: COMMAND, requestId: item.value.requestId, command }, window.location.origin);
}
