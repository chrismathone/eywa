"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Mic, Square, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { createClient } from "@/lib/supabase/client";
import { startStudentConsultationFromAudio } from "@/features/consultations/server/audio-actions";
import type { StudentOption } from "@/features/consultations/server/queries";

/**
 * 녹음/음성 파일로 재원생 상담 생성 → 전사·AI 자동 분석(startStudentConsultationFromAudio).
 * 파일은 consultation-recordings 버킷에 클라이언트 업로드 후 경로만 액션에 전달(meetings 폼 패턴).
 * ⚠️ 전사 완료는 공용 웹훅이 처리 — 로컬(localhost)에선 AssemblyAI 콜백 미도달.
 */
export function AudioConsultationForm({ students }: { students: StudentOption[] }) {
  const [studentId, setStudentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function startRec() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        setFile(new File([blob], `상담녹음_${Date.now()}.webm`, { type: mime }));
        setRecording(false);
      };
      recRef.current = rec;
      rec.start();
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
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const tenantId = (user?.app_metadata as { tenant_id?: string } | undefined)?.tenant_id;
      if (!tenantId) return setError("세션 정보를 확인할 수 없습니다");

      const ext = (file.name.split(".").pop() || "webm").toLowerCase();
      const objectName = `${tenantId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("consultation-recordings")
        .upload(objectName, file, { contentType: file.type || `audio/${ext}`, upsert: false });
      if (upErr) return setError(`업로드 실패: ${upErr.message}`);

      const fd = new FormData();
      fd.set("studentId", studentId);
      fd.set("audioPath", objectName);
      fd.set("audioSizeBytes", String(file.size));
      fd.set("consultedAt", new Date().toISOString());
      const res = await startStudentConsultationFromAudio(undefined, fd);
      if (res?.error) setError(res.error); // 성공 시 서버 redirect가 이동 처리
    });
  }

  return (
    <details className="border-border bg-muted/20 rounded-lg border p-4">
      <summary className="text-foreground inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold">
        <Mic className="text-primary size-4" />
        녹음·음성 파일로 작성 (AI 자동 분석)
      </summary>
      <div className="mt-3 space-y-3">
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
