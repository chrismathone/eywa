"use client";

import { useEffect, useRef, useState } from "react";
import { useLicenseOn } from "@/features/owner/operations-context";
import { CircleStop, Mic, Upload, X } from "@/components/icons/aywa-icon-compat";
import { RecordingRecoveryNotice } from "@/components/forms/recording-recovery-notice";
import {
  saveChunk,
  startRecoverySession,
  type RecordingScope,
} from "@/lib/recording-recovery";
import { useRecordingLock } from "@/components/workspace/use-recording-lock";
import {
  AUDIO_FILE_ACCEPT,
  downloadFile,
  formatBytes,
  formatSeconds,
  validateAudioFile,
  MAX_AUDIO_SIZE_LABEL,
} from "@/lib/audio-upload";

/**
 * 공용 음성 녹음/업로드 필드 — 등록상담 통합 폼·녹음 폼이 공유.
 * 파일 상태는 부모가 소유(`file`/`onChange`)해 제출 시 함께 보낸다. 녹음 내부 상태(진행·복구·잠금)는 자체 관리.
 * - 라이브 녹음(브라우저 마이크) + 파일 업로드 둘 다. 녹음 중엔 useRecordingLock이 창 닫기/탭 새로고침을 막음.
 * - 1초 청크를 IndexedDB에 저장(복구) + 정지 시 디스크 백스톱 다운로드(유실 3중 방어, recording-form과 동일).
 */
function AudioRecorderFieldInner({
  file,
  onChange,
  onRecordingChange,
  disabled = false,
  scope,
  selectedRecoveryId,
  showRecovery = true,
}: {
  file: File | null;
  onChange: (f: File | null, recoveryId?: string) => void;
  scope: RecordingScope | null;
  selectedRecoveryId?: string | null;
  showRecovery?: boolean;
  /** 녹음 진행 여부를 부모로 끌어올림 — 녹음 중 제출(=진행 녹음 silent 유실) 방지용. 안정 setter 권장. */
  onRecordingChange?: (recording: boolean) => void;
  disabled?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const attemptRef = useRef<symbol | null>(null);
  const recordingTimerRef = useRef<number | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // 녹음 중이면 이 폼이 든 플로팅 창의 닫기(X)·배경보내기·탭 새로고침을 잠근다(우발적 유실 방지).
  useRecordingLock(isRecording);
  // 녹음 진행 여부를 부모로 통지 → 부모가 제출 버튼을 막아 진행 중 녹음이 silent하게 유실되는 것 방지.
  useEffect(() => {
    onRecordingChange?.(isRecording);
  }, [isRecording, onRecordingChange]);

  useEffect(
    () => () => {
      attemptRef.current = null;
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    },
    [],
  );

  function pickFile(f: File | null) {
    setError(null);
    if (!f) {
      onChange(null);
      return;
    }
    const err = validateAudioFile(f);
    if (err) {
      setError(err);
      return;
    }
    onChange(f);
  }

  async function startRecording() {
    setError(null);
    if (!scope) return setError("학생 이름을 입력한 뒤 녹음을 시작해 주세요.");
    if (attemptRef.current) return;
    const attempt = Symbol();
    attemptRef.current = attempt;
    mediaRecorderRef.current = null;
    setIsRecording(true);
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (attemptRef.current !== attempt) { stream.getTracks().forEach((t) => t.stop()); return; }
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      const chunks: Blob[] = [];
      const session = await startRecoverySession("consultation", mime, scope);
      if (attemptRef.current !== attempt) { stream.getTracks().forEach((t) => t.stop()); return; }
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          const idx = chunks.length;
          chunks.push(e.data);
          void saveChunk(session.id, idx, e.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        // 파일 이름엔 `&`를 쓰지 않는다(다운로드 백스톱·업로드 경로에서 이름이 깨질 수 있다) — '콜앤상담'.
        const recorded = new File([blob], session.fileName!, { type: "audio/webm" });
        if (attemptRef.current === attempt) onChange(recorded, session.id);
        // 불상사 대비 디스크 백스톱 — 정지 즉시 다운로드 폴더로 저장(IDB 복구와 별개).
        downloadFile(recorded);
        stream?.getTracks().forEach((t) => t.stop());
        if (attemptRef.current === attempt) { attemptRef.current = null; setIsRecording(false); }
      };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordSeconds(0);
      recordingTimerRef.current = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      if (attemptRef.current !== attempt) return;
      attemptRef.current = null;
      setIsRecording(false);
      setError(`마이크 접근 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === "inactive") return;
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    } else {
      attemptRef.current = null;
      setIsRecording(false);
    }
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  return (
    <div className="space-y-2">
      {showRecovery ? <RecordingRecoveryNotice
        key={scope?.recordKey ?? "empty"}
        kind="consultation" scope={scope} selectedId={selectedRecoveryId}
        disabled={disabled || isRecording}
        onRestore={(recovered, meta) => onChange(recovered, meta.id)}
      /> : null}

      {file ? (
        <div className="border-border bg-muted/30 flex items-center justify-between rounded-md border px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-foreground truncate text-sm font-medium">{file.name}</p>
            <p className="text-muted-foreground num text-xs">{formatBytes(file.size)}</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="text-muted-foreground hover:text-foreground p-1"
            aria-label="제거"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : isRecording ? (
        <div className="border-chart-4 bg-chart-4/5 flex items-center justify-between rounded-md border px-3 py-3">
          <div className="inline-flex items-center gap-3">
            <span className="relative inline-flex size-2.5">
              <span className="bg-chart-4 absolute inset-0 animate-ping rounded-full opacity-60" />
              <span className="bg-chart-4 relative inline-flex size-2.5 rounded-full" />
            </span>
            <span className="text-foreground text-sm font-medium">녹음 중</span>
            <span className="text-muted-foreground num text-sm">{formatSeconds(recordSeconds)}</span>
          </div>
          <button type="button" onClick={stopRecording} className="text-chart-4 inline-flex items-center gap-1.5 text-sm font-medium">
            <CircleStop className="size-4" />
            녹음 중지
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="border-border hover:border-foreground/40 hover:bg-accent/30 flex flex-col items-center gap-1.5 rounded-md border border-dashed px-3 py-5 transition disabled:opacity-50"
          >
            <Upload className="text-muted-foreground size-5" />
            <span className="text-foreground text-sm font-medium">파일 업로드</span>
            <span className="text-muted-foreground text-xs">MP3/M4A/WAV · {MAX_AUDIO_SIZE_LABEL}</span>
          </button>
          <button
            type="button"
            onClick={startRecording}
            disabled={disabled}
            className="border-border hover:border-foreground/40 hover:bg-accent/30 flex flex-col items-center gap-1.5 rounded-md border border-dashed px-3 py-5 transition disabled:opacity-50"
          >
            <Mic className="text-muted-foreground size-5" />
            <span className="text-foreground text-sm font-medium">바로 녹음</span>
            <span className="text-muted-foreground text-xs">입력하면서 녹음 가능</span>
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={AUDIO_FILE_ACCEPT}
        onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        className="hidden"
      />

      {error ? (
        <p className="text-chart-4 bg-chart-4/10 border-chart-4/20 rounded-md border px-3 py-2 text-sm">{error}</p>
      ) : null}
    </div>
  );
}

/** 녹음·전사 라이선스가 꺼진 지점엔 녹음 칸이 없다(2026-09-30 "꺼지면 흔적 없이") — 서버 경로가 따로 막는다. */
export function AudioRecorderField(props: Parameters<typeof AudioRecorderFieldInner>[0]) {
  return useLicenseOn("meeting_recording") ? <AudioRecorderFieldInner {...props} /> : null;
}
