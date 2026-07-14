"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleStop, History, Loader2, Mic, Upload, X } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  checkRecovery,
  clearRecovery,
  recoverRecording,
  saveChunk,
  startRecoverySession,
  type RecordingMeta,
} from "@/lib/recording-recovery";
import { useRecordingLock } from "@/components/workspace/use-recording-lock";
import { startMeetingFromAudio, createTextMeeting } from "@/features/meetings/server/actions";
import { issueAudioUploadTicket } from "@/features/media/server/upload-actions";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import {
  ACCEPTED_AUDIO_TYPES,
  downloadFile,
  formatBytes,
  formatSeconds,
  kstTimestamp,
  validateAudioFile,
} from "@/lib/audio-upload";

function nowLocalIso(): string {
  // datetime-local input needs `YYYY-MM-DDTHH:mm`
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function NewMeetingForm({ onSuccess }: { onSuccess?: () => void } = {}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  const [title, setTitle] = useState("");
  const [attendees, setAttendees] = useState("");
  const [heldAt, setHeldAt] = useState(nowLocalIso());
  const [notepad, setNotepad] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "submitting">("idle");
  const [uploadPct, setUploadPct] = useState(0);
  const [recoveryMeta, setRecoveryMeta] = useState<RecordingMeta | null>(null);

  // 녹음 중이면 이 폼이 든 플로팅 창의 닫기(X)·배경보내기와 탭 새로고침을 잠근다(우발적 유실 방지).
  useRecordingLock(isRecording);

  // On mount: look for an unfinished recording in IndexedDB (browser crash recovery).
  useEffect(() => {
    let cancelled = false;
    checkRecovery("meeting").then((meta) => {
      if (!cancelled) setRecoveryMeta(meta);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  async function handleRecover() {
    const recovered = await recoverRecording("meeting");
    if (recovered) {
      setFile(recovered);
      setRecoveryMeta(null);
      await clearRecovery("meeting");
    }
  }

  async function handleDiscardRecovery() {
    await clearRecovery("meeting");
    setRecoveryMeta(null);
  }

  function pickFile(f: File | null) {
    setError(null);
    if (!f) {
      setFile(null);
      return;
    }
    const err = validateAudioFile(f);
    if (err) {
      setError(err);
      return;
    }
    setFile(f);
  }

  function startRecording() {
    setError(null);
    // 폼이 든 플로팅 창 안에서 바로 녹음(별도 브라우저 창 없음). 창 자체가 떠 있어 배경을
    // 자유롭게 쓸 수 있고, 녹음 중엔 useRecordingLock이 창 닫기/탭 새로고침을 막는다.
    void startInlineRecording();
  }

  async function startInlineRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recordingChunksRef.current = [];

      // Initialize the IDB recovery session — chunks will persist as they arrive.
      await startRecoverySession("meeting", mime, title || undefined).catch(() => {
        // recovery is best-effort; swallow and continue recording
      });

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          const idx = recordingChunksRef.current.length;
          recordingChunksRef.current.push(e.data);
          // Fire-and-forget — never block the recorder.
          void saveChunk("meeting", idx, e.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: "audio/webm" });
        const recorded = new File([blob], `회의녹음_${kstTimestamp()}.webm`, { type: "audio/webm" });
        setFile(recorded);
        // 불상사 대비 디스크 백스톱 — 정지 즉시 다운로드 폴더로 저장(IDB 복구와 별개).
        downloadFile(recorded);
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordSeconds(0);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`마이크 접근 실패: ${msg}`);
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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("제목을 입력해주세요");
      return;
    }
    // 녹음·메모 중 하나는 있어야 한다. 메모만 있으면 텍스트 회의로 생성(녹음 없이 'AI로 정리' 가능).
    if (!file && !notepad.trim()) {
      setError("음성을 녹음/업로드하거나 메모를 작성해주세요");
      return;
    }

    if (!file) {
      // 메모만 — 녹음 없이 텍스트 회의 생성.
      setPhase("submitting");
      const fd = new FormData();
      fd.append("title", title);
      fd.append("attendees", attendees);
      fd.append("heldAt", new Date(heldAt).toISOString());
      fd.append("notepad", notepad);
      const result = await createTextMeeting(undefined, fd);
      if (result?.error) {
        setError(result.error);
        setPhase("idle");
        return;
      }
      if (onSuccess) {
        onSuccess();
        router.refresh();
      } else if (result?.id) {
        router.push(`/meetings/${result.id}`);
      } else {
        router.push("/meetings");
      }
      return;
    }

    setPhase("uploading");
    setUploadPct(0);

    try {
      // 1) 업로드 티켓 발급(서버가 tenant·권한·경로·크기 검증) → 2) 스토리지에 PUT(진행률 보존).
      const ext = file.name.split(".").pop()?.toLowerCase() || "webm";
      // .webm 파일은 브라우저 MIME이 video/webm이라 서버 allowCT(audio/*)에 막힘 → audio 폼이라 audio/*로 정규화.
      const ct = file.type.startsWith("audio/") ? file.type : `audio/${ext}`;
      const fdT = new FormData();
      fdT.set("kind", "meeting");
      fdT.set("ext", ext);
      fdT.set("contentType", ct);
      fdT.set("size", String(file.size));
      const tk = await issueAudioUploadTicket(undefined, fdT);
      if (tk?.error || !tk?.ticket) {
        setError(tk?.error ?? "업로드 준비 실패");
        setPhase("idle");
        return;
      }
      const objectName = tk.ticket.path;
      try {
        await uploadToTicket(tk.ticket, file, setUploadPct);
      } catch (e) {
        setError(e instanceof Error ? e.message : "업로드 실패");
        setPhase("idle");
        return;
      }

      // 3) Kick off analysis on the server.
      setPhase("submitting");
      const fd = new FormData();
      fd.append("title", title);
      fd.append("attendees", attendees);
      // Convert datetime-local (no TZ) → ISO with local timezone offset
      const heldDate = new Date(heldAt);
      fd.append("heldAt", heldDate.toISOString());
      fd.append("audioPath", objectName);
      fd.append("audioSizeBytes", String(file.size));
      fd.append("notepad", notepad);

      const result = await startMeetingFromAudio(undefined, fd);
      if (result?.error) {
        setError(result.error);
        setPhase("idle");
        return;
      }
      // success — clear IDB recovery chunks (analysis is now safely queued server-side)
      await clearRecovery("meeting");
      if (onSuccess) {
        onSuccess();
        router.refresh();
      } else {
        // standalone /meetings/new 라우트 — server redirect 대신 force navigation
        router.push("/meetings");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Recovery banner — IndexedDB crash recovery */}
      {recoveryMeta ? (
        <div className="border-chart-3/40 bg-chart-3/5 flex items-start gap-3 rounded-md border px-4 py-3">
          <History className="text-chart-3 mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-foreground text-sm font-medium">복구 가능한 녹음이 있습니다</p>
            <p className="text-muted-foreground text-xs">
              {new Date(recoveryMeta.startedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}에 시작 ·{" "}
              <span className="num">{recoveryMeta.chunkCount}</span>개 청크
              {recoveryMeta.title ? ` · "${recoveryMeta.title}"` : ""}
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleRecover}
                className="text-foreground hover:text-chart-3 text-xs font-medium"
              >
                복구하기
              </button>
              <span className="text-muted-foreground/40 text-xs">·</span>
              <button
                type="button"
                onClick={handleDiscardRecovery}
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                폐기
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Title */}
      <div className="space-y-1.5">
        <label htmlFor="title" className="text-foreground block text-sm font-medium">
          회의 제목 *
        </label>
        <input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
          required
          placeholder="예: 주간 강사 회의 (5월 4주차)"
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Attendees */}
      <div className="space-y-1.5">
        <label htmlFor="attendees" className="text-foreground block text-sm font-medium">
          참석자
        </label>
        <input
          id="attendees"
          value={attendees}
          onChange={(e) => setAttendees(e.target.value)}
          disabled={busy}
          placeholder="박지훈, 이연우, 김민지"
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <p className="text-muted-foreground text-xs">쉼표로 구분</p>
      </div>

      {/* Held at */}
      <div className="space-y-1.5">
        <label htmlFor="heldAt" className="text-foreground block text-sm font-medium">
          회의 일시
        </label>
        <input
          id="heldAt"
          type="datetime-local"
          value={heldAt}
          onChange={(e) => setHeldAt(e.target.value)}
          disabled={busy}
          className="border-input bg-background w-72 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Audio source */}
      <div className="space-y-2">
        <label className="text-foreground block text-sm font-medium">음성</label>

        {file ? (
          <div className="border-border bg-muted/30 flex items-center justify-between rounded-md border px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-foreground truncate text-sm font-medium">{file.name}</p>
              <p className="text-muted-foreground num text-xs">{formatBytes(file.size)}</p>
            </div>
            <button
              type="button"
              onClick={() => setFile(null)}
              disabled={busy}
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
              <span className="text-foreground block text-sm font-medium">녹음 중</span>
              <span className="text-muted-foreground num text-sm">{formatSeconds(recordSeconds)}</span>
            </div>
            <button
              type="button"
              onClick={stopRecording}
              className="text-chart-4 inline-flex items-center gap-1.5 text-sm font-medium"
            >
              <CircleStop className="size-4" />
              녹음 중지
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="border-border hover:border-foreground/40 hover:bg-accent/30 flex flex-col items-center gap-1.5 rounded-md border border-dashed px-3 py-5 transition"
            >
              <Upload className="text-muted-foreground size-5" />
              <span className="text-foreground block text-sm font-medium">파일 업로드</span>
              <span className="text-muted-foreground text-[11px]">MP3/M4A/WAV · 50MB</span>
            </button>
            <button
              type="button"
              onClick={startRecording}
              disabled={busy}
              className="border-border hover:border-foreground/40 hover:bg-accent/30 flex flex-col items-center gap-1.5 rounded-md border border-dashed px-3 py-5 transition"
            >
              <Mic className="text-muted-foreground size-5" />
              <span className="text-foreground block text-sm font-medium">바로 녹음</span>
              <span className="text-muted-foreground text-[11px]">브라우저 마이크 사용</span>
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
      </div>

      {/* 메모장 — 회의 중 메모(선택). 녹음과 함께 'AI로 정리'에 결합되며, 녹음 없이 메모만으로도 회의록 생성 가능. */}
      <div className="space-y-1.5">
        <label htmlFor="notepad" className="text-foreground block text-sm font-medium">
          메모장
        </label>
        <textarea
          id="notepad"
          value={notepad}
          onChange={(e) => setNotepad(e.target.value)}
          disabled={busy}
          rows={4}
          placeholder="회의 중 메모를 적어두세요. 녹음 전사와 함께 AI가 정리합니다. (녹음 없이 메모만으로도 생성 가능)"
          className="border-input bg-background focus:ring-ring min-h-[6rem] w-full resize-y rounded-md border px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1"
        />
      </div>

      {error ? (
        <p className="text-chart-4 bg-chart-4/10 border-chart-4/20 rounded-md border px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t pt-5">
        <Button type="submit" disabled={busy || (!file && !notepad.trim())}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {phase === "uploading"
            ? `업로드 중 ${uploadPct}%`
            : phase === "submitting"
              ? file
                ? "분석 시작 중…"
                : "저장 중…"
              : file
                ? "업로드 및 분석 시작"
                : "메모로 회의록 만들기"}
        </Button>
      </div>
    </form>
  );
}
