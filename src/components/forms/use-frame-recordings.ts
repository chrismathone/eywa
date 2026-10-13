"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { downloadFile } from "@/lib/audio-upload";
import { dismissBrowserRecording, getBrowserRecording, stopBrowserRecording, type BrowserRecording } from "@/lib/browser-recording";

const PROGRESS = "eywa-recording-progress";
const COMMAND = "eywa-recording-command";
export type FrameRecording = {
  winId: string;
  frame: HTMLIFrameElement;
  value: Omit<BrowserRecording, "file"> & { hasFile: boolean };
};

/** Metadata and controls only. Audio never moves to a different frame's form. */
export function useFrameRecordings(local: BrowserRecording | null) {
  const router = useRouter();
  const [frames, setFrames] = useState<FrameRecording[]>([]);
  const inWorkspaceFrame = typeof window !== "undefined" && window.parent !== window && !!window.frameElement?.closest("[data-window-id]");
  useEffect(() => {
    if (window.parent === window) return;
    const value = local ? { ...local, file: undefined, hasFile: !!local.file } : null;
    window.parent.postMessage({ type: PROGRESS, value }, window.location.origin);
  }, [local]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (data?.type === COMMAND && window.parent !== window && event.source === window.parent) {
        const current = getBrowserRecording();
        if (!current || current.requestId !== data.requestId) return;
        if (data.command === "stop") stopBrowserRecording(current.requestId);
        if (data.command === "open") router.push(current.href);
        if (data.command === "download" && current.file) downloadFile(current.file);
        if (data.command === "dismiss") dismissBrowserRecording();
        return;
      }
      if (data?.type !== PROGRESS || window.parent !== window) return;
      const frame = [...document.querySelectorAll("iframe")].find((element) => element.contentWindow === event.source);
      const winId = frame?.closest<HTMLElement>("[data-window-id]")?.dataset.windowId;
      if (!frame || !winId) return;
      const value = data.value;
      if (value !== null && (!value || typeof value.requestId !== "string" || typeof value.scope?.label !== "string" || !["meeting", "consultation", "student-consultation"].includes(value.kind) || !["starting", "recording", "stopping", "ready", "failed"].includes(value.status) || typeof value.seconds !== "number")) return;
      setFrames((previous) => {
        const others = previous.filter((item) => item.winId !== winId && item.frame.isConnected);
        return value ? [...others, { winId, frame, value }] : others;
      });
    };
    const onHide = () => {
      if (window.parent !== window) window.parent.postMessage({ type: PROGRESS, value: null }, window.location.origin);
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

export function sendRecordingCommand(item: FrameRecording, command: "stop" | "open" | "download" | "dismiss") {
  item.frame.contentWindow?.postMessage({ type: COMMAND, requestId: item.value.requestId, command }, window.location.origin);
}
