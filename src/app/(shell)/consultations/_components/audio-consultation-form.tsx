"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { History, Loader2, Mic, Square, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { downloadFile, kstTimestamp } from "@/lib/audio-upload";
import { issueAudioUploadTicket } from "@/features/media/server/upload-actions";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import {
  checkRecovery,
  clearRecovery,
  recoverRecording,
  saveChunk,
  startRecoverySession,
  type RecordingMeta,
} from "@/lib/recording-recovery";
import { useRecordingLock } from "@/components/workspace/use-recording-lock";
import { startStudentConsultationFromAudio } from "@/features/consultations/server/audio-actions";
import type { StudentOption } from "@/features/consultations/server/queries";

const KIND = "student-consultation" as const;

/**
 * 녹음/음성 파일로 재원생 상담 생성 → 전사·AI 자동 분석(startStudentConsultationFromAudio).
 * 파일은 consultation-recordings 버킷에 클라이언트 업로드 후 경로만 액션에 전달(meetings 폼 패턴).
 * 녹음은 이 폼이 든 플로팅 창 안에서 진행(별도 브라우저 창 없음) + IndexedDB 크래시 복구 + 녹음 중
 * 창 닫기/탭 새로고침 잠금(useRecordingLock) — 회의록·등록상담 폼과 동일.
 */
export function AudioConsultationForm({ students }: { students: StudentOption[] }) {
  const [studentId, setStudentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const [recoveryMeta, setRecoveryMeta] = useState<RecordingMeta | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useRecordingLock(recording);

  useEffect(() => {
    let cancelled = false;
    checkRecovery(KIND).then((meta) => {
      if (!cancelled) setRecoveryMeta(meta);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    };
  }, []);

  async function handleRecover() {
    const recovered = await recoverRecording(KIND);
    if (recovered) {
      setFile(recovered);
      setRecoveryMeta(null);
      await clearRecovery(KIND);
    }
  }
  async function handleDiscardRecovery() {
    await clearRecovery(KIND);
    setRecoveryMeta(null);
  }

  async function startRec() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      await startRecoverySession(KIND, mime).catch(() => {});
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) {
          const idx = chunksRef.current.length;
          chunksRef.current.push(e.data);
          void saveChunk(KIND, idx, e.data);
        }
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        const recorded = new File([blob], `상담녹음_${kstTimestamp()}.webm`, { type: mime });
        setFile(recorded);
        // 불상사 대비 디스크 백스톱 — 정지 즉시 다운로드 폴더로 저장(IDB 복구와 별개).
        downloadFile(recorded);
        setRecording(false);
      };
      recRef.current = rec;
      rec.start(1000);
      setRecording(true);
    } catch {
      setError("마이크 접근이 거부되었습니다. 음성 파일 업로드를 이용하세요.");
    }
  }
  function stopRec() {
    recRef.current?.stop();
  }

  function submit() {
    if (!studentId) return setError("학생을 선택해주세요");
    if (!file) return setError("음성 파일을 선택하거나 녹음하세요");
    setError(null);
    startBusy(async () => {
      const ext = (file.name.split(".").pop() || "webm").toLowerCase();
      const fdT = new FormData();
      fdT.set("kind", "consultation");
      fdT.set("ext", ext);
      fdT.set("contentType", file.type || `audio/${ext}`);
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
      const res = await startStudentConsultationFromAudio(undefined, fd);
      if (res?.error) return setError(res.error); // 성공 시 서버 redirect가 이동 처리
      await clearRecovery(KIND);
    });
  }

  return (
    <details className="border-border bg-muted/20 rounded-lg border p-4">
      <summary className="text-foreground inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold">
        <Mic className="text-primary size-4" />
        녹음·음성 파일로 작성 (AI 자동 분석)
      </summary>
      <div className="mt-3 space-y-3">
        {recoveryMeta ? (
          <div className="border-chart-3/40 bg-chart-3/5 flex items-start gap-3 rounded-md border px-3 py-2.5">
            <History className="text-chart-3 mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-foreground text-sm font-medium">복구 가능한 녹음이 있습니다</p>
              <p className="text-text-dim text-xs">
                {new Date(recoveryMeta.startedAt).toLocaleString("ko-KR")}에 시작 ·{" "}
                <span className="num">{recoveryMeta.chunkCount}</span>개 청크
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleRecover}
                  className="text-foreground hover:text-chart-3 text-xs font-medium"
                >
                  복구하기
                </button>
                <span className="text-text-faint text-xs">·</span>
                <button
                  type="button"
                  onClick={handleDiscardRecovery}
                  className="text-text-dim hover:text-foreground text-xs"
                >
                  폐기
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <p className="text-text-dim text-xs">
          학생을 고르고 상담을 녹음하거나 음성 파일을 올리면, 전사 후 AI가 7개 항목으로 분석합니다.
        </p>
        <div className="space-y-1.5">
          <span className="text-foreground block text-sm font-medium">학생 *</span>
          <SearchableSelect
            value={studentId}
            onValueChange={setStudentId}
            placeholder="학생 선택..."
            searchPlaceholder="학생 이름 검색..."
            options={students.map((s) => ({
              value: s.id,
              label: s.name,
              hint: s.grade ? `(${s.grade})` : undefined,
            }))}
          />
        </div>

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
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError(null);
            }}
            className="text-text-dim text-[12px]"
          />
        </div>

        {file ? (
          <p className="text-text-dim text-xs">
            선택됨: <span className="text-foreground">{file.name}</span> (
            {Math.round(file.size / 1024)} KB)
          </p>
        ) : null}

        {error ? <p className="text-danger text-xs">{error}</p> : null}

        <Button type="button" size="sm" onClick={submit} disabled={busy || recording}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          분석 시작
        </Button>
      </div>
    </details>
  );
}
