"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { kstDateTimeLocal } from "@/lib/date-kst";
import { useRouter } from "next/navigation";
import { useStateDraft } from "@/components/forms/use-state-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import { CircleStop, History, Loader2, Mic, Upload, X } from "@/components/icons/aywa-icon-compat";
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
import { withEmbed } from "@/components/workspace/embed-context";
import { useInFrame } from "@/components/workspace/use-in-frame";
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
  MAX_AUDIO_SIZE_LABEL,
} from "@/lib/audio-upload";

/** datetime-local 기본값 — **KST 지금**(런타임 시간대로 만들면 SSR과 브라우저가 9시간 어긋난다). */
const nowLocalIso = (): string => kstDateTimeLocal();

/** 만든 뒤 이동이 이만큼 안 끝나면 목적지 링크를 함께 보인다(아래 leaveTo). */
const LEAVE_FALLBACK_MS = 5000;

export function NewMeetingForm({ onSuccess }: { onSuccess?: () => void } = {}) {
  const router = useRouter();
  const inFrame = useInFrame();
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
  // leaving = 이미 만들었고 목적지로 떠나는 중(저장 버튼은 계속 잠근다 — leaveTo 주석).
  const [phase, setPhase] = useState<"idle" | "uploading" | "submitting" | "leaving">("idle");
  /** 떠나기가 끝나지 않을 때 줄 목적지 링크(LEAVE_FALLBACK_MS 뒤에만 채워진다). */
  const [stalledHref, setStalledHref] = useState<string | null>(null);
  /** 서버 액션 호출 자체가 실패했을 때의 원문 — 화면엔 한글 요약만, 원문은 툴팁(title)으로. */
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  // 떠나기 폴백 타이머·목적지 — pagehide/pageshow 핸들러가 렌더 밖에서 읽는다.
  const leaveTimerRef = useRef<number | null>(null);
  const leaveDestRef = useRef<string | null>(null);
  /** 뒤로가기로 되살아난 화면(bfcache)인가 — 이동은 끝났으니 '이동 중…'이 아니라 '이미 만든 회의록'을 말한다. */
  const [restored, setRestored] = useState(false);
  /**
   * 지금 `file`이 **이 화면에서 녹음한 것**인가 — 성공 뒤 녹음 복구 조각(IDB)을 지울지 가른다.
   * 파일 업로드·복구본이면 IDB에 남은 조각은 이 회의록 것이 아니다(아래 성공 분기 주석).
   */
  const fromInlineRecordingRef = useRef(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [recoveryMeta, setRecoveryMeta] = useState<RecordingMeta | null>(null);

  // 녹음 중이면 이 폼이 든 플로팅 창의 닫기(X)·배경보내기와 탭 새로고침을 잠근다(우발적 유실 방지).
  useRecordingLock(isRecording);

  // 텍스트 필드 로컬 초안 — 녹음은 recording-recovery(IDB 청크)가 지키지만 제목·참석자·메모는 React state뿐이라
  // 새로고침/창닫기에 유실됐다. 스냅샷 저장 + 복구 배너(생성 성공 시 삭제). 파일/녹음 상태는 초안 대상 아님.
  const draftSnapshot = useMemo(
    () => ({ title, attendees, heldAt, notepad }),
    [title, attendees, heldAt, notepad],
  );
  const localDraft = useStateDraft({
    scope: "meeting:new",
    snapshot: draftSnapshot,
    // heldAt은 항상 기본값(지금)이 채워지므로 빈 폼 판정에서 제외.
    hasContent: (s) => s.title.trim() !== "" || s.attendees.trim() !== "" || s.notepad.trim() !== "",
  });

  function restoreTextDraft() {
    const d = localDraft.restore();
    if (!d) return;
    setTitle(d.title);
    setAttendees(d.attendees);
    if (d.heldAt) setHeldAt(d.heldAt);
    setNotepad(d.notepad);
  }

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

  // 떠나기 폴백 타이머의 수명 — 문서가 실제로 내려가면(pagehide) 풀어 둔다(이동 중에 안내가 끼어들지 않게).
  // 뒤로가기로 이 화면이 되살아나면(bfcache, persisted) 이동은 이미 끝난 것이다 — '이미 만든 회의록' 안내와
  // [열기]·[새로 작성]을 바로 보인다(타이머를 풀었으니 안 그러면 '이동 중…'에 영영 멈춘다). 저장 버튼은 계속 잠근다.
  useEffect(() => {
    const onHide = () => {
      if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    };
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted || !leaveDestRef.current) return;
      setRestored(true);
      setStalledHref(leaveDestRef.current);
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", onShow);
    return () => {
      onHide();
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);

  async function handleRecover() {
    const recovered = await recoverRecording("meeting");
    if (recovered) {
      fromInlineRecordingRef.current = false; // 복구본 — 조각은 바로 아래에서 스스로 지운다
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
    fromInlineRecordingRef.current = false; // 업로드한 파일 — IDB 복구 조각과 무관
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
        fromInlineRecordingRef.current = true; // 이 녹음의 조각이 IDB에 있다 — 성공하면 비운다
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

  /**
   * 만든 뒤 떠나기 — 🔴 `router.push`가 아니라 **풀 문서 이동**. 서버 액션 직후의 push는 액션 응답이
   * 이 폼 페이지 트리를 다시 적용하면서 삼켜진다(#102) → 창이 /meetings/new를 못 벗어나 자동으로 안 닫히고
   * 버튼이 '처리 중'에 멈춘다. 창 안이면 embed를 유지한다(빠뜨리면 그 이동만 풀 셸로 그려진다).
   * ⚠️ 그래도 안 넘어갈 수 있다 — 녹음 중에 메모만으로 만들면 녹음 잠금이 '페이지를 나가시겠습니까?'를 띄우고,
   *    머물기를 누르면 이동이 취소된다. 그때 영영 잠기지 않게 잠시 뒤 목적지 링크를 함께 보인다(느리지만 가는
   *    중일 수도 있어 문구는 진행형 — 링크는 누르면 이동을 처음부터 다시 한다).
   * ⚠️ 저장 버튼을 idle로 되돌리지는 않는다 — 회의록은 이미 만들어졌으니 다시 누르면 같은 회의록이 둘
   *    (녹음이면 업로드·전사 비용도 두 번)이 된다.
   */
  function leaveTo(href: string) {
    const dest = inFrame ? withEmbed(href) : href;
    leaveDestRef.current = dest;
    setPhase("leaving");
    window.location.assign(dest);
    leaveTimerRef.current = window.setTimeout(() => setStalledHref(dest), LEAVE_FALLBACK_MS);
  }

  /** 서버 액션 호출 자체가 실패(네트워크·서버 오류) — 한글 요약 + 원문은 툴팁, 다시 누를 수 있게 둔다. */
  function failSubmit(err: unknown, message = "회의록을 만들지 못했습니다 — 연결을 확인하고 다시 눌러 주세요") {
    setError(message);
    setErrorDetail(err instanceof Error ? err.message : String(err));
    setPhase("idle");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setErrorDetail(null);

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
      let result: Awaited<ReturnType<typeof createTextMeeting>>;
      try {
        result = await createTextMeeting(undefined, fd);
      } catch (err) {
        failSubmit(err); // 호출 자체가 실패해도 '저장 중…'에 멈추지 않게
        return;
      }
      if (result?.error) {
        setError(result.error);
        setPhase("idle");
        return;
      }
      localDraft.clear();
      if (onSuccess) {
        onSuccess();
        router.refresh();
      } else {
        leaveTo(result?.id ? `/meetings/${result.id}` : "/meetings");
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

      // 성공이면 새 회의 id가 온다 — 서버가 redirect하지 않는다(했더니 이 promise가 NEXT_REDIRECT로 reject돼
      // 성공인데 아래 catch로 떨어졌다: 원문 오류 + 버튼이 다시 열려 업로드·전사 두 번).
      let result: Awaited<ReturnType<typeof startMeetingFromAudio>>;
      try {
        result = await startMeetingFromAudio(undefined, fd);
      } catch (err) {
        // 응답만 유실됐을 뿐 서버에선 행이 만들어졌을 수 있다 — 다시 누르라고 권하면 한 벌 더 생긴다.
        failSubmit(err, "회의록이 만들어졌을 수 있습니다 — 목록에서 확인한 뒤 다시 시도해 주세요");
        return;
      }
      if (result?.error && !result.id) {
        setError(result.error);
        setPhase("idle");
        return;
      }
      // 여기부터는 회의록 행이 **있다** — 성공, 또는 행을 만든 뒤 전사 제출만 실패(상세의 '처리 실패' 칸에 사유와
      // '전사부터 다시'가 뜬다). 버튼을 다시 열면 업로드·행·전사 과금이 한 벌 더 생기니 그 회의록으로 떠난다.
      // 녹음 복구 조각은 **이 화면에서 녹음한 것일 때만** 비운다 — 파일 업로드였다면 IDB에 남은 건 다른 크래시
      // 녹음이고(크래시라 다운로드 백업도 없다) 지우면 영구 유실이다. 텍스트 초안은 비운다.
      if (fromInlineRecordingRef.current) await clearRecovery("meeting");
      localDraft.clear();
      if (onSuccess) {
        onSuccess();
        router.refresh();
      } else {
        leaveTo(result?.id ? `/meetings/${result.id}` : "/meetings");
      }
    } catch (e) {
      failSubmit(e);
    }
  }

  const busy = phase !== "idle";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* 텍스트 초안 복구 배너(제목·참석자·메모) — 녹음 복구 배너와 별개 */}
      <DraftBanner
        savedAt={localDraft.draftSavedAt}
        onRestore={restoreTextDraft}
        onDiscard={localDraft.discard}
      />
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
            {/* 저장·이동 중엔 잠근다 — 그 사이 누르면 조각을 지우거나 파일을 바꾸는데, 결과를 보기도 전에 화면이 떠난다. */}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleRecover}
                disabled={busy}
                className="text-foreground hover:text-chart-3 text-xs font-medium disabled:opacity-40"
              >
                복구하기
              </button>
              <span className="text-muted-foreground/40 text-xs">·</span>
              <button
                type="button"
                onClick={handleDiscardRecovery}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground text-xs disabled:opacity-40"
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
              <span className="text-muted-foreground text-xs">MP3/M4A/WAV · {MAX_AUDIO_SIZE_LABEL}</span>
            </button>
            <button
              type="button"
              onClick={startRecording}
              disabled={busy}
              className="border-border hover:border-foreground/40 hover:bg-accent/30 flex flex-col items-center gap-1.5 rounded-md border border-dashed px-3 py-5 transition"
            >
              <Mic className="text-muted-foreground size-5" />
              <span className="text-foreground block text-sm font-medium">바로 녹음</span>
              <span className="text-muted-foreground text-xs">브라우저 마이크 사용</span>
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
        <p
          className="text-chart-4 bg-chart-4/10 border-chart-4/20 rounded-md border px-3 py-2 text-sm"
          title={errorDetail ?? undefined}
        >
          {error}
        </p>
      ) : null}

      {/* 떠나기가 늦을 때(leaveTo) — 만들어졌다는 사실 + 직접 가는 길. 아직 가는 중일 수 있어 문구는 진행형이다
          (링크는 평범한 풀 문서 이동이라 누르면 처음부터 다시 연다). 뒤로가기로 되살아난 화면이면 이동은 끝났으니
          '이미 만든 회의록' + [새로 작성](새로고침 = 폼을 새로 연다 — 이 폼은 중복 방지로 계속 잠겨 있다). */}
      {stalledHref ? (
        <p className="border-border bg-muted/30 text-foreground rounded-md border px-3 py-2 text-sm">
          {restored ? (
            <>
              이미 만든 회의록입니다 —{" "}
              <a href={stalledHref} className="font-medium underline underline-offset-2">
                열기
              </a>
              {" · "}
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="font-medium underline underline-offset-2"
              >
                새로 작성
              </button>
            </>
          ) : (
            <>
              회의록을 만들었고 화면을 여는 중입니다. 계속 넘어가지 않으면{" "}
              <a href={stalledHref} className="font-medium underline underline-offset-2">
                여기를 누르세요
              </a>
              .
            </>
          )}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t pt-5">
        <Button type="submit" disabled={busy || (!file && !notepad.trim())}>
          {busy && !restored ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {phase === "uploading"
            ? `업로드 중 ${uploadPct}%`
            : phase === "submitting"
              ? file
                ? "분석 시작 중…"
                : "저장 중…"
              : phase === "leaving"
                ? restored
                  ? "이미 만들었습니다"
                  : "이동 중…"
                : file
                  ? "업로드 및 분석 시작"
                  : "메모로 회의록 만들기"}
        </Button>
      </div>
    </form>
  );
}
