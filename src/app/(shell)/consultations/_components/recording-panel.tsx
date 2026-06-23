"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { AlertTriangle, Loader2, Mic, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  runStudentConsultationAnalysis,
  type RunConsultationAnalysisState,
} from "@/features/consultations/server/audio-actions";
import type {
  ConsultationProcessingStatus,
  StudentConsultationAiReport,
} from "@/features/consultations/server/queries";

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

function AnalyzeBtn({ hasAi }: { hasAi: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
      {hasAi ? "AI 분석 갱신" : "AI 분석"}
    </Button>
  );
}

export function RecordingPanel({
  id,
  processingStatus,
  transcription,
  audioDurationSec,
  processingError,
  aiReport,
  aiGeneratedAt,
}: {
  id: string;
  processingStatus: ConsultationProcessingStatus;
  transcription: string | null;
  audioDurationSec: number | null;
  processingError: string | null;
  aiReport: StudentConsultationAiReport | null;
  aiGeneratedAt: string | null;
}) {
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
    <section className="border-border bg-muted/20 space-y-3 rounded-lg border p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-foreground inline-flex items-center gap-1.5 text-sm font-semibold">
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
          {!inFlight ? (
            <form action={formAction}>
              <input type="hidden" name="id" value={id} />
              <AnalyzeBtn hasAi={!!aiReport} />
            </form>
          ) : null}
        </div>
      </header>

      <p className="text-text-dim text-xs">
        녹음 전사 또는 상담 요약을 바탕으로 AI가 7개 항목으로 분석합니다(명시적으로 누를 때만 실행).
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
          {aiGeneratedAt ? (
            <p className="text-text-faint text-[11px]">
              생성 {new Date(aiGeneratedAt).toLocaleString("ko-KR")}
            </p>
          ) : null}
          <dl className="divide-border bg-card border-border divide-y rounded-md border">
            {SECTIONS.map((s) =>
              aiReport[s.key]?.trim() ? (
                <div key={s.key} className="px-3 py-2">
                  <dt className="text-primary text-[11px] font-semibold">{s.label}</dt>
                  <dd className="text-foreground mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed">
                    {aiReport[s.key]}
                  </dd>
                </div>
              ) : null,
            )}
          </dl>
        </div>
      ) : !inFlight ? (
        <p className="text-text-faint border-border rounded-md border border-dashed px-3 py-4 text-center text-xs">
          아직 AI 분석이 없습니다. {transcription ? "전사를" : "상담 요약을"} 바탕으로 “AI 분석”을 눌러보세요.
        </p>
      ) : null}
    </section>
  );
}
