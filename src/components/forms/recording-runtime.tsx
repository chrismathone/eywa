"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useRecordingLock } from "@/components/workspace/use-recording-lock";
import { useWindowStore } from "@/components/workspace/window-store";
import { adoptRecordingOwner, releaseRecordingOwner, getBrowserRecordings, getServerRecordings, recordingIsActive, subscribeBrowserRecording } from "@/lib/browser-recording";
import type { RecordingOwner } from "@/lib/recording-recovery";
import { scanLeftoverRecordings } from "@/lib/recording-diagnostics";
import { runRecordingCommand, sendRecordingCommand, toFrameValue, useFrameRecordings, type FrameValue, type RecordingCommand } from "./use-frame-recordings";
import { RecordingCapsule } from "./recording-capsule";

export function RecordingOwnerGuard({ owner }: { owner: RecordingOwner }) {
  const { tenantId, userId } = owner;
  useEffect(() => {
    adoptRecordingOwner({ tenantId, userId });
    // 지난번 녹음이 끝 기록 없이 사라졌거나 중단 보고를 못 보냈으면 지금 보낸다(녹음 중단 진단 · 원장 2026-10-29).
    void scanLeftoverRecordings({ tenantId, userId });
    return () => releaseRecordingOwner({ tenantId, userId });
  }, [tenantId, userId]);
  return null;
}

/**
 * Mounted in the root layout; changing pages never stops or unmounts a recorder.
 * 녹음마다 아이콘 하나 — 이 문서의 녹음 + 창(iframe)들이 올려 보낸 녹음(원장 2026-10-16 여러 녹음 · 누른 녹음만 녹음).
 */
export function RecordingRuntime() {
  const router = useRouter();
  const local = useSyncExternalStore(subscribeBrowserRecording, getBrowserRecordings, getServerRecordings);
  const { frames, inWorkspaceFrame } = useFrameRecordings(local);
  useRecordingLock(local.some(recordingIsActive));
  if (inWorkspaceFrame || (!local.length && !frames.length)) return null;
  const items: { key: string; value: FrameValue; run: (command: RecordingCommand) => void }[] = [
    ...local.map((value) => ({ key: value.requestId, value: toFrameValue(value), run: (command: RecordingCommand) => runRecordingCommand(value, command, (href) => router.push(href)) })),
    ...frames.map((item) => ({ key: `${item.winId}:${item.value.requestId}`, value: item.value, run: (command: RecordingCommand) => {
      if (command === "open") useWindowStore.getState().restore(item.winId);
      sendRecordingCommand(item, command);
    } })),
  ];
  return <>{items.map((item) => <RecordingCapsule key={item.key} recording={item.value} onCommand={item.run} />)}</>;
}
