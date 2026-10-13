"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLicenseOn } from "@/features/owner/operations-context";
import { Loader2, Mic, Square, Upload } from "@/components/icons/aywa-icon-compat";
import { RecordingRecoveryNotice } from "@/components/forms/recording-recovery-notice";
import { Button } from "@/components/ui/button";
import { FilePickerButton } from "@/components/ui/file-picker-button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { AUDIO_FILE_ACCEPT, downloadFile } from "@/lib/audio-upload";
import { issueAudioUploadTicket } from "@/features/media/server/upload-actions";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import {
  clearRecovery,
  saveChunk,
  startRecoverySession,
  type RecordingOwner,
} from "@/lib/recording-recovery";
import { useRecordingLock } from "@/components/workspace/use-recording-lock";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { withEmbed } from "@/components/workspace/embed-context";
import { startStudentConsultationFromAudio } from "@/features/consultations/server/audio-actions";
import type { StudentOption } from "@/features/consultations/server/queries";

const KIND = "student-consultation" as const;

/**
 * 녹음/음성 파일로 재원생 상담 생성 → 전사·AI 자동 분석(startStudentConsultationFromAudio).
 * 파일은 consultation-recordings 버킷에 클라이언트 업로드 후 경로만 액션에 전달(meetings 폼 패턴).
 * 녹음은 이 폼이 든 플로팅 창 안에서 진행(별도 브라우저 창 없음) + IndexedDB 크래시 복구 + 녹음 중
 * 창 닫기/탭 새로고침 잠금(useRecordingLock) — 회의록·등록상담 폼과 동일.
 */
function AudioConsultationFormInner({ students, recordingOwner }: { students: StudentOption[]; recordingOwner: RecordingOwner }) {
  const [studentId, setStudentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startBusy] = useTransition();
  const [leaving, setLeaving] = useState(false);
  const busy = pending || leaving;
  const inFrame = useInFrame();
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const student = students.find((s) => s.id === studentId);
  const scope = student ? { ...recordingOwner, recordKey: `student:${student.id}`, label: student.name } : null;
  const recRef = useRef<MediaRecorder | null>(null);
  const attemptRef = useRef<symbol | null>(null);

  useRecordingLock(recording);

  useEffect(() => {
    return () => {
      attemptRef.current = null;
      if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    };
  }, []);

  async function startRec() {
    setError(null);
    if (!scope) return setError("학생을 선택한 뒤 녹음을 시작해 주세요.");
    if (attemptRef.current) return;
    const attempt = Symbol();
    attemptRef.current = attempt;
    recRef.current = null;
    setRecording(true);
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (attemptRef.current !== attempt) { stream.getTracks().forEach((t) => t.stop()); return; }
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      const chunks: Blob[] = [];
      const session = await startRecoverySession(KIND, mime, scope);
      if (attemptRef.current !== attempt) { stream.getTracks().forEach((t) => t.stop()); return; }
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) {
          const idx = chunks.length;
          chunks.push(e.data);
          void saveChunk(session.id, idx, e.data);
        }
      };
      rec.onstop = () => {
        stream?.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mime });
        const recorded = new File([blob], session.fileName!, { type: mime });
        if (attemptRef.current === attempt) { setFile(recorded); setRecoveryId(session.id); }
        // 불상사 대비 디스크 백스톱 — 정지 즉시 다운로드 폴더로 저장(IDB 복구와 별개).
        downloadFile(recorded);
        if (attemptRef.current === attempt) { attemptRef.current = null; setRecording(false); }
      };
      recRef.current = rec;
      rec.start(1000);
      setRecording(true);
    } catch {
      stream?.getTracks().forEach((t) => t.stop());
      if (attemptRef.current !== attempt) return;
      attemptRef.current = null;
      setRecording(false);
      setError("마이크 접근이 거부되었습니다. 음성 파일 업로드를 이용하세요.");
    }
  }
  function stopRec() {
    if (recRef.current?.state === "inactive") return;
    if (recRef.current) recRef.current.stop();
    else { attemptRef.current = null; setRecording(false); }
  }

  function submit() {
    if (!studentId) return setError("학생을 선택해주세요");
    if (!file) return setError("음성 파일을 선택하거나 녹음하세요");
    setError(null);
    startBusy(async () => {
      const ext = (file.name.split(".").pop() || "webm").toLowerCase();
      // .webm 파일은 브라우저 MIME이 video/webm이라 서버 allowCT(audio/*)에 막힘 → audio 폼이라 audio/*로 정규화.
      const ct = file.type.startsWith("audio/") ? file.type : `audio/${ext}`;
      const fdT = new FormData();
      fdT.set("kind", "consultation");
      fdT.set("ext", ext);
      fdT.set("contentType", ct);
      fdT.set("size", String(file.size));
      const tk = await issueAudioUploadTicket(undefined, fdT);
      if (tk?.error || !tk?.ticket) return setError(tk?.error ?? "업로드 준비 실패");
      const objectName = tk.ticket.path;
      try {
        await uploadToTicket(tk.ticket, file);
      } catch (e) {
        return setError(e instanceof Error ? e.message : "업로드 실패");
      }

      const fd = new FormData();
      fd.set("studentId", studentId);
      fd.set("audioPath", objectName);
      fd.set("audioSizeBytes", String(file.size));
      fd.set("consultedAt", new Date().toISOString());
      let res: Awaited<ReturnType<typeof startStudentConsultationFromAudio>>;
      try {
        res = await startStudentConsultationFromAudio(undefined, fd);
      } catch {
        return setError("상담이 저장됐을 수 있습니다. 목록에서 확인해 주세요.");
      }
      if (!res?.id) return setError(res?.error ?? "저장 결과를 확인하지 못했습니다. 목록에서 확인해 주세요.");
      if (recoveryId) await clearRecovery(recoveryId);
      setLeaving(true);
      const dest = `/consultations/${res.id}/edit`;
      window.location.assign(inFrame ? withEmbed(dest) : dest);
    });
  }

  return (
    <>
    <RecordingRecoveryNotice key={studentId} kind={KIND} scope={scope} selectedId={recoveryId}
      disabled={busy || recording} onRestore={(recovered, meta) => { setFile(recovered); setRecoveryId(meta.id); }} />
    <details className="border-border bg-muted/20 rounded-2xl border p-4" inert={leaving}>
      <summary className="text-foreground inline-flex cursor-pointer items-center gap-1.5 text-sm font-bold">
        <Mic className="text-primary size-4" />
        녹음·음성 파일로 작성 (AI 자동 분석)
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-text-dim text-xs">
          학생을 고르고 상담을 녹음하거나 음성 파일을 올리면, 전사 후 AI가 7개 항목으로 분석합니다.
        </p>
        <fieldset className="space-y-1.5" disabled={busy || recording}>
          <span className="text-foreground block text-sm font-medium">학생 *</span>
          <SearchableSelect
            value={studentId}
            onValueChange={(id) => {
              if (busy || recording) return;
              if (id !== studentId) { setFile(null); setRecoveryId(null); }
              setStudentId(id);
            }}
            placeholder="학생 선택..."
            searchPlaceholder="학생 이름 검색..."
            options={students.map((s) => ({
              value: s.id,
              label: s.name,
              hint: s.grade ? `(${s.grade})` : undefined,
            }))}
          />
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          {recording ? (
            <Button type="button" variant="outline" size="sm" onClick={stopRec}>
              <Square className="size-4" />
              녹음 중지
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={startRec} disabled={busy}>
              <Mic className="size-4" />
              녹음 시작
            </Button>
          )}
          <span className="text-text-faint text-xs">또는</span>
          <FilePickerButton
            disabled={busy || recording}
            accept={AUDIO_FILE_ACCEPT}
            file={file}
            onSelect={(f) => {
              setFile(f);
              setRecoveryId(null);
              setError(null);
            }}
            label="음성 파일 선택"
          />
        </div>

        {file ? (
          <p className="text-text-dim text-xs">
            파일 크기 <span className="num">{Math.round(file.size / 1024).toLocaleString("ko-KR")}</span> KB
          </p>
        ) : null}

        {error ? <p className="text-danger text-xs">{error}</p> : null}

        <Button type="button" size="sm" onClick={submit} disabled={busy || recording}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          분석 시작
        </Button>
      </div>
    </details>
    </>
  );
}

/** 녹음·전사 라이선스가 꺼진 지점엔 녹음 칸이 없다(2026-09-30 "꺼지면 흔적 없이") — 서버 경로가 따로 막는다. */
export function AudioConsultationForm(props: Parameters<typeof AudioConsultationFormInner>[0]) {
  return useLicenseOn("meeting_recording") ? <AudioConsultationFormInner {...props} /> : null;
}
