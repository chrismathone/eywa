"use client";

import { useState, useTransition } from "react";
import { useLicenseOn } from "@/features/owner/operations-context";
import { Loader2, Mic, Square, Upload } from "@/components/icons/aywa-icon-compat";
import { RecordingRecoveryNotice } from "@/components/forms/recording-recovery-notice";
import { Button } from "@/components/ui/button";
import { FilePickerButton } from "@/components/ui/file-picker-button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { AUDIO_FILE_ACCEPT } from "@/lib/audio-upload";
import { issueAudioUploadTicket } from "@/features/media/server/upload-actions";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import {
  clearRecovery,
  type RecordingOwner,
} from "@/lib/recording-recovery";
import { useBrowserRecording } from "@/components/forms/use-browser-recording";
import { startBrowserRecording, stopBrowserRecording, dismissBrowserRecording } from "@/lib/browser-recording";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { withEmbed } from "@/components/workspace/embed-context";
import { startStudentConsultationFromAudio } from "@/features/consultations/server/audio-actions";
import type { StudentOption } from "@/features/consultations/server/queries";

const KIND = "student-consultation" as const;

/**
 * 녹음/음성 파일로 재원생 상담 생성 → 전사·AI 자동 분석(startStudentConsultationFromAudio).
 * 파일은 consultation-recordings 버킷에 클라이언트 업로드 후 경로만 액션에 전달(meetings 폼 패턴).
 * 공용 문서 녹음이 폼의 수명과 별개로 유지된다. 귀속은 시작할 때 고정하고, 모든 창·탭의 중복 시작은 잠금으로 막는다.
 * IndexedDB 복구와 탭 이탈 경고는 회의록·등록상담 폼과 동일.
 */
function AudioConsultationFormInner({ students, recordingOwner }: { students: StudentOption[]; recordingOwner: RecordingOwner }) {
  const [studentId, setStudentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startBusy] = useTransition();
  const [leaving, setLeaving] = useState(false);
  const busy = pending || leaving;
  const inFrame = useInFrame();
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const student = students.find((s) => s.id === studentId);
  const scope = student ? { ...recordingOwner, recordKey: `student:${student.id}`, label: student.name } : null;
  const recorded = useBrowserRecording(KIND, scope, (f, id) => { setFile(f); setRecoveryId(id); });
  const recording = recorded.recording;

  async function startRec() {
    setError(null);
    if (!scope) return setError("학생을 선택한 뒤 녹음을 시작해 주세요.");
    const err = await startBrowserRecording(KIND, scope);
    if (err) setError(err);
  }
  function stopRec() { stopBrowserRecording(recorded.requestId); }

  function submit() {
    if (recording) return setError("녹음을 중지한 뒤 저장해 주세요.");
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
      if (recoveryId) { await clearRecovery(recoveryId); dismissBrowserRecording(recoveryId); }
      setLeaving(true);
      const dest = `/consultations/${res.id}/edit`;
      window.location.assign(inFrame ? withEmbed(dest) : dest);
    });
  }

  return (
    <>
    <RecordingRecoveryNotice key={studentId} kind={KIND} scope={scope} selectedId={recoveryId ?? recorded.activeRecoveryId}
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
            <Button type="button" variant="outline" size="sm" onClick={startRec} disabled={busy || recorded.otherRecording}>
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
        {recorded.otherRecording ? <p className="text-text-dim text-xs">다른 화면에서 녹음 중입니다. 진행 중인 녹음을 먼저 중지해 주세요.</p> : null}

        {file ? (
          <p className="text-text-dim text-xs">
            파일 크기 <span className="num">{Math.round(file.size / 1024).toLocaleString("ko-KR")}</span> KB
          </p>
        ) : null}

        {(error || recorded.error) ? <p className="text-danger text-xs">{error || recorded.error}</p> : null}

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
