"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { MeetingReportSection } from "@/features/meetings/server/queries";

/**
 * 회의별 AI 보고서 — ijw-calander의 "섹션 아코디언" 스타일을 eywa 토큰으로 이식.
 * 이모지 라벨 + 섹션별 접기/펼치기 + 모두 펼치기/접기. (MeetingReportViewer 패리티)
 * 서버에서 받은 aiReport(MeetingReportSection)만 렌더 — 라이브 AI 호출 없음.
 */

type SectionKey = Exclude<keyof MeetingReportSection, "meetingType">;

const SECTIONS: { key: SectionKey; label: string; emoji: string }[] = [
  { key: "summary", label: "요약", emoji: "📋" },
  { key: "agendaDiscussion", label: "안건별 논의", emoji: "📝" },
  { key: "decisions", label: "결정 사항", emoji: "✅" },
  { key: "actionItems", label: "액션 아이템", emoji: "🎯" },
  { key: "speakerSummary", label: "참석자별 발언", emoji: "🗣️" },
  { key: "concerns", label: "우려 / 위험 요소", emoji: "⚠️" },
  { key: "nextSteps", label: "다음 단계", emoji: "🔮" },
];

export function MeetingReportAccordion({ report }: { report: MeetingReportSection }) {
  const available = SECTIONS.filter((s) => report[s.key]?.trim());
  // 첫 섹션(요약)만 기본 펼침 — 나머지는 접어 회의별 한눈에 비교 가능.
  const [open, setOpen] = useState<Set<SectionKey>>(
    () => new Set(available.length ? [available[0].key] : []),
  );

  const allOpen = available.length > 0 && open.size >= available.length;

  const toggle = (key: SectionKey) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleAll = () =>
    setOpen(allOpen ? new Set() : new Set(available.map((s) => s.key)));

  if (available.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={toggleAll}
          className="text-text-faint hover:text-primary text-[11px] transition"
        >
          {allOpen ? "모두 접기" : "모두 펼치기"}
        </button>
      </div>

      {available.map((section) => {
        const body = report[section.key].trim();
        const isOpen = open.has(section.key);
        return (
          <div key={section.key} className="border-line overflow-hidden rounded-md border">
            <button
              type="button"
              onClick={() => toggle(section.key)}
              aria-expanded={isOpen}
              className="bg-bg-soft hover:bg-bg-soft/60 flex w-full items-center justify-between gap-2 px-4 py-2.5 transition"
            >
              <h3 className="text-foreground flex items-center gap-2 text-[13px] font-semibold">
                <span className="text-[15px] leading-none">{section.emoji}</span>
                {section.label}
              </h3>
              <ChevronDown
                className={`text-text-faint size-4 shrink-0 transition-transform ${
                  isOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {isOpen ? (
              <div className="border-line border-t px-4 py-3">
                <p className="text-foreground text-[13px] leading-relaxed whitespace-pre-wrap">
                  {body}
                </p>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
