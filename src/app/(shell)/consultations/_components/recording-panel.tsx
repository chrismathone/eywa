"use client";

import { useActionState, useEffect } from "react";
import { useLicenseOn } from "@/features/owner/operations-context";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { AlertTriangle, Loader2, Mic, Sparkles } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  runStudentConsultationAnalysis,
  type RunConsultationAnalysisState,
} from "@/features/consultations/server/audio-actions";
import type {
  ConsultationProcessingStatus,
  StudentConsultationAiReport,
} from "@/features/consultations/server/queries";
import { modelDisplayLabel } from "@/lib/ai/model-label";

const SECTIONS: { key: keyof StudentConsultationAiReport; label: string }[] = [
  { key: "summary", label: "요약" },
  { key: "mainTopics", label: "주요 주제" },
  { key: "studentState", label: "학생 상태" },
  { key: "parentConcerns", label: "학부모 걱정·요청" },
  { key: "actionItems", label: "합의·조치" },
  { key: "followUps", label: "후속 조치" },
  { key: "warnings", label: "주의 신호" },
];

const STATUS_LABEL: Record<ConsultationProcessingStatus, string> = {
  idle: "",
  uploaded: "업로드됨",
  transcribing: "음성 인식 중…",
  analyzing: "AI 분석 중…",
  completed: "분석 완료",
  failed: "실패",
};

function AnalyzeBtn({ hasAi, disabled }: { hasAi: boolean; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      disabled={pending || disabled}
      // 왜 못 누르는지 말한다 — 회색 버튼만 두면 고장으로 읽힌다.
      title={disabled ? "녹음 전사가 있어야 AI 분석을 할 수 있습니다" : undefined}
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
      {hasAi ? "AI 분석 갱신" : "AI 분석"}
    </Button>
  );
}

function RecordingPanelInner({
  id,
  processingStatus,
  transcription,
  audioDurationSec,
  processingError,
  aiReport,
  aiGeneratedAt,
  aiModelVersion,
  canAnalyze = true,
}: {
  id: string;
  processingStatus: ConsultationProcessingStatus;
  transcription: string | null;
  audioDurationSec: number | null;
  processingError: string | null;
  aiReport: StudentConsultationAiReport | null;
  aiGeneratedAt: string | null;
  aiModelVersion?: string | null;
  /**
   * 'AI 분석' 단추를 그리나 — 원생상담 읽기 권한이면 false(서버 `runStudentConsultationAnalysis`와 같은 쓰기 판정을 page가 계산).
   * 전사·분석 결과는 그대로 읽는다. 기본값은 종전 동작(단추 있음).
   */
  canAnalyze?: boolean;
}) {
  const modelLabel = modelDisplayLabel(aiModelVersion);
  const router = useRouter();
  const [state, formAction] = useActionState<RunConsultationAnalysisState, FormData>(
    runStudentConsultationAnalysis,
    undefined,
  );

  // 처리 중이면 폴링(웹훅은 클라에 push 못 함). 완료/실패면 멈춤.
  const inFlight = processingStatus === "transcribing" || processingStatus === "analyzing";
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [inFlight, router]);

  // 분석 성공 시 갱신.
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <section className="border-border bg-muted/20 space-y-3 rounded-2xl border p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-foreground inline-flex items-center gap-1.5 text-sm font-bold">
          <Mic className="text-primary size-4" />
          상담 녹음 · AI 분석
        </h2>
        <div className="flex items-center gap-2">
          {inFlight ? (
            <span className="text-primary inline-flex items-center gap-1 text-xs">
              <Loader2 className="size-3 animate-spin" />
              {STATUS_LABEL[processingStatus]}
            </span>
          ) : null}
          {!inFlight && canAnalyze ? (
            <form action={formAction}>
              <input type="hidden" name="id" value={id} />
              {/* 🔴 전사가 없으면 누를 수 없다 — 서버도 같은 조건으로 거절한다([[#77]] 화면만 잠그지 않기). */}
              <AnalyzeBtn hasAi={!!aiReport} disabled={!transcription} />
            </form>
          ) : null}
        </div>
      </header>

      <p className="text-text-dim text-xs">
        {/* 원장 2026-09-09: AI 분석은 녹음에만 — 상담 요약(사람이 쓴 글)으로는 돌리지 않는다. */}
        녹음 전사를 바탕으로 AI가 7개 항목으로 분석합니다(명시적으로 누를 때만 실행).
        {audioDurationSec ? ` · 녹음 ${Math.round(audioDurationSec / 60)}분` : ""}
      </p>

      {processingStatus === "failed" && processingError ? (
        <p className="text-danger inline-flex items-center gap-1.5 text-xs">
          <AlertTriangle className="size-3.5" />
          {processingError}
        </p>
      ) : null}
      {state?.error ? (
        <p className="text-danger inline-flex items-center gap-1.5 text-xs">
          <AlertTriangle className="size-3.5" />
          {state.error}
        </p>
      ) : null}

      {transcription ? (
        <details className="text-sm">
          <summary className="text-text-dim cursor-pointer text-xs">전사 보기</summary>
          <p className="text-foreground bg-card border-border mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border p-3 text-xs leading-relaxed">
            {transcription}
          </p>
        </details>
      ) : null}

      {aiReport ? (
        <div className="space-y-2">
          {aiGeneratedAt || modelLabel ? (
            <p className="text-text-faint inline-flex items-center gap-1.5 text-xs">
              {aiGeneratedAt
                ? `생성 ${new Date(aiGeneratedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`
                : null}
              {modelLabel ? (
                <span
                  className="border-line inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs"
                  title="이 분석을 생성한 AI 모델"
                >
                  <Sparkles className="size-2.5" />
                  {modelLabel}
                </span>
              ) : null}
            </p>
          ) : null}
          <dl className="divide-border bg-card border-border divide-y rounded-md border">
            {SECTIONS.map((s) =>
              aiReport[s.key]?.trim() ? (
                <div key={s.key} className="px-3 py-2">
                  <dt className="text-primary text-xs font-bold">{s.label}</dt>
                  <dd className="text-foreground mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">
                    {aiReport[s.key]}
                  </dd>
                </div>
              ) : null,
            )}
          </dl>
        </div>
      ) : !inFlight ? (
        <p className="text-text-faint border-border rounded-md border border-dashed px-3 py-4 text-center text-xs">
          {transcription
            ? "아직 AI 분석이 없습니다. 전사를 바탕으로 “AI 분석”을 눌러보세요."
            : "녹음이 없어 AI 분석을 할 수 없습니다 — 녹음을 올리면 전사 후 분석할 수 있습니다."}
        </p>
      ) : null}
    </section>
  );
}

/** 녹음·전사 라이선스가 꺼진 지점엔 녹음 칸이 없다(2026-09-30 "꺼지면 흔적 없이") — 서버 경로가 따로 막는다. */
export function RecordingPanel(props: Parameters<typeof RecordingPanelInner>[0]) {
  return useLicenseOn("meeting_recording") ? <RecordingPanelInner {...props} /> : null;
}
