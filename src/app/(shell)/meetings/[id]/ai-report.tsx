"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, ChevronDown, Loader2, Pencil, X } from "@/components/icons/aywa-icon-compat";
import { useStateDraft } from "@/components/forms/use-state-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import type { MeetingReportSection } from "@/features/meetings/server/queries";
import { updateMeetingReportSection } from "@/features/meetings/server/actions";
import { MEETING_REPORT_SECTION_LABEL } from "@/features/meetings/report-sections";
import { RichText } from "@/components/rich-text";
import { useEditPresence } from "@/features/presence/edit-presence";
import { modelDisplayLabel } from "@/lib/ai/model-label";
import { EyIcon, type AywaIconName } from "@/components/icons/aywa-icons";

/**
 * 회의별 AI 보고서 — Aywa 아이콘 라벨 + 섹션별 접기/펼치기 + **섹션 인라인 수정**(staff가 인쇄/공유 전 AI 오류 교정).
 * 수정 시 해당 섹션만 ai_report jsonb에 머지 + 마지막 수정자·시각 기록(updateMeetingReportSection).
 * 본문은 RichText로 렌더(나열형은 불릿화). 라이브 AI 호출 없음.
 */

type SectionKey = Exclude<keyof MeetingReportSection, "meetingType">;

// 라벨(말)은 여기서 정하지 않는다 — 감사로그 상세도 같은 어휘를 써야 해서 단일 소스는
// [report-sections.ts](src/features/meetings/report-sections.ts)다. 여기는 그 라벨에 아이콘·불릿 여부만 붙인다.
const SECTIONS: { key: SectionKey; label: string; icon: AywaIconName; list?: boolean }[] = [
  { key: "summary", label: MEETING_REPORT_SECTION_LABEL.summary, icon: "report" },
  { key: "agendaDiscussion", label: MEETING_REPORT_SECTION_LABEL.agendaDiscussion, icon: "note", list: true },
  { key: "decisions", label: MEETING_REPORT_SECTION_LABEL.decisions, icon: "clipboardCheck", list: true },
  { key: "actionItems", label: MEETING_REPORT_SECTION_LABEL.actionItems, icon: "target", list: true },
  { key: "speakerSummary", label: MEETING_REPORT_SECTION_LABEL.speakerSummary, icon: "users", list: true },
  { key: "concerns", label: MEETING_REPORT_SECTION_LABEL.concerns, icon: "alert", list: true },
  { key: "nextSteps", label: MEETING_REPORT_SECTION_LABEL.nextSteps, icon: "arrowRight", list: true },
];

function fmtEdited(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function MeetingReportAccordion({
  report: initialReport,
  meetingId,
  editedBy,
  editedAt,
  modelVersion,
  canWrite,
}: {
  report: MeetingReportSection;
  meetingId: string;
  editedBy?: string | null;
  editedAt?: string | null;
  modelVersion?: string | null;
  /** 섹션 수정 권한 — 페이지가 updateMeetingReportSection과 같은 canWriteTenant("meetings")로 계산. 거짓이면 '수정' 칩·초안 배너가 없다. */
  canWrite: boolean;
}) {
  // 분석을 생성한 AI 모델의 짧은 라벨(원시 id 아님). 모델을 번갈아 쓰므로 직원이 확인 가능하게 노출.
  const modelLabel = modelDisplayLabel(modelVersion);
  // 로컬 수정본(저장 후 즉시 반영) + 마지막 수정자/시각(저장 후 갱신).
  const [report, setReport] = useState(initialReport);
  const [attribution, setAttribution] = useState<{ by: string; at: string } | null>(
    editedBy && editedAt ? { by: editedBy, at: editedAt } : null,
  );
  const available = SECTIONS.filter((s) => report[s.key]?.trim());
  const [open, setOpen] = useState<Set<SectionKey>>(
    () => new Set(available.length ? [available[0].key] : []),
  );
  const [editing, setEditing] = useState<SectionKey | null>(null);
  const [draft, setDraft] = useState("");
  // 편집 시작 시점의 원문 — 초안에 함께 저장해, 복구 시 원문이 그 사이 바뀌었으면(동료 수정·재분석) 폐기 판정.
  const [editBase, setEditBase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  // "수정중" presence — 어느 섹션이든 인라인 편집 중이면 track(닫히면 자동 해제).
  useEditPresence(`meeting:${meetingId}`, editing !== null);

  // 섹션 인라인 수정 로컬 초안 — 저장 전 새로고침으로 교정 내용이 날아가는 것 방지.
  // 수정 중 + 원문(base)에서 달라졌을 때만 IDB에 보관, 저장 성공·취소 시 삭제.
  const draftSnapshot = useMemo(() => ({ editing, draft, base: editBase }), [editing, draft, editBase]);
  const localDraft = useStateDraft({
    scope: `meeting-report:${meetingId}`,
    snapshot: draftSnapshot,
    enabled: canWrite, // 읽기 권한이면 되살릴 편집이 없다

    hasContent: (s) => s.editing !== null && s.draft.trim() !== s.base.trim(),
  });

  function restoreSectionDraft() {
    const d = localDraft.restore();
    if (!d?.editing) return;
    // 그 사이 원문이 바뀌었으면(동료 수정·재분석) 옛 초안으로 덮지 않는다 — 폐기 + 안내.
    if ((report[d.editing] ?? "").trim() !== (d.base ?? "").trim()) {
      localDraft.discard();
      setError("이어 쓰려던 섹션의 원문이 그 사이 바뀌어 초안을 폐기했습니다 — 현재 내용을 확인해 주세요.");
      return;
    }
    setError(null);
    setEditBase(d.base ?? "");
    setDraft(d.draft);
    setEditing(d.editing);
    setOpen((prev) => new Set(prev).add(d.editing!));
  }

  // 수정으로 비어졌다 다시 채워질 수 있으니 항상 7섹션 노출(빈 섹션도 수정 진입 가능하게).
  const visible = editing ? SECTIONS : available;
  const allOpen = visible.length > 0 && open.size >= visible.length;

  const toggle = (key: SectionKey) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(visible.map((s) => s.key)));

  function startEdit(key: SectionKey) {
    setError(null);
    const seed = report[key] ?? "";
    setDraft(seed);
    setEditBase(seed);
    setEditing(key);
    setOpen((prev) => new Set(prev).add(key));
  }

  // 취소 = 명시적 폐기 — 초안을 남기면 다음 열기에 버린 텍스트가 배너로 되살아난다(리뷰 지적).
  function cancelEdit() {
    localDraft.clear();
    setEditing(null);
  }

  function save(key: SectionKey) {
    setError(null);
    const fd = new FormData();
    fd.append("id", meetingId);
    fd.append("key", key);
    fd.append("content", draft);
    startSave(async () => {
      const res = await updateMeetingReportSection(undefined, fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setReport((prev) => ({ ...prev, [key]: draft.trim() }) as MeetingReportSection);
      if (res?.editedBy && res?.editedAt) setAttribution({ by: res.editedBy, at: res.editedAt });
      localDraft.clear();
      setEditing(null);
    });
  }

  if (available.length === 0 && !editing && !localDraft.draftSavedAt) return null;

  return (
    <div className="space-y-2">
      {canWrite ? (
        <DraftBanner
          savedAt={localDraft.draftSavedAt}
          onRestore={restoreSectionDraft}
          onDiscard={localDraft.discard}
        />
      ) : null}
      {/* 복구 폐기 안내 — 편집 UI가 닫혀 있을 때도 보이게 배너 자리 아래에 표시. */}
      {error && !editing ? <p className="text-danger text-xs">{error}</p> : null}
      <div className="flex items-center justify-between gap-2">
        {attribution ? (
          <span className="text-text-faint inline-flex items-center gap-1 text-xs">
            <Pencil className="size-3" />
            {attribution.by}님 수정 · {fmtEdited(attribution.at)}
          </span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1.5">
          {modelLabel ? (
            <span
              className="border-line text-text-faint inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs"
              title="이 분석을 생성한 AI 모델"
            >
              <EyIcon name="sparkle" size={10} />
              {modelLabel}
            </span>
          ) : null}
          <button
            type="button"
            onClick={toggleAll}
            className="text-text-faint hover:text-primary text-xs transition"
          >
            {allOpen ? "모두 접기" : "모두 펼치기"}
          </button>
        </div>
      </div>

      {visible.map((section) => {
        const body = (report[section.key] ?? "").trim();
        const isOpen = open.has(section.key);
        const isEditing = editing === section.key;
        return (
          <div key={section.key} className="border-line overflow-hidden rounded-md border">
            <button
              type="button"
              onClick={() => toggle(section.key)}
              aria-expanded={isOpen}
              className="bg-bg-soft hover:bg-bg-soft/60 flex w-full items-center justify-between gap-2 px-4 py-2.5 transition"
            >
              <h3 className="text-foreground flex items-center gap-2 text-sm font-bold">
                <EyIcon name={section.icon} size={15} />
                {section.label}
              </h3>
              <ChevronDown
                className={`text-text-faint size-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
              />
            </button>
            {isOpen ? (
              <div className="border-line border-t px-4 py-3">
                {isEditing && canWrite ? (
                  <div className="space-y-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={Math.min(14, Math.max(4, draft.split("\n").length + 1))}
                      autoFocus
                      className="border-line bg-background text-foreground focus:ring-primary/40 w-full resize-y rounded-md border px-3 py-2 text-sm leading-relaxed focus:ring-1 focus:outline-none"
                    />
                    <p className="text-text-faint text-xs">
                      줄바꿈·“•”·번호로 항목을 나눌 수 있습니다(인쇄·화면에 그대로 반영).
                    </p>
                    {error ? <p className="text-danger text-xs">{error}</p> : null}
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
                        onClick={() => save(section.key)}
                        disabled={saving}
                        className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition disabled:opacity-50"
                      >
                        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                        저장
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="group relative">
                    {/* 읽기 권한이면 '수정' 칩이 없다(원장 2026-11-05) — 칩 자리 여백(pr-16)도 함께 걷는다. */}
                    {canWrite ? (
                      <button
                        type="button"
                        onClick={() => startEdit(section.key)}
                        title="이 섹션 수정"
                        className="border-line text-text-faint hover:text-primary hover:bg-bg-soft absolute top-0 right-0 inline-flex items-center gap-1 rounded-md border bg-card/80 px-1.5 py-0.5 text-xs opacity-0 transition group-hover:opacity-100"
                      >
                        <Pencil className="size-3" /> 수정
                      </button>
                    ) : null}
                    {/* pr-16(64px) = 위 '수정' 칩 실측 폭(border 2 + px-1.5 12 + size-3 12 + gap-1 4 + text-xs 14px×2자 28 = 58px) 이상 — 2026-09-08 v5 글자 기준 실측. 두 곳 같은 값(빈 상태도 겹친다) */}
                    {body ? (
                      <RichText
                        text={body}
                        bulletize={section.list}
                        className={`text-foreground space-y-1.5 text-sm leading-relaxed ${canWrite ? "pr-16" : ""}`}
                      />
                    ) : (
                      <p className={`text-text-faint text-sm italic ${canWrite ? "pr-16" : ""}`}>
                        {canWrite ? "(내용 없음 — 수정으로 채울 수 있습니다)" : "(내용 없음)"}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
