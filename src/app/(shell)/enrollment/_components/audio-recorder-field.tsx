"use client";

import { useEffect, useRef, useState } from "react";
import { CircleStop, History, Mic, Upload, X } from "@/components/icons/aywa-icon-compat";
import {
  checkRecovery,
  clearRecovery,
  recoverRecording,
  saveChunk,
  startRecoverySession,
  type RecordingMeta,
} from "@/lib/recording-recovery";
import { useRecordingLock } from "@/components/workspace/use-recording-lock";
import {
  ACCEPTED_AUDIO_TYPES,
  downloadFile,
  formatBytes,
  formatSeconds,
  kstTimestamp,
  validateAudioFile,
  MAX_AUDIO_SIZE_LABEL,
} from "@/lib/audio-upload";

/**
 * 공용 음성 녹음/업로드 필드 — 등록상담 통합 폼·녹음 폼이 공유.
 * 파일 상태는 부모가 소유(`file`/`onChange`)해 제출 시 함께 보낸다. 녹음 내부 상태(진행·복구·잠금)는 자체 관리.
 * - 라이브 녹음(브라우저 마이크) + 파일 업로드 둘 다. 녹음 중엔 useRecordingLock이 창 닫기/탭 새로고침을 막음.
 * - 1초 청크를 IndexedDB에 저장(복구) + 정지 시 디스크 백스톱 다운로드(유실 3중 방어, recording-form과 동일).
 */
export function AudioRecorderField({
  file,
  onChange,
  onRecordingChange,
  disabled = false,
}: {
  file: File | null;
  onChange: (f: File | null) => void;
  /** 녹음 진행 여부를 부모로 끌어올림 — 녹음 중 제출(=진행 녹음 silent 유실) 방지용. 안정 setter 권장. */
  onRecordingChange?: (recording: boolean) => void;
  disabled?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recoveryMeta, setRecoveryMeta] = useState<RecordingMeta | null>(null);

  // 녹음 중이면 이 폼이 든 플로팅 창의 닫기(X)·배경보내기·탭 새로고침을 잠근다(우발적 유실 방지).
  useRecordingLock(isRecording);
  // 녹음 진행 여부를 부모로 통지 → 부모가 제출 버튼을 막아 진행 중 녹음이 silent하게 유실되는 것 방지.
  useEffect(() => {
    onRecordingChange?.(isRecording);
  }, [isRecording, onRecordingChange]);

  useEffect(() => {
    let cancelled = false;
    checkRecovery("consultation").then((m) => {
      if (!cancelled) setRecoveryMeta(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    },
    [],
  );

  async function handleRecover() {
    const recovered = await recoverRecording("consultation");
    if (recovered) {
      onChange(recovered);
      setRecoveryMeta(null);
      await clearRecovery("consultation");
    }
  }

  async function handleDiscardRecovery() {
    await clearRecovery("consultation");
    setRecoveryMeta(null);
  }

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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recordingChunksRef.current = [];
      await startRecoverySession("consultation", mime).catch(() => {});
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          const idx = recordingChunksRef.current.length;
          recordingChunksRef.current.push(e.data);
          void saveChunk("consultation", idx, e.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: "audio/webm" });
        // 파일 이름엔 `&`를 쓰지 않는다(다운로드 백스톱·업로드 경로에서 이름이 깨질 수 있다) — '콜앤상담'.
        const recorded = new File([blob], `콜앤상담녹음_${kstTimestamp()}.webm`, { type: "audio/webm" });
        onChange(recorded);
        // 불상사 대비 디스크 백스톱 — 정지 즉시 다운로드 폴더로 저장(IDB 복구와 별개).
        downloadFile(recorded);
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordSeconds(0);
      recordingTimerRef.current = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch (e) {
      setError(`마이크 접근 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
  }

  return (
    <div className="space-y-2">
      {recoveryMeta ? (
        <div className="border-chart-3/40 bg-chart-3/5 flex items-start gap-3 rounded-md border px-4 py-3">
          <History className="text-chart-3 mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-foreground text-sm font-medium">복구 가능한 녹음이 있습니다</p>
            <p className="text-muted-foreground text-xs">
              {new Date(recoveryMeta.startedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}에 시작 ·{" "}
              <span className="num">{recoveryMeta.chunkCount}</span>개 청크
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button type="button" onClick={handleRecover} className="text-foreground hover:text-chart-3 text-xs font-medium">
                복구하기
              </button>
              <span className="text-muted-foreground/40 text-xs">·</span>
              <button type="button" onClick={handleDiscardRecovery} className="text-muted-foreground hover:text-foreground text-xs">
                폐기
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
        accept={ACCEPTED_AUDIO_TYPES.join(",")}
        onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        className="hidden"
      />

      {error ? (
        <p className="text-chart-4 bg-chart-4/10 border-chart-4/20 rounded-md border px-3 py-2 text-sm">{error}</p>
      ) : null}
    </div>
  );
}
