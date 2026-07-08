"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import type { ConsultationAudioReport } from "@/features/enrollment/server/queries";
import { updateConsultationReportSection } from "@/features/enrollment/server/actions";
import { RichText } from "@/components/rich-text";
import { formatCreatedAt } from "@/lib/utils";

/**
 * 등록상담 AI 분석(텍스트 섹션) — 섹션별 인라인 수정(staff가 인쇄/공유 전 AI 오류 교정).
 * 회의록 ai-report.tsx 패턴을 카드 레이아웃으로. 저장 시 print_payload.audioReport 머지 + 수정자·시각.
 */

type SectionKey = Exclude<keyof ConsultationAudioReport, "extracted">;

const SECTIONS: { key: SectionKey; label: string; emoji: string; list?: boolean }[] = [
  { key: "consultationType", label: "상담 성격", emoji: "🧭" },
  { key: "familyBackground", label: "가정 배경", emoji: "🏠" },
  { key: "parentConcerns", label: "학부모 걱정", emoji: "😟", list: true },
  { key: "parentQuestions", label: "학부모 질문", emoji: "❓", list: true },
  { key: "parentRequests", label: "학부모 요청", emoji: "🙋", list: true },
  { key: "parentSatisfaction", label: "학부모 만족도", emoji: "😊" },
  { key: "studentTraits", label: "학생 특이사항", emoji: "🎒", list: true },
  { key: "teacherResponse", label: "상담자 대응", emoji: "🧑‍🏫", list: true },
  { key: "agreements", label: "합의 사항", emoji: "🤝", list: true },
  { key: "followUps", label: "후속 조치", emoji: "📞", list: true },
  { key: "warnings", label: "주의 신호", emoji: "⚠️", list: true },
];

export function ConsultationReportEditor({
  report: initialReport,
  analysisId,
  consultationId,
  generatedAt,
  editedBy,
  editedAt,
}: {
  report: ConsultationAudioReport;
  analysisId: string;
  consultationId: string;
  generatedAt: string | null;
  editedBy?: string | null;
  editedAt?: string | null;
}) {
  const [report, setReport] = useState(initialReport);
  const [attribution, setAttribution] = useState<{ by: string; at: string } | null>(
    editedBy && editedAt ? { by: editedBy, at: editedAt } : null,
  );
  const [editing, setEditing] = useState<SectionKey | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  function startEdit(key: SectionKey) {
    setError(null);
    setDraft((report[key] as string) ?? "");
    setEditing(key);
  }

  function save(key: SectionKey) {
    setError(null);
    const fd = new FormData();
    fd.append("analysisId", analysisId);
    fd.append("consultationId", consultationId);
    fd.append("key", key);
    fd.append("content", draft);
    startSave(async () => {
      const res = await updateConsultationReportSection(undefined, fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setReport((prev) => ({ ...prev, [key]: draft.trim() }));
      if (res?.editedBy && res?.editedAt) setAttribution({ by: res.editedBy, at: res.editedAt });
      setEditing(null);
    });
  }

  return (
    <section className="space-y-3">
      {/* 상단 "AI 분석" 섹션 제목은 상세 페이지가 제공 — 여기선 생성/수정 시각만(중복 제목 제거). */}
      {attribution || generatedAt ? (
        <div className="flex items-center justify-end gap-2">
          {attribution ? (
            <span className="text-text-faint inline-flex items-center gap-1 text-[11px]">
              <Pencil className="size-3" />
              {attribution.by}님 수정 · {formatCreatedAt(attribution.at)}
            </span>
          ) : generatedAt ? (
            <span className="text-muted-foreground num text-[11px]">{formatCreatedAt(generatedAt)}</span>
          ) : null}
        </div>
      ) : null}

      {SECTIONS.map(({ key, label, emoji, list }) => {
        const body = ((report[key] as string) ?? "").trim();
        const isEditing = editing === key;
        // 비어있고 수정 중도 아니면 카드 생략(원래 패널과 동일하게 깔끔). 수정으로 채우려면 비어도 노출하는 건 아래 placeholder.
        if (!body && !isEditing) return null;
        return (
          <section key={key} className="bg-card border-line group relative rounded-md border p-4">
            <h3 className="text-foreground mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold">
              <span className="text-[15px] leading-none">{emoji}</span>
              {label}
            </h3>
            {isEditing ? (
              <div className="space-y-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={Math.min(14, Math.max(4, draft.split("\n").length + 1))}
                  autoFocus
                  className="border-line bg-background text-foreground focus:ring-primary/40 w-full resize-y rounded-md border px-3 py-2 text-sm leading-relaxed focus:ring-1 focus:outline-none"
                />
                <p className="text-text-faint text-[11px]">
                  줄바꿈·“•”·번호로 항목을 나눌 수 있습니다(인쇄·화면에 그대로 반영).
                </p>
                {error ? <p className="text-danger text-xs">{error}</p> : null}
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    disabled={saving}
                    className="border-line text-text-dim hover:bg-bg-soft inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition"
                  >
                    <X className="size-3.5" /> 취소
                  </button>
                  <button
                    type="button"
                    onClick={() => save(key)}
                    disabled={saving}
                    className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                    저장
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => startEdit(key)}
                  title="이 섹션 수정"
                  className="border-line text-text-faint hover:text-primary hover:bg-bg-soft bg-card/80 absolute top-3 right-3 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] opacity-0 transition group-hover:opacity-100"
                >
                  <Pencil className="size-3" /> 수정
                </button>
                <RichText
                  text={body}
                  bulletize={list}
                  className="text-foreground space-y-1.5 text-sm leading-relaxed"
                />
              </>
            )}
          </section>
        );
      })}
    </section>
  );
}
