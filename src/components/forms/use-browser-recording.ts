"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { getBrowserRecording, getForeignRecording, getServerRecording, subscribeBrowserRecording, recordingIsActive, recordingMatches } from "@/lib/browser-recording";
import type { RecordingScope, RecoveryKind } from "@/lib/recording-recovery";

export function useBrowserRecording(kind: RecoveryKind, scope: RecordingScope | null, onComplete: (file: File, recoveryId: string) => void) {
  const value = useSyncExternalStore(subscribeBrowserRecording, getBrowserRecording, getServerRecording);
  const foreign = useSyncExternalStore(subscribeBrowserRecording, () => getForeignRecording(scope), getServerRecording);
  const matching = recordingMatches(value, kind, scope) ? value : null;
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!matching?.file || !matching.meta || handled.current === matching.requestId) return;
    handled.current = matching.requestId;
    onComplete(matching.file, matching.meta.id);
  }, [matching, onComplete]);
  return {
    recording: recordingIsActive(matching),
    otherRecording: (recordingIsActive(value) && !matching) || !!foreign,
    seconds: matching?.seconds ?? 0,
    error: matching?.error,
    requestId: matching?.requestId,
    activeRecoveryId: recordingIsActive(matching) ? matching?.meta?.id : undefined,
  };
}
