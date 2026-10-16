"use client";

import { useEffect, useRef, useState } from "react";
import { useLicenseOn } from "@/features/owner/operations-context";
import { Mic, Upload, X } from "@/components/icons/aywa-icon-compat";
import { RecordingRecoveryNotice } from "@/components/forms/recording-recovery-notice";
import {
  type RecordingScope,
} from "@/lib/recording-recovery";
import { useBrowserRecording } from "@/components/forms/use-browser-recording";
import { useMicrophone } from "@/components/forms/use-microphone";
import { RecordingSessionControls } from "@/components/forms/recording-session-controls";
import { startBrowserRecording } from "@/lib/browser-recording";
import { recordingReturnHref } from "@/lib/recording-resume";
import {
  AUDIO_FILE_ACCEPT,
  formatBytes,
  validateAudioFile,
  MAX_AUDIO_SIZE_LABEL,
} from "@/lib/audio-upload";

/**
 * 공용 음성 녹음/업로드 필드 — 등록상담 통합 폼·녹음 폼이 공유.
 * 파일 상태는 부모가 소유(`file`/`onChange`)해 제출 시 함께 보낸다. 진행 중 녹음은 공용 문서 영역에서 유지한다.
 * - 라이브 녹음(브라우저 마이크) + 파일 업로드 둘 다. 녹음 중엔 useRecordingLock이 창 닫기/탭 새로고침을 막음.
 * - 녹음은 여러 개를 켜 둘 수 있고 소리를 담는 것은 하나(원장 2026-10-16) — 이 칸에서 시작·이어서 녹음하면 다른 녹음은 일시정지.
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
  /** 녹음 진행 여부(일시정지 포함)·일시정지 여부를 부모로 끌어올림 — 녹음 중 제출(=진행 녹음 silent 유실) 방지용. 안정 함수 권장. */
  onRecordingChange?: (recording: boolean, paused: boolean) => void;
  disabled?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);

  const recorded = useBrowserRecording("consultation", scope, onChange);
  const microphone = useMicrophone();
  const isRecording = recorded.recording;
  const paused = recorded.status === "paused";
  // 녹음 진행 여부를 부모로 통지 → 부모가 제출 버튼을 막아 진행 중 녹음이 silent하게 유실되는 것 방지.
  useEffect(() => {
    onRecordingChange?.(isRecording, paused);
  }, [isRecording, paused, onRecordingChange]);

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
    // 돌아올 곳 = 지금 작성 화면 — 녹음 아이콘의 '작성 화면 열기'가 그 화면의 입력을 바로 되살린다(recording-resume.ts).
    const err = await startBrowserRecording("consultation", scope, { href: recordingReturnHref() });
    if (err) setError(err);
  }

  return (
    <div className="space-y-2">
      {recorded.elsewhere ? <p className="text-text-dim text-xs">이 상담은 다른 창이나 탭에서 녹음하고 있습니다.</p> : null}
      {showRecovery ? <RecordingRecoveryNotice
        key={scope?.recordKey ?? "empty"}
        kind="consultation" scope={scope} selectedId={selectedRecoveryId ?? recorded.activeRecoveryId}
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
        <RecordingSessionControls status={recorded.status} seconds={recorded.seconds}
          onPause={recorded.pause} onResume={recorded.resume} onStop={recorded.stop} />
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
            disabled={disabled || recorded.elsewhere || !microphone.available}
            className="border-border hover:border-foreground/40 hover:bg-accent/30 flex flex-col items-center gap-1.5 rounded-md border border-dashed px-3 py-5 transition disabled:opacity-50"
          >
            <Mic className="text-muted-foreground size-5" />
            <span className="text-foreground text-sm font-medium">{microphone.available ? "바로 녹음" : microphone.message}</span>
            {microphone.available ? <span className="text-muted-foreground text-xs">{recorded.othersRecording ? "지금 녹음 중인 다른 녹음은 일시정지됩니다" : "입력하면서 녹음 가능"}</span> : null}
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

      {(error || recorded.error) ? (
        <p className="text-chart-4 bg-chart-4/10 border-chart-4/20 rounded-md border px-3 py-2 text-sm">{error || recorded.error}</p>
      ) : null}
    </div>
  );
}

/** 녹음·전사 라이선스가 꺼진 지점엔 녹음 칸이 없다(2026-09-30 "꺼지면 흔적 없이") — 서버 경로가 따로 막는다. */
export function AudioRecorderField(props: Parameters<typeof AudioRecorderFieldInner>[0]) {
  return useLicenseOn("meeting_recording") ? <AudioRecorderFieldInner {...props} /> : null;
}
