"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  attachRecordingView, findRecording, getBrowserRecordings, getServerRecordings, pauseBrowserRecording, recordingIsActive,
  resumeBrowserRecording, stopBrowserRecording, subscribeBrowserRecording, type BrowserRecording,
} from "@/lib/browser-recording";
import { foreignCapturing, getForeignRecording } from "@/lib/browser-recording-channel";
import type { RecordingScope, RecoveryKind } from "@/lib/recording-recovery";

const noForeign = () => null;
const noCapture = () => false;

/**
 * 작성 폼 한 대상(상담·회의)의 녹음. 녹음은 폼과 따로 살고, 폼이 다시 열리면 대상이 같은 녹음에 다시 붙는다.
 * - `recording` = 녹음이 살아 있다(준비·녹음 중·일시정지·마무리 중) — 저장을 막고 대상 칸을 잠근다.
 * - `elsewhere` = 같은 대상을 다른 창·탭에서 녹음 중 — 시작 버튼을 막는다.
 * - `othersRecording` = 다른 녹음이 지금 소리를 담고 있다 — 이 녹음을 시작하면 그것이 일시정지된다.
 */
export function useBrowserRecording(kind: RecoveryKind, scope: RecordingScope | null, onComplete: (file: File, recoveryId: string) => void) {
  const list = useSyncExternalStore(subscribeBrowserRecording, getBrowserRecordings, getServerRecordings);
  const foreign = useSyncExternalStore(subscribeBrowserRecording, () => getForeignRecording(kind, scope), noForeign);
  const owner = scope ? { tenantId: scope.tenantId, userId: scope.userId } : null;
  const foreignLive = useSyncExternalStore(subscribeBrowserRecording, () => foreignCapturing(owner), noCapture);
  const matching: BrowserRecording | null = findRecording(list, kind, scope);
  const requestId = matching?.requestId;
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!matching?.file || !matching.meta || handled.current === matching.requestId) return;
    handled.current = matching.requestId;
    onComplete(matching.file, matching.meta.id);
  }, [matching, onComplete]);
  useEffect(() => (requestId ? attachRecordingView(requestId) : undefined), [requestId]);
  const live = recordingIsActive(matching);
  return {
    recording: live,
    status: matching?.status,
    elsewhere: !live && !!foreign,
    othersRecording: foreignLive || list.some((value) => value !== matching && value.status === "recording"),
    seconds: matching?.seconds ?? 0,
    error: matching?.error,
    requestId,
    activeRecoveryId: live ? matching?.meta?.id : undefined,
    pause: () => { if (requestId) pauseBrowserRecording(requestId); },
    resume: () => { if (requestId) resumeBrowserRecording(requestId); },
    stop: () => { if (requestId) stopBrowserRecording(requestId); },
  };
}
