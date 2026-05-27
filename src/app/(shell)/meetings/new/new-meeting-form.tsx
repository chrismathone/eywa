"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleStop, History, Loader2, Mic, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  checkRecovery,
  clearRecovery,
  recoverRecording,
  saveChunk,
  startRecoverySession,
  type RecordingMeta,
} from "@/lib/recording-recovery";
import { createClient } from "@/lib/supabase/client";
import { startMeetingFromAudio } from "@/features/meetings/server/actions";

const ACCEPTED = [
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
];
const MAX_SIZE = 50 * 1024 * 1024; // 50 MB — Supabase free-tier cap

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function nowLocalIso(): string {
  // datetime-local input needs `YYYY-MM-DDTHH:mm`
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function NewMeetingForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  const [title, setTitle] = useState("");
  const [attendees, setAttendees] = useState("");
  const [heldAt, setHeldAt] = useState(nowLocalIso());

  const [file, setFile] = useState<File | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "submitting">("idle");
  const [uploadPct, setUploadPct] = useState(0);
  const [recoveryMeta, setRecoveryMeta] = useState<RecordingMeta | null>(null);

  // On mount: look for an unfinished recording in IndexedDB (browser crash recovery).
  useEffect(() => {
    let cancelled = false;
    checkRecovery().then((meta) => {
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
    const recovered = await recoverRecording();
    if (recovered) {
      setFile(recovered);
      setRecoveryMeta(null);
      await clearRecovery();
    }
  }

  async function handleDiscardRecovery() {
    await clearRecovery();
    setRecoveryMeta(null);
  }

  function pickFile(f: File | null) {
    setError(null);
    if (!f) {
      setFile(null);
      return;
    }
    if (!ACCEPTED.includes(f.type) && !/\.(mp3|m4a|wav|webm|ogg)$/i.test(f.name)) {
      setError(`지원하지 않는 형식입니다: ${f.type || f.name}`);
      return;
    }
    if (f.size > MAX_SIZE) {
      setError(`파일이 너무 큽니다 (${formatBytes(f.size)} > ${formatBytes(MAX_SIZE)})`);
      return;
    }
    setFile(f);
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

      // Initialize the IDB recovery session — chunks will persist as they arrive.
      await startRecoverySession(mime, title || undefined).catch(() => {
        // recovery is best-effort; swallow and continue recording
      });

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          const idx = recordingChunksRef.current.length;
          recordingChunksRef.current.push(e.data);
          // Fire-and-forget — never block the recorder.
          void saveChunk(idx, e.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: "audio/webm" });
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const recorded = new File([blob], `recording-${ts}.webm`, { type: "audio/webm" });
        setFile(recorded);
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

    if (!file) {
      setError("음성 파일을 선택하거나 녹음해주세요");
      return;
    }
    if (!title.trim()) {
      setError("제목을 입력해주세요");
      return;
    }

    setPhase("uploading");
    setUploadPct(0);

    try {
      // 1) Get current user's tenant via Supabase session (path prefix).
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("로그인이 만료되었습니다");
        setPhase("idle");
        return;
      }
      const tenantId = (user.app_metadata as { tenant_id?: string })?.tenant_id;
      if (!tenantId) {
        setError("테넌트 정보가 없습니다");
        setPhase("idle");
        return;
      }

      // 2) Upload to storage at {tenant_id}/{uuid}.{ext}
      const ext = file.name.split(".").pop()?.toLowerCase() || "webm";
      const objectName = `${tenantId}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("meeting-recordings")
        .upload(objectName, file, {
          contentType: file.type || `audio/${ext}`,
          upsert: false,
        });
      if (upErr) {
        setError(`업로드 실패: ${upErr.message}`);
        setPhase("idle");
        return;
      }
      setUploadPct(100);

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

      const result = await startMeetingFromAudio(undefined, fd);
      if (result?.error) {
        setError(result.error);
        setPhase("idle");
        return;
      }
      // success — clear IDB recovery chunks (analysis is now safely queued server-side)
      await clearRecovery();
      // server redirected, but if we got here it didn't; force navigation
      router.push("/meetings");
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
              {new Date(recoveryMeta.startedAt).toLocaleString("ko-KR")}에 시작 ·{" "}
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
          accept={ACCEPTED.join(",")}
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          className="hidden"
        />
      </div>

      {error ? (
        <p className="text-chart-4 bg-chart-4/10 border-chart-4/20 rounded-md border px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t pt-5">
        <Button type="submit" disabled={busy || !file}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {phase === "uploading"
            ? `업로드 중 ${uploadPct}%`
            : phase === "submitting"
              ? "분석 시작 중…"
              : "업로드 및 분석 시작"}
        </Button>
      </div>
    </form>
  );
}
