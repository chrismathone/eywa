"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLicenseOn } from "@/features/owner/operations-context";
import { Loader2, Mic, Upload } from "@/components/icons/aywa-icon-compat";
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
import { useMicrophone } from "@/components/forms/use-microphone";
import { RecordingSessionControls } from "@/components/forms/recording-session-controls";
import { startBrowserRecording, dismissBrowserRecording } from "@/lib/browser-recording";
import { documentHasLiveRecording, recordingReturnHref } from "@/lib/recording-resume";
import { SavedStayNotice } from "@/components/forms/saved-stay-notice";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { withEmbed } from "@/components/workspace/embed-context";
import { startStudentConsultationFromAudio } from "@/features/consultations/server/audio-actions";
import type { StudentOption } from "@/features/consultations/server/queries";

const KIND = "student-consultation" as const;
/** 떠나기가 이만큼 지나도 끝나지 않으면 상담으로 가는 길을 직접 보인다(회의록 폼과 같은 값). */
const LEAVE_FALLBACK_MS = 5000;

/**
 * 녹음/음성 파일로 재원생 상담 생성 → 전사·AI 자동 분석(startStudentConsultationFromAudio).
 * 파일은 consultation-recordings 버킷에 클라이언트 업로드 후 경로만 액션에 전달(meetings 폼 패턴).
 * 공용 문서 녹음이 폼의 수명과 별개로 유지된다. 귀속은 시작할 때 고정하고, 같은 학생의 중복 시작은 잠금으로 막는다.
 * 다른 학생·다른 화면의 녹음과는 함께 켜 둘 수 있다 — 소리를 담는 것은 하나, 나머지는 일시정지(원장 2026-10-16).
 * `initialStudentId` = 녹음 아이콘의 '작성 화면 열기'로 돌아온 학생(`recordStudent`) — 그 학생을 고른 채 녹음 칸을 펼친다.
 * IndexedDB 복구와 탭 이탈 경고는 회의록·등록상담 폼과 동일.
 */
function AudioConsultationFormInner({ students, recordingOwner, initialStudentId }: {
  students: StudentOption[];
  recordingOwner: RecordingOwner;
  initialStudentId?: string;
}) {
  const [studentId, setStudentId] = useState(() => (initialStudentId && students.some((s) => s.id === initialStudentId) ? initialStudentId : ""));
  // 녹음 아이콘이 가리킨 학생이 목록에 없다(퇴원·담당 범위 변경) — 녹음을 다시 붙일 수 없으니 아이콘에서 끝내고 파일로 남기게 알린다.
  const missingStudent = !!initialStudentId && !students.some((s) => s.id === initialStudentId);
  /** 저장했지만 이 문서의 다른 녹음 때문에 머문다 — 상담으로 가는 링크(SavedStayNotice). */
  const [stayHref, setStayHref] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startBusy] = useTransition();
  const [leaving, setLeaving] = useState(false);
  /** 저장 뒤 갈 곳 — 커밋 뒤 효과에서 문서 이동을 건다(아래). */
  const [leaveHref, setLeaveHref] = useState<string | null>(null);
  /** 이동이 끝나지 않았을 때 보일 상담 링크(LEAVE_FALLBACK_MS 뒤에만). */
  const [stalledHref, setStalledHref] = useState<string | null>(null);
  const busy = pending || leaving;
  const inFrame = useInFrame();
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const student = students.find((s) => s.id === studentId);
  const scope = student ? { ...recordingOwner, recordKey: `student:${student.id}`, label: student.name } : null;
  const recorded = useBrowserRecording(KIND, scope, (f, id) => { setFile(f); setRecoveryId(id); });
  const microphone = useMicrophone();
  const recording = recorded.recording;
  // 녹음이 붙어 있으면(녹음 중·일시정지 — '작성 화면 열기'로 돌아온 화면 포함) 접힌 칸을 펼쳐 바로 보이게 한다.
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (recording && detailsRef.current) detailsRef.current.open = true;
  }, [recording]);

  // 저장 뒤 상세로 — 🔴 액션 콜백 안에서 바로 `location.assign`을 걸면, 곧이어 커밋되는 액션 응답(재검증)이 주소를 다시 적으면서
  //    그 이동이 취소될 수 있다 — 상담은 만들어졌는데 '분석 시작'이 영영 돌고, 이전 화면 유지 방식에선 다시 열어도 그 화면이 그대로였다
  //    (2026-11-09 같은 녹음으로 세 번 저장됨). 그래서 커밋 뒤에 걸고, 그래도 안 넘어가면 잠시 뒤 상담 링크와 '새로 작성'을 보인다.
  //    버튼은 다시 열지 않는다 — 다시 누르면 같은 상담이 하나 더 생긴다(전사·분석 비용도 두 번).
  useEffect(() => {
    if (!leaveHref) return;
    window.location.assign(leaveHref);
    let timer: number | null = window.setTimeout(() => setStalledHref(leaveHref), LEAVE_FALLBACK_MS);
    const onHide = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    // 뒤로가기로 이 화면이 되살아났다(bfcache) — 이동은 끝났다. 바로 링크를 보인다(안 그러면 다시 돌기만 한다).
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setStalledHref(leaveHref);
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", onShow);
    return () => {
      onHide();
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", onShow);
    };
  }, [leaveHref]);

  async function startRec() {
    setError(null);
    if (!scope || !student) return setError("학생을 선택한 뒤 녹음을 시작해 주세요.");
    // 돌아올 곳 = 지금 작성 화면 + 그 학생 — '작성 화면 열기'가 학생을 고른 채 다시 연다(recording-resume.ts).
    const err = await startBrowserRecording(KIND, scope, { href: recordingReturnHref({ recordStudent: student.id }) });
    if (err) setError(err);
  }

  function submit() {
    if (recording) return setError("녹음을 끝낸 뒤 저장해 주세요.");
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
      if (recoveryId) { await clearRecovery(recoveryId); dismissBrowserRecording({ recoveryId: recoveryId }); }
      setLeaving(true);
      const path = `/consultations/${res.id}/edit`;
      const dest = inFrame ? withEmbed(path) : path;
      // 이 문서에 다른 녹음이 살아 있으면 떠나지 않는다 — 문서가 내려가면 그 녹음이 끝난다(단일 화면에서 여러 녹음).
      if (documentHasLiveRecording()) setStayHref(dest);
      else setLeaveHref(dest);
    });
  }

  return (
    <>
    <RecordingRecoveryNotice key={studentId} kind={KIND} scope={scope} selectedId={recoveryId ?? recorded.activeRecoveryId}
      disabled={busy || recording} onRestore={(recovered, meta) => { setFile(recovered); setRecoveryId(meta.id); }} />
    <details ref={detailsRef} open={initialStudentId ? true : undefined} className="border-border bg-muted/20 rounded-2xl border p-4" inert={leaving}>
      <summary className="text-foreground inline-flex cursor-pointer items-center gap-1.5 text-sm font-bold">
        <Mic className="text-primary size-4" />
        녹음·음성 파일로 작성 (AI 자동 분석)
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-text-dim text-xs">
          학생을 고르고 상담을 녹음하거나 음성 파일을 올리면, 전사 후 AI가 7개 항목으로 분석합니다.
        </p>
        {missingStudent ? (
          <p role="alert" className="text-danger text-xs">녹음한 학생을 목록에서 찾을 수 없습니다. 녹음 아이콘에서 녹음을 끝낸 뒤 파일을 저장해 주세요.</p>
        ) : null}
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

        {recording ? <RecordingSessionControls status={recorded.status} seconds={recorded.seconds}
          onPause={recorded.pause} onResume={recorded.resume} onStop={recorded.stop} /> : null}
        <div className="flex flex-wrap items-center gap-2">
          {recording ? null : (
            <Button type="button" variant="outline" size="sm" onClick={startRec} disabled={busy || recorded.elsewhere || !microphone.available}>
              <Mic className="size-4" />
              {microphone.available ? "녹음 시작" : microphone.message}
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
        {recorded.elsewhere ? <p className="text-text-dim text-xs">이 학생은 다른 창이나 탭에서 녹음하고 있습니다.</p> : null}
        {!recording && recorded.othersRecording ? <p className="text-text-dim text-xs">녹음을 시작하면 지금 녹음 중인 다른 녹음은 일시정지됩니다.</p> : null}

        {file ? (
          <p className="text-text-dim text-xs">
            파일 크기 <span className="num">{Math.round(file.size / 1024).toLocaleString("ko-KR")}</span> KB
          </p>
        ) : null}

        {(error || recorded.error) ? <p className="text-danger text-xs">{error || recorded.error}</p> : null}

        <Button type="button" size="sm" onClick={submit} disabled={busy || recording}>
          {busy && !stalledHref && !stayHref ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {stalledHref || stayHref ? "저장됨" : "분석 시작"}
        </Button>
        {stalledHref ? (
          <p role="status" className="border-border bg-muted/30 text-foreground rounded-md border px-3 py-2 text-sm">
            상담을 저장했습니다. 화면이 넘어가지 않으면{" "}
            <a href={stalledHref} className="font-medium underline underline-offset-2">상담 열기</a>
            {" · "}
            <button type="button" onClick={() => window.location.reload()} className="font-medium underline underline-offset-2">새로 작성</button>
          </p>
        ) : null}
      </div>
    </details>
    {stayHref ? <SavedStayNotice href={stayHref} saved="상담을 저장했습니다." /> : null}
    </>
  );
}

/** 녹음·전사 라이선스가 꺼진 지점엔 녹음 칸이 없다(2026-09-30 "꺼지면 흔적 없이") — 서버 경로가 따로 막는다. */
export function AudioConsultationForm(props: Parameters<typeof AudioConsultationFormInner>[0]) {
  return useLicenseOn("meeting_recording") ? <AudioConsultationFormInner {...props} /> : null;
}
