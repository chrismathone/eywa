"use client";

import { useMemo, useState, useTransition } from "react";
import { useLicenseOn } from "@/features/owner/operations-context";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Pencil,
  RefreshCw,
  X,
} from "@/components/icons/aywa-icon-compat";
import type { ConsultationAudioReport } from "@/features/enrollment/server/queries";
import {
  regenerateConsultationAnalysis,
  updateConsultationReportSection,
} from "@/features/enrollment/server/actions";
import { RichText } from "@/components/rich-text";
import { normalizeAiListText } from "@/features/enrollment/report-normalize";
import { ConversationFlowTree } from "./conversation-flow-tree";
import { formatCreatedAt } from "@/lib/utils";
import { modelDisplayLabel } from "@/lib/ai/model-label";
import { EyIcon, type AywaIconName } from "@/components/icons/aywa-icons";
import { useStateDraft } from "@/components/forms/use-state-draft";
import { DraftBanner } from "@/components/forms/draft-banner";

/**
 * 등록상담 AI 분석 — ijw ReportViewer식 아코디언(접기) + 섹션별 인라인 수정 + 다시 분석 + 텍스트 저장.
 * 섹션 순서·구성은 ijw 원본과 동일(상담자 대응 = teacherResponse 키 유지). 수형도는 트리로 렌더.
 * 🔴 읽기 권한(`canWrite=false`)이면 '다시 분석'·섹션 '수정'과 섹션 초안 복구를 그리지 않는다 — 펼쳐 읽기·텍스트 저장만 남는다
 *    (원장 2026-11-05 · write-lock.ts). 판정은 페이지가 서버 게이트와 같은 `canWriteTenant(…,"enrollment")`로 내려 준다.
 */

type TextKey = Exclude<keyof ConsultationAudioReport, "extracted" | "conversationFlow">;

const SECTIONS: { key: TextKey; label: string; icon: AywaIconName; list?: boolean }[] = [
  { key: "consultationType", label: "상담 성격", icon: "messages" },
  { key: "summary", label: "상담 요약", icon: "report" },
  { key: "familyBackground", label: "가정 배경/개인 맥락", icon: "home" },
  { key: "parentConcerns", label: "학부모 걱정/불안", icon: "alertCircle", list: true },
  { key: "parentQuestions", label: "학부모 질문", icon: "help", list: true },
  { key: "parentRequests", label: "학부모 요청", icon: "messagePlus", list: true },
  { key: "parentSatisfaction", label: "학부모 만족도/감정", icon: "message" },
  { key: "studentTraits", label: "학생 특이사항", icon: "user", list: true },
  { key: "teacherResponse", label: "상담자 대응/설명", icon: "userCheck", list: true },
  { key: "salesPoints", label: "상담사 세일즈 포인트", icon: "target", list: true },
  { key: "agreements", label: "합의 사항", icon: "clipboardCheck", list: true },
  { key: "followUps", label: "후속 조치", icon: "history", list: true },
  { key: "warnings", label: "주의 신호", icon: "alert", list: true },
];

const FLOW_KEY = "_conversationFlow";

export function ConsultationReportEditor({
  report: initialReport,
  analysisId,
  consultationId,
  generatedAt,
  modelVersion,
  editedBy,
  editedAt,
  studentName,
  consultationDate,
  transcript,
  canWrite = true,
}: {
  report: ConsultationAudioReport;
  analysisId: string;
  consultationId: string;
  generatedAt: string | null;
  modelVersion?: string | null;
  editedBy?: string | null;
  editedAt?: string | null;
  studentName?: string | null;
  consultationDate?: string | null;
  transcript?: string | null;
  canWrite?: boolean;
}) {
  const aiOn = useLicenseOn("ai_analysis"); // 꺼진 지점엔 '다시 분석'이 없다(2026-09-30 "꺼지면 흔적 없이")
  const [report, setReport] = useState(initialReport);
  const [attribution, setAttribution] = useState<{ by: string; at: string } | null>(
    editedBy && editedAt ? { by: editedBy, at: editedAt } : null,
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<TextKey | null>(null);
  const [draft, setDraft] = useState("");
  // 편집 시작 시점의 원문(후보정 후) — 초안에 함께 저장해, 복구 시 원문이 바뀌었으면(재분석·동료 수정) 폐기 판정.
  const [editBase, setEditBase] = useState("");
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
  // 이 분석을 생성한 AI 모델의 짧은 라벨(원시 id 아님). 모델을 번갈아 쓰므로 직원이 확인 가능하게 노출.
  const modelLabel = modelDisplayLabel(modelVersion);

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

  // 편집 시작 시 textarea에 들어가는 초기값 — 리스트 섹션은 후보정된 텍스트를 편집(저장하면 정리된 형태로
  // DB에 반영, 점진 정리). 로컬 초안의 "수정됐나" 판정도 같은 기준을 쓴다(열자마자 초안 오탐 방지).
  function editSeed(key: TextKey): string {
    const raw = (report[key] as string) ?? "";
    return SECTIONS.find((s) => s.key === key)?.list ? normalizeAiListText(raw) : raw;
  }

  // 섹션 인라인 수정 로컬 초안 — 저장 전 새로고침으로 교정 내용이 날아가는 것 방지(저장 성공·취소 시 삭제).
  // ⚠️ 재분석은 같은 분석 행을 **제자리 update**한다(actions.ts) — id가 안 바뀌므로 초안에 원문(base)을
  // 함께 저장해 복구 시 비교하고, 바뀌었으면(재분석·동료 수정) 옛 초안으로 덮지 않고 폐기한다.
  const draftSnapshot = useMemo(() => ({ editing, draft, base: editBase }), [editing, draft, editBase]);
  const localDraft = useStateDraft({
    scope: `enrollment-report:${analysisId}`,
    snapshot: draftSnapshot,
    hasContent: (s) => s.editing !== null && s.draft.trim() !== s.base.trim(),
  });

  function restoreSectionDraft() {
    const d = localDraft.restore();
    if (!d?.editing) return;
    // 원문 불일치(재분석·동료 수정·섹션 비워짐) = 폐기 + 안내. 비워진 섹션은 편집 카드도 렌더되지 않는다.
    if (editSeed(d.editing).trim() !== (d.base ?? "").trim()) {
      localDraft.discard();
      setError("이어 쓰려던 섹션의 원문이 그 사이 바뀌어 초안을 폐기했습니다 — 현재 내용을 확인해 주세요.");
      return;
    }
    setError(null);
    setEditBase(d.base ?? "");
    setDraft(d.draft);
    setEditing(d.editing);
    setExpanded((prev) => new Set(prev).add(d.editing!));
  }

  function startEdit(key: TextKey) {
    setError(null);
    const seed = editSeed(key);
    setDraft(seed);
    setEditBase(seed);
    setEditing(key);
    setExpanded((prev) => new Set(prev).add(key));
  }

  // 취소 = 명시적 폐기 — 초안을 남기면 다음 열기에 버린 텍스트가 배너로 되살아난다(리뷰 지적).
  function cancelEdit() {
    localDraft.clear();
    setEditing(null);
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
      localDraft.clear();
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
      "신규 콜&상담 AI 분석 보고서",
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
    // 파일 이름엔 `&`를 쓰지 않는다(일부 OS·메신저가 이름을 자르거나 바꾼다) — '콜앤상담'.
    a.download = `콜앤상담분석_${studentName ?? "학생"}_${consultationDate ?? ""}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="space-y-2">
      <DraftBanner
        savedAt={canWrite ? localDraft.draftSavedAt : null}
        onRestore={restoreSectionDraft}
        onDiscard={localDraft.discard}
      />
      {/* 헤더: 수정/생성 시각 + 다시 분석·텍스트 저장·모두펼치기 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-text-faint inline-flex items-center gap-1 text-xs">
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
          {aiOn && canWrite ? (
          <button
            type="button"
            onClick={reanalyze}
            disabled={reanalyzing}
            title="녹음 전사를 다시 분석"
            className="border-line text-text-dim hover:bg-bg-soft inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition disabled:opacity-50"
          >
            {reanalyzing ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            다시 분석
          </button>
          ) : null}
          <button
            type="button"
            onClick={downloadTxt}
            className="border-line text-text-dim hover:bg-bg-soft inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition"
          >
            <Download className="size-3" /> 텍스트 저장
          </button>
          {modelLabel ? (
            <span
              className="border-line text-text-faint inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs"
              title="이 분석을 생성한 AI 모델"
            >
              <EyIcon name="sparkle" size={10} />
              {modelLabel}
            </span>
          ) : null}
          {allKeys.length > 0 ? (
            <button
              type="button"
              onClick={toggleAll}
              className="text-text-faint hover:text-primary px-1 text-xs transition"
            >
              {allOpen ? "모두 접기" : "모두 펼치기"}
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-danger text-xs">{error}</p> : null}

      {/* 아코디언 섹션 */}
      {visibleSections.map(({ key, label, icon, list }) => {
        const body = ((report[key] as string) ?? "").trim();
        // 리스트 섹션은 후보정. 단일 항목으로 병합되면 bulletize를 꺼 RichText 콤마분할(병합 되돌림)을 피한다.
        const normalized = list ? normalizeAiListText(body) : body;
        const asList = !!list && normalized.includes("\n");
        const isOpen = expanded.has(key);
        const isEditing = canWrite && editing === key;
        return (
          <div key={key} className="border-line bg-card overflow-hidden rounded-2xl border">
            <button
              type="button"
              onClick={() => toggle(key)}
              className="hover:bg-bg-soft/60 flex w-full items-center justify-between px-3.5 py-2.5 text-left transition"
            >
              <h3 className="text-foreground flex items-center gap-1.5 text-sm font-bold">
                <EyIcon name={icon} size={15} />
                {label}
              </h3>
              <div className="flex items-center gap-1">
                {isOpen && !isEditing && canWrite ? (
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
                    className="text-text-faint hover:text-primary hover:bg-bg-soft inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs transition"
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
                    <p className="text-text-faint text-xs">
                      줄바꿈·“- ”·번호로 항목을 나눌 수 있습니다(화면·인쇄에 그대로 반영).
                    </p>
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={saving}
                        className="border-line text-text-dim hover:bg-bg-soft inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs transition"
                      >
                        <X className="size-3.5" /> 취소
                      </button>
                      <button
                        type="button"
                        onClick={() => save(key)}
                        disabled={saving}
                        className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition disabled:opacity-50"
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
        <div className="border-line bg-card overflow-hidden rounded-2xl border">
          <button
            type="button"
            onClick={() => toggle(FLOW_KEY)}
            className="hover:bg-bg-soft/60 flex w-full items-center justify-between px-3.5 py-2.5 text-left transition"
          >
            <h3 className="text-foreground flex items-center gap-1.5 text-sm font-bold">
              <EyIcon name="layers" size={15} />
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
