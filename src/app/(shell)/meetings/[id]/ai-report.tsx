"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown, Loader2, Pencil, X } from "@/components/icons/eywa-icon-compat";
import type { MeetingReportSection } from "@/features/meetings/server/queries";
import { updateMeetingReportSection } from "@/features/meetings/server/actions";
import { RichText } from "@/components/rich-text";
import { useEditPresence } from "@/features/presence/edit-presence";
import { EyIcon, type EywaIconName } from "@/components/icons/eywa-icons";

/**
 * 회의별 AI 보고서 — Eywa 아이콘 라벨 + 섹션별 접기/펼치기 + **섹션 인라인 수정**(staff가 인쇄/공유 전 AI 오류 교정).
 * 수정 시 해당 섹션만 ai_report jsonb에 머지 + 마지막 수정자·시각 기록(updateMeetingReportSection).
 * 본문은 RichText로 렌더(나열형은 불릿화). 라이브 AI 호출 없음.
 */

type SectionKey = Exclude<keyof MeetingReportSection, "meetingType">;

const SECTIONS: { key: SectionKey; label: string; icon: EywaIconName; list?: boolean }[] = [
  { key: "summary", label: "요약", icon: "report" },
  { key: "agendaDiscussion", label: "안건별 논의", icon: "note", list: true },
  { key: "decisions", label: "결정 사항", icon: "clipboardCheck", list: true },
  { key: "actionItems", label: "액션 아이템", icon: "target", list: true },
  { key: "speakerSummary", label: "참석자별 발언", icon: "users", list: true },
  { key: "concerns", label: "우려 / 위험 요소", icon: "alert", list: true },
  { key: "nextSteps", label: "다음 단계", icon: "arrowRight", list: true },
];

function fmtEdited(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function MeetingReportAccordion({
  report: initialReport,
  meetingId,
  editedBy,
  editedAt,
}: {
  report: MeetingReportSection;
  meetingId: string;
  editedBy?: string | null;
  editedAt?: string | null;
}) {
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
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  // "수정중" presence — 어느 섹션이든 인라인 편집 중이면 track(닫히면 자동 해제).
  useEditPresence(`meeting:${meetingId}`, editing !== null);

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
    setDraft(report[key] ?? "");
    setEditing(key);
    setOpen((prev) => new Set(prev).add(key));
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
      setEditing(null);
    });
  }

  if (available.length === 0 && !editing) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        {attribution ? (
          <span className="text-text-faint inline-flex items-center gap-1 text-[11px]">
            <Pencil className="size-3" />
            {attribution.by}님 수정 · {fmtEdited(attribution.at)}
          </span>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={toggleAll}
          className="text-text-faint hover:text-primary text-[11px] transition"
        >
          {allOpen ? "모두 접기" : "모두 펼치기"}
        </button>
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
              <h3 className="text-foreground flex items-center gap-2 text-[13px] font-semibold">
                <EyIcon name={section.icon} size={15} />
                {section.label}
              </h3>
              <ChevronDown
                className={`text-text-faint size-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
              />
            </button>
            {isOpen ? (
              <div className="border-line border-t px-4 py-3">
                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={Math.min(14, Math.max(4, draft.split("\n").length + 1))}
                      autoFocus
                      className="border-line bg-background text-foreground focus:ring-primary/40 w-full resize-y rounded-md border px-3 py-2 text-[13px] leading-relaxed focus:ring-1 focus:outline-none"
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
                        onClick={() => save(section.key)}
                        disabled={saving}
                        className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-50"
                      >
                        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                        저장
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="group relative">
                    <button
                      type="button"
                      onClick={() => startEdit(section.key)}
                      title="이 섹션 수정"
                      className="border-line text-text-faint hover:text-primary hover:bg-bg-soft absolute top-0 right-0 inline-flex items-center gap-1 rounded-md border bg-card/80 px-1.5 py-0.5 text-[11px] opacity-0 transition group-hover:opacity-100"
                    >
                      <Pencil className="size-3" /> 수정
                    </button>
                    {body ? (
                      <RichText
                        text={body}
                        bulletize={section.list}
                        className="text-foreground space-y-1.5 pr-12 text-[13px] leading-relaxed"
                      />
                    ) : (
                      <p className="text-text-faint pr-12 text-[13px] italic">
                        (내용 없음 — 수정으로 채울 수 있습니다)
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
