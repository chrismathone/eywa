"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import type { ConsultationAudioReport } from "@/features/enrollment/server/queries";
import {
  regenerateConsultationAnalysis,
  updateConsultationReportSection,
} from "@/features/enrollment/server/actions";
import { RichText } from "@/components/rich-text";
import { normalizeAiListText } from "@/features/enrollment/report-normalize";
import { ConversationFlowTree } from "./conversation-flow-tree";
import { formatCreatedAt } from "@/lib/utils";

/**
 * 등록상담 AI 분석 — ijw ReportViewer식 아코디언(접기) + 섹션별 인라인 수정 + 재분석 + TXT 다운로드.
 * 섹션 순서·구성은 ijw 원본과 동일(상담자 대응 = teacherResponse 키 유지). 수형도는 트리로 렌더.
 */

type TextKey = Exclude<keyof ConsultationAudioReport, "extracted" | "conversationFlow">;

const SECTIONS: { key: TextKey; label: string; emoji: string; list?: boolean }[] = [
  { key: "consultationType", label: "상담 성격", emoji: "🧭" },
  { key: "summary", label: "상담 요약", emoji: "📋" },
  { key: "familyBackground", label: "가정 배경/개인 맥락", emoji: "🏠" },
  { key: "parentConcerns", label: "학부모 걱정/불안", emoji: "😟", list: true },
  { key: "parentQuestions", label: "학부모 질문", emoji: "❓", list: true },
  { key: "parentRequests", label: "학부모 요청", emoji: "🙋", list: true },
  { key: "parentSatisfaction", label: "학부모 만족도/감정", emoji: "💭" },
  { key: "studentTraits", label: "학생 특이사항", emoji: "🎒", list: true },
  { key: "teacherResponse", label: "상담자 대응/설명", emoji: "🧑‍🏫", list: true },
  { key: "salesPoints", label: "상담사 세일즈 포인트", emoji: "💼", list: true },
  { key: "agreements", label: "합의 사항", emoji: "🤝", list: true },
  { key: "followUps", label: "후속 조치", emoji: "📞", list: true },
  { key: "warnings", label: "주의 신호", emoji: "⚠️", list: true },
];

const FLOW_KEY = "_conversationFlow";

export function ConsultationReportEditor({
  report: initialReport,
  analysisId,
  consultationId,
  generatedAt,
  editedBy,
  editedAt,
  studentName,
  consultationDate,
  transcript,
}: {
  report: ConsultationAudioReport;
  analysisId: string;
  consultationId: string;
  generatedAt: string | null;
  editedBy?: string | null;
  editedAt?: string | null;
  studentName?: string | null;
  consultationDate?: string | null;
  transcript?: string | null;
}) {
  const [report, setReport] = useState(initialReport);
  const [attribution, setAttribution] = useState<{ by: string; at: string } | null>(
    editedBy && editedAt ? { by: editedBy, at: editedAt } : null,
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<TextKey | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [reanalyzing, startReanalyze] = useTransition();

  // 내용이 있는 섹션만 노출(빈 섹션 숨김).
  const visibleSections = useMemo(
    () => SECTIONS.filter((s) => ((report[s.key] as string) ?? "").trim()),
    [report],
  );
  const hasFlow = !!report.conversationFlow && report.conversationFlow.length > 0;
  const allKeys = useMemo(
    () => [...visibleSections.map((s) => s.key as string), ...(hasFlow ? [FLOW_KEY] : [])],
    [visibleSections, hasFlow],
  );
  const allOpen = expanded.size >= allKeys.length && allKeys.length > 0;

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleAll() {
    setExpanded(allOpen ? new Set() : new Set(allKeys));
  }

  function startEdit(key: TextKey) {
    setError(null);
    const raw = (report[key] as string) ?? "";
    const isList = SECTIONS.find((s) => s.key === key)?.list;
    // 리스트 섹션은 후보정된 텍스트를 편집(저장하면 정리된 형태로 DB에 반영 — 점진 정리).
    setDraft(isList ? normalizeAiListText(raw) : raw);
    setEditing(key);
    setExpanded((prev) => new Set(prev).add(key));
  }

  function save(key: TextKey) {
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

  function reanalyze() {
    if (!window.confirm("녹음 전사를 다시 AI로 분석합니다.\n기존 분석 결과가 새 결과로 덮어씌워집니다. 계속할까요?"))
      return;
    setError(null);
    startReanalyze(async () => {
      const res = await regenerateConsultationAnalysis(consultationId);
      if (res?.error) setError(res.error);
      // 성공 시 액션이 상태를 'analyzing'으로 바꾸고 페이지가 새로고침되며 '분석 중' 스켈레톤으로 전환.
    });
  }

  function downloadTxt() {
    const lines: string[] = [
      "등록상담 AI 분석 보고서",
      "=".repeat(40),
      studentName ? `학생: ${studentName}` : "",
      consultationDate ? `상담일: ${consultationDate}` : "",
      generatedAt ? `생성일: ${formatCreatedAt(generatedAt)}` : "",
      "",
    ];
    for (const s of SECTIONS) {
      const body = ((report[s.key] as string) ?? "").trim();
      if (body) lines.push(`[${s.label}]`, body, "");
    }
    if (transcript?.trim()) {
      lines.push("=".repeat(40), "[원본 음성인식 텍스트]", "", transcript.trim());
    }
    const blob = new Blob([lines.filter((l) => l !== "").join("\n")], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `등록상담분석_${studentName ?? "학생"}_${consultationDate ?? ""}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="space-y-2">
      {/* 헤더: 수정/생성 시각 + 재분석·TXT·모두펼치기 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-text-faint inline-flex items-center gap-1 text-[11px]">
          {attribution ? (
            <>
              <Pencil className="size-3" />
              {attribution.by}님 수정 · {formatCreatedAt(attribution.at)}
            </>
          ) : generatedAt ? (
            <span className="num">{formatCreatedAt(generatedAt)} 생성</span>
          ) : null}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={reanalyze}
            disabled={reanalyzing}
            title="녹음 전사를 다시 분석"
            className="border-line text-text-dim hover:bg-bg-soft inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition disabled:opacity-50"
          >
            {reanalyzing ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            재분석
          </button>
          <button
            type="button"
            onClick={downloadTxt}
            className="border-line text-text-dim hover:bg-bg-soft inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition"
          >
            <Download className="size-3" /> TXT
          </button>
          {allKeys.length > 0 ? (
            <button
              type="button"
              onClick={toggleAll}
              className="text-text-faint hover:text-primary px-1 text-[11px] transition"
            >
              {allOpen ? "모두 접기" : "모두 펼치기"}
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-danger text-xs">{error}</p> : null}

      {/* 아코디언 섹션 */}
      {visibleSections.map(({ key, label, emoji, list }) => {
        const body = ((report[key] as string) ?? "").trim();
        // 리스트 섹션은 후보정. 단일 항목으로 병합되면 bulletize를 꺼 RichText 콤마분할(병합 되돌림)을 피한다.
        const normalized = list ? normalizeAiListText(body) : body;
        const asList = !!list && normalized.includes("\n");
        const isOpen = expanded.has(key);
        const isEditing = editing === key;
        return (
          <div key={key} className="border-line bg-card overflow-hidden rounded-md border">
            <button
              type="button"
              onClick={() => toggle(key)}
              className="hover:bg-bg-soft/60 flex w-full items-center justify-between px-3.5 py-2.5 text-left transition"
            >
              <h3 className="text-foreground flex items-center gap-1.5 text-[13px] font-semibold">
                <span className="text-[15px] leading-none">{emoji}</span>
                {label}
              </h3>
              <div className="flex items-center gap-1">
                {isOpen && !isEditing ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(key);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        startEdit(key);
                      }
                    }}
                    title="이 섹션 수정"
                    className="text-text-faint hover:text-primary hover:bg-bg-soft inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] transition"
                  >
                    <Pencil className="size-3" /> 수정
                  </span>
                ) : null}
                {isOpen ? (
                  <ChevronUp className="text-text-faint size-4" />
                ) : (
                  <ChevronDown className="text-text-faint size-4" />
                )}
              </div>
            </button>
            {isOpen ? (
              <div className="border-line border-t px-3.5 py-3">
                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={Math.min(16, Math.max(4, draft.split("\n").length + 1))}
                      autoFocus
                      className="border-line bg-background text-foreground focus:ring-primary/40 w-full resize-y rounded-md border px-3 py-2 text-sm leading-relaxed focus:ring-1 focus:outline-none"
                    />
                    <p className="text-text-faint text-[11px]">
                      줄바꿈·“- ”·번호로 항목을 나눌 수 있습니다(화면·인쇄에 그대로 반영).
                    </p>
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
                        {saving ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Check className="size-3.5" />
                        )}
                        저장
                      </button>
                    </div>
                  </div>
                ) : (
                  <RichText
                    text={normalized}
                    bulletize={asList}
                    className="text-foreground space-y-1.5 text-sm leading-relaxed"
                  />
                )}
              </div>
            ) : null}
          </div>
        );
      })}

      {/* 상담 흐름 수형도 */}
      {hasFlow ? (
        <div className="border-line bg-card overflow-hidden rounded-md border">
          <button
            type="button"
            onClick={() => toggle(FLOW_KEY)}
            className="hover:bg-bg-soft/60 flex w-full items-center justify-between px-3.5 py-2.5 text-left transition"
          >
            <h3 className="text-foreground flex items-center gap-1.5 text-[13px] font-semibold">
              <span className="text-[15px] leading-none">🌳</span>
              상담 흐름 수형도
            </h3>
            {expanded.has(FLOW_KEY) ? (
              <ChevronUp className="text-text-faint size-4" />
            ) : (
              <ChevronDown className="text-text-faint size-4" />
            )}
          </button>
          {expanded.has(FLOW_KEY) ? (
            <div className="border-line border-t px-3.5 py-3">
              <ConversationFlowTree flow={report.conversationFlow!} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
